import { validateSafeOutboundUrl } from '../../../lib/security.js'

export async function http_api_request({ url, method = 'GET', headers = {}, body = null }) {
  if (!url || typeof url !== 'string') {
    return { error: 'URL target tidak boleh kosong.' }
  }

  let targetUrl = url.trim()
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl
  }

  // 🛡️ SECURITY CHECK: Blokir SSRF ke localhost, IP internal, cloud metadata, dan port terlarang
  const securityCheck = await validateSafeOutboundUrl(targetUrl)
  if (!securityCheck.safe) {
    return { error: `[Keamanan Jaringan]: ${securityCheck.reason}` }
  }
  targetUrl = securityCheck.cleanUrl

  // Audit Nov 2026 (H3): API tester hanya untuk layanan web publik — batasi ke
  // port standar supaya tidak bisa memindai port internal VPS lewat DNS publik.
  try {
    const portNum = new URL(targetUrl).port ? Number(new URL(targetUrl).port) : (targetUrl.startsWith('https:') ? 443 : 80)
    if (![80, 443].includes(portNum)) {
      return { error: `Port :${portNum} tidak diizinkan untuk uji API. Gunakan port standar 80/443.` }
    }
  } catch { return { error: 'URL target tidak valid.' } }

  const httpMethod = String(method || 'GET').toUpperCase()
  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']
  if (!allowedMethods.includes(httpMethod)) {
    return { error: `Metode HTTP "${httpMethod}" tidak didukung. Gunakan: ${allowedMethods.join(', ')}` }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  const startTime = Date.now()

  try {
    // Audit Nov 2026 (H3): header allowlist — cegah header injection /
    // pemalsuan identitas jaringan (Host, X-Forwarded-*, Cookie tidak pernah
    // boleh dikirim dari sisi server).
    const ALLOWED_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'authorization', 'x-api-key', 'api-key'])
    const safeHeaders = { 'User-Agent': 'Yuki-Agent-API-Tester/1.0' }
    for (const [k, v] of Object.entries(headers && typeof headers === 'object' ? headers : {})) {
      if (ALLOWED_HEADERS.has(String(k).toLowerCase())) safeHeaders[k] = String(v).slice(0, 500)
    }
    const fetchOptions = {
      method: httpMethod,
      headers: safeHeaders,
      signal: controller.signal
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(httpMethod)) {
      fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : String(body)
      if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']) {
        if (typeof body === 'object' || (typeof body === 'string' && body.trim().startsWith('{'))) {
          fetchOptions.headers['Content-Type'] = 'application/json'
        }
      }
    }

    const redirectChain = []
    let currentUrl = targetUrl
    let res
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      res = await fetch(currentUrl, { ...fetchOptions, redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(res.status)) break
      const location = res.headers.get('location')
      if (!location) break
      const nextUrl = new URL(location, currentUrl).toString()
      const redirectSafety = await validateSafeOutboundUrl(nextUrl)
      if (!redirectSafety.safe) return { success: false, error: `[Keamanan Redirect]: ${redirectSafety.reason}`, redirectChain }
      // Jangan bocorkan kredensial ke origin lain lewat redirect.
      try {
        if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
          for (const k of Object.keys(fetchOptions.headers)) {
            if (['authorization', 'x-api-key', 'api-key'].includes(k.toLowerCase())) delete fetchOptions.headers[k]
          }
        }
      } catch {}
      redirectChain.push({ status: res.status, from: currentUrl, to: redirectSafety.cleanUrl })
      currentUrl = redirectSafety.cleanUrl
      if (redirects === 5) return { success: false, error: 'Terlalu banyak redirect (maksimal 5).', redirectChain }
    }
    const durationMs = Date.now() - startTime

    const resHeaders = {}
    res.headers.forEach((val, key) => {
      if (['content-type', 'content-length', 'server', 'x-powered-by', 'date'].includes(key.toLowerCase())) {
        resHeaders[key] = val
      }
    })

    const text = await res.text()
    let parsedJson = null
    try {
      parsedJson = JSON.parse(text)
    } catch {}

    const truncatedBody = text.length > 2500 ? text.slice(0, 2500) + '... (output terpotong)' : text

    return {
      success: true,
      url: currentUrl,
      requestedUrl: targetUrl,
      method: httpMethod,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      ok: res.ok,
      responseSize: Buffer.byteLength(text),
      redirectChain,
      headers: resHeaders,
      json: parsedJson,
      bodyPreview: !parsedJson ? truncatedBody : undefined
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const isTimeout = err.name === 'AbortError'
    return {
      success: false,
      url: targetUrl,
      method: httpMethod,
      durationMs,
      error: isTimeout ? 'Request timeout setelah 8 detik.' : `Koneksi gagal: ${err.message}`
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export default {
  http_api_request
}
