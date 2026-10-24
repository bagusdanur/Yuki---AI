import { useEffect, useRef, useState } from 'react'
import { X as XIcon, RotateCcw, LoaderCircle } from 'lucide-react'

/**
 * Papan Tic-Tac-Toe (beta v4).
 *
 * Aturan & langkah Yuki dihitung server (minimax) — bukan model bahasa, supaya
 * tidak mungkin curang atau lupa giliran. Yang dibuat model hanyalah KOMENTAR
 * Yuki, karena kalimat template selalu sama dan terasa seperti bot.
 */

interface GameState {
  board: string[]
  turn: 'X' | 'O'
  status: 'playing' | 'user_win' | 'yuki_win' | 'draw'
  winnerLine: number[] | null
  moves: number
}

interface Props {
  token: string
  onClose: () => void
  onMood?: (mood: string) => void
}

const WAJAH: Record<string, string> = {
  playing: 'tenang',
  user_win: 'malu',
  yuki_win: 'senang',
  draw: 'tenang'
}

// Hanya dipakai kalau model tidak menjawab dalam 4,5 detik. Sengaja beberapa
// variasi agar tidak terasa diulang-ulang.
const CADANGAN = [
  'Hmph. Lanjut.',
  'Coba pikir dulu sebelum menaruh.',
  'Itu langkah yang berani. Sayangnya belum cukup.',
  'Kamu lumayan juga, ternyata.'
]

export default function TicTacToe({ token, onClose, onMood }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [stats, setStats] = useState({ wins: 0, losses: 0, draws: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [line, setLine] = useState('')
  const [lineBusy, setLineBusy] = useState(false)
  // Papan dikunci setelah pemain melangkah sampai Yuki menjawab: setiap langkah
  // harus menunggu reaksinya dulu, tidak boleh lanjut sendiri.
  const [menunggu, setMenunggu] = useState(false)
  const riwayat = useRef<string[]>([])
  const terakhir = useRef<string>('')

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

  /** Komentar Yuki dibuat model; kalau lambat/gagal, pakai cadangan lokal. */
  const mintaKomentar = async (event: 'start' | 'move' | 'result', result?: string, moveCount?: number) => {
    const kunci = `${event}:${result || ''}:${moveCount || 0}`
    if (kunci === terakhir.current) return
    terakhir.current = kunci
    setLineBusy(true)
    try {
      const data = await call('/api/game/ttt/line', {
        event, result, moveCount, avoid: riwayat.current.slice(-3)
      })
      const teks = String(data?.line || '').trim()
      if (teks) {
        riwayat.current = [...riwayat.current, teks].slice(-6)
        setLine(teks)
      } else {
        setLine(CADANGAN[Math.floor(Math.random() * CADANGAN.length)])
      }
    } catch {
      setLine(CADANGAN[Math.floor(Math.random() * CADANGAN.length)])
    } finally {
      setLineBusy(false)
    }
  }

  const terapkan = (state: GameState, mode: 'start' | 'move' | 'result') => {
    setGame(state)
    onMood?.(WAJAH[state.status] || 'tenang')
    if (state.status === 'playing') mintaKomentar(mode, undefined, state.moves)
    else mintaKomentar('result', state.status, state.moves)
  }

  useEffect(() => {
    let hidup = true
    ;(async () => {
      try {
        const data = await call('/api/game/ttt')
        if (!hidup) return
        if (data.game) {
          setGame(data.game)
          setStats(data.stats || { wins: 0, losses: 0, draws: 0 })
          onMood?.(WAJAH[data.game.status] || 'tenang')
          mintaKomentar(data.game.status === 'playing' ? 'start' : 'result', data.game.status, data.game.moves)
        } else {
          const baru = await call('/api/game/ttt/new', {})
          if (!hidup) return
          setStats(baru.stats || { wins: 0, losses: 0, draws: 0 })
          terapkan(baru.game, 'start')
        }
      } catch (e) { if (hidup) setError(e instanceof Error ? e.message : 'Gagal memuat.') }
      finally { if (hidup) setLoading(false) }
    })()
    return () => { hidup = false }
  }, [])

  const langkah = async (cell: number) => {
    if (!game || game.status !== 'playing' || game.turn !== 'X' || game.board[cell] || menunggu) return
    setError('')
    setMenunggu(true)
    const sebelum = game
    // tampilkan langkah pemain segera; server tetap penentu akhir
    setGame({ ...game, board: game.board.map((v, i) => (i === cell ? 'X' : v)), turn: 'O' })
    try {
      const data = await call('/api/game/ttt/move', { cell })
      setStats(data.stats || stats)
      setGame(data.game)
      onMood?.(WAJAH[data.game.status] || 'tenang')
      // Tunggu kalimat Yuki selesai dulu, baru papan dibuka kembali.
      await mintaKomentar(data.game.status === 'playing' ? 'move' : 'result', data.game.status, data.game.moves)
    } catch (e) {
      setGame(sebelum)
      setError(e instanceof Error ? e.message : 'Langkah gagal.')
    } finally {
      setMenunggu(false)
    }
  }

  const mulaiUlang = async () => {
    setLoading(true); setError('')
    try {
      const data = await call('/api/game/ttt/new', {})
      setStats(data.stats || stats)
      terapkan(data.game, 'start')
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memulai.') }
    finally { setLoading(false) }
  }

  const selesai = Boolean(game && game.status !== 'playing')

  return (
    <section className="ttt-dock" aria-label="Tic-Tac-Toe melawan Yuki">
      <div className="ttt-card">
        <header>
          <div className="ttt-title">
            <small>Beta v4 · main bareng Yuki</small>
            <h2>Tic-Tac-Toe <span className={`ttt-status ${game?.status || ''}`}>
              {game?.status === 'user_win' ? 'kamu menang'
                : game?.status === 'yuki_win' ? 'Yuki menang'
                : game?.status === 'draw' ? 'seri'
                : menunggu ? 'Yuki menjawab…'
                : game?.turn === 'X' ? 'giliranmu' : 'Yuki jalan'}
            </span></h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup"><XIcon size={16} /></button>
        </header>

        <div className="ttt-board" aria-live="polite">
          {(game?.board || Array(9).fill('')).map((isi, i) => {
            const menang = game?.winnerLine?.includes(i)
            return (
              <button
                key={i}
                type="button"
                className={`ttt-cell${isi ? ' terisi' : ''}${menang ? ' menang' : ''}${isi === 'O' ? ' yuki' : ''}`}
                onClick={() => langkah(i)}
                disabled={!game || game.status !== 'playing' || game.turn !== 'X' || Boolean(isi) || menunggu}
                aria-label={`Kotak ${i + 1}${isi ? `, ${isi === 'O' ? 'Yuki' : 'kamu'}` : ', kosong'}`}
              >
                {isi || ''}
              </button>
            )
          })}
        </div>

        {/* Balasan Yuki ditampilkan seperti gelembung chat, bukan teks statis:
            supaya jelas ini Yuki yang bicara, dan kalimatnya berubah tiap langkah. */}
        <div className={`ttt-bubble${lineBusy ? ' ngetik' : ''}`} aria-live="polite">
          <p>
            {error ? error
              : lineBusy && !line ? <span className="ttt-dots"><i /><i /><i /></span>
              : line || 'Yuki memperhatikan papannya…'}
          </p>
        </div>

        <div className="ttt-actions">
          <span className="ttt-score">{stats.wins} menang · {stats.draws} seri · {stats.losses} kalah</span>
          <button type="button" className={selesai ? 'ttt-primary' : 'ttt-ghost'} onClick={mulaiUlang} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
            {selesai ? 'Main lagi' : 'Ulang'}
          </button>
        </div>
      </div>
    </section>
  )
}
