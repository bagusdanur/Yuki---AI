import { useEffect, useState } from 'react'
import { X as XIcon, RotateCcw, LoaderCircle } from 'lucide-react'

/**
 * Kartu Tic-Tac-Toe (beta v4).
 *
 * Papan dihitung server (minimax), bukan model bahasa — komponen ini hanya
 * menampilkan state dan mengirim langkah. Skor & sesi disimpan di server,
 * jadi menutup kartu tidak menghapus permainan yang sedang berjalan.
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
  /** Dipakai supaya ekspresi Yuki di panel karakter ikut bereaksi. */
  onMood?: (mood: string) => void
}

// Wajah kecil di dalam panel: pemain bisa lihat reaksi Yuki tanpa kehilangan
// panel karakter utama (dulu kartunya berupa overlay penuh yang menutup Yuki).
const WAJAH: Record<string, string> = {
  playing: 'tenang',
  user_win: 'malu',
  yuki_win: 'senang',
  draw: 'tenang'
}

const KOMENTAR: Record<string, string[]> = {
  playing: ['Hmph, giliranmu. Jangan lama-lama mikir.', 'Coba lagi kalau berani.', 'Jangan salah langkah.'],
  user_win: ['…bagus juga. Jangan besar kepala dulu.', 'Kali ini kamu menang. Aku lengah, bukan kalah.'],
  yuki_win: ['Hmph, sudah kubilang. Mau lagi?', 'Sudah selesai. Jangan ngambek.'],
  draw: ['Seri. Setidaknya kamu tidak kalah.', 'Tidak ada yang menang. Aneh, aku biasanya menang.']
}

export default function TicTacToe({ token, onClose, onMood }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [stats, setStats] = useState({ wins: 0, losses: 0, draws: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [komentar, setKomentar] = useState('')

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

  const pilihKomentar = (status: string) => {
    const daftar = KOMENTAR[status] || KOMENTAR.playing
    setKomentar(daftar[Math.floor(Math.random() * daftar.length)])
    // Ekspresi Yuki ikut berubah: malu saat kalah, senang saat menang.
    onMood?.(WAJAH[status] || 'tenang')
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
          pilihKomentar(data.game.status)
        } else {
          const baru = await call('/api/game/ttt/new', {})
          if (!hidup) return
          setGame(baru.game)
          setStats(baru.stats || { wins: 0, losses: 0, draws: 0 })
          pilihKomentar('playing')
        }
      } catch (e) { if (hidup) setError(e instanceof Error ? e.message : 'Gagal memuat.') }
      finally { if (hidup) setLoading(false) }
    })()
    return () => { hidup = false }
  }, [])

  const langkah = async (cell: number) => {
    if (!game || game.status !== 'playing' || game.turn !== 'X' || game.board[cell]) return
    setError('')
    // tampilkan langkah pemain segera (optimistis), server tetap penentu akhir
    const optimis = { ...game, board: game.board.map((v, i) => (i === cell ? 'X' : v)), turn: 'O' as const }
    setGame(optimis)
    try {
      const data = await call('/api/game/ttt/move', { cell })
      setGame(data.game)
      setStats(data.stats || stats)
      pilihKomentar(data.game.status)
    } catch (e) {
      setGame(game) // kembalikan kalau server menolak
      setError(e instanceof Error ? e.message : 'Langkah gagal.')
    }
  }

  const mulaiUlang = async () => {
    setLoading(true); setError('')
    try {
      const data = await call('/api/game/ttt/new', {})
      setGame(data.game); setStats(data.stats || stats); pilihKomentar('playing')
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memulai.') }
    finally { setLoading(false) }
  }

  const selesai = game && game.status !== 'playing'

  return (
    <section className="ttt-dock" aria-label="Tic-Tac-Toe melawan Yuki">
      <div className="ttt-card">
        <header>
          <img className="ttt-face" src={`/expressions/${WAJAH[game?.status || 'playing'] || 'tenang'}.webp`} alt="" aria-hidden="true" />
          <div className="ttt-title">
            <small>Beta v4 · main bareng Yuki</small>
            <h2>Tic-Tac-Toe</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup"><XIcon size={17} /></button>
        </header>

        <div className="ttt-score">
          <span><b>{stats.wins}</b> menang</span>
          <span><b>{stats.draws}</b> seri</span>
          <span><b>{stats.losses}</b> kalah</span>
        </div>

        <div className="ttt-board" aria-live="polite">
          {(game?.board || Array(9).fill('')).map((isi, i) => {
            const menang = game?.winnerLine?.includes(i)
            return (
              <button
                key={i}
                type="button"
                className={`ttt-cell${isi ? ' terisi' : ''}${menang ? ' menang' : ''}${isi === 'O' ? ' yuki' : ''}`}
                onClick={() => langkah(i)}
                disabled={!game || game.status !== 'playing' || game.turn !== 'X' || Boolean(isi)}
                aria-label={`Kotak ${i + 1}${isi ? `, ${isi === 'O' ? 'Yuki' : 'kamu'}` : ', kosong'}`}
              >
                {isi || ''}
              </button>
            )
          })}
        </div>

        <p className="ttt-say">{loading ? 'Menyiapkan papan…' : error || komentar}</p>

        <div className="ttt-actions">
          {selesai ? (
            <button type="button" className="ttt-primary" onClick={mulaiUlang} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />} Main lagi
            </button>
          ) : (
            <button type="button" className="ttt-ghost" onClick={mulaiUlang} disabled={loading}>
              <RotateCcw size={15} /> Papan baru
            </button>
          )}
          <span className={`ttt-status ${game?.status || ''}`}>
            {game?.status === 'user_win' ? 'Kamu menang'
              : game?.status === 'yuki_win' ? 'Yuki menang'
              : game?.status === 'draw' ? 'Seri'
              : game?.turn === 'X' ? 'Giliranmu' : 'Yuki berpikir'}
          </span>
        </div>
      </div>
    </section>
  )
}
