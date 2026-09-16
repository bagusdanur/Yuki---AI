import assert from 'node:assert/strict'
import { executeTool, getAvailableTools, initSkills, listSkills } from '../lib/agent/skills-engine.js'
import { buildDeterministicAgentReport, detectCodingIntent, evaluateWorkspaceToolPolicy, extractToolCallsFromText, selectAgentToolNames } from '../lib/agent/runner.js'
import { inspectArtifactDesign } from '../skills/computing/html-canvas-builder/handler.js'

await initSkills()
const skills = await listSkills()
const schemas = await getAvailableTools()
const toolNames = schemas.map(item => item.function.name)

assert.equal(skills.length, 16)
assert.equal(toolNames.length, 40)
assert.equal(new Set(toolNames).size, toolNames.length, 'schema tool terduplikasi pada runtime')

let result = await executeTool('calculate_date_difference', { target_date: '2026-12-31' }, { userId: 'tool_test' })
assert.equal(Boolean(result.error), false, result.error)
assert.equal(result.data.targetDate, '2026-12-31')

result = await executeTool('analyze_code_syntax', {
  language: 'typescript', code: 'interface User { name: string }\nconst user: User = { name: "Yuki" }'
}, { userId: 'tool_test' })
assert.equal(Boolean(result.error), false, result.error)
assert.equal(result.data.valid, true, JSON.stringify(result.data.issues))

result = await executeTool('analyze_code_syntax', {
  language: 'typescript', code: 'const broken: string ='
}, { userId: 'tool_test' })
assert.equal(result.data.valid, false)

result = await executeTool('read_workspace_file', { path: '../server.js' }, { userId: 'tool_test' })
assert.equal(Boolean(result.error), true, 'error handler harus dipropagasikan sebagai tool error')

result = await executeTool('validate_interactive_artifact', {
  html_content: '<!doctype html><html><body><script>const ok = true;</script></body></html>'
}, { userId: 'tool_test' })
assert.equal(Boolean(result.error), false, result.error)

result = await executeTool('validate_interactive_artifact', {
  html_content: '<!doctype html><html><body><script>const broken = ;</script></body></html>'
}, { userId: 'tool_test' })
assert.equal(Boolean(result.error), true, 'artifact dengan sintaks rusak harus ditolak')

result = await executeTool('run_skill_health_check', {}, { userId: 'tool_test' })
assert.equal(Boolean(result.error), false, result.error)
assert.equal(result.data.healthy, true, JSON.stringify(result.data.missing_schemas))

let policy = evaluateWorkspaceToolPolicy({ toolName: 'replace_workspace_text', completedTools: [] })
assert.equal(policy.allowed, false, 'patch tanpa inspeksi harus ditolak runtime')
policy = evaluateWorkspaceToolPolicy({ toolName: 'create_workspace_file', userRequest: 'perbaiki bug login', completedTools: ['read_workspace_file'] })
assert.equal(policy.allowed, false, 'file baru tanpa permintaan eksplisit harus meminta approval')
policy = evaluateWorkspaceToolPolicy({ toolName: 'create_workspace_file', userRequest: 'buatkan file konfigurasi baru', completedTools: ['list_workspace_files'] })
assert.equal(policy.allowed, true, 'file baru yang diminta eksplisit harus diizinkan')
policy = evaluateWorkspaceToolPolicy({ toolName: 'replace_workspace_text', userRequest: 'perbaiki bug', completedTools: ['search_workspace_code', 'read_workspace_file'] })
assert.equal(policy.allowed, true, 'patch minimal setelah inspeksi harus diizinkan')
policy = evaluateWorkspaceToolPolicy({ toolName: 'delete_user_note', userRequest: 'lihat catatan saya' })
assert.equal(policy.allowed, false, 'hapus data tanpa permintaan aktif harus ditolak')
policy = evaluateWorkspaceToolPolicy({ toolName: 'delete_user_note', userRequest: 'hapus catatan nomor 2' })
assert.equal(policy.allowed, true, 'hapus data yang diminta eksplisit harus diizinkan')
policy = evaluateWorkspaceToolPolicy({ toolName: 'replace_workspace_text', userRequest: 'analisis bug saja, jangan ubah', completedTools: ['read_workspace_file'] })
assert.equal(policy.allowed, false, 'intent analisis tidak boleh menulis workspace')
assert.equal(selectAgentToolNames('halo yuki').size, 0, 'chat sederhana tidak perlu mengirim schema tool')
assert.ok(selectAgentToolNames('perbaiki bug di project').has('replace_workspace_text'))
assert.ok(!selectAgentToolNames('cek waktu sekarang').has('web_search'))
assert.ok(selectAgentToolNames('game catur masih sama').has('get_active_artifact'))
assert.equal(detectCodingIntent('tolong perbaikin lagi, masih sama'), 'fix')
assert.equal(inspectArtifactDesign('<style>:root{--background:#fff;--foreground:#171717;--primary:#315c45}.card{border:1px solid #ddd}</style>').pass, true)
assert.equal(inspectArtifactDesign('<style>.a{color:#0ff;text-shadow:0 0 30px #0ff;backdrop-filter:blur(20px)}.b{background:linear-gradient(red,blue);text-shadow:0 0 40px #f0f;backdrop-filter:blur(20px)}.c{background:radial-gradient(red,blue)}.d{background:linear-gradient(red,blue)}</style>').pass, false)
const providerCalls = extractToolCallsFromText('<call:workspace-files:list_workspace_files>{"path":"."}</call:workspace-files:list_workspace_files>Response: nanti diisi tool')
assert.equal(providerCalls.length, 1)
assert.equal(providerCalls[0].function.name, 'list_workspace_files')
assert.equal(JSON.parse(providerCalls[0].function.arguments).path, '.')
assert.equal(extractToolCallsFromText('<call:workspace-files:list\\_workspace\\_files>{}\\</call:call:workspace-files:list\\_workspace\\_files>').length, 1)
const inlineCalls = extractToolCallsFromText('\\<call:default_api:replace\\_workspace\\_text{hash:c81485f7de4078b4,path:index.html,replacements:[{new\\_text:let autoRotate = false;,old\\_text:let autoRotate = true;}]}')
assert.equal(inlineCalls.length, 1)
assert.equal(inlineCalls[0].function.name, 'replace_workspace_text')
assert.equal(JSON.parse(inlineCalls[0].function.arguments).replacements.length, 1)
const styleCalls = extractToolCallsFromText('style:default_api:build_interactive_artifact{html_content:<!doctype html><html><body><h1>Chess</h1></body></html>,title:Stable Chess}')
assert.equal(styleCalls.length, 1)
assert.equal(styleCalls[0].function.name, 'build_interactive_artifact')
assert.match(JSON.parse(styleCalls[0].function.arguments).html_content, /<!doctype html>/)
const artifactReport = buildDeterministicAgentReport({
  steps: [{ tool: 'update_interactive_artifact', status: 'done', input: { patch_note: 'Mengunci ukuran papan saat rotasi.' } }],
  artifactResults: [{ id: 'art_chess', title: 'Yuki Chess', version: 4 }], completedTools: ['update_interactive_artifact']
})
assert.match(artifactReport, /versi 4/)
assert.match(artifactReport, /Mengunci ukuran papan/)
assert.doesNotMatch(artifactReport, /tanpa perubahan file/)
assert.match(artifactReport, /sudah Yuki perbaiki/)
assert.doesNotMatch(artifactReport, /\*\*Perubahan/)

console.log(`PASS  ${skills.length} skill dan ${toolNames.length} tool terdaftar tanpa duplikasi runtime`)
console.log('PASS  schema tanggal cocok dengan handler')
console.log('PASS  analyzer TypeScript memvalidasi sintaks tipe tanpa mengeksekusi kode')
console.log('PASS  kegagalan handler dipropagasikan sebagai status error')
console.log('PASS  artifact rusak ditolak sebelum ditulis ke disk')
console.log('PASS  health-check runtime seluruh skill sehat')
console.log('PASS  runtime guard mewajibkan inspeksi serta approval file baru/aksi destruktif')
console.log('PASS  schema tool dipilih dinamis sesuai intent untuk menghemat token')
console.log('PASS  design linter menolak pola neon/glow/glass/gradient AI-slop')
console.log('PASS  format tool-call namespaced provider dikenali tanpa bocor ke chat')
