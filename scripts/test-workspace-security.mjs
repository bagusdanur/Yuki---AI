import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yuki-workspace-test-'))
process.env.YUKI_AGENT_WORKSPACE = temporaryRoot

const tools = await import('../skills/computing/workspace-files/handler.js')
const alice = { userId: 'alice' }
const bob = { userId: 'bob' }

try {
  let result = await tools.create_workspace_file({ path: 'src/app.js', content: 'export const answer = 41\n' }, alice)
  assert.equal(result.success, true)

  result = await tools.read_workspace_file({ path: 'src/app.js' }, alice)
  assert.equal(result.success, true)
  assert.match(result.content, /answer = 41/)
  const originalHash = result.hash

  result = await tools.replace_workspace_text({
    path: 'src/app.js', old_text: 'answer = 41', new_text: 'answer = 42', expected_hash: originalHash
  }, alice)
  assert.equal(result.success, true)

  result = await tools.read_workspace_file({ path: 'src/app.js' }, alice)
  assert.match(result.content, /answer = 42/)

  result = await tools.get_workspace_diff({ path: 'src/app.js' }, alice)
  assert.equal(result.success, true)
  assert.match(result.diff, /- export const answer = 41/)
  assert.match(result.diff, /\+ export const answer = 42/)

  result = await tools.replace_workspace_text({
    path: 'src/app.js', old_text: 'answer = 42', new_text: 'answer = 99', expected_hash: originalHash
  }, alice)
  assert.equal(result.success, false, 'hash lama harus ditolak')

  for (const forbidden of ['../server.js', '/etc/passwd', '.env', '.env.production', 'data/yuki.db', '.ssh/id_rsa']) {
    result = await tools.read_workspace_file({ path: forbidden }, alice)
    assert.equal(result.success, false, `${forbidden} harus ditolak`)
  }

  result = await tools.read_workspace_file({ path: 'src/app.js' }, bob)
  assert.equal(result.success, false, 'workspace antar-user harus terisolasi')

  result = await tools.create_workspace_file({ path: 'src/app.js', content: 'overwrite' }, alice)
  assert.equal(result.success, false, 'create tidak boleh overwrite')

  result = await tools.search_workspace_code({ query: 'answer' }, alice)
  assert.equal(result.success, true)
  assert.equal(result.results.length, 1)

  const appRead = await tools.read_workspace_file({ path: 'src/app.js' }, alice)
  await tools.create_workspace_file({ path: 'src/util.js', content: 'export const label = "old"\n' }, alice)
  const utilRead = await tools.read_workspace_file({ path: 'src/util.js' }, alice)
  result = await tools.patch_workspace_files({ patches: [
    { path: 'src/app.js', old_text: 'answer = 42', new_text: 'answer = 43', expected_hash: appRead.hash },
    { path: 'src/util.js', old_text: 'label = "old"', new_text: 'label = "new"', expected_hash: utilRead.hash }
  ] }, alice)
  assert.equal(result.success, true)
  const afterTransaction = await tools.read_workspace_file({ path: 'src/app.js' }, alice)
  result = await tools.replace_workspace_text({ path: 'src/app.js', expected_hash: afterTransaction.hash, replacements: [
    { old_text: 'answer = 43', new_text: 'answer = 44' },
    { old_text: 'export const', new_text: 'export let' }
  ] }, alice)
  assert.equal(result.success, true)
  assert.equal(result.replacements, 2)

  result = await tools.validate_workspace_project({ path: 'src' }, alice)
  assert.equal(result.success, true)
  assert.equal(result.valid, true)

  result = await tools.create_workspace_file({ path: 'src/broken.json', content: '{ invalid' }, alice)
  assert.equal(result.success, true)
  result = await tools.validate_workspace_project({ path: 'src' }, alice)
  assert.equal(result.valid, false)

  result = await tools.rollback_workspace_file({ path: 'src/broken.json' }, alice)
  assert.equal(result.success, true)
  assert.equal(result.deleted_created_file, true)

  result = await tools.importWorkspaceFiles({ files: [
    { path: 'imported/index.js', content: 'export const imported = true\n' },
    { path: 'imported/config.json', content: '{"enabled":true}\n' }
  ] }, alice)
  assert.equal(result.success, true)
  assert.equal(result.imported, 2)

  result = await tools.importWorkspaceFiles({ files: [
    { path: 'imported/index.js', content: 'export const imported = false\n' }
  ] }, alice)
  assert.equal(result.success, false, 'import tidak boleh overwrite tanpa izin')

  result = await tools.importWorkspaceFiles({ overwrite: true, files: [
    { path: 'imported/index.js', content: 'export const imported = false\n' }
  ] }, alice)
  assert.equal(result.success, true)
  assert.equal(result.files[0].overwritten, true)

  result = await tools.importWorkspaceFiles({ files: [
    { path: 'safe/new.js', content: 'const safe = true\n' },
    { path: '../escape.js', content: 'const escaped = true\n' }
  ] }, alice)
  assert.equal(result.success, false)
  result = await tools.read_workspace_file({ path: 'safe/new.js' }, alice)
  assert.equal(result.success, false, 'validasi import harus selesai sebelum file pertama ditulis')

  result = await tools.create_workspace_file({ path: 'legacy/app.ts', content: 'export const duplicate = true\n' }, alice)
  assert.equal(result.success, false, 'nama modul serupa harus diarahkan ke implementasi yang sudah ada')
  result = await tools.create_workspace_file({ path: 'tests/smoke.test.js', content: 'import assert from "node:assert/strict"; assert.equal(2 + 2, 4); console.log("sandbox-pass")\n' }, alice)
  assert.equal(result.success, true)
  result = await tools.run_workspace_tests({ path: 'tests/smoke.test.js' }, alice)
  assert.equal(result.success, true, result.error || result.stderr)
  assert.match(result.stdout, /sandbox-pass/)
  result = await tools.run_workspace_tests({ path: 'src/app.js' }, alice)
  assert.equal(result.success, false, 'file non-test tidak boleh dieksekusi')

  tools.deleteWorkspaceData('alice')
  result = await tools.read_workspace_file({ path: 'src/app.js' }, alice)
  assert.equal(result.success, false, 'penghapusan akun harus membersihkan workspace')

  console.log('PASS  workspace create/read/search/patch')
  console.log('PASS  stale hash dan overwrite ditolak')
  console.log('PASS  traversal, absolute path, secret, database ditolak')
  console.log('PASS  workspace antar-user terisolasi')
  console.log('PASS  diff, snapshot, rollback, patch multi-file, dan validasi statis')
  console.log('PASS  import proyek multi-file, overwrite berizin, dan transaksi anti-partial')
  console.log('PASS  anti-duplikasi modul dan Node permission sandbox test runner')
  console.log('PASS  cleanup akun menghapus workspace dan snapshot user')
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
