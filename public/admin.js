const $ = id => document.getElementById(id)
const login = $('login'), dashboard = $('dashboard'), error = $('error')
let timer
const fmt = number => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(number || 0)
const adminSession = () => sessionStorage.getItem('yuki_admin_session') || ''

async function health() {
  try { const data = await (await fetch('/api/health')).json(); $('health').textContent = data.status }
  catch { $('health').textContent = 'offline' }
}

async function load() {
  const token = adminSession()
  if (!token) return
  error.textContent = ''
  try {
    const response = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Gagal memuat data')
    login.hidden = true; dashboard.hidden = false
    $('users').textContent = fmt(data.users); $('active').textContent = fmt(data.activeToday)
    $('messages').textContent = fmt(data.messages); $('bond').textContent = fmt(data.averageBond)
    $('positive').textContent = fmt(data.feedbackPositive); $('negative').textContent = fmt(data.feedbackNegative)
    $('uptime').textContent = `${fmt(data.runtime.uptime / 3600)} jam`; $('requests').textContent = fmt(data.runtime.requests)
    $('failures').textContent = fmt(data.runtime.chatFailures); $('latency').textContent = `${fmt(data.runtime.averageLatency)} ms`
    renderProviders(data.providers || { providers: [], alerts: [], totals: {} })
    $('recent').innerHTML = data.recent.map((item, index) => userRow(item, index)).join('')
    $('updated').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID')}`
    clearTimeout(timer); timer = setTimeout(load, 30_000)
  } catch (cause) {
    error.textContent = cause.message; sessionStorage.removeItem('yuki_admin_session')
    login.hidden = false; dashboard.hidden = true
  }
}

function renderProviders(operations) {
  const totals = operations.totals || {}
  $('llm-calls').textContent = fmt(totals.calls)
  $('llm-tokens').textContent = fmt(totals.tokens)
  $('llm-cost').textContent = `$${Number(totals.estimatedCostUsd || 0).toFixed(4)}`
  $('open-circuits').textContent = fmt(totals.openCircuits)
  const router = $('router-status')
  router.classList.toggle('danger', Number(totals.openCircuits) > 0)
  router.lastChild.textContent = Number(totals.openCircuits) > 0 ? ' attention' : ' healthy'
  $('providers').innerHTML = (operations.providers || []).map(item => `
    <article class="provider-card ${escapeHtml(item.state)}">
      <div><strong>${escapeHtml(item.name)}</strong><span class="circuit">${escapeHtml(item.state)}</span></div>
      <small>${escapeHtml(item.model)}</small>
      <dl><div><dt>Success</dt><dd>${fmt(item.successRate)}%</dd></div><div><dt>Latency</dt><dd>${fmt(item.averageLatencyMs)} ms</dd></div><div><dt>Calls</dt><dd>${fmt(item.calls)}</dd></div><div><dt>Tokens</dt><dd>${fmt(item.totalTokens)}</dd></div></dl>
      ${item.lastError ? `<p>${escapeHtml(item.lastError)}</p>` : ''}
    </article>`).join('') || '<p class="empty">Provider belum menerima request sejak restart.</p>'
  $('alerts').innerHTML = (operations.alerts || []).map(item => `<div class="alert"><span>${escapeHtml(item.type)}</span><strong>${escapeHtml(item.provider)}</strong><p>${escapeHtml(item.message)}</p><time>${new Date(item.at).toLocaleString('id-ID')}</time></div>`).join('') || '<p class="empty">Belum ada alert.</p>'
}

function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML }
function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?' }
function activity(dateText) {
  if (!dateText) return { relative: 'Belum aktif', exact: '-', state: 'offline', label: 'Belum ada' }
  const date = new Date(`${dateText}Z`), minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000))
  const relative = minutes < 1 ? 'Baru saja' : minutes < 60 ? `${minutes} menit lalu` : minutes < 1440 ? `${Math.floor(minutes / 60)} jam lalu` : `${Math.floor(minutes / 1440)} hari lalu`
  return { relative, exact: date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }), state: minutes < 1440 ? 'active' : 'offline', label: minutes < 60 ? 'Online baru-baru ini' : minutes < 1440 ? 'Aktif hari ini' : 'Tidak aktif' }
}
function userRow(item, index) {
  const name = escapeHtml(item.username || 'Tanpa nama'), presence = activity(item.lastActive)
  return `<tr><td data-label="#"><span class="rank">${String(index + 1).padStart(2, '0')}</span></td><td data-label="User"><div class="user-cell"><span class="user-avatar">${escapeHtml(initials(item.username))}</span><div><strong>${name}</strong><small>YUKI USER</small></div></div></td><td data-label="Messages"><span class="message-count">${fmt(item.messages)} <small>pesan</small></span></td><td data-label="Last active"><div class="last-active"><strong>${presence.relative}</strong><small>${presence.exact}</small></div></td><td data-label="Status"><span class="presence ${presence.state}"><i></i>${presence.label}</span></td></tr>`
}

$('connect').onclick = async () => {
  error.textContent = ''
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('key').value }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    sessionStorage.setItem('yuki_admin_session', data.sessionToken); $('key').value = ''; load()
  } catch (cause) { error.textContent = cause.message }
}
$('key').onkeydown = event => { if (event.key === 'Enter') $('connect').click() }
$('change-password').onclick = () => { $('password-panel').hidden = !$('password-panel').hidden }
$('save-password').onclick = async () => {
  const response = await fetch('/api/admin/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession()}` }, body: JSON.stringify({ password: $('new-password').value }) })
  const data = await response.json(); $('password-status').textContent = response.ok ? 'Password berhasil diganti.' : data.error
  if (response.ok) { sessionStorage.setItem('yuki_admin_session', data.sessionToken); $('new-password').value = '' }
}
$('refresh').onclick = load
$('logout').onclick = () => { sessionStorage.removeItem('yuki_admin_session'); location.reload() }
health(); load()
