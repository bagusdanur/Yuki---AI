import crypto from 'node:crypto'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { sanitizeOutputSecrets } from '../../../lib/security.js'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`
  CREATE TABLE IF NOT EXISTS self_improvements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    skill TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'technical',
    scope TEXT NOT NULL DEFAULT 'user',
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_self_improvements_user_created ON self_improvements(user_id, created_at DESC);
`)

const safeUser = context => String(context?.userId || 'anonymous').slice(0, 80)
const safeText = (value, limit) => sanitizeOutputSecrets(String(value || '').trim()).slice(0, limit)

export async function executeRecordSelfImprovement(params = {}, context = {}) {
  const cleanTopic = safeText(params.topic || 'General Improvement', 160)
  const cleanSummary = safeText(params.learning_summary || params.summary || params.patch_note, 2400)
  const cleanSkill = safeText(params.skill_affected || 'core', 100)
  const category = safeText(params.category || 'technical', 60)
  if (!cleanSummary) return { success: false, error: 'Parameter "learning_summary" tidak boleh kosong.' }

  const record = {
    id: `imp_${crypto.randomUUID()}`,
    userId: safeUser(context),
    timestamp: new Date().toISOString(),
    topic: cleanTopic,
    skill: cleanSkill,
    category,
    scope: 'user',
    summary: cleanSummary
  }
  try {
    db.prepare(`INSERT INTO self_improvements (id, user_id, topic, skill, category, scope, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.userId, record.topic, record.skill, record.category, record.scope, record.summary, record.timestamp)
    const readBack = db.prepare(`SELECT id, topic, skill, category, scope, summary, created_at AS timestamp
      FROM self_improvements WHERE id = ? AND user_id = ?`).get(record.id, record.userId)
    if (!readBack) throw new Error('Read-after-write gagal; entry tidak ditemukan.')
    return {
      success: true,
      learning_entry_id: record.id,
      category,
      scope: record.scope,
      timestamp: record.timestamp,
      verified: true,
      entry: readBack,
      message: `💾 Self-improvement: Wawasan terverifikasi tersimpan — [${cleanSkill}] ${cleanTopic}`
    }
  } catch (error) {
    return { success: false, error: `Gagal menyimpan self-improvement: ${error.message}` }
  }
}

export async function executeListSelfImprovements({ limit = 15 } = {}, context = {}) {
  try {
    const count = Math.max(1, Math.min(50, Number(limit) || 15))
    const lessons = db.prepare(`SELECT id, topic, skill, category, scope, summary, created_at AS timestamp
      FROM self_improvements WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(safeUser(context), count)
    return { success: true, total: lessons.length, lessons, message: lessons.length ? undefined : 'Belum ada catatan self-improvement yang tersimpan.' }
  } catch (error) {
    return { success: false, error: `Gagal membaca memori pembelajaran: ${error.message}` }
  }
}

export function getRecentSelfImprovements(limit = 6, userId = 'anonymous') {
  try {
    return db.prepare(`SELECT id, topic, skill, category, scope, summary, created_at AS timestamp
      FROM self_improvements WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(String(userId).slice(0, 80), Math.max(1, Math.min(12, Number(limit) || 6)))
  } catch { return [] }
}

export default {
  record_self_improvement: executeRecordSelfImprovement,
  list_self_improvements: executeListSelfImprovements
}
