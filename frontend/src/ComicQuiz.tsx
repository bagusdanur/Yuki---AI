import { useEffect, useState } from 'react'
import { BookOpen, ExternalLink, Eye, LoaderCircle, RefreshCw, Sparkles, X as XIcon } from 'lucide-react'

interface QuizOption {
  index: number
  title: string
}

interface QuizAnswer {
  title: string
  url: string
  image: string
  format?: string
  type?: string
  chapter?: string
  score?: string
}

interface QuizRound {
  roundId: string
  cover: string
  format?: string
  hintUsed: boolean
  answered: boolean
  options: QuizOption[]
  hint?: { format?: string; type?: string; chapter?: string; score?: string }
  pickedIndex?: number
  correct?: boolean
  answerIndex?: number
  answer?: QuizAnswer
}

interface Props {
  onClose: () => void
  onMood?: (mood: string) => void
}

export default function ComicQuiz({ onClose, onMood }: Props) {
  const [round, setRound] = useState<QuizRound | null>(null)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [stats, setStats] = useState({ wins: 0, losses: 0, draws: 0 })
  const [line, setLine] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body !== undefined ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Gagal menghubungi permainan.')
    return data
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await call('/api/game/comic-quiz')
        if (!alive) return
        setRound(data.round || null)
        setStreak(Number(data.streak) || 0)
        setBestStreak(Number(data.bestStreak) || 0)
        if (data.stats) setStats(data.stats)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Gagal memuat kuis komik.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const revealHint = async () => {
    if (!round || round.hintUsed || round.answered || busy) return
    setBusy(true); setError('')
    try {
      const data = await call('/api/game/comic-quiz/hint', {})
      if (data.round) setRound(data.round)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membuka petunjuk.')
    } finally { setBusy(false) }
  }

  const pickAnswer = async (choiceIndex: number) => {
    if (!round || round.answered || busy) return
    setBusy(true); setError('')
    try {
      const data = await call('/api/game/comic-quiz/answer', { choiceIndex })
      if (data.round) setRound(data.round)
      setStreak(Number(data.streak) || 0)
      setBestStreak(Number(data.bestStreak) || 0)
      if (data.stats) setStats(data.stats)
      if (data.line) setLine(String(data.line))
      if (data.mood) onMood?.(String(data.mood))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengirim jawaban.')
    } finally { setBusy(false) }
  }

  const nextRound = async () => {
    if (busy) return
    setBusy(true); setError(''); setLine('')
    try {
      const data = await call('/api/game/comic-quiz/new', {})
      setRound(data.round || null)
      setStreak(Number(data.streak) || 0)
      setBestStreak(Number(data.bestStreak) || 0)
      if (data.stats) setStats(data.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat soal baru.')
    } finally { setBusy(false) }
  }

  const blurPx = !round ? 14 : round.answered ? 0 : round.hintUsed ? 5 : 13

  return (
    <section className="ttt-dock" aria-label="Tebak Komik Ryukomik bersama Yuki">
      <div className="ttt-card quiz-card">
        <header>
          <div className="ttt-title">
            <small>Ryukomik · Benar {stats.wins} · Salah {stats.losses}</small>
            <h2>
              Tebak Komik
              <span className="ttt-status">streak {streak}{bestStreak > 0 ? ` · rekor ${bestStreak}` : ''}</span>
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup"><XIcon size={16} /></button>
        </header>

        {loading && <div className="quiz-loading"><LoaderCircle className="spin" size={18} /> Memuat katalog Ryukomik…</div>}
        {error && <div className="quiz-error">{error}</div>}

        {!loading && round && (
          <div className="quiz-body">
            <div className="quiz-top">
              <div className="quiz-cover-box">
                {round.cover ? (
                  <img
                    src={round.cover}
                    alt="Cover komik misteri"
                    referrerPolicy="no-referrer"
                    style={{ filter: `blur(${blurPx}px)` }}
                  />
                ) : (
                  <BookOpen size={28} />
                )}
              </div>
              <div className="quiz-meta">
                <span className="quiz-badge">{round.format || 'KOMIK'}</span>
                <p className="quiz-prompt">
                  {round.answered
                    ? (round.correct ? 'Tebakanmu benar!' : 'Kurang tepat!')
                    : 'Judul komik Ryukomik apa yang ada di cover ini?'}
                </p>
                {round.hint && (
                  <div className="quiz-hint-pill">
                    <Sparkles size={11} />
                    <span>{[round.hint.type, round.hint.chapter, round.hint.score ? `★ ${round.hint.score}` : ''].filter(Boolean).join(' · ') || 'Cover diperjelas'}</span>
                  </div>
                )}
                {!round.answered && !round.hintUsed && (
                  <button type="button" className="quiz-hint-btn" onClick={revealHint} disabled={busy}>
                    <Eye size={12} /> Petunjuk (perjelas cover)
                  </button>
                )}
              </div>
            </div>

            <div className="quiz-options">
              {round.options.map((opt) => {
                const isCorrect = round.answered && opt.index === round.answerIndex
                const isWrongPick = round.answered && opt.index === round.pickedIndex && !round.correct
                return (
                  <button
                    key={opt.index}
                    type="button"
                    className={`quiz-opt${isCorrect ? ' is-correct' : ''}${isWrongPick ? ' is-wrong' : ''}`}
                    onClick={() => pickAnswer(opt.index)}
                    disabled={round.answered || busy}
                  >
                    <span>{String.fromCharCode(65 + opt.index)}</span>
                    <b>{opt.title}</b>
                  </button>
                )
              })}
            </div>

            {line && (
              <div className="ttt-bubble">
                <b>Yuki</b>
                <p>{line}</p>
              </div>
            )}

            {round.answered && (
              <div className="quiz-actions">
                {round.answer?.url && (
                  <a href={round.answer.url} target="_blank" rel="noopener noreferrer" className="quiz-read-link">
                    <ExternalLink size={12} /> Baca di Ryukomik
                  </a>
                )}
                <button type="button" className="quiz-next-btn" onClick={nextRound} disabled={busy}>
                  <RefreshCw size={12} className={busy ? 'spin' : ''} /> Soal Berikutnya
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
