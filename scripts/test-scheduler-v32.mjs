import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'yuki-scheduler-v32-'))
process.env.MEMORY_DB = path.join(root, 'scheduler.db')
const scheduler = await import(`../lib/scheduler.js?phase4=${Date.now()}`)

try {
  const delivered = []
  scheduler.setTaskTriggerCallback(async (_userId, task) => delivered.push(task.occurrenceId))
  const overdue = new Date(Date.now() - 60_000).toISOString()
  const task = scheduler.createScheduledTask({
    userId: 'phase4-user', title: 'Bangun', description: 'Bangun jam tujuh', cronExpr: '* * * * *',
    humanSchedule: 'Jam 7 pagi', runOnce: true, runAt: overdue, timezone: 'Asia/Jakarta', idempotencyKey: 'phase4-overdue'
  })
  scheduler.shutdownScheduler()
  scheduler.restoreScheduledJobs()
  await new Promise(resolve => setTimeout(resolve, 80))
  let agenda = scheduler.getAgenda('phase4-user')
  assert.equal(delivered.length, 1, 'occurrence terlewat harus dikirim setelah restart')
  assert.equal(agenda.deliveries[0].status, 'delivered')
  assert.equal(agenda.tasks.find(item => item.id === task.id).status, 'done')

  scheduler.shutdownScheduler(); scheduler.restoreScheduledJobs()
  await new Promise(resolve => setTimeout(resolve, 60))
  agenda = scheduler.getAgenda('phase4-user')
  assert.equal(delivered.length, 1, 'restore berulang tidak boleh mengirim occurrence yang sama dua kali')
  assert.equal(agenda.deliveries.length, 1, 'occurrence unik berdasarkan task dan waktu')

  const recurring = scheduler.createScheduledTask({ userId: 'phase4-user', title: 'Minum', description: 'Minum air', cronExpr: '0 7 * * *', humanSchedule: 'Setiap hari jam 7:00', timezone: 'Asia/Jakarta', idempotencyKey: 'phase4-controls' })
  assert.equal(scheduler.setScheduledTaskStatus(recurring.id, 'other-user', 'paused').success, false, 'kontrol lintas user harus ditolak')
  assert.equal(scheduler.setScheduledTaskStatus(recurring.id, 'phase4-user', 'paused').status, 'paused')
  assert.equal(scheduler.setScheduledTaskStatus(recurring.id, 'phase4-user', 'active').status, 'active')
  assert.equal(scheduler.snoozeScheduledTask(recurring.id, 'phase4-user', 10).success, true)
  assert.equal(scheduler.updateScheduledTask({ taskId: recurring.id, userId: 'phase4-user', title: 'Minum sekarang' }).success, true)

  console.log('PASS  Phase 4 restart recovery, exactly-once delivery, agenda controls, dan ownership')
} finally {
  scheduler.shutdownScheduler()
  rmSync(root, { recursive: true, force: true })
}
