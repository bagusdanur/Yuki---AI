// scripts/test-retro-game-full.mjs
import 'dotenv/config'
import { runAgent } from '../lib/agent/runner.js'

async function run() {
  console.log('Testing full retro game generation with max_tokens: 8192...')
  const start = Date.now()
  try {
    const res = await runAgent({
      userId: 'test_user_game_full',
      messages: [
        { role: 'user', content: 'buatkan game platform terbaik jadul retro gituu' }
      ]
    })

    console.log(`\n🎉 SUCCESS in ${Date.now() - start}ms:`)
    console.log('  Model:', res.model)
    console.log('  Mood:', res.mood)
    console.log('  Artifacts count:', res.artifacts?.length || 0)
    if (res.artifacts?.length) {
      const art = res.artifacts[0]
      console.log('  Artifact Title:', art.title)
      console.log('  Artifact Type:', art.type)
      console.log('  Artifact Content length:', art.content?.length)
      console.log('  Is Closed Properly (</html>):', art.content?.includes('</html>'))
      console.log('  Has Canvas Tag:', art.content?.includes('<canvas'))
      console.log('  Has requestAnimationFrame or Game Loop:', art.content?.includes('requestAnimationFrame') || art.content?.includes('setInterval'))
      console.log('  Last 150 chars of artifact:\n', art.content?.slice(-150))
    }
  } catch (err) {
    console.error(`\n❌ FAILED in ${Date.now() - start}ms:`, err.message)
    if (err.cause) console.error('  Cause:', err.cause)
  }
}

run()
