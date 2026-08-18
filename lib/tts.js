import 'dotenv/config'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

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

// Fine-tuned Indonesian Anime Girl Voice (id-ID-GadisNeural dengan Pitch Tuning Manja/Tsundere)
async function edgeIndonesianTTS(text, mood) {
  const cleaned = cleanDialogueText(text)
  const tts = new MsEdgeTTS()
  const voice = 'id-ID-GadisNeural'
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  // Baseline Nada Cewek Muda Imut (+22Hz membuat suara gadis lebih manis dan tidak berat)
  let pitch = process.env.EDGE_PITCH || '+22Hz'
  let rate = process.env.EDGE_RATE || '+3%'

  if (mood) {
    const m = mood.toLowerCase()
    if (m === 'ceria' || m === 'senang') {
      pitch = '+26Hz'
      rate = '+6%' // riang dan bersemangat
    } else if (m === 'sayang/manja') {
      pitch = '+24Hz'
      rate = '-1%' // mendayu-dayu dan manis
    } else if (m === 'malu' || m === 'cemburu') {
      pitch = '+25Hz'
      rate = '+5%' // agak cepat tersipu
    } else if (m === 'sedih' || m === 'kecewa') {
      pitch = '+14Hz'
      rate = '-8%' // lembut dan pelan
    } else if (m === 'kesal') {
      pitch = '+22Hz'
      rate = '+8%' // tajam dan ketus khas tsundere
    } else if (m === 'lesu') {
      pitch = '+16Hz'
      rate = '-10%'
    } else if (m === 'cemas') {
      pitch = '+24Hz'
      rate = '+6%'
    }
  }

  console.log(`[TTS Yuki Indo] Mensintesis: "${cleaned.slice(0, 40)}..." (Mood: ${mood || 'tenang'}, Pitch: ${pitch}, Rate: ${rate})`)
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
  return edgeIndonesianTTS(text, mood)
}