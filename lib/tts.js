import 'dotenv/config'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const ENGINE = (process.env.TTS_ENGINE || 'edge').toLowerCase()

async function translateToJapanese(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=id&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Translation failed');
    const json = await res.json();
    return json[0].map(s => s[0]).join('');
  } catch (e) {
    console.error('[TTS Translate] Gagal menerjemahkan ke Jepang:', e.message);
    return text;
  }
}

function convertToJapanesePhonetics(text) {
  let t = text.toLowerCase()
  t = t.replace(/c/g, 'ch')
  t = t.replace(/l/g, 'r')
  t = t.replace(/\b(\w+)\b/g, (word) => {
    if (word === 'komik') return 'komiku'
    if (word === 'baca') return 'bacha'
    if (word === 'sih') return 'si'
    if (word === 'deh') return 'de'
    if (word === 'dong') return 'don-gu'
    
    const lastChar = word.slice(-1)
    const body = word.slice(0, -1)
    if (/[bcdfghjklmpqrstvwxyz]/.test(lastChar)) {
      if (lastChar === 'n' || lastChar === 'h') return word
      if (lastChar === 'k') return body + 'ku'
      if (lastChar === 't') return body + 'to'
      if (lastChar === 's') return body + 'su'
      if (lastChar === 'p') return body + 'pu'
      if (lastChar === 'd') return body + 'do'
      if (lastChar === 'b') return body + 'bu'
      if (lastChar === 'g') return body + 'gu'
      if (lastChar === 'm') return body + 'mu'
    }
    return word
  })
  return t
}

// ---- Edge TTS (GRATIS, tanpa Docker / tanpa server) ----
// Pakai suara Jepang (mis. ja-JP-NanamiNeural) supaya teks Indonesia
// dibaca dengan fonem Jepang -> terdengar imut ber-aksen Jepang (anime).
async function edgeTTS(text, mood) {
  const tts = new MsEdgeTTS()
  const voice = (process.env.TTS_JAPANESE_ACCENT === 'true')
    ? 'ja-JP-NanamiNeural'
    : (process.env.EDGE_VOICE || 'id-ID-GadisNeural')
  console.log(`[TTS] Menggunakan suara: ${voice} (Mood: ${mood || 'tenang'})`);
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  // Baseline default
  let pitch = process.env.EDGE_PITCH || '+8Hz'
  let rate = process.env.EDGE_RATE || '+0%'

  // Modulasi suara dinamis berdasarkan mood aktif
  if (mood) {
    const m = mood.toLowerCase()
    const isIndo = voice.includes('id-ID')
    if (m === 'ceria' || m === 'senang') {
      pitch = isIndo ? '+5Hz' : '+12Hz'
      rate = '+4%'
    } else if (m === 'sayang/manja') {
      pitch = isIndo ? '+3Hz' : '+9Hz'
      rate = '-2%'
    } else if (m === 'malu') {
      pitch = isIndo ? '+4Hz' : '+11Hz'
      rate = '+6%' // agak cepat karena gugup
    } else if (m === 'sedih' || m === 'kecewa') {
      pitch = isIndo ? '-2Hz' : '+2Hz'
      rate = '-10%' // berat dan lambat
    } else if (m === 'kesal') {
      pitch = isIndo ? '+1Hz' : '+4Hz'
      rate = '+10%' // tajam dan ketus
    } else if (m === 'lesu') {
      pitch = isIndo ? '-3Hz' : '-2Hz'
      rate = '-12%' // lemas
    } else if (m === 'cemas') {
      pitch = isIndo ? '+3Hz' : '+10Hz'
      rate = '+7%' // gugup/panik
    }
  }

  const { audioStream } = tts.toStream(text, { pitch, rate })

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

// ---- VOICEVOX Online API (TTS Quest, Gratis & Tanpa Docker Lokal) ----
async function ttsQuestVoicevoxTTS(text) {
  const speaker = process.env.VOICEVOX_SPEAKER || '1'
  const key = process.env.TTS_QUEST_KEY || ''
  const keyParam = key ? `&key=${key}` : ''
  const url = `https://api.tts.quest/v3/voicevox/synthesis?text=${encodeURIComponent(text)}&speaker=${speaker}${keyParam}`
  
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TTS Quest API failed with status ${res.status}`)
  
  const json = await res.json()
  if (!json.success || !json.mp3DownloadUrl || !json.audioStatusUrl) {
    throw new Error('TTS Quest synthesis request failed')
  }
  
  const statusUrl = json.audioStatusUrl
  const audioUrl = json.mp3DownloadUrl
  
  // Polling status.json (lightweight) instead of hitting audio binary URL directly.
  // Wait up to 50 attempts x 1000ms = 50 seconds to account for free server load.
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const statusRes = await fetch(statusUrl)
      if (statusRes.ok) {
        const statusJson = await statusRes.json()
        if (statusJson.isAudioError) {
          throw new Error('TTS Quest server encountered an audio generation error')
        }
        if (statusJson.isAudioReady) {
          const audioRes = await fetch(audioUrl)
          if (audioRes.ok) {
            const buffer = Buffer.from(await audioRes.arrayBuffer())
            if (buffer.length > 500) {
              return { buffer, mime: 'audio/mpeg' }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[TTS Quest] Gagal polling pada iterasi ${i+1}:`, e.message)
      if (e.message.includes('audio generation error')) {
        throw e
      }
    }
  }
  throw new Error('TTS Quest audio generation timed-out')
}

export async function synthesize(text, mood) {
  let textToSpeak = text
  if (process.env.TTS_JAPANESE_TRANSLATE === 'true') {
    textToSpeak = await translateToJapanese(text)
  } else if (process.env.TTS_JAPANESE_ACCENT === 'true') {
    textToSpeak = convertToJapanesePhonetics(text)
  }
  
  if (ENGINE === 'ttsquest') {
    try {
      return await ttsQuestVoicevoxTTS(textToSpeak)
    } catch (e) {
      console.error('[TTS Quest] Error, falling back to Edge TTS:', e.message)
      return edgeTTS(textToSpeak, mood)
    }
  }
  if (ENGINE === 'voicevox') return voicevoxTTS(textToSpeak)
  return edgeTTS(textToSpeak, mood)
}