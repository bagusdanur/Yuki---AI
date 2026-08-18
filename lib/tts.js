import 'dotenv/config'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const ENGINE = (process.env.TTS_ENGINE || 'kokoro').toLowerCase()
const KOKORO_URL = process.env.KOKORO_URL || 'http://127.0.0.1:50030'

// Bersihkan teks dialog: buang teks aksi asteris *...*, tag emosi, code block, url
export function cleanDialogueText(text = '') {
  let cleaned = String(text || '')
    .replace(/\*[^*\n]{1,150}\*/g, '') // hapus aksi dialog *...*
    .replace(/\[emosi:\s*[^\]]+\]/gi, '') // hapus tag emosi [emosi: ...]
    .replace(/https?:\/\/\S+/gi, '') // hapus tautan URL
    .replace(/```[\s\S]*?```/g, '') // hapus blok kode
    .replace(/`[^`]+`/g, '') // hapus inline code
    .replace(/[*_#~>]/g, '') // bersihkan sisa markdown simbol
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'Halo'
}

// Map mood Yuki ke preset Kokoro VTuber Blend
function mapKokoroVTuberPreset(mood = 'tenang') {
  const m = (mood || 'tenang').toLowerCase()
  if (m === 'ceria' || m === 'senang') {
    return { preset: 'vtuber_cute', speed: 1.08 }
  }
  if (m === 'sayang/manja') {
    return { preset: 'vtuber_manja', speed: 0.98 }
  }
  if (m === 'malu' || m === 'cemburu' || m === 'kesal') {
    return { preset: 'vtuber_tsundere', speed: 1.05 }
  }
  if (m === 'sedih' || m === 'lesu') {
    return { preset: 'vtuber_calm', speed: 0.92 }
  }
  return { preset: 'vtuber_cute', speed: 1.04 }
}

async function kokoroVTuberTTS(text, mood) {
  const cleaned = cleanDialogueText(text)
  const { preset, speed } = mapKokoroVTuberPreset(mood)
  console.log(`[Kokoro VTuber TTS] Mensintesis preset: ${preset} (Mood: ${mood || 'tenang'}, Speed: ${speed})`)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch(`${KOKORO_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleaned,
        preset,
        speed,
        lang: 'en-us'
      }),
      signal: controller.signal
    })

    if (!res.ok) {
      throw new Error(`Kokoro service HTTP error ${res.status}`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, mime: 'audio/wav' }
  } finally {
    clearTimeout(timeoutId)
  }
}

// Fallback: Fine-tuned Edge TTS
async function edgeIndonesianTTS(text, mood) {
  const cleaned = cleanDialogueText(text)
  const tts = new MsEdgeTTS()
  const voice = 'id-ID-GadisNeural'
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  let pitch = '+22Hz'
  let rate = '+3%'
  if (mood) {
    const m = mood.toLowerCase()
    if (m === 'ceria' || m === 'senang') { pitch = '+26Hz'; rate = '+6%' }
    else if (m === 'sayang/manja') { pitch = '+24Hz'; rate = '-1%' }
    else if (m === 'malu' || m === 'cemburu') { pitch = '+25Hz'; rate = '+5%' }
    else if (m === 'kesal') { pitch = '+22Hz'; rate = '+8%' }
    else if (m === 'sedih' || m === 'kecewa') { pitch = '+14Hz'; rate = '-8%' }
  }

  const { audioStream } = tts.toStream(cleaned, { pitch, rate })
  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c))
    audioStream.on('end', resolve)
    audioStream.on('close', resolve)
    audioStream.on('error', reject)
  })
  return { buffer: Buffer.concat(chunks), mime: 'audio/mpeg' }
}

export async function synthesize(text, mood) {
  if (ENGINE === 'kokoro') {
    try {
      return await kokoroVTuberTTS(text, mood)
    } catch (e) {
      console.warn('[TTS] Kokoro error, falling back to Edge TTS:', e.message)
      return edgeIndonesianTTS(text, mood)
    }
  }
  return edgeIndonesianTTS(text, mood)
}