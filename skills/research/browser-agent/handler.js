// skills/research/browser-agent/handler.js
import { browsePage, screenshotUrl, browserExtract, fetchPageFallback, isBrowserAvailable } from '../../../lib/browser.js'

export async function executeBrowsePage({ url, wait_for = 'networkidle2' }, context = {}) {
  if (!url) return { error: 'URL wajib diisi.' }

  // Jika browser tidak tersedia, fallback ke fetch biasa
  if (!isBrowserAvailable()) {
    console.info('[browser-agent] Chromium tidak tersedia, pakai fetch fallback.')
    return fetchPageFallback(url)
  }

  return browsePage({ url, waitFor: wait_for, userId: context.userId })
}

export async function executeScreenshotUrl({ url, full_page = false }, context = {}) {
  if (!url) return { error: 'URL wajib diisi.' }

  if (!isBrowserAvailable()) {
    return { error: 'Browser tidak tersedia di sistem ini. Tidak bisa mengambil screenshot.' }
  }

  return screenshotUrl({ url, fullPage: full_page, userId: context.userId })
}

export async function executeBrowserExtract({ url, selector, attribute = 'text' }, context = {}) {
  if (!url) return { error: 'URL wajib diisi.' }
  if (!selector) return { error: 'CSS selector wajib diisi.' }

  if (!isBrowserAvailable()) {
    return { error: 'Browser tidak tersedia di sistem ini.' }
  }

  return browserExtract({ url, selector, attribute, userId: context.userId })
}

export default {
  browse_page: executeBrowsePage,
  screenshot_url: executeScreenshotUrl,
  browser_extract: executeBrowserExtract
}
