// Mesin mini-game "Tebak Komik Ryukomik" (v5.1).
// Mengambil katalog real dari api.ryukomik.com (di-cache 5 menit) agar cepat
// dan selalu segar. Kunci jawaban disimpan di server (game_sessions), tidak
// pernah dikirim ke browser sebelum user menjawab.

import crypto from 'node:crypto'
import { latestComics, searchComics } from '../ryukomik.js'

const POOL_TTL_MS = 5 * 60_000
let cachedPool = { at: 0, items: [] }

function shuffle(arr = []) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export async function getComicQuizPool() {
  if (cachedPool.items.length >= 8 && Date.now() - cachedPool.at < POOL_TTL_MS) {
    return cachedPool.items
  }
  const seen = new Set()
  const collected = []
  const addItems = (list = []) => {
    for (const c of list) {
      const title = String(c?.title || '').trim()
      const url = String(c?.url || '').trim()
      const image = String(c?.image || '').trim()
      if (!title || !url || !image || seen.has(url)) continue
      seen.add(url)
      collected.push({
        title,
        url,
        image,
        format: String(c.format || 'KOMIK').trim(),
        type: String(c.type || '').trim(),
        chapter: String(c.chapter || '').trim(),
        score: String(c.score || '').trim()
      })
    }
  }

  try {
    const [latest, action, fantasy] = await Promise.all([
      latestComics().catch(() => []),
      searchComics('level').catch(() => []),
      searchComics('return').catch(() => [])
    ])
    addItems(latest)
    addItems(action)
    addItems(fantasy)
  } catch (err) {
    console.error('[comic-quiz] gagal memuat pool Ryukomik:', err.message)
  }

  if (collected.length >= 4) {
    cachedPool = { at: Date.now(), items: collected }
    return collected
  }
  return cachedPool.items
}

export function createQuizRound(pool = [], recentUrls = []) {
  if (!Array.isArray(pool) || pool.length < 4) return null
  const recentSet = new Set(recentUrls.slice(-12))
  const candidates = pool.filter((c) => !recentSet.has(c.url))
  const targetPool = candidates.length ? candidates : pool
  const target = targetPool[crypto.randomInt(0, targetPool.length)]
  const distractors = shuffle(pool.filter((c) => c.url !== target.url && c.title.toLowerCase() !== target.title.toLowerCase())).slice(0, 3)
  if (distractors.length < 3) return null

  const options = shuffle([target, ...distractors])
  const answerIndex = options.findIndex((o) => o.url === target.url)
  return {
    roundId: crypto.randomUUID().slice(0, 12),
    target,
    options: options.map((o, index) => ({ index, title: o.title })),
    answerIndex,
    hintUsed: false,
    answered: false,
    pickedIndex: null,
    correct: null
  }
}

export function publicQuizRound(round) {
  if (!round) return null
  const base = {
    roundId: round.roundId,
    cover: round.target.image,
    format: round.target.format,
    hintUsed: Boolean(round.hintUsed),
    answered: Boolean(round.answered),
    options: round.options,
    ...(round.hintUsed || round.answered
      ? {
          hint: {
            format: round.target.format,
            type: round.target.type,
            chapter: round.target.chapter,
            score: round.target.score
          }
        }
      : {})
  }
  if (round.answered) {
    return {
      ...base,
      pickedIndex: round.pickedIndex,
      correct: round.correct,
      answerIndex: round.answerIndex,
      answer: round.target
    }
  }
  return base
}

export function buildQuizReaction(correct, { streak = 0, hintUsed = false } = {}) {
  if (correct) {
    if (streak >= 5) return { mood: 'malu', line: `Hah?! ${streak} kali benar berturut-turut... ya lumayan lah, dasar wibu sejati.` }
    if (streak >= 3) return { mood: 'ceria', line: `${streak} streak! Hmph, boleh juga pengetahuan komikmu.` }
    if (hintUsed) return { mood: 'senang', line: 'Benar sih... tapi kan tadi pakai petunjuk, jangan terlalu bangga ya.' }
    const wins = [
      'Hmph, benar juga. Kebetulan aja kan?',
      'Tepat! Kelihatan banget sering nongkrong di Ryukomik.',
      'Bener... oke, aku akui matamu lumayan tajam.'
    ]
    return { mood: 'senang', line: wins[crypto.randomInt(0, wins.length)] }
  }
  const losses = [
    'Salah tuh! Makanya sering-sering baca di Ryukomik dong.',
    'Yah meleset... padahal covernya jelas banget lho.',
    'Bukan itu! Coba ronde berikutnya, jangan kalah lagi.'
  ]
  return { mood: 'kesal', line: losses[crypto.randomInt(0, losses.length)] }
}
