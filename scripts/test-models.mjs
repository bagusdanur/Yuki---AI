import 'dotenv/config'
import OpenAI from 'openai'
import { buildAgentSystemPrompt } from '../lib/agent/persona.js'
import { getAvailableTools, initSkills } from '../lib/agent/skills-engine.js'

async function testModel(modelId) {
  const client = new OpenAI({
    apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy',
    baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1',
    timeout: 35_000,
    maxRetries: 0
  })

  await initSkills()
  const tools = await getAvailableTools()
  const prompt = buildAgentSystemPrompt({ bondName: 'mulai terbiasa' })

  const messages = [
    { role: 'system', content: prompt },
    { role: 'user', content: 'buatkan game platform terbaik jadul retro gituu' }
  ]

  console.log(`\nTesting model: ${modelId}...`)
  const start = Date.now()
  try {
    const res = await client.chat.completions.create({
      model: modelId,
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
      console.log(`  First tool: ${choice?.message?.tool_calls[0]?.function?.name}`)
    }
    console.log(`  Content snippet: ${choice?.message?.content?.slice(0, 100) || '(no content)'}`)
  } catch (err) {
    console.error(`❌ FAILED in ${Date.now() - start}ms:`, err.message)
  }
}

async function run() {
  const models = [
    'ag/gemini-3-flash-agent',
    'ag/gemini-3.5-flash-low',
    'ag/gemini-pro-agent',
    'ag/gemini-3.1-pro-low',
    'ag/gemini-3-flash'
  ]

  for (const m of models) {
    await testModel(m)
  }
}

run()
