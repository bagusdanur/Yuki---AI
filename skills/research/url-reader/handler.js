import { validateSafeOutboundUrl } from '../../../lib/security.js'

export async function executeReadUrl({ url }) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return { error: 'URL tidak valid. Harus diawali dengan http:// atau https://' }
  }

  // 🛡️ SECURITY CHECK: Blokir SSRF ke internal VPS
  const securityCheck = await validateSafeOutboundUrl(url)
  if (!securityCheck.safe) {
    return { error: `[Keamanan Jaringan]: ${securityCheck.reason}` }
  }
  const safeUrl = securityCheck.cleanUrl

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)

    // Redirect manual + validasi ulang tiap hop (audit Nov 2026: redirect
    // follow bebas bisa mendaratkan agent ke IP internal/metadata cloud).
    let currentUrl = safeUrl
    let res = null
    for (let hop = 0; hop <= 5; hop++) {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      })
      if (![301, 302, 303, 307, 308].includes(res.status)) break
      const location = res.headers.get('location')
      if (!location) break
      const nextUrl = new URL(location, currentUrl).toString()
      const hopCheck = await validateSafeOutboundUrl(nextUrl)
      if (!hopCheck.safe) {
        clearTimeout(timeout)
        return { error: `[Keamanan Jaringan]: Redirect diblokir — ${hopCheck.reason}` }
      }
      currentUrl = hopCheck.cleanUrl
      if (hop === 5) {
        clearTimeout(timeout)
        return { error: 'Gagal membaca halaman: terlalu banyak redirect.' }
      }
    }
    clearTimeout(timeout)

    if (!res.ok) {
      return { error: `Gagal mengakses URL (${res.status}): ${res.statusText}` }
    }

    const html = await res.text()

    // Ekstrak title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''

    // Bersihkan script, style, nav, footer
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s{2,}/g, ' ')
      .trim()

    const preview = cleaned.slice(0, 5000)
    const looksLikeJsShell = cleaned.length < 160 || /enable javascript|javascript is required|loading\.\.\./i.test(cleaned)

    return {
      url,
      title: title || 'Halaman Web',
      content: preview,
      length: preview.length,
      truncated: cleaned.length > 5000,
      extraction: 'static_html',
      browserFallback: looksLikeJsShell ? { required: true, reason: 'Konten statis kosong atau hanya shell JavaScript.' } : { required: false, reason: 'Konten HTML statis terbaca.' }
    }
  } catch (err) {
    return { error: `Gagal membaca halaman: ${err.message}` }
  }
}

export default {
  read_url: executeReadUrl
}
