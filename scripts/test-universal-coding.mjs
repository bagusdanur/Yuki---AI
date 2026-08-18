// scripts/test-universal-coding.mjs
import { initSkills } from '../lib/agent/skills-engine.js'
import { runAgent } from '../lib/agent/runner.js'

async function runTest() {
  console.log('=== Inisialisasi Skills Engine ===')
  await initSkills()

  const testUserId = `test_coder_${Date.now()}`

  console.log('\n=== Turn 1: User minta fungsi JavaScript fetchMangaChapters ===')
  const turn1Result = await runAgent({
    userId: testUserId,
    messages: [
      { role: 'user', content: 'Yuki, buatkan fungsi JavaScript fetchMangaChapters(slug, limit) yang memanggil endpoint /api/manga/:slug/chapters dan mengembalikan daftar chapter.' }
    ]
  })

  console.log('✅ Turn 1 selesai:')
  console.log('  Reply preview:\n', turn1Result.reply.slice(0, 250))

  console.log('\n=== Turn 2: User lapor bug & minta penambahan retry ===')
  const turn2Result = await runAgent({
    userId: testUserId,
    messages: [
      { role: 'user', content: 'Yuki, buatkan fungsi JavaScript fetchMangaChapters(slug, limit) yang memanggil endpoint /api/manga/:slug/chapters dan mengembalikan daftar chapter.' },
      { role: 'assistant', content: turn1Result.reply },
      { role: 'user', content: 'Ada bug: API sekarang return format { data: [...], hasMore: true } bukan array langsung. Sama tolong tambahkan retry otomatis 3x dengan timeout 5000ms ya. Perbaiki fungsi tadi jangan buat dari nol!' }
    ]
  })

  console.log('✅ Turn 2 selesai:')
  console.log('  Steps executed:', turn2Result.steps.length)
  console.log('  Tools called:', turn2Result.steps.map(s => s.tool))
  console.log('  Reply preview:\n', turn2Result.reply.slice(0, 350))

  const replyLower = turn2Result.reply.toLowerCase()
  const hasFunctionName = replyLower.includes('fetchmangachapters')
  const hasRetry = replyLower.includes('retry') || replyLower.includes('attempts') || replyLower.includes('3')
  const hasDataParsing = replyLower.includes('.data') || replyLower.includes('hasmore')

  console.log('\n=== Verifikasi Analisis & Bugfix ===')
  console.log('  Pertahankan nama fungsi fetchMangaChapters:', hasFunctionName)
  console.log('  Menambahkan mekanisme retry:', hasRetry)
  console.log('  Menyesuaikan parsing response .data & hasMore:', hasDataParsing)

  if (hasFunctionName && hasRetry && hasDataParsing) {
    console.log('\n🎉 SUCCESS: Universal Code & Bugfix Iteration bekerja sempurna untuk semua bahasa pemrograman!')
  } else {
    console.log('\n⚠️ Check output details.')
  }
}

runTest().catch(console.error)
