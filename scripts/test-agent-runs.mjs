import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = mkdtempSync(path.join(os.tmpdir(), 'yuki-agent-runs-'))
process.env.MEMORY_DB = path.join(temp, 'runs.db')

try {
  const store = await import(`../lib/agent/run-store.js?test=${Date.now()}`)
  const requestId = 'agent_phase1_durable_test'
  const userId = 'owner-a'

  const created = store.createOrGetAgentRun({ requestId, userId, goal: 'Uji run persisten' })
  assert.equal(created.state, 'queued')
  assert.equal(store.createOrGetAgentRun({ requestId, userId, goal: 'duplikat' }).requestId, requestId)
  assert.equal(store.createOrGetAgentRun({ requestId, userId: 'owner-b' }), null, 'request ID tidak boleh diambil akun lain')
  assert.equal(store.getAgentRun(requestId, 'owner-b'), null, 'akun lain tidak boleh membaca run')

  assert.equal(store.claimAgentRun(requestId, userId, 'worker-a', 60_000), true)
  assert.equal(store.claimAgentRun(requestId, userId, 'worker-b', 60_000), false, 'lease aktif harus mencegah eksekusi ganda')
  store.upsertAgentRunStep(requestId, userId, { id: 'step-1', tool: 'agent_core', title: 'Merencanakan', status: 'running' })
  store.upsertAgentRunStep(requestId, userId, { id: 'step-1', tool: 'agent_core', title: 'Merencanakan', status: 'done', durationMs: 12 })
  assert.equal(store.getAgentRun(requestId, userId).steps.length, 1, 'update step harus idempoten')
  assert.equal(store.getAgentRun(requestId, userId).steps[0].status, 'done')

  const cancelledId = 'agent_phase1_cancel_test'
  store.createOrGetAgentRun({ requestId: cancelledId, userId, goal: 'Batalkan' })
  const cancelled = store.requestAgentRunCancellation(cancelledId, userId)
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(store.isAgentRunCancellationRequested(cancelledId, userId), true)
  assert.equal(store.claimAgentRun(cancelledId, userId, 'worker-a'), false)

  const interruptedId = 'agent_phase1_restart_test'
  store.createOrGetAgentRun({ requestId: interruptedId, userId, goal: 'Restart' })
  store.claimAgentRun(interruptedId, userId, 'old-process', 60_000)
  assert.equal(store.recoverInterruptedAgentRuns(), 2) // requestId pertama + interruptedId masih aktif
  const recovered = store.getAgentRun(interruptedId, userId)
  assert.equal(recovered.state, 'failed')
  assert.equal(recovered.errorCode, 'PROCESS_RESTARTED')
  assert.equal(recovered.done, true)

  assert.ok(store.deleteUserAgentRuns(userId) >= 3)
  assert.equal(store.getAgentRun(requestId, userId), null)
  console.log('PASS  durable agent run: ownership, idempotency, lease, cancel, recovery, delete')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
