import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'user',
    scope_id TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 1,
    confidence REAL NOT NULL DEFAULT 0.75,
    source_message_id INTEGER,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, scope_type, scope_id, category, content)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_memories_scope ON agent_memories(user_id, scope_type, scope_id, status);
  CREATE TABLE IF NOT EXISTS memory_settings (
    user_id TEXT PRIMARY KEY,
    auto_capture INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`)

const user = value => String(value || '').slice(0, 80)
const allowedScopes = new Set(['user', 'project', 'task', 'lesson'])
const allowedStatuses = new Set(['active', 'resolved', 'archived'])
const parseEvidence = value => { try { return JSON.parse(value || '[]') } catch { return [] } }
const mapRow = row => row ? ({ ...row, evidence: parseEvidence(row.evidence_json), evidence_json: undefined, auto_capture: row.auto_capture === undefined ? undefined : Boolean(row.auto_capture) }) : null

export function getMemorySettings(userId) {
  const row = db.prepare('SELECT auto_capture, updated_at FROM memory_settings WHERE user_id = ?').get(user(userId))
  return { autoCapture: row ? Boolean(row.auto_capture) : true, updatedAt: row?.updated_at || null }
}

export function setMemorySettings(userId, { autoCapture }) {
  db.prepare(`INSERT INTO memory_settings (user_id, auto_capture, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET auto_capture = excluded.auto_capture, updated_at = datetime('now')`).run(user(userId), autoCapture ? 1 : 0)
  return getMemorySettings(userId)
}

export function listAgentMemories(userId, { scopeType = '', scopeId = '', status = '' } = {}) {
  const clauses = ['user_id = ?']; const args = [user(userId)]
  if (scopeType && allowedScopes.has(scopeType)) { clauses.push('scope_type = ?'); args.push(scopeType) }
  if (scopeId) { clauses.push('scope_id = ?'); args.push(String(scopeId).slice(0, 120)) }
  if (status && allowedStatuses.has(status)) { clauses.push('status = ?'); args.push(status) }
  return db.prepare(`SELECT id, scope_type AS scopeType, scope_id AS scopeId, category, content, importance, confidence,
    source_message_id AS sourceMessageId, evidence_json, status, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt
    FROM agent_memories WHERE ${clauses.join(' AND ')} ORDER BY status = 'active' DESC, importance DESC, updated_at DESC LIMIT 200`).all(...args).map(mapRow)
}

export function saveAgentMemory({ userId, scopeType = 'user', scopeId = '', category, content, importance = 1, confidence = 0.75, sourceMessageId = null, evidence = [], expiresAt = null }) {
  const u = user(userId); const scope = allowedScopes.has(scopeType) ? scopeType : 'user'
  const clean = String(content || '').trim().slice(0, 1000); const cat = String(category || 'general').trim().toLowerCase().slice(0, 60)
  if (!u || !clean) return null
  const safeEvidence = Array.isArray(evidence) ? evidence.slice(0, 8).map(item => ({ kind: String(item?.kind || 'message').slice(0, 30), ref: String(item?.ref || '').slice(0, 160) })) : []
  db.prepare(`INSERT INTO agent_memories (user_id, scope_type, scope_id, category, content, importance, confidence, source_message_id, evidence_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, scope_type, scope_id, category, content) DO UPDATE SET importance = MAX(importance, excluded.importance),
    confidence = MAX(confidence, excluded.confidence), evidence_json = excluded.evidence_json, updated_at = datetime('now')`).run(
    u, scope, String(scopeId || '').slice(0, 120), cat, clean, Math.max(1, Math.min(5, Number(importance) || 1)), Math.max(0, Math.min(1, Number(confidence) || 0)),
    Number(sourceMessageId) || null, JSON.stringify(safeEvidence), expiresAt || null
  )
  return listAgentMemories(u, { scopeType: scope }).find(item => item.category === cat && item.content === clean) || null
}

export function updateAgentMemory(memoryId, userId, patch = {}) {
  const current = db.prepare('SELECT * FROM agent_memories WHERE id = ? AND user_id = ?').get(Number(memoryId), user(userId))
  if (!current) return null
  const content = String(patch.content ?? current.content).trim().slice(0, 1000)
  const status = allowedStatuses.has(patch.status) ? patch.status : current.status
  const importance = Math.max(1, Math.min(5, Number(patch.importance ?? current.importance) || 1))
  db.prepare(`UPDATE agent_memories SET content = ?, status = ?, importance = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(content, status, importance, Number(memoryId), user(userId))
  return listAgentMemories(userId).find(item => item.id === Number(memoryId)) || null
}

export function deleteAgentMemory(memoryId, userId) {
  return db.prepare('DELETE FROM agent_memories WHERE id = ? AND user_id = ?').run(Number(memoryId), user(userId)).changes > 0
}

export function captureMemoryCandidates(userId, text, sourceMessageId = null) {
  if (!getMemorySettings(userId).autoCapture) return []
  const clean = String(text || '').trim().slice(0, 700); if (!clean) return []
  const candidates = []
  if (/(aku|saya)\s+(suka|senang|favorit|nggak suka|tidak suka|benci)\b/i.test(clean)) candidates.push(['preference', 3, .92])
  if (/(biasanya|kebiasaan|tiap hari|setiap hari|sering |jarang |selalu )/i.test(clean)) candidates.push(['habit', 2, .84])
  if (/(target|rencana|ingin|mau|besok|minggu depan|bulan depan|janji)/i.test(clean)) candidates.push(['open_loop', 3, .78])
  if (/(ibu|ayah|mama|papa|kakak|adik|teman|sahabat|pacar|istri|suami)\b/i.test(clean)) candidates.push(['relationship', 2, .8])
  return candidates.map(([category, importance, confidence]) => saveAgentMemory({ userId, category, content: clean, importance, confidence, sourceMessageId, evidence: [{ kind: 'message', ref: sourceMessageId ? `chat:${sourceMessageId}` : 'current-user-message' }] })).filter(Boolean)
}

export function saveVerifiedLesson({ userId, scopeId = '', content, evidence = [], category = 'technical' }) {
  if (!Array.isArray(evidence) || !evidence.some(item => ['record', 'file', 'stdout', 'http', 'artifact'].includes(item?.kind))) return { success: false, error: 'Lesson membutuhkan evidence hasil tool yang terverifikasi.' }
  return { success: true, memory: saveAgentMemory({ userId, scopeType: 'lesson', scopeId, category, content, importance: 4, confidence: .95, evidence }) }
}

export function deleteAgentMemoryData(userId) {
  db.prepare('DELETE FROM agent_memories WHERE user_id = ?').run(user(userId)); db.prepare('DELETE FROM memory_settings WHERE user_id = ?').run(user(userId))
}
