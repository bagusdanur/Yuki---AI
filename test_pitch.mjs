import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import fs from 'fs'

async function generateSample(pitch, rate, filename, text) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata('id-ID-GadisNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  const { audioStream } = tts.toStream(text, { pitch, rate })
  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c))
    audioStream.on('end', resolve)
    audioStream.on('close', resolve)
    audioStream.on('error', reject)
  })
  const buffer = Buffer.concat(chunks)
  fs.writeFileSync(filename, buffer)
  console.log(`Generated ${filename}: ${buffer.length} bytes (Pitch: ${pitch}, Rate: ${rate})`)
}

async function main() {
  const text = 'Sekarang sudah jam sembilan lewat enam malam. Kenapa tanya? Kangen ya sama aku?'
  await generateSample('+18Hz', '+3%', '/tmp/yuki_pitch_18.mp3', text)
  await generateSample('+24Hz', '+4%', '/tmp/yuki_pitch_24.mp3', text)
  await generateSample('+30Hz', '+5%', '/tmp/yuki_pitch_30.mp3', text)
}

main().catch(console.error)
