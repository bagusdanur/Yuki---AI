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
`)
try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN timezone TEXT') } catch {}
try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN idempotency_key TEXT') } catch {}
try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN next_run_at_utc TEXT') } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_tasks_idempotency ON scheduled_tasks(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL')

// Map of active cron jobs: taskId -> cron.ScheduledTask
const activeJobs = new Map()

// Callback dipanggil saat task terpicu: fn(userId, task)
let onTaskTriggered = null

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
    FROM scheduled_tasks WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC
  `).all(userId)
}

export function cancelScheduledTask(taskId, userId) {
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(taskId, userId)
  if (!task) return { success: false, message: 'Task tidak ditemukan atau bukan milikmu.' }

  db.prepare("UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?").run(taskId)
  const job = activeJobs.get(taskId)
  if (job) { job.stop(); activeJobs.delete(taskId) }
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
    console.info(`[scheduler] Task #${taskId} dipicu: "${title}" untuk user ${userId}`)
    db.prepare("UPDATE scheduled_tasks SET last_run = datetime('now') WHERE id = ?").run(taskId)

    if (onTaskTriggered) {
      try {
        await onTaskTriggered(userId, { id: taskId, title, description })
      } catch (err) {
        console.error(`[scheduler] Gagal menjalankan callback task #${taskId}:`, err.message)
      }
    }

    if (runOnce) {
      db.prepare("UPDATE scheduled_tasks SET status = 'done' WHERE id = ?").run(taskId)
      job.stop()
      activeJobs.delete(taskId)
    } else {
      const nextRun = estimateNextRun(cronExpr, timezone, new Date(Date.now() + 1000))
      db.prepare('UPDATE scheduled_tasks SET next_run = ?, next_run_at_utc = ? WHERE id = ?').run(nextRun, nextRun, taskId)
    }
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
}

export function deleteScheduledTasks(userId) {
  const tasks = db.prepare('SELECT id FROM scheduled_tasks WHERE user_id = ?').all(String(userId))
  for (const task of tasks) {
    const job = activeJobs.get(task.id)
    if (job) job.stop()
    activeJobs.delete(task.id)
  }
  db.prepare('DELETE FROM scheduled_tasks WHERE user_id = ?').run(String(userId))
}
