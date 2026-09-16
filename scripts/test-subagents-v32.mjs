import assert from 'node:assert/strict'
import { delegateTasks, verifySubagentResult } from '../lib/agent/subagent.js'

let active = 0
let peak = 0
const seenUsers = new Set()
const workerRunner = async ({ task, index, userId, shouldCancel }) => {
  active++; peak = Math.max(peak, active); seenUsers.add(userId)
  await new Promise(resolve => setTimeout(resolve, 15))
  active--
  const base = { workerId: `worker_${String(index).padStart(12, '0')}`, index, task, toolsUsed: [], evidence: [], durationMs: 15 }
  if (task === 'gagal') throw new Error('simulasi worker gagal')
  if (shouldCancel()) return { ...base, status: 'cancelled', summary: 'Worker dibatalkan.' }
  return { ...base, status: 'succeeded', summary: `hasil ${task}` }
}

const result = await delegateTasks({ tasks: ['satu', 'gagal', 'tiga', 'empat'], userId: 'user-a', workerRunner, maxParallel: 4 })
assert.equal(peak, 2)
assert.equal(result.status, 'partially_succeeded')
assert.equal(result.successful, 3)
assert.equal(result.failed, 1)
assert.deepEqual(result.results.map(item => item.task), ['satu', 'gagal', 'tiga', 'empat'])
assert.deepEqual([...seenUsers], ['user-a'])
assert.equal(result.verification.allStructured, true)

const cancelled = await delegateTasks({ tasks: ['a', 'b'], userId: 'user-b', workerRunner, shouldCancel: () => true })
assert.equal(cancelled.status, 'failed')
assert.equal(cancelled.results.every(item => item.status === 'cancelled'), true)
assert.equal(verifySubagentResult({}).verified, false)
assert.match((await delegateTasks({ tasks: ['satu'], userId: 'x' })).error, /Minimal 2/)
assert.match((await delegateTasks({ tasks: ['a', 'b'] })).error, /terautentikasi/)
console.log('PASS  Phase 7 bounded subagents, structured verification, cancellation, partial failure, dan user scope')
