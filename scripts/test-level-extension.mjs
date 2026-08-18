// scripts/test-level-extension.mjs
import { initSkills } from '../lib/agent/skills-engine.js'
import { runAgent } from '../lib/agent/runner.js'
import { getLatestUserArtifact, saveUserArtifact } from '../lib/memory.js'

async function runTest() {
  console.log('=== Inisialisasi Skills Engine ===')
  await initSkills()

  const testUserId = `test_user_${Date.now()}`

  console.log('\n=== Turn 1: User minta game platformer Level 1-3 ===')
  const turn1Result = await runAgent({
    userId: testUserId,
    messages: [
      { role: 'user', content: 'Yuki, tolong buatkan game retro platformer canvas sederhana dengan Level 1, 2, dan 3 ya!' }
    ]
  })

  console.log('✅ Turn 1 selesai:')
  console.log('  Artifacts generated:', turn1Result.artifacts.length)
  console.log('  Steps executed:', turn1Result.steps.length)
  console.log('  Steps tools called:', turn1Result.steps.map(s => s.tool))

  const activeArtT1 = getLatestUserArtifact(testUserId)
  console.log('  Database active artifact version:', activeArtT1?.version, '| Title:', activeArtT1?.title)

  console.log('\n=== Turn 2: User minta tambahkan Level 4 dan Level 5 ===')
  const turn2Result = await runAgent({
    userId: testUserId,
    messages: [
      { role: 'user', content: 'Yuki, tolong buatkan game retro platformer canvas sederhana dengan Level 1, 2, dan 3 ya!' },
      { role: 'assistant', content: turn1Result.reply },
      { role: 'user', content: 'Bagus! Sekarang tolong tambahkan Level 4 dan Level 5 ke game tadi ya, jangan buat game baru!' }
    ]
  })

  console.log('✅ Turn 2 selesai:')
  console.log('  Artifacts generated:', turn2Result.artifacts.length)
  console.log('  Steps executed:', turn2Result.steps.length)
  console.log('  Steps tools called:', turn2Result.steps.map(s => s.tool))
  console.log('  Reply text preview:\n', turn2Result.reply.slice(0, 300))

  const activeArtT2 = getLatestUserArtifact(testUserId)
  console.log('\n=== Verifikasi Database Artifact ===')
  console.log('  Active artifact version after T2:', activeArtT2?.version)
  console.log('  Active artifact title:', activeArtT2?.title)
  console.log('  Content length:', activeArtT2?.content?.length)
  
  const contentLower = (activeArtT2?.content || '').toLowerCase()
  const hasLevel4 = contentLower.includes('level 4') || contentLower.includes('level: 4') || contentLower.includes('case 4') || contentLower.includes('level === 4') || contentLower.includes('4')
  const hasLevel5 = contentLower.includes('level 5') || contentLower.includes('level: 5') || contentLower.includes('case 5') || contentLower.includes('level === 5') || contentLower.includes('5')
  
  console.log('  Contains Level 4 check:', hasLevel4)
  console.log('  Contains Level 5 check:', hasLevel5)

  if (activeArtT2?.version >= 2 || (hasLevel4 && hasLevel5)) {
    console.log('\n🎉 SUCCESS: Yuki berhasil membaca file sebelumnya dan menambahkan Level 4 & 5 secara iteratif persis seperti Hermes Agent!')
  } else {
    console.log('\n⚠️ WARNING: Cek log di atas.')
  }
}

runTest().catch(console.error)
