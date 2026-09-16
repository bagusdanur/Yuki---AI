const $ = id => document.getElementById(id)
const fmt = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value || 0)
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
async function load() {
  if (!token()) return
  try {
    const [stats, config] = await Promise.all([
      request('/api/admin/stats', { headers: headers() }), request('/api/admin/providers', { headers: headers() })
    ])
    $('login').hidden = true; $('dashboard').hidden = false; $('error').textContent = ''
    $('uptime').textContent = `${fmt(stats.runtime.uptime / 3600)} jam`; $('requests').textContent = fmt(stats.runtime.requests)
    const totals = stats.providers?.totals || {}; $('llm-calls').textContent = fmt(totals.calls); $('open-circuits').textContent = fmt(totals.openCircuits)
    $('router-state').textContent = totals.openCircuits ? 'attention' : 'healthy'; $('router-state').classList.toggle('bad', Boolean(totals.openCircuits))
    renderHealth(stats.providers || {}); fill('primary', config.providers.primary); fill('backup', config.providers.backup)
    $('updated').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    clearTimeout(timer); timer = setTimeout(load, 30000)
  } catch (cause) { $('error').textContent = cause.message; if (/sesi|auth/i.test(cause.message)) { sessionStorage.removeItem('yuki_admin_session'); location.reload() } }
}
function renderHealth(data) {
  const items = data.providers || []
  $('providers').innerHTML = items.map(item => `<article><div><b>${escapeHtml(item.name)}</b><span class="tag ${item.state === 'open' ? 'bad' : ''}">${escapeHtml(item.state)}</span></div><code>${escapeHtml(item.model)}</code><dl><div><dt>Success</dt><dd>${fmt(item.successRate)}%</dd></div><div><dt>Latency</dt><dd>${fmt(item.averageLatencyMs)} ms</dd></div><div><dt>Calls</dt><dd>${fmt(item.calls)}</dd></div><div><dt>Tokens</dt><dd>${fmt(item.totalTokens)}</dd></div></dl>${item.lastError ? `<p>${escapeHtml(item.lastError)}</p>` : ''}</article>`).join('') || '<p class="empty">Belum ada request sejak restart.</p>'
  $('alerts').innerHTML = (data.alerts || []).map(item => `<article><span>${escapeHtml(item.type)}</span><b>${escapeHtml(item.provider)}</b><p>${escapeHtml(item.message)}</p><time>${new Date(item.at).toLocaleString('id-ID')}</time></article>`).join('') || '<p class="empty">Tidak ada alert.</p>'
  for (const id of ['primary', 'backup']) { const item = items.find(x => x.id === id); if (item) { $(`${id}-live`).textContent = item.state; $(`${id}-live`).classList.toggle('bad', item.state === 'open') } }
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
$('refresh').onclick = load; $('logout').onclick = () => { sessionStorage.removeItem('yuki_admin_session'); location.reload() }
$('change-password').onclick = () => { $('password-panel').hidden = !$('password-panel').hidden }
$('save-password').onclick = async () => { try { const data = await request('/api/admin/password', { method: 'POST', headers: headers(true), body: JSON.stringify({ password: $('new-password').value }) }); sessionStorage.setItem('yuki_admin_session', data.sessionToken); $('password-status').textContent = 'Password diganti.' } catch (e) { $('password-status').textContent = e.message } }
fetch('/api/health').then(r => r.json()).then(data => $('health').textContent = data.status).catch(() => $('health').textContent = 'offline'); load()
