import 'dotenv/config'
import express from 'express'
import path from 'path'
import { chat, extractFacts } from './lib/llm.js'
import { synthesize } from './lib/tts.js'
import { Emotion } from './lib/emotion.js'
import {
  loadMemory, addFacts, addEvent, buildMemoryContext, recallMemory, saveEmotion,
  registerUser, getUserByAccessCode, saveChatMessage, getChatHistory
} from './lib/memory.js'
import { warmupEmbedder } from './lib/semantic.js'
import { searchComics, latestComics, wantsComic, extractQuery, buildComicContext } from './lib/ryukomik.js'

// Hemat DeepSeek: cuma ekstrak fakta kalau pesan kemungkinan berisi info personal
// (mayoritas chat biasa nggak perlu -> menghemat ~1 panggilan LLM tiap giliran).
function worthRemembering(text = '') {
  return text.length > 25 &&
    /(nama|aku |saya |panggil|umur|tahun|tinggal|kerja|sekolah|kuliah|kampus|pacar|gebetan|hobi|aku suka|aku benci|favorit|kesukaan|cita-cita|impian)/i.test(text)
}

const app = express()
app.use(express.json())

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

app.use(express.static('public'))

// Rute Dokumentasi Yuki AI
app.get('/docs', (req, res) => {
  res.sendFile(path.resolve('public/docs.html'))
})

// Panaskan model embedding di latar belakang (biar recall cepat saat dipakai)
warmupEmbedder().catch(() => {})

// Emosi & bond TERPISAH per user (di-cache di RAM, persist ke SQLite per user)
const sessions = new Map() // userId -> Emotion
async function getEmotion(userId) {
  if (sessions.has(userId)) return sessions.get(userId)
  const mem = await loadMemory(userId)
  const emo = mem.emotion ? new Emotion(mem.emotion) : new Emotion()
  sessions.set(userId, emo)
  return emo
}

// Endpoint untuk mendaftar user baru (Onboarding)
app.post('/api/register', async (req, res) => {
  try {
    const { username } = req.body || {}
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Nama tidak boleh kosong.' })
    }
    const result = await registerUser(username.trim())
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint untuk memulihkan akun via Kode Akses
app.post('/api/login-code', async (req, res) => {
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
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, adult, userId = 'anon', isIdle = false } = req.body || {}
    const userText = messages?.[messages.length - 1]?.content || ''

    // 0) ambil emosi & bond MILIK user ini (per userId)
    const emotion = await getEmotion(userId)

    // 1) mesin emosi (keyword) -> update KEDEKATAN (bond) + fallback ekspresi
    // Jika isIdle true, kita gunakan emosi yang ada tanpa memicu reaksi baru
    const { mood: kwMood, bond } = isIdle 
      ? { mood: emotion.label(), bond: emotion.bondLevel() } 
      : emotion.react(userText)

    // 2) RECALL SEMANTIK: ambil memori yang maknanya paling relevan dgn pesan user
    const recall = await recallMemory(userId, userText)
    const memoryContext = buildMemoryContext(recall)

    // 2b) Kalau user minta rekomendasi/cari komik -> ambil judul REAL dari Ryukomik
    let comicContext = ''
    if (!isIdle && wantsComic(userText)) {
      const q = extractQuery(userText)
      const results = q ? await searchComics(q, { adult }) : await latestComics()
      const list = results.length ? results : await latestComics()
      comicContext = buildComicContext(list, { query: q })
    }

    // Perbaiki bug loop balas diri sendiri: sisipkan pesan user tiruan agar API LLM menerima giliran user
    const messagesToSend = [...(messages || [])]
    if (isIdle) {
      messagesToSend.push({ role: 'user', content: '[terdiam]' })
    }

    // 3) balas + emosi yang DIPILIH SENDIRI oleh Yuki (lewat tag [emosi: X])
    let { reply, model, emotion: llmMood } = await chat(messagesToSend, {
      emotionDirective: emotion.directive(),
      memoryContext,
      comicContext,
      isIdle,
      bondName: bond.name
    })

    // Content Filter & Retry
    if (!emotion.isContentAppropriate(reply)) {
      console.log(`[Content Filter] Balasan ditolak karena melanggar bond level "${bond.name}". Retrying...`)
      const retryResult = await chat(messagesToSend, {
        emotionDirective: emotion.directive(),
        memoryContext,
        comicContext,
        isIdle,
        bondName: bond.name,
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
    try { saveEmotion(userId, emotion.serialize()) } catch {}
    
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

    if (worthRemembering(userText)) {
      extractFacts(userText, reply)
        .then((facts) => (facts.length ? addFacts(userId, facts) : null))
        .catch(() => {})
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
app.post('/api/tts', async (req, res) => {
  try {
    const { text, mood } = req.body
    const { buffer, mime } = await synthesize(text || '', mood)
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