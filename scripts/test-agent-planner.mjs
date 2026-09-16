import assert from 'node:assert/strict'
import { buildExecutionPlan, createRetryGuard, strategyHash, validateExecutionPlan } from '../lib/agent/planner.js'

const selectTools = text => {
  const selected = new Set()
  if (/health/i.test(text)) selected.add('run_skill_health_check')
  if (/file|bug|perbaiki/i.test(text)) ['read_workspace_file', 'replace_workspace_text', 'get_workspace_diff', 'validate_workspace_project'].forEach(name => selected.add(name))
  if (/jadwal|reminder|ingatkan|menit lagi/i.test(text)) { selected.add('schedule_task'); selected.add('reschedule_task'); selected.add('get_current_time'); selected.add('add_user_note') }
  return selected
}

const latestWins = buildExecutionPlan([
  { role: 'user', content: 'Jalankan health check' },
  { role: 'assistant', content: 'Selesai' },
  { role: 'user', content: 'Buat reminder besok pagi' }
], { selectTools })
assert.deepEqual(latestWins.toolAllowlist, ['schedule_task'])
assert.equal(latestWins.contextSource, 'latest_request')
assert.equal(latestWins.requiresEvidence, true)
assert.equal(validateExecutionPlan(latestWins).valid, true)
const reschedule = buildExecutionPlan([{ role: 'user', content: 'Ubah reminder jadi 10 menit lagi' }], { selectTools })
assert.deepEqual(reschedule.toolAllowlist, ['reschedule_task'])
const minimalReminder = buildExecutionPlan([{ role: 'user', content: 'Ingatkan aku 2 menit lagi dong' }], { selectTools })
assert.deepEqual(minimalReminder.toolAllowlist, ['schedule_task'])

const continued = buildExecutionPlan([
  { role: 'user', content: 'Perbaiki bug file game' },
  { role: 'assistant', content: 'Belum selesai' },
  { role: 'user', content: 'lanjutkan' }
], { selectTools, hasActiveArtifact: true })
assert.equal(continued.intent, 'fix')
assert.equal(continued.contextSource, 'explicit_continuation')
assert.ok(continued.toolAllowlist.includes('replace_workspace_text'))

const unrelated = buildExecutionPlan([
  { role: 'user', content: 'Perbaiki bug file game' },
  { role: 'assistant', content: 'Baik' },
  { role: 'user', content: 'Apa kabar?' }
], { selectTools, hasActiveArtifact: true })
assert.deepEqual(unrelated.toolAllowlist, [])
assert.equal(unrelated.intent, 'general')

const analysisOnly = buildExecutionPlan([{ role: 'user', content: 'Analisis bug file ini saja, jangan ubah' }], { selectTools })
assert.ok(analysisOnly.toolAllowlist.includes('read_workspace_file'))
assert.ok(!analysisOnly.toolAllowlist.includes('replace_workspace_text'), 'mode analisis tidak boleh mengekspos tool mutasi')

assert.equal(strategyHash('tool_a', { b: 2, a: 1 }), strategyHash('tool_a', { a: 1, b: 2 }))
const retry = createRetryGuard({ maxFailures: 3, maxAttemptsPerTool: 2 })
assert.equal(retry.inspect('replace_workspace_text', { path: 'a.js' }).allowed, true)
retry.record('replace_workspace_text', { path: 'a.js' }, { failed: true })
assert.equal(retry.inspect('replace_workspace_text', { path: 'a.js' }).reason, 'IDENTICAL_FAILED_STRATEGY')
assert.equal(retry.inspect('replace_workspace_text', { path: 'b.js' }).allowed, true, 'strategi berbeda masih boleh dicoba')
retry.record('replace_workspace_text', { path: 'b.js' }, { failed: true })
assert.equal(retry.inspect('replace_workspace_text', { path: 'c.js' }).reason, 'RETRY_BUDGET_EXHAUSTED')

console.log('PASS  planner schema, latest-request routing, explicit continuation, bounded retry, dan loop detection')
