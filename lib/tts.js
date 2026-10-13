import 'dotenv/config'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { getTtsSettings, startVoicevox, stopVoicevox, probeVoicevox } from './tts-settings.js'

// Catatan: TTS_ENGINE di .env kini hanya nilai awal. Engine efektif dibaca
// dari pengaturan runtime (dashboard) lewat getTtsSettings() pada tiap request.
const KOKORO_URL = process.env.KOKORO_URL || 'http://127.0.0.1:50030'
const TTSQUEST_URL = process.env.TTSQUEST_URL || 'https://api.tts.quest/v1'
const TTSQUEST_KEY = process.env.TTS_QUEST_KEY || ''

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

// --- VOICEVOX (anime girl) -------------------------------------------------
// Petakan mood ke skala kecepatan/nada/intonasi VOICEVOX.
function mapVoicevoxStyle(mood = 'tenang') {
  const m = (mood || 'tenang').toLowerCase()
  if (m === 'ceria' || m === 'senang') return { speed: 1.08, pitch: 0.03, intonation: 1.25 }
  if (m === 'sayang/manja') return { speed: 0.95, pitch: 0.01, intonation: 1.22 }
  if (m === 'malu' || m === 'cemburu' || m === 'kesal') return { speed: 1.05, pitch: 0.05, intonation: 1.28 }
  if (m === 'sedih' || m === 'lesu' || m === 'kecewa') return { speed: 0.9, pitch: -0.03, intonation: 1.1 }
  return { speed: 1.0, pitch: 0.0, intonation: 1.15 }
}

async function voicevoxTTS(text, mood, settings) {
  const cleaned = cleanDialogueText(text)
  const { speed, pitch, intonation } = mapVoicevoxStyle(mood)
  const speaker = settings.voicevoxSpeaker
  const base = settings.voicevoxUrl

  const queryUrl = `${base}/audio_query?text=${encodeURIComponent(cleaned)}&speaker=${speaker}`
  const queryRes = await fetch(queryUrl, { method: 'POST' })
  if (!queryRes.ok) throw new Error(`VOICEVOX audio_query gagal (HTTP ${queryRes.status})`)
  const audioQuery = await queryRes.json()
  audioQuery.speedScale = speed
  audioQuery.pitchScale = pitch
  audioQuery.intonationScale = intonation

  const synthRes = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(audioQuery)
  })
  if (!synthRes.ok) throw new Error(`VOICEVOX synthesis gagal (HTTP ${synthRes.status})`)
  const buffer = Buffer.from(await synthRes.arrayBuffer())
  return { buffer, mime: 'audio/wav' }
}

// --- Kokoro (VTuber blend) -------------------------------------------------
function mapKokoroVTuberPreset(mood = 'tenang') {
  const m = (mood || 'tenang').toLowerCase()
  if (m === 'ceria' || m === 'senang') return { preset: 'vtuber_cute', speed: 1.08 }
  if (m === 'sayang/manja') return { preset: 'vtuber_manja', speed: 0.98 }
  if (m === 'malu' || m === 'cemburu' || m === 'kesal') return { preset: 'vtuber_tsundere', speed: 1.05 }
  if (m === 'sedih' || m === 'lesu') return { preset: 'vtuber_calm', speed: 0.92 }
  return { preset: 'vtuber_cute', speed: 1.04 }
}

async function kokoroVTuberTTS(text, mood) {
  const cleaned = cleanDialogueText(text)
  const { preset, speed } = mapKokoroVTuberPreset(mood)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(`${KOKORO_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned, preset, speed, lang: 'id' }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`Kokoro service HTTP error ${res.status}`)
    return { buffer: Buffer.from(await res.arrayBuffer()), mime: 'audio/wav' }
  } finally {
    clearTimeout(timeoutId)
  }
}

// --- Edge TTS (suara cewek Indonesia natural) ------------------------------
async function edgeIndonesianTTS(text, mood, settings) {
  const cleaned = cleanDialogueText(text)
  const tts = new MsEdgeTTS()
  const voice = settings.edgeVoice || 'id-ID-GadisNeural'
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

  // Basis dari pengaturan; mood hanya menggeser sedikit agar tetap natural.
  const parseHz = (v, fallback) => {
    const m = String(v || '').match(/-?\d+/)
    return m ? Number(m[0]) : fallback
  }
  const parsePct = (v, fallback) => {
    const m = String(v || '').match(/-?\d+/)
    return m ? Number(m[0]) : fallback
  }
  let pitch = parseHz(settings.edgePitch, 3)
  let rate = parsePct(settings.edgeRate, 0)
  if (mood) {
    const m = mood.toLowerCase()
    if (m === 'ceria' || m === 'senang') { pitch += 2; rate += 4 }
    else if (m === 'sayang/manja') { pitch += 1; rate -= 2 }
    else if (m === 'malu' || m === 'cemburu') { pitch += 2; rate += 2 }
    else if (m === 'kesal') { rate += 6 }
    else if (m === 'sedih' || m === 'kecewa') { pitch -= 3; rate -= 6 }
  }

  const { audioStream } = tts.toStream(cleaned, { pitch: `${pitch >= 0 ? '+' : ''}${pitch}Hz`, rate: `${rate >= 0 ? '+' : ''}${rate}%` })
  const chunks = []
  await new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c))
    audioStream.on('end', resolve)
    audioStream.on('close', resolve)
    audioStream.on('error', reject)
  })
  return { buffer: Buffer.concat(chunks), mime: 'audio/mpeg' }
}

// --- Pemilih engine --------------------------------------------------------
async function runEngine(engine, text, mood, settings) {
  if (engine === 'voicevox') return voicevoxTTS(text, mood, settings)
  if (engine === 'kokoro') return kokoroVTuberTTS(text, mood)
  return edgeIndonesianTTS(text, mood, settings)
}

/**
 * Hasilkan audio dari teks. `settingsOverride` dipakai endpoint admin untuk
 * mencoba engine tanpa menyimpan konfigurasi lebih dulu.
 */
export async function synthesize(text, mood, settingsOverride = null) {
  const settings = settingsOverride || getTtsSettings()
  const engine = String(settings.engine || 'edge').toLowerCase()

  // ── SAKLAR MASTER ──
  // Kalau VOICEVOX dimatikan dari dashboard, JANGAN nyalakan sendiri dan
  // jangan pakai engine lain. Yuki tidak bersuara sampai dinyalakan lagi.
  // (Sebelumnya di sini daemon selalu dihidupkan ulang, jadi terasa
  //  "hidup sendiri" walau sudah dimatikan.)
  if (engine === 'voicevox' && settings.voicevoxEnabled === false) {
    const skip = new Error('VOICEVOX dimatikan dari dashboard — suara nonaktif.')
    skip.code = 'VOICEVOX_DISABLED'
    throw skip
  }

  // Untuk VOICEVOX, pastikan daemon hidup dulu (kalau OFF, nyalakan lalu matikan lagi).
  if (engine === 'voicevox') {
    const probe = await probeVoicevox(settings)
    if (!probe.reachable) {
      const started = await startVoicevox()
      if (!started.ok) {
        throw new Error(`VOICEVOX tidak bisa dihidupkan: ${started.error || 'tidak diketahui'}`)
      }
    }
    try {
      return await runEngine('voicevox', text, mood, settings)
    } finally {
      // Kalau keepAlive mati, kembalikan RAM/CPU ke 0 setelah selesai.
      // Kalau menyala (default), daemon dibiarkan hangat supaya balasan
      // berikutnya tidak kena cold-start lagi.
      if (settings.voicevoxKeepAlive === false) {
        stopVoicevox().catch(err => console.warn('[TTS] gagal stop VOICEVOX:', err.message))
      }
    }
  }

  const order = [engine, engine === 'edge' ? null : 'edge'].filter(Boolean)
  let lastError = null
  for (const candidate of order) {
    try {
      return await runEngine(candidate, text, mood, settings)
    } catch (error) {
      lastError = error
      console.warn(`[TTS] engine "${candidate}" gagal: ${error.message}`)
    }
  }
  throw lastError || new Error('Semua engine TTS gagal.')
}
