import 'dotenv/config'
import express from 'express'
import { chat, extractFacts } from './lib/llm.js'
import { synthesize } from './lib/tts.js'
import { Emotion } from './lib/emotion.js'
import {
  loadMemory, addFacts, addEvent, buildMemoryContext, recallMemory, saveEmotion
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

// Endpoint chat -> balasan dari Qwen/DeepSeek (dengan emosi + kedekatan + memori)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, adult, userId = 'anon' } = req.body || {}
    const userText = messages?.[messages.length - 1]?.content || ''

    // 0) ambil emosi & bond MILIK user ini (per userId)
    const emotion = await getEmotion(userId)

    // 1) mesin emosi (keyword) -> update KEDEKATAN (bond) + fallback ekspresi
    const { mood: kwMood, bond } = emotion.react(userText)

    // 2) RECALL SEMANTIK: ambil memori yang maknanya paling relevan dgn pesan user
    const recall = await recallMemory(userId, userText)
    const memoryContext = buildMemoryContext(recall)

    // 2b) Kalau user minta rekomendasi/cari komik -> ambil judul REAL dari Ryukomik
    let comicContext = ''
    if (wantsComic(userText)) {
      const q = extractQuery(userText)
      const results = q ? await searchComics(q, { adult }) : await latestComics()
      const list = results.length ? results : await latestComics()
      comicContext = buildComicContext(list, { query: q })
    }

    // 3) balas + emosi yang DIPILIH SENDIRI oleh Yuki (lewat tag [emosi: X])
    const { reply, model, emotion: llmMood } = await chat(messages || [], {
      emotionDirective: emotion.directive(),
      memoryContext,
      comicContext
    })

    // 4) EKSPRESI final: utamakan emosi dari ISI CHAT (disetir LLM), fallback ke keyword.
    //    Aturan kompleks: kalau masih "orang asing"/belum dekat, sayang/manja diturunkan jadi malu.
    let mood = llmMood || kwMood
    if (mood === 'sayang/manja' && emotion.closeness() < 0.35) mood = 'malu'

    // 5) simpan (per user)
    try { saveEmotion(userId, emotion.serialize()) } catch {}
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

    res.json({ reply, model, mood, bond: bond.name, feeling: emotion.feeling() })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint TTS -> audio dari teks
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body
    const { buffer, mime } = await synthesize(text || '')
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