// skills/productivity/task-scheduler/handler.js
import { createScheduledTask, listScheduledTasks, cancelScheduledTask, parseToCronExpr, rescheduleScheduledTask } from '../../../lib/scheduler.js'

export async function executeScheduleTask({ title, description, schedule, timezone = 'Asia/Jakarta', idempotency_key = '' }, context = {}) {
  const userId = context.userId
  if (!userId) return { error: 'User ID tidak tersedia.' }
  if (!title || !description || !schedule) return { error: 'title, description, dan schedule wajib diisi.' }

  const parsed = parseToCronExpr(schedule, timezone)
  if (!parsed) {
    return {
      error: `Format jadwal tidak dikenali: "${schedule}". Coba: "setiap Senin jam 8", "setiap hari jam 20:00", "30 menit lagi", "besok jam 9".`
    }
  }

  try {
    const task = createScheduledTask({
      userId,
      title,
      description,
      cronExpr: parsed.cron,
      humanSchedule: parsed.human,
      runOnce: parsed.runOnce || false,
      runAt: parsed.runAt || null,
      timezone: parsed.timezone || timezone,
      idempotencyKey: idempotency_key
    })
    return {
      success: true,
      message: `Pengingat "${title}" berhasil dijadwalkan: ${parsed.human}.`,
      task,
      verified: Boolean(task?.verified)
    }
  } catch (err) {
    return { error: `Gagal membuat jadwal: ${err.message}` }
  }
}

export async function executeListScheduledTasks(_args, context = {}) {
  const userId = context.userId
  if (!userId) return { error: 'User ID tidak tersedia.' }

  const tasks = listScheduledTasks(userId)
  if (!tasks.length) return { tasks: [], message: 'Tidak ada jadwal aktif saat ini.' }

  return {
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      schedule: t.human_schedule,
      nextRunAtUtc: t.next_run_at_utc,
      lastRun: t.last_run || 'belum pernah'
      , timezone: t.timezone || 'Asia/Jakarta'
    })),
    total: tasks.length
  }
}

export async function executeCancelScheduledTask({ task_id }, context = {}) {
  const userId = context.userId
  if (!userId) return { error: 'User ID tidak tersedia.' }
  if (!task_id) return { error: 'task_id wajib diisi.' }

  return cancelScheduledTask(Number(task_id), userId)
}

export async function executeRescheduleTask({ task_id = null, schedule, timezone = 'Asia/Jakarta' }, context = {}) {
  const userId = context.userId
  if (!userId) return { error: 'User ID tidak tersedia.' }
  if (!schedule) return { error: 'schedule wajib diisi.' }
  const result = rescheduleScheduledTask({ taskId: task_id, userId, schedule, timezone })
  if (!result.success) return { error: result.error }
  return { success: true, message: `Pengingat "${result.task.title}" berhasil diubah: ${result.task.humanSchedule}.`, task: result.task, verified: result.verified }
}

export default {
  schedule_task: executeScheduleTask,
  reschedule_task: executeRescheduleTask,
  list_scheduled_tasks: executeListScheduledTasks,
  cancel_scheduled_task: executeCancelScheduledTask
}
