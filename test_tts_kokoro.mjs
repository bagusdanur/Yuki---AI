import { synthesize } from './lib/tts.js'

async function run() {
  console.log('Testing synthesize with Kokoro AI TTS...')
  const startTime = Date.now()
  const res = await synthesize('Halo, aku Yuki! Senang bisa ngobrol sama kamu hari ini.', 'senang')
  const duration = Date.now() - startTime
  console.log('Synthesized successfully!')
  console.log('Duration:', duration, 'ms')
  console.log('Audio bytes:', res.buffer.length)
  console.log('Mime type:', res.mime)
}

run().catch(console.error)
