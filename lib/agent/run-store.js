import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

const TERMINAL = new Set(['succeeded', 'partially_succeeded', 'failed', 'cancelled'])
const ACTIVE = ['queued', 'planning', 'running', 'resuming', 'verifying', 'awaiting_approval']

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    request_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'queued',
    result_json TEXT,
    error_code TEXT,
    cancel_requested_at TEXT,
    lease_owner TEXT,
    lease_expires_at INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_run_steps (
    request_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (request_id, step_id),
    FOREIGN KEY (request_id) REFERENCES agent_runs(request_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_user_state ON agent_runs(user_id, state, updated_at);
  CREATE INDEX IF NOT EXISTS idx_agent_steps_run_sequence ON agent_run_steps(request_id, sequence);
`)

const cleanId = value => String(value || '').slice(0, 80)
const cleanUser = value => String(value || '').slice(0, 64)
const parseJson = value => { try { return value ? JSON.parse(value) : null } catch { return null } }

function serialize(row) {
  if (!row) return null
  const steps = db.prepare('SELECT payload_json FROM agent_run_steps WHERE request_id = ? ORDER BY sequence, updated_at').all(row.request_id).map(item => parseJson(item.payload_json)).filter(Boolean)
  return {
    requestId: row.request_id, userId: row.user_id, goal: row.goal, state: row.state,
    done: TERMINAL.has(row.state), steps, result: parseJson(row.result_json), errorCode: row.error_code || undefined,
    cancelRequested: Boolean(row.cancel_requested_at), createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined
  }
}

export function createOrGetAgentRun({ requestId, userId, goal = '' }) {
  requestId = cleanId(requestId); userId = cleanUser(userId)
  if (!requestId || !userId) throw new Error('requestId dan userId wajib diisi')
  const existing = db.prepare('SELECT * FROM agent_runs WHERE request_id = ?').get(requestId)
  if (existing && existing.user_id !== userId) return null
  db.prepare(`INSERT OR IGNORE INTO agent_runs (request_id, user_id, goal, state) VALUES (?, ?, ?, 'queued')`).run(requestId, userId, String(goal).slice(0, 2000))
  return getAgentRun(requestId, userId)
}

export function getAgentRun(requestId, userId) {
  return serialize(db.prepare('SELECT * FROM agent_runs WHERE request_id = ? AND user_id = ?').get(cleanId(requestId), cleanUser(userId)))
}

export function getActiveAgentRun(userId) {
  const marks = ACTIVE.map(() => '?').join(',')
  return serialize(db.prepare(`SELECT * FROM agent_runs WHERE user_id = ? AND state IN (${marks}) ORDER BY updated_at DESC LIMIT 1`).get(cleanUser(userId), ...ACTIVE))
}

export function setAgentRunState(requestId, userId, state, { result, errorCode } = {}) {
  const terminal = TERMINAL.has(state)
  db.prepare(`UPDATE agent_runs SET state = ?, result_json = COALESCE(?, result_json), error_code = ?, updated_at = datetime('now'), completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE request_id = ? AND user_id = ?`).run(
    state, result === undefined ? null : JSON.stringify(result), errorCode || null, terminal ? 1 : 0, cleanId(requestId), cleanUser(userId)
  )
  return getAgentRun(requestId, userId)
}

export function upsertAgentRunStep(requestId, userId, step) {
  const run = getAgentRun(requestId, userId)
  if (!run) return null
  const payload = {
    id: String(step.id || ''), tool: String(step.tool || 'agent_core'), title: String(step.title || 'Memproses tugas').slice(0, 300),
    status: ['queued', 'planning', 'running', 'awaiting_approval', 'resuming', 'verifying', 'done', 'error', 'cancelled'].includes(step.status) ? step.status : 'running',
    durationMs: Number.isFinite(step.durationMs) ? step.durationMs : undefined,
    skillName: step.skillName ? String(step.skillName).slice(0, 100) : undefined,
    skillTitle: step.skillTitle ? String(step.skillTitle).slice(0, 100) : undefined,
    approval: step.approval?.id ? { id: String(step.approval.id), reason: String(step.approval.reason || '').slice(0, 300), status: step.approval.status || 'pending' } : undefined,
    evidence: Array.isArray(step.evidence) ? step.evidence.slice(0, 8) : undefined
  }
  const old = db.prepare('SELECT sequence FROM agent_run_steps WHERE request_id = ? AND step_id = ?').get(run.requestId, payload.id)
  const sequence = old?.sequence ?? Number(db.prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS value FROM agent_run_steps WHERE request_id = ?').get(run.requestId).value)
  db.prepare(`INSERT INTO agent_run_steps (request_id, step_id, sequence, payload_json) VALUES (?, ?, ?, ?) ON CONFLICT(request_id, step_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = datetime('now')`).run(run.requestId, payload.id, sequence, JSON.stringify(payload))
  if (payload.status === 'awaiting_approval') setAgentRunState(run.requestId, userId, 'awaiting_approval')
  else if (['planning', 'running', 'resuming', 'verifying'].includes(payload.status)) setAgentRunState(run.requestId, userId, payload.status)
  return payload
}

export function requestAgentRunCancellation(requestId, userId) {
  const result = db.prepare(`UPDATE agent_runs SET cancel_requested_at = datetime('now'), state = CASE WHEN state IN ('succeeded','partially_succeeded','failed','cancelled') THEN state ELSE 'cancelled' END, completed_at = CASE WHEN state IN ('succeeded','partially_succeeded','failed') THEN completed_at ELSE datetime('now') END, updated_at = datetime('now') WHERE request_id = ? AND user_id = ?`).run(cleanId(requestId), cleanUser(userId))
  return result.changes > 0 ? getAgentRun(requestId, userId) : null
}

export function isAgentRunCancellationRequested(requestId, userId) {
  return Boolean(db.prepare('SELECT cancel_requested_at FROM agent_runs WHERE request_id = ? AND user_id = ?').get(cleanId(requestId), cleanUser(userId))?.cancel_requested_at)
}

export function claimAgentRun(requestId, userId, owner, leaseMs = 180000) {
  const now = Date.now()
  const result = db.prepare(`UPDATE agent_runs SET lease_owner = ?, lease_expires_at = ?, state = 'planning', updated_at = datetime('now') WHERE request_id = ? AND user_id = ? AND cancel_requested_at IS NULL AND state IN ('queued','planning','running','resuming','verifying') AND (lease_expires_at IS NULL OR lease_expires_at < ? OR lease_owner = ?)`).run(String(owner).slice(0, 100), now + leaseMs, cleanId(requestId), cleanUser(userId), now, String(owner).slice(0, 100))
  return result.changes > 0
}

export function recoverInterruptedAgentRuns() {
  return db.prepare(`UPDATE agent_runs SET state = 'failed', error_code = 'PROCESS_RESTARTED', completed_at = datetime('now'), updated_at = datetime('now') WHERE state IN ('planning','running','resuming','verifying')`).run().changes
}

export function deleteUserAgentRuns(userId) {
  return db.prepare('DELETE FROM agent_runs WHERE user_id = ?').run(cleanUser(userId)).changes
}
