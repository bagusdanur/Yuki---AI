import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Blocklist IP persisten — survive restart, dikelola admin + auto-block abuse.
const FILE = process.env.MEMORY_DB || './data/yuki.db'
mkdirSync(path.dirname(FILE), { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`CREATE TABLE IF NOT EXISTS ip_blocks (
  ip TEXT PRIMARY KEY,
  blocked_until INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
); CREATE INDEX IF NOT EXISTS idx_ip_blocks_until ON ip_blocks(blocked_until);`)

function cleanIp(ip) {
  let s = String(ip || '').trim().slice(0, 64).toLowerCase()
  // Node melaporkan IPv4-mapped IPv6 sebagai ::ffff:1.2.3.4 — samakan formatnya.
  if (s.startsWith('::ffff:')) s = s.slice(7)
  return s
}

export function isIpBlocked(ip) {
  const key = cleanIp(ip)
  if (!key) return false
  const row = db.prepare('SELECT blocked_until FROM ip_blocks WHERE ip = ?').get(key)
  if (!row) return false
  if (Number(row.blocked_until) <= Date.now()) {
    db.prepare('DELETE FROM ip_blocks WHERE ip = ?').run(key) // expired, bersihkan
    return false
  }
  return true
}

export function blockIp(ip, hours = 1, reason = 'abuse') {
  const key = cleanIp(ip)
  if (!key) return null
  const h = Math.min(24 * 30, Math.max(0.1, Number(hours) || 1))
  const until = Date.now() + h * 3600_000
  db.prepare('INSERT OR REPLACE INTO ip_blocks (ip, blocked_until, reason) VALUES (?, ?, ?)').run(key, until, String(reason || '').slice(0, 120))
  console.warn(`[security] IP diblokir ${h} jam: ${key} (${reason})`)
  return { ip: key, blockedUntil: until }
}

export function unblockIp(ip) {
  const info = db.prepare('DELETE FROM ip_blocks WHERE ip = ?').run(cleanIp(ip))
  return { removed: info.changes > 0 }
}

export function listBlockedIps() {
  db.prepare('DELETE FROM ip_blocks WHERE blocked_until <= ?').run(Date.now())
  return db.prepare('SELECT ip, blocked_until, reason, created_at FROM ip_blocks ORDER BY blocked_until DESC').all()
    .map((r) => ({ ip: r.ip, blockedUntil: r.blocked_until, reason: r.reason, createdAt: r.created_at }))
}
