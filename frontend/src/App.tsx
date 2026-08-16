import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Copy, KeyRound, LoaderCircle, RotateCcw, Send, Settings, Volume2, X } from 'lucide-react'
import { register, restore, sendChat, speak } from './api'
import type { Message, Session } from './types'

const SESSION_KEYS = {
  userId: 'yuki_uid_v3', username: 'yuki_username_v3', accessCode: 'yuki_access_code_v3',
}

const moodImage: Record<string, string> = {
  tenang: 'tenang', senang: 'senang', ceria: 'senang', malu: 'malu',
  'sayang/manja': 'senang', sedih: 'sedih', kesal: 'kesal', cemas: 'lesu',
  kecewa: 'sedih', lesu: 'lesu', cemburu: 'kesal',
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

function MessageBody({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean)
  return <>{parts.map((part, index) => part.startsWith('*') && part.endsWith('*')
    ? <em className="action" key={index}>{part.slice(1, -1)}</em>
    : <span key={index}>{part}</span>)}</>
}

function Onboarding({ onReady }: { onReady: (session: Session, history?: Message[]) => void }) {
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
        onReady({ userId: data.userId, username: value.trim(), accessCode: data.accessCode })
      } else {
        const code = value.trim().toUpperCase()
        const data = await restore(code)
        onReady({ userId: data.userId, username: data.username, accessCode: code }, data.history || [])
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
  const [mood, setMood] = useState('tenang')
  const [bond, setBond] = useState('orang asing')
  const [bondValue, setBondValue] = useState(0)
  const [feeling, setFeeling] = useState('Lagi kalem, jawab seperlunya.')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const currentAudio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])
  useEffect(() => { if (session) localStorage.setItem(historyKey(session.userId), JSON.stringify(messages.slice(-40))) }, [messages, session])

  const avatar = useMemo(() => `/expressions/${moodImage[mood] || 'tenang'}.png`, [mood])

  function ready(next: Session, restored: Message[] = []) {
    saveSession(next); setSession(next); setMessages(restored); setError('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy || !session) return
    const next: Message[] = [...messages, { role: 'user', content }]
    setMessages(next); setInput(''); setBusy(true); setError('')
    try {
      const result = await sendChat(session.userId, next)
      if (!result.reply?.trim()) throw new Error('Yuki mengirim balasan kosong. Coba lagi.')
      setMessages([...next, { role: 'assistant', content: result.reply }])
      setMood(result.mood || 'tenang'); setBond(result.bond || bond)
      setBondValue(result.bondValue || 0); setFeeling(result.feeling || feeling)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Yuki sedang tidak bisa menjawab') }
    finally { setBusy(false) }
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

  return <main className="app-shell">
    {!session && <Onboarding onReady={ready} />}
    <section className="chat-panel">
      <header className="chat-header">
        <div className="monogram">Y</div>
        <div className="identity"><strong>Yuki</strong><span><i /> character chat / online</span></div>
        <div className="header-actions">
          <a href="/docs" target="_blank" aria-label="Dokumentasi"><BookOpen size={17} /></a>
          <button onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Pengaturan"><Settings size={17} /></button>
        </div>
        {settingsOpen && <div className="settings-card">
          <button onClick={() => navigator.clipboard.writeText(session?.accessCode || '')}><Copy size={15} /><span><b>Salin kunci ingatan</b><small>{session?.accessCode || 'Belum tersedia'}</small></span></button>
          <button className="danger" onClick={reset}><RotateCcw size={15} /><span><b>Mulai hubungan baru</b><small>Hapus sesi dari perangkat ini</small></span></button>
        </div>}
      </header>

      <div className="messages" aria-live="polite">
        {messages.length === 0 && <div className="empty-state"><span>01</span><h2>Yuki menunggumu bicara.</h2><p>Mulai dari hal sederhana. Jangan berharap dia langsung ramah.</p></div>}
        {messages.map((message, index) => <article className={`message ${message.role}`} key={`${index}-${message.content.slice(0, 12)}`}>
          {message.role === 'assistant' && <div className="message-avatar">Y</div>}
          <div className="message-content"><MessageBody text={message.content} /></div>
          {message.role === 'assistant' && <button className={`speak ${speakingIndex === index ? 'active' : ''}`} onClick={() => play(message.content, index)} aria-label="Putar suara"><Volume2 size={14} /></button>}
        </article>)}
        {busy && <article className="message assistant"><div className="message-avatar">Y</div><div className="message-content typing"><i/><i/><i/></div></article>}
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={14}/></button></div>}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <span className="composer-index">01</span>
        <textarea rows={1} value={input} onChange={e => setInput(e.target.value)} placeholder="Tulis pesan untuk Yuki…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <button disabled={busy || !input.trim()} aria-label="Kirim pesan">{busy ? <LoaderCircle className="spin" size={19}/> : <Send size={19}/>}</button>
      </form>
    </section>

    <aside className="character-panel">
      <div className="panel-meta"><span>Character viewport</span><b>Session active</b></div>
      <div className="character-frame">
        <div className="frame-code">LIVE / 001</div>
        <div className="grid" />
        <div className="character-glow" />
        <img className="character" src={avatar} alt="Yuki" onError={event => { if (!event.currentTarget.src.endsWith('/tenang.png')) event.currentTarget.src = '/expressions/tenang.png' }} />
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
