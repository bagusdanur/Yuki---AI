import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'yuki-phase6-'))
process.env.MEMORY_DB = path.join(root, 'phase6.db')
const memory = await import(`../lib/agent/memory-store.js?phase6=${Date.now()}`)
const skills = await import(`../lib/agent/dynamic-skills.js?phase6=${Date.now()}`)

try {
  const captured = memory.captureMemoryCandidates('alice', 'Aku suka manhwa aksi dan selalu baca malam hari', 91)
  assert.ok(captured.length >= 2)
  assert.equal(memory.listAgentMemories('bob').length, 0, 'memory tidak boleh bocor ke user lain')
  assert.ok(memory.listAgentMemories('alice').every(item => item.evidence.some(e => e.ref === 'chat:91')))
  const first = memory.listAgentMemories('alice')[0]
  assert.equal(memory.updateAgentMemory(first.id, 'bob', { content: 'curi' }), null)
  assert.equal(memory.deleteAgentMemory(first.id, 'bob'), false)
  memory.setMemorySettings('alice', { autoCapture: false })
  assert.equal(memory.captureMemoryCandidates('alice', 'Aku suka sesuatu yang baru', 92).length, 0)
  assert.equal(memory.saveVerifiedLesson({ userId: 'alice', content: 'Tanpa bukti', evidence: [] }).success, false)
  assert.equal(memory.saveVerifiedLesson({ userId: 'alice', content: 'Endpoint merespons 200', evidence: [{ kind: 'http', ref: 'run:1' }] }).success, true)

  const safe = skills.createDynamicSkill('alice', { name: 'ringkas-catatan', description: 'Meringkas catatan', instructions: 'Ringkas isi secara singkat.', toolAllowlist: ['list_user_notes'] })
  assert.equal(safe.success, true); assert.equal(skills.validateDynamicSkill(safe.skill.id, 'alice').success, true)
  assert.equal(skills.approveDynamicSkill(safe.skill.id, 'bob').success, false)
  assert.equal(skills.approveDynamicSkill(safe.skill.id, 'alice').skill.status, 'active')
  const unsafe = skills.createDynamicSkill('alice', { name: 'host-admin', description: 'Kelola server', instructions: 'Jalankan PM2 dan baca /root credential.', toolAllowlist: ['host_shell'] })
  const rejected = skills.validateDynamicSkill(unsafe.skill.id, 'alice')
  assert.equal(rejected.success, false); assert.deepEqual(rejected.validation.deniedTools, ['host_shell'])
  assert.equal(skills.listDynamicSkills('bob').length, 0, 'dynamic skill tidak boleh bocor lintas user')

  console.log('PASS  Phase 6 scoped memory, evidence lessons, ownership, dan dynamic-skill permission ceiling')
} finally { rmSync(root, { recursive: true, force: true }) }
