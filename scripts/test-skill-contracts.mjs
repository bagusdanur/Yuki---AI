import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuki-contracts-'))
process.env.MEMORY_DB = path.join(root, 'contracts.sqlite')
process.env.YUKI_AGENT_WORKSPACE = path.join(root, 'workspace')
let stopScheduler = () => {}

try {
  const [{ executeTool, getSkillsHealth, initSkills, listSkills }, workspace, artifact, delegation, urlReader, webSearch, ryukomik, scheduler] = await Promise.all([
    import('../lib/agent/skills-engine.js'),
    import('../skills/computing/workspace-files/handler.js'),
    import('../skills/computing/html-canvas-builder/handler.js'),
    import('../skills/computing/delegate-task/handler.js'),
    import('../skills/research/url-reader/handler.js'),
    import('../skills/research/web-search/handler.js'),
    import('../lib/ryukomik.js'),
    import('../lib/scheduler.js')
  ])
  stopScheduler = scheduler.shutdownScheduler
  await initSkills()
  const skills = await listSkills()
  const health = await getSkillsHealth()
  assert.equal(skills.length, 16)
  assert.equal(health.missing_schemas.length, 0)
  for (const skill of health.skills) {
    assert.ok(skill.tools > 0, `${skill.name} tidak memiliki tool contract`)
    assert.equal(skill.healthy, true, `${skill.name} schema/handler tidak sehat`)
  }

  let result = await executeTool('calculate_expression', { expression: '15% dari 200' }, { userId: 'alice' })
  assert.equal(result.data.result, 30)
  result = await executeTool('run_javascript_code', { code: 'return /yuki/i.test("YUKI")' }, { userId: 'alice' })
  assert.equal(result.data.exitCode, 0)
  result = await executeTool('analyze_code_syntax', { code: 'const broken =', language: 'javascript' }, { userId: 'alice' })
  assert.equal(result.data.valid, false)
  result = await executeTool('get_current_time', { timezone: 'WIB' }, { userId: 'alice' })
  assert.equal(result.data.ianaTimezone, 'Asia/Jakarta')

  result = await workspace.create_workspace_file({ path: 'src/index.js', content: 'export const ok = true\n' }, { userId: 'alice' })
  assert.equal(result.success, true)
  assert.equal((await workspace.read_workspace_file({ path: 'src/index.js' }, { userId: 'bob' })).success, false)

  const validArtifact = await artifact.executeValidateInteractiveArtifact({ html_content: '<!doctype html><html><body><button id="go">Go</button><script>document.querySelector("#go").addEventListener("click", () => {})</script></body></html>' })
  assert.equal(validArtifact.valid, true)
  assert.equal(validArtifact.smoke_test.pass, true)

  assert.match((await delegation.executeDelegateTasks({ tasks: ['satu'] }, { userId: 'alice' })).error, /Minimal 2/)
  assert.match((await urlReader.executeReadUrl({ url: 'not-a-url' })).error, /URL tidak valid/)
  assert.match((await webSearch.executeWebSearch({ query: '' })).error, /tidak boleh kosong/)
  assert.equal(ryukomik.detectFormat({ origin: 'Chinese' }), 'MANHUA')

  result = await executeTool('add_user_note', { title: 'Kontrak', content: 'Sekali', idempotency_key: 'contract-note' }, { userId: 'alice' })
  assert.equal(result.contract.status, 'succeeded')
  assert.ok(result.evidence.some(item => item.kind === 'record'))
  result = await executeTool('schedule_task', { title: 'Kontrak', description: 'Tes', schedule: '30 menit lagi', idempotency_key: 'contract-schedule', timezone: 'Asia/Jakarta' }, { userId: 'alice' })
  assert.equal(result.contract.status, 'succeeded')
  assert.ok(result.data.task.nextRunAtUtc)
  const scheduledTaskId = result.data.task.id
  result = await executeTool('reschedule_task', { task_id: scheduledTaskId, schedule: '45 menit lagi', timezone: 'Asia/Jakarta' }, { userId: 'alice' })
  assert.equal(result.contract.status, 'succeeded')
  assert.equal(result.data.task.id, scheduledTaskId)
  assert.ok(result.evidence.some(item => item.kind === 'record'))
  result = await executeTool('cancel_scheduled_task', { task_id: scheduledTaskId }, { userId: 'alice' })
  assert.equal(result.contract.status, 'succeeded')
  assert.equal(result.data.id, scheduledTaskId)
  assert.ok(result.evidence.some(item => item.kind === 'record'))
  result = await executeTool('record_self_improvement', { topic: 'Contract', learning_summary: 'Bukti record wajib ada.' }, { userId: 'alice' })
  assert.equal(result.data.verified, true)
  stopScheduler()

  console.log(`PASS  contract registry seluruh ${skills.length} skill`)
  console.log('PASS  contract computing, workspace, artifact, productivity, learning, research, media, system')
} finally {
  stopScheduler()
  fs.rmSync(root, { recursive: true, force: true })
}
