// scripts/test-bugfix-iteration.mjs
import 'dotenv/config'
import { runAgent } from '../lib/agent/runner.js'
import { getRecentSelfImprovements } from '../skills/learning/self-improvement/handler.js'

async function run() {
  console.log('=== Step 1: Simulasi Pembuatan Game di Turn 1 ===')
  const start1 = Date.now()
  const res1 = await runAgent({
    userId: 'test_user_bugfix',
    messages: [
      { role: 'user', content: 'buatkan game platformer sederhana dengan canvas' }
    ]
  })
  console.log(`✅ Turn 1 selesai dalam ${Date.now() - start1}ms:`)
  console.log('  Artifacts:', res1.artifacts?.length)
  const firstArtifact = res1.artifacts?.[0]
  console.log('  Artifact Title:', firstArtifact?.title)
  console.log('  Artifact Content length:', firstArtifact?.content?.length)

  console.log('\n=== Step 2: Simulasi User Lapor Bug di Turn 2 ===')
  const start2 = Date.now()
  const history = [
    { role: 'user', content: 'buatkan game platformer sederhana dengan canvas' },
    { role: 'assistant', content: res1.reply + '\n\n```html\n' + (firstArtifact?.content || '') + '\n```' },
    { role: 'user', content: 'Yuki, loncatannya terlalu rendah sama ada bug koin tembus platform, tolong perbaiki kodenya ya' }
  ]

  const res2 = await runAgent({
    userId: 'test_user_bugfix',
    messages: history
  })

  console.log(`✅ Turn 2 (Bug Fix) selesai dalam ${Date.now() - start2}ms:`)
  console.log('  Artifacts:', res2.artifacts?.length)
  console.log('  Steps executed:', res2.steps?.length)
  if (res2.steps?.length) {
    console.log('  Steps tools called:', res2.steps.map(s => s.tool))
  }
  console.log('  Reply text snippet:\n', res2.reply?.slice(0, 300))

  console.log('\n=== Step 3: Verifikasi Memori Self-Improvement ===')
  const lessons = getRecentSelfImprovements(5)
  console.log(`Ditemukan ${lessons.length} catatan self-improvement:`)
  lessons.forEach(l => console.log(`  - [${l.skill}] ${l.topic}: ${l.summary}`))
}

run()
