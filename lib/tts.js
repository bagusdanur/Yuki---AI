import 'dotenv/config'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const ENGINE = (process.env.TTS_ENGINE || 'kokoro').toLowerCase()
const KOKORO_URL = process.env.KOKORO_URL || 'http://127.0.0.1:50030'

// Bersihkan teks dialog: hapus ekspresi/aksi asteris seperti *tersenyum*, *menghela napas*
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

// Map emosi Yuki ke parameter suara Kokoro
function mapKokoroVoiceAndSpeed(mood = 'tenang') {
  const m = (mood || 'tenang').toLowerCase()
  // af_bella: ceria & imut, af_sarah: tenang/dewasa, af_nicole: gugup/malu, af_sky: manja
  if (m === 'ceria' || m === 'senang') {
    return { voice: 'af_bella', speed: 1.05 }
  }
  if (m === 'sayang/manja') {
    return { voice: 'af_sky', speed: 0.94 }
  }
  if (m === 'malu' || m === 'cemburu') {
    return { voice: 'af_nicole', speed: 1.02 }
  }
  if (m === 'kesal' || m === 'kecewa') {
    return { voice: 'af_sarah', speed: 1.05 }
  }
  if (m === 'sedih' || m === 'lesu') {
    return { voice: 'af_sarah', speed: 0.90 }
  }
  return { voice: 'af_bella', speed: 1.0 }
}

async function kokoroTTS(text, mood) {
  const cleaned = cleanDialogueText(text)
  const { voice, speed } = mapKokoroVoiceAndSpeed(mood)
  console.log(`[Kokoro TTS] Mensintesis suara: ${voice} (Mood: ${mood || 'tenang'}, Speed: ${speed})`)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch(`${KOKORO_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleaned,
        voice,
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

// ---- Fallback: Edge TTS (Gratis) ----
async function edgeTTS(text, mood) {
  const cleaned = cleanDialogueText(text)
  const tts = new MsEdgeTTS()
  const voice = (process.env.TTS_JAPANESE_ACCENT === 'true')
    ? 'ja-JP-NanamiNeural'
    : (process.env.EDGE_VOICE || 'id-ID-GadisNeural')
  console.log(`[Edge TTS Fallback] Menggunakan suara: ${voice} (Mood: ${mood || 'tenang'})`)
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  let pitch = process.env.EDGE_PITCH || '+10Hz'
  let rate = process.env.EDGE_RATE || '+0%'

  if (mood) {
    const m = mood.toLowerCase()
    const isIndo = voice.includes('id-ID')
    if (m === 'ceria' || m === 'senang') {
      pitch = isIndo ? '+8Hz' : '+12Hz'
      rate = '+4%'
    } else if (m === 'sayang/manja') {
      pitch = isIndo ? '+5Hz' : '+9Hz'
      rate = '-2%'
    } else if (m === 'malu') {
      pitch = isIndo ? '+6Hz' : '+11Hz'
      rate = '+6%'
    } else if (m === 'sedih' || m === 'kecewa') {
      pitch = isIndo ? '-2Hz' : '+2Hz'
      rate = '-10%'
    } else if (m === 'kesal') {
      pitch = isIndo ? '+2Hz' : '+4Hz'
      rate = '+10%'
    } else if (m === 'lesu') {
      pitch = isIndo ? '-3Hz' : '-2Hz'
      rate = '-12%'
    } else if (m === 'cemas') {
      pitch = isIndo ? '+4Hz' : '+10Hz'
      rate = '+7%'
    }
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
      return await kokoroTTS(text, mood)
    } catch (e) {
      console.warn('[TTS] Kokoro offline/error, fallback otomatis ke Edge TTS:', e.message)
      return edgeTTS(text, mood)
    }
  }
  return edgeTTS(text, mood)
}