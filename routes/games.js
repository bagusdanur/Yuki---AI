// Modular Mini-Game API routes (v5.1):
// Tic-Tac-Toe, Batu-Kertas-Gunting, dan Tebak Komik Ryukomik.

import { callLLM } from '../lib/llm.js'
import { createBoard as tttBoard, applyMove as tttMove, chooseYukiMove as tttYukiMove, MARK_USER as TTT_USER, MARK_YUKI as TTT_YUKI } from '../lib/games/tic-tac-toe.js'
import { loadSession as loadGameSession, saveSession as saveGameSession, getStats as gameStats, logGameEvent, GAME_RPS, GAME_TTT, GAME_COMIC_QUIZ } from '../lib/games/store.js'
import { hasilRonde as rpsHasil, normalisasi as rpsNormalisasi, acak as rpsAcak, stateBaru as rpsStateBaru, catatRonde as rpsCatat } from '../lib/games/rps.js'
import { getComicQuizPool, createQuizRound, publicQuizRound, buildQuizReaction } from '../lib/games/comic-quiz.js'

export function registerGameRoutes(app, { requireSession, rateLimit, getEmotion }) {
  const GAMES_BETA_IDS = new Set(String(process.env.GAMES_BETA_IDS || '').split(',').map((s) => s.trim()).filter(Boolean))
  // Default terbuka untuk semua saat GAMES_ENABLED=true kecuali GAMES_PUBLIC=false atau GAMES_BETA_IDS diisi.
  const GAMES_PUBLIC = process.env.GAMES_PUBLIC === 'true' || (process.env.GAMES_PUBLIC !== 'false' && GAMES_BETA_IDS.size === 0)
  const gameEligible = (userId) => GAMES_PUBLIC || GAMES_BETA_IDS.has(String(userId || ''))

  if (process.env.GAMES_ENABLED !== 'true') return

  const batasGame = rateLimit({ max: 120 })
  const khususBeta = (req, res, next) => {
    if (!gameEligible(req.authUserId)) return res.status(404).json({ error: 'Tidak tersedia.' })
    next()
  }

  // Dipakai UI untuk memutuskan apakah tombol game perlu ditampilkan.
  app.get('/api/game/status', requireSession, (req, res) => {
    res.json({ eligible: gameEligible(req.authUserId) })
  })

  // ===== Tic-Tac-Toe =====
  app.post('/api/game/ttt/line', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const { event, result, moveCount, avoid } = req.body || {}
      const emo = await getEmotion(req.authUserId).catch(() => null)
      const bond = Math.round(emo?.bond || 0)
      const hindari = Array.isArray(avoid) ? avoid.filter((x) => typeof x === 'string' && x.trim()).slice(-4) : []
      const aturan = [
        'Kamu Yuki, perempuan 19 tahun, tsundere, bicara santai bahasa Indonesia sehari-hari (aku/kamu).',
        `Kedekatanmu dengan pemain: bond ${bond}/100 (makin tinggi makin luluh, tapi tetap tidak mau terlihat kalah).`,
        'Kalian sedang main Tic-Tac-Toe; kamu memegang O.',
        'Balas HANYA satu kalimat pendek, maksimal 12 kata, tanpa tanda kutip dan tanpa emoji.',
        'Jangan pernah menyebut dirimu AI, bot, asisten, atau model. Jangan menjelaskan aturan permainan.',
        'Variasikan pembuka kalimat — jangan mengulang kata pembuka dari komentar sebelumnya.',
        hindari.length ? `Jangan ulangi kalimat ini: ${hindari.map((x) => `"${x}"`).join('; ')}` : ''
      ].filter(Boolean).join('\n')

      const konteks = event === 'start'
        ? 'Permainan baru dimulai. Ledek dia dengan santai, jangan panjang.'
        : event === 'result'
          ? (result === 'user_win' ? 'Dia menang dan kamu kalah. Jengkel sedikit, jangan berlebihan.'
            : result === 'yuki_win' ? 'Kamu menang. Cukup puas, jangan sombong berlebihan.'
              : 'Permainan seri. Komentari singkat.')
          : `Dia baru menaruh X untuk langkah ke-${Number(moveCount) || 1}. Komentari langkahnya, singkat.`

      const hasil = await Promise.race([
        callLLM([{ role: 'system', content: aturan }, { role: 'user', content: konteks }], { max_tokens: 64, temperature: 0.95 }),
        new Promise((resolve) => setTimeout(() => resolve(null), 4500))
      ])
      const baris = String(hasil?.content || '')
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/\[[^\]]*\]/g, '')
        .trim().split('\n').filter(Boolean)[0] || ''
      const bersih = baris.replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 140)
      if (!bersih) return res.status(204).end()
      return res.json({ line: bersih })
    } catch (err) {
      console.error('[game] komentar gagal:', err.message)
      return res.status(204).end()
    }
  })

  app.get('/api/game/ttt', requireSession, batasGame, khususBeta, (req, res) => {
    const sesi = loadGameSession(req.authUserId)
    res.json({ game: sesi?.state || null, result: sesi?.result || null, stats: gameStats(req.authUserId) })
  })

  app.post('/api/game/ttt/new', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const state = tttBoard()
      saveGameSession(req.authUserId, state, null)
      logGameEvent(req.authUserId, GAME_TTT, 'start')
      res.json({ game: state, stats: gameStats(req.authUserId) })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/ttt/move', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const cell = Number(req.body?.cell)
      if (!Number.isInteger(cell)) return res.status(400).json({ error: 'Kotak tidak valid.' })

      const sesi = loadGameSession(req.authUserId)
      if (!sesi?.state) return res.status(400).json({ error: 'Belum ada permainan. Mulai dulu.' })

      const emo = await getEmotion(req.authUserId)
      const bond = Number(emo.bond) || 0

      const langkahUser = tttMove(sesi.state, cell, TTT_USER)
      if (langkahUser.error) return res.status(400).json({ error: langkahUser.error, game: sesi.state })
      let state = langkahUser.state

      let yukiMove = null
      let baris = ''
      let dariModel = false
      if (state.status === 'playing') {
        const kosong = state.board.map((v, i) => (v ? null : i)).filter((v) => v !== null)
        const papanTeks = state.board.map((v, i) => `${i}:${v || '-'}`).join(' ')
        const aturanYuki = [
          'Kamu Yuki, perempuan 19 tahun, tsundere, bicara santai bahasa Indonesia sehari-hari (aku/kamu).',
          `Kedekatanmu dengan pemain: bond ${Math.round(bond)}/100.`,
          'Kalian sedang main Tic-Tac-Toe. Kamu memegang O, dia X.',
          'Pilih SATU kotak kosong untuk langkahmu, lalu satu kalimat pendek maksimal 12 kata.',
          'Jangan pernah menyebut dirimu AI, bot, asisten, atau model.',
          'Balas HANYA JSON tanpa penjelasan: {"cell": <angka>, "line": "<kalimat>"}'
        ].join('\n')

        const jawab = await Promise.race([
          callLLM([
            { role: 'system', content: aturanYuki },
            { role: 'user', content: `Papan (indeks:isi): ${papanTeks}. Kotak kosong: ${kosong.join(', ')}.` }
          ], { max_tokens: 90, temperature: 0.9 }),
          new Promise((resolve) => setTimeout(() => resolve(null), 4500))
        ])

        try {
          const teks = String(jawab?.content || '')
          const cocok = teks.match(/\{[\s\S]*\}/)
          const obj = cocok ? JSON.parse(cocok[0]) : {}
          const pilihan = Number(obj.cell)
          if (Number.isInteger(pilihan) && pilihan >= 0 && pilihan <= 8 && !state.board[pilihan]) {
            yukiMove = pilihan
            dariModel = true
          }
          baris = String(obj.line || '').replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 140)
        } catch { /* format aneh -> pakai cadangan */ }

        if (yukiMove === null) yukiMove = tttYukiMove(state.board, bond)
        if (yukiMove !== null) {
          const langkahYuki = tttMove(state, yukiMove, TTT_YUKI)
          if (!langkahYuki.error) state = langkahYuki.state
        }
      }

      const result = state.status === 'playing' ? null : state.status
      const stats = saveGameSession(req.authUserId, state, result)
      logGameEvent(req.authUserId, GAME_TTT, 'move')
      if (result) logGameEvent(req.authUserId, GAME_TTT, 'finish', result)
      res.json({ game: state, yukiMove, result, stats, line: baris, source: dariModel ? 'yuki' : 'cadangan', bond: Math.round(bond) })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/ttt/reset', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const state = tttBoard()
      saveGameSession(req.authUserId, state, null)
      logGameEvent(req.authUserId, GAME_TTT, 'start')
      res.json({ ok: true, game: state, stats: gameStats(req.authUserId) })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // ===== Batu-Kertas-Gunting =====
  app.get('/api/game/rps', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const sesi = loadGameSession(req.authUserId, GAME_RPS)
      res.json({
        game: sesi?.state || null,
        stats: sesi?.stats || { wins: 0, losses: 0, draws: 0 },
        last: sesi?.result || null
      })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/rps/play', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const pilihan = rpsNormalisasi(req.body?.choice)
      if (!pilihan) return res.status(400).json({ error: 'Pilih batu, kertas, atau gunting.' })

      const sesi = loadGameSession(req.authUserId, GAME_RPS)
      const sesiBaru = !sesi?.state?.score
      const state = sesiBaru ? rpsStateBaru() : sesi.state
      const emo = await getEmotion(req.authUserId).catch(() => null)
      const bond = Math.round(emo?.bond || 0)
      const riwayat = (state.history || []).slice(-3).map((h) => `dia ${h.you}, kamu ${h.yuki}`).join('; ') || 'belum ada'

      const aturan = [
        'Kamu Yuki, perempuan 19 tahun, tsundere, bicara santai bahasa Indonesia sehari-hari (aku/kamu).',
        `Kedekatanmu dengan pemain: bond ${bond}/100.`,
        'Kalian main batu-kertas-gunting. Pilih satu: batu, kertas, atau gunting.',
        'Riwayat hanya untuk membaca pola — JANGAN meniru langkah terakhirnya, dan jangan memilih pilihan yang sama terus.',
        `Kamu boleh sesekali lengah kalau bond tinggi (bond ${bond}).`,
        'Jangan pernah menyebut dirimu AI, bot, asisten, atau model.',
        'Balas HANYA JSON: {"pick":"batu|kertas|gunting","line":"satu kalimat maks 10 kata"}'
      ].join('\n')

      const jawab = await Promise.race([
        callLLM([
          { role: 'system', content: aturan },
          { role: 'user', content: `Riwayat ronde sebelumnya: ${riwayat}. Pilih langkahmu sekarang.` }
        ], { max_tokens: 80, temperature: 0.9 }),
        new Promise((resolve) => setTimeout(() => resolve(null), 3500))
      ])

      let pick = ''
      let baris = ''
      try {
        const teks = String(jawab?.content || '')
        const cocok = teks.match(/\{[\s\S]*\}/)
        const obj = cocok ? JSON.parse(cocok[0]) : {}
        pick = rpsNormalisasi(obj.pick)
        baris = String(obj.line || '').replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 120)
      } catch { /* format aneh -> acak */ }

      const dariModel = Boolean(pick)
      if (!pick) pick = rpsAcak()

      const hasil = rpsHasil(pilihan, pick)
      const next = rpsCatat(state, pilihan, pick, hasil)
      const stats = saveGameSession(req.authUserId, next, hasil, GAME_RPS)
      if (sesiBaru) logGameEvent(req.authUserId, GAME_RPS, 'start')
      logGameEvent(req.authUserId, GAME_RPS, 'round', hasil)
      await new Promise((r) => setTimeout(r, 500))
      res.json({ you: pilihan, yuki: pick, hasil, line: baris, state: next, stats, source: dariModel ? 'yuki' : 'cadangan' })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/rps/reset', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const stats = saveGameSession(req.authUserId, rpsStateBaru(), null, GAME_RPS)
      logGameEvent(req.authUserId, GAME_RPS, 'start')
      res.json({ game: rpsStateBaru(), stats })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // ===== Tebak Komik Ryukomik (v5.1) =====
  app.get('/api/game/comic-quiz', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const sesi = loadGameSession(req.authUserId, GAME_COMIC_QUIZ)
      const state = sesi?.state || { streak: 0, bestStreak: 0, recentUrls: [], current: null }
      if (!state.current || state.current.answered) {
        const pool = await getComicQuizPool()
        const round = createQuizRound(pool, state.recentUrls || [])
        if (!round) return res.status(503).json({ error: 'Katalog Ryukomik sedang sibuk. Coba lagi sebentar.' })
        const nextState = {
          streak: Number(state.streak) || 0,
          bestStreak: Number(state.bestStreak) || 0,
          recentUrls: [...(state.recentUrls || []), round.target.url].slice(-15),
          current: round
        }
        const stats = saveGameSession(req.authUserId, nextState, null, GAME_COMIC_QUIZ)
        logGameEvent(req.authUserId, GAME_COMIC_QUIZ, 'start')
        return res.json({ round: publicQuizRound(round), streak: nextState.streak, bestStreak: nextState.bestStreak, stats })
      }
      res.json({
        round: publicQuizRound(state.current),
        streak: Number(state.streak) || 0,
        bestStreak: Number(state.bestStreak) || 0,
        stats: sesi?.stats || { wins: 0, losses: 0, draws: 0 }
      })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/comic-quiz/new', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const sesi = loadGameSession(req.authUserId, GAME_COMIC_QUIZ)
      const prev = sesi?.state || { streak: 0, bestStreak: 0, recentUrls: [] }
      const pool = await getComicQuizPool()
      const round = createQuizRound(pool, prev.recentUrls || [])
      if (!round) return res.status(503).json({ error: 'Katalog Ryukomik sedang sibuk. Coba lagi sebentar.' })
      const nextState = {
        streak: Number(prev.streak) || 0,
        bestStreak: Number(prev.bestStreak) || 0,
        recentUrls: [...(prev.recentUrls || []), round.target.url].slice(-15),
        current: round
      }
      const stats = saveGameSession(req.authUserId, nextState, null, GAME_COMIC_QUIZ)
      logGameEvent(req.authUserId, GAME_COMIC_QUIZ, 'start')
      res.json({ round: publicQuizRound(round), streak: nextState.streak, bestStreak: nextState.bestStreak, stats })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/comic-quiz/hint', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const sesi = loadGameSession(req.authUserId, GAME_COMIC_QUIZ)
      const state = sesi?.state
      if (!state?.current || state.current.answered) return res.status(400).json({ error: 'Belum ada ronde aktif.' })
      const nextState = { ...state, current: { ...state.current, hintUsed: true } }
      saveGameSession(req.authUserId, nextState, null, GAME_COMIC_QUIZ)
      res.json({ round: publicQuizRound(nextState.current) })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/game/comic-quiz/answer', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const choiceIndex = Number(req.body?.choiceIndex)
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) {
        return res.status(400).json({ error: 'Pilihan jawaban tidak valid.' })
      }
      const sesi = loadGameSession(req.authUserId, GAME_COMIC_QUIZ)
      const state = sesi?.state
      if (!state?.current) return res.status(400).json({ error: 'Belum ada ronde aktif. Mulai dulu.' })
      if (state.current.answered) {
        return res.json({
          round: publicQuizRound(state.current),
          streak: Number(state.streak) || 0,
          bestStreak: Number(state.bestStreak) || 0,
          stats: sesi.stats,
          ...buildQuizReaction(Boolean(state.current.correct), { streak: Number(state.streak) || 0, hintUsed: state.current.hintUsed })
        })
      }

      const correct = choiceIndex === state.current.answerIndex
      const streak = correct ? (Number(state.streak) || 0) + 1 : 0
      const bestStreak = Math.max(Number(state.bestStreak) || 0, streak)
      const answeredRound = { ...state.current, answered: true, pickedIndex: choiceIndex, correct }
      const nextState = { ...state, streak, bestStreak, current: answeredRound }
      const result = correct ? 'user_win' : 'yuki_win'
      const stats = saveGameSession(req.authUserId, nextState, result, GAME_COMIC_QUIZ)
      logGameEvent(req.authUserId, GAME_COMIC_QUIZ, 'round', result)
      const reaction = buildQuizReaction(correct, { streak, hintUsed: answeredRound.hintUsed })

      res.json({
        round: publicQuizRound(answeredRound),
        correct,
        streak,
        bestStreak,
        stats,
        line: reaction.line,
        mood: reaction.mood
      })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  console.log('[game] route Tic-Tac-Toe, RPS & Tebak Komik aktif (GAMES_ENABLED=true)')
}
