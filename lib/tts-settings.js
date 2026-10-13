import 'dotenv/config'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const FILE = path.resolve(process.env.TTS_CONFIG_FILE || './.runtime-secrets/tts-settings.json')

// Semua engine yang didukung. `id` cocok dengan TTS_ENGINE di lib/tts.js
export const TTS_ENGINES = ['edge', 'voicevox', 'kokoro', 'ttsquest']

// Konfigurasi default
const DEFAULTS = Object.freeze({
  engine: (process.env.TTS_ENGINE || 'edge').toLowerCase(),
  voicevoxSpeaker: Number(process.env.VOICEVOX_SPEAKER || 14),
  voicevoxUrl: process.env.VOICEVOX_URL || 'http://127.0.0.1:50021',
  // SAKLAR MASTER VOICEVOX.
  //   true  = VOICEVOX aktif; boleh dinyalakan otomatis saat dipakai.
  //   false = VOICEVOX DIMATIKAN TOTAL. TTS tidak boleh menyalakannya
  //           sendiri, dan Yuki tidak bersuara sama sekali.
  // Inilah yang dibaca synthesize() supaya daemon tidak "hidup sendiri".
  voicevoxEnabled: String(process.env.VOICEVOX_ENABLED || 'true').toLowerCase() === 'true',
  // Kalau true, daemon VOICEVOX dibiarkan menyala terus setelah dipakai
  // (suara instan, tanpa cold-start). Kalau false, daemon dimatikan lagi
  // supaya RAM/CPU kembali 0.
  voicevoxKeepAlive: String(process.env.VOICEVOX_KEEP_ALIVE || 'true').toLowerCase() === 'true',
  // Nama proses PM2 yang dipakai untuk start/stop daemon VOICEVOX.
  voicevoxPm2Name: process.env.VOICEVOX_PM2_NAME || 'voicevox',
  // Engine yang dipakai saat VOICEVOX dimatikan (harus ringan).
  fallbackEngine: (process.env.TTS_FALLBACK_ENGINE || 'edge').toLowerCase(),
  edgeVoice: process.env.EDGE_VOICE || 'id-ID-GadisNeural',
  edgePitch: process.env.EDGE_PITCH || '+3Hz',
  edgeRate: process.env.EDGE_RATE || '+0%'
})

function clampSpeaker(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 200) return fallback
  return Math.trunc(n)
}

function clean(input = {}, current = DEFAULTS) {
  const engine = TTS_ENGINES.includes(String(input.engine || '').toLowerCase())
    ? String(input.engine).toLowerCase()
    : current.engine
  let url = String(input.voicevoxUrl ?? current.voicevoxUrl ?? '').trim() || DEFAULTS.voicevoxUrl
  // Hanya izinkan localhost/loopback — engine ini tidak boleh dipanggil dari luar.
  try {
    const parsed = new URL(url)
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
      throw new Error('host bukan loopback')
    }
    url = `${parsed.protocol}//${parsed.host}`
    if (parsed.protocol !== 'http:') throw new Error('protokol bukan http')
  } catch {
    url = DEFAULTS.voicevoxUrl
  }
  return {
    engine,
    voicevoxSpeaker: clampSpeaker(input.voicevoxSpeaker, current.voicevoxSpeaker),
    voicevoxUrl: url,
    voicevoxEnabled: input.voicevoxEnabled === undefined
      ? current.voicevoxEnabled
      : Boolean(input.voicevoxEnabled),
    voicevoxKeepAlive: input.voicevoxKeepAlive === undefined
      ? current.voicevoxKeepAlive
      : Boolean(input.voicevoxKeepAlive),
    voicevoxPm2Name: String(input.voicevoxPm2Name ?? current.voicevoxPm2Name ?? 'voicevox').trim().slice(0, 60) || 'voicevox',
    edgeVoice: String(input.edgeVoice ?? current.edgeVoice ?? DEFAULTS.edgeVoice).trim().slice(0, 120) || DEFAULTS.edgeVoice,
    edgePitch: String(input.edgePitch ?? current.edgePitch ?? DEFAULTS.edgePitch).trim().slice(0, 20) || DEFAULTS.edgePitch,
    edgeRate: String(input.edgeRate ?? current.edgeRate ?? DEFAULTS.edgeRate).trim().slice(0, 20) || DEFAULTS.edgeRate
  }
}

export function getTtsSettings() {
  if (!existsSync(FILE)) return structuredClone({ ...DEFAULTS })
  try {
    return clean(JSON.parse(readFileSync(FILE, 'utf8')))
  } catch (error) {
    console.error('[tts-settings] config invalid, memakai default:', error.message)
    return structuredClone({ ...DEFAULTS })
  }
}

export function saveTtsSettings(input = {}) {
  const current = getTtsSettings()
  const next = clean({ ...current, ...input }, current)
  mkdirSync(path.dirname(FILE), { recursive: true })
  const temp = `${FILE}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(temp, FILE)
  chmodSync(FILE, 0o600)
  return next
}

// ---------------------------------------------------------------------------
// Kontrol proses VOICEVOX (start/stop daemon PM2) supaya saat OFF benar-benar
// 0% RAM/CPU, bukan hanya tidak dipakai.
// ---------------------------------------------------------------------------

async function pm2(args, timeout = 15_000) {
  try {
    const { stdout } = await execFileAsync('pm2', args, { timeout, maxBuffer: 4 * 1024 * 1024 })
    return { ok: true, stdout: String(stdout || '') }
  } catch (error) {
    return { ok: false, error: String(error?.stderr || error?.message || error).slice(0, 400) }
  }
}

/** Ambil status proses VOICEVOX dari PM2 (online | stopped | not_found). */
export async function getVoicevoxProcessStatus() {
  const name = getTtsSettings().voicevoxPm2Name
  const res = await pm2(['jlist'], 12_000)
  if (!res.ok) return { state: 'unknown', error: res.error, pm2Name: name }
  try {
    const list = JSON.parse(res.stdout)
    const proc = Array.isArray(list) ? list.find(p => p?.name === name) : null
    if (!proc) return { state: 'not_found', pm2Name: name }
    const status = String(proc.pm2_env?.status || 'unknown')
    return {
      state: status, // online | stopped | errored | ...
      pm2Name: name,
      pid: proc.pid || null,
      restarts: proc.pm2_env?.restart_time ?? null,
      memoryMb: proc.monit?.memory ? Math.round(proc.monit.memory / 1024 / 1024) : null,
      cpu: proc.monit?.cpu ?? null,
      uptimeMs: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : null
    }
  } catch (error) {
    return { state: 'unknown', error: String(error.message || error).slice(0, 200), pm2Name: name }
  }
}

/**
 * Hidupkan daemon VOICEVOX + tunggu siap menerima request.
 * Idempoten: kalau sudah online, langsung mengembalikan ready.
 */
export async function startVoicevox({ timeoutMs = 40_000 } = {}) {
  const settings = getTtsSettings()
  const name = settings.voicevoxPm2Name
  const before = await getVoicevoxProcessStatus()

  if (before.state !== 'online') {
    const started = await pm2(['start', name], 20_000)
    if (!started.ok) {
      // Mungkin proses belum pernah didaftarkan ke PM2.
      return { ok: false, state: before.state, error: started.error || 'gagal start via pm2' }
    }
  }

  // Tunggu HTTP benar-benar siap (bukan hanya PM2 bilang online).
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${settings.voicevoxUrl}/version`, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) {
        const version = await res.json().catch(() => null)
        return { ok: true, state: 'online', version, pm2Name: name }
      }
      lastError = `HTTP ${res.status}`
    } catch (error) {
      lastError = String(error.message || error).slice(0, 160)
    }
    await new Promise(r => setTimeout(r, 1200))
  }
  return { ok: false, state: 'starting', error: `timeout menunggu VOICEVOX siap: ${lastError || 'tidak ada respons'}`, pm2Name: name }
}

/** Matikan daemon VOICEVOX supaya RAM/CPU kembali 0. */
export async function stopVoicevox() {
  const name = getTtsSettings().voicevoxPm2Name
  const res = await pm2(['stop', name], 20_000)
  if (!res.ok) return { ok: false, error: res.error, pm2Name: name }
  const after = await getVoicevoxProcessStatus()
  return { ok: after.state !== 'online', state: after.state, pm2Name: name }
}

/**
 * Setel ulang `autorestart` proses VOICEVOX di PM2.
 *   true  -> PM2 otomatis menghidupkan daemon kalau mati.
 *   false -> PM2 TIDAK menghidupkan ulang (dipakai saat dimatikan dari dashboard,
 *            supaya daemon tidak "hidup sendiri" setelah dimatikan).
 */
export async function setVoicevoxAutorestart(enabled) {
  const name = getTtsSettings().voicevoxPm2Name
  const res = await pm2(['startup-autorestart', name, enabled ? 'true' : 'false'], 15_000)
  // Kalau subcommand di atas tidak dikenali versi PM2 ini, pakai cara alternatif.
  if (!res.ok) {
    const alt = await pm2([enabled ? 'start' : 'stop', name], 15_000)
    return { ok: alt.ok, error: alt.error, pm2Name: name, mode: 'fallback' }
  }
  return { ok: true, pm2Name: name, autorestart: Boolean(enabled) }
}

/** Cek daemon VOICEVOX sedang hidup & responsif (untuk UI). */
export async function probeVoicevox(settings = getTtsSettings()) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`${settings.voicevoxUrl}/version`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` }
    const version = await res.json().catch(() => null)
    return { reachable: true, version }
  } catch (error) {
    return { reachable: false, error: String(error.message || error).slice(0, 160) }
  }
}

/** Daftar speaker dari engine (untuk pemilih suara di dashboard). */
export async function listVoicevoxSpeakers() {
  const settings = getTtsSettings()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`${settings.voicevoxUrl}/speakers`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const raw = await res.json()
    const speakers = []
    for (const sp of Array.isArray(raw) ? raw : []) {
      for (const style of sp?.styles || []) {
        speakers.push({ id: style.id, name: `${sp.name} · ${style.name}`, character: sp.name, style: style.name })
      }
    }
    return { ok: true, speakers }
  } catch (error) {
    clearTimeout(timer)
    return { ok: false, error: String(error.message || error).slice(0, 160) }
  }
}
