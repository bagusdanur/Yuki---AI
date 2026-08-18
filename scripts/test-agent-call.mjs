// scripts/test-agent-call.mjs
import 'dotenv/config'
import OpenAI from 'openai'
import { buildAgentSystemPrompt } from '../lib/agent/persona.js'
import { getAvailableTools, initSkills } from '../lib/agent/skills-engine.js'

const client = new OpenAI({
  apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy',
  baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1',
  timeout: 30_000,
  maxRetries: 0
})

async function test(modelName) {
  await initSkills()
  const tools = await getAvailableTools()
  const prompt = buildAgentSystemPrompt({ bondName: 'mulai terbiasa' })

  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: 'buatkan game platform terbaik jadul retro gituu' }
  ]

  console.log(`\n=== Testing Model: ${modelName} ===`)
  const start = Date.now()
  try {
    const res = await client.chat.completions.create({
      model: modelName,
      messages,
      tools,
      temperature: 0.6,
      max_tokens: 4096
    })
    const choice = res.choices?.[0]
    console.log(`✅ SUCCESS in ${Date.now() - start}ms:`)
    console.log(`  Finish reason: ${choice?.finish_reason}`)
    console.log(`  Tool calls: ${choice?.message?.tool_calls?.length || 0}`)
    if (choice?.message?.tool_calls?.length) {
      console.log(`  Tool: ${choice.message.tool_calls[0].function.name}`)
      console.log(`  Args snippet: ${choice.message.tool_calls[0].function.arguments.slice(0, 100)}...`)
    }
  } catch (err) {
    console.error(`❌ FAILED in ${Date.now() - start}ms:`, err.message)
  }
}

async function main() {
  await test('ag/gemini-3-flash-agent')
  await test('ag/gemini-pro-agent')
  await test('ag/gemini-3.5-flash-low')
}

main()
