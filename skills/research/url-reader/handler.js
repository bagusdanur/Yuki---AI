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

    // Ekstrak HTTP response headers publik yang relevan untuk analisis tech stack
    const SAFE_HEADER_KEYS = [
      'server', 'x-powered-by', 'cf-ray', 'cf-cache-status', 'x-sveltekit-page',
      'x-nextjs-cache', 'x-vercel-id', 'x-vercel-cache', 'x-nuxt-version',
      'x-litespeed-cache', 'x-generator', 'via', 'x-cache', 'content-type'
    ]
    const headers = {}
    for (const key of SAFE_HEADER_KEYS) {
      const val = res.headers.get(key)
      if (val) headers[key] = val.slice(0, 120)
    }

    // Ekstrak title & meta generator
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''
    const genMatch = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i)
    const generator = genMatch ? genMatch[1].trim() : null

    // Ekstrak daftar script & stylesheet/asset
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 10)
    const stylesheets = [...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)]
      .map(m => m[1])
      .filter(h => /\.(css|js|png|ico|svg|webmanifest)|fonts\.googleapis|cdn/i.test(h))
      .slice(0, 12)

    // Deteksi sinyal tech stack terstruktur dari headers + HTML mentah
    const techStack = []
    const pushTech = (name, evidence) => { if (!techStack.some(t => t.name === name)) techStack.push({ name, evidence }) }

    if (headers['x-sveltekit-page'] || /_app\/immutable\/|__sveltekit/i.test(html)) pushTech('SvelteKit (SSR/Vite)', headers['x-sveltekit-page'] ? 'header x-sveltekit-page + _app/immutable' : '_app/immutable / __sveltekit')
    if (/__NEXT_DATA__|\/_next\/static|__next_f/i.test(html) || headers['x-nextjs-cache']) pushTech('Next.js (React)', /__next_f/i.test(html) ? 'App Router (__next_f / _next/static)' : '_next/static / __NEXT_DATA__')
    if (/__NUXT__|\/_nuxt\//i.test(html) || headers['x-nuxt-version']) pushTech('Nuxt (Vue)', '_nuxt / __NUXT__')
    if (/astro-island|\/_astro\//i.test(html)) pushTech('Astro', 'astro-island / _astro')
    if (/wp-content|wp-includes/i.test(html)) pushTech('WordPress', 'wp-content / wp-includes')
    if (/madara|wp-manga/i.test(html)) pushTech('Madara (WP Manga Theme)', 'madara / wp-manga')
    if (/themesia|mangastream|ts-main/i.test(html)) pushTech('Themesia / MangaStream', 'themesia / mangastream')
    if (/laravel|csrf-token/i.test(html) && /livewire|inertia/i.test(html)) pushTech('Laravel', 'livewire / inertia')
    if (generator) pushTech(`Generator: ${generator}`, 'meta generator')

    if (/cloudflare/i.test(headers.server || '') || headers['cf-ray']) pushTech('Cloudflare CDN/Proxy', `server: ${headers.server || 'cloudflare'}, cf-ray: ${headers['cf-ray'] || 'present'}`)
    else if (headers.server) pushTech(`Web Server: ${headers.server}`, 'HTTP server header')
    if (headers['x-vercel-id']) pushTech('Vercel Hosting', 'x-vercel-id header')
    if (headers['x-powered-by']) pushTech(`Runtime/Backend: ${headers['x-powered-by']}`, 'x-powered-by header')

    if (/--tw-|tailwindcss/i.test(html)) pushTech('Tailwind CSS', 'tailwind utilities / --tw-')
    if (/bootstrap(\.min)?\.(css|js)/i.test(html)) pushTech('Bootstrap', 'bootstrap asset')
    if (/jquery(\.min)?\.js/i.test(html)) pushTech('jQuery', 'jquery script')

    const gfonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^"'&]+)/gi)]
      .map(m => decodeURIComponent(m[1]).replace(/\+/g, ' ').split(':')[0])
    if (gfonts.length) pushTech('Google Fonts', [...new Set(gfonts)].slice(0, 5).join(', '))
    if (/Material\+Symbols|Material\+Icons/i.test(html)) pushTech('Google Material Symbols/Icons', 'fonts.googleapis Material Symbols')
    if (/font-awesome|fontawesome/i.test(html)) pushTech('Font Awesome', 'fontawesome asset')
    if (/rel=["']manifest["']/i.test(html)) pushTech('PWA Web Manifest', 'link rel=manifest')

    const externalTrackers = scripts.filter(s => /^https?:\/\//i.test(s) && /stats|analytics|gtag|googletagmanager|umami|plausible|matomo|clarity|cloudflareinsights/i.test(s))
    if (externalTrackers.length) pushTech('Analytics / Tracker', externalTrackers.slice(0, 3).join(', '))
    const apiHints = [...new Set([...html.matchAll(/["'](\/api\/[a-z0-9_/-]{2,40})["']/gi)].map(m => m[1]))].slice(0, 5)
    if (apiHints.length) pushTech('Internal API Endpoints', apiHints.join(', '))

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

    const preview = cleaned.slice(0, 3500)
    const looksLikeJsShell = cleaned.length < 160 || /enable javascript|javascript is required|loading\.\.\./i.test(cleaned)

    return {
      url,
      finalUrl: currentUrl,
      status: res.status,
      title: title || 'Halaman Web',
      headers,
      techStack,
      scripts,
      stylesheets,
      content: preview,
      length: preview.length,
      truncated: cleaned.length > 3500,
      extraction: 'static_html_with_tech_signals',
      browserFallback: looksLikeJsShell ? { required: true, reason: 'Konten statis kosong atau hanya shell JavaScript.' } : { required: false, reason: 'Konten HTML statis & sinyal teknologi terbaca.' }
    }
  } catch (err) {
    return { error: `Gagal membaca halaman: ${err.message}` }
  }
}

export default {
  read_url: executeReadUrl
}
