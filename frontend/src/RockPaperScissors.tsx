import { useEffect, useState } from 'react'
import { X as XIcon, RotateCcw, LoaderCircle } from 'lucide-react'

/**
 * Batu-Kertas-Gunting (beta v4).
 *
 * Pilihan Yuki datang dari model (dia boleh membaca pola langkahmu), sedangkan
 * penilaian menang/seri dihitung kode — jadi hasilnya tidak pernah salah.
 */

interface State {
  score: { you: number; yuki: number }
  round: number
  history: { you: string; yuki: string; hasil: string }[]
}

interface Props {
  token: string
  onClose: () => void
  onMood?: (mood: string) => void
}

const PILIHAN = [
  { id: 'batu', emoji: '🪨', label: 'Batu' },
  { id: 'kertas', emoji: '📄', label: 'Kertas' },
  { id: 'gunting', emoji: '✂️', label: 'Gunting' }
] as const

const EMOJI: Record<string, string> = { batu: '🪨', kertas: '📄', gunting: '✂️' }
const NAMA: Record<string, string> = { batu: 'Batu', kertas: 'Kertas', gunting: 'Gunting' }

const WAJAH: Record<string, string> = { user_win: 'malu', yuki_win: 'senang', draw: 'tenang' }

const CADANGAN = ['Hmph. Lagi.', 'Kamu kebaca, tahu.', 'Sekali lagi, biar adil.']

export default function RockPaperScissors({ token, onClose, onMood }: Props) {
  const [state, setState] = useState<State | null>(null)
  const [stats, setStats] = useState({ wins: 0, losses: 0, draws: 0 })
  const [hasil, setHasil] = useState<{ you: string; yuki: string; hasil: string } | null>(null)
  const [line, setLine] = useState('')
  const [menunggu, setMenunggu] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Gagal menghubungi permainan.')
    return data
  }

  useEffect(() => {
    let hidup = true
    ;(async () => {
      try {
        const data = await call('/api/game/rps')
        if (!hidup) return
        if (data.game?.score) setState(data.game)
        setStats(data.stats || { wins: 0, losses: 0, draws: 0 })
      } catch (e) { if (hidup) setError(e instanceof Error ? e.message : 'Gagal memuat.') }
      finally { if (hidup) setLoading(false) }
    })()
    return () => { hidup = false }
  }, [])

  const main = async (choice: string) => {
    if (menunggu) return
    setError(''); setMenunggu(true); setHasil(null)
    try {
      const data = await call('/api/game/rps/play', { choice })
      setState(data.state)
      setStats(data.stats || stats)
      setHasil({ you: data.you, yuki: data.yuki, hasil: data.hasil })
      setLine(String(data.line || CADANGAN[Math.floor(Math.random() * CADANGAN.length)]))
      onMood?.(WAJAH[data.hasil] || 'tenang')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal bermain.')
    } finally { setMenunggu(false) }
  }

  const ulang = async () => {
    setLoading(true); setError('')
    try {
      const data = await call('/api/game/rps/reset', {})
      setState(data.game); setStats(data.stats || stats); setHasil(null); setLine('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal mengulang.') }
    finally { setLoading(false) }
  }

  const teks = !hasil ? ''
    : hasil.hasil === 'draw' ? 'Seri.'
    : hasil.hasil === 'user_win' ? 'Kamu menang.'
    : 'Yuki menang.'

  return (
    <section className="ttt-dock" aria-label="Batu-kertas-gunting melawan Yuki">
      <div className={`ttt-card${menunggu ? ' menunggu' : ''}`}>
        <header>
          <div className="ttt-title">
            <small>Beta v4 · main bareng Yuki</small>
            <h2>
              Batu-Kertas-Gunting
              <span className="ttt-status">{state?.round ? `ronde ${state.round + 1}` : 'ronde 1'}</span>
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup"><XIcon size={16} /></button>
        </header>

        <div className="rps-papan">
          {PILIHAN.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rps-pilih${hasil?.you === p.id ? ' dipilih' : ''}`}
              onClick={() => main(p.id)}
              disabled={menunggu || loading}
              aria-label={p.label}
            >
              <span aria-hidden="true">{p.emoji}</span>
              <b>{p.label}</b>
            </button>
          ))}
        </div>

        <div className="rps-hasil" aria-live="polite">
          {menunggu ? (
            <span className="rps-tunggu">Yuki memilih <span className="ttt-dots"><i /><i /><i /></span></span>
          ) : hasil ? (
            <>
              <span className="rps-orang">Kamu <b>{NAMA[hasil.you]}</b> <i aria-hidden="true">{EMOJI[hasil.you]}</i></span>
              <em>vs</em>
              <span className="rps-orang">Yuki <b>{NAMA[hasil.yuki]}</b> <i aria-hidden="true">{EMOJI[hasil.yuki]}</i></span>
              <b className={`rps-putusan ${hasil.hasil}`}>{teks}</b>
            </>
          ) : (
            <span className="rps-tunggu">Pilih satu, aku sudah siap.</span>
          )}
        </div>

        <div className={`ttt-bubble${menunggu ? ' ngetik' : ''}`} aria-live="polite">
          <p>{error ? error : menunggu ? <span className="ttt-dots"><i /><i /><i /></span> : line || 'Hmph, berani juga.'}</p>
        </div>

        <div className="ttt-actions">
          <span className="ttt-score">kamu {state?.score?.you ?? 0} · Yuki {state?.score?.yuki ?? 0}</span>
          <button type="button" className="ttt-ghost" onClick={ulang} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />} Ulang
          </button>
        </div>
      </div>
    </section>
  )
}
