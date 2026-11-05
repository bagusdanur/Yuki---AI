import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'

const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
); CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);`)

const publicKey = String(process.env.VAPID_PUBLIC_KEY || '')
const privateKey = String(process.env.VAPID_PRIVATE_KEY || '')
const subject = String(process.env.VAPID_SUBJECT || 'mailto:admin@ryukomik.web.id')
const configured = Boolean(publicKey && privateKey)
if (configured) webpush.setVapidDetails(subject, publicKey, privateKey)

export function getPushConfig() { return { enabled: configured, publicKey: configured ? publicKey : '' } }

// Host push service resmi — endpoint lain ditolak.
// Ini mencegah server dipakai buat POST ke URL arbitrer (SSRF-ish) lewat
// subscription jahat, dan membatasi abuse endpoint pihak ketiga.
const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^updates\.push\.services\.mozilla\.net$/,
  /^push\.services\.mozilla\.com$/,
  /(?:^|\.)windows\.com$/,
  /(?:^|\.)windows\.net$/,
  /(?:^|\.)notify\.windows\.com$/,
  /(?:^|\.)webpush\.apple\.com$/,
  /(?:^|\.)push\.apple\.com$/,
  /(?:^|\.)web\.push\.apple\.com$/,
  /(?:^|\.)webpush\.us\.east1\.gcp\.cert\.google\.com$/,
  /(?:^|\.)webpush\.googleusercontent\.com$/,
  /(?:^|\.)wns2-[a-z0-9]+\.notify\.windows\.com$/,
  /(?:^|\.)wns2-[a-z0-9]+\.notify\.windows\.net$/,
]

// Log endpoint tanpa membocorkan token push-nya (endpoint = kredensial).
function maskEndpoint(endpoint) {
  try {
    const u = new URL(endpoint)
    return `${u.origin}${u.pathname.slice(0, 24)}…`
  } catch { return '[invalid]' }
}

function isValidBase64Url(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && s.length >= 20
}

function validateSubscription(subscription) {
  const endpoint = String(subscription?.endpoint || '')
  const p256dh = String(subscription?.keys?.p256dh || '')
  const auth = String(subscription?.keys?.auth || '')
  let url
  try { url = new URL(endpoint) } catch { throw new Error('SUBSCRIPTION_INVALID') }
  // Harus HTTPS, tanpa userinfo/credential di URL.
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('SUBSCRIPTION_INVALID')
  // Host harus host push service resmi.
  if (!ALLOWED_PUSH_HOSTS.some((re) => re.test(url.hostname.toLowerCase()))) throw new Error('SUBSCRIPTION_HOST_NOT_ALLOWED')
  // p256dh = kunci EC uncompressed point (65 byte, diawali 0x04).
  if (!isValidBase64Url(p256dh) || !isValidBase64Url(auth)) throw new Error('SUBSCRIPTION_INVALID')
  try {
    const point = Buffer.from(p256dh, 'base64url')
    if (point.length !== 65 || point[0] !== 0x04) throw new Error('SUBSCRIPTION_INVALID')
    const authBuf = Buffer.from(auth, 'base64url')
    if (authBuf.length < 12) throw new Error('SUBSCRIPTION_INVALID')
  } catch (e) {
    if (e.message === 'SUBSCRIPTION_INVALID') throw e
    throw new Error('SUBSCRIPTION_INVALID')
  }
  const expirationTime = subscription.expirationTime ?? null
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0 || expirationTime > Date.now() + 400 * 24 * 3600_000)) {
    throw new Error('SUBSCRIPTION_INVALID')
  }
  return { endpoint, expirationTime, keys: { p256dh, auth } }
}

export function savePushSubscription(userId, subscription) {
  const uid = String(userId)
  const normalized = validateSubscription(subscription)
  const endpoint = normalized.endpoint
  // ANTI-HIJACK: endpoint yang sudah terdaftar ke user LAIN tidak boleh
  // direassign silenciously. Dulu ON CONFLICT mengoper user_id-nya — siapa pun
  // yang tahu endpoint korban bisa membajak notifikasinya.
  const existing = db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(endpoint)
  if (existing && existing.user_id !== uid) {
    console.warn(`[push] hijack ditolak: endpoint ${maskEndpoint(endpoint)} milik user lain, dicoba didaftarkan ulang`)
    const err = new Error('SUBSCRIPTION_OWNED_BY_OTHER_USER')
    err.code = 'SUBSCRIPTION_OWNED_BY_OTHER_USER'
    throw err
  }
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, subscription_json, failure_count)
    VALUES (?, ?, ?, 0) ON CONFLICT(endpoint) DO UPDATE SET
    subscription_json = excluded.subscription_json, failure_count = 0`).run(endpoint, uid, JSON.stringify(normalized))
  console.info(`[push] subscription disimpan user=${uid} endpoint=${maskEndpoint(endpoint)}`)
  return { success: true }
}

export function removePushSubscription(userId, endpoint) {
  const info = db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(String(userId), String(endpoint || ''))
  console.info(`[push] subscription dihapus user=${String(userId)} endpoint=${maskEndpoint(String(endpoint || ''))} rows=${info.changes}`)
  return { success: true }
}

export async function sendPushToUser(userId, payload) {
  if (!configured) return { enabled: false, sent: 0, failed: 0 }
  const rows = db.prepare('SELECT endpoint, subscription_json, failure_count FROM push_subscriptions WHERE user_id = ?').all(String(userId))
  let sent = 0; let failed = 0
  for (const row of rows) {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription_json), JSON.stringify(payload), { TTL: 3600, urgency: 'high' })
      db.prepare('UPDATE push_subscriptions SET last_success_at = datetime(\'now\'), failure_count = 0 WHERE endpoint = ?').run(row.endpoint)
      sent += 1
    } catch (error) {
      failed += 1
      const gone = error?.statusCode === 404 || error?.statusCode === 410
      if (gone || Number(row.failure_count) >= 4) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint)
      else db.prepare('UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE endpoint = ?').run(row.endpoint)
    }
  }
  return { enabled: true, sent, failed }
}

export function deletePushSubscriptions(userId) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(String(userId))
}
