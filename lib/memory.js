import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { embed, cosineSim } from './semantic.js'
import { summarizeProfile, summarizeConversation } from './llm.js'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
const MAX_FACTS = Number(process.env.MEMORY_MAX_FACTS || 60)
const MAX_EVENTS = Number(process.env.MEMORY_MAX_EVENTS || 30)
const TOPK = Number(process.env.RECALL_TOPK || 5)

// Satu file database untuk SEMUA user; tiap baris ditandai user_id -> memori terpisah.
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS facts (user_id TEXT NOT NULL, text TEXT NOT NULL, vec TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, text));
  CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, summary TEXT NOT NULL, mood TEXT, vec TEXT, ts TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS emotion (user_id TEXT PRIMARY KEY, state TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS user_profile (user_id TEXT PRIMARY KEY, profile_summary TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, username TEXT, access_code TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, role TEXT, content TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS chat_summary (user_id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS structured_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL, status TEXT DEFAULT 'active', importance INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, category, content));
  CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_structured_memory_user ON structured_memory(user_id, category, status);
`)

const uid = (u) => String(u || 'anon').slice(0, 64)
const parseVec = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }

// Helper untuk menghasilkan kode akses unik YUKI-XXXX-XXXX
function generateAccessCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const gen = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `YUKI-${gen(4)}-${gen(4)}`
}

function generateUniqueAccessCode() {
  for (let i = 0; i < 100; i++) {
    const code = generateAccessCode()
    const exists = db.prepare('SELECT 1 FROM users WHERE access_code = ?').get(code)
    if (!exists) return code
  }
  return `YUKI-${Date.now().toString(36).toUpperCase()}`
}

// === MANAJEMEN USER & BACKUP ===
export async function registerUser(username) {
  const userId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const accessCode = generateUniqueAccessCode()
  
  db.prepare('INSERT INTO users (user_id, username, access_code) VALUES (?, ?, ?)')
    .run(userId, username, accessCode)
  
  // Seed fakta nama user agar langsung diingat
  await addFacts(userId, [`Nama user adalah ${username}`])
  
  return { userId, accessCode }
}

export function getUserByAccessCode(code) {
  if (!code) return null
  const cleanCode = String(code).trim().toUpperCase()
  const row = db.prepare('SELECT user_id, username FROM users WHERE access_code = ?').get(cleanCode)
  return row ? { userId: row.user_id, username: row.username } : null
}

// === RINGKASAN CHAT (S-4: Rolling Summary) ===
export function getChatSummary(userId) {
  const row = db.prepare('SELECT summary FROM chat_summary WHERE user_id = ?').get(uid(userId))
  return row ? row.summary : null
}

function storeChatSummary(userId, summary) {
  db.prepare(`INSERT OR REPLACE INTO chat_summary (user_id, summary, updated_at) VALUES (?, ?, datetime('now'))`).run(uid(userId), summary)
}

export function countChatMessages(userId) {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM chat_history WHERE user_id = ?').get(uid(userId))
  return row ? row.cnt : 0
}

// === RIWAYAT CHAT ===
export function saveChatMessage(userId, role, content) {
  db.prepare('INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)')
    .run(uid(userId), role, content)
}

export function getChatHistory(userId) {
  const rows = db.prepare('SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
    .all(uid(userId))
  return rows.reverse()
}


// === EMOSI / BOND (dipakai server.js buat memulihkan emosi awal tiap user) ===
export function loadMemory(userId) {
  const row = db.prepare('SELECT state FROM emotion WHERE user_id = ?').get(uid(userId))
  return { emotion: row ? JSON.parse(row.state) : null }
}

export function saveEmotion(userId, emotionState) {
  db.prepare(`INSERT INTO emotion (user_id, state, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`).run(uid(userId), JSON.stringify(emotionState))
}

export function captureStructuredMemory(userId, text = '') {
  const u = uid(userId)
  const clean = String(text).trim().slice(0, 500)
  if (!clean) return
  const rows = []
  if (/(aku|saya)\s+(suka|senang|favorit|nggak suka|tidak suka|benci)\b/i.test(clean)) rows.push(['preference', clean, 2])
  if (/(besok|nanti|minggu depan|bulan depan|akan |mau |ingin |rencana|target|janji|ujian|interview|presentasi|daftar)/i.test(clean)) rows.push(['open_loop', clean, 3])
  if (/(ibu|ayah|mama|papa|kakak|adik|teman|sahabat|pacar|gebetan|istri|suami)\b/i.test(clean)) rows.push(['relationship', clean, 2])
  const insert = db.prepare(`INSERT INTO structured_memory (user_id, category, content, importance) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, category, content) DO UPDATE SET importance = MAX(importance, excluded.importance), updated_at = datetime('now')`)
  for (const row of rows) insert.run(u, ...row)
  if (/(sudah|udah|selesai|beres|lulus|diterima|jadi batal|gagal)\b/i.test(clean)) {
    db.prepare(`UPDATE structured_memory SET status = 'resolved', updated_at = datetime('now') WHERE user_id = ? AND category = 'open_loop' AND status = 'active' AND id IN (SELECT id FROM structured_memory WHERE user_id = ? AND category = 'open_loop' AND status = 'active' ORDER BY updated_at DESC LIMIT 2)`).run(u, u)
  }
  db.prepare(`DELETE FROM structured_memory WHERE user_id = ? AND id NOT IN (SELECT id FROM structured_memory WHERE user_id = ? ORDER BY importance DESC, updated_at DESC LIMIT 40)`).run(u, u)
}

// === FAKTA (anti-duplikat per user, simpan MAX_FACTS terbaru) ===
export async function addFacts(userId, facts = []) {
  const u = uid(userId)
  const insert = db.prepare('INSERT OR IGNORE INTO facts (user_id, text, vec) VALUES (?, ?, ?)')
  for (const f of facts) {
    const text = String(f).trim()
    if (!text) continue
    const vec = await embed(text)
    insert.run(u, text, vec ? JSON.stringify(vec) : null)
  }
  db.prepare(`DELETE FROM facts WHERE user_id = ? AND rowid NOT IN (SELECT rowid FROM facts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`).run(u, u, MAX_FACTS)

  // Konsolidasikan fakta menjadi profil pengguna terpadu secara asinkron
  consolidateProfile(userId).catch(() => {})
}

// Konsolidasikan seluruh fakta pengguna menjadi satu profil terpadu
export async function consolidateProfile(userId) {
  const u = uid(userId)
  const rows = db.prepare('SELECT text FROM facts WHERE user_id = ? ORDER BY created_at DESC').all(u)
  if (!rows.length) return
  const factsList = rows.map((r) => r.text)
  const summary = await summarizeProfile(factsList)
  if (summary) {
    db.prepare('INSERT OR REPLACE INTO user_profile (user_id, profile_summary, updated_at) VALUES (?, ?, datetime(\'now\'))')
      .run(u, summary)
  }
}

// === MOMEN EMOSIONAL (per user, simpan MAX_EVENTS terbaru) ===
export async function addEvent(userId, event) {
  if (!event?.summary) return
  const u = uid(userId)
  const vec = await embed(event.summary)
  db.prepare('INSERT INTO events (user_id, summary, mood, vec) VALUES (?, ?, ?, ?)')
    .run(u, event.summary, event.mood || null, vec ? JSON.stringify(vec) : null)
  db.prepare(`DELETE FROM events WHERE user_id = ? AND id NOT IN (SELECT id FROM events WHERE user_id = ? ORDER BY ts DESC LIMIT ?)`).run(u, u, MAX_EVENTS)
}

// === RECALL SEMANTIK (ambil memori paling relevan secara MAKNA, per user) ===
export async function recallMemory(userId, query = '') {
  const u = uid(userId)
  const profileRow = db.prepare('SELECT profile_summary FROM user_profile WHERE user_id = ?').get(u)
  const profile = profileRow ? profileRow.profile_summary : null

  const qvec = await embed(query)
  const facts = db.prepare('SELECT text, vec FROM facts WHERE user_id = ?').all(u)
    .map((r) => ({ text: r.text, vec: parseVec(r.vec) }))
  const events = db.prepare('SELECT summary, vec FROM events WHERE user_id = ?').all(u)
    .map((r) => ({ summary: r.summary, vec: parseVec(r.vec) }))

  // S-2: Selalu ambil 2 event emosional terbaru (apapun relevansinya dengan query)
  const recentEventsRows = db.prepare('SELECT summary, mood FROM events WHERE user_id = ? ORDER BY ts DESC LIMIT 2').all(u)
  // S-4: Ambil ringkasan percakapan lama jika ada
  const chatSummaryRow = db.prepare('SELECT summary FROM chat_summary WHERE user_id = ?').get(u)
  const chatSummary = chatSummaryRow ? chatSummaryRow.summary : null
  const structured = db.prepare(`SELECT category, content, status FROM structured_memory WHERE user_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, importance DESC, updated_at DESC LIMIT 10`).all(u)

  if (qvec) {
    const top = (arr, k) => arr
      .map((it) => ({ it, s: it.vec ? cosineSim(qvec, it.vec) : -1 }))
      .sort((a, b) => b.s - a.s).slice(0, k).filter((x) => x.s > 0.25).map((x) => x.it)
    return { profile, facts: top(facts, TOPK), events: top(events, 3), recentEvents: recentEventsRows, chatSummary, structured }
  }
  return { profile, facts: facts.slice(-TOPK), events: events.slice(-3), recentEvents: recentEventsRows, chatSummary, structured }
}

// Ubah hasil recall jadi konteks untuk system prompt
export function buildMemoryContext(recall) {
  const parts = []
  // S-4: Ringkasan obrolan lama (jika riwayat pernah dipadatkan)
  if (recall?.chatSummary) {
    parts.push(`Ringkasan obrolan sebelumnya (percakapan lama yang sudah diringkas):\n${recall.chatSummary}`)
  }
  if (recall?.profile) {
    parts.push(`Profil pengguna yang telah kamu rangkum (prioritas batinmu):\n${recall.profile}`)
  }
  if (recall?.facts?.length) {
    parts.push(`Fakta spesifik relevan terdeteksi:\n- ${recall.facts.map((f) => f.text).join('\n- ')}`)
  }
  if (recall?.structured?.length) {
    const labels = { preference: 'Preferensi', relationship: 'Orang penting', open_loop: 'Belum selesai' }
    parts.push(`Memori terstruktur (jangan mengarang detail di luar ini):\n${recall.structured.map((item) => `- [${labels[item.category] || item.category}; ${item.status}] ${item.content}`).join('\n')}`)
  }
  // S-2: Event emosional terbaru SELALU muncul, lalu gabung dengan yang relevan semantik
  const recentSet = new Set((recall?.recentEvents || []).map((e) => e.summary))
  const allEvents = [
    ...(recall?.recentEvents || []).map((e) => `[Terbaru] ${e.summary}`),
    ...(recall?.events || []).filter((e) => !recentSet.has(e.summary)).map((e) => `- ${e.summary}`)
  ]
  if (allEvents.length) {
    parts.push(`Momen emosional di hatimu:\n${allEvents.join('\n')}`)
  }
  return parts.join('\n\n')
}

// S-4: Ringkas & pangkas riwayat chat yang sudah terlalu panjang
export async function summarizeAndTrimHistory(userId) {
  const u = uid(userId)
  const total = countChatMessages(userId)
  if (total <= 36) return

  // Ringkas 16 pesan terlama dan pertahankan percakapan terbaru secara mentah.
  const oldMessages = db.prepare('SELECT id, role, content FROM chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 16').all(u)
  if (oldMessages.length < 16) return

  const existingSummary = getChatSummary(userId)
  const newSummary = await summarizeConversation(oldMessages.map((m) => ({ role: m.role, content: m.content })))
  if (!newSummary) return

  // Gabungkan dengan ringkasan lama jika ada
  const combined = existingSummary
    ? `${existingSummary}\n\n[Kelanjutan] ${newSummary}`
    : newSummary
  storeChatSummary(userId, combined.slice(-2500)) // Prioritaskan kelanjutan terbaru saat batas tercapai

  // Hapus pesan yang sudah diringkas dari riwayat
  const ids = oldMessages.map((m) => m.id)
  db.prepare(`DELETE FROM chat_history WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
}
