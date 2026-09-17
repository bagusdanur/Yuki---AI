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


function renderStatsReport(stats) {
  const host = $('stats-report'); if (!host) return
  const totalUsers = Number(stats.users || 0)
  const active = Number(stats.activeToday || 0)
  const messages = Number(stats.messages || 0)
  const avgMsg = totalUsers ? Math.round(messages / totalUsers) : 0
  const pos = Number(stats.feedbackPositive || 0)
  const neg = Number(stats.feedbackNegative || 0)
  const totalFb = pos + neg
  const likeRate = totalFb ? Math.round((pos / totalFb) * 1000) / 10 : 0
  const bond = Math.round(Number(stats.averageBond || 0) * 10) / 10
  const appTables = stats.appData?.tables?.length || 0
  const totalRows = stats.appData?.tables?.reduce((sum, t) => sum + t.count, 0) || 0
  const dbSize = stats.appData?.sizeBytes ? bytesLabel(stats.appData.sizeBytes) : '—'

  const cards = [
    ['Total pengguna', fmt(totalUsers)],
    ['Aktif hari ini', fmt(active)],
    ['Total pesan', fmt(messages)],
    ['Rata-rata pesan/user', fmt(avgMsg)],
    ['Bond rata-rata', fmt(bond)],
    ['Feedback positif', fmt(pos)],
    ['Feedback negatif', fmt(neg)],
    ['Rasio suka', likeRate + '%'],
    ['Tabel database', fmt(appTables)],
    ['Total baris', fmt(totalRows)],
    ['Ukuran database', dbSize]
  ]
  host.innerHTML = cards.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></article>`).join('')
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
    renderStatsReport(stats)
    renderAppData(stats.appData)
    if (!dbTables.length) loadDbTables()
    if (!$('user-grid').children.length) loadUsers()
    loadWsUsers()
    fill('primary', config.providers.primary); fill('backup', config.providers.backup)
    $('updated').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    if (!window.__viewReady) { window.__viewReady = true; viewFromHash() }
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



/* ===== NAVIGASI SIDEBAR ===== */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id))
  document.querySelectorAll('.side-link').forEach(b => b.classList.toggle('active', b.dataset.view === id))
  closeSidebar()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  location.hash = id.replace('view-', '')
}
function openSidebar() { $('sidebar').classList.add('open'); $('side-backdrop').classList.add('show') }
function closeSidebar() { $('sidebar').classList.remove('open'); $('side-backdrop').classList.remove('show') }
document.querySelectorAll('.side-link').forEach(btn => btn.onclick = () => showView(btn.dataset.view))
$('menu-toggle').onclick = openSidebar
$('side-backdrop').onclick = closeSidebar
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar() })

// Buka view dari hash URL (mis. #browser)
function viewFromHash() {
  const id = (location.hash || '').replace('#', '')
  const target = id ? `view-${id}` : 'view-overview'
  if ($(target)) showView(target)
}
window.addEventListener('hashchange', viewFromHash)

/* ===== PENJELAJAH USER: 2 tingkat (user -> tabel -> isi) ===== */
const userState = { page: 1, pageSize: 24, search: '', pageCount: 1 }
const utState = { userId: '', username: '', table: '', page: 1, pageSize: 25, search: '', pageCount: 1 }
let usersCache = []

async function loadUsers() {
  try {
    const params = new URLSearchParams({ page: userState.page, pageSize: userState.pageSize })
    if (userState.search) params.set('search', userState.search)
    const data = await request(`/api/admin/users?${params}`, { headers: headers() })
    usersCache = data.users || []
    userState.page = data.page; userState.pageCount = data.pageCount
    $('user-grid').innerHTML = usersCache.map(u => `
      <article class="user-card" data-user="${escapeHtml(u.userId)}" data-name="${escapeHtml(u.username)}">
        <div class="uc-head"><b>${escapeHtml(u.username || 'tanpa nama')}</b><span class="tag">${fmt(u.messages)} chat</span></div>
        <div class="uc-stats">
          <span>memori <b>${fmt(u.memories)}</b></span>
          <span>fakta <b>${fmt(u.facts)}</b></span>
          <span>jadwal <b>${fmt(u.schedules)}</b></span>
          <span>file <b>${u.wsFiles}</b></span>
        </div>
        <small class="uc-id">${escapeHtml(u.userId)}</small>
      </article>`).join('') || '<p class="empty">Tidak ada user yang cocok.</p>'
    $('user-grid').querySelectorAll('.user-card').forEach(card => card.onclick = () => openUser(card.dataset.user, card.dataset.name))
    $('user-pager').hidden = false
    $('user-pageinfo').textContent = `User ${userState.page} / ${userState.pageCount} · ${fmt(data.total)} total`
    $('user-first').disabled = $('user-prev').disabled = userState.page <= 1
    $('user-last').disabled = $('user-next').disabled = userState.page >= userState.pageCount
    $('browser-badge').textContent = `${fmt(data.total)} user`
  } catch (e) { $('user-grid').innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>` }
}

async function openUser(userId, username) {
  utState.userId = userId; utState.username = username; utState.table = ''; utState.page = 1; utState.search = ''
  $('stage-users').hidden = true; $('stage-tables').hidden = false
  $('browser-title').textContent = username || userId
  renderCrumbs()

  const u = usersCache.find(x => x.userId === userId) || {}
  $('user-summary').innerHTML = `
    <div><span>Riwayat chat</span><b>${fmt(u.messages)}</b></div>
    <div><span>Memori</span><b>${fmt(u.memories)}</b></div>
    <div><span>Fakta</span><b>${fmt(u.facts)}</b></div>
    <div><span>Jadwal</span><b>${fmt(u.schedules)}</b></div>
    <div><span>Bookmark</span><b>${fmt(u.bookmarks)}</b></div>
    <div><span>File</span><b>${u.wsFiles}</b></div>`

  try {
    const data = await request(`/api/admin/users/${encodeURIComponent(userId)}/tables`, { headers: headers() })
    $('user-tables').innerHTML = (data.tables || []).map(t =>
      `<button class="chip" data-table="${escapeHtml(t.name)}">${escapeHtml(t.label)} <b>${fmt(t.count)}</b></button>`).join('') || '<p class="empty">User ini belum punya data.</p>'
    $('user-tables').querySelectorAll('.chip').forEach(btn => btn.onclick = () => {
      $('user-tables').querySelectorAll('.chip').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      utState.table = btn.dataset.table; utState.page = 1; utState.search = ''
      $('user-table-search').value = ''
      $('ut-bar').hidden = false
      renderCrumbs(); loadUserTable()
    })
    $('user-table-wrap').innerHTML = '<p class="empty">Pilih salah satu kategori di atas.</p>'
    $('user-table-pager').hidden = true
    $('ut-bar').hidden = true
  } catch (e) { $('user-tables').innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>` }
}

function renderCrumbs() {
  const crumbs = $('crumbs')
  crumbs.hidden = false
  let html = `<button class="crumb" data-go="users">Semua user</button>`
  html += `<span class="sep">›</span><button class="crumb" data-go="user">${escapeHtml(utState.username || utState.userId)}</button>`
  if (utState.table) html += `<span class="sep">›</span><b class="crumb cur">${escapeHtml(utState.table)}</b>`
  crumbs.innerHTML = html
  crumbs.querySelector('[data-go="users"]').onclick = backToUsers
  const toUser = crumbs.querySelector('[data-go="user"]')
  if (toUser) toUser.onclick = () => { utState.table = ''; renderCrumbs(); $('user-table-wrap').innerHTML = '<p class="empty">Pilih salah satu kategori di atas.</p>'; $('user-table-pager').hidden = true; $('ut-bar').hidden = true; $('user-tables').querySelectorAll('.chip').forEach(b => b.classList.remove('active')) }
}

function backToUsers() {
  $('stage-users').hidden = false; $('stage-tables').hidden = true
  $('browser-title').textContent = 'Pilih user'
  $('crumbs').hidden = true
  utState.userId = ''; utState.table = ''
}

async function loadUserTable() {
  if (!utState.table) return
  const params = new URLSearchParams({ page: utState.page, pageSize: utState.pageSize })
  if (utState.search) params.set('search', utState.search)
  try {
    const data = await request(`/api/admin/users/${encodeURIComponent(utState.userId)}/table/${encodeURIComponent(utState.table)}?${params}`, { headers: headers() })
    utState.page = data.page; utState.pageCount = data.pageCount
    if (!data.rows.length) $('user-table-wrap').innerHTML = '<p class="empty">Tidak ada baris yang cocok.</p>'
    else {
      const heads = data.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')
      const body = data.rows.map(row => `<tr>${data.columns.map(c => {
        const v = row[c]
        const text = v === null || v === undefined ? '<i class="null">null</i>' : escapeHtml(String(v))
        return `<td title="${escapeHtml(String(v ?? '').slice(0, 200))}">${text}</td>`
      }).join('')}</tr>`).join('')
      $('user-table-wrap').innerHTML = `<div class="table-note">${escapeHtml(data.label)} · ${fmt(data.total)} baris</div><table><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>`
    }
    $('user-table-pager').hidden = false
    $('ut-pageinfo').textContent = `Halaman ${utState.page} / ${utState.pageCount}`
    $('ut-first').disabled = $('ut-prev').disabled = utState.page <= 1
    $('ut-last').disabled = $('ut-next').disabled = utState.page >= utState.pageCount
  } catch (e) { $('user-table-wrap').innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>` }
}

$('user-first').onclick = () => { userState.page = 1; loadUsers() }
$('user-prev').onclick = () => { if (userState.page > 1) { userState.page -= 1; loadUsers() } }
$('user-next').onclick = () => { if (userState.page < userState.pageCount) { userState.page += 1; loadUsers() } }
$('user-last').onclick = () => { userState.page = userState.pageCount; loadUsers() }
$('user-size').onchange = e => { userState.pageSize = Number(e.target.value); userState.page = 1; loadUsers() }
let userSearchTimer
$('user-search').oninput = e => {
  clearTimeout(userSearchTimer)
  userSearchTimer = setTimeout(() => { userState.search = e.target.value.trim(); userState.page = 1; loadUsers() }, 400)
}
$('ut-size').onchange = e => { utState.pageSize = Number(e.target.value); utState.page = 1; loadUserTable() }
let utSearchTimer
$('user-table-search').oninput = e => {
  clearTimeout(utSearchTimer)
  utSearchTimer = setTimeout(() => { utState.search = e.target.value.trim(); utState.page = 1; loadUserTable() }, 400)
}
$('ut-first').onclick = () => { utState.page = 1; loadUserTable() }
$('ut-prev').onclick = () => { if (utState.page > 1) { utState.page -= 1; loadUserTable() } }
$('ut-next').onclick = () => { if (utState.page < utState.pageCount) { utState.page += 1; loadUserTable() } }
$('ut-last').onclick = () => { utState.page = utState.pageCount; loadUserTable() }

/* ===== DATABASE BROWSER (pagination + search) ===== */
const dbState = { table: '', page: 1, pageSize: 25, search: '', pageCount: 1 }
let dbTables = []

async function loadDbTables() {
  try {
    const data = await request('/api/admin/db/tables', { headers: headers() })
    dbTables = data.tables || []
    const select = $('db-table')
    select.innerHTML = '<option value="">— pilih tabel —</option>' +
      dbTables.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.label)} · ${fmt(t.count)}</option>`).join('')
    $('db-total').textContent = `${dbTables.length} tabel`
  } catch (e) { $('db-total').textContent = 'gagal memuat' }
}

function bytesLabel(size) {
  if (size < 1024) return `${size} B`
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1048576).toFixed(1)} MB`
}

async function loadDbTable() {
  if (!dbState.table) { $('db-wrap').innerHTML = '<p class="empty">Pilih tabel untuk menampilkan data.</p>'; $('db-pager').hidden = true; return }
  const params = new URLSearchParams({ page: dbState.page, pageSize: dbState.pageSize })
  if (dbState.search) params.set('search', dbState.search)
  try {
    const data = await request(`/api/admin/db/table/${encodeURIComponent(dbState.table)}?${params}`, { headers: headers() })
    dbState.page = data.page; dbState.pageCount = data.pageCount
    $('db-meta').innerHTML = `<b>${escapeHtml(data.label)}</b> · ${fmt(data.total)} baris` +
      (data.redactedColumns.length ? ` · <span class="warn">${data.redactedColumns.length} kolom disamarkan</span>` : '') +
      (dbState.search ? ` · filter: “${escapeHtml(dbState.search)}”` : '')

    if (!data.rows.length) { $('db-wrap').innerHTML = '<p class="empty">Tidak ada baris yang cocok.</p>' }
    else {
      const heads = data.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')
      const body = data.rows.map(row => `<tr>${data.columns.map(c => {
        const v = row[c]
        const text = v === null || v === undefined ? '<i class="null">null</i>' : escapeHtml(String(v))
        return `<td title="${escapeHtml(String(v ?? '').slice(0, 200))}">${text}</td>`
      }).join('')}</tr>`).join('')
      $('db-wrap').innerHTML = `<table><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>`
    }
    $('db-pager').hidden = false
    $('db-pageinfo').textContent = `Halaman ${dbState.page} / ${dbState.pageCount}`
    $('db-prev').disabled = dbState.page <= 1
    $('db-first').disabled = dbState.page <= 1
    $('db-next').disabled = dbState.page >= dbState.pageCount
    $('db-last').disabled = dbState.page >= dbState.pageCount
  } catch (e) { $('db-wrap').innerHTML = `<p class="empty">${escapeHtml(e.message)}</p>` }
}

$('db-table').onchange = event => { dbState.table = event.target.value; dbState.page = 1; loadDbTable() }
$('db-size').onchange = event => { dbState.pageSize = Number(event.target.value); dbState.page = 1; loadDbTable() }
$('db-reload').onclick = () => { dbState.page = 1; loadDbTable() }
let dbSearchTimer
$('db-search').oninput = event => {
  clearTimeout(dbSearchTimer)
  dbSearchTimer = setTimeout(() => { dbState.search = event.target.value.trim(); dbState.page = 1; loadDbTable() }, 400)
}
$('db-first').onclick = () => { dbState.page = 1; loadDbTable() }
$('db-prev').onclick = () => { if (dbState.page > 1) { dbState.page -= 1; loadDbTable() } }
$('db-next').onclick = () => { if (dbState.page < dbState.pageCount) { dbState.page += 1; loadDbTable() } }
$('db-last').onclick = () => { dbState.page = dbState.pageCount; loadDbTable() }

/* ===== WORKSPACE FILE BROWSER ===== */
const wsState = { path: '' }
const DIR_ICON = '<svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:#8f92fb;fill:none;stroke-width:1.8;vertical-align:-2px;margin-right:5px"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
const FILE_ICON = '<svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:#9aa0aa;fill:none;stroke-width:1.8;vertical-align:-2px;margin-right:5px"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>'

function renderWsUsers(data) {
  if (!data?.users?.length) { $('ws-users').innerHTML = '<p class="empty">Belum ada folder user.</p>'; return }
  $('ws-users').innerHTML = data.users.map(u =>
    `<article class="ws-user" data-user="${escapeHtml(u.name)}"><span>${escapeHtml(u.name)}</span><b>${u.files} file</b><small>${bytesLabel(u.bytes)}</small></article>`
  ).join('')
  $('ws-users').querySelectorAll('.ws-user').forEach(card => card.onclick = () => { wsState.path = card.dataset.user; loadWsDir() })
  $('ws-root').textContent = `${data.users.length} user`
}

async function loadWsUsers() {
  try { renderWsUsers(await request('/api/admin/workspace', { headers: headers() })) }
  catch { $('ws-users').innerHTML = '<p class="empty">Tidak dapat memuat workspace.</p>' }
}

async function loadWsDir() {
  try {
    const data = await request(`/api/admin/workspace/list?path=${encodeURIComponent(wsState.path)}`, { headers: headers() })
    $('ws-path').textContent = '/' + (data.path || '')
    const rows = data.entries.map(e => {
      const clickable = e.type === 'dir' ? `data-dir="${escapeHtml(e.name)}"` : (/\.(txt|md|json|js|mjs|cjs|ts|tsx|py|css|html|yml|yaml|sh|csv|log|env)$/i.test(e.name) ? `data-file="${escapeHtml(e.name)}"` : '')
      return `<tr class="ws-row ${e.type}" ${clickable}><td>${e.type === 'dir' ? DIR_ICON : FILE_ICON} ${escapeHtml(e.name)}</td><td>${e.type}</td><td>${e.type === 'dir' ? '—' : bytesLabel(e.size)}</td><td>${e.mtime ? new Date(e.mtime).toLocaleString('id-ID') : '—'}</td></tr>`
    }).join('')
    $('ws-table').querySelector('tbody').innerHTML = rows || '<tr><td colspan="4" class="empty">Folder kosong.</td></tr>'
    $('ws-table').querySelectorAll('[data-dir]').forEach(row => row.onclick = () => { wsState.path = `${wsState.path ? wsState.path + '/' : ''}${row.dataset.dir}`; loadWsDir() })
    $('ws-table').querySelectorAll('[data-file]').forEach(row => row.onclick = () => openWsFile(`${wsState.path ? wsState.path + '/' : ''}${row.dataset.file}`))
    $('ws-up').disabled = !data.path
  } catch (e) { $('ws-table').querySelector('tbody').innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(e.message)}</td></tr>` }
}

async function openWsFile(filePath) {
  try {
    const data = await request(`/api/admin/workspace/file?path=${encodeURIComponent(filePath)}`, { headers: headers() })
    $('file-name').textContent = filePath
    $('file-content').textContent = data.content + (data.truncated ? '\n\n… (dipotong, file lebih besar)' : '')
    $('file-panel').hidden = false
    $('file-panel').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) { $('file-name').textContent = 'Gagal membuka file'; $('file-content').textContent = e.message; $('file-panel').hidden = false }
}

$('ws-up').onclick = () => { wsState.path = wsState.path.split('/').slice(0, -1).join('/'); loadWsDir() }
$('ws-reload').onclick = () => { loadWsUsers(); if (wsState.path) loadWsDir() }
$('file-close').onclick = () => { $('file-panel').hidden = true }

fetch('/api/health').then(r => r.json()).then(data => $('health').textContent = data.status).catch(() => $('health').textContent = 'offline'); load()
