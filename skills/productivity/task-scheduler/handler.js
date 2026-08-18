// skills/productivity/task-scheduler/handler.js
import { createScheduledTask, listScheduledTasks, cancelScheduledTask, parseToCronExpr } from '../../../lib/scheduler.js'

export async function executeScheduleTask({ title, description, schedule }, context = {}) {
  const userId = context.userId
  if (!userId) return { error: 'User ID tidak tersedia.' }
  if (!title || !description || !schedule) return { error: 'title, description, dan schedule wajib diisi.' }

  const parsed = parseToCronExpr(schedule)
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
      runAt: parsed.runAt || null
    })
    return {
      success: true,
      message: `Pengingat "${title}" berhasil dijadwalkan: ${parsed.human}.`,
      task
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
      nextRun: t.next_run,
      lastRun: t.last_run || 'belum pernah'
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

export default {
  schedule_task: executeScheduleTask,
  list_scheduled_tasks: executeListScheduledTasks,
  cancel_scheduled_task: executeCancelScheduledTask
}
