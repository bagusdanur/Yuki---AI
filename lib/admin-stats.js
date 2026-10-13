import 'dotenv/config'
import { dbHandle } from './memory.js'

const db = dbHandle

const scalar = (sql, params = []) => {
  try { return Number(db.prepare(sql).get(...params)?.value || 0) } catch { return 0 }
}

function safeAll(sql, params = []) {
  try { return db.prepare(sql).all(...params) || [] } catch { return [] }
}

/**
 * Statistik database yang dipakai kartu Overview & panel Laporan.
 * Semua angka dihitung dari SQLite lokal (tidak butuh internet).
 */
export function getDatabaseStats() {
  const users = scalar('SELECT COUNT(*) AS value FROM users')
  const messages = scalar('SELECT COUNT(*) AS value FROM chat_history')
  const activeToday = scalar(`SELECT COUNT(DISTINCT user_id) AS value FROM chat_history WHERE created_at >= datetime('now', '-1 day')`)
  const activeWeek = scalar(`SELECT COUNT(DISTINCT user_id) AS value FROM chat_history WHERE created_at >= datetime('now', '-7 day')`)

  const userMessages = scalar(`SELECT COUNT(*) AS value FROM chat_history WHERE role = 'user'`)
  const assistantMessages = scalar(`SELECT COUNT(*) AS value FROM chat_history WHERE role = 'assistant'`)
  const agentMessages = scalar(`SELECT COUNT(*) AS value FROM chat_history WHERE mode = 'agent'`)

  const facts = scalar('SELECT COUNT(*) AS value FROM facts')
  const structuredMemory = scalar('SELECT COUNT(*) AS value FROM structured_memory')
  const agentMemories = scalar('SELECT COUNT(*) AS value FROM agent_memories')
  const events = scalar('SELECT COUNT(*) AS value FROM events')
  const relationshipEvents = scalar('SELECT COUNT(*) AS value FROM relationship_events')

  const feedbackPositive = scalar('SELECT COUNT(*) AS value FROM response_feedback WHERE rating = 1')
  const feedbackNegative = scalar('SELECT COUNT(*) AS value FROM response_feedback WHERE rating = -1')
  const feedbackTotal = feedbackPositive + feedbackNegative

  const scheduledTasks = scalar('SELECT COUNT(*) AS value FROM scheduled_tasks')
  const scheduledDone = scalar(`SELECT COUNT(*) AS value FROM scheduled_occurrences WHERE status = 'done'`)
  const bookmarks = scalar('SELECT COUNT(*) AS value FROM comic_bookmarks')
  const artifacts = scalar('SELECT COUNT(*) AS value FROM user_artifacts')

  const agentRuns = scalar('SELECT COUNT(*) AS value FROM agent_runs')
  const agentSteps = scalar('SELECT COUNT(*) AS value FROM agent_run_steps')
  const selfImprovements = scalar('SELECT COUNT(*) AS value FROM self_improvements')
  const summaries = scalar('SELECT COUNT(*) AS value FROM chat_summary')

  const newUsersToday = scalar(`SELECT COUNT(*) AS value FROM users WHERE created_at >= datetime('now', '-1 day')`)
  const newUsersWeek = scalar(`SELECT COUNT(*) AS value FROM users WHERE created_at >= datetime('now', '-7 day')`)

  let bonds = []
  try {
    bonds = db.prepare('SELECT state FROM emotion').all().map(row => {
      try { return Number(JSON.parse(row.state).bond || 0) } catch { return 0 }
    })
  } catch { bonds = [] }
  const averageBond = bonds.length ? bonds.reduce((a, b) => a + b, 0) / bonds.length : 0

  return {
    users, messages, activeToday, activeWeek,
    userMessages, assistantMessages, agentMessages,
    facts, structuredMemory, agentMemories, events, relationshipEvents,
    feedbackPositive, feedbackNegative, feedbackTotal,
    scheduledTasks, scheduledDone, bookmarks, artifacts,
    agentRuns, agentSteps, selfImprovements, summaries,
    newUsersToday, newUsersWeek,
    averageBond,
    memoryTotal: facts + structuredMemory + agentMemories
  }
}

/** Tren 30 hari dari tabel chat_history. */
export function getChatTrend(days = 30) {
  const rows = safeAll(`
    SELECT date(created_at) AS date,
           COUNT(*) AS messages,
           COUNT(DISTINCT user_id) AS users
    FROM chat_history
    WHERE created_at >= datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY date ASC
  `, [`-${Number(days) || 30} day`])

  const map = new Map(rows.map(r => [r.date, r]))
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    const key = d.toISOString().slice(0, 10)
    const row = map.get(key)
    out.push({ date: key, messages: Number(row?.messages || 0), users: Number(row?.users || 0) })
  }
  return out
}

/** Aktivitas per jam (24 jam terakhir) untuk grafik kecil. */
export function getHourlyActivity() {
  const rows = safeAll(`
    SELECT strftime('%H', created_at) AS hour, COUNT(*) AS messages
    FROM chat_history
    WHERE created_at >= datetime('now', '-1 day')
    GROUP BY hour ORDER BY hour ASC
  `)
  const map = new Map(rows.map(r => [String(r.hour).padStart(2, '0'), Number(r.messages)]))
  const out = []
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, '0')
    out.push({ hour: `${key}:00`, messages: map.get(key) || 0 })
  }
  return out
}

/** Pengguna paling aktif (untuk tabel ringkas Overview). */
export function getTopUsers(limit = 8) {
  return safeAll(`
    SELECT u.username, u.user_id AS userId,
           COUNT(h.id) AS messages,
           MAX(h.created_at) AS lastActive
    FROM users u
    LEFT JOIN chat_history h ON h.user_id = u.user_id
    GROUP BY u.user_id
    ORDER BY messages DESC, lastActive DESC
    LIMIT ?
  `, [limit]).map(r => ({
    username: r.username || 'tanpa nama',
    userId: r.userId,
    messages: Number(r.messages || 0),
    lastActive: r.lastActive || null
  }))
}

/** Pengguna terbaru yang bergabung. */
export function getRecentUsers(limit = 6) {
  return safeAll(`
    SELECT username, user_id AS userId, created_at AS createdAt
    FROM users ORDER BY created_at DESC LIMIT ?
  `, [limit]).map(r => ({
    username: r.username || 'tanpa nama',
    userId: r.userId,
    createdAt: r.createdAt
  }))
}

/** Distribusi emosi/bond pengguna. */
export function getEmotionDistribution() {
  let rows = []
  try { rows = db.prepare('SELECT state FROM emotion').all() } catch { return [] }
  const buckets = { asing: 0, kenalan: 0, dekat: 0, sahabat: 0, istimewa: 0 }
  for (const row of rows) {
    let bond = 0
    try { bond = Number(JSON.parse(row.state).bond || 0) } catch { bond = 0 }
    if (bond < 5) buckets.asing++
    else if (bond < 15) buckets.kenalan++
    else if (bond < 30) buckets.dekat++
    else if (bond < 60) buckets.sahabat++
    else buckets.istimewa++
  }
  return Object.entries(buckets).map(([label, value]) => ({ label, value }))
}

/** Ukuran database & tabel terbesar. */
export function getStorageInfo() {
  let total = 0
  try {
    const page = db.prepare('PRAGMA page_count').get()
    const size = db.prepare('PRAGMA page_size').get()
    total = Number(page?.page_count || 0) * Number(size?.page_size || 0)
  } catch { total = 0 }
  const tables = ['chat_history', 'facts', 'structured_memory', 'agent_memories', 'events'].map(name => ({
    name,
    rows: scalar(`SELECT COUNT(*) AS value FROM ${name}`)
  }))
  return { bytes: total, tables }
}
