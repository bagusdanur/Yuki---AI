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

export function savePushSubscription(userId, subscription) {
  const endpoint = String(subscription?.endpoint || '')
  const p256dh = String(subscription?.keys?.p256dh || '')
  const auth = String(subscription?.keys?.auth || '')
  if (!endpoint.startsWith('https://') || !p256dh || !auth) throw new Error('SUBSCRIPTION_INVALID')
  const normalized = { endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh, auth } }
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, subscription_json, failure_count)
    VALUES (?, ?, ?, 0) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
    subscription_json = excluded.subscription_json, failure_count = 0`).run(endpoint, String(userId), JSON.stringify(normalized))
  return { success: true }
}

export function removePushSubscription(userId, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(String(userId), String(endpoint || ''))
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
