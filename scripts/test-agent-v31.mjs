import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuki-v31-'))
process.env.MEMORY_DB = path.join(root, 'test.sqlite')
process.env.YUKI_AGENT_WORKSPACE = path.join(root, 'workspace')

try {
  const [{ createApprovalCheckpoint, claimWorkflow, getWorkflow, setWorkflowState }, { createToolResult, verifyToolResult }, runner, scratchpad, learning, memory, scheduler, search, ryukomik, agentPersona] = await Promise.all([
    import('../lib/agent/workflow-store.js'),
    import('../lib/agent/tool-result.js'),
    import('../lib/agent/runner.js'),
    import('../skills/computing/code-scratchpad/handler.js'),
    import('../skills/learning/self-improvement/handler.js'),
    import('../lib/memory.js'),
    import('../lib/scheduler.js'),
    import('../skills/research/web-search/handler.js'),
    import('../lib/ryukomik.js'),
    import('../lib/agent/persona.js')
  ])

  const approval = createApprovalCheckpoint({
    requestId: 'request_v31_test', userId: 'alice', toolName: 'create_workspace_file',
    args: { path: 'demo.js', content: 'console.log(1)' }, reason: 'buat file',
    resume: { stepId: 'step_create', messages: [{ role: 'user', content: 'buat dan jalankan' }] }
  })
  assert.equal(getWorkflow(approval.id, 'alice').state, 'awaiting_approval')
  assert.equal(claimWorkflow(approval.id, 'bob').ok, false, 'akun lain tidak boleh claim approval')
  assert.equal(claimWorkflow(approval.id, 'alice').ok, true)
  assert.equal(claimWorkflow(approval.id, 'alice').reason, 'in_progress', 'klik kedua tidak boleh mengeksekusi ulang')
  setWorkflowState(approval.id, 'alice', 'succeeded', { result: { verified: true } })
  assert.equal(claimWorkflow(approval.id, 'alice').reason, 'completed')

  const fileContract = createToolResult({ toolName: 'create_workspace_file', skillId: 'workspace-files', status: 'succeeded', data: {}, evidence: [{ kind: 'file', value: { path: 'demo.js' } }], startedAt: new Date().toISOString(), durationMs: 1 })
  assert.equal(verifyToolResult(fileContract).verified, true)
  const missingEvidence = createToolResult({ toolName: 'create_workspace_file', skillId: 'workspace-files', status: 'succeeded', data: {}, evidence: [], startedAt: new Date().toISOString(), durationMs: 1 })
  assert.equal(verifyToolResult(missingEvidence).verified, false)
  assert.match(runner.guardGroundedFinalResponse('File sudah berhasil dibuat dan disimpan.', []), /belum dapat dinyatakan berhasil/)

  assert.deepEqual([...runner.selectAgentToolNames('Pakai Code Scratchpad untuk jalankan snippet')], ['run_javascript_code'])
  assert.ok(!runner.selectAgentToolNames('Pakai Self-Improvement untuk simpan evaluasi').has('run_skill_health_check'))
  assert.deepEqual([...runner.selectAgentToolNames('Pakai URL Reader untuk https://example.com')], ['read_url'])
  const routedFollowUp = runner.selectAgentToolsForConversation([
    { role: 'user', content: 'Jalankan Skill Health sekarang.' },
    { role: 'assistant', content: 'Semua skill sehat.' },
    { role: 'user', content: 'Buat file baru audit-v31.txt di workspace.' }
  ])
  assert.ok(routedFollowUp.has('create_workspace_file'))
  assert.ok(!routedFollowUp.has('run_skill_health_check'), 'skill eksplisit lama tidak boleh meracuni intent terbaru')

  const scratchResult = await scratchpad.executeRunJavascriptCode({ code: 'console.log("empat")\nreturn 2 + 2' })
  assert.equal(scratchResult.exitCode, 0)
  assert.equal(scratchResult.result, '4')
  assert.match(scratchResult.stdout, /empat/)
  assert.equal(fs.existsSync(path.join(root, 'workspace')), false, 'Scratchpad tidak boleh membuat workspace')

  const savedLearning = await learning.executeRecordSelfImprovement({ topic: 'Routing', learning_summary: 'Permintaan eksplisit harus menang.', skill_affected: 'router' }, { userId: 'alice' })
  assert.equal(savedLearning.verified, true)
  assert.ok(savedLearning.learning_entry_id)
  const lessons = await learning.executeListSelfImprovements({}, { userId: 'alice' })
  assert.equal(lessons.lessons[0].id, savedLearning.learning_entry_id)
  assert.equal((await learning.executeListSelfImprovements({}, { userId: 'bob' })).total, 0)

  const firstNote = memory.saveUserNote('alice', { title: 'Tes', content: 'Satu kali', category: 'todo', idempotencyKey: 'same-request' })
  const secondNote = memory.saveUserNote('alice', { title: 'Tes', content: 'Satu kali', category: 'todo', idempotencyKey: 'same-request' })
  assert.equal(firstNote.id, secondNote.id)
  assert.equal(secondNote.idempotent, true)
  const reminderMessageId = memory.saveChatMessage('alice', 'assistant', '*[Pengingat Terjadwal: Bangun]*\\n\\nJam 7 pagi')
  assert.equal(memory.getScheduledReminderMessages('alice', reminderMessageId - 1)[0].messageId, reminderMessageId)
  assert.equal(memory.getScheduledReminderMessages('bob', 0).length, 0)

  const parsed = scheduler.parseToCronExpr('besok jam 9', 'Asia/Jakarta', new Date('2026-09-15T04:00:00.000Z'))
  assert.equal(parsed.runAt, '2026-09-16T02:00:00.000Z')
  assert.equal(parsed.timezone, 'Asia/Jakarta')

  const anime = search.scoreSearchRelevance('berita anime terbaru', { title: 'Anime musim baru diumumkan', snippet: 'Episode pertama segera tayang' })
  const game = search.scoreSearchRelevance('berita anime terbaru', { title: 'Mobile game terbaru', snippet: 'Update game dan turnamen' })
  assert.ok(anime > game, `hasil anime harus lebih relevan (${anime} <= ${game})`)
  assert.equal(ryukomik.detectFormat({ format: 'Korean Manhwa' }), 'MANHWA')
  assert.equal(ryukomik.detectFormat({ country: 'Japan' }), 'MANGA')

  const agentPrompt = agentPersona.buildAgentSystemPrompt({ userId: 'alice' })
  assert.match(agentPrompt, /<thinking>/)
  assert.doesNotThrow(() => agentPersona.buildAgentSystemPrompt({ userId: 'alice' }))

  const appSource = fs.readFileSync(new URL('../frontend/src/App.tsx', import.meta.url), 'utf8')
  const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  const runnerSource = fs.readFileSync(new URL('../lib/agent/runner.js', import.meta.url), 'utf8')
  assert.match(appSource, /ReactMarkdown/)
  assert.match(appSource, /rehypeSanitize/)
  assert.doesNotMatch(appSource, /Proses Berpikir Yuki/)
  assert.match(appSource, /_yuki_touch_guide/)
  assert.match(appSource, /getScheduledReminders/)
  assert.doesNotMatch(serverSource, /thinking:\s*agentResult/)
  assert.ok(serverSource.includes('/api/chat/reminders'))
  assert.match(runnerSource, /Model hanya mengeluarkan <think>[\s\S]*?role: 'user'/,
    'retry setelah output thinking-only harus diakhiri giliran user, bukan model')
  assert.ok(runnerSource.includes('failedArtifactPatch') && runnerSource.includes('update_interactive_artifact'))

  assert.match(runner.buildDeterministicSchedulerReport([{ tool: 'schedule_task', status: 'done', output: { task: { id: 17, title: 'Audit', humanSchedule: '30 menit lagi', nextRunAtUtc: '2026-09-15T11:00:00.000Z', timezone: 'Asia/Jakarta' } } }]), /ID internal: \*\*17\*\*/)
  assert.match(runner.buildDeterministicSchedulerReport([{ tool: 'list_scheduled_tasks', status: 'done', output: { tasks: [{ id: 17, title: 'Audit', schedule: '30 menit lagi', nextRunAtUtc: '2026-09-15T11:00:00.000Z', timezone: 'Asia\/Jakarta' }] } }]), /ID \*\*17\*\*/)

  console.log('PASS  durable approval state, resume claim, dan anti-double-click')
  console.log('PASS  evidence contract dan false-success guard')
  console.log('PASS  explicit skill routing dan scratchpad tanpa workspace')
  console.log('PASS  self-improvement read-after-write dan isolasi user')
  console.log('PASS  idempotency todo dan konversi UTC/WIB scheduler')
  console.log('PASS  relevance search, metadata komik, Markdown aman, dan reasoning tersembunyi')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
