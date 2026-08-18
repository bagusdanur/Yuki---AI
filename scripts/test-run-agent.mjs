// scripts/test-run-agent.mjs
import 'dotenv/config'
import { runAgent } from '../lib/agent/runner.js'

async function run() {
  console.log('Testing runAgent end-to-end with user prompt: "buatkan game platform terbaik jadul retro gituu"...')
  const start = Date.now()
  try {
    const res = await runAgent({
      userMessage: 'buatkan game platform terbaik jadul retro gituu',
      userId: 'test_user_game',
      pastMessages: []
    })

    console.log(`\n🎉 SUCCESS in ${Date.now() - start}ms:`)
    console.log('  Model:', res.model)
    console.log('  Mood:', res.mood)
    console.log('  Artifacts count:', res.artifacts?.length || 0)
    if (res.artifacts?.length) {
      console.log('  Artifact #1 Title:', res.artifacts[0].title)
      console.log('  Artifact #1 Type:', res.artifacts[0].type)
      console.log('  Artifact #1 Content length:', res.artifacts[0].content?.length)
    }
    console.log('  Reply text snippet:\n', res.reply?.slice(0, 300))
  } catch (err) {
    console.error(`\n❌ FAILED in ${Date.now() - start}ms:`, err.message)
    if (err.cause) console.error('  Cause:', err.cause)
  }
}

run()
