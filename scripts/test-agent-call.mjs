// scripts/test-agent-call.mjs
import { callLLM } from '../lib/llm.js'
import { buildAgentSystemPrompt } from '../lib/agent/persona.js'
import { getAvailableTools, initSkills } from '../lib/agent/skills-engine.js'

async function run() {
  await initSkills()
  const tools = await getAvailableTools()
  const prompt = buildAgentSystemPrompt({ bondName: 'mulai terbiasa' })

  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: 'buatkan game platform terbaik jadul retro gituu' }
  ]

  console.log('Sending request to callLLM (with tools)...')
  const startTime = Date.now()
  try {
    const res = await callLLM(messages, { tools })
    console.log(`✅ SUCCESS in ${Date.now() - startTime}ms:`)
    console.log('  Provider:', res.provider?.name)
    console.log('  Tool Calls:', res.tool_calls?.length)
    if (res.tool_calls?.length) {
      console.log('  Tool name:', res.tool_calls[0].function?.name)
      console.log('  Tool args length:', res.tool_calls[0].function?.arguments?.length)
    }
    console.log('  Content:', res.content?.slice(0, 150))
  } catch (err) {
    console.error(`❌ FAILED in ${Date.now() - startTime}ms:`, err.message)
    if (err.cause) console.error('  Cause:', err.cause)
  }
}

run()
