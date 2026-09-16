import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY, owner_type TEXT NOT NULL DEFAULT 'user', owner_id TEXT NOT NULL,
  name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0', description TEXT NOT NULL,
  instructions TEXT NOT NULL, tool_allowlist_json TEXT NOT NULL DEFAULT '[]', input_schema_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')), UNIQUE(owner_id, name)
); CREATE INDEX IF NOT EXISTS idx_agent_skills_owner ON agent_skills(owner_id, status);`)

// Dynamic skills are instruction-only. They may compose this read-only ceiling,
// never register handlers or gain filesystem/network/process capabilities.
export const DYNAMIC_SKILL_TOOL_CEILING = Object.freeze(new Set([
  'safe_calculate', 'get_current_time', 'list_user_notes', 'list_scheduled_tasks',
  'list_self_improvements', 'search_ryukomik', 'get_latest_ryukomik'
]))
const owner = value => String(value || '').slice(0, 80)
const cleanName = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const parse = value => { try { return JSON.parse(value) } catch { return null } }
const map = row => row && ({ ...row, toolAllowlist: parse(row.tool_allowlist_json) || [], inputSchema: parse(row.input_schema_json) || {}, validation: parse(row.validation_json) || {}, tool_allowlist_json: undefined, input_schema_json: undefined, validation_json: undefined })

export function listDynamicSkills(userId) { return db.prepare(`SELECT id, name, version, description, instructions, tool_allowlist_json, input_schema_json, validation_json, status, created_at AS createdAt, updated_at AS updatedAt FROM agent_skills WHERE owner_id = ? ORDER BY updated_at DESC`).all(owner(userId)).map(map) }

export function createDynamicSkill(userId, input = {}) {
  const name = cleanName(input.name); const description = String(input.description || '').trim().slice(0, 300); const instructions = String(input.instructions || '').trim().slice(0, 5000)
  if (!name || !description || !instructions) return { success: false, error: 'Nama, deskripsi, dan instruksi skill wajib diisi.' }
  const tools = [...new Set((Array.isArray(input.toolAllowlist) ? input.toolAllowlist : []).map(String))]
  const id = `skill_${crypto.randomUUID()}`
  db.prepare(`INSERT INTO agent_skills (id, owner_id, name, description, instructions, tool_allowlist_json, input_schema_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner(userId), name, description, instructions, JSON.stringify(tools), JSON.stringify(input.inputSchema || {}))
  return { success: true, skill: listDynamicSkills(userId).find(item => item.id === id) }
}

export function validateDynamicSkill(skillId, userId) {
  const row = db.prepare('SELECT * FROM agent_skills WHERE id = ? AND owner_id = ?').get(String(skillId), owner(userId)); if (!row) return { success: false, error: 'Skill tidak ditemukan.' }
  const tools = parse(row.tool_allowlist_json) || []; const denied = tools.filter(tool => !DYNAMIC_SKILL_TOOL_CEILING.has(tool))
  const forbidden = /(?:child_process|process\.|require\s*\(|import\s+|filesystem|\/root|\/home|\/var\/www|pm2|docker|nginx|ssh|systemd|credential|secret|private\s+port)/i.test(row.instructions)
  const validation = { valid: denied.length === 0 && !forbidden, deniedTools: denied, forbiddenInstruction: forbidden, checkedAt: new Date().toISOString(), permissionCeiling: [...DYNAMIC_SKILL_TOOL_CEILING] }
  db.prepare(`UPDATE agent_skills SET validation_json = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`).run(JSON.stringify(validation), validation.valid ? 'pending_approval' : 'draft', row.id, owner(userId))
  return { success: validation.valid, validation, skill: listDynamicSkills(userId).find(item => item.id === row.id) }
}

export function approveDynamicSkill(skillId, userId) {
  const row = db.prepare("SELECT * FROM agent_skills WHERE id = ? AND owner_id = ? AND status = 'pending_approval'").get(String(skillId), owner(userId)); if (!row) return { success: false, error: 'Skill belum lolos validasi atau bukan milikmu.' }
  const validation = parse(row.validation_json); if (!validation?.valid) return { success: false, error: 'Hasil validasi skill tidak sah.' }
  db.prepare("UPDATE agent_skills SET status = 'active', updated_at = datetime('now') WHERE id = ? AND owner_id = ?").run(row.id, owner(userId))
  return { success: true, skill: listDynamicSkills(userId).find(item => item.id === row.id) }
}

export function disableDynamicSkill(skillId, userId) {
  const changed = db.prepare("UPDATE agent_skills SET status = 'disabled', updated_at = datetime('now') WHERE id = ? AND owner_id = ?").run(String(skillId), owner(userId)).changes
  return changed ? { success: true } : { success: false, error: 'Skill tidak ditemukan.' }
}

export function deleteDynamicSkillData(userId) { db.prepare('DELETE FROM agent_skills WHERE owner_id = ?').run(owner(userId)) }
