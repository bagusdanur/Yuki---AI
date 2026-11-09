import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { validateSafeOutboundUrl } from './security.js'

// Audit Nov 2026 (4.4): profil browser PERSISTEN per-user — cookie jar per
// user disimpan di data/browser-profiles/<userId>/cookies.json (mode 0600,
// dir 0700), dimuat ke context terisolasi tiap panggilan, lalu disimpan lagi.
// Ini pengganti profil bersama (kebocoran antar-user) sekaligus fitur: sesi
// login situs yang dibuka user tetap ada untuk tugas berikutnya. Prune ringan
// menghapus profil tak dipakai >90 hari.
const PROFILE_BASE = process.env.BROWSER_PROFILE_DIR || path.join(process.cwd(), 'data', 'browser-profiles')
const MAX_COOKIE_JSON_BYTES = 256 * 1024
const MAX_COOKIE_COUNT = 500
const PROFILE_TTL_MS = 90 * 24 * 3600 * 1000
let lastProfilePrune = 0

function safeProfileDir(userId) {
  if (typeof userId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) return null
  return path.join(PROFILE_BASE, userId)
}

async function loadUserCookies(userId) {
  const dir = safeProfileDir(userId)
  if (!dir) return []
  try {
    const list = JSON.parse(await readFile(path.join(dir, 'cookies.json'), 'utf8'))
    if (!Array.isArray(list)) return []
    return list
      .filter(c => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
      .slice(0, MAX_COOKIE_COUNT)
  } catch { return [] }
}

async function saveUserCookies(userId, cookies) {
  const dir = safeProfileDir(userId)
  if (!dir || !Array.isArray(cookies)) return
  try {
    const clean = cookies
      .filter(c => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
      .slice(0, MAX_COOKIE_COUNT)
    const json = JSON.stringify(clean)
    if (json.length > MAX_COOKIE_JSON_BYTES) return
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(path.join(dir, 'cookies.json'), json, { mode: 0o600 })
    await pruneStaleProfiles().catch(() => {})
  } catch {}
}

async function pruneStaleProfiles() {
  const now = Date.now()
  if (now - lastProfilePrune < 3600_000) return
  lastProfilePrune = now
  let entries = []
  try { entries = await readdir(PROFILE_BASE, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(PROFILE_BASE, e.name)
    const st = await stat(dir).catch(() => null)
    if (st && now - st.mtimeMs > PROFILE_TTL_MS) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

let puppeteer = null
let browserInstance = null
let browserInitError = null

// Temukan path Chromium yang tersedia di sistem
function findChromiumPath() {
  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/lib/chromium/chromium',
    '/usr/lib/chromium-browser/chromium-browser',
    process.env.CHROMIUM_PATH
  ].filter(Boolean)

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  // Cache browser agent-browser (Hermes) — Chromium yang tersedia di VPS ini.
  try {
    const base = path.join(homedir(), '.agent-browser', 'browsers')
    const dirs = readdirSync(base).filter(d => d.startsWith('chrome-')).sort().reverse()
    for (const d of dirs) {
      const bin = path.join(base, d, 'chrome')
      if (existsSync(bin)) return bin
    }
  } catch {}
  return null
}

// Request interception: setiap request http(s) di halaman (termasuk target
// redirect & subresource) divalidasi ulang — redirect ke IP internal diblokir
// SEBELUM fetch (audit Nov 2026). DNS-rebinding TOCTOU tetap residu terdokumentasi.
async function guardPageRequests(page) {
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    try {
      const u = req.url()
      if (u.startsWith('http://') || u.startsWith('https://')) {
        const check = await validateSafeOutboundUrl(u)
        if (!check.safe) { await req.abort().catch(() => {}); return }
      }
      await req.continue().catch(() => {})
    } catch { try { await req.continue() } catch {} }
  })
}

// Inisialisasi Puppeteer — lazy, hanya saat pertama kali dipakai
async function initBrowser() {
  if (browserInstance) return browserInstance
  if (browserInitError) throw browserInitError

  try {
    // Dynamic import agar tidak crash jika puppeteer-core tidak terinstall
    const mod = await import('puppeteer-core').catch(() => null)
    if (!mod) throw new Error('puppeteer-core tidak terinstall. Jalankan: npm install puppeteer-core')
    puppeteer = mod.default || mod

    const executablePath = findChromiumPath()
    if (!executablePath) {
      throw new Error('Chromium tidak ditemukan di sistem. Install: apt-get install -y chromium-browser')
    }

    console.info(`[browser] Launching Chromium: ${executablePath}`)
    browserInstance = await puppeteer.launch({
      executablePath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,900'
        // Audit Nov 2026: --disable-web-security + IsolateOrigins dimatikan —
        // keduanya membuat halaman bisa membaca respons lintas-origin (XSS /
        // pencurian data). Isolasi antar-user dicapai lewat BrowserContext
        // terpisah per panggilan (lihat newIsolatedPage).
      ]
    })

    // Auto-restart jika browser crash
    browserInstance.on('disconnected', () => {
      console.warn('[browser] Browser disconnected — akan diinisialisasi ulang saat request berikutnya.')
      browserInstance = null
    })

    return browserInstance
  } catch (err) {
    browserInitError = err
    console.error('[browser] Gagal menginisialisasi browser:', err.message)
    throw err
  }
}

// Context terisolasi per panggilan: cookie/storage/cache TIDAK berbagi antar
// user maupun antar tugas (audit Nov 2026: dulu semua page memakai context
// default yang sama → cookie user A bisa terbawa ke sesi user B).
// Cookie jar user dimuat dari profil persisten (4.4) lalu disimpan lagi saat
// pemanggil memanggil saveCookies() sebelum context.close().
async function newIsolatedPage(browser, userId) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const saved = await loadUserCookies(userId)
  if (saved.length) await page.setCookie(...saved).catch(() => {})
  const saveCookies = async () => {
    const cookies = await context.cookies().catch(() => [])
    await saveUserCookies(userId, cookies)
  }
  return { page, context, saveCookies }
}

// ===== TOOL: browse_page =====
export async function browsePage({ url, waitFor = 'networkidle2', timeout = 25000, userId } = {}) {
  const securityCheck = await validateSafeOutboundUrl(url)
  if (!securityCheck.safe) {
    return { error: `[Keamanan Jaringan]: ${securityCheck.reason}` }
  }
  const targetUrl = securityCheck.cleanUrl

  const started = Date.now()
  let page = null
  let context = null
  let saveCookies = null

  try {
    const browser = await initBrowser()
    ;({ page, context, saveCookies } = await newIsolatedPage(browser, userId))

    // Block resource berat yang tidak diperlukan (gambar, font, media) +
    // validasi SSRF tiap request (redirect ke internal diblokir sebelum fetch).
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      const type = req.resourceType()
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        req.abort()
        return
      }
      const u = req.url()
      if (u.startsWith('http://') || u.startsWith('https://')) {
        const check = await validateSafeOutboundUrl(u)
        if (!check.safe) { req.abort(); return }
      }
      req.continue()
    })

    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.goto(targetUrl, { waitUntil: waitFor, timeout })

    const title = await page.title()
    const text = await page.evaluate(() => {
      // Hapus elemen yang tidak relevan
      const remove = document.querySelectorAll('script, style, nav, footer, header, aside, .ad, [class*="cookie"], [id*="cookie"]')
      remove.forEach(el => el.remove())

      // Ambil teks bersih
      const body = document.body
      return body ? body.innerText.replace(/\s{3,}/g, '\n\n').trim().slice(0, 6000) : ''
    })

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
        .filter(l => l.href.startsWith('http') && l.text.length > 2)
        .slice(0, 15)
    )

    return {
      url: targetUrl,
      title,
      text,
      links,
      durationMs: Date.now() - started
    }
  } catch (err) {
    return { error: `Gagal membuka halaman: ${err.message}`, url: targetUrl, durationMs: Date.now() - started }
  } finally {
    if (saveCookies) await saveCookies().catch(() => {})
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
  }
}

// ===== TOOL: screenshot_url =====
export async function screenshotUrl({ url, fullPage = false, timeout = 20000, userId } = {}) {
  const securityCheck = await validateSafeOutboundUrl(url)
  if (!securityCheck.safe) {
    return { error: `[Keamanan Jaringan]: ${securityCheck.reason}` }
  }
  const targetUrl = securityCheck.cleanUrl

  let page = null
  let context = null
  let saveCookies = null
  try {
    const browser = await initBrowser()
    ;({ page, context, saveCookies } = await newIsolatedPage(browser, userId))
    await guardPageRequests(page)
    await page.setViewport({ width: 1280, height: 900 })
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout })

    const screenshotBuffer = await page.screenshot({ fullPage, type: 'jpeg', quality: 80 })
    const base64 = screenshotBuffer.toString('base64')

    return {
      url: targetUrl,
      format: 'jpeg',
      base64,
      dataUrl: `data:image/jpeg;base64,${base64}`,
      message: `Screenshot ${targetUrl} berhasil diambil.`
    }
  } catch (err) {
    return { error: `Gagal screenshot: ${err.message}` }
  } finally {
    if (saveCookies) await saveCookies().catch(() => {})
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
  }
}

// ===== TOOL: browser_extract =====
export async function browserExtract({ url, selector, attribute = 'text', timeout = 20000, userId } = {}) {
  const securityCheck = await validateSafeOutboundUrl(url)
  if (!securityCheck.safe) {
    return { error: `[Keamanan Jaringan]: ${securityCheck.reason}` }
  }
  const targetUrl = securityCheck.cleanUrl

  let page = null
  let context = null
  let saveCookies = null
  try {
    const browser = await initBrowser()
    ;({ page, context, saveCookies } = await newIsolatedPage(browser, userId))
    await guardPageRequests(page)
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout })

    const results = await page.evaluate((sel, attr) => {
      const elements = Array.from(document.querySelectorAll(sel))
      return elements.slice(0, 20).map(el => {
        if (attr === 'text') return el.innerText?.trim() || el.textContent?.trim()
        if (attr === 'href') return el.getAttribute('href')
        if (attr === 'src') return el.getAttribute('src')
        return el.getAttribute(attr)
      }).filter(Boolean)
    }, selector, attribute)

    return { url: targetUrl, selector, attribute, results, count: results.length }
  } catch (err) {
    return { error: `Gagal extract: ${err.message}` }
  } finally {
    if (saveCookies) await saveCookies().catch(() => {})
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
  }
}

// ===== FALLBACK: Fetch biasa (tanpa browser) =====
export async function fetchPageFallback(url, timeout = 15000) {
  const securityCheck = await validateSafeOutboundUrl(url)
  if (!securityCheck.safe) {
    return { error: `[Keamanan Jaringan]: ${securityCheck.reason}` }
  }
  const targetUrl = securityCheck.cleanUrl

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 Yuki-Agent/1.0' }
    })
    clearTimeout(timer)
    const html = await res.text()

    // Simple HTML-to-text stripping
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{3,}/g, '\n')
      .trim()
      .slice(0, 5000)

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    return { url: targetUrl, title: titleMatch?.[1]?.trim() || '', text, fallback: true }
  } catch (err) {
    return { error: `Fetch fallback gagal: ${err.message}` }
  }
}

// Shutdown graceful
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {})
    browserInstance = null
    console.info('[browser] Browser ditutup.')
  }
}

export function isBrowserAvailable() {
  return !!findChromiumPath()
}
