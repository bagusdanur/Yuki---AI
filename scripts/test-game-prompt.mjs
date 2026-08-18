// scripts/test-game-prompt.mjs
import 'dotenv/config'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy',
  baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1',
  timeout: 30_000,
  maxRetries: 0
})

async function run() {
  const prompt = `Kamu adalah Yuki, 19 tahun dalam Mode Agent.
Karaktermu dingin tapi peduli.
TUGAS: Buatkan game platformer jadul retro interaktif lengkap menggunakan HTML5 Canvas.
Tuliskan kode lengkap yang siap jalan di dalam blok kode \`\`\`html ... \`\`\`.
Di akhir, sertakan tag [emosi: senang].`

  console.log('Sending game generation prompt without tool constraint...')
  const start = Date.now()
  try {
    const res = await client.chat.completions.create({
      model: 'ag/gemini-3-flash',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'buatkan game platform terbaik jadul retro gituu' }
      ],
      temperature: 0.6,
      max_tokens: 4096
    })

    const content = res.choices?.[0]?.message?.content || ''
    console.log(`✅ SUCCESS in ${Date.now() - start}ms:`)
    console.log('  Finish reason:', res.choices?.[0]?.finish_reason)
    console.log('  Content length:', content.length)
    console.log('  Has ```html block:', content.includes('```html') || content.includes('<!DOCTYPE'))
    console.log('  Snippet:\n', content.slice(0, 200))
  } catch (err) {
    console.error(`❌ FAILED in ${Date.now() - start}ms:`, err.message)
  }
}

run()
