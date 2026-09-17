import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'

// ============================================================================
// Database browser untuk dashboard admin.
// Semua tabel diakses lewat allowlist + query ter-parameter agar tidak bisa
// dipakai untuk SQL injection walau pemanggilnya endpoint admin.
// ============================================================================

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 200

// Kolom sensitif yang tidak boleh dikirim ke UI.
const REDACT_COLUMNS = /^(access_code|accesscode|session_token|sessiontoken|api_key|apikey|password|token|secret|hash)$/i

// Tabel tersembunyi (internal SQLite / vektor besar yang mahal dihitung).
const HIDDEN_TABLES = /^(sqlite_|.*_fts|.*_vec)/

function columnNames(db, table) {
  try { return db.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name) } catch { return [] }
}

function primaryKey(db, table) {
  try {
    const rows = db.prepare(`PRAGMA table_info("${table}")`).all()
    const pk = rows.find(row => Number(row.pk) > 0)
    return pk?.name || null
  } catch { return null }
}

export function listTables({ db, labels = {} }) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name)
  const tables = []
  for (const name of names) {
    if (HIDDEN_TABLES.test(name)) continue
    const columns = columnNames(db, name)
    let count = 0
    try { count = Number(db.prepare(`SELECT COUNT(*) AS value FROM "${name}"`).get()?.value || 0) } catch { continue }
    tables.push({
      name,
      label: labels[name] || name,
      count,
      columns: columns.length,
      primaryKey: primaryKey(db, name),
      searchable: columns.filter(col => !REDACT_COLUMNS.test(col)).slice(0, 8)
    })
  }
  tables.sort((a, b) => b.count - a.count)
  return tables
}

export function readTable({ db, table, page = 1, pageSize = DEFAULT_PAGE_SIZE, search = '', orderBy = null, order = 'desc', labels = {} }) {
  const available = listTables({ db, labels })
  const meta = available.find(item => item.name === table)
  if (!meta) throw new Error('Tabel tidak dikenal.')

  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE))
  const current = Math.max(1, Number(page) || 1)
  const offset = (current - 1) * size

  const columns = columnNames(db, table)
  const safeColumns = columns.map(col => ({ col, redact: REDACT_COLUMNS.test(col) }))

  // WHERE untuk pencarian teks di beberapa kolom aman
  const where = []
  const params = []
  const term = String(search || '').trim().slice(0, 120)
  if (term) {
    const searchable = columns.filter(col => !REDACT_COLUMNS.test(col))
    for (const col of searchable) { where.push(`CAST("${col}" AS TEXT) LIKE ?`); params.push(`%${term}%`) }
  }
  const whereSql = where.length ? `WHERE (${where.join(' OR ')})` : ''

  // ORDER BY hanya dari kolom nyata (cegah injection)
  const sortColumn = orderBy && columns.includes(orderBy) ? orderBy : (meta.primaryKey || columns[0])
  const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  const total = Number(db.prepare(`SELECT COUNT(*) AS value FROM "${table}" ${whereSql}`).get(...params)?.value || 0)
  const rows = db.prepare(`SELECT * FROM "${table}" ${whereSql} ORDER BY "${sortColumn}" ${sortDir} LIMIT ? OFFSET ?`).all(...params, size, offset)

  const safeRows = rows.map(row => {
    const out = {}
    for (const { col, redact } of safeColumns) {
      const value = row[col]
      if (redact) { out[col] = value ? '••••••' : value; continue }
      if (value === null || value === undefined) { out[col] = value; continue }
      if (typeof value === 'string' && value.length > 500) { out[col] = `${value.slice(0, 500)}…`; continue }
      out[col] = value
    }
    return out
  })

  const pageCount = Math.max(1, Math.ceil(total / size))
  return {
    table, label: meta.label, page: Math.min(current, pageCount), pageSize: size, pageCount, total,
    orderBy: sortColumn, order: sortDir.toLowerCase(),
    columns: safeColumns.filter(item => !item.redact).map(item => item.col),
    redactedColumns: safeColumns.filter(item => item.redact).map(item => item.col),
    rows: safeRows
  }
}

// ============================================================================
// File browser: menelusuri folder workspace per-user (read-only, sandboxed).
// ============================================================================

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv'])

export function resolveSafePath(root, relative = '') {
  const base = path.resolve(root)
  const input = String(relative || '')
  // Path absolut tidak pernah diizinkan — cegah /etc/passwd lolos.
  if (path.isAbsolute(input)) throw new Error('Path absolut tidak diizinkan.')
  // Tolak encoded traversal & segmen mencurigakan sebelum dinormalisasi.
  if (/%2e|%2f|%5c/i.test(input)) throw new Error('Path ter-encode tidak diizinkan.')
  const clean = input.replace(/\\/g, '/').replace(/^\/+/, '')
  const target = path.resolve(base, clean)
  // Cegah path traversal keluar dari root
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('Path di luar workspace tidak diizinkan.')
  return target
}

export function listDirectory({ root, relative = '' }) {
  const base = path.resolve(root)
  if (!existsSync(base)) return { path: '', absolute: base, exists: false, entries: [] }
  const target = resolveSafePath(base, relative)
  if (!existsSync(target)) throw new Error('Folder tidak ditemukan.')
  const stat = statSync(target)
  if (!stat.isDirectory()) throw new Error('Bukan sebuah folder.')

  const dirents = readdirSync(target, { withFileTypes: true })
  const entries = []
  for (const dirent of dirents) {
    if (SKIP_DIRS.has(dirent.name)) continue
    const full = path.join(target, dirent.name)
    let size = 0
    let mtime = null
    try { const info = statSync(full); size = info.size; mtime = info.mtime.toISOString() } catch { /* abaikan */ }
    entries.push({
      name: dirent.name,
      type: dirent.isDirectory() ? 'dir' : 'file',
      size,
      mtime
    })
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return { path: String(relative || ''), absolute: target, exists: true, entries }
}

export function readTextFile({ root, relative, maxBytes = 64 * 1024 }) {
  const target = resolveSafePath(root, relative)
  const stat = statSync(target)
  if (stat.isDirectory()) throw new Error('Ini sebuah folder.')
  if (stat.size > maxBytes) return { truncated: true, size: stat.size, content: readFileSync(target, 'utf8').slice(0, maxBytes) }
  return { truncated: false, size: stat.size, content: readFileSync(target, 'utf8') }
}

export function workspaceSummary({ root }) {
  const base = path.resolve(root)
  if (!existsSync(base)) return { root: base, exists: false, users: [] }
  const dirents = readdirSync(base, { withFileTypes: true })
  const users = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    const full = path.join(base, dirent.name)
    let files = 0
    let bytes = 0
    let mtime = null
    const walk = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(item.name)) continue
        const child = path.join(dir, item.name)
        try {
          const info = statSync(child)
          if (item.isDirectory()) walk(child)
          else { files += 1; bytes += info.size; if (!mtime || info.mtime > new Date(mtime)) mtime = info.mtime.toISOString() }
        } catch { /* abaikan */ }
      }
    }
    try { walk(full) } catch { /* abaikan */ }
    users.push({ name: dirent.name, files, bytes, mtime })
  }
  users.sort((a, b) => b.bytes - a.bytes)
  return { root: base, exists: true, users }
}
