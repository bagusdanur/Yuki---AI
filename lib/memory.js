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
  CREATE TABLE IF NOT EXISTS relationship_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, bond_value REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, kind, title));
  CREATE TABLE IF NOT EXISTS response_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, message_id INTEGER, rating INTEGER NOT NULL, reason TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS rate_limits (bucket_key TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS comic_bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, format TEXT, genre TEXT, chapter TEXT, score TEXT, image TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, url));
  CREATE TABLE IF NOT EXISTS user_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, category TEXT DEFAULT 'general', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_structured_memory_user ON structured_memory(user_id, category, status);
  CREATE INDEX IF NOT EXISTS idx_relationship_events_user ON relationship_events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_comic_bookmarks_user ON comic_bookmarks(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_user_notes ON user_notes(user_id, category);
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
  return Number(db.prepare('INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)')
    .run(uid(userId), role, content).lastInsertRowid)
}

export function userExists(userId) {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(uid(userId)))
}

export function consumeRateLimit(bucketKey, windowMs, maximum) {
  const key = String(bucketKey).slice(0, 240)
  const now = Date.now()
  const row = db.prepare('SELECT hits, reset_at FROM rate_limits WHERE bucket_key = ?').get(key)
  if (!row || now >= row.reset_at) {
    db.prepare('INSERT OR REPLACE INTO rate_limits (bucket_key, hits, reset_at) VALUES (?, 1, ?)').run(key, now + windowMs)
    return { allowed: true, remaining: maximum - 1, resetAt: now + windowMs }
  }
  const hits = row.hits + 1
  db.prepare('UPDATE rate_limits SET hits = ? WHERE bucket_key = ?').run(hits, key)
  return { allowed: hits <= maximum, remaining: Math.max(0, maximum - hits), resetAt: row.reset_at }
}

export function pruneRateLimits() {
  db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(Date.now() - 60_000)
}

export function deleteUserData(userId) {
  const u = uid(userId)
  const tables = ['facts', 'events', 'emotion', 'user_profile', 'chat_history', 'chat_summary', 'structured_memory', 'relationship_events', 'response_feedback', 'comic_bookmarks', 'users']
  db.exec('BEGIN')
  try {
    for (const table of tables) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(u)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

// === BOOKMARK KOMIK RYUKOMIK ===
export function saveComicBookmark(userId, comic = {}) {
  const u = uid(userId)
  const title = String(comic.title || '').trim()
  const url = String(comic.url || '').trim()
  if (!title || !url) throw new Error('Data komik tidak lengkap.')

  db.prepare(`
    INSERT INTO comic_bookmarks (user_id, title, url, format, genre, chapter, score, image, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, url) DO UPDATE SET
      title = excluded.title,
      format = excluded.format,
      genre = excluded.genre,
      chapter = excluded.chapter,
      score = excluded.score,
      image = excluded.image,
      created_at = datetime('now')
  `).run(
    u,
    title,
    url,
    comic.format || 'KOMIK',
    comic.type || comic.genre || '',
    comic.chapter || '',
    comic.score || '',
    comic.image || ''
  )

  // Simpan ke memori preferensi terstruktur agar Yuki mengenali komik favorit user
  try {
    db.prepare(`
      INSERT INTO structured_memory (user_id, category, content, importance)
      VALUES (?, 'preference', ?, 3)
      ON CONFLICT(user_id, category, content) DO UPDATE SET importance = 3, updated_at = datetime('now')
    `).run(u, `User menyimpan komik "${title}" (${comic.format || 'Komik'}) ke daftar bacaan`)
  } catch {}

  return getComicBookmarks(userId)
}

export function getComicBookmarks(userId) {
  return db.prepare(`
    SELECT title, url, format, genre AS type, chapter, score, image, created_at AS createdAt
    FROM comic_bookmarks
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(uid(userId))
}

export function deleteComicBookmark(userId, comicUrl) {
  const u = uid(userId)
  db.prepare('DELETE FROM comic_bookmarks WHERE user_id = ? AND url = ?').run(u, String(comicUrl || '').trim())
  return getComicBookmarks(userId)
}

// === USER NOTES / TASKS (Dipakai oleh Mode Agent / Task Planner Skill) ===
export function saveUserNote(userId, { title, content, category = 'general' }) {
  const u = uid(userId)
  const cleanTitle = String(title || '').trim().slice(0, 150)
  const cleanContent = String(content || '').trim().slice(0, 2000)
  const cleanCat = String(category || 'general').trim().toLowerCase().slice(0, 50)
  if (!cleanTitle || !cleanContent) throw new Error('Judul dan isi catatan tidak boleh kosong.')

  const info = db.prepare(`
    INSERT INTO user_notes (user_id, title, content, category, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(u, cleanTitle, cleanContent, cleanCat)

  return { id: Number(info.lastInsertRowid), title: cleanTitle, content: cleanContent, category: cleanCat }
}

export function getUserNotes(userId, category = null) {
  const u = uid(userId)
  if (category) {
    return db.prepare(`
      SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt
      FROM user_notes
      WHERE user_id = ? AND category = ?
      ORDER BY updated_at DESC
    `).all(u, String(category).trim().toLowerCase())
  }
  return db.prepare(`
    SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt
    FROM user_notes
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(u)
}

export function searchUserNotes(userId, query = '') {
  const u = uid(userId)
  const q = `%${String(query || '').trim()}%`
  return db.prepare(`
    SELECT id, title, content, category, created_at AS createdAt, updated_at AS updatedAt
    FROM user_notes
    WHERE user_id = ? AND (title LIKE ? OR content LIKE ?)
    ORDER BY updated_at DESC LIMIT 20
  `).all(u, q, q)
}

export function deleteUserNote(userId, noteId) {
  const u = uid(userId)
  db.prepare('DELETE FROM user_notes WHERE user_id = ? AND id = ?').run(u, Number(noteId))
  return { ok: true }
}


export function getAdminStats() {
  const scalar = (sql) => Number(db.prepare(sql).get()?.value || 0)
  const users = scalar('SELECT COUNT(*) AS value FROM users')
  const messages = scalar('SELECT COUNT(*) AS value FROM chat_history')
  const feedbackPositive = scalar('SELECT COUNT(*) AS value FROM response_feedback WHERE rating = 1')
  const feedbackNegative = scalar('SELECT COUNT(*) AS value FROM response_feedback WHERE rating = -1')
  const activeToday = scalar(`SELECT COUNT(DISTINCT user_id) AS value FROM chat_history WHERE created_at >= datetime('now', '-1 day')`)
  const recent = db.prepare(`SELECT u.username, COUNT(h.id) AS messages, MAX(h.created_at) AS lastActive FROM users u LEFT JOIN chat_history h ON h.user_id = u.user_id GROUP BY u.user_id ORDER BY lastActive DESC LIMIT 20`).all()
  const bonds = db.prepare('SELECT state FROM emotion').all().map(row => { try { return Number(JSON.parse(row.state).bond || 0) } catch { return 0 } })
  return { users, messages, activeToday, feedbackPositive, feedbackNegative, averageBond: bonds.length ? bonds.reduce((a, b) => a + b, 0) / bonds.length : 0, recent }
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
  if (/(biasanya|kebiasaan|tiap hari|setiap hari|sering |jarang |selalu )/i.test(clean)) rows.push(['habit', clean, 2])
  if (/(janji|ingatkan aku|jangan lupa|tanggal penting|ulang tahun)/i.test(clean)) rows.push(['promise', clean, 4])
  if (/(besok|nanti|minggu depan|bulan depan|akan |mau |ingin |rencana|target|janji|ujian|interview|presentasi|daftar)/i.test(clean)) rows.push(['open_loop', clean, 3])
  if (/(ibu|ayah|mama|papa|kakak|adik|teman|sahabat|pacar|gebetan|istri|suami)\b/i.test(clean)) rows.push(['relationship', clean, 2])
  const insert = db.prepare(`INSERT INTO structured_memory (user_id, category, content, importance) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, category, content) DO UPDATE SET importance = MAX(importance, excluded.importance), updated_at = datetime('now')`)
  for (const row of rows) insert.run(u, ...row)
  if (/(sudah|udah|selesai|beres|lulus|diterima|jadi batal|gagal)\b/i.test(clean)) {
    db.prepare(`UPDATE structured_memory SET status = 'resolved', updated_at = datetime('now') WHERE user_id = ? AND category = 'open_loop' AND status = 'active' AND id IN (SELECT id FROM structured_memory WHERE user_id = ? AND category = 'open_loop' AND status = 'active' ORDER BY updated_at DESC LIMIT 2)`).run(u, u)
  }
  db.prepare(`DELETE FROM structured_memory WHERE user_id = ? AND id NOT IN (SELECT id FROM structured_memory WHERE user_id = ? ORDER BY importance DESC, updated_at DESC LIMIT 40)`).run(u, u)
}

export function recordRelationshipEvent(userId, kind, title, detail = '', bondValue = 0) {
  db.prepare(`INSERT OR IGNORE INTO relationship_events (user_id, kind, title, detail, bond_value) VALUES (?, ?, ?, ?, ?)`).run(uid(userId), kind, title, String(detail).slice(0, 500), Number(bondValue) || 0)
}

export function getRelationshipEvents(userId) {
  return db.prepare(`SELECT kind, title, detail, bond_value AS bondValue, created_at AS createdAt FROM relationship_events WHERE user_id = ? ORDER BY created_at ASC, id ASC`).all(uid(userId))
}

export function recordConversationEvent(userId, text = '', bondValue = 0) {
  const clean = String(text).trim()
  if (!clean) return
  if (/(maaf|minta maaf|aku salah|saya salah)/i.test(clean)) recordRelationshipEvent(userId, 'repair', 'Mencoba memperbaiki hubungan', clean, bondValue)
  if (/(bodoh|tolol|goblok|benci kamu|pergi sana|diam kamu|brengsek)/i.test(clean)) recordRelationshipEvent(userId, 'conflict', 'Hubungan sempat memanas', clean, bondValue)
  if (/(rahasia|jangan bilang siapa-siapa|cuma kamu yang tahu|aku percaya kamu)/i.test(clean)) recordRelationshipEvent(userId, 'trust', 'Mulai saling percaya', clean, bondValue)
}

export function syncBondMilestones(userId, bondValue = 0) {
  const milestones = [
    [0, 'first_meeting', 'Pertama bertemu'], [8, 'familiar', 'Mulai terbiasa'],
    [24, 'caring', 'Diam-diam peduli'], [50, 'close', 'Mulai terbuka'], [78, 'partner', 'Menjadi pasangan']
  ]
  for (const [minimum, kind, title] of milestones) {
    if (bondValue >= minimum) recordRelationshipEvent(userId, kind, title, '', bondValue)
  }
  return getRelationshipEvents(userId)
}

export function saveResponseFeedback(userId, messageId, rating, reason = '') {
  db.prepare('INSERT INTO response_feedback (user_id, message_id, rating, reason) VALUES (?, ?, ?, ?)').run(uid(userId), Number(messageId) || null, rating > 0 ? 1 : -1, String(reason).slice(0, 300))
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
  const relationshipEvents = db.prepare(`SELECT kind, title, detail FROM relationship_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 6`).all(u)
  const feedback = db.prepare(`SELECT rating FROM response_feedback WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12`).all(u)

  if (qvec) {
    const top = (arr, k) => arr
      .map((it) => ({ it, s: it.vec ? cosineSim(qvec, it.vec) : -1 }))
      .sort((a, b) => b.s - a.s).slice(0, k).filter((x) => x.s > 0.25).map((x) => x.it)
    return { profile, facts: top(facts, TOPK), events: top(events, 3), recentEvents: recentEventsRows, chatSummary, structured, relationshipEvents, feedback }
  }
  return { profile, facts: facts.slice(-TOPK), events: events.slice(-3), recentEvents: recentEventsRows, chatSummary, structured, relationshipEvents, feedback }
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
    const labels = { preference: 'Preferensi', habit: 'Kebiasaan', promise: 'Janji penting', relationship: 'Orang penting', open_loop: 'Belum selesai' }
    parts.push(`Memori terstruktur (jangan mengarang detail di luar ini):\n${recall.structured.map((item) => `- [${labels[item.category] || item.category}; ${item.status}] ${item.content}`).join('\n')}`)
  }
  if (recall?.relationshipEvents?.length) {
    parts.push(`Sejarah hubungan yang benar-benar pernah terjadi:\n${recall.relationshipEvents.map((item) => `- ${item.title}${item.detail ? `: ${item.detail}` : ''}`).join('\n')}`)
  }
  if (recall?.feedback?.length) {
    const negative = recall.feedback.filter((item) => item.rating < 0).length
    if (negative >= Math.ceil(recall.feedback.length / 2)) parts.push('Belakangan beberapa balasanmu terasa kurang cocok. Utamakan respons langsung, utuh, tidak repetitif, dan kurangi gestur teatrikal.')
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
