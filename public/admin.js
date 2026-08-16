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
    $('recent').innerHTML = data.recent.map(item => `<tr><td>${escapeHtml(item.username || 'Tanpa nama')}</td><td>${fmt(item.messages)}</td><td>${item.lastActive ? new Date(`${item.lastActive}Z`).toLocaleString('id-ID') : '-'}</td></tr>`).join('')
    $('updated').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID')}`
    clearTimeout(timer); timer = setTimeout(load, 30_000)
  } catch (cause) {
    error.textContent = cause.message; sessionStorage.removeItem('yuki_admin_session')
    login.hidden = false; dashboard.hidden = true
  }
}

function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML }

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
