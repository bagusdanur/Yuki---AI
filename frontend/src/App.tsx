import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Copy, Download, Heart, KeyRound, LoaderCircle, RefreshCw, RotateCcw, Send, Settings, Sparkles, ThumbsDown, ThumbsUp, Volume2, WifiOff, X } from 'lucide-react'
import { getRelationship, register, restore, sendChat, sendFeedback, speak } from './api'
import type { ComicRecommendation, Message, Milestone, Session } from './types'

const SESSION_KEYS = {
  userId: 'yuki_uid_v3', username: 'yuki_username_v3', accessCode: 'yuki_access_code_v3',
  bond: 'yuki_bond_v3', bondValue: 'yuki_bond_value_v3', mood: 'yuki_mood_v3', feeling: 'yuki_feeling_v3',
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
  }
}

function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEYS.userId, session.userId)
  localStorage.setItem(SESSION_KEYS.username, session.username)
  localStorage.setItem(SESSION_KEYS.accessCode, session.accessCode)
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
    } catch { /* abaikan markup lama yang tidak valid */ }
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

function ComicCard({ comic }: { comic: ComicRecommendation }) {
  const meta = [comic.type, comic.chapter, comic.score ? `★ ${comic.score}` : ''].filter(Boolean).join(' · ')
  return <a className="comic-card" href={comic.url} target="_blank" rel="noreferrer">
    <div className="comic-cover">
      {comic.image ? <img src={comic.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <BookOpen size={20} />}
    </div>
    <div className="comic-details"><strong>{comic.title}</strong><span>{meta || 'Baca di Ryukomik'}</span></div>
    <span className="comic-open">BACA</span>
  </a>
}

function MessageBody({ message }: { message: Message }) {
  const legacy = legacyComics(message.content)
  const comics = message.comics?.length ? message.comics : legacy.comics
  const text = cleanComicText(message.comics?.length ? message.content : legacy.clean, comics)
  const parts = text.split(/(\*[^*\n]{2,100}\*)/g).filter(Boolean)
  return <>
    {parts.map((part, index) => part.startsWith('*') && part.endsWith('*')
      ? <em className="action" key={index}>{part.slice(1, -1).trim()}</em>
      : <span key={index}>{part.replace(/^\s*\*\s*$/gm, '')}</span>)}
    {comics.length > 0 && <div className="comic-list">{comics.map(comic => <ComicCard comic={comic} key={comic.url} />)}</div>}
  </>
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
        onReady({ userId: data.userId, username: value.trim(), accessCode: data.accessCode }, introduction, 0, data.milestones)
      } else {
        const code = value.trim().toUpperCase()
        const data = await restore(code)
        onReady({ userId: data.userId, username: data.username, accessCode: code }, data.history || [], data.bondValue, data.milestones)
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [avatarCompact, setAvatarCompact] = useState(false)
  const [blinking, setBlinking] = useState(false)
  const [connection, setConnection] = useState<ConnectionState>(() => navigator.onLine ? 'idle' : 'offline')
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [feedback, setFeedback] = useState<Record<number, 1 | -1>>({})
  const endRef = useRef<HTMLDivElement>(null)
  const currentAudio = useRef<HTMLAudioElement | null>(null)
  const requestTimers = useRef<number[]>([])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])
  useEffect(() => { if (session) localStorage.setItem(historyKey(session.userId), JSON.stringify(messages.slice(-40))) }, [messages, session])
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
    if (!session) return
    getRelationship(session.userId).then(data => {
      setMilestones(data.milestones || [])
      setBond(data.bond); setBondValue(data.bondValue)
    }).catch(() => {})
  }, [session?.userId])

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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy || !session) return
    navigator.vibrate?.(10)
    const next: Message[] = [...messages, { role: 'user', content }]
    setMessages(next); setInput(''); setBusy(true); setError(''); setConnection('thinking')
    requestTimers.current.forEach(window.clearTimeout)
    requestTimers.current = [
      window.setTimeout(() => setConnection('slow'), 8_000),
      window.setTimeout(() => setConnection('retrying'), 22_000)
    ]
    let failed = false
    try {
      const result = await sendChat(session.userId, next)
      if (!result.reply?.trim()) throw new Error('Yuki mengirim balasan kosong. Coba lagi.')
      setMessages([...next, { role: 'assistant', content: result.reply, comics: result.comics || [], messageId: result.messageId }])
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
      if (document.hidden || !navigator.onLine) return
      setBusy(true); setConnection('thinking')
      try {
        const result = await sendChat(session.userId, messages, true)
        if (result.reply?.trim()) {
          setMessages(current => [...current, { role: 'assistant', content: result.reply, messageId: result.messageId }])
          setMood(result.mood || 'tenang'); setFeeling(result.feeling || feeling)
          if (result.milestones) setMilestones(result.milestones)
        }
      } catch { /* sapaan idle tidak boleh mengganggu chat utama */ }
      finally { setBusy(false); setConnection(navigator.onLine ? 'idle' : 'offline') }
    }, 120_000)
    return () => window.clearTimeout(timer)
  }, [messages, session, busy])

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
    setSession(null); setMessages([]); setSettingsOpen(false)
  }

  return <main className={`app-shell${avatarCompact ? ' avatar-compact' : ''}`}>
    {updateReady && <div className="pwa-update"><RefreshCw size={14} /><span>Versi baru Yuki sudah siap.</span><button onClick={() => window.location.reload()}>Muat ulang</button></div>}
    {!session && <Onboarding onReady={ready} />}
    <section className="chat-panel">
      <header className="chat-header">
        <div className="monogram">Y</div>
        <div className="identity"><strong>Yuki</strong><span><i className={`connection-dot ${connection}`} /> {connectionLabel[connection]}</span></div>
        <div className="header-actions">
          <a href="/docs" target="_blank" aria-label="Dokumentasi"><BookOpen size={17} /></a>
          <button onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Pengaturan"><Settings size={17} /></button>
        </div>
        {settingsOpen && <div className="settings-card">
          <button onClick={() => { setTimelineOpen(true); setSettingsOpen(false) }}><Heart size={15} /><span><b>Perjalanan hubungan</b><small>{milestones.length} momen tersimpan</small></span></button>
          {installPrompt && <button onClick={installApp}><Download size={15} /><span><b>Pasang aplikasi Yuki</b><small>Tambahkan ke layar utama</small></span></button>}
          <button onClick={() => navigator.clipboard.writeText(session?.accessCode || '')}><Copy size={15} /><span><b>Salin kunci ingatan</b><small>{session?.accessCode || 'Belum tersedia'}</small></span></button>
          <button className="danger" onClick={reset}><RotateCcw size={15} /><span><b>Mulai hubungan baru</b><small>Hapus sesi dari perangkat ini</small></span></button>
        </div>}
      </header>

      {timelineOpen && <div className="timeline-overlay" onClick={() => setTimelineOpen(false)}><section className="timeline-card" onClick={event => event.stopPropagation()}>
        <header><div><small>Relationship archive</small><h2>Perjalanan kalian</h2></div><button onClick={() => setTimelineOpen(false)}><X size={17}/></button></header>
        <div className="timeline-list">{milestones.map((item, index) => <article key={`${item.kind}-${index}`}><i/><div><strong>{item.title}</strong><span>{item.detail || `Terbuka pada bond ${Math.round(item.bondValue)}`}</span></div></article>)}</div>
      </section></div>}

      <div className="messages" aria-live="polite">
        {messages.length === 0 && <div className="empty-state"><span>01</span><h2>Yuki menunggumu bicara.</h2><p>Mulai dari hal sederhana. Jangan berharap dia langsung ramah.</p></div>}
        {messages.map((message, index) => <article className={`message ${message.role}`} key={`${index}-${message.content.slice(0, 12)}`}>
          {message.role === 'assistant' && <div className="message-avatar">Y</div>}
          <div className="message-content"><MessageBody message={message} /></div>
          {message.role === 'assistant' && <div className="message-tools"><button className={`speak ${speakingIndex === index ? 'active' : ''}`} onClick={() => play(message.content, index)} aria-label="Putar suara"><Volume2 size={14} /></button><button className={feedback[index] === 1 ? 'selected' : ''} onClick={() => rateMessage(index, message, 1)} aria-label="Balasan cocok"><ThumbsUp size={12}/></button><button className={feedback[index] === -1 ? 'selected negative' : ''} onClick={() => rateMessage(index, message, -1)} aria-label="Balasan kurang cocok"><ThumbsDown size={12}/></button></div>}
        </article>)}
        {busy && <><div className={`request-status ${connection}`}>{connection === 'slow' || connection === 'retrying' ? <RefreshCw className="spin" size={12} /> : <LoaderCircle className="spin" size={12} />}<span>{connectionLabel[connection]}</span></div><article className="message assistant"><div className="message-avatar">Y</div><div className="message-content typing"><i/><i/><i/></div></article></>}
        {connection === 'offline' && !busy && <div className="request-status offline"><WifiOff size={12}/><span>Kamu offline. Pesan yang belum dikirim tetap aman.</span></div>}
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={14}/></button></div>}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <span className="composer-index">01</span>
        <textarea rows={1} value={input} onChange={e => setInput(e.target.value)} onFocus={() => setAvatarCompact(true)} placeholder="Tulis pesan untuk Yuki…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <button disabled={busy || !input.trim()} aria-label="Kirim pesan">{busy ? <LoaderCircle className="spin" size={19}/> : <Send size={19}/>}</button>
      </form>
      <div className="activities" aria-label="Aktivitas bersama"><Sparkles size={12}/>{['Cari komik bareng', 'Pertanyaan hari ini', 'Kuis anime singkat', 'Bahas daftar favorit kita'].map(label => <button key={label} onClick={() => setInput(label)}>{label}</button>)}</div>
    </section>

    <aside className="character-panel">
      <div className="panel-meta"><span>Character viewport</span><b>Session active</b></div>
      <div className="character-frame">
        <div className="frame-code">LIVE / 001</div>
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
