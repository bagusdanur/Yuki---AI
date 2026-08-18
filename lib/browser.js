// lib/browser.js — Yuki Agent Browser Automation Engine
// Pakai puppeteer-core + system Chromium (atau fallback ke fetch+jsdom)

import { existsSync } from 'node:fs'

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
  return null
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
        '--window-size=1280,900',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
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

// ===== TOOL: browse_page =====
export async function browsePage({ url, waitFor = 'networkidle2', timeout = 25000 } = {}) {
  if (!url || !url.startsWith('http')) {
    return { error: 'URL tidak valid. Harus dimulai dengan http:// atau https://' }
  }

  // Blokir akses ke localhost/internal
  const blocked = /^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i
  if (blocked.test(url)) return { error: 'Akses ke jaringan internal tidak diizinkan.' }

  const started = Date.now()
  let page = null

  try {
    const browser = await initBrowser()
    page = await browser.newPage()

    // Block resource berat yang tidak diperlukan (gambar, font, media)
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const type = req.resourceType()
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        req.abort()
      } else {
        req.continue()
      }
    })

    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.goto(url, { waitUntil: waitFor, timeout })

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
      url,
      title,
      text,
      links,
      durationMs: Date.now() - started
    }
  } catch (err) {
    return { error: `Gagal membuka halaman: ${err.message}`, url, durationMs: Date.now() - started }
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

// ===== TOOL: screenshot_url =====
export async function screenshotUrl({ url, fullPage = false, timeout = 20000 } = {}) {
  if (!url?.startsWith('http')) return { error: 'URL tidak valid.' }

  const blocked = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/i
  if (blocked.test(url)) return { error: 'Akses ke jaringan internal tidak diizinkan.' }

  let page = null
  try {
    const browser = await initBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
    await page.goto(url, { waitUntil: 'networkidle2', timeout })

    const screenshotBuffer = await page.screenshot({ fullPage, type: 'jpeg', quality: 80 })
    const base64 = screenshotBuffer.toString('base64')

    return {
      url,
      format: 'jpeg',
      base64,
      dataUrl: `data:image/jpeg;base64,${base64}`,
      message: `Screenshot ${url} berhasil diambil.`
    }
  } catch (err) {
    return { error: `Gagal screenshot: ${err.message}` }
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

// ===== TOOL: browser_extract =====
export async function browserExtract({ url, selector, attribute = 'text', timeout = 20000 } = {}) {
  if (!url?.startsWith('http')) return { error: 'URL tidak valid.' }

  let page = null
  try {
    const browser = await initBrowser()
    page = await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

    const results = await page.evaluate((sel, attr) => {
      const elements = Array.from(document.querySelectorAll(sel))
      return elements.slice(0, 20).map(el => {
        if (attr === 'text') return el.innerText?.trim() || el.textContent?.trim()
        if (attr === 'href') return el.getAttribute('href')
        if (attr === 'src') return el.getAttribute('src')
        return el.getAttribute(attr)
      }).filter(Boolean)
    }, selector, attribute)

    return { url, selector, attribute, results, count: results.length }
  } catch (err) {
    return { error: `Gagal extract: ${err.message}` }
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

// ===== FALLBACK: Fetch biasa (tanpa browser) =====
export async function fetchPageFallback(url, timeout = 15000) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const res = await fetch(url, {
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
    return { url, title: titleMatch?.[1]?.trim() || '', text, fallback: true }
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
