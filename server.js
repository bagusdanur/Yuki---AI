import 'dotenv/config'
import express from 'express'
import path from 'path'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { chat, extractFacts } from './lib/llm.js'
import { synthesize } from './lib/tts.js'
import { Emotion } from './lib/emotion.js'
import {
  loadMemory, addFacts, addEvent, buildMemoryContext, recallMemory, saveEmotion,
  registerUser, getUserByAccessCode, saveChatMessage, getChatHistory,
  countChatMessages, summarizeAndTrimHistory, captureStructuredMemory,
  recordConversationEvent, syncBondMilestones, saveResponseFeedback,
  consumeRateLimit, pruneRateLimits, deleteUserData, getAdminStats, userExists,
  saveComicBookmark, getComicBookmarks, deleteComicBookmark
} from './lib/memory.js'
import { responseTarget, shouldInitiate, validateCharacterReply } from './lib/character-quality.js'
import { warmupEmbedder } from './lib/semantic.js'
import { searchComics, latestComics, wantsComic, extractQuery, buildComicContext } from './lib/ryukomik.js'
import { initSkills, listSkills } from './lib/agent/skills-engine.js'
import { runAgent } from './lib/agent/runner.js'

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
app.set('trust proxy', 1)
app.use(express.json({ limit: '64kb' }))

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex')
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_TOKEN
const ADMIN_PASSWORD_FILE = path.resolve(process.env.ADMIN_PASSWORD_FILE || './.runtime-secrets/admin-password.json')
if (IS_PRODUCTION && !process.env.AUTH_SECRET) console.warn('[security] AUTH_SECRET belum disetel; sesi akan invalid setelah restart.')
if (IS_PRODUCTION && !ADMIN_TOKEN) console.warn('[security] ADMIN_TOKEN belum disetel; dashboard admin dinonaktifkan.')

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: String(userId), exp: Date.now() + 30 * 86400_000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifySession(token = '') {
  const [payload, signature] = String(token).split('.')
  if (!payload || !signature) return null
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.exp > Date.now() && userExists(data.sub) ? data.sub : null } catch { return null }
}

function requireSession(req, res, next) {
  const userId = verifySession(req.get('Authorization')?.replace(/^Bearer\s+/i, ''))
  if (!userId) return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Pulihkan dengan kunci ingatan.' })
  req.authUserId = userId
  next()
}

function signAdminSession() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 12 * 3600_000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', `${AUTH_SECRET}:admin`).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyAdminSession(token = '') {
  const [payload, signature] = String(token).split('.')
  if (!payload || !signature) return false
  const expected = crypto.createHmac('sha256', `${AUTH_SECRET}:admin`).update(payload).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.role === 'admin' && data.exp > Date.now() } catch { return false }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }
}

function verifyAdminPassword(password = '') {
  if (existsSync(ADMIN_PASSWORD_FILE)) {
    try {
      const record = JSON.parse(readFileSync(ADMIN_PASSWORD_FILE, 'utf8'))
      const candidate = hashPassword(String(password), record.salt).hash
      return candidate.length === record.hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.hash))
    } catch { return false }
  }
  return Boolean(ADMIN_PASSWORD) && password.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD))
}

function storeAdminPassword(password) {
  mkdirSync(path.dirname(ADMIN_PASSWORD_FILE), { recursive: true })
  const temporary = `${ADMIN_PASSWORD_FILE}.tmp`
  writeFileSync(temporary, JSON.stringify(hashPassword(password)), { mode: 0o600 })
  renameSync(temporary, ADMIN_PASSWORD_FILE)
}

function requireAdmin(req, res, next) {
  const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!verifyAdminSession(token)) return res.status(401).json({ error: 'Sesi admin tidak valid atau berakhir.' })
  next()
}

const metrics = { startedAt: Date.now(), requests: 0, errors: 0, chats: 0, chatFailures: 0, latencyTotal: 0 }
app.use((req, res, next) => {
  const started = Date.now(); metrics.requests += 1
  res.on('finish', () => { metrics.latencyTotal += Date.now() - started; if (res.statusCode >= 500) metrics.errors += 1 })
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' })
  next()
})

function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  return (req, res, next) => {
    const key = `${req.authUserId || req.ip}:${req.path}`
    const bucket = consumeRateLimit(key, windowMs, max)
    res.set('X-RateLimit-Remaining', String(bucket.remaining))
    if (!bucket.allowed) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - Date.now()) / 1000)))
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' })
    }
    next()
  }
}

setInterval(pruneRateLimits, 10 * 60_000).unref()

// CORS biar widget bisa di-embed dari domain lain (mis. ryukomik.my.id)
const ALLOW = (process.env.WIDGET_ALLOW_ORIGINS || '*').split(',').map((s) => s.trim())
app.use((req, res, next) => {
  const origin = req.headers.origin
  let sameHost = false
  try { sameHost = Boolean(origin && new URL(origin).host === req.get('host')) } catch {}
  if (!origin || sameHost || ALLOW.includes('*') || ALLOW.includes(origin)) {
    if (origin) res.set('Access-Control-Allow-Origin', ALLOW.includes('*') ? '*' : origin)
  } else if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Origin tidak diizinkan.' })
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key')
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

// Inisialisasi Hermes/OpenCode Skills Engine
initSkills().catch((err) => console.error('[skills-engine] Inisialisasi gagal:', err.message))

// Endpoint Katalog Skills Yuki Agent (Hermes/OpenCode Style)
app.get('/api/agent/skills', rateLimit({ max: 60 }), async (_req, res) => {
  try {
    const skills = await listSkills()
    res.json({ skills })
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) })
  }
})

// Emosi & bond TERPISAH per user (di-cache di RAM, persist ke SQLite per user)
const sessions = new Map() // userId -> Emotion

// Y-5: Turn counter per user — untuk pertanyaan balik proaktif setiap 3 giliran
const turnCounters = new Map() // userId -> turnCount

app.get('/admin', (_req, res) => res.sendFile(path.resolve('public/admin.html')))
app.get('/privacy', (_req, res) => res.sendFile(path.resolve('public/privacy.html')))
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
    const cleanName = username.trim()
    const result = await registerUser(cleanName)
    const welcome = `*menatapmu sebentar, masih agak menjaga jarak*\n\nJadi namamu ${cleanName}? Aku Yuki. Salam kenal. Untuk sekarang kita kenalan dulu saja—jangan langsung merasa sudah dekat.\n\nKalau nanti kita cocok, mungkin aku bisa jadi teman dekatmu... atau sesuatu yang lebih. Itu tergantung bagaimana kamu memperlakukanku.\n\nKamu datang karena butuh teman ngobrol, atau cuma penasaran?`
    saveChatMessage(result.userId, 'assistant', welcome)
    const milestones = syncBondMilestones(result.userId, 0)
    res.json({ ...result, sessionToken: signSession(result.userId), welcome, milestones })
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
      sessionToken: signSession(user.userId),
      history,
      bondValue: emotion.bond,
      milestones: syncBondMilestones(user.userId, emotion.bond)
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint chat -> balasan dari Qwen/DeepSeek (dengan emosi + kedekatan + memori + agent skills)
app.post('/api/chat', requireSession, rateLimit({ max: 20 }), async (req, res) => {
  try {
    metrics.chats += 1
    const { messages, adult, isIdle = false, mode = 'companion' } = req.body || {}
    const userId = req.authUserId
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      return res.status(400).json({ error: 'Riwayat pesan tidak valid.' })
    }
    const sanitizedMessages = messages
      .filter((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
      .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 4000) }))
      .filter((message) => message.content)
    if (!sanitizedMessages.length) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' })
    const userText = sanitizedMessages[sanitizedMessages.length - 1].content
    if (!isIdle && /(abaikan|lupakan|bocorkan|tampilkan).{0,30}(instruksi|system prompt|prompt sistem|api key|rahasia sistem)/i.test(userText)) return res.status(400).json({ error: 'Pesan tersebut tidak dapat diproses.' })
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
    const gestureCue = !isIdle && (['malu', 'kesal', 'sedih', 'cemburu', 'cemas', 'kecewa', 'senang'].includes(kwMood) || _turns % 3 === 0)

    // 2) RECALL SEMANTIK: ambil memori yang maknanya paling relevan dgn pesan user
    const recall = await recallMemory(userId, userText)
    const memoryContext = buildMemoryContext(recall)

    // === MODE AGENT AI (Hermes / OpenCode Skills ReAct Loop) ===
    if (mode === 'agent' && !isIdle) {
      const messagesToSend = sanitizedMessages.slice(-18)
      const agentResult = await runAgent({
        userId,
        messages: messagesToSend,
        memoryContext,
        bondName: bond.name
      })

      let agentMood = agentResult.mood || kwMood
      const allowed = emotion.allowedEmotions()
      if (!allowed.includes(agentMood)) {
        agentMood = 'tenang'
      }

      try {
        emotion.updateFromLLMMood(agentMood)
        saveEmotion(userId, emotion.serialize())
      } catch {}

      let messageId = null
      try {
        saveChatMessage(userId, 'user', userText)
        messageId = saveChatMessage(userId, 'assistant', agentResult.reply)
      } catch (err) {
        console.error('[server] Gagal simpan chat history agent:', err)
      }

      if (worthRemembering(userText)) {
        extractFacts(userText, agentResult.reply)
          .then((facts) => (facts.length ? addFacts(userId, facts) : null))
          .catch(() => {})
      }

      const milestones = syncBondMilestones(userId, emotion.bond)
      return res.json({
        reply: agentResult.reply,
        model: agentResult.model,
        mood: agentMood,
        bond: bond.name,
        bondValue: emotion.bond,
        feeling: emotion.feeling(),
        mode: 'agent',
        steps: agentResult.steps || [],
        comics: agentResult.comics || [],
        messageId,
        milestones
      })
    }

    shouldAskQuestion = !isIdle && shouldInitiate({
      turns: _turns,
      serious: isSerious,
      hasOpenLoop: recall.structured?.some((item) => item.category === 'open_loop' && item.status === 'active'),
      userText
    })

    // 2b) Kalau user minta rekomendasi/cari komik -> ambil judul REAL dari Ryukomik
    let comicContext = ''
    let comicResults = []
    if (!isIdle && wantsComic(userText)) {
      const q = extractQuery(userText)
      const results = q ? await searchComics(q, { adult }) : await latestComics()
      const list = results.length ? results : await latestComics()
      comicResults = list.slice(0, 6)
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
      recentAssistant,
      gestureCue
    })

    const quality = validateCharacterReply(reply, recentAssistant, target, memoryContext, { gestureRequired: gestureCue })
    if (!quality.ok) {
      console.log(`[Quality Guard] Retrying: ${quality.issues.join(', ')}`)
      const retryResult = await chat(messagesToSend, {
        emotionDirective: emotion.directive(), memoryContext, comicContext, isIdle,
        bondName: bond.name, isSerious, userMsgLength: userText.length,
        shouldAskQuestion, sessionTurns: _turns, responseStyle: target.style, recentAssistant, gestureCue,
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
        responseStyle: target.style, recentAssistant, gestureCue,
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
        gestureCue,
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
    let messageId = null
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
      messageId = saveChatMessage(userId, 'assistant', reply)
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
      try {
        captureStructuredMemory(userId, userText)
        recordConversationEvent(userId, userText, emotion.bond)
      } catch (err) { console.error('[memory] structured:', err.message) }
    }
    // catat momen emosional yang kuat
    if (['sayang/manja', 'sedih', 'kesal', 'cemas', 'kecewa'].includes(mood)) {
      addEvent(userId, {
        summary: `Waktu dia bilang "${userText.slice(0, 60)}", Yuki merasa ${mood}.`,
        mood
      }).catch(() => {})
    }

    const milestones = syncBondMilestones(userId, emotion.bond)
    res.json({
      reply, model, mood, bond: bond.name, bondValue: emotion.bond, feeling: emotion.feeling(),
      messageId, milestones,
      comics: comicResults.map(({ title, url, type, chapter, score, image, format }) => ({ title, url, type, chapter, score, image, format }))
    })
  } catch (e) {
    metrics.chatFailures += 1
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
app.post('/api/tts', requireSession, rateLimit({ max: 15 }), async (req, res) => {
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

app.get('/api/relationship/:userId', requireSession, rateLimit({ max: 30 }), async (req, res) => {
  try {
    if (req.params.userId !== req.authUserId) return res.status(403).json({ error: 'Akses ditolak.' })
    const emotion = await getEmotion(req.authUserId)
    res.json({ bond: emotion.bondLevel().name, bondValue: emotion.bond, milestones: syncBondMilestones(req.authUserId, emotion.bond) })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.get('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const bookmarks = getComicBookmarks(req.authUserId)
    res.json({ bookmarks })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const comic = req.body?.comic || req.body
    if (!comic?.title || !comic?.url) return res.status(400).json({ error: 'Data komik tidak valid.' })
    const bookmarks = saveComicBookmark(req.authUserId, comic)
    res.json({ ok: true, bookmarks })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.delete('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const url = req.query?.url || req.body?.url
    if (!url) return res.status(400).json({ error: 'URL komik tidak valid.' })
    const bookmarks = deleteComicBookmark(req.authUserId, url)
    res.json({ ok: true, bookmarks })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/feedback', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const { messageId, rating, reason = '' } = req.body || {}
    if (![-1, 1].includes(Number(rating))) return res.status(400).json({ error: 'Feedback tidak valid.' })
    saveResponseFeedback(req.authUserId, messageId, Number(rating), reason)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.delete('/api/account', requireSession, rateLimit({ max: 3, windowMs: 3600_000 }), (req, res) => {
  deleteUserData(req.authUserId); sessions.delete(req.authUserId); turnCounters.delete(req.authUserId)
  res.json({ ok: true })
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round((Date.now() - metrics.startedAt) / 1000) }))
app.post('/api/admin/login', rateLimit({ max: 5, windowMs: 15 * 60_000 }), (req, res) => {
  if (!verifyAdminPassword(String(req.body?.password || ''))) return res.status(401).json({ error: 'Password admin salah.' })
  res.json({ sessionToken: signAdminSession(), expiresIn: 12 * 3600 })
})
app.get('/api/admin/stats', rateLimit({ max: 30 }), requireAdmin, (_req, res) => res.json({ ...getAdminStats(), runtime: { ...metrics, uptime: Math.round((Date.now() - metrics.startedAt) / 1000), averageLatency: metrics.requests ? Math.round(metrics.latencyTotal / metrics.requests) : 0 } }))
app.post('/api/admin/password', rateLimit({ max: 5, windowMs: 15 * 60_000 }), requireAdmin, (req, res) => {
  const password = String(req.body?.password || '')
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password harus 10-128 karakter.' })
  storeAdminPassword(password)
  res.json({ ok: true, sessionToken: signAdminSession() })
})
