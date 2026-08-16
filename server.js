import 'dotenv/config'
import express from 'express'
import path from 'path'
import { chat, extractFacts } from './lib/llm.js'
import { synthesize } from './lib/tts.js'
import { Emotion } from './lib/emotion.js'
import {
  loadMemory, addFacts, addEvent, buildMemoryContext, recallMemory, saveEmotion,
  registerUser, getUserByAccessCode, saveChatMessage, getChatHistory,
  countChatMessages, summarizeAndTrimHistory, captureStructuredMemory
} from './lib/memory.js'
import { responseTarget, shouldInitiate, validateCharacterReply } from './lib/character-quality.js'
import { warmupEmbedder } from './lib/semantic.js'
import { searchComics, latestComics, wantsComic, extractQuery, buildComicContext } from './lib/ryukomik.js'

// Hemat DeepSeek: cuma ekstrak fakta kalau pesan kemungkinan berisi info personal
// (mayoritas chat biasa nggak perlu -> menghemat ~1 panggilan LLM tiap giliran).
function worthRemembering(text = '') {
  if (text.length <= 25) return false
  // Fakta eksplisit tentang diri user
  if (/(nama|aku |saya |panggil|umur|tahun|tinggal|kerja|sekolah|kuliah|kampus|pacar|gebetan|hobi|aku suka|aku benci|favorit|kesukaan|cita-cita|impian)/i.test(text)) return true
  // M-3: Preferensi implisit — ekspresi suka/tidak suka tanpa deklarasi eksplisit
  if (/(wah seru|enak banget|bagus banget|asik banget|keren banget|nggak suka|males banget|bosen sama|nggak ngerti|seneng banget|excited banget)/i.test(text)) return true
  return false
}

const app = express()
app.use(express.json({ limit: '64kb' }))

const rateBuckets = new Map()
function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`
    const now = Date.now()
    const bucket = rateBuckets.get(key)
    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    bucket.count += 1
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' })
    }
    next()
  }
}

setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of rateBuckets) if (now >= bucket.resetAt) rateBuckets.delete(key)
}, 5 * 60_000).unref()

// CORS biar widget bisa di-embed dari domain lain (mis. ryukomik.my.id)
const ALLOW = (process.env.WIDGET_ALLOW_ORIGINS || '*').split(',').map((s) => s.trim())
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (ALLOW.includes('*')) res.set('Access-Control-Allow-Origin', '*')
  else if (origin && ALLOW.includes(origin)) res.set('Access-Control-Allow-Origin', origin)
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.static('dist'))
app.use(express.static('public'))

// Rute Dokumentasi Yuki AI
app.get('/docs', (req, res) => {
  res.sendFile(path.resolve('public/docs.html'))
})

// Panaskan model embedding di latar belakang (biar recall cepat saat dipakai)
warmupEmbedder().catch(() => {})

// Emosi & bond TERPISAH per user (di-cache di RAM, persist ke SQLite per user)
const sessions = new Map() // userId -> Emotion

// Y-5: Turn counter per user — untuk pertanyaan balik proaktif setiap 3 giliran
const turnCounters = new Map() // userId -> turnCount

// Y-3: Deteksi topik serius yang butuh override empati penuh
function isSeriousTopic(text = '') {
  return /(meninggal|mati |kanker|sakit parah|kecelakaan|bunuh diri|depresi berat|putus asa|tidak sanggup|gak sanggup|mau nyerah|hilang harapan|gak mau hidup|nangis terus|hancur banget|trauma|aku takut|lagi takut|cemas|khawatir|gugup|deg-degan|panik|butuh ditemani|temani aku)/i.test(text)
}

async function getEmotion(userId) {
  if (sessions.has(userId)) return sessions.get(userId)
  const mem = await loadMemory(userId)
  const emo = mem.emotion ? new Emotion(mem.emotion) : new Emotion()
  sessions.set(userId, emo)
  return emo
}

// Endpoint untuk mendaftar user baru (Onboarding)
app.post('/api/register', rateLimit({ max: 10 }), async (req, res) => {
  try {
    const { username } = req.body || {}
    if (!username || !username.trim() || username.trim().length > 50) {
      return res.status(400).json({ error: 'Nama harus berisi 1-50 karakter.' })
    }
    const result = await registerUser(username.trim())
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint untuk memulihkan akun via Kode Akses
app.post('/api/login-code', rateLimit({ max: 15 }), async (req, res) => {
  try {
    const { accessCode } = req.body || {}
    if (!accessCode || !accessCode.trim()) {
      return res.status(400).json({ error: 'Kode akses tidak boleh kosong.' })
    }
    const user = getUserByAccessCode(accessCode)
    if (!user) {
      return res.status(404).json({ error: 'Kode akses tidak ditemukan atau salah.' })
    }
    const history = getChatHistory(user.userId)
    const emotion = await getEmotion(user.userId)
    
    res.json({
      userId: user.userId,
      username: user.username,
      history,
      bondValue: emotion.bond
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint chat -> balasan dari Qwen/DeepSeek (dengan emosi + kedekatan + memori)
app.post('/api/chat', rateLimit({ max: 30 }), async (req, res) => {
  try {
    const { messages, adult, userId = 'anon', isIdle = false } = req.body || {}
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      return res.status(400).json({ error: 'Riwayat pesan tidak valid.' })
    }
    const sanitizedMessages = messages
      .filter((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
      .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 4000) }))
      .filter((message) => message.content)
    if (!sanitizedMessages.length) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' })
    const userText = sanitizedMessages[sanitizedMessages.length - 1].content
    if (!isIdle && sanitizedMessages[sanitizedMessages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Pesan terakhir harus berasal dari pengguna.' })
    }

    const emotion = await getEmotion(userId)

    // Y-5: Hitung giliran percakapan untuk pertanyaan balik proaktif
    const persistedTurns = Number.isFinite(emotion.interactions) ? emotion.interactions : 0
    const previousTurns = turnCounters.get(userId) ?? persistedTurns
    const _turns = isIdle ? previousTurns : previousTurns + 1
    if (!isIdle) turnCounters.set(userId, _turns)
    let shouldAskQuestion = false

    // Y-3: Deteksi topik serius untuk override empati
    const isSerious = !isIdle && isSeriousTopic(userText)

    // 1) mesin emosi (keyword) -> update KEDEKATAN (bond) + fallback ekspresi
    // Jika isIdle true, jalankan peluruhan emosi pasif tanpa memicu reaksi baru
    if (isIdle) {
      emotion.decay({ perTurn: false })
    }
    const { mood: kwMood, bond } = isIdle 
      ? { mood: emotion.label(), bond: emotion.bondLevel() } 
      : emotion.react(userText)

    // 2) RECALL SEMANTIK: ambil memori yang maknanya paling relevan dgn pesan user
    const recall = await recallMemory(userId, userText)
    const memoryContext = buildMemoryContext(recall)
    shouldAskQuestion = !isIdle && shouldInitiate({
      turns: _turns,
      serious: isSerious,
      hasOpenLoop: recall.structured?.some((item) => item.category === 'open_loop' && item.status === 'active'),
      userText
    })

    // 2b) Kalau user minta rekomendasi/cari komik -> ambil judul REAL dari Ryukomik
    let comicContext = ''
    if (!isIdle && wantsComic(userText)) {
      const q = extractQuery(userText)
      const results = q ? await searchComics(q, { adult }) : await latestComics()
      const list = results.length ? results : await latestComics()
      comicContext = buildComicContext(list, { query: q })
    }

    // Perbaiki bug loop balas diri sendiri: sisipkan pesan user tiruan agar API LLM menerima giliran user
    // Ringkasan memori membawa konteks lama; hanya 18 pesan terbaru dikirim mentah.
    const messagesToSend = sanitizedMessages.slice(-18)
    const recentAssistant = messagesToSend.filter((message) => message.role === 'assistant').slice(-5).map((message) => message.content)
    const target = responseTarget(userText, { serious: isSerious, idle: isIdle })
    if (isIdle) {
      messagesToSend.push({ role: 'user', content: '[terdiam]' })
    }

    // 3) balas + emosi yang DIPILIH SENDIRI oleh Yuki (lewat tag [emosi: X])
    let { reply, model, emotion: llmMood } = await chat(messagesToSend, {
      emotionDirective: emotion.directive(),
      memoryContext,
      comicContext,
      isIdle,
      bondName: bond.name,
      isSerious,
      userMsgLength: userText.length,
      shouldAskQuestion,
      sessionTurns: _turns,
      responseStyle: target.style,
      recentAssistant
    })

    const quality = validateCharacterReply(reply, recentAssistant, target, memoryContext)
    if (!quality.ok) {
      console.log(`[Quality Guard] Retrying: ${quality.issues.join(', ')}`)
      const retryResult = await chat(messagesToSend, {
        emotionDirective: emotion.directive(), memoryContext, comicContext, isIdle,
        bondName: bond.name, isSerious, userMsgLength: userText.length,
        shouldAskQuestion, sessionTurns: _turns, responseStyle: target.style, recentAssistant,
        retryReason: `Balasan sebelumnya bermasalah: ${quality.issues.join(', ')}. Tulis ulang secara utuh, natural, tidak repetitif, dan sesuai panjang yang diminta.`
      })
      reply = retryResult.reply
      llmMood = retryResult.emotion || llmMood
    }

    if (reply.length > target.max) {
      const shortened = reply.slice(0, target.max)
      const lastStop = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('!'), shortened.lastIndexOf('?'))
      reply = (lastStop > target.max * 0.45 ? shortened.slice(0, lastStop + 1) : `${shortened.trimEnd()}…`).trim()
    }

    // Content Filter & Retry
    if (!emotion.isContentAppropriate(reply)) {
      console.log(`[Content Filter] Balasan ditolak karena melanggar bond level "${bond.name}". Retrying...`)
      const retryResult = await chat(messagesToSend, {
        emotionDirective: emotion.directive(),
        memoryContext,
        comicContext,
        isIdle,
        bondName: bond.name,
        responseStyle: target.style, recentAssistant,
        retryReason: `Balasan sebelumnya DITOLAK karena terlalu mesra/hangat untuk tingkat kedekatan "${bond.name}". Tulis ulang dengan nada DINGIN, KETUS, dan TANPA kata romantis.`
      })
      reply = retryResult.reply
      llmMood = retryResult.emotion

      // Sanitize as last resort
      if (!emotion.isContentAppropriate(reply)) {
        reply = reply.replace(/(sayang|cinta|kangen|rindu|peluk|dear|darling|~|♡|❤)/gi, '')
                     .replace(/suka sama kamu|suka kamu/gi, '...apa?')
                     .replace(/\s{2,}/g, ' ')
                     .trim()
      }
    }

    // G-1: Character Break Guard — cegah Yuki mengaku sebagai AI/bot
    const _aiBreakPattern = /(sebagai ai|sebagai bot|sebagai program|sebagai asisten virtual|saya adalah ai|aku adalah ai|saya adalah bot|aku adalah bot|tidak punya perasaan|tidak memiliki perasaan|hanya sebuah ai|hanya sebuah bot|aku hanya program|maaf aku ai|maaf saya ai|aku dibuat|saya dibuat oleh|saya hanya model bahasa|aku hanyalah)/i
    if (_aiBreakPattern.test(reply)) {
      console.log('[Character Guard] Yuki mengaku AI. Retrying dengan instruksi tegas...')
      const _guardRetry = await chat(messagesToSend, {
        emotionDirective: emotion.directive(),
        memoryContext,
        comicContext,
        isIdle,
        bondName: bond.name,
        isSerious,
        userMsgLength: userText.length,
        shouldAskQuestion: false,
        sessionTurns: _turns,
        responseStyle: target.style,
        recentAssistant,
        retryReason: 'PERINGATAN KRITIS: Balasan sebelumnya MEMBONGKAR bahwa kamu AI/bot — ini DILARANG KERAS. Kamu adalah Yuki, manusia sungguhan. Tulis ulang balasan sesuai karaktermu sebagai tsundere — jika user bertanya soal itu, tolak dengan mengelak atau ganti topik. JANGAN mengakui apapun.'
      })
      reply = _guardRetry.reply
      llmMood = _guardRetry.emotion || llmMood
      // Last resort: hapus paksa frasa pengakuan AI
      if (_aiBreakPattern.test(reply)) {
        reply = reply
          .replace(/sebagai (ai|bot|program|asisten virtual|model bahasa)/gi, 'diriku')
          .replace(/(saya|aku) adalah (ai|bot|program)/gi, 'aku ini Yuki')
          .replace(/tidak punya perasaan|tidak memiliki perasaan/gi, 'punya perasaan')
          .replace(/\s{2,}/g, ' ').trim()
      }
    }

    // 4) EKSPRESI final: utamakan emosi dari ISI CHAT (disetir LLM), fallback ke keyword.
    //    Validasi terhadap bond level (hard override)
    let mood = llmMood || kwMood
    const allowed = emotion.allowedEmotions()
    if (!allowed.includes(mood)) {
      if (mood === 'sayang/manja') mood = 'malu'
      else if (mood === 'ceria') mood = 'senang'
      else mood = 'tenang'
    }

    // 5) simpan (per user)
    try {
      emotion.updateFromLLMMood(mood)
      saveEmotion(userId, emotion.serialize())
    } catch {}
    
    // Simpan pesan user (atau tag terdiam) dan balasan Yuki ke SQLite chat history
    try {
      if (isIdle) {
        saveChatMessage(userId, 'user', '[terdiam]')
      } else if (userText) {
        saveChatMessage(userId, 'user', userText)
      }
      saveChatMessage(userId, 'assistant', reply)
    } catch (err) {
      console.error('[server] Gagal menyimpan ke chat_history:', err)
    }

    // S-4: Pangkas riwayat jika sudah terlalu panjang (async, tidak blok respons)
    if (!isIdle) {
      try {
        const msgCount = countChatMessages(userId)
        if (msgCount > 36) summarizeAndTrimHistory(userId).catch(() => {})
      } catch {}
    }

    if (worthRemembering(userText)) {
      extractFacts(userText, reply)
        .then((facts) => (facts.length ? addFacts(userId, facts) : null))
        .catch(() => {})
    }
    if (!isIdle) {
      try { captureStructuredMemory(userId, userText) } catch (err) { console.error('[memory] structured:', err.message) }
    }
    // catat momen emosional yang kuat
    if (['sayang/manja', 'sedih', 'kesal', 'cemas', 'kecewa'].includes(mood)) {
      addEvent(userId, {
        summary: `Waktu dia bilang "${userText.slice(0, 60)}", Yuki merasa ${mood}.`,
        mood
      }).catch(() => {})
    }

    res.json({ reply, model, mood, bond: bond.name, bondValue: emotion.bond, feeling: emotion.feeling() })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint resolusi cover komik dinamis (untuk riwayat lama tanpa ?img=)
app.get('/api/comic-cover', async (req, res) => {
  try {
    const comicUrl = req.query.url || ''
    const m = comicUrl.match(/\/komik\/(komiku|doujindesu)\/([^/?#]+)/i)
    if (!m) return res.json({ image: '' })
    const [_, sumber, slug] = m

    // Cari dari pencarian berdasarkan slug
    const results = await searchComics(slug, { adult: sumber === 'doujindesu' })
    const match = results.find((r) => r.url.includes(slug))
    if (match && match.image) {
      return res.json({ image: match.image })
    }

    // Fallback ke komik terbaru
    const latest = await latestComics()
    const matchLatest = latest.find((r) => r.url.includes(slug))
    if (matchLatest && matchLatest.image) {
      return res.json({ image: matchLatest.image })
    }

    res.json({ image: '' })
  } catch {
    res.json({ image: '' })
  }
})

// Endpoint TTS -> audio dari teks
app.post('/api/tts', rateLimit({ max: 20 }), async (req, res) => {
  try {
    const { text, mood } = req.body
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
      return res.status(400).json({ error: 'Teks suara harus berisi 1-2000 karakter.' })
    }
    const { buffer, mime } = await synthesize(text.trim(), mood)
    res.set('Content-Type', mime)
    res.send(buffer)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`✨ AI Anime Chat jalan di http://localhost:${PORT}`)
})
