/* ═══════════════════════════════════════════════════════
   PENGATURAN SUARA (TTS)
   Mengontrol mesin suara Yuki + hidup/mati daemon VOICEVOX
   supaya saat OFF, RAM & CPU benar-benar 0.

   CATATAN: skrip ini MANDIRI — semua helper kecil didefinisikan
   sendiri di sini, jadi TIDAK bergantung pada admin.js.
   (Dulu admin.js menyediakan $, field, headers, request; sekarang
   file ini tidak akan rusak walau admin.js gagal dimuat.)
   ═══════════════════════════════════════════════════════ */

// ── Helper lokal (meniru admin.js) ──
const ttsEl = (id) => document.getElementById(id)
function ttsToken() { return sessionStorage.getItem('yuki_admin_session') || '' }
function ttsHeaders(json = false) {
  return {
    Authorization: `Bearer ${ttsToken()}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}
function ttsField(name) { return document.querySelector(`[name="${name}"]`) }
async function ttsRequest(url, options = {}) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const ttsState = { settings: null, speakersLoaded: false, busy: false }

function ttsStatus(text, tone) {
  const el = ttsEl('tts-status')
  if (!el) return
  el.textContent = text
  el.className = 'status-line' + (tone ? ' ' + tone : '')
}

function ttsSetBusy(busy) {
  ttsState.busy = busy
  for (const id of ['tts-vv-start', 'tts-vv-stop', 'tts-test-play']) {
    const el = ttsEl(id)
    if (el) el.disabled = busy
  }
}

function ttsToggleGroups(engine) {
  const vv = ttsEl('tts-voicevox-group')
  const edge = ttsEl('tts-edge-group')
  if (vv) vv.hidden = engine !== 'voicevox'
  if (edge) edge.hidden = engine !== 'edge'
  const pill = ttsEl('tts-engine-state')
  if (pill) {
    pill.textContent = engine || '—'
    pill.className = 'pill ' + (engine === 'voicevox' ? 'on' : 'off')
  }
}

function ttsApplySettings(settings) {
  ttsState.settings = settings
  if (ttsEl('tts-engine')) ttsEl('tts-engine').value = settings.engine || 'edge'

  const speaker = ttsEl('tts-vv-speaker')
  if (speaker && settings.voicevoxSpeaker !== undefined && settings.voicevoxSpeaker !== null) {
    const value = String(settings.voicevoxSpeaker)
    if (![...speaker.options].some(o => o.value === value)) {
      const opt = document.createElement('option')
      opt.value = value
      opt.textContent = `ID ${value}`
      speaker.appendChild(opt)
    }
    speaker.value = value
  }
  if (ttsEl('tts-vv-keepalive')) ttsEl('tts-vv-keepalive').checked = settings.voicevoxKeepAlive !== false
  for (const key of ['edgeVoice', 'edgePitch', 'edgeRate']) {
    const el = ttsField(key)
    if (el) el.value = settings[key] || ''
  }
  ttsToggleGroups(settings.engine)
}

function ttsRenderStatus(data) {
  const pill = ttsEl('tts-vv-status')
  if (!pill) return
  const process = data?.process || {}
  const probe = data?.voicevox || {}
  const online = process.state === 'online' && probe.reachable
  // Saklar master: false = dimatikan dari dashboard (tidak akan menyala sendiri).
  const enabled = data?.enabled !== false

  if (!enabled) {
    // Prioritas tertinggi: user mematikan suara dari dashboard.
    pill.textContent = online ? 'NONAKTIF (daemon sisa)' : 'NONAKTIF'
    pill.className = 'pill off'
  } else if (online) {
    pill.textContent = probe.version ? `hidup · v${probe.version}` : 'hidup'
    pill.className = 'pill on'
  } else if (process.state === 'not_found') {
    pill.textContent = 'belum terdaftar'
    pill.className = 'pill off'
  } else {
    pill.textContent = probe.reachable ? 'hidup' : 'mati'
    pill.className = 'pill ' + (probe.reachable ? 'on' : 'off')
  }

  const set = (id, value) => { const el = ttsEl(id); if (el) el.textContent = value }
  set('tts-vv-ram', online && process.memoryMb != null ? `${process.memoryMb} MB` : '0 MB')
  set('tts-vv-cpu', online && process.cpu != null ? `${process.cpu}%` : '0%')
  set('tts-vv-restart', process.restarts != null ? `${process.restarts}×` : '—')

  // Tombol: saat nonaktif, "Nyalakan" jadi aksen utama.
  const startBtn = ttsEl('tts-vv-start')
  const stopBtn = ttsEl('tts-vv-stop')
  if (startBtn) startBtn.disabled = enabled && online
  if (stopBtn) stopBtn.disabled = !enabled && !online
}

async function ttsRefreshStatus() {
  try {
    const data = await ttsRequest('/api/admin/tts/voicevox/status', { headers: ttsHeaders() })
    ttsRenderStatus(data)
  } catch {
    const pill = ttsEl('tts-vv-status')
    if (pill) { pill.textContent = 'tidak diketahui'; pill.className = 'pill off' }
  }
}

async function ttsLoad() {
  try {
    const data = await ttsRequest('/api/admin/tts', { headers: ttsHeaders() })
    ttsApplySettings(data.settings || {})
    ttsRenderStatus(data)
    ttsStatus('Pengaturan dimuat.')
  } catch (e) {
    ttsStatus(`Gagal memuat: ${e.message}`, 'err')
  }
}

async function ttsLoadSpeakers() {
  const select = ttsEl('tts-vv-speaker')
  if (!select) return
  ttsSetBusy(true)
  ttsStatus('Memuat daftar speaker…')
  try {
    const data = await ttsRequest('/api/admin/tts/voicevox/speakers', { headers: ttsHeaders() })
    if (!data.ok) throw new Error(data.error || 'daftar speaker tidak tersedia')
    const current = ttsState.settings?.voicevoxSpeaker
    select.innerHTML = ''
    for (const sp of data.speakers || []) {
      const opt = document.createElement('option')
      opt.value = String(sp.id)
      opt.textContent = `${sp.id} · ${sp.name}`
      select.appendChild(opt)
    }
    if (current !== undefined && current !== null) select.value = String(current)
    ttsState.speakersLoaded = true
    ttsStatus(`Daftar speaker dimuat — ${(data.speakers || []).length} gaya suara.`, 'ok')
  } catch (e) {
    ttsStatus(`Gagal memuat speaker: ${e.message}`, 'err')
  } finally {
    ttsSetBusy(false)
    ttsRefreshStatus()
  }
}

async function ttsVoicevoxAction(action) {
  ttsSetBusy(true)
  ttsStatus(action === 'start' ? 'Menyalakan VOICEVOX…' : 'Mematikan VOICEVOX…')
  try {
    const data = await ttsRequest(`/api/admin/tts/voicevox/${action}`, { method: 'POST', headers: ttsHeaders() })
    if (data.ok) {
      ttsStatus(action === 'start'
        ? `VOICEVOX hidup${data.version ? ` · v${data.version}` : ''} — RAM terpakai.`
        : 'Suara DIMATIKAN — VOICEVOX tidak akan menyala sendiri. RAM & CPU 0.', 'ok')
    } else {
      ttsStatus(`Gagal: ${data.error || 'tidak diketahui'}`, 'err')
    }
  } catch (e) {
    ttsStatus(`Gagal: ${e.message}`, 'err')
  } finally {
    ttsSetBusy(false)
    ttsRefreshStatus()
  }
}

function ttsFormPayload() {
  return {
    engine: ttsEl('tts-engine')?.value || 'edge',
    voicevoxSpeaker: Number(ttsEl('tts-vv-speaker')?.value || 14),
    voicevoxKeepAlive: Boolean(ttsEl('tts-vv-keepalive')?.checked),
    edgeVoice: ttsField('edgeVoice')?.value || '',
    edgePitch: ttsField('edgePitch')?.value || '',
    edgeRate: ttsField('edgeRate')?.value || ''
  }
}

const ttsForm = ttsEl('tts-form')
if (ttsForm) {
  ttsForm.onsubmit = async event => {
    event.preventDefault()
    ttsStatus('Menyimpan…')
    const payload = ttsFormPayload()
    try {
      const data = await ttsRequest('/api/admin/tts', { method: 'PUT', headers: ttsHeaders(true), body: JSON.stringify(payload) })
      ttsApplySettings(data.settings || payload)
      ttsStatus('Pengaturan suara tersimpan.', 'ok')
    } catch (e) {
      ttsStatus(e.message, 'err')
    }
  }
}

if (ttsEl('tts-engine')) ttsEl('tts-engine').onchange = () => ttsToggleGroups(ttsEl('tts-engine').value)
if (ttsEl('tts-vv-start')) ttsEl('tts-vv-start').onclick = () => ttsVoicevoxAction('start')
if (ttsEl('tts-vv-stop')) ttsEl('tts-vv-stop').onclick = () => ttsVoicevoxAction('stop')
if (ttsEl('tts-vv-refresh')) ttsEl('tts-vv-refresh').onclick = ttsRefreshStatus
if (ttsEl('tts-vv-load-speakers')) ttsEl('tts-vv-load-speakers').onclick = ttsLoadSpeakers

if (ttsEl('tts-test-play')) {
  ttsEl('tts-test-play').onclick = async () => {
    const audio = ttsEl('tts-audio')
    ttsSetBusy(true)
    ttsStatus('Menghasilkan audio uji…')
    try {
      const response = await fetch('/api/admin/tts/test', {
        method: 'POST',
        headers: ttsHeaders(true),
        body: JSON.stringify({
          settings: ttsFormPayload(),
          text: ttsEl('tts-test-text')?.value || 'Halo, ini contoh suara Yuki.'
        })
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.error || `HTTP ${response.status}`)
      }
      if (audio.src?.startsWith('blob:')) URL.revokeObjectURL(audio.src)
      audio.src = URL.createObjectURL(await response.blob())
      audio.hidden = false
      await audio.play().catch(() => {})
      ttsStatus('Audio uji siap diputar.', 'ok')
    } catch (e) {
      ttsStatus(`Uji gagal: ${e.message}`, 'err')
    } finally {
      ttsSetBusy(false)
      ttsRefreshStatus()
    }
  }
}

/* Muat saat view TTS dibuka (dipanggil showView di admin.js). */
const __ttsBaseShowView = typeof showView === 'function' ? showView : null
if (__ttsBaseShowView) {
  window.showView = function (id) {
    __ttsBaseShowView(id)
    if (id === 'view-tts') ttsLoad()
  }
}
if (location.hash === '#tts') ttsLoad()
