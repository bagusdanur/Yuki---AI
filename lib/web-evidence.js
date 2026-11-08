// lib/web-evidence.js — Fetch bukti nyata untuk analisis situs eksternal.
// Dipakai agar klaim techstack/celah Yuki berbasis HTML+header asli, bukan tebakan.
// Semua URL difilter validateSafeOutboundUrl (blokir SSRF ke internal/VPS).
import { validateSafeOutboundUrl } from './security.js'

const MAX_HTML = 200 * 1024
const KEEP_HEADERS = ['server', 'x-powered-by', 'cf-cache-status', 'cf-ray', 'content-type']

function detectMarkers(html, headers) {
  const h = html.toLowerCase()
  const hdrs = Object.entries(headers).map(([k, v]) => `${k.toLowerCase()}: ${String(v).toLowerCase()}`).join('\n')
  return {
    cloudflare: /cf-cache-status|cf-ray/.test(hdrs),
    svelte: /svelte|__sveltekit|data-sveltekit/.test(h),
    laravel: /laravel_session|x-xsrf-token|x-powered-by:\s*php/i.test(hdrs) || /laravel/.test(h),
    vite: /@vite|\/assets\/index-/.test(h),
    tailwind: /tailwind/.test(h),
  }
}

export async function fetchSiteEvidence(rawUrl) {
  const check = await validateSafeOutboundUrl(rawUrl)
  if (!check.safe) return { ok: false, reason: check.reason || 'URL ditolak.' }
  let res
  try {
    res = await fetch(check.cleanUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YukiEvidence/1.0)' },
    })
  } catch (e) {
    return { ok: false, reason: `Fetch gagal: ${e?.name === 'TimeoutError' ? 'timeout 10 detik' : String(e?.message || e).slice(0, 200)}` }
  }
  const headers = {}
  for (const name of KEEP_HEADERS) {
    const v = res.headers.get(name)
    if (v) headers[name] = String(v).slice(0, 200)
  }
  let html = ''
  try {
    html = await res.text()
  } catch {
    html = ''
  }
  const truncated = html.length > MAX_HTML
  if (truncated) html = html.slice(0, MAX_HTML)
  return {
    ok: true,
    status: res.status,
    headers,
    htmlLength: html.length,
    markers: detectMarkers(html, headers),
    truncated,
  }
}
