import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { embed, cosineSim } from './semantic.js'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
const MAX_FACTS = Number(process.env.MEMORY_MAX_FACTS || 60)
const MAX_EVENTS = Number(process.env.MEMORY_MAX_EVENTS || 30)
const TOPK = Number(process.env.RECALL_TOPK || 5)

// Satu file database untuk SEMUA user; tiap baris ditandai user_id -> memori terpisah.
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec('PRAGMA journal_mode = WAL')

db.exec(`CREATE TABLE IF NOT EXISTS facts (user_id TEXT NOT NULL, text TEXT NOT NULL, vec TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, text)); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, summary TEXT NOT NULL, mood TEXT, vec TEXT, ts TEXT DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS emotion (user_id TEXT PRIMARY KEY, state TEXT, updated_at TEXT); CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id); CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);`)

const uid = (u) => String(u || 'anon').slice(0, 64)
const parseVec = (s) => { try { return s ? JSON.parse(s) : null } catch { return null } }

// === EMOSI / BOND (dipakai server.js buat memulihkan emosi awal tiap user) ===
export function loadMemory(userId) {
  const row = db.prepare('SELECT state FROM emotion WHERE user_id = ?').get(uid(userId))
  return { emotion: row ? JSON.parse(row.state) : null }
}

export function saveEmotion(userId, emotionState) {
  db.prepare(`INSERT INTO emotion (user_id, state, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`).run(uid(userId), JSON.stringify(emotionState))
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
  const qvec = await embed(query)
  const facts = db.prepare('SELECT text, vec FROM facts WHERE user_id = ?').all(u)
    .map((r) => ({ text: r.text, vec: parseVec(r.vec) }))
  const events = db.prepare('SELECT summary, vec FROM events WHERE user_id = ?').all(u)
    .map((r) => ({ summary: r.summary, vec: parseVec(r.vec) }))

  if (qvec) {
    const top = (arr, k) => arr
      .map((it) => ({ it, s: it.vec ? cosineSim(qvec, it.vec) : -1 }))
      .sort((a, b) => b.s - a.s).slice(0, k).filter((x) => x.s > 0.25).map((x) => x.it)
    return { facts: top(facts, TOPK), events: top(events, 3) }
  }
  return { facts: facts.slice(-TOPK), events: events.slice(-3) }
}

// Ubah hasil recall jadi konteks untuk system prompt
export function buildMemoryContext(recall) {
  const parts = []
  if (recall?.facts?.length) {
    parts.push(`Yang kamu ingat tentang dia:\n- ${recall.facts.map((f) => f.text).join('\n- ')}`)
  }
  if (recall?.events?.length) {
    const recent = recall.events.map((e) => `- ${e.summary}`).join('\n')
    parts.push(`Momen yang membekas di hatimu:\n${recent}`)
  }
  return parts.join('\n\n')
}