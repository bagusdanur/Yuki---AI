import crypto from 'node:crypto'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_workflows (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    checkpoint_json TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_workflows_user_state ON agent_workflows(user_id, state, updated_at);
  CREATE INDEX IF NOT EXISTS idx_agent_workflows_request ON agent_workflows(request_id, user_id);
`)

const STATES = new Set(['queued', 'planning', 'running', 'awaiting_approval', 'resuming', 'verifying', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'])
const json = value => JSON.stringify(value ?? null)
const parse = value => { try { return value ? JSON.parse(value) : null } catch { return null } }
const stable = value => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}

export function normalizedInputHash(toolName, args) {
  return crypto.createHash('sha256').update(`${toolName}:${json(stable(args))}`).digest('hex')
}

export function createApprovalCheckpoint({ requestId, userId, toolName, args, reason, resume }) {
  pruneExpiredWorkflows()
  const id = crypto.randomBytes(18).toString('base64url')
  const stepId = resume?.stepId || `step_${Date.now()}`
  const idempotencyKey = `${requestId}:${stepId}:${normalizedInputHash(toolName, args)}`
  const existing = db.prepare("SELECT id FROM agent_workflows WHERE idempotency_key = ? AND state IN ('awaiting_approval', 'resuming', 'succeeded', 'partially_succeeded')").get(idempotencyKey)
  if (existing) {
    const workflow = getWorkflow(existing.id, userId)
    return { id: existing.id, workflowId: existing.id, reason: workflow?.checkpoint?.reason || reason, status: workflow?.state === 'awaiting_approval' ? 'pending' : 'approved', state: workflow?.state }
  }
  const now = new Date()
  const checkpoint = { toolName, args, reason, stepId, resume }
  db.prepare(`INSERT INTO agent_workflows
    (id, request_id, user_id, state, idempotency_key, checkpoint_json, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, 'awaiting_approval', ?, ?, ?, ?, ?)`)
    .run(id, String(requestId), String(userId), idempotencyKey, json(checkpoint), now.toISOString(), now.toISOString(), new Date(now.getTime() + 24 * 3600_000).toISOString())
  return { id, workflowId: id, reason, status: 'pending', state: 'awaiting_approval' }
}

export function getWorkflow(id, userId) {
  const row = db.prepare('SELECT * FROM agent_workflows WHERE id = ? AND user_id = ?').get(String(id), String(userId))
  if (!row) return null
  return { id: row.id, requestId: row.request_id, userId: row.user_id, state: row.state, idempotencyKey: row.idempotency_key,
    checkpoint: parse(row.checkpoint_json), result: parse(row.result_json), error: row.error, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at }
}

export function claimWorkflow(id, userId) {
  const workflow = getWorkflow(id, userId)
  if (!workflow || new Date(workflow.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'not_found' }
  if (['succeeded', 'partially_succeeded', 'failed', 'cancelled'].includes(workflow.state)) return { ok: false, reason: 'completed', workflow }
  const info = db.prepare("UPDATE agent_workflows SET state = 'resuming', updated_at = ? WHERE id = ? AND user_id = ? AND state = 'awaiting_approval'")
    .run(new Date().toISOString(), String(id), String(userId))
  if (Number(info.changes) !== 1) return { ok: false, reason: 'in_progress', workflow: getWorkflow(id, userId) }
  return { ok: true, workflow: getWorkflow(id, userId) }
}

export function setWorkflowState(id, userId, state, { result, error } = {}) {
  if (!STATES.has(state)) throw new Error(`State workflow tidak valid: ${state}`)
  db.prepare('UPDATE agent_workflows SET state = ?, result_json = COALESCE(?, result_json), error = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(state, result === undefined ? null : json(result), error || null, new Date().toISOString(), String(id), String(userId))
  return getWorkflow(id, userId)
}

export function cancelWorkflow(id, userId) {
  const workflow = getWorkflow(id, userId)
  if (!workflow) return null
  if (!['awaiting_approval', 'queued', 'planning'].includes(workflow.state)) return workflow
  return setWorkflowState(id, userId, 'cancelled')
}

export function listPendingWorkflows(userId) {
  pruneExpiredWorkflows()
  return db.prepare("SELECT id FROM agent_workflows WHERE user_id = ? AND state = 'awaiting_approval' AND expires_at > ? ORDER BY created_at DESC LIMIT 10")
    .all(String(userId), new Date().toISOString()).map(row => getWorkflow(row.id, userId))
}

export function deleteUserWorkflows(userId) {
  db.prepare('DELETE FROM agent_workflows WHERE user_id = ?').run(String(userId))
}

export function pruneExpiredWorkflows() {
  return Number(db.prepare('DELETE FROM agent_workflows WHERE expires_at <= ?').run(new Date().toISOString()).changes)
}
