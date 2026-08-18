import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark, BookOpen, Bot, Check, ChevronDown, ChevronUp, Code2, Copy, Download,
  Gamepad2, Globe, Heart, KeyRound, ListTodo, LoaderCircle, Maximize2, MessageSquare,
  Minimize2, Play, Radio, RefreshCw, RotateCcw, Send, Settings, Sparkles, Star,
  Terminal, ThumbsDown, ThumbsUp, Volume2, WifiOff, Wrench, X, Zap
} from 'lucide-react'
import {
  addBookmark, deleteAccount, getBookmarks, getRelationship,
  getSkills, register, removeBookmark, restore, sendChat, sendFeedback, speak
} from './api'
import type {
  AgentStep, ArtifactItem, BookmarkedComic, ChatMode, ComicRecommendation,
  Message, Milestone, Session, SkillInfo
} from './types'

const SESSION_KEYS = {
  userId: 'yuki_uid_v3', username: 'yuki_username_v3', accessCode: 'yuki_access_code_v3',
  bond: 'yuki_bond_v3', bondValue: 'yuki_bond_value_v3', mood: 'yuki_mood_v3', feeling: 'yuki_feeling_v3',
  sessionToken: 'yuki_session_token_v3', mode: 'yuki_mode_v3'
}

const moodImage: Record<string, string> = {
  tenang: 'tenang', senang: 'senang', ceria: 'senang', malu: 'malu',
  'sayang/manja': 'senang', sedih: 'sedih', kesal: 'kesal', cemas: 'lesu',
  kecewa: 'sedih', lesu: 'lesu', cemburu: 'kesal',
}
const blinkExpressions = new Set(['tenang', 'senang'])

type ConnectionState = 'idle' | 'thinking' | 'slow' | 'retrying' | 'offline' | 'error'
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const connectionLabel: Record<ConnectionState, string> = {
  idle: 'online', thinking: 'sedang berpikir', slow: 'koneksi agak lambat',
  retrying: 'sedang mencoba lagi', offline: 'kamu sedang offline', error: 'koneksi terputus'
}

function bondNameFromValue(value = 0) {
  if (value >= 78) return 'kekasih / pasangan (dere-dere)'
  if (value >= 50) return 'luluh (dere)'
  if (value >= 24) return 'diam-diam peduli'
  if (value >= 8) return 'mulai terbiasa'
  return 'orang asing'
}

function getSession(): Session | null {
  const userId = localStorage.getItem(SESSION_KEYS.userId)
  if (!userId) return null
  return {
    userId,
    username: localStorage.getItem(SESSION_KEYS.username) || 'Kamu',
    accessCode: localStorage.getItem(SESSION_KEYS.accessCode) || '',
    sessionToken: localStorage.getItem(SESSION_KEYS.sessionToken) || '',
  }
}

function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEYS.userId, session.userId)
  localStorage.setItem(SESSION_KEYS.username, session.username)
  localStorage.setItem(SESSION_KEYS.accessCode, session.accessCode)
  localStorage.setItem(SESSION_KEYS.sessionToken, session.sessionToken)
}

function historyKey(userId: string) { return `yuki_hist_v3_${userId}` }

function loadHistory(userId?: string): Message[] {
  if (!userId) return []
  try { return JSON.parse(localStorage.getItem(historyKey(userId)) || '[]') }
  catch { return [] }
}

function legacyComics(text: string) {
  const normalized = text.replace(/\*\s*\n([^\n*]+)\n\s*\*/g, '**$1**')
  const comics: ComicRecommendation[] = []
  const clean = normalized.replace(/\*\*([^*\n]+)\*\*\s*\n([^\n]+)\s*\n\[Link\]\s*\n?\((https?:\/\/ryukomik\.my\.id\/[^\s)]+)\)/gi, (_block, title, meta, rawUrl) => {
    try {
      const parsed = new URL(rawUrl)
      const image = parsed.searchParams.get('img') || ''
      parsed.searchParams.delete('img')
      const [type = '', chapter = ''] = String(meta).split(/\s*[·•]\s*/)
      comics.push({ title: String(title).trim(), type, chapter, image, url: parsed.toString() })
    } catch { /* abaikan */ }
    return ''
  })
  return { clean: clean.trim(), comics }
}

function cleanComicText(text: string, comics: ComicRecommendation[]) {
  if (!comics.length) return text
  const positions = comics.map(comic => text.toLowerCase().indexOf(comic.title.toLowerCase())).filter(index => index >= 0)
  if (positions.length) return text.slice(0, Math.min(...positions)).replace(/[\s*:_-]+$/g, '').trim()
  return text.replace(/\[?link\]?\s*\(?\s*https?:\/\/ryukomik\.my\.id[^\s)]*(?:\s*img=[^\s)]*)?\s*\)?/gi, '').replace(/^\s*\*\s*$/gm, '').trim()
}

function ComicCard({ comic, isBookmarked, onToggleBookmark }: {
  comic: ComicRecommendation
  isBookmarked: boolean
  onToggleBookmark: (comic: ComicRecommendation) => void
}) {
  return (
    <div className="comic-card">
      <div className="comic-cover">
        {comic.image ? <img src={comic.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <BookOpen size={20} />}
      </div>
      <div className="comic-details">
        <div className="comic-title-row">
          {comic.format && <span className="comic-format-tag">{comic.format}</span>}
          <strong>{comic.title}</strong>
        </div>
        <span className="comic-meta-row">
          {comic.type && <span>{comic.type}</span>}
          {comic.chapter && <span>· {comic.chapter}</span>}
          {comic.score && (
            <span className="comic-score-tag">
              <Star size={9} fill="currentColor" /> {comic.score}
            </span>
          )}
        </span>
      </div>
      <div className="comic-card-actions">
        <button
          type="button"
          className={`comic-bookmark-btn ${isBookmarked ? 'saved' : ''}`}
          onClick={() => onToggleBookmark(comic)}
          aria-label={isBookmarked ? 'Hapus bookmark komik' : 'Simpan komik'}
          title={isBookmarked ? 'Tersimpan' : 'Simpan komik'}
        >
          <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
        <a className="comic-open" href={comic.url} target="_blank" rel="noreferrer">
          BACA
        </a>
      </div>
    </div>
  )
}

function AgentThoughtCard({ thinking }: { thinking?: string }) {
  const [open, setOpen] = useState(false)
  if (!thinking || !thinking.trim()) return null

  return (
    <div className="yuki-thought-card">
      <button
        type="button"
        className="yuki-thought-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="yuki-thought-title">
          <Sparkles size={13} className="yuki-sparkle-icon" />
          <span><b>Proses Berpikir Yuki</b> (Analisis Internal)</span>
        </span>
        <span className="yuki-thought-chevron">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {open && (
        <div className="yuki-thought-body">
          <pre>{thinking}</pre>
        </div>
      )}
    </div>
  )
}

function AgentStepsCard({ steps }: { steps?: AgentStep[] }) {
  const [open, setOpen] = useState(true)
  if (!steps || steps.length === 0) return null

  return (
    <div className="agent-steps-card">
      <div className="agent-steps-header">
        <span className="agent-steps-title">
          <Zap size={13} className="agent-zap-icon" />
          <span><b>Proses Eksekusi Agent</b> ({steps.length} langkah tuntas)</span>
        </span>
        <button
          type="button"
          className="agent-steps-toggle-btn"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? 'Tutup' : 'Lihat'}
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {open && (
        <div className="agent-steps-list">
          {steps.map((step, idx) => (
            <div className={`agent-step-item ${step.status || 'done'}`} key={step.id || idx}>
              <div className="agent-step-icon-col">
                <span className="agent-step-check"><Check size={11} /></span>
                {idx < steps.length - 1 && <span className="agent-step-line" />}
              </div>
              <div className="agent-step-main-col">
                <div className="agent-step-top">
                  <span className="agent-step-badge">{step.skillTitle || step.tool}</span>
                  {step.durationMs !== undefined && (
                    <span className="agent-step-time">{step.durationMs}ms</span>
                  )}
                </div>
                <div className="agent-step-desc">{step.title}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LiveAgentWorkingBubble() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const phases = [
    'Menganalisis instruksi tugas & memilih skills...',
    'Menjalankan Yuki ReAct Reasoning Loop...',
    'Merakit logika aplikasi, HTML5 Canvas & Web Audio...',
    'Menguji dan mengompilasi Live Sandbox Artifact...',
    'Menyusun balasan akhir & panel interaktif...'
  ]

  const currentPhase = phases[Math.min(Math.floor(seconds / 3), phases.length - 1)]

  return (
    <article className="message assistant agent-msg live-agent-working-bubble">
      <div className="message-avatar">
        <Zap size={14} className="agent-pulse-icon" />
      </div>
      <div className="message-content live-agent-working-content">
        <div className="live-agent-badge-row">
          <span className="live-pulse-dot" />
          <span><b>Working</b> — {seconds}s — Yuki Agent</span>
        </div>
        <div className="live-agent-step-text">
          <LoaderCircle size={13} className="spin" />
          <span>{currentPhase}</span>
        </div>
      </div>
    </article>
  )
}

function prepareArtifactHtml(rawHtml = '') {
  if (!rawHtml || typeof rawHtml !== 'string') return ''
  let html = rawHtml.trim()

  const mobileTouchEngine = `
  <style id="_yuki_injected_style">
    * { box-sizing: border-box !important; -webkit-tap-highlight-color: transparent !important; }
    html, body {
      width: 100% !important;
      min-height: 100% !important;
      margin: 0 !important;
      padding: 6px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      background: #08090c !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      touch-action: manipulation !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    #game-wrapper, .game-wrapper, .game-container, #container, main {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      max-width: 100vw !important;
      padding: 6px !important;
      margin: 0 auto !important;
      box-sizing: border-box !important;
    }
    canvas {
      display: block !important;
      margin: 0 auto !important;
      max-width: 95vw !important;
      max-height: 65vh !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      touch-action: none !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8) !important;
    }
    .controls {
      display: flex !important;
      flex-wrap: wrap !important;
      justify-content: center !important;
      gap: 6px !important;
      margin-top: 8px !important;
      max-width: 100vw !important;
    }
  </style>
  <script id="_yuki_injected_script">
  (function() {
    // 1. Auto-Start Helper (Otomatis start game jika butuh tombol START)
    function autoStartGame() {
      var startBtns = document.querySelectorAll('#btn-start, #start-btn, #start, .btn-start, button');
      startBtns.forEach(function(btn) {
        var txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (txt === 'start' || txt === 'play' || txt === 'mulai' || txt === 'start game') {
          btn.click();
        }
      });
    }

    setTimeout(autoStartGame, 100);
    setTimeout(autoStartGame, 400);
    window.addEventListener('touchstart', autoStartGame, { once: true });
    window.addEventListener('click', autoStartGame, { once: true });

    // 2. Dynamic Canvas Resizer
    function autoScaleCanvas() {
      var canvases = document.querySelectorAll('canvas');
      canvases.forEach(function(canvas) {
        if (!canvas.dataset.nativeW) {
          canvas.dataset.nativeW = canvas.width || 300;
          canvas.dataset.nativeH = canvas.height || 500;
        }
        var nw = parseFloat(canvas.dataset.nativeW);
        var nh = parseFloat(canvas.dataset.nativeH);
        var ratio = nw / nh;

        var maxW = Math.min(window.innerWidth - 16, 480);
        var maxH = window.innerHeight * 0.65;

        var targetW = maxW;
        var targetH = targetW / ratio;
        if (targetH > maxH) {
          targetH = maxH;
          targetW = targetH * ratio;
        }
        canvas.style.width = Math.floor(targetW) + 'px';
        canvas.style.height = Math.floor(targetH) + 'px';
      });
    }

    window.addEventListener('resize', autoScaleCanvas);
    window.addEventListener('orientationchange', autoScaleCanvas);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoScaleCanvas);
    } else {
      autoScaleCanvas();
    }
    setTimeout(autoScaleCanvas, 50);
    setTimeout(autoScaleCanvas, 250);

    // 3. Touch Drag & Tap Controls
    var startTouchX = null;
    var startTouchY = null;
    var lastTouchX = null;
    var lastTouchY = null;
    var touchMoved = false;

    function dispatchMouse(type, clientX, clientY) {
      var canvases = document.querySelectorAll('canvas');
      canvases.forEach(function(canvas) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / (rect.width || 1);
        var scaleY = canvas.height / (rect.height || 1);
        var localX = (clientX - rect.left) * scaleX;
        var localY = (clientY - rect.top) * scaleY;
        var evt = new MouseEvent(type, {
          clientX: clientX, clientY: clientY,
          bubbles: true, cancelable: true, view: window
        });
        try {
          Object.defineProperty(evt, 'offsetX', { value: localX });
          Object.defineProperty(evt, 'offsetY', { value: localY });
          Object.defineProperty(evt, 'layerX', { value: localX });
          Object.defineProperty(evt, 'layerY', { value: localY });
        } catch(e) {}
        canvas.dispatchEvent(evt);
      });
      var docEvt = new MouseEvent(type, { clientX: clientX, clientY: clientY, bubbles: true, cancelable: true, view: window });
      document.dispatchEvent(docEvt);
      window.dispatchEvent(docEvt);
    }

    function triggerKey(keyName, keyCodeVal) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, code: keyName, keyCode: keyCodeVal, which: keyCodeVal, bubbles: true }));
      setTimeout(function() {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, code: keyName, keyCode: keyCodeVal, which: keyCodeVal, bubbles: true }));
      }, 35);
    }

    window.addEventListener('touchstart', function(e) {
      if (!e.touches || e.touches.length === 0) return;
      var touch = e.touches[0];
      startTouchX = touch.clientX;
      startTouchY = touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      touchMoved = false;

      dispatchMouse('mousedown', touch.clientX, touch.clientY);
      dispatchMouse('mousemove', touch.clientX, touch.clientY);

      var clickEvt = new MouseEvent('click', { clientX: touch.clientX, clientY: touch.clientY, bubbles: true, cancelable: true });
      e.target.dispatchEvent(clickEvt);
    }, { passive: false });

    window.addEventListener('touchmove', function(e) {
      if (!e.touches || e.touches.length === 0) return;
      var touch = e.touches[0];
      var currentX = touch.clientX;
      var currentY = touch.clientY;

      dispatchMouse('mousemove', currentX, currentY);

      if (lastTouchX !== null && lastTouchY !== null) {
        var deltaX = currentX - lastTouchX;
        var deltaY = currentY - lastTouchY;

        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
          touchMoved = true;
        }

        // Horizontal Swipe: Left / Right
        if (deltaX < -3) {
          triggerKey('ArrowLeft', 37);
        } else if (deltaX > 3) {
          triggerKey('ArrowRight', 39);
        }

        // Vertical Swipe Down: Drop / Fast Fall
        if (deltaY > 6) {
          triggerKey('ArrowDown', 40);
        }
      }
      lastTouchX = currentX;
      lastTouchY = currentY;
    }, { passive: false });

    window.addEventListener('touchend', function(e) {
      dispatchMouse('mouseup', 0, 0);

      // Tap = Rotate / Jump / Action
      if (!touchMoved && startTouchX !== null) {
        triggerKey('ArrowUp', 38);
        triggerKey('w', 87);
        triggerKey(' ', 32);
        triggerKey('Enter', 13);
      }

      startTouchX = null;
      startTouchY = null;
      lastTouchX = null;
      lastTouchY = null;
      touchMoved = false;
    }, { passive: false });
  })();
  </script>`

  if (!html.includes('_yuki_injected_script')) {
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${mobileTouchEngine}\n</body>`)
    } else if (/<\/html>/i.test(html)) {
      html = html.replace(/<\/html>/i, `${mobileTouchEngine}\n</html>`)
    } else {
      html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"></head><body>${html}${mobileTouchEngine}</body></html>`
    }
  }

  return html
}


function CodexArtifactModal({ artifact, onClose }: { artifact: ArtifactItem; onClose: () => void }) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [copied, setCopied] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const processedHtml = useMemo(() => prepareArtifactHtml(artifact.content), [artifact.content])

  function handleCopy() {
    navigator.clipboard.writeText(artifact.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  function handleDownload() {
    const ext = artifact.type === 'svg' ? 'svg' : artifact.type === 'javascript' ? 'js' : 'html'
    const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`artifact-modal-backdrop ${isFullscreen ? 'fullscreen-backdrop' : ''}`} onClick={onClose}>
      <section className={`artifact-modal-window ${isFullscreen ? 'fullscreen-window' : ''}`} onClick={e => e.stopPropagation()}>
        <header className="artifact-modal-header">
          <div className="artifact-title-group">
            <span className="artifact-badge"><Code2 size={12} /> ARTIFACT APP</span>
            <h2 title={artifact.title}>{artifact.title}</h2>
          </div>

          <div className="artifact-header-controls">
            <div className="artifact-tab-pill">
              <button
                type="button"
                className={`artifact-tab-btn ${tab === 'preview' ? 'active' : ''}`}
                onClick={() => setTab('preview')}
                title="Tampilkan Preview Aplikasi"
              >
                <Play size={12} />
                <span>Preview</span>
              </button>
              <button
                type="button"
                className={`artifact-tab-btn ${tab === 'code' ? 'active' : ''}`}
                onClick={() => setTab('code')}
                title="Lihat Source Code"
              >
                <Code2 size={12} />
                <span>Kode</span>
              </button>
            </div>

            <div className="artifact-action-icons">
              {tab === 'preview' && (
                <button
                  className="artifact-action-icon"
                  onClick={() => setReloadKey(k => k + 1)}
                  title="Restart / Reload"
                  aria-label="Restart Sandbox"
                >
                  <RotateCcw size={13} />
                </button>
              )}
              <button
                className="artifact-action-icon"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? 'Keluar Fullscreen' : 'Fullscreen'}
                aria-label="Toggle Fullscreen"
              >
                {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              <button className="artifact-action-icon" onClick={handleCopy} title="Salin Kode" aria-label="Salin Kode">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button className="artifact-action-icon" onClick={handleDownload} title="Unduh File" aria-label="Unduh File">
                <Download size={13} />
              </button>
              <button className="artifact-close-btn" onClick={onClose} aria-label="Tutup" title="Tutup Modal">
                <X size={15} />
              </button>
            </div>
          </div>
        </header>

        <div className="codex-artifact-body">
          {tab === 'preview' ? (
            <div className="artifact-iframe-container">
              <iframe
                key={reloadKey}
                title={artifact.title}
                srcDoc={processedHtml}
                sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-pointer-lock"
                className="artifact-preview-frame"
                allow="autoplay"
              />
            </div>


          ) : (
            <div className="artifact-code-view">
              <pre><code>{artifact.content}</code></pre>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function cleanMessageContent(text: string) {
  if (!text) return ''
  let clean = text
  clean = clean.replace(/:::(?:thought|thinking)\s*[\s\S]*?(?::::|$)/gi, '')
  clean = clean.replace(/:::(?:thought|thinking)?/gi, '')
  clean = clean.replace(/<(?:thinking|think|thought)>[\s\S]*?<\/(?:thinking|think|thought)>/gi, '')
  clean = clean.replace(/<\/?(?:thinking|think|thought)>/gi, '')
  clean = clean.replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|tool)":\s*"(?:html-canvas-builder|build_interactive_artifact)"[\s\S]*?```/gi, '')
  clean = clean.replace(/```(?:html|xml)?\s*\n\s*(?:<!DOCTYPE|<html)[\s\S]*?(?:```|$)/gi, '')
  clean = clean.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  return clean.trim()
}

function MessageBody({ message, bookmarks, onToggleBookmark, onOpenArtifact }: {
  message: Message
  bookmarks: BookmarkedComic[]
  onToggleBookmark: (comic: ComicRecommendation) => void
  onOpenArtifact: (artifact: ArtifactItem) => void
}) {
  const legacy = legacyComics(message.content)
  const comics = message.comics?.length ? message.comics : legacy.comics
  const rawText = message.comics?.length ? message.content : legacy.clean
  const textWithoutComics = cleanComicText(rawText, comics)
  const text = cleanMessageContent(textWithoutComics)
  const parts = text.split(/(\*[^*\n]{2,100}\*)/g).filter(Boolean)
  const bookmarkedUrls = new Set(bookmarks.map(b => b.url))

  return <>
    {message.thinking && (
      <AgentThoughtCard thinking={message.thinking} />
    )}
    {message.steps && message.steps.length > 0 && (
      <AgentStepsCard steps={message.steps} />
    )}
    {parts.map((part, index) => part.startsWith('*') && part.endsWith('*')
      ? <em className="action" key={index}>{part.slice(1, -1).trim()}</em>
      : <span key={index}>{part.replace(/^\s*\*\s*$/gm, '')}</span>)}
    {message.artifacts && message.artifacts.length > 0 && (
      <div className="artifacts-launcher-list">
        {message.artifacts.map(art => (
          <div className="artifact-launcher-card" key={art.id}>
            <button
              type="button"
              className="artifact-launch-btn"
              onClick={() => onOpenArtifact(art)}
            >
              <Play size={13} className="artifact-play-icon" />
              <span><b>{art.title}</b> <small>· Mainkan Live</small></span>
              <span className="artifact-type-tag">{art.type.toUpperCase()}</span>
            </button>
            <button
              type="button"
              className="artifact-download-btn"
              title="Unduh file .html mandiri"
              onClick={(e) => {
                e.stopPropagation()
                const blob = new Blob([art.content], { type: 'text/html;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${art.title.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'yuki_game'}.html`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download size={12} />
              <span>Unduh .html</span>
            </button>
          </div>
        ))}
      </div>
    )}
    {comics.length > 0 && (
      <div className="comic-list">
        {comics.map(comic => (
          <ComicCard
            comic={comic}
            isBookmarked={bookmarkedUrls.has(comic.url)}
            onToggleBookmark={onToggleBookmark}
            key={comic.url}
          />
        ))}
      </div>
    )}
  </>
}

function SkillsCatalogModal({ skills, onClose }: { skills: SkillInfo[]; onClose: () => void }) {
  const categoryConfig: Record<string, { label: string; icon: typeof Globe }> = {
    research: { label: 'Research & Web Browsing', icon: Globe },
    media: { label: 'Media & Ryukomik Catalog', icon: BookOpen },
    productivity: { label: 'Productivity & Planning', icon: ListTodo },
    computing: { label: 'Computing & Live Artifacts', icon: Terminal },
    general: { label: 'General Capabilities', icon: Wrench }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, SkillInfo[]>()
    for (const s of skills) {
      const cat = s.category || 'general'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(s)
    }
    return map
  }, [skills])

  return (
    <div className="timeline-overlay" onClick={onClose}>
      <section className="timeline-card skills-modal" onClick={e => e.stopPropagation()}>
        <header>
          <div>
            <small>Skills & Tools Engine</small>
            <h2>Katalog Skills Yuki Agent</h2>
          </div>
          <button onClick={onClose} aria-label="Tutup"><X size={17} /></button>
        </header>

        <div className="skills-modal-content">
          <p className="skills-intro">
            Dalam <b>Mode Agent</b>, Yuki dibekali sistem skills modular untuk riset web, live artifact builder, manajemen agenda to-do, pelacakan Ryukomik, dan komputasi presisi.
          </p>

          {Array.from(grouped.entries()).map(([cat, list]) => {
            const conf = categoryConfig[cat] || { label: cat.toUpperCase(), icon: Wrench }
            const CatIcon = conf.icon
            return (
              <div className="skills-cat-group" key={cat}>
                <h3>
                  <CatIcon size={14} className="cat-header-icon" />
                  <span>{conf.label}</span>
                </h3>
                <div className="skills-grid">
                  {list.map(s => (
                    <div className="skill-card" key={s.name}>
                      <div className="skill-card-top">
                        <strong>{s.title}</strong>
                        <span className="skill-ver">v{s.version}</span>
                      </div>
                      <p>{s.description}</p>
                      <code>skills/{cat}/{s.name}</code>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Onboarding({ onReady }: { onReady: (session: Session, history?: Message[], bondValue?: number, milestones?: Milestone[]) => void }) {
  const [mode, setMode] = useState<'register' | 'restore'>('register')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    setBusy(true); setError('')
    try {
      if (mode === 'register') {
        const data = await register(value.trim())
        const introduction: Message[] = data.welcome
          ? [{ role: 'assistant', content: data.welcome }]
          : []
        onReady({ userId: data.userId, username: value.trim(), accessCode: data.accessCode, sessionToken: data.sessionToken }, introduction, 0, data.milestones)
      } else {
        const code = value.trim().toUpperCase()
        const data = await restore(code)
        onReady({ userId: data.userId, username: data.username, accessCode: code, sessionToken: data.sessionToken }, data.history || [], data.bondValue, data.milestones)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Terjadi kesalahan') }
    finally { setBusy(false) }
  }

  return <div className="overlay">
    <form className="onboarding" onSubmit={submit}>
      <div className="onboarding-index">Y / 001</div>
      <div className="onboarding-icon"><KeyRound size={20} /></div>
      <p className="eyebrow">Yuki character interface</p>
      <h1>{mode === 'register' ? 'Kenalan dulu.' : 'Pulihkan ingatan.'}</h1>
      <p className="onboarding-copy">{mode === 'register'
        ? 'Yuki perlu tahu harus memanggilmu siapa. Hubungan dan percakapan disimpan khusus untukmu.'
        : 'Masukkan kunci ingatan agar Yuki mengenalimu kembali di perangkat ini.'}</p>
      <label>{mode === 'register' ? 'Nama kamu' : 'Kunci ingatan'}</label>
      <input autoFocus value={value} onChange={e => setValue(e.target.value)}
        placeholder={mode === 'register' ? 'Tulis namamu' : 'YUKI-XXXX-XXXX'} />
      {error && <div className="form-error">{error}</div>}
      <button className="primary" disabled={busy || !value.trim()}>{busy && <LoaderCircle className="spin" size={16} />}{mode === 'register' ? 'Mulai mengobrol' : 'Pulihkan'}</button>
      <button className="text-button" type="button" onClick={() => { setMode(mode === 'register' ? 'restore' : 'register'); setError(''); setValue('') }}>
        {mode === 'register' ? 'Sudah punya kunci ingatan?' : 'Buat hubungan baru'}
      </button>
    </form>
  </div>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => getSession())
  const [messages, setMessages] = useState<Message[]>(() => loadHistory(getSession()?.userId))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mood, setMood] = useState(() => localStorage.getItem(SESSION_KEYS.mood) || 'tenang')
  const [bond, setBond] = useState(() => localStorage.getItem(SESSION_KEYS.bond) || 'orang asing')
  const [bondValue, setBondValue] = useState(() => Number(localStorage.getItem(SESSION_KEYS.bondValue)) || 0)
  const [feeling, setFeeling] = useState(() => localStorage.getItem(SESSION_KEYS.feeling) || 'Lagi kalem, jawab seperlunya.')
  const [chatMode, setChatMode] = useState<ChatMode>(() => (localStorage.getItem(SESSION_KEYS.mode) as ChatMode) || 'companion')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [avatarCompact, setAvatarCompact] = useState(false)
  const [blinking, setBlinking] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>(() => navigator.onLine ? 'idle' : 'offline')
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [bookmarks, setBookmarks] = useState<BookmarkedComic[]>([])
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null)
  const [feedback, setFeedback] = useState<Record<number, 1 | -1>>({})
  const endRef = useRef<HTMLDivElement>(null)
  const currentAudio = useRef<HTMLAudioElement | null>(null)
  const requestTimers = useRef<number[]>([])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])
  useEffect(() => { if (session) localStorage.setItem(historyKey(session.userId), JSON.stringify(messages.slice(-40))) }, [messages, session])
  useEffect(() => { localStorage.setItem(SESSION_KEYS.mode, chatMode) }, [chatMode])

  useEffect(() => {
    const online = () => setConnection('idle')
    const offline = () => setConnection('offline')
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    const updated = () => setUpdateReady(true)
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('yuki-pwa-update', updated)
    return () => {
      window.removeEventListener('online', online); window.removeEventListener('offline', offline)
      window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('yuki-pwa-update', updated)
    }
  }, [])

  useEffect(() => () => requestTimers.current.forEach(window.clearTimeout), [])
  useEffect(() => {
    if (!session || session.sessionToken || !session.accessCode) return
    restore(session.accessCode)
      .then(data => ready({ ...session, sessionToken: data.sessionToken }, data.history || messages, data.bondValue, data.milestones))
      .catch(err => {
        console.warn('[Session] Gagal restore dari server, mempertahankan data lokal:', err.message)
        const localHist = loadHistory(session.userId)
        if (localHist.length && messages.length === 0) setMessages(localHist)
      })
  }, [session?.userId, session?.sessionToken])

  useEffect(() => {
    if (!session?.sessionToken) return
    getRelationship(session.userId).then(data => {
      setMilestones(data.milestones || [])
      setBond(data.bond); setBondValue(data.bondValue)
    }).catch(() => {})
    getBookmarks().then(data => setBookmarks(data.bookmarks || [])).catch(() => {})
    getSkills().then(data => setSkills(data.skills || [])).catch(() => {})
  }, [session?.userId, session?.sessionToken])

  const avatarExpression = useMemo(() => moodImage[mood] || 'tenang', [mood])
  const canBlink = blinkExpressions.has(avatarExpression)
  const avatar = `/expressions/${avatarExpression}${blinking && canBlink ? '_blink' : ''}.png`

  useEffect(() => {
    const paths = [`/expressions/${avatarExpression}.png`]
    if (canBlink) paths.push(`/expressions/${avatarExpression}_blink.png`)
    paths.forEach(src => { const image = new Image(); image.src = src })
  }, [avatarExpression, canBlink])

  useEffect(() => {
    setBlinking(false)
    if (!canBlink) return
    const timers: number[] = []
    const later = (callback: () => void, delay: number) => { const id = window.setTimeout(callback, delay); timers.push(id) }
    const schedule = () => later(() => {
      if (document.hidden) { schedule(); return }
      setBlinking(true)
      later(() => {
        setBlinking(false)
        if (Math.random() < 0.22) {
          later(() => { setBlinking(true); later(() => { setBlinking(false); schedule() }, 95) }, 115)
        } else schedule()
      }, 110)
    }, 2_400 + Math.random() * 3_600)
    schedule()
    return () => timers.forEach(window.clearTimeout)
  }, [avatarExpression, canBlink])

  function ready(next: Session, restored: Message[] = [], restoredBond = 0, restoredMilestones: Milestone[] = []) {
    saveSession(next); setSession(next); setMessages(restored); setError('')
    setMilestones(restoredMilestones)
    if (restoredBond > 0) {
      const restoredName = bondNameFromValue(restoredBond)
      setBondValue(restoredBond); setBond(restoredName)
      localStorage.setItem(SESSION_KEYS.bondValue, String(restoredBond)); localStorage.setItem(SESSION_KEYS.bond, restoredName)
    }
  }

  async function handleToggleBookmark(comic: ComicRecommendation) {
    if (!session) return
    const isSaved = bookmarks.some(b => b.url === comic.url)
    try {
      if (isSaved) {
        const res = await removeBookmark(comic.url)
        setBookmarks(res.bookmarks || [])
      } else {
        const res = await addBookmark(comic)
        setBookmarks(res.bookmarks || [])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal memperbarui bookmark')
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy || !session) return
    navigator.vibrate?.(10)
    const next: Message[] = [...messages, { role: 'user', content, mode: chatMode }]
    setMessages(next); setInput(''); setBusy(true); setError(''); setConnection('thinking')
    requestTimers.current.forEach(window.clearTimeout)
    requestTimers.current = [
      window.setTimeout(() => setConnection('slow'), 8_000),
      window.setTimeout(() => setConnection('retrying'), 22_000)
    ]
    let failed = false
    try {
      const result = await sendChat(session.userId, next, false, chatMode)
      if (!result.reply?.trim()) throw new Error('Yuki mengirim balasan kosong. Coba lagi.')
      setMessages([...next, {
        role: 'assistant',
        content: result.reply,
        comics: result.comics || [],
        messageId: result.messageId,
        mode: result.mode || chatMode,
        steps: result.steps || [],
        thinking: result.thinking || '',
        artifacts: result.artifacts || []
      }])
      setMood(result.mood || 'tenang'); setBond(result.bond || bond)
      setBondValue(result.bondValue || 0); setFeeling(result.feeling || feeling)
      if (result.milestones) setMilestones(result.milestones)
      localStorage.setItem(SESSION_KEYS.mood, result.mood || 'tenang')
      localStorage.setItem(SESSION_KEYS.bond, result.bond || bond)
      localStorage.setItem(SESSION_KEYS.bondValue, String(result.bondValue || 0))
      localStorage.setItem(SESSION_KEYS.feeling, result.feeling || feeling)
    } catch (cause) {
      failed = true; setConnection(navigator.onLine ? 'error' : 'offline')
      setError(cause instanceof Error ? cause.message : 'Yuki sedang tidak bisa menjawab')
      window.setTimeout(() => setConnection(navigator.onLine ? 'idle' : 'offline'), 4_000)
    } finally {
      requestTimers.current.forEach(window.clearTimeout); requestTimers.current = []
      setBusy(false); if (!failed) setConnection(navigator.onLine ? 'idle' : 'offline')
    }
  }

  useEffect(() => {
    if (!session || busy || messages.length < 2 || document.hidden) return
    const timer = window.setTimeout(async () => {
      if (document.hidden || !navigator.onLine || chatMode === 'agent') return
      setBusy(true); setConnection('thinking')
      try {
        const result = await sendChat(session.userId, messages, true, 'companion')
        if (result.reply?.trim()) {
          setMessages(current => [...current, { role: 'assistant', content: result.reply, messageId: result.messageId }])
          setMood(result.mood || 'tenang'); setFeeling(result.feeling || feeling)
          if (result.milestones) setMilestones(result.milestones)
        }
      } catch { /* sapaan idle */ }
      finally { setBusy(false); setConnection(navigator.onLine ? 'idle' : 'offline') }
    }, 120_000)
    return () => window.clearTimeout(timer)
  }, [messages, session, busy, chatMode])

  async function rateMessage(index: number, message: Message, rating: 1 | -1) {
    if (!session || feedback[index]) return
    setFeedback(current => ({ ...current, [index]: rating }))
    try { await sendFeedback(session.userId, message.messageId, rating) }
    catch { setFeedback(current => { const next = { ...current }; delete next[index]; return next }) }
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null); setSettingsOpen(false)
  }

  async function play(text: string, index: number) {
    if (currentAudio.current) {
      currentAudio.current.pause()
      if (currentAudio.current.src.startsWith('blob:')) URL.revokeObjectURL(currentAudio.current.src)
      currentAudio.current = null
    }
    if (speakingIndex === index) { setSpeakingIndex(null); return }
    setSpeakingIndex(index)
    try {
      const audio = new Audio(await speak(text))
      const objectUrl = audio.src
      currentAudio.current = audio
      const cleanup = () => { URL.revokeObjectURL(objectUrl); setSpeakingIndex(null) }
      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play()
    } catch { setSpeakingIndex(null); setError('Suara Yuki sedang tidak tersedia.') }
  }

  function reset() {
    if (!session) return
    localStorage.removeItem(historyKey(session.userId))
    Object.values(SESSION_KEYS).forEach(key => localStorage.removeItem(key))
    setSession(null); setMessages([]); setBookmarks([]); setSettingsOpen(false)
  }

  async function removeAccount() {
    if (!window.confirm('Hapus seluruh chat, memori, dan hubungan dengan Yuki secara permanen?')) return
    try { await deleteAccount(); reset() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Data belum berhasil dihapus') }
  }

  const companionSuggestions = [
    { icon: Sparkles, label: 'Manhwa Aksi', text: 'Rekomendasikan manhwa aksi terbaik di Ryukomik' },
    { icon: Heart, label: 'Romance Manis', text: 'Rekomendasi manga romance yang manis dan santai' },
    { icon: BookOpen, label: 'Isekai Populer', text: 'Cari komik bertema isekai yang seru' },
    { icon: RefreshCw, label: 'Update Terbaru', text: 'Komik apa saja yang baru update chapter di Ryukomik?' }
  ]

  const agentSuggestions = [
    { icon: Gamepad2, label: 'Mini-Game Canvas', text: 'Buatkan mini-game Canvas retro interaktif' },
    { icon: Code2, label: 'Analisis & Debug', text: 'Analisis dan debug kode JavaScript ini' },
    { icon: Radio, label: 'Test REST API', text: 'Test endpoint REST API https://httpbin.org/get' },
    { icon: Globe, label: 'Riset Berita Web', text: 'Riset berita dan update anime terbaru minggu ini' },
    { icon: ListTodo, label: 'Agenda To-Do', text: 'Catat agenda to-do list belajarku besok' }
  ]

  return <main className={`app-shell${avatarCompact ? ' avatar-compact' : ''} mode-${chatMode}`}>
    {updateReady && <div className="pwa-update"><RefreshCw size={14} /><span>Versi baru Yuki sudah siap.</span><button onClick={() => window.location.reload()}>Muat ulang</button></div>}
    {!session && <Onboarding onReady={ready} />}
    <section className="chat-panel">
      <header className="chat-header">
        <div className="monogram">Y</div>
        <div className="identity">
          <strong>Yuki</strong>
          <span><i className={`connection-dot ${connection}`} /> {connectionLabel[connection]}</span>
        </div>
        <div className="header-actions">
          <a href="/docs" target="_blank" aria-label="Dokumentasi"><BookOpen size={17} /></a>
          <button onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Pengaturan"><Settings size={17} /></button>
        </div>
        {settingsOpen && <div className="settings-card">
          <button onClick={() => { setSkillsModalOpen(true); setSettingsOpen(false) }}><Wrench size={15} /><span><b>Katalog Skills Yuki Agent</b><small>{skills.length || 14} skills aktif</small></span></button>
          <button onClick={() => { setBookmarksOpen(true); setSettingsOpen(false) }}><Bookmark size={15} /><span><b>Komik tersimpan</b><small>{bookmarks.length} judul tersimpan</small></span></button>
          <button onClick={() => { setTimelineOpen(true); setSettingsOpen(false) }}><Heart size={15} /><span><b>Perjalanan hubungan</b><small>{milestones.length} momen tersimpan</small></span></button>
          {installPrompt && <button onClick={installApp}><Download size={15} /><span><b>Pasang aplikasi Yuki</b><small>Tambahkan ke layar utama</small></span></button>}
          <button onClick={() => window.open('/privacy', '_blank', 'noopener')}><BookOpen size={15} /><span><b>Privasi pengguna</b><small>Data yang disimpan dan kontrolmu</small></span></button>
          <button onClick={() => navigator.clipboard.writeText(session?.accessCode || '')}><Copy size={15} /><span><b>Salin kunci ingatan</b><small>{session?.accessCode || 'Belum tersedia'}</small></span></button>
          <button className="danger" onClick={reset}><RotateCcw size={15} /><span><b>Mulai hubungan baru</b><small>Hapus sesi dari perangkat ini</small></span></button>
          <button className="danger" onClick={removeAccount}><X size={15} /><span><b>Hapus seluruh data</b><small>Permanen dari server Yuki</small></span></button>
        </div>}
      </header>

      {/* Mode Switcher Bar */}
      <div className="mode-switcher-bar">
        <div className="mode-switcher-pill" role="tablist">
          <button
            type="button"
            className={`mode-btn ${chatMode === 'companion' ? 'active' : ''}`}
            onClick={() => setChatMode('companion')}
          >
            <MessageSquare size={13} />
            <span>Teman Ngobrol</span>
          </button>
          <button
            type="button"
            className={`mode-btn agent-btn ${chatMode === 'agent' ? 'active' : ''}`}
            onClick={() => setChatMode('agent')}
          >
            <Zap size={13} />
            <span>Yuki Agent</span>
          </button>
        </div>

        {chatMode === 'agent' && (
          <button
            type="button"
            className="skills-catalog-pill"
            onClick={() => setSkillsModalOpen(true)}
            title="Lihat seluruh Skills aktif Yuki Agent"
          >
            <Wrench size={12} />
            <span>{skills.length || 14} Skills</span>
          </button>
        )}
      </div>

      {skillsModalOpen && (
        <SkillsCatalogModal skills={skills} onClose={() => setSkillsModalOpen(false)} />
      )}

      {selectedArtifact && (
        <CodexArtifactModal artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
      )}

      {timelineOpen && <div className="timeline-overlay" onClick={() => setTimelineOpen(false)}><section className="timeline-card" onClick={event => event.stopPropagation()}>
        <header><div><small>Relationship archive</small><h2>Perjalanan kalian</h2></div><button onClick={() => setTimelineOpen(false)}><X size={17}/></button></header>
        <div className="timeline-list">{milestones.map((item, index) => <article key={`${item.kind}-${index}`}><i/><div><strong>{item.title}</strong><span>{item.detail || `Terbuka pada bond ${Math.round(item.bondValue)}`}</span></div></article>)}</div>
      </section></div>}

      {bookmarksOpen && <div className="timeline-overlay" onClick={() => setBookmarksOpen(false)}><section className="timeline-card bookmarks-modal" onClick={event => event.stopPropagation()}>
        <header><div><small>Ryukomik archive</small><h2>Komik Tersimpan</h2></div><button onClick={() => setBookmarksOpen(false)}><X size={17}/></button></header>
        <div className="bookmarks-list">
          {bookmarks.length === 0 && <div className="empty-bookmarks"><span>01</span><h3>Belum ada komik tersimpan.</h3><p>Tekan tombol bookmark pada kartu komik di chat untuk menyimpan ke daftar bacaanmu.</p></div>}
          {bookmarks.map((comic) => <div className="bookmark-item" key={comic.url}>
            <div className="bookmark-cover">
              {comic.image ? <img src={comic.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <BookOpen size={16} />}
            </div>
            <div className="bookmark-info">
              <div className="bookmark-title-row">
                {comic.format && <span className="comic-format-tag">{comic.format}</span>}
                <strong>{comic.title}</strong>
              </div>
              <span>{[comic.type, comic.chapter, comic.score ? `★ ${comic.score}` : ''].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="bookmark-actions">
              <a className="comic-open" href={comic.url} target="_blank" rel="noreferrer">BACA</a>
              <button type="button" className="bookmark-delete" onClick={() => removeBookmark(comic.url).then(d => setBookmarks(d.bookmarks || []))} aria-label="Hapus dari daftar simpan"><X size={13} /></button>
            </div>
          </div>)}
        </div>
      </section></div>}

      <div className="messages" aria-live="polite">
        {messages.length === 0 && <div className="empty-state">
          <span>01</span>
          <h2>{chatMode === 'agent' ? 'Yuki Agent siap mengeksekusi.' : 'Yuki menunggumu bicara.'}</h2>
          <p>{chatMode === 'agent'
            ? 'Minta Yuki merakit web mini-game interaktif, riset web, eksekusi kode, atau mengelola tugas.'
            : 'Mulai dari hal sederhana. Jangan berharap dia langsung ramah.'}</p>
        </div>}
        {messages.map((message, index) => <article className={`message ${message.role} ${message.mode === 'agent' ? 'agent-msg' : ''}`} key={`${index}-${message.content.slice(0, 12)}`}>
          {message.role === 'assistant' && (
            <div className="message-avatar">
              {message.mode === 'agent' ? <Zap size={13} /> : 'Y'}
            </div>
          )}
          <div className="message-content">
            <MessageBody
              message={message}
              bookmarks={bookmarks}
              onToggleBookmark={handleToggleBookmark}
              onOpenArtifact={art => setSelectedArtifact(art)}
            />
          </div>
          {message.role === 'assistant' && (
            <div className="message-tools">
              <button
                className={feedback[index] === 1 ? 'selected' : ''}
                onClick={() => rateMessage(index, message, 1)}
                aria-label="Balasan cocok"
                title="Suka balasan ini"
              >
                <ThumbsUp size={12}/>
              </button>
              <button
                className={feedback[index] === -1 ? 'selected negative' : ''}
                onClick={() => rateMessage(index, message, -1)}
                aria-label="Balasan kurang cocok"
                title="Kurang suka balasan ini"
              >
                <ThumbsDown size={12}/>
              </button>
            </div>
          )}
        </article>)}
        {busy && (
          chatMode === 'agent' ? (
            <LiveAgentWorkingBubble />
          ) : (
            <>
              <div className={`request-status ${connection}`}>
                {connection === 'slow' || connection === 'retrying' ? <RefreshCw className="spin" size={12} /> : <LoaderCircle className="spin" size={12} />}
                <span>{connectionLabel[connection]}</span>
              </div>
              <article className="message assistant">
                <div className="message-avatar">Y</div>
                <div className="message-content typing"><i/><i/><i/></div>
              </article>
            </>
          )
        )}
        {connection === 'offline' && !busy && <div className="request-status offline"><WifiOff size={12}/><span>Kamu offline. Pesan yang belum dikirim tetap aman.</span></div>}
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={14}/></button></div>}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <span className="composer-index">
          {chatMode === 'agent' ? <Zap size={12} /> : '01'}
        </span>
        <textarea
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={() => setAvatarCompact(true)}
          placeholder={chatMode === 'agent' ? 'Tulis tugas untuk Yuki Agent…' : 'Tulis pesan untuk Yuki…'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
        />
        <button disabled={busy || !input.trim()} aria-label="Kirim pesan">{busy ? <LoaderCircle className="spin" size={19}/> : <Send size={19}/>}</button>
      </form>
      <div className="activities" aria-label="Aktivitas bersama">
        {(chatMode === 'agent' ? agentSuggestions : companionSuggestions).map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => setInput(item.text)}
              title={item.text}
            >
              <Icon size={12} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
    </section>

    <aside className="character-panel">
      <div className="panel-meta">
        <span>Character viewport</span>
        <b>{chatMode === 'agent' ? <span className="agent-meta-badge"><Zap size={10} /> Yuki Agent Active</span> : 'Session active'}</b>
      </div>
      <div className="character-frame">
        <div className="frame-code">{chatMode === 'agent' ? 'AGENT / 001' : 'LIVE / 001'}</div>
        <div className="mobile-bond" aria-label={`Bond ${Math.round(bondValue)} dari 100`}><span>{bond}</span><b>{Math.round(bondValue)}</b><i><u style={{ width: `${Math.max(2, bondValue)}%` }} /></i></div>
        <button className="avatar-toggle" type="button" onClick={() => setAvatarCompact(value => !value)}
          aria-label={avatarCompact ? 'Perbesar avatar Yuki' : 'Kecilkan avatar Yuki'} aria-expanded={!avatarCompact}>
          {avatarCompact ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <div className="grid" />
        <div className="character-glow" />
        <img key={avatarExpression} className="character" src={avatar} alt={`Yuki sedang ${mood}`} onError={event => { if (!event.currentTarget.src.endsWith('/tenang.png')) event.currentTarget.src = '/expressions/tenang.png' }} />
        <div className="character-footer">
          <div><strong>Yuki</strong><span className="online-dot" /></div>
          <div className="mood-pill"><span>{mood}</span><i /> <span>{bond}</span></div>
        </div>
      </div>
      <div className="status-strip"><span>Bond</span><div><i style={{ width: `${Math.max(2, bondValue)}%` }} /></div><b>{Math.round(bondValue)}/100</b></div>
      <p className="feeling">“{feeling}”</p>
    </aside>
  </main>
}
