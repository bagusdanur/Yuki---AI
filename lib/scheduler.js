// lib/scheduler.js — Yuki Agent Scheduled Tasks Engine
// Menggunakan node-cron + SQLite untuk persistent task scheduling per user

import cron from 'node-cron'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { normalizeTimezone, zonedDateTimeToUtc, zonedParts } from './time.js'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)

// Inisialisasi tabel scheduled_tasks
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    cron_expr TEXT NOT NULL,
    human_schedule TEXT NOT NULL,
    run_once INTEGER DEFAULT 0,
    run_at TEXT,
    last_run TEXT,
    next_run TEXT,
    next_run_at_utc TEXT,
    timezone TEXT DEFAULT 'Asia/Jakarta',
    idempotency_key TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id, status);
  CREATE TABLE IF NOT EXISTS scheduled_occurrences (
    id TEXT PRIMARY KEY,
    task_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    claimed_at TEXT,
    delivered_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(task_id, scheduled_for)
  );
  CREATE INDEX IF NOT EXISTS idx_occurrence_due ON scheduled_occurrences(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_occurrence_user ON scheduled_occurrences(user_id, created_at DESC);
`)
try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN timezone TEXT') } catch {}
try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN idempotency_key TEXT') } catch {}
try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN next_run_at_utc TEXT') } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_tasks_idempotency ON scheduled_tasks(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL')

// Map of active cron jobs: taskId -> cron.ScheduledTask
const activeJobs = new Map()

// Callback dipanggil saat task terpicu: fn(userId, task)
let onTaskTriggered = null
let deliveryTimer = null

export function setTaskTriggerCallback(fn) {
  onTaskTriggered = fn
}

// ===== CRUD =====

export function createScheduledTask({ userId, title, description, cronExpr, humanSchedule, runOnce = false, runAt = null, timezone = 'Asia/Jakarta', idempotencyKey = '' }) {
  const zone = normalizeTimezone(timezone)
  const key = String(idempotencyKey || crypto.createHash('sha256').update(`${userId}:${title}:${description}:${cronExpr}:${zone}`).digest('hex')).slice(0, 120)
  const existing = db.prepare(`SELECT id, title, human_schedule AS humanSchedule, COALESCE(next_run_at_utc, next_run) AS nextRunAtUtc, timezone, created_at AS createdAt
    FROM scheduled_tasks WHERE user_id = ? AND idempotency_key = ? AND status = 'active'`).get(userId, key)
  if (existing) return { ...existing, idempotent: true, verified: true }
  const nextRun = runAt || estimateNextRun(cronExpr, zone)
  const stmt = db.prepare(`
    INSERT INTO scheduled_tasks (user_id, title, description, cron_expr, human_schedule, run_once, run_at, next_run, next_run_at_utc, timezone, idempotency_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `)
  const result = stmt.run(userId, title, description, cronExpr, humanSchedule, runOnce ? 1 : 0, runAt, nextRun, nextRun, zone, key)
  const taskId = Number(result.lastInsertRowid)
  scheduleJob(taskId, { userId, title, description, cronExpr, runOnce, timezone: zone })
  const saved = db.prepare(`SELECT id, title, human_schedule AS humanSchedule, COALESCE(next_run_at_utc, next_run) AS nextRunAtUtc, timezone, created_at AS createdAt
    FROM scheduled_tasks WHERE id = ? AND user_id = ?`).get(taskId, userId)
  return { ...saved, verified: Boolean(saved) }
}

export function listScheduledTasks(userId) {
  return db.prepare(`
    SELECT id, title, description, human_schedule, cron_expr, run_once, COALESCE(next_run_at_utc, next_run) AS next_run_at_utc, last_run, status, created_at, timezone
    FROM scheduled_tasks WHERE user_id = ? ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
      COALESCE(next_run_at_utc, next_run, created_at) ASC
  `).all(userId)
}

export function getAgenda(userId) {
  const tasks = listScheduledTasks(String(userId))
  const deliveries = db.prepare(`SELECT o.id, o.task_id, o.scheduled_for, o.status, o.attempt_count, o.last_error, o.delivered_at,
    t.title FROM scheduled_occurrences o JOIN scheduled_tasks t ON t.id = o.task_id
    WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50`).all(String(userId))
  return { timezone: 'Asia/Jakarta', tasks, deliveries }
}

export function setScheduledTaskStatus(taskId, userId, status) {
  if (!['active', 'paused'].includes(status)) return { success: false, error: 'Status jadwal tidak valid.' }
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(Number(taskId), String(userId))
  if (!task || ['cancelled', 'done'].includes(task.status)) return { success: false, error: 'Pengingat tidak ditemukan atau sudah selesai.' }
  stopJob(Number(task.id))
  db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ? AND user_id = ?').run(status, Number(task.id), String(userId))
  if (status === 'active') scheduleJob(Number(task.id), taskShape(task))
  return { success: true, verified: true, id: Number(task.id), status }
}

export function snoozeScheduledTask(taskId, userId, minutes = 10) {
  const safeMinutes = Math.max(1, Math.min(1440, Number(minutes) || 10))
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(Number(taskId), String(userId))
  if (!task) return { success: false, error: 'Pengingat tidak ditemukan.' }
  const when = new Date(Date.now() + safeMinutes * 60_000)
  const local = zonedParts(when, task.timezone || 'Asia/Jakarta')
  stopJob(Number(task.id))
  db.prepare(`UPDATE scheduled_tasks SET status = 'active', run_once = 1, run_at = ?, next_run = ?, next_run_at_utc = ?,
    cron_expr = ?, human_schedule = ? WHERE id = ? AND user_id = ?`).run(
    when.toISOString(), when.toISOString(), when.toISOString(), `${local.minute} ${local.hour} ${local.day} ${local.month} *`,
    `Ditunda ${safeMinutes} menit`, Number(task.id), String(userId)
  )
  scheduleJob(Number(task.id), { ...taskShape(task), cronExpr: `${local.minute} ${local.hour} ${local.day} ${local.month} *`, runOnce: true })
  return { success: true, verified: true, id: Number(task.id), status: 'active', nextRunAtUtc: when.toISOString() }
}

export function updateScheduledTask({ taskId, userId, title, description, schedule, timezone }) {
  const current = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(Number(taskId), String(userId))
  if (!current) return { success: false, error: 'Pengingat tidak ditemukan.' }
  if (schedule) {
    const moved = rescheduleScheduledTask({ taskId, userId, schedule, timezone: timezone || current.timezone })
    if (!moved.success) return moved
  }
  db.prepare('UPDATE scheduled_tasks SET title = ?, description = ? WHERE id = ? AND user_id = ?').run(
    String(title || current.title).trim().slice(0, 120), String(description ?? current.description).trim().slice(0, 500), Number(taskId), String(userId)
  )
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(Number(taskId), String(userId))
  stopJob(Number(task.id)); if (task.status === 'active') scheduleJob(Number(task.id), taskShape(task))
  return { success: true, verified: true, task: listScheduledTasks(String(userId)).find(item => Number(item.id) === Number(taskId)) }
}

export function cancelScheduledTask(taskId, userId) {
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(taskId, userId)
  if (!task) return { success: false, message: 'Task tidak ditemukan atau bukan milikmu.' }

  db.prepare("UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?").run(taskId)
  stopJob(Number(taskId))
  return { success: true, verified: true, id: Number(task.id), title: task.title, status: 'cancelled', message: `Task "${task.title}" berhasil dibatalkan.` }
}

export function rescheduleScheduledTask({ taskId = null, userId, schedule, timezone = 'Asia/Jakarta' }) {
  const task = taskId
    ? db.prepare("SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ? AND status = 'active'").get(Number(taskId), userId)
    : db.prepare("SELECT * FROM scheduled_tasks WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1").get(userId)
  if (!task) return { success: false, error: 'Pengingat aktif tidak ditemukan. Sebutkan ID jadwal jika ingin mengubah jadwal tertentu.' }
  const parsed = parseToCronExpr(schedule, timezone)
  if (!parsed) return { success: false, error: `Format jadwal tidak dikenali atau waktunya sudah lewat: "${schedule}".` }
  const zone = parsed.timezone || normalizeTimezone(timezone)
  const nextRun = parsed.runAt || estimateNextRun(parsed.cron, zone)
  const oldJob = activeJobs.get(Number(task.id))
  if (oldJob) { oldJob.stop(); activeJobs.delete(Number(task.id)) }
  db.prepare(`UPDATE scheduled_tasks SET cron_expr = ?, human_schedule = ?, run_once = ?, run_at = ?, next_run = ?, next_run_at_utc = ?, timezone = ?, status = 'active' WHERE id = ? AND user_id = ?`).run(
    parsed.cron, parsed.human, parsed.runOnce ? 1 : 0, parsed.runAt || null, nextRun, nextRun, zone, Number(task.id), userId
  )
  scheduleJob(Number(task.id), { userId, title: task.title, description: task.description, cronExpr: parsed.cron, runOnce: Boolean(parsed.runOnce), timezone: zone })
  const saved = db.prepare(`SELECT id, title, human_schedule AS humanSchedule, COALESCE(next_run_at_utc, next_run) AS nextRunAtUtc, timezone FROM scheduled_tasks WHERE id = ? AND user_id = ?`).get(Number(task.id), userId)
  return { success: true, verified: Boolean(saved), task: saved }
}

// ===== SCHEDULE JOB =====

function scheduleJob(taskId, { userId, title, description, cronExpr, runOnce, timezone = 'Asia/Jakarta' }) {
  if (!cron.validate(cronExpr)) {
    console.warn(`[scheduler] Cron expression tidak valid untuk task ${taskId}: "${cronExpr}"`)
    return
  }

  const job = cron.schedule(cronExpr, async () => {
    enqueueOccurrence(taskId, new Date().toISOString())
    await processDueOccurrences()
  }, { timezone: normalizeTimezone(timezone) })

  activeJobs.set(taskId, job)
}

// ===== RESTORE JOBS DARI DB SAAT SERVER RESTART =====

export function restoreScheduledJobs() {
  const tasks = db.prepare("SELECT * FROM scheduled_tasks WHERE status = 'active'").all()
  let restored = 0
  for (const task of tasks) {
    scheduleJob(task.id, {
      userId: task.user_id,
      title: task.title,
      description: task.description,
      cronExpr: task.cron_expr,
      runOnce: task.run_once === 1,
      timezone: task.timezone || 'Asia/Jakarta'
    })
    restored++
  }
  console.info(`[scheduler] Restored ${restored} active scheduled tasks.`)
  recoverMissedOccurrences()
  if (!deliveryTimer) deliveryTimer = setInterval(() => void processDueOccurrences(), 15_000)
  void processDueOccurrences()
}

function taskShape(task) {
  return { userId: task.user_id, title: task.title, description: task.description, cronExpr: task.cron_expr, runOnce: task.run_once === 1, timezone: task.timezone || 'Asia/Jakarta' }
}

function stopJob(taskId) {
  const job = activeJobs.get(Number(taskId))
  if (job) job.stop()
  activeJobs.delete(Number(taskId))
}

function enqueueOccurrence(taskId, scheduledFor) {
  const task = db.prepare("SELECT * FROM scheduled_tasks WHERE id = ? AND status = 'active'").get(Number(taskId))
  if (!task) return null
  const normalized = new Date(scheduledFor).toISOString().slice(0, 16) + ':00.000Z'
  const id = crypto.createHash('sha256').update(`${task.id}:${normalized}`).digest('hex').slice(0, 32)
  db.prepare(`INSERT OR IGNORE INTO scheduled_occurrences
    (id, task_id, user_id, scheduled_for, status, next_attempt_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))`).run(id, task.id, task.user_id, normalized)
  return id
}

function recoverMissedOccurrences(now = new Date()) {
  const tasks = db.prepare("SELECT * FROM scheduled_tasks WHERE status = 'active' AND run_once = 1 AND COALESCE(next_run_at_utc, run_at, next_run) <= ?").all(now.toISOString())
  for (const task of tasks) enqueueOccurrence(task.id, task.next_run_at_utc || task.run_at || task.next_run)
}

export async function processDueOccurrences(now = new Date()) {
  const due = db.prepare(`SELECT o.*, t.title, t.description, t.run_once, t.cron_expr, t.timezone
    FROM scheduled_occurrences o JOIN scheduled_tasks t ON t.id = o.task_id
    WHERE o.status IN ('pending','retrying') AND COALESCE(o.next_attempt_at, o.scheduled_for) <= ?
    ORDER BY o.scheduled_for ASC LIMIT 20`).all(now.toISOString())
  for (const occurrence of due) {
    const claimed = db.prepare(`UPDATE scheduled_occurrences SET status = 'delivering', claimed_at = datetime('now'), attempt_count = attempt_count + 1
      WHERE id = ? AND status IN ('pending','retrying')`).run(occurrence.id)
    if (!claimed.changes) continue
    try {
      if (!onTaskTriggered) throw new Error('DELIVERY_CALLBACK_UNAVAILABLE')
      await onTaskTriggered(occurrence.user_id, { id: occurrence.task_id, occurrenceId: occurrence.id, title: occurrence.title, description: occurrence.description })
      db.prepare("UPDATE scheduled_occurrences SET status = 'delivered', delivered_at = datetime('now'), last_error = NULL WHERE id = ?").run(occurrence.id)
      db.prepare("UPDATE scheduled_tasks SET last_run = datetime('now') WHERE id = ?").run(occurrence.task_id)
      if (occurrence.run_once === 1) {
        db.prepare("UPDATE scheduled_tasks SET status = 'done' WHERE id = ?").run(occurrence.task_id); stopJob(occurrence.task_id)
      } else {
        const nextRun = estimateNextRun(occurrence.cron_expr, occurrence.timezone, new Date(now.getTime() + 1000))
        db.prepare('UPDATE scheduled_tasks SET next_run = ?, next_run_at_utc = ? WHERE id = ?').run(nextRun, nextRun, occurrence.task_id)
      }
    } catch (error) {
      const attempts = Number(occurrence.attempt_count) + 1
      const terminal = attempts >= 5
      const delayMinutes = Math.min(60, 2 ** attempts)
      const nextAttempt = new Date(now.getTime() + delayMinutes * 60_000).toISOString()
      db.prepare(`UPDATE scheduled_occurrences SET status = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`).run(
        terminal ? 'failed' : 'retrying', nextAttempt, String(error?.message || error).slice(0, 300), occurrence.id
      )
      if (terminal) db.prepare("UPDATE scheduled_tasks SET status = 'failed' WHERE id = ?").run(occurrence.task_id)
    }
  }
  return due.length
}

// ===== PARSER: Bahasa Natural → Cron Expr =====

export function parseToCronExpr(naturalText = '', timezone = 'Asia/Jakarta', now = new Date()) {
  const t = naturalText.toLowerCase().trim()
  const zone = normalizeTimezone(timezone)

  // Setiap N menit
  const everyMin = t.match(/setiap\s+(\d+)\s+menit/)
  if (everyMin) return { cron: `*/${everyMin[1]} * * * *`, human: `Setiap ${everyMin[1]} menit`, runOnce: false }

  // Setiap N jam
  const everyHour = t.match(/setiap\s+(\d+)\s+jam/)
  if (everyHour) return { cron: `0 */${everyHour[1]} * * *`, human: `Setiap ${everyHour[1]} jam`, runOnce: false }

  // Setiap hari jam HH:MM
  const dailyTime = t.match(/setiap\s+hari\s+(?:jam\s+)?(\d{1,2})(?::(\d{2}))?/)
  if (dailyTime) {
    const h = dailyTime[1]; const m = dailyTime[2] || '0'
    return { cron: `${m} ${h} * * *`, human: `Setiap hari jam ${h}:${m.padStart(2, '0')}`, runOnce: false }
  }

  // Setiap [hari] jam HH:MM — alias hari
  const DAY_MAP = { senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 0 }
  for (const [dayName, dayNum] of Object.entries(DAY_MAP)) {
    const pattern = new RegExp(`setiap\\s+${dayName}(?:\\s+jam\\s+(\\d{1,2})(?::(\\d{2}))?)?`)
    const m = t.match(pattern)
    if (m) {
      const h = m[1] || '8'; const min = m[2] || '0'
      return { cron: `${min} ${h} * * ${dayNum}`, human: `Setiap ${dayName.charAt(0).toUpperCase() + dayName.slice(1)} jam ${h}:${min.padStart(2, '0')}`, runOnce: false }
    }
  }

  // Besok / sekali pada waktu tertentu
  const tomorrowMatch = t.match(/(?:besok|sekali)\s+jam\s+(\d{1,2})(?::(\d{2}))?/)
  if (tomorrowMatch) {
    const h = tomorrowMatch[1]; const min = tomorrowMatch[2] || '0'
    const parts = zonedParts(now, zone)
    const localNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12))
    const target = zonedParts(localNoon, 'UTC')
    const runAt = zonedDateTimeToUtc({ year: target.year, month: target.month, day: target.day, hour: Number(h), minute: Number(min) }, zone)
    const cronExpr = `${min} ${h} ${target.day} ${target.month} *`
    return { cron: cronExpr, human: `Sekali besok jam ${h}:${min.padStart(2, '0')}`, runOnce: true, runAt, timezone: zone }
  }

  // N menit dari sekarang (sekali)
  const minutesFromNow = t.match(/(\d+)\s+menit\s+(?:lagi|dari sekarang)/)
  if (minutesFromNow) {
    const when = new Date(now.getTime() + Number(minutesFromNow[1]) * 60000)
    const local = zonedParts(when, zone)
    const cronExpr = `${local.minute} ${local.hour} ${local.day} ${local.month} *`
    return { cron: cronExpr, human: `${minutesFromNow[1]} menit lagi`, runOnce: true, runAt: when.toISOString() }
  }

  // N jam dari sekarang (sekali)
  const hoursFromNow = t.match(/(\d+)\s+jam\s+(?:lagi|dari sekarang)/)
  if (hoursFromNow) {
    const when = new Date(now.getTime() + Number(hoursFromNow[1]) * 3600000)
    const local = zonedParts(when, zone)
    const cronExpr = `${local.minute} ${local.hour} ${local.day} ${local.month} *`
    return { cron: cronExpr, human: `${hoursFromNow[1]} jam lagi`, runOnce: true, runAt: when.toISOString() }
  }

  // Hari ini / jam tertentu nanti (sekali). Contoh: "hari ini jam 09:00", "jam 9 nanti".
  const todayTime = t.match(/(?:hari\s+ini\s+)?jam\s+(\d{1,2})(?::(\d{2}))?(?:\s*(?:nanti))?$/)
  if (todayTime) {
    const hour = Number(todayTime[1]); const minute = Number(todayTime[2] || 0)
    if (hour > 23 || minute > 59) return null
    const parts = zonedParts(now, zone)
    let runAt = zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour, minute }, zone)
    if (new Date(runAt).getTime() <= now.getTime()) {
      if (/hari\s+ini/.test(t)) return null
      const localNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12))
      const tomorrow = zonedParts(localNoon, 'UTC')
      runAt = zonedDateTimeToUtc({ year: tomorrow.year, month: tomorrow.month, day: tomorrow.day, hour, minute }, zone)
    }
    const local = zonedParts(new Date(runAt), zone)
    return { cron: `${local.minute} ${local.hour} ${local.day} ${local.month} *`, human: `Sekali ${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')} jam ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, runOnce: true, runAt, timezone: zone }
  }

  return null // Tidak bisa di-parse
}

function fieldMatches(field, value) {
  if (field === '*') return true
  if (field.startsWith('*/')) return value % Number(field.slice(2)) === 0
  return field.split(',').some(item => Number(item) === value)
}

function estimateNextRun(cronExpr, timezone = 'Asia/Jakarta', now = new Date()) {
  const fields = String(cronExpr).trim().split(/\s+/)
  if (fields.length !== 5) return null
  for (let offset = 1; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(now.getTime() + offset * 60_000)
    const p = zonedParts(candidate, timezone)
    const weekday = Number(new Intl.DateTimeFormat('en-US', { timeZone: normalizeTimezone(timezone), weekday: 'short' }).format(candidate) === 'Sun' ? 0 : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: normalizeTimezone(timezone), weekday: 'short' }).format(candidate)) + 1)
    if (fieldMatches(fields[0], p.minute) && fieldMatches(fields[1], p.hour) && fieldMatches(fields[2], p.day) && fieldMatches(fields[3], p.month) && fieldMatches(fields[4], weekday)) return candidate.toISOString()
  }
  return null
}

export function getSchedulerStats() {
  const total = db.prepare("SELECT COUNT(*) as n FROM scheduled_tasks WHERE status = 'active'").get()
  return { activeJobs: activeJobs.size, dbActive: total.n }
}

export function shutdownScheduler() {
  for (const job of activeJobs.values()) job.stop()
  activeJobs.clear()
  if (deliveryTimer) clearInterval(deliveryTimer)
  deliveryTimer = null
}

export function deleteScheduledTasks(userId) {
  const tasks = db.prepare('SELECT id FROM scheduled_tasks WHERE user_id = ?').all(String(userId))
  for (const task of tasks) {
    const job = activeJobs.get(task.id)
    if (job) job.stop()
    activeJobs.delete(task.id)
  }
  db.prepare('DELETE FROM scheduled_tasks WHERE user_id = ?').run(String(userId))
  db.prepare('DELETE FROM scheduled_occurrences WHERE user_id = ?').run(String(userId))
}
