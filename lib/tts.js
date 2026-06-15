import 'dotenv/config'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const ENGINE = (process.env.TTS_ENGINE || 'edge').toLowerCase()

// ---- Edge TTS (GRATIS, tanpa Docker / tanpa server) ----
// Pakai suara Jepang (mis. ja-JP-NanamiNeural) supaya teks Indonesia
// dibaca dengan fonem Jepang -> terdengar imut ber-aksen Jepang (anime).
async function edgeTTS(text) {
  const tts = new MsEdgeTTS()
  const voice = process.env.EDGE_VOICE || 'ja-JP-NanamiNeural'
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  const { audioStream } = tts.toStream(text, {
    pitch: process.env.EDGE_PITCH || '+8Hz',   // lebih tinggi = lebih imut
    rate: process.env.EDGE_RATE || '+0%'
  })

  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c))
    audioStream.on('end', resolve)
    audioStream.on('close', resolve)
    audioStream.on('error', reject)
  })
  return { buffer: Buffer.concat(chunks), mime: 'audio/mpeg' }
}

// ---- VOICEVOX (suara anime Jepang, alternatif) ----
async function voicevoxTTS(text) {
  const base = process.env.VOICEVOX_URL || 'http://localhost:50021'
  const speaker = process.env.VOICEVOX_SPEAKER || '1'

  // 1) buat audio_query
  const q = await fetch(
    `${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`,
    { method: 'POST' }
  )
  if (!q.ok) throw new Error(`VOICEVOX audio_query gagal: ${q.status}`)
  const query = await q.json()

  // 2) synthesis -> wav
  const s = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  })
  if (!s.ok) throw new Error(`VOICEVOX synthesis gagal: ${s.status}`)

  const buffer = Buffer.from(await s.arrayBuffer())
  return { buffer, mime: 'audio/wav' }
}

export async function synthesize(text) {
  if (ENGINE === 'voicevox') return voicevoxTTS(text)
  return edgeTTS(text)
}