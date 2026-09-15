import assert from 'node:assert/strict'
import { executeTool, initSkills } from '../lib/agent/skills-engine.js'

await initSkills()
const result = await executeTool('delegate_tasks', {
  tasks: ['Jawab tepat: worker satu aktif', 'Jawab tepat: worker dua aktif'],
  shared_context: 'Tes runtime paralel. Jangan gunakan tool.'
}, { userId: `parallel_test_${Date.now()}` })

assert.equal(Boolean(result.error), false, result.error)
assert.equal(result.data.totalSubagents, 2)
assert.equal(result.data.successful, 2, JSON.stringify(result.data.results))
assert.equal(result.data.results.length, 2)
console.log(`PASS  2 subagent nyata selesai paralel dalam ${result.data.durationMs}ms`)
console.log(result.data.results.map(item => item.result).join(' | '))
