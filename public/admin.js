const $ = id => document.getElementById(id)
const fmt = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value || 0)
const compact = value => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
const token = () => sessionStorage.getItem('yuki_admin_session') || ''
const headers = (json = false) => ({ Authorization: `Bearer ${token()}`, ...(json ? { 'Content-Type': 'application/json' } : {}) })
let timer

function escapeHtml(value) { const node = document.createElement('span'); node.textContent = String(value || ''); return node.innerHTML }
function field(name) { return document.querySelector(`[name="${name}"]`) }
function providerPayload(id) {
  return { id, name: field(`${id}.name`).value, baseURL: field(`${id}.baseURL`).value, model: field(`${id}.model`).value,
    apiKey: field(`${id}.apiKey`).value, inputCostPerMillion: Number(field(`${id}.inputCostPerMillion`).value || 0),
    outputCostPerMillion: Number(field(`${id}.outputCostPerMillion`).value || 0) }
}
function fill(id, data) {
  for (const key of ['name', 'baseURL', 'model', 'inputCostPerMillion', 'outputCostPerMillion']) field(`${id}.${key}`).value = data[key] ?? ''
  field(`${id}.apiKey`).value = ''; field(`${id}.apiKey`).placeholder = data.hasApiKey ? 'Key tersimpan · kosongkan agar tetap' : 'Masukkan API key'
}
async function request(url, options = {}) {
  const response = await fetch(url, options); const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request gagal'); return data
}

/* ===== Grafik tren harian (canvas, tanpa library) ===== */
function drawChart(daily) {
  const canvas = $('chart'); if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth || 600, height = 180
  canvas.width = width * dpr; canvas.height = height * dpr
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (!daily?.length) { ctx.fillStyle = '#6b7280'; ctx.font = '13px system-ui'; ctx.fillText('Belum ada data harian.', 12, height / 2); return }

  const series = daily.slice(-30)
  const pad = { l: 44, r: 12, t: 14, b: 24 }
  const plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b
  const max = Math.max(1, ...series.map(d => d.tokens))
  const step = series.length > 1 ? plotW / (series.length - 1) : plotW

  // grid + label sumbu Y
  ctx.strokeStyle = 'rgba(148,163,184,.18)'; ctx.fillStyle = '#6b7280'; ctx.font = '10px system-ui'
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH / 4) * i
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke()
    ctx.fillText(compact(max - (max / 4) * i), 4, y + 3)
  }
  // area + garis tokens
  const points = series.map((d, i) => [pad.l + step * i, pad.t + plotH - (d.tokens / max) * plotH])
  ctx.beginPath(); ctx.moveTo(points[0][0], pad.t + plotH)
  for (const [x, y] of points) ctx.lineTo(x, y)
  ctx.lineTo(points[points.length - 1][0], pad.t + plotH); ctx.closePath()
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH)
  grad.addColorStop(0, 'rgba(99,102,241,.35)'); grad.addColorStop(1, 'rgba(99,102,241,.02)')
  ctx.fillStyle = grad; ctx.fill()
  ctx.beginPath(); ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 2
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke()
  // titik gagal
  for (let i = 0; i < series.length; i++) if (series[i].failures) {
    ctx.beginPath(); ctx.arc(points[i][0], points[i][1], 3, 0, Math.PI * 2); ctx.fillStyle = '#f87171'; ctx.fill()
  }
  // label X (tanggal)
  ctx.fillStyle = '#6b7280'; ctx.font = '10px system-ui'
  const ticks = series.length <= 7 ? series.length : 5
  for (let i = 0; i < ticks; i++) {
    const idx = Math.round((series.length - 1) * (i / Math.max(1, ticks - 1)))
    const label = series[idx].date.slice(5)
    ctx.fillText(label, Math.min(width - 34, points[idx][0] - 12), height - 6)
  }
}

function renderHealth(data) {
  const items = data.providers || []
  $('providers').innerHTML = items.map(item => `<article><div><b>${escapeHtml(item.name)}</b><span class="tag ${item.state === 'open' ? 'bad' : ''}">${escapeHtml(item.state)}</span></div><code>${escapeHtml(item.model)}</code><dl><div><dt>Success</dt><dd>${fmt(item.successRate)}%</dd></div><div><dt>Latency</dt><dd>${fmt(item.averageLatencyMs)} ms</dd></div><div><dt>Calls</dt><dd>${fmt(item.calls)}</dd></div><div><dt>Tokens</dt><dd>${fmt(item.totalTokens)}</dd></div><div><dt>Sukses</dt><dd>${fmt(item.successes)}</dd></div><div><dt>Gagal</dt><dd>${fmt(item.failures)}</dd></div></dl>${item.lastError ? `<p>${escapeHtml(item.lastError)}</p>` : ''}</article>`).join('') || '<p class="empty">Belum ada request sejak restart.</p>'
  $('alerts').innerHTML = (data.alerts || []).map(item => `<article><span>${escapeHtml(item.type)}</span><b>${escapeHtml(item.provider)}</b><p>${escapeHtml(item.message)}</p><time>${new Date(item.at).toLocaleString('id-ID')}</time></article>`).join('') || '<p class="empty">Tidak ada alert.</p>'
  for (const id of ['primary', 'backup']) { const item = items.find(x => x.id === id); if (item) { $(`${id}-live`).textContent = item.state; $(`${id}-live`).classList.toggle('bad', item.state === 'open') } }
}

function renderTokens(totals = {}, persisted = {}) {
  $('tok-total').textContent = fmt(totals.tokens)
  $('tok-in').textContent = fmt(totals.inputTokens)
  $('tok-out').textContent = fmt(totals.outputTokens)
  const avg = totals.calls ? Math.round(totals.tokens / totals.calls) : 0
  $('tok-avg').textContent = fmt(avg)
  $('tok-cost').textContent = '$' + (totals.estimatedCostUsd || 0).toFixed(4)
  $('tok-fail').textContent = fmt(totals.failures)
  $('stats-saved').textContent = persisted?.savedAt ? `tersimpan ${new Date(persisted.savedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : 'belum tersimpan'
}

function renderDaily(daily = []) {
  drawChart(daily)
  const rows = [...daily].reverse().slice(0, 14)
  $('daily-table').querySelector('tbody').innerHTML = rows.map(d => `<tr><td>${escapeHtml(d.date)}</td><td>${fmt(d.calls)}</td><td>${fmt(d.tokens)}</td><td>${fmt(d.failures)}</td><td>$${(d.cost || 0).toFixed(4)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Belum ada data.</td></tr>'
}

function renderAppData(appData) {
  const hosting = $('app-data')
  if (!appData || !Array.isArray(appData.tables)) { hosting.innerHTML = '<p class="empty">Data aplikasi tidak tersedia.</p>'; return }
  hosting.innerHTML = appData.tables.map(t => `<article><span>${escapeHtml(t.label)}</span><b>${fmt(t.count)}</b></article>`).join('')
}

async function load() {
  if (!token()) return
  try {
    const [stats, config] = await Promise.all([
      request('/api/admin/stats', { headers: headers() }), request('/api/admin/providers', { headers: headers() })
    ])
    $('login').hidden = true; $('dashboard').hidden = false; $('error').textContent = ''
    $('uptime').textContent = `${fmt(stats.runtime.uptime / 3600)} jam`
    $('requests').textContent = fmt(stats.runtime.requests)
    const providers = stats.providers || {}; const totals = providers.totals || {}
    $('llm-calls').textContent = fmt(totals.calls)
    $('success-rate').textContent = `${fmt(totals.successRate)}%`
    $('avg-latency').textContent = `${fmt(totals.averageLatencyMs)} ms`
    $('open-circuits').textContent = fmt(totals.openCircuits)
    $('router-state').textContent = totals.openCircuits ? 'attention' : 'healthy'; $('router-state').classList.toggle('bad', Boolean(totals.openCircuits))

    renderTokens(totals, providers.persisted)
    window.__yukiDaily = providers.daily || []
    renderDaily(window.__yukiDaily)
    renderHealth(providers)
    renderAppData(stats.appData)
    fill('primary', config.providers.primary); fill('backup', config.providers.backup)
    $('updated').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    clearTimeout(timer); timer = setTimeout(load, 30000)
  } catch (cause) { $('error').textContent = cause.message; if (/sesi|auth/i.test(cause.message)) { sessionStorage.removeItem('yuki_admin_session'); location.reload() } }
}

$('connect').onclick = async () => { try { const data = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('key').value }) }); sessionStorage.setItem('yuki_admin_session', data.sessionToken); $('key').value = ''; load() } catch (e) { $('error').textContent = e.message } }
$('key').onkeydown = event => { if (event.key === 'Enter') $('connect').click() }
document.querySelectorAll('[data-test]').forEach(button => button.onclick = async () => {
  const id = button.dataset.test, status = $('provider-status'); button.disabled = true; status.textContent = `Menguji ${id}...`
  try { const data = await request('/api/admin/providers/test', { method: 'POST', headers: headers(true), body: JSON.stringify(providerPayload(id)) }); status.textContent = `${id} tersambung · ${data.latencyMs} ms · ${data.model}` }
  catch (e) { status.textContent = `Test gagal: ${e.message}` } finally { button.disabled = false }
})
$('provider-form').onsubmit = async event => {
  event.preventDefault(); const status = $('provider-status'); status.textContent = 'Menyimpan...'
  try { await request('/api/admin/providers', { method: 'PUT', headers: headers(true), body: JSON.stringify({ primary: providerPayload('primary'), backup: providerPayload('backup') }) }); status.textContent = 'Konfigurasi tersimpan. Request berikutnya langsung memakai routing baru.'; load() }
  catch (e) { status.textContent = e.message }
}
$('reset-stats').onclick = async () => {
  const status = $('reset-status')
  if (!confirm('Hapus akumulasi token & statistik provider? Tindakan ini tidak bisa dibatalkan.')) return
  status.textContent = 'Mereset...'
  try { await request('/api/admin/providers/reset-stats', { method: 'POST', headers: headers() }); status.textContent = 'Statistik direset.'; load() }
  catch (e) { status.textContent = e.message }
}
$('refresh').onclick = load; $('logout').onclick = () => { sessionStorage.removeItem('yuki_admin_session'); location.reload() }
$('change-password').onclick = () => { $('password-panel').hidden = !$('password-panel').hidden }
$('save-password').onclick = async () => { try { const data = await request('/api/admin/password', { method: 'POST', headers: headers(true), body: JSON.stringify({ password: $('new-password').value }) }); sessionStorage.setItem('yuki_admin_session', data.sessionToken); $('password-status').textContent = 'Password diganti.' } catch (e) { $('password-status').textContent = e.message } }
window.addEventListener('resize', () => drawChart(window.__yukiDaily || []))
fetch('/api/health').then(r => r.json()).then(data => $('health').textContent = data.status).catch(() => $('health').textContent = 'offline'); load()
