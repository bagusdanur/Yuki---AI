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
    return { error: `[Keamanan VPS]: ${securityCheck.reason}` }
  }
  targetUrl = securityCheck.cleanUrl

  const httpMethod = String(method || 'GET').toUpperCase()
  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']
  if (!allowedMethods.includes(httpMethod)) {
    return { error: `Metode HTTP "${httpMethod}" tidak didukung. Gunakan: ${allowedMethods.join(', ')}` }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  const startTime = Date.now()

  try {
    const fetchOptions = {
      method: httpMethod,
      headers: {
        'User-Agent': 'Yuki-Agent-API-Tester/1.0',
        ...(headers && typeof headers === 'object' ? headers : {})
      },
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

    const res = await fetch(targetUrl, fetchOptions)
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
      url: targetUrl,
      method: httpMethod,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      ok: res.ok,
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
