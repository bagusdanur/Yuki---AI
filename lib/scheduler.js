// lib/scheduler.js — Yuki Agent Scheduled Tasks Engine
// Menggunakan node-cron + SQLite untuk persistent task scheduling per user

import cron from 'node-cron'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

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
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id, status);
`)

// Map of active cron jobs: taskId -> cron.ScheduledTask
const activeJobs = new Map()

// Callback dipanggil saat task terpicu: fn(userId, task)
let onTaskTriggered = null

export function setTaskTriggerCallback(fn) {
  onTaskTriggered = fn
}

// ===== CRUD =====

export function createScheduledTask({ userId, title, description, cronExpr, humanSchedule, runOnce = false, runAt = null }) {
  const nextRun = runAt || estimateNextRun(cronExpr)
  const stmt = db.prepare(`
    INSERT INTO scheduled_tasks (user_id, title, description, cron_expr, human_schedule, run_once, run_at, next_run, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `)
  const result = stmt.run(userId, title, description, cronExpr, humanSchedule, runOnce ? 1 : 0, runAt, nextRun)
  const taskId = Number(result.lastInsertRowid)
  scheduleJob(taskId, { userId, title, description, cronExpr, runOnce })
  return { id: taskId, title, humanSchedule, nextRun }
}

export function listScheduledTasks(userId) {
  return db.prepare(`
    SELECT id, title, description, human_schedule, cron_expr, run_once, next_run, last_run, status, created_at
    FROM scheduled_tasks WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC
  `).all(userId)
}

export function cancelScheduledTask(taskId, userId) {
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND user_id = ?').get(taskId, userId)
  if (!task) return { success: false, message: 'Task tidak ditemukan atau bukan milikmu.' }

  db.prepare("UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?").run(taskId)
  const job = activeJobs.get(taskId)
  if (job) { job.stop(); activeJobs.delete(taskId) }
  return { success: true, message: `Task "${task.title}" berhasil dibatalkan.` }
}

// ===== SCHEDULE JOB =====

function scheduleJob(taskId, { userId, title, description, cronExpr, runOnce }) {
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
    }
  }, { timezone: 'Asia/Jakarta' })

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
      runOnce: task.run_once === 1
    })
    restored++
  }
  console.info(`[scheduler] Restored ${restored} active scheduled tasks.`)
}

// ===== PARSER: Bahasa Natural → Cron Expr =====

export function parseToCronExpr(naturalText = '') {
  const t = naturalText.toLowerCase().trim()

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
    const now = new Date()
    const h = tomorrowMatch[1]; const min = tomorrowMatch[2] || '0'
    const runAt = new Date(now); runAt.setDate(runAt.getDate() + 1)
    runAt.setHours(Number(h), Number(min), 0, 0)
    const cronExpr = `${min} ${h} ${runAt.getDate()} ${runAt.getMonth() + 1} *`
    return { cron: cronExpr, human: `Sekali besok jam ${h}:${min.padStart(2, '0')}`, runOnce: true, runAt: runAt.toISOString() }
  }

  // N menit dari sekarang (sekali)
  const minutesFromNow = t.match(/(\d+)\s+menit\s+(?:lagi|dari sekarang)/)
  if (minutesFromNow) {
    const when = new Date(Date.now() + Number(minutesFromNow[1]) * 60000)
    const cronExpr = `${when.getMinutes()} ${when.getHours()} ${when.getDate()} ${when.getMonth() + 1} *`
    return { cron: cronExpr, human: `${minutesFromNow[1]} menit lagi`, runOnce: true, runAt: when.toISOString() }
  }

  // N jam dari sekarang (sekali)
  const hoursFromNow = t.match(/(\d+)\s+jam\s+(?:lagi|dari sekarang)/)
  if (hoursFromNow) {
    const when = new Date(Date.now() + Number(hoursFromNow[1]) * 3600000)
    const cronExpr = `${when.getMinutes()} ${when.getHours()} ${when.getDate()} ${when.getMonth() + 1} *`
    return { cron: cronExpr, human: `${hoursFromNow[1]} jam lagi`, runOnce: true, runAt: when.toISOString() }
  }

  return null // Tidak bisa di-parse
}

function estimateNextRun(cronExpr) {
  try {
    // Simple estimation — tidak perlu library besar
    return new Date(Date.now() + 60000).toISOString()
  } catch { return null }
}

export function getSchedulerStats() {
  const total = db.prepare("SELECT COUNT(*) as n FROM scheduled_tasks WHERE status = 'active'").get()
  return { activeJobs: activeJobs.size, dbActive: total.n }
}
