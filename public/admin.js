/* ═══════════════════════════════════════════════════════════════
   YUKI CONTROL — admin.js (neobrutalism dark)
   ═══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id)
const token = () => sessionStorage.getItem('yuki_admin_session') || ''
const headers = (json = false) => ({
  Authorization: `Bearer ${token()}`,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})
const field = (name) => document.querySelector(`[name="${name}"]`)

/* ─────────── Format angka ─────────── */
const nf = new Intl.NumberFormat('id-ID')
const fmt = (v) => nf.format(Math.round(Number(v) || 0))
const compact = (v) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v) || 0)
const usd = (v) => '$' + (Number(v) || 0).toFixed(2)
const pct = (v) => (Number(v) || 0).toFixed(1) + '%'

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}h ${h}j`
  if (h > 0) return `${h}j ${m}m`
  return `${m}m ${s % 60}s`
}

function fmtDate(value) {
  if (!value) return '—'
  try {
    const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'))
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
  } catch { return String(value) }
}

function fmtRelative(value) {
  if (!value) return '—'
  try {
    const d = new Date(String(value).replace(' ', 'T') + 'Z')
    if (Number.isNaN(d.getTime())) return String(value)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60) return 'baru saja'
    if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`
    if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
  } catch { return String(value) }
}

const esc = (v) => {
  const el = document.createElement('span')
  el.textContent = String(v ?? '')
  return el.innerHTML
}

/* ─────────── HTTP ─────────── */
async function request(url, options = {}) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/* ─────────── Ikon Lucide (dari frontend Yuki) ─────────── */
const icon = (name, size = 16) =>
  (window.YUKI_ICON ? window.YUKI_ICON(name, size)
                    : `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}"></svg>`)

/* Render <i data-icon="..."> memakai Lucide.
   Pakai innerHTML (bukan outerHTML) supaya elemen tetap sama —
   tidak memicu MutationObserver berulang. */
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]:not([data-done])').forEach(el => {
    const size = Number(el.dataset.size) || 16
    // Path Lucide harus dibungkus <svg> — path mentah di dalam <i> TIDAK
    // dirender browser (selama ini semua ikon data-icon jadi kotak kosong).
    const body = (window.YUKI_LUCIDE && window.YUKI_LUCIDE[el.dataset.icon])
      || '<path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/>'
    el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
    el.classList.add('ico-wrap')
    el.dataset.done = '1'
    el.setAttribute('aria-hidden', 'true')
  })
}

/* Render icon sekali saat DOM siap (tanpa MutationObserver —
   observer + innerHTML berulang membuat browser sibuk & login lambat). */
function autoHydrate() { hydrateIcons() }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoHydrate)
} else {
  { autoHydrate() }
}

/* ─────────── Grafik batang (CSS murni) ─────────── */
const BAR_COLORS = ['bar-lime', 'bar-violet', 'bar-pink', 'bar-cyan', 'bar-amber', 'bar-ok']

function renderBars(containerId, items, valueKey = 'value', labelKey = 'label', tipKey = null, colorMode = 'alt') {
  const box = $(containerId)
  if (!box) return
  const values = items.map(i => Number(i[valueKey]) || 0)
  const max = Math.max(1, ...values)
  const showVal = box.dataset.showval === '1'
  box.innerHTML = items.map((it, i) => {
    const v = Number(it[valueKey]) || 0
    const h = Math.max(4, Math.round((v / max) * 100))
    const tip = tipKey ? it[tipKey] : `${it[labelKey] ?? ''}: ${fmt(v)}`
    let cls = 'bar-lime'
    if (colorMode === 'alt') cls = i % 2 ? 'bar-violet' : 'bar-lime'
    else if (colorMode === 'rainbow') cls = BAR_COLORS[i % BAR_COLORS.length]
    else if (colorMode === 'grad') cls = 'bar-grad'
    else if (colorMode === 'heat') {
      // Warna berdasarkan intensitas: sepi → ramai
      const r = v / max
      cls = r > 0.75 ? 'bar-pink' : r > 0.5 ? 'bar-amber' : r > 0.25 ? 'bar-cyan' : 'bar-lime'
    }
    const valTag = showVal && v > 0 ? `<span class="chart-num">${compact(v)}</span>` : ''
    return `<div class="chart-col" data-tip="${esc(tip)}">
      ${valTag}
      <div class="chart-bar ${cls}" style="height:${h}%"></div>
    </div>`
  }).join('')
}

/* ─────────── Diagram batang horizontal ─────────── */
function renderHBars(containerId, rows) {
  const box = $(containerId)
  if (!box) return
  const max = Math.max(1, ...rows.map(r => Number(r.value) || 0))
  box.innerHTML = rows.map(r => {
    const v = Number(r.value) || 0
    const w = Math.max(2, Math.round((v / max) * 100))
    const ic = r.icon ? icon(r.icon, 13) : ''
    return `<div class="hbar-row">
      <div class="hbar-top">
        <span class="hbar-name">${ic}${esc(r.label)}</span>
        <span class="hbar-val">${esc(r.display ?? fmt(v))}</span>
      </div>
      <div class="hbar-track">
        <div class="hbar-fill ${r.color || 'c-lime'}" style="width:${w}%"></div>
      </div>
    </div>`
  }).join('')
}

/* ═══════════════════════════════════════════════════════
   OVERVIEW
   ═══════════════════════════════════════════════════════ */
async function loadOverview() {
  try {
    const data = await request('/api/admin/overview', { headers: headers() })
    const db = data.database || {}
    const rt = data.runtime || {}
    const pt = data.providerTotals || {}

    // KPI utama
    const totTokTop = (pt.inputTokens || 0) + (pt.outputTokens || 0)
    $('ov-messages').textContent = fmt(db.messages)
    $('ov-messages-sub').textContent = `${fmt(db.userMessages)} dari user · ${fmt(db.assistantMessages)} dari Yuki`
    $('ov-users').textContent = fmt(db.users)
    $('ov-users-sub').textContent = `+${fmt(db.newUsersToday)} hari ini · +${fmt(db.newUsersWeek)} minggu ini`
    $('ov-tokens').textContent = compact(totTokTop || pt.tokens)
    $('ov-tokens-sub').textContent = `in ${compact(pt.inputTokens)} · out ${compact(pt.outputTokens)}`
    $('ov-cost').textContent = usd((pt.inputTokens || 0) * 0.14 / 1e6 + (pt.outputTokens || 0) * 0.28 / 1e6)
    $('ov-cost-sub').textContent = `${fmt(pt.calls)} request API · retail DeepSeek`

    // KPI sekunder
    $('ov-active-today').textContent = fmt(db.activeToday)
    $('ov-active-sub').textContent = `${fmt(db.activeWeek)} aktif minggu ini`
    const todayMsgs = (data.hourly || []).reduce((a, b) => a + (b.messages || 0), 0)
    $('ov-msg-today').textContent = fmt(todayMsgs)
    $('ov-requests').textContent = fmt(rt.requests)
    $('ov-success').textContent = `${pt.successRate ? pct(pt.successRate) : '—'} sukses`
    $('ov-latency').textContent = `${fmt(rt.averageLatency)} ms`
    $('ov-latency-sub').textContent = `${fmt(pt.calls)} panggilan LLM`
$('ov-bond').textContent = Number(db.averageBond || 0).toFixed(2)

    // Provider token & estimasi biaya DeepSeek
    const inTok = pt.inputTokens || 0
    const outTok = pt.outputTokens || 0
    const totTok = inTok + outTok
    const calls = pt.calls || 0
    const DS_IN = 0.14, DS_OUT = 0.28    // harga retail per 1 juta token
    const estCost = (inTok * DS_IN / 1e6) + (outTok * DS_OUT / 1e6)
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val }

    set('ov-input-tokens', compact(inTok))
    set('ov-output-tokens', compact(outTok))
    set('ov-tokens-total', compact(totTok))
    set('ov-calls', compact(calls))
    set('ov-calls-sub', `${fmt(pt.successes)} sukses · ${fmt(pt.failures)} gagal`)
    set('ov-est-cost', usd(estCost))
    set('ov-est-cost-sub', `jika bayar tarif retail`)
    set('ov-actual-cost', '$0.00')
    set('ov-savings', usd(estCost))
    set('ov-provider-latency', pt.averageLatencyMs ? `${fmt(pt.averageLatencyMs)} ms` : '—')
    set('ov-success-rate-sub', pt.successRate ? `${pct(pt.successRate)} sukses` : '—')

    // Diagram komposisi token (horizontal, berwarna)
    renderHBars('token-bars', [
      { label: 'Input (prompt)',    icon: 'inbox',  value: inTok,  display: compact(inTok) + ' token',  color: 'c-violet' },
      { label: 'Output (balasan)',  icon: 'file-text',   value: outTok, display: compact(outTok) + ' token', color: 'c-pink' },
      { label: 'Total Token',       icon: 'package',    value: totTok, display: compact(totTok) + ' token', color: 'c-lime' },
      { label: 'Rata-rata/request', icon: 'gauge',  value: calls ? Math.round(totTok / calls) : 0,
        display: calls ? compact(Math.round(totTok / calls)) + ' token' : '—', color: 'c-cyan' },
    ])

    // Nama provider aktif + status
    const provList = data.providerHealth || []
    const primary = provList.find(p => p.id === 'primary') || provList[0]
    set('ov-provider-name', primary?.name || primary?.id || '—')
    const srEl = $('ov-success-rate')
    if (srEl) {
      const rate = Number(pt.successRate) || 0
      srEl.textContent = rate ? `${pct(rate)} sukses` : 'tidak ada data'
      srEl.className = 'pill ' + (rate >= 95 ? 'on' : rate >= 80 ? 'warn' : 'bad')
    }

    // Rincian per-provider (horizontal bar berwarna)
    const detailBox = $('ov-provider-detail')
    if (detailBox) {
      detailBox.innerHTML = provList.length ? provList.map((p, i) => {
        const colors = ['c-lime', 'c-violet', 'c-pink', 'c-cyan']
        const c = colors[i % colors.length]
        const stateCls = p.state === 'open' ? 'bad' : p.state === 'half-open' ? 'warn' : 'on'
        const pIn = Number(p.inputTokens) || 0
        const pOut = Number(p.outputTokens) || 0
        const pCost = (pIn * DS_IN / 1e6) + (pOut * DS_OUT / 1e6)
        return `<div class="hbar-row" style="margin-bottom:14px">
          <div class="hbar-top">
            <span class="hbar-name">${esc(p.name || p.id)} <span class="pill ${stateCls}" style="margin-left:6px">${esc(p.state || '—')}</span></span>
            <span class="hbar-val">${fmt(p.calls)} req · ${usd(pCost)}</span>
          </div>
          <div class="hbar-track">
            <div class="hbar-fill ${c}" style="width:${Math.max(2, Math.round((Number(p.calls) / Math.max(1, calls)) * 100))}%"></div>
          </div>
          <div class="kpi-sub" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:2px">
            <span>in <b class="mono">${compact(pIn)}</b></span>
            <span>out <b class="mono">${compact(pOut)}</b></span>
            <span>sukses <b class="mono">${pct(p.successRate)}</b></span>
            <span>latensi <b class="mono">${fmt(p.averageLatencyMs)}ms</b></span>
          </div>
        </div>`
      }).join('') : '<p class="muted">Belum ada aktivitas provider.</p>'
    }

    const pill = $('ov-pill')
    pill.textContent = rt.errors > 0 ? `${rt.errors} error` : 'sehat'
    pill.className = 'pill ' + (rt.errors > 0 ? 'warn' : 'on')

    // Tren 30 hari — warna by intensitas (heat)
    const trend = data.chatTrend || []
    const total30 = trend.reduce((a, b) => a + (b.messages || 0), 0)
    const trendPeak = Math.max(1, ...trend.map(t => t.messages || 0))
    $('trend-total').textContent = `${fmt(total30)} pesan`
    $('trend-from').textContent = trend[0]?.date ? fmtDate(trend[0].date) : '—'
    $('trend-to').textContent = trend.length ? fmtDate(trend[trend.length - 1].date) : '—'
    renderBars('trend-chart',
      trend.map(t => ({ value: t.messages, label: t.date })),
      'value', 'label', null, 'heat')
    const trendBox = $('trend-chart')
    if (trendBox) {
      trendBox.querySelectorAll('.chart-col').forEach((col, i) => {
        const t = trend[i]
        if (t) col.dataset.tip = `${fmtDate(t.date)} · ${fmt(t.messages)} pesan · ${fmt(t.users)} user`
      })
    }
    const peakEl = $('trend-peak')
    if (peakEl) peakEl.textContent = `puncak ${compact(trendPeak)}`

    // Per jam — warna by intensitas
    renderBars('hourly-chart',
      (data.hourly || []).map(h => ({ value: h.messages, label: h.hour })),
      'value', 'label', null, 'heat')
    const hourBox = $('hourly-chart')
    if (hourBox) {
      hourBox.querySelectorAll('.chart-col').forEach((col, i) => {
        const h = (data.hourly || [])[i]
        if (h) col.dataset.tip = `${h.hour} · ${fmt(h.messages)} pesan`
      })
    }

    // Top users — dengan ikon peringkat
    const top = data.topUsers || []
    const medalColor = ['c-lime', 'c-amber', 'c-pink']
    $('top-users').innerHTML = top.length
      ? top.map((u, i) => `<tr>
          <td><span class="rank-badge ${i < 3 ? 'top' : ''}" style="${i < 3 ? `background:var(--${i === 0 ? 'accent' : i === 1 ? 'warn' : 'accent-3'});color:${i === 1 ? 'var(--line)' : i === 2 ? '#fff' : 'var(--line)'}` : ''}">${i + 1}</span></td>
          <td><b>${esc(u.username)}</b></td>
          <td class="num">${fmt(u.messages)}</td>
          <td class="muted">${esc(fmtRelative(u.lastActive))}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="muted">Belum ada data.</td></tr>'

    // Distribusi kedekatan — horizontal bar berwarna + ikon
    const emo = data.emotions || []
    const EMO_ICON = { asing: 'users', kenalan: 'hand', dekat: 'heart', sahabat: 'trophy', istimewa: 'zap' }
    const EMO_COLOR = { asing: 'c-amber', kenalan: 'c-cyan', dekat: 'c-violet', sahabat: 'c-pink', istimewa: 'c-lime' }
    const emoTotal = emo.reduce((a, b) => a + (Number(b.value) || 0), 0) || 1
    renderHBars('emotion-chart', emo.map(e => ({
      label: e.label.charAt(0).toUpperCase() + e.label.slice(1),
      icon: EMO_ICON[e.label] || 'users',
      value: e.value,
      color: EMO_COLOR[e.label] || 'c-lime',
      display: `${fmt(e.value)} (${((e.value / emoTotal) * 100).toFixed(1)}%)`,
    })))
    const emoAxis = $('emotion-axis')
    if (emoAxis) emoAxis.innerHTML = `<span>${fmt(emoTotal)} pengguna total</span>`

    // Pengguna baru — dengan ikon
    const recent = data.recentUsers || []
    $('recent-users').innerHTML = recent.length
      ? recent.map(u => `<div class="kpi new-user" style="box-shadow:none;border-width:2px">
          <span class="kpi-label">${icon('hand', 12)} ${esc(fmtRelative(u.createdAt))}</span>
          <span class="kpi-value sm">${esc(u.username)}</span>
        </div>`).join('')
      : '<p class="muted">Belum ada pengguna baru.</p>'

    // Topbar
    $('chip-users').textContent = fmt(db.users)
    $('chip-messages').textContent = compact(db.messages)
    $('chip-tokens').textContent = compact(pt.tokens)
    $('chip-uptime').textContent = fmtDuration(rt.uptime)

    // Alert badge
    const alerts = data.alerts || []
    $('nav-alert-count').textContent = String(alerts.length)
    $('nav-alert-count').style.display = alerts.length ? '' : 'none'
    renderAlerts(alerts, rt)

    // Isi panel lain dari data yang sama
    fillUsage(data)
    fillDatabase(data.storage || {})

    window.__yukiDaily = data.providerDaily || []
    hydrateIcons()
    $('last-updated').textContent = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID')
  } catch (e) {
    showError(e.message)
  }
}

/* ═══════════════════════════════════════════════════════
   PANEL: PENGGUNAAN
   ═══════════════════════════════════════════════════════ */
function fillUsage(data) {
  const pt = data.providerTotals || {}
  const daily = data.providerDaily || []
  const DS_IN = 0.14, DS_OUT = 0.28
  const inTok = pt.inputTokens || 0
  const outTok = pt.outputTokens || 0
  const totTok = inTok + outTok
  // Estimasi retail DeepSeek — dipakai konsisten di seluruh dashboard
  const estCost = (inTok * DS_IN / 1e6) + (outTok * DS_OUT / 1e6)
  // dailyTotals hanya menyimpan token gabungan (tanpa pisah in/out),
  // jadi estimasi harian dihitung proporsional terhadap rasio in:out global.
  const estDaily = (d) => {
    const dayTokens = Number(d.tokens) || 0
    if (!dayTokens || !totTok) return 0
    const inShare = (inTok / totTok) * dayTokens
    const outShare = (outTok / totTok) * dayTokens
    return (inShare * DS_IN / 1e6) + (outShare * DS_OUT / 1e6)
  }

  $('us-tokens').textContent = compact(totTok)
  $('us-input').textContent = compact(inTok)
  $('us-output').textContent = compact(outTok)
  $('us-cost').textContent = usd(estCost)
  $('us-cost-sub').textContent = `retail · aktual $0.00`

  $('us-calls').textContent = fmt(pt.calls)
  $('us-calls-sub').textContent = `${fmt(pt.successes)} sukses · ${fmt(pt.failures)} gagal`
  $('us-avg').textContent = fmt(pt.calls ? Math.round(totTok / pt.calls) : 0)
  const ratio = inTok ? (outTok / inTok) * 100 : 0
  $('us-ratio').textContent = pct(ratio)
  $('us-cost1k').textContent = pt.calls ? usd((estCost / pt.calls) * 1000) : '$0.00'

  $('usage-days').textContent = `${daily.length} hari`

  const rows = [...daily].reverse().slice(0, 30)
  $('usage-daily').innerHTML = rows.length
    ? rows.map(d => `<tr>
        <td>${esc(d.date)}</td>
        <td class="num">${fmt(d.calls)}</td>
        <td class="num">${compact(d.tokens)}</td>
        <td class="num" style="color:${d.failures ? 'var(--bad)' : 'var(--ink-faint)'}">${fmt(d.failures)}</td>
        <td class="num">${usd(estDaily(d))}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="muted">Belum ada data harian.</td></tr>'

  // Kartu provider
  const prov = data.providerHealth || []
  $('usage-providers').innerHTML = prov.length
    ? prov.map(p => {
        const tone = p.state === 'open' ? 'bad' : (p.state === 'half-open' ? 'warn' : 'on')
        return `<div class="kpi" style="box-shadow:none;border-width:2px;gap:11px">
          <div class="between"><b style="font-size:12px">${esc(p.name || p.id)}</b><span class="pill ${tone}">${esc(p.state || '—')}</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;font-size:11px">
            <div><span class="kpi-label">Request</span><br><b class="num">${fmt(p.calls)}</b></div>
            <div><span class="kpi-label">Sukses</span><br><b class="num">${pct(p.successRate)}</b></div>
            <div><span class="kpi-label">Latensi</span><br><b class="num">${fmt(p.averageLatencyMs)}ms</b></div>
            <div><span class="kpi-label">Token</span><br><b class="num">${compact(p.totalTokens)}</b></div>
          </div>
          <span class="kpi-sub">${usd(p.estimatedCostUsd)} · in ${compact(p.inputTokens)} / out ${compact(p.outputTokens)}</span>
        </div>`
      }).join('')
    : '<p class="muted">Belum ada aktivitas provider.</p>'

  const state = $('router-state')
  if (state) {
    state.textContent = pt.openCircuits ? `${pt.openCircuits} circuit terbuka` : 'sehat'
    state.className = 'pill ' + (pt.openCircuits ? 'bad' : 'on')
  }
}

/* ═══════════════════════════════════════════════════════
   PANEL: DATABASE
   ═══════════════════════════════════════════════════════ */
function fillDatabase(storage) {
  const bytes = storage.bytes || 0
  $('db-size').textContent = bytes > 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
    : (bytes / 1024).toFixed(0) + ' KB'
  const labels = { chat_history: 'Riwayat chat', facts: 'Fakta ingatan', structured_memory: 'Memori terstruktur', agent_memories: 'Memori agent', events: 'Peristiwa' }
  $('db-tables').innerHTML = (storage.tables || []).map(t => `
    <div class="kpi" style="box-shadow:none;border-width:2px">
      <span class="kpi-label">${esc(labels[t.name] || t.name)}</span>
      <span class="kpi-value sm">${compact(t.rows)}</span>
      <span class="kpi-sub">${esc(t.name)}</span>
    </div>`).join('')
}

/* ═══════════════════════════════════════════════════════
   PANEL: ALERT
   ═══════════════════════════════════════════════════════ */
function renderAlerts(alerts, rt) {
  const box = $('alert-list')
  if (!box) return
  const items = []
  if (rt.errors > 0) items.push({ level: 'bad', text: `${fmt(rt.errors)} error tercatat sejak server hidup`, time: null })
  for (const a of alerts || []) {
    items.push({ level: a.level === 'error' ? 'bad' : 'warn', text: a.message || String(a), time: a.at || a.time || null })
  }
  box.innerHTML = items.length
    ? items.map(i => `<div class="alert-item ${i.level}">
        <span class="tag">${i.level === 'bad' ? 'ERROR' : 'WARN'}</span>
        <span>${esc(i.text)}</span>
        <time>${esc(i.time ? fmtRelative(i.time) : '—')}</time>
      </div>`).join('')
    : '<p class="muted">Tidak ada alert. Sistem berjalan normal.</p>'
}

/* ═══════════════════════════════════════════════════════
   NAVIGASI
   ═══════════════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id))
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === id))
  if (location.hash.replace('#', '') !== id) location.hash = id
  window.scrollTo({ top: 0, behavior: 'smooth' })
  hydrateIcons()
}

const VIEW_LOADERS = {
  'view-overview': loadOverview,
  'view-summary': () => loadSummary(),
  'view-users': () => loadUsers(),
  'view-database': () => loadDbTables(),
  'view-providers': () => loadProviders(),
  'view-alerts': loadOverview,
}

/* ─────────── Ringkasan (kartu siap screenshot — lebar HP) ─────────── */
async function loadSummary() {
  try {
    const data = await request('/api/admin/overview', { headers: headers() })
    const db = data.database || {}, pt = data.providerTotals || {}, rt = data.runtime || {}
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v }
    set('sh-date', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }))
    set('sh-users', fmt(db.users))
    set('sh-users-sub', `+${fmt(db.newUsersToday)} hari ini · +${fmt(db.newUsersWeek)} minggu ini`)
    set('sh-messages', fmt(db.messages))
    set('sh-tokens', compact((pt.inputTokens || 0) + (pt.outputTokens || 0) || pt.tokens))
    set('sh-calls', fmt(pt.calls || rt.requests))
    set('sh-bond', Number(db.averageBond || 0).toFixed(1))
    set('sh-active', fmt(db.activeToday))
    set('sh-uptime', fmtDuration(rt.uptime))
    set('sh-success', `${pct(pt.successRate)} sukses`)
    // Tambahan: pesan hari ini, latensi, estimasi biaya retail
    const todayMsgs = (data.hourly || []).reduce((a, b) => a + (b.messages || 0), 0)
    set('sh-msg-today', fmt(todayMsgs))
    set('sh-latency', `${fmt(pt.averageLatencyMs || rt.averageLatency || 0)} ms`)
    const inTok = pt.inputTokens || 0, outTok = pt.outputTokens || 0
    set('sh-cost', usd((inTok * 0.14 + outTok * 0.28) / 1e6))

    // Mini game: apakah fitur ini benar-benar dimainkan?
    const g = data.games || {}
    set('sh-games-total', fmt(g.totalStarts || 0))
    set('sh-games-players', fmt(g.players || 0))
    set('sh-games-rounds', fmt(g.totalRounds || 0))
    set('sh-games-today', fmt(g.todayStarts || 0))
    const selesai = g.finishes || 0
    set('sh-games-note', g.totalStarts
      ? `${selesai} selesai · ${g.completionRate || 0}% tuntas`
      : 'belum ada yang main')
    const daftar = $('sh-games-list')
    if (daftar) {
      const nama = { 'tic-tac-toe': 'Tic-Tac-Toe', 'batu-kertas-gunting': 'Batu-Kertas-Gunting' }
      const baris = g.byGame || []
      if (!baris.length) {
        daftar.innerHTML = '<div class="sg-card sg-empty">Belum ada yang main.</div>'
      } else {
        daftar.innerHTML = baris.map(item => {
          const judul = String(nama[item.game] || item.game).replace(/[<>&]/g, '')
          return `<div class="sg-card sg-game">
            <span class="sg-name">${judul}</span>
            <span class="sg-nums">
              <span><b>${fmt(item.starts || 0)}</b><small>sesi</small></span>
              <span><b>${fmt(item.rounds || 0)}</b><small>ronde</small></span>
              <span><b>${fmt(item.players || 0)}</b><small>pemain</small></span>
            </span>
          </div>`
        }).join('')
      }
    }
  } catch (e) { console.warn('[Summary]', e.message) }
}

/* ─────────── Hamburger sidebar toggle ─────────── */
const menuToggle = $('menu-toggle')
const sidebarEl = document.querySelector('.sidebar')
const overlayEl = $('sidebar-overlay')

function closeSidebar() {
  if (sidebarEl) sidebarEl.classList.remove('open')
  if (overlayEl) overlayEl.classList.remove('open')
}

if (menuToggle) {
  menuToggle.onclick = () => {
    if (sidebarEl) sidebarEl.classList.toggle('open')
    if (overlayEl) overlayEl.classList.toggle('open')
  }
}
if (overlayEl) overlayEl.onclick = closeSidebar

document.querySelectorAll('.nav-link').forEach(btn => {
  btn.onclick = () => {
    showView(btn.dataset.view)
    const fn = VIEW_LOADERS[btn.dataset.view]
    if (fn) fn()
    if (window.innerWidth < 768) closeSidebar()
  }
})

/* ═══════════════════════════════════════════════════════
   PROVIDER
   ═══════════════════════════════════════════════════════ */
function providerPayload(id) {
  return {
    id,
    name: field(`${id}.name`).value,
    baseURL: field(`${id}.baseURL`).value,
    model: field(`${id}.model`).value,
    apiKey: field(`${id}.apiKey`).value,
    inputCostPerMillion: Number(field(`${id}.inputCostPerMillion`).value || 0),
    outputCostPerMillion: Number(field(`${id}.outputCostPerMillion`).value || 0),
  }
}

function fillProvider(id, data) {
  for (const key of ['name', 'baseURL', 'model', 'inputCostPerMillion', 'outputCostPerMillion']) {
    const el = field(`${id}.${key}`)
    if (el) el.value = data[key] ?? ''
  }
  const keyEl = field(`${id}.apiKey`)
  if (keyEl) {
    keyEl.value = ''
    keyEl.placeholder = data.hasApiKey ? 'Key tersimpan · kosongkan agar tetap' : 'Masukkan API key'
  }
}

async function loadProviders() {
  try {
    const data = await request('/api/admin/providers', { headers: headers() })
    const p = data.providers || {}
    if (p.primary) fillProvider('primary', p.primary)
    if (p.backup) fillProvider('backup', p.backup)
    const live = ($('primary-live')) ? '' : ''
  } catch (e) { showError(e.message) }
}

document.querySelectorAll('[data-test]').forEach(btn => {
  btn.onclick = async () => {
    const id = btn.dataset.test
    const status = $('provider-status')
    btn.disabled = true
    status.textContent = `Menguji ${id}…`
    try {
      const d = await request('/api/admin/providers/test', {
        method: 'POST', headers: headers(true), body: JSON.stringify(providerPayload(id)),
      })
      status.textContent = `${id} tersambung · ${d.latencyMs} ms · ${d.model}`
      status.className = 'status-line ok'
    } catch (e) {
      status.textContent = `Test gagal: ${e.message}`
      status.className = 'status-line err'
    } finally { btn.disabled = false }
  }
})

const providerForm = $('provider-form')
if (providerForm) {
  providerForm.onsubmit = async (e) => {
    e.preventDefault()
    const status = $('provider-status')
    status.textContent = 'Menyimpan…'
    try {
      await request('/api/admin/providers', {
        method: 'PUT', headers: headers(true),
        body: JSON.stringify({ primary: providerPayload('primary'), backup: providerPayload('backup') }),
      })
      status.textContent = 'Konfigurasi tersimpan. Request berikutnya memakai routing baru.'
      status.className = 'status-line ok'
      loadOverview()
    } catch (e2) {
      status.textContent = e2.message
      status.className = 'status-line err'
    }
  }
}

const resetBtn = $('btn-reset-stats')
if (resetBtn) {
  resetBtn.onclick = async () => {
    if (!confirm('Hapus akumulasi token & statistik provider? Tidak bisa dibatalkan.')) return
    try { await request('/api/admin/providers/reset-stats', { method: 'POST', headers: headers() }); loadOverview() }
    catch (e) { showError(e.message) }
  }
}

/* ═══════════════════════════════════════════════════════
   PENGGUNA
   ═══════════════════════════════════════════════════════ */
const userState = { page: 1, pageSize: 24, search: '', pageCount: 1 }
const udState = { userId: '', username: '', table: '', page: 1, pageSize: 50, search: '', pageCount: 1 }

async function loadUsers() {
  try {
    const params = new URLSearchParams({ page: userState.page, pageSize: userState.pageSize })
    if (userState.search) params.set('search', userState.search)
    const data = await request(`/api/admin/users?${params}`, { headers: headers() })
    userState.page = data.page || 1
    userState.pageCount = data.pageCount || 1
    const users = data.users || []
    window.__usersCache = users
    $('user-grid').innerHTML = users.length
      ? users.map(u => `<div class="kpi" style="box-shadow:none;border-width:2px;cursor:pointer;gap:8px"
            data-uid="${esc(u.userId)}" data-uname="${esc(u.username)}">
          <div class="between"><b style="font-size:12px">${esc(u.username || 'tanpa nama')}</b><span class="tag">${fmt(u.messages)}</span></div>
          <span class="kpi-sub">memori ${fmt(u.memories)} · ${esc(fmtRelative(u.lastActive))}</span>
        </div>`).join('')
      : '<p class="muted">Tidak ada pengguna.</p>'

    $('user-grid').querySelectorAll('[data-uid]').forEach(card => {
      card.onclick = () => openUserDetail(card.dataset.uid, card.dataset.uname)
    })
    $('u-pageinfo').textContent = `Halaman ${userState.page} / ${userState.pageCount}`
  } catch (e) { showError(e.message) }
}

if ($('user-search')) {
  let t
  $('user-search').oninput = (e) => {
    clearTimeout(t)
    t = setTimeout(() => { userState.search = e.target.value.trim(); userState.page = 1; loadUsers() }, 320)
  }
}
if ($('user-size')) $('user-size').onchange = (e) => { userState.pageSize = Number(e.target.value); userState.page = 1; loadUsers() }
if ($('u-first')) $('u-first').onclick = () => { userState.page = 1; loadUsers() }
if ($('u-prev')) $('u-prev').onclick = () => { if (userState.page > 1) { userState.page--; loadUsers() } }
if ($('u-next')) $('u-next').onclick = () => { if (userState.page < userState.pageCount) { userState.page++; loadUsers() } }
if ($('u-last')) $('u-last').onclick = () => { userState.page = userState.pageCount; loadUsers() }

async function openUserDetail(userId, username) {
  udState.userId = userId
  udState.username = username
  udState.table = ''
  $('user-detail').classList.remove('hidden')
  $('ud-name').textContent = username || 'tanpa nama'

  // Ringkasan diambil dari kartu pengguna yang sudah dimuat (list users).
  const cached = (window.__usersCache || []).find(u => u.userId === userId) || {}
  const wsSize = cached.wsBytes ? (cached.wsBytes / 1024 / 1024).toFixed(1) + ' MB' : '—'
  $('ud-summary').innerHTML = `<div class="kpi-grid">
      <div class="kpi" style="box-shadow:none;border-width:2px"><span class="kpi-label">Pesan</span><span class="kpi-value sm">${fmt(cached.messages)}</span></div>
      <div class="kpi" style="box-shadow:none;border-width:2px"><span class="kpi-label">Memori</span><span class="kpi-value sm">${fmt(cached.memories)}</span></div>
      <div class="kpi" style="box-shadow:none;border-width:2px"><span class="kpi-label">Jadwal</span><span class="kpi-value sm">${fmt(cached.schedules)}</span></div>
      <div class="kpi" style="box-shadow:none;border-width:2px"><span class="kpi-label">Bookmark</span><span class="kpi-value sm">${fmt(cached.bookmarks)}</span></div>
      <div class="kpi" style="box-shadow:none;border-width:2px"><span class="kpi-label">Artifact</span><span class="kpi-value sm">${fmt(cached.artifacts)}</span></div>
      <div class="kpi" style="box-shadow:none;border-width:2px"><span class="kpi-label">Workspace</span><span class="kpi-value sm" style="font-size:15px">${esc(wsSize)}</span></div>
    </div>
    <div class="note" style="margin-top:14px">
      <b>ID:</b> <span class="mono">${esc(userId)}</span> ·
      <b>Terdaftar:</b> ${esc(fmtDate(cached.createdAt))} ·
      <b>Terakhir aktif:</b> ${esc(fmtRelative(cached.lastActive))}
    </div>`

  try {
    const data = await request(`/api/admin/users/${encodeURIComponent(userId)}/tables`, { headers: headers() })
    const tables = data.tables || []
    $('ud-tabs').innerHTML = tables.length
      ? tables.map(t => `<button class="btn ghost sm" data-table="${esc(t.name)}">${esc(t.label || t.name)} <span class="tag">${fmt(t.count)}</span></button>`).join('')
      : '<p class="muted">Tidak ada data untuk pengguna ini.</p>'
    $('ud-tabs').querySelectorAll('[data-table]').forEach(b => {
      b.onclick = () => {
        $('ud-tabs').querySelectorAll('[data-table]').forEach(x => x.classList.remove('btn'))
        $('ud-tabs').querySelectorAll('[data-table]').forEach(x => x.classList.add('ghost'))
        b.classList.remove('ghost')
        loadUserTable(b.dataset.table)
      }
    })
    if (tables.length) loadUserTable(tables[0].name)
    else $('ud-table').innerHTML = '<p class="muted" style="padding:16px">Tidak ada data.</p>'
  } catch (e) { showError(e.message) }
}

async function loadUserTable(table) {
  udState.table = table
  udState.page = 1
  try {
    const params = new URLSearchParams({ page: 1, pageSize: udState.pageSize })
    const data = await request(
      `/api/admin/users/${encodeURIComponent(udState.userId)}/table/${encodeURIComponent(table)}?${params}`,
      { headers: headers() })
    renderUserTable(data)
  } catch (e) { showError(e.message) }
}

function renderUserTable(data) {
  const cols = data.columns || []
  const rows = data.rows || []
  if (!cols.length) {
    $('ud-table').innerHTML = '<p class="muted" style="padding:16px">Tidak ada kolom.</p>'
    return
  }
  $('ud-table').innerHTML = `<table class="tbl">
      <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(String(r[c] ?? '')).slice(0, 200)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="status-line" style="padding:12px 16px">${fmt(data.total)} baris · halaman ${data.page}/${data.pageCount} · <b>${esc(data.label || data.table)}</b></p>`
}

if ($('ud-close')) $('ud-close').onclick = () => $('user-detail').classList.add('hidden')

/* ═══════════════════════════════════════════════════════
   PENCARI KUNCI INGANAN (bantuan saat user lupa kunci)
   ═══════════════════════════════════════════════════════ */
async function lookupKey() {
  const q = ($('lk-search')?.value || '').trim()
  if (!q) {
    $('lk-status').textContent = 'Isi nama akun dulu.'
    $('lk-wrap').innerHTML = '<p class="muted" style="padding:16px">Ketik nama akun lalu tekan “Cari Kunci”.</p>'
    if ($('lk-total')) $('lk-total').textContent = '—'
    return
  }
  $('lk-status').textContent = 'Mencari…'
  try {
    const data = await request(`/api/admin/lookup-key?q=${encodeURIComponent(q)}`, { headers: headers() })
    const users = data.users || []
    if ($('lk-total')) $('lk-total').textContent = `${fmt(data.total || 0)} akun`
    if (!users.length) {
      $('lk-status').textContent = 'Tidak ada akun yang cocok.'
      $('lk-wrap').innerHTML = '<p class="muted" style="padding:16px">Tidak ada akun yang cocok dengan pencarian itu.</p>'
      return
    }
    $('lk-status').textContent = `${users.length} akun ditemukan`
    $('lk-wrap').innerHTML = `<table class="tbl">
      <thead><tr>
        <th>Nama akun</th><th>Kunci ingatan</th><th>Kedekatan</th><th>Pesan</th><th>Aktif terakhir</th><th></th>
      </tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><b>${esc(u.username || '(tanpa nama)')}</b><br><span class="muted" style="font-size:10px">${esc(u.userId)}</span></td>
        <td>${u.keyRecoverable
          ? `<code class="lk-code">${esc(u.accessCode)}</code>`
          : `<span class="lk-locked" title="Kunci disimpan sebagai hash SHA-256 — tidak dapat dikembalikan.">Tersimpan terenkripsi</span>`}</td>
        <td>${bondTag(u.bond, u.bondName)}</td>
        <td>${fmt(u.messages)}</td>
        <td>${u.lastActive ? esc(String(u.lastActive).slice(0, 16)) : '—'}</td>
        <td class="lk-actions">${u.keyRecoverable
          ? `<button class="btn ghost sm" data-copy="${esc(u.accessCode)}">Salin</button>`
          : `<button class="btn sm" data-newkey="${esc(u.userId)}" data-name="${esc(u.username || '')}">Buat Kunci Baru</button>`}</td>
      </tr>`).join('')}</tbody></table>`
    // Tombol salin kunci
    $('lk-wrap').querySelectorAll('[data-copy]').forEach(btn => {
      btn.onclick = async () => {
        const val = btn.getAttribute('data-copy')
        try {
          await navigator.clipboard.writeText(val)
          btn.textContent = 'Tersalin ✓'
        } catch { btn.textContent = 'Gagal salin' }
        setTimeout(() => { btn.textContent = 'Salin' }, 1600)
      }
    })
    // Tombol buat kunci baru (kunci lama hangus, sesi login tetap berjalan)
    $('lk-wrap').querySelectorAll('[data-newkey]').forEach(btn => {
      btn.onclick = async () => {
        const uid = btn.getAttribute('data-newkey')
        const nama = btn.getAttribute('data-name') || 'user ini'
        const setuju = confirm(`Buat kunci ingatan BARU untuk "${nama}"?\n\nKunci lama akan hangus dan TIDAK bisa dipakai lagi.\nSesi login yang sedang berjalan tetap aktif.\n\nKunci baru akan langsung ditampilkan.`)
        if (!setuju) return
        btn.disabled = true
        btn.textContent = 'Membuat…'
        try {
          const data = await request(`/api/admin/users/${encodeURIComponent(uid)}/reset-key`,
            { method: 'POST', headers: headers() })
          const row = btn.closest('tr')
          row.querySelector('.lk-code')?.remove()
          const lock = row.querySelector('.lk-locked')
          if (lock) lock.remove()
          const cell = row.children[1]
          const kode = document.createElement('code')
          kode.className = 'lk-code lk-new'
          kode.textContent = data.accessCode
          cell.appendChild(kode)
          row.querySelector('.lk-actions').innerHTML =
            `<button class="btn ghost sm" data-copy="${esc(data.accessCode)}">Salin</button>`
          row.querySelector('[data-copy]').onclick = async () => {
            try { await navigator.clipboard.writeText(data.accessCode) } catch { /* abaikan */ }
          }
          $('lk-status').textContent = `Kunci baru dibuat untuk ${data.username}.`
          hydrateIcons()
        } catch (e) {
          showError(e.message)
          btn.disabled = false
          btn.textContent = 'Buat Kunci Baru'
        }
      }
    })
    hydrateIcons()
  } catch (e) { showError(e.message); $('lk-status').textContent = 'Gagal mencari.' }
}

function bondTag(bond, name) {
  const warna = bond >= 78 ? 'var(--accent-3)' : bond >= 50 ? 'var(--ok)' : bond >= 24 ? 'var(--info)' : bond >= 8 ? 'var(--accent)' : 'var(--ink-dim)'
  return `<span class="pill" style="color:${warna}">${esc(name || 'orang asing')} · ${fmt(bond ?? 0)}</span>`
}

if ($('lk-find')) $('lk-find').onclick = () => lookupKey()
if ($('lk-search')) $('lk-search').onkeydown = (e) => { if (e.key === 'Enter') lookupKey() }

/* ═══════════════════════════════════════════════════════
   DATABASE
   ═══════════════════════════════════════════════════════ */
const dbState = { table: '', page: 1, pageSize: 50, search: '', pageCount: 1 }

async function loadDbTables() {
  if ($('db-table').options.length > 1) return
  try {
    const data = await request('/api/admin/db/tables', { headers: headers() })
    const tables = data.tables || []
    $('db-table').innerHTML = '<option value="">— pilih tabel —</option>' +
      tables.map(t => `<option value="${esc(t.name)}">${esc(t.label || t.name)} (${fmt(t.rows)})</option>`).join('')
  } catch (e) { showError(e.message) }
}

async function loadDbTable() {
  if (!dbState.table) return
  try {
    const params = new URLSearchParams({ page: dbState.page, pageSize: dbState.pageSize })
    if (dbState.search) params.set('search', dbState.search)
    const data = await request(`/api/admin/db/table/${encodeURIComponent(dbState.table)}?${params}`, { headers: headers() })
    dbState.page = data.page || 1
    dbState.pageCount = data.pageCount || 1
    const cols = data.columns || []
    const rows = data.rows || []
    $('db-wrap').innerHTML = cols.length ? `<table class="tbl">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(String(r[c] ?? '')).slice(0, 160)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>` : '<p class="muted" style="padding:16px">Tidak ada data.</p>'
    $('db-pageinfo').textContent = `Halaman ${dbState.page} / ${dbState.pageCount} · ${fmt(data.total)} baris`
  } catch (e) { showError(e.message) }
}

if ($('db-table')) $('db-table').onchange = (e) => { dbState.table = e.target.value; dbState.page = 1; loadDbTable() }
if ($('db-load')) $('db-load').onclick = () => { dbState.page = 1; loadDbTable() }
if ($('db-size-sel')) $('db-size-sel').onchange = (e) => { dbState.pageSize = Number(e.target.value); dbState.page = 1; loadDbTable() }
if ($('db-first')) $('db-first').onclick = () => { dbState.page = 1; loadDbTable() }
if ($('db-prev')) $('db-prev').onclick = () => { if (dbState.page > 1) { dbState.page--; loadDbTable() } }
if ($('db-next')) $('db-next').onclick = () => { if (dbState.page < dbState.pageCount) { dbState.page++; loadDbTable() } }
if ($('db-last')) $('db-last').onclick = () => { dbState.page = dbState.pageCount; loadDbTable() }
if ($('db-search')) {
  let t
  $('db-search').oninput = (e) => {
    clearTimeout(t)
    t = setTimeout(() => { dbState.search = e.target.value.trim(); dbState.page = 1; loadDbTable() }, 340)
  }
}
if ($('alert-refresh')) $('alert-refresh').onclick = loadOverview

/* ═══════════════════════════════════════════════════════
   AUTENTIKASI
   ═══════════════════════════════════════════════════════ */
function showApp() {
  $('login-gate').classList.add('hidden')
  $('app').classList.remove('hidden')
}
function showLogin() {
  $('app').classList.add('hidden')
  $('login-gate').classList.remove('hidden')
}

function showError(msg) {
  const el = $('global-error')
  if (!el) return
  el.textContent = msg || ''
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = '' }, 6000)
}

async function doLogin() {
  const pw = $('admin-key').value
  if (!pw) return
  try {
    const data = await request('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    sessionStorage.setItem('yuki_admin_session', data.sessionToken)
    $('admin-key').value = ''
    $('login-error').textContent = ''
    showApp()
    await boot()
  } catch (e) {
    $('login-error').textContent = e.message
  }
}

if ($('btn-login')) $('btn-login').onclick = doLogin
if ($('admin-key')) $('admin-key').onkeydown = (e) => { if (e.key === 'Enter') doLogin() }
if ($('btn-logout')) $('btn-logout').onclick = () => { sessionStorage.removeItem('yuki_admin_session'); location.reload() }
if ($('btn-refresh')) $('btn-refresh').onclick = () => loadOverview()
if ($('btn-password')) $('btn-password').onclick = () => $('password-panel').classList.toggle('hidden')
if ($('pw-close')) $('pw-close').onclick = () => $('password-panel').classList.add('hidden')
if ($('pw-save')) {
  $('pw-save').onclick = async () => {
    try {
      const d = await request('/api/admin/password', {
        method: 'POST', headers: headers(true),
        body: JSON.stringify({ password: $('new-password').value }),
      })
      sessionStorage.setItem('yuki_admin_session', d.sessionToken)
      $('pw-status').textContent = 'Password diganti.'
      $('pw-status').className = 'status-line ok'
    } catch (e) {
      $('pw-status').textContent = e.message
      $('pw-status').className = 'status-line err'
    }
  }
}

/* ═══════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════ */
async function boot() {
  hydrateIcons()
  try {
    const health = await fetch('/api/health').then(r => r.json()).catch(() => null)
    const dot = $('dot-health')
    $('chip-health').textContent = health?.status === 'ok' ? 'online' : 'offline'
    dot.className = 'dot' + (health?.status === 'ok' ? '' : ' bad')
  } catch {
    $('chip-health').textContent = 'offline'
    $('dot-health').className = 'dot bad'
  }

  // Pasang listener hash SEBELUM await lambat — klik tab yang terjadi di
  // tengah boot harus langsung direspons, bukan menunggu load data.
  const hashNow = () => location.hash.replace('#', '')
  const valid = ['view-overview', 'view-summary', 'view-usage', 'view-users', 'view-memory', 'view-schedule', 'view-database', 'view-providers', 'view-tts', 'view-alerts']
  window.addEventListener('hashchange', () => {
    const h = hashNow()
    if (valid.includes(h)) { showView(h); const f = VIEW_LOADERS[h]; if (f) f() }
  })

  await loadOverview()
  await loadProviders()

  // Baca hash TERAKHIR (klik user selama loading tetap terhormati); kalau
  // hash kosong, pertahankan view yang sedang aktif — jangan dipaksa reset.
  const hash = hashNow()
  const activeNow = document.querySelector('.view.active')?.id
  const target = valid.includes(hash) ? hash : (activeNow || 'view-overview')
  showView(target)
  const fn = VIEW_LOADERS[target]
  if (fn) fn()

  setInterval(loadOverview, 45000)
}

/* Cek sesi tersimpan */
if (token()) {
  request('/api/admin/stats', { headers: headers() })
    .then(() => { showApp(); boot() })
    .catch(() => { sessionStorage.removeItem('yuki_admin_session'); showLogin() })
} else {
  showLogin()
}
