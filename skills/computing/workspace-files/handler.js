import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(process.env.YUKI_AGENT_WORKSPACE || 'agent-workspace')
const MAX_BYTES = 512 * 1024
const BLOCKED_NAMES = new Set([
  '.env', '.git', '.ssh', '.runtime-secrets', 'node_modules', 'data', 'backups',
  'id_rsa', 'id_ed25519', 'authorized_keys', 'known_hosts'
])
const BLOCKED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db'])
const HISTORY_ROOT = path.join(ROOT, '.yuki-history')

const userSegment = (value) => String(value || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'anonymous'
const digest = (content) => crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)

function assertAllowed(relative) {
  for (const part of relative.split(path.sep).filter(Boolean)) {
    const lower = part.toLowerCase()
    if (BLOCKED_NAMES.has(lower) || lower.startsWith('.env.')) throw new Error(`Path terlarang: ${part}`)
  }
  if (BLOCKED_EXTENSIONS.has(path.extname(relative).toLowerCase())) throw new Error('File rahasia/database ditolak.')
}

function ensureNoSymlink(root, target, allowMissing = false) {
  let current = root
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (!fs.existsSync(current)) {
      if (allowMissing) return
      throw new Error('File atau folder tidak ditemukan.')
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink tidak diizinkan.')
  }
}

function resolveTarget(input = '.', context = {}, allowMissing = false) {
  const userRoot = path.join(ROOT, userSegment(context.userId))
  fs.mkdirSync(userRoot, { recursive: true, mode: 0o700 })
  const raw = String(input || '.').replaceAll('\\', '/')
  if (raw.includes('\0') || path.isAbsolute(raw)) throw new Error('Path absolut ditolak.')
  const target = path.resolve(userRoot, raw)
  const relative = path.relative(userRoot, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path di luar workspace ditolak.')
  assertAllowed(relative)
  ensureNoSymlink(userRoot, target, allowMissing)
  return { userRoot, target, relative: relative || '.' }
}

function readText(target) {
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error('Target bukan file.')
  if (stat.size > MAX_BYTES) throw new Error('File terlalu besar.')
  const content = fs.readFileSync(target, 'utf8')
  if (content.includes('\0')) throw new Error('File biner tidak didukung.')
  return content
}

function atomicWrite(userRoot, target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  ensureNoSymlink(userRoot, path.dirname(target))
  const temporary = `${target}.yuki-${crypto.randomBytes(5).toString('hex')}.tmp`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  fs.renameSync(temporary, target)
}

function saveSnapshot(context, relative, content, action = 'edit') {
  const directory = path.join(HISTORY_ROOT, userSegment(context.userId))
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const record = {
    id: `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    path: relative.replaceAll('\\', '/'), action, hash: digest(content), content, createdAt: new Date().toISOString()
  }
  fs.writeFileSync(path.join(directory, `${record.id}.json`), JSON.stringify(record), { mode: 0o600 })
  const entries = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse()
  for (const stale of entries.slice(30)) fs.unlinkSync(path.join(directory, stale))
  return record.id
}

function snapshots(context, relative = '') {
  const directory = path.join(HISTORY_ROOT, userSegment(context.userId))
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse().map(name => {
    try { return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) } catch { return null }
  }).filter(record => record && (!relative || record.path === relative.replaceAll('\\', '/')))
}

function compactDiff(before, after, maxLines = 160) {
  const left = before.split(/\r?\n/)
  const right = after.split(/\r?\n/)
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let leftEnd = left.length - 1
  let rightEnd = right.length - 1
  while (leftEnd >= start && rightEnd >= start && left[leftEnd] === right[rightEnd]) { leftEnd -= 1; rightEnd -= 1 }
  const contextStart = Math.max(0, start - 3)
  const output = [`@@ line ${contextStart + 1} @@`]
  for (let index = contextStart; index < start; index += 1) output.push(`  ${left[index]}`)
  for (let index = start; index <= leftEnd; index += 1) output.push(`- ${left[index]}`)
  for (let index = start; index <= rightEnd; index += 1) output.push(`+ ${right[index]}`)
  const suffixEnd = Math.min(right.length, rightEnd + 4)
  for (let index = rightEnd + 1; index < suffixEnd; index += 1) output.push(`  ${right[index]}`)
  return output.slice(0, maxLines).join('\n') + (output.length > maxLines ? '\n... [diff dipadatkan]' : '')
}

export async function list_workspace_files({ path: input = '.', depth = 3 } = {}, context = {}) {
  try {
    const { userRoot, target, relative } = resolveTarget(input, context)
    const files = []
    const maxDepth = Math.max(1, Math.min(5, Number(depth) || 3))
    function visit(current, level) {
      if (level > maxDepth || files.length >= 200) return
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (files.length >= 200 || entry.isSymbolicLink()) continue
        const full = path.join(current, entry.name)
        const rel = path.relative(userRoot, full)
        try { assertAllowed(rel) } catch { continue }
        if (entry.isDirectory()) {
          files.push({ path: `${rel.replaceAll('\\', '/')}/`, type: 'directory' })
          visit(full, level + 1)
        } else if (entry.isFile()) files.push({ path: rel.replaceAll('\\', '/'), type: 'file', size: fs.statSync(full).size })
      }
    }
    if (fs.statSync(target).isDirectory()) visit(target, 1)
    else files.push({ path: relative.replaceAll('\\', '/'), type: 'file', size: fs.statSync(target).size })
    return { success: true, root: '.', files, truncated: files.length >= 200 }
  } catch (error) { return { success: false, error: error.message } }
}

export async function read_workspace_file({ path: input, start_line = 1, end_line = 240 } = {}, context = {}) {
  try {
    if (!input) throw new Error('Parameter path wajib diisi.')
    const { target, relative } = resolveTarget(input, context)
    const content = readText(target)
    const lines = content.split(/\r?\n/)
    const start = Math.max(1, Number(start_line) || 1)
    const end = Math.min(lines.length, Math.max(start, Number(end_line) || start + 239), start + 399)
    return { success: true, path: relative.replaceAll('\\', '/'), hash: digest(content), total_lines: lines.length,
      start_line: start, end_line: end,
      content: lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n') }
  } catch (error) { return { success: false, error: error.message } }
}

export async function search_workspace_code({ query, path: input = '.', max_results = 50 } = {}, context = {}) {
  try {
    if (!query || String(query).length > 200) throw new Error('Query wajib diisi dan maksimal 200 karakter.')
    const { userRoot, target } = resolveTarget(input, context)
    const needle = String(query).toLowerCase()
    const limit = Math.max(1, Math.min(100, Number(max_results) || 50))
    const results = []
    function inspect(file) {
      if (results.length >= limit || fs.statSync(file).size > MAX_BYTES) return
      let content
      try { content = readText(file) } catch { return }
      const rel = path.relative(userRoot, file).replaceAll('\\', '/')
      content.split(/\r?\n/).forEach((line, index) => {
        if (results.length < limit && line.toLowerCase().includes(needle)) results.push({ path: rel, line: index + 1, text: line.slice(0, 500) })
      })
    }
    function visit(current) {
      const stat = fs.statSync(current)
      if (stat.isFile()) return inspect(current)
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (results.length >= limit || entry.isSymbolicLink()) continue
        const full = path.join(current, entry.name)
        try { assertAllowed(path.relative(userRoot, full)) } catch { continue }
        if (entry.isDirectory()) visit(full)
        else if (entry.isFile()) inspect(full)
      }
    }
    visit(target)
    return { success: true, query: String(query), results, truncated: results.length >= limit }
  } catch (error) { return { success: false, error: error.message } }
}

export async function create_workspace_file({ path: input, content = '' } = {}, context = {}) {
  try {
    if (!input) throw new Error('Parameter path wajib diisi.')
    const text = String(content)
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Isi file terlalu besar.')
    const { userRoot, target, relative } = resolveTarget(input, context, true)
    if (fs.existsSync(target)) throw new Error('File sudah ada. Gunakan replace_workspace_text.')
    const wantedStem = path.basename(relative, path.extname(relative)).toLowerCase().replace(/[-_.]/g, '')
    const similar = []
    function inspectExisting(current) {
      if (similar.length >= 8) return
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || similar.length >= 8) continue
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) inspectExisting(full)
        else if (entry.isFile()) {
          const existingStem = path.basename(entry.name, path.extname(entry.name)).toLowerCase().replace(/[-_.]/g, '')
          if (wantedStem && existingStem === wantedStem) similar.push(path.relative(userRoot, full).replaceAll('\\', '/'))
        }
      }
    }
    inspectExisting(userRoot)
    if (similar.length) throw new Error(`DUPLICATE_CANDIDATE: ditemukan file serupa (${similar.join(', ')}). Baca dan gunakan kembali file tersebut sebelum membuat file baru.`)
    const snapshotId = saveSnapshot(context, relative, '', 'create')
    atomicWrite(userRoot, target, text)
    return { success: true, path: relative.replaceAll('\\', '/'), hash: digest(text), created: true, snapshot_id: snapshotId }
  } catch (error) { return { success: false, error: error.message } }
}

// Digunakan oleh endpoint import proyek. Seluruh input divalidasi sebelum file
// pertama ditulis agar import bersifat atomik dan tidak meninggalkan proyek
// setengah jadi ketika salah satu path tidak aman.
export async function importWorkspaceFiles({ files = [], overwrite = false } = {}, context = {}) {
  try {
    if (!Array.isArray(files) || files.length < 1 || files.length > 100) {
      throw new Error('files harus berisi 1-100 file workspace.')
    }
    const seen = new Set()
    const prepared = files.map((item) => {
      if (!item || typeof item.path !== 'string' || typeof item.content !== 'string') {
        throw new Error('Setiap file wajib memiliki path dan content berupa teks.')
      }
      const normalized = item.path.replaceAll('\\', '/').toLowerCase()
      if (seen.has(normalized)) throw new Error(`Path duplikat dalam import: ${item.path}`)
      seen.add(normalized)
      if (Buffer.byteLength(item.content) > MAX_BYTES) throw new Error(`${item.path}: file terlalu besar.`)
      const resolved = resolveTarget(item.path, context, true)
      const exists = fs.existsSync(resolved.target)
      if (exists && !overwrite) throw new Error(`${item.path}: file sudah ada; overwrite harus diizinkan eksplisit.`)
      if (exists && !fs.statSync(resolved.target).isFile()) throw new Error(`${item.path}: target bukan file.`)
      return { ...resolved, content: item.content, exists, before: exists ? readText(resolved.target) : '' }
    })

    const transactionId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const written = []
    try {
      for (const item of prepared) {
        const snapshotId = saveSnapshot(context, item.relative, item.before, item.exists ? `import:${transactionId}` : 'create')
        atomicWrite(item.userRoot, item.target, item.content)
        written.push({ ...item, snapshotId })
      }
    } catch (writeError) {
      for (const item of written.reverse()) {
        if (item.exists) atomicWrite(item.userRoot, item.target, item.before)
        else if (fs.existsSync(item.target)) fs.unlinkSync(item.target)
      }
      throw new Error(`Import dibatalkan dan dipulihkan: ${writeError.message}`)
    }
    return {
      success: true,
      transaction_id: transactionId,
      imported: prepared.length,
      files: written.map(item => ({
        path: item.relative.replaceAll('\\', '/'), hash: digest(item.content),
        overwritten: item.exists, snapshot_id: item.snapshotId
      }))
    }
  } catch (error) { return { success: false, error: error.message } }
}

export async function run_workspace_tests({ path: input } = {}, context = {}) {
  try {
    if (!input || !/(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?js$/i.test(String(input).replaceAll('\\', '/'))) {
      throw new Error('Hanya file JavaScript pada folder test/tests/__tests__ atau *.test.js/*.spec.js yang boleh dijalankan.')
    }
    const { userRoot, target, relative } = resolveTarget(input, context)
    if (!fs.statSync(target).isFile()) throw new Error('Test runner hanya menerima satu file test.')
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${userRoot}`, target], {
        cwd: userRoot, env: { PATH: process.env.PATH || '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''; let stderr = ''; let timedOut = false
      const collect = chunk => { if (stdout.length + stderr.length < 16000) return chunk.toString().slice(0, 16000 - stdout.length - stderr.length); return '' }
      child.stdout.on('data', chunk => { stdout += collect(chunk) })
      child.stderr.on('data', chunk => { stderr += collect(chunk) })
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 10_000)
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }) })
    })
    return { success: !result.timedOut && result.code === 0, path: relative.replaceAll('\\', '/'), sandbox: 'node-permission-model', network: false, child_process: false, timeout_ms: 10000, ...result }
  } catch (error) { return { success: false, error: error.message } }
}

export async function replace_workspace_text({ path: input, old_text, new_text = '', expected_hash, replacements } = {}, context = {}) {
  try {
    const edits = Array.isArray(replacements) ? replacements : [{ old_text, new_text }]
    if (!input || edits.length < 1 || edits.length > 20 || edits.some(edit => typeof edit.old_text !== 'string' || !edit.old_text.length)) throw new Error('path dan 1-20 replacement wajib diisi.')
    const { userRoot, target, relative } = resolveTarget(input, context)
    const content = readText(target)
    const beforeHash = digest(content)
    if (!expected_hash) throw new Error('expected_hash dari read_workspace_file wajib disertakan.')
    if (expected_hash !== beforeHash) throw new Error('File berubah sejak dibaca. Baca ulang sebelum edit.')
    let updated = content
    for (const edit of edits) {
      const count = updated.split(edit.old_text).length - 1
      if (count !== 1) throw new Error(`old_text harus cocok tepat satu kali; ditemukan ${count}. Tidak ada perubahan yang ditulis.`)
      updated = updated.replace(edit.old_text, String(edit.new_text || ''))
    }
    if (Buffer.byteLength(updated) > MAX_BYTES) throw new Error('Hasil file terlalu besar.')
    const snapshotId = saveSnapshot(context, relative, content, 'edit')
    atomicWrite(userRoot, target, updated)
    return { success: true, path: relative.replaceAll('\\', '/'), replacements: edits.length, before_hash: beforeHash, after_hash: digest(updated), snapshot_id: snapshotId }
  } catch (error) { return { success: false, error: error.message } }
}

export async function get_workspace_diff({ path: input } = {}, context = {}) {
  try {
    if (!input) throw new Error('Parameter path wajib diisi.')
    const { target, relative } = resolveTarget(input, context)
    const current = readText(target)
    const previous = snapshots(context, relative)[0]
    if (!previous) return { success: true, path: relative, has_changes: false, message: 'Belum ada snapshot sebelumnya.' }
    return { success: true, path: relative.replaceAll('\\', '/'), snapshot_id: previous.id,
      before_hash: previous.hash, after_hash: digest(current), has_changes: previous.content !== current,
      diff: compactDiff(previous.content, current) }
  } catch (error) { return { success: false, error: error.message } }
}

export async function rollback_workspace_file({ path: input, snapshot_id } = {}, context = {}) {
  try {
    if (!input) throw new Error('Parameter path wajib diisi.')
    const resolved = resolveTarget(input, context, true)
    const records = snapshots(context, resolved.relative)
    const snapshot = snapshot_id ? records.find(item => item.id === snapshot_id) : records[0]
    if (!snapshot) throw new Error('Snapshot rollback tidak ditemukan.')
    if (fs.existsSync(resolved.target)) saveSnapshot(context, resolved.relative, readText(resolved.target), 'rollback')
    if (snapshot.action === 'create') {
      if (fs.existsSync(resolved.target)) fs.unlinkSync(resolved.target)
      return { success: true, path: resolved.relative.replaceAll('\\', '/'), rolled_back_to: snapshot.id, deleted_created_file: true }
    }
    atomicWrite(resolved.userRoot, resolved.target, snapshot.content)
    return { success: true, path: resolved.relative.replaceAll('\\', '/'), rolled_back_to: snapshot.id, hash: digest(snapshot.content) }
  } catch (error) { return { success: false, error: error.message } }
}

export async function patch_workspace_files({ patches = [] } = {}, context = {}) {
  try {
    if (!Array.isArray(patches) || patches.length < 2 || patches.length > 10) throw new Error('patches harus berisi 2-10 perubahan file.')
    const uniquePaths = new Set(patches.map(item => String(item.path || '').replaceAll('\\', '/').toLowerCase()))
    if (uniquePaths.size !== patches.length) throw new Error('Satu transaksi tidak boleh memuat path yang sama lebih dari sekali.')
    const prepared = patches.map(item => {
      if (!item.path || typeof item.old_text !== 'string' || !item.old_text.length || !item.expected_hash) throw new Error('Setiap patch wajib memiliki path, old_text, new_text, dan expected_hash.')
      const resolved = resolveTarget(item.path, context)
      const content = readText(resolved.target)
      if (digest(content) !== item.expected_hash) throw new Error(`${item.path}: file berubah sejak dibaca.`)
      const count = content.split(item.old_text).length - 1
      if (count !== 1) throw new Error(`${item.path}: old_text ditemukan ${count} kali.`)
      const updated = content.replace(item.old_text, String(item.new_text || ''))
      if (Buffer.byteLength(updated) > MAX_BYTES) throw new Error(`${item.path}: hasil terlalu besar.`)
      return { ...resolved, content, updated }
    })
    const transactionId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const written = []
    try {
      for (const item of prepared) {
        saveSnapshot(context, item.relative, item.content, `transaction:${transactionId}`)
        atomicWrite(item.userRoot, item.target, item.updated)
        written.push(item)
      }
    } catch (writeError) {
      for (const item of written.reverse()) atomicWrite(item.userRoot, item.target, item.content)
      throw new Error(`Transaksi dibatalkan dan perubahan dipulihkan: ${writeError.message}`)
    }
    return { success: true, transaction_id: transactionId, files: prepared.map(item => ({ path: item.relative.replaceAll('\\', '/'), hash: digest(item.updated) })) }
  } catch (error) { return { success: false, error: error.message } }
}

// Dipanggil hanya oleh endpoint penghapusan akun yang sudah diautentikasi.
export function deleteWorkspaceData(userId) {
  const segment = userSegment(userId)
  const workspace = path.join(ROOT, segment)
  const history = path.join(HISTORY_ROOT, segment)
  for (const target of [workspace, history]) {
    const relative = path.relative(ROOT, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Target cleanup workspace tidak valid.')
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
  }
}

function validateContent(relative, content) {
  const extension = path.extname(relative).toLowerCase()
  const asScript = (source) => source
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/g, '')
  try {
    if (extension === '.json') JSON.parse(content)
    else if (['.js', '.mjs', '.cjs'].includes(extension)) new vm.Script(asScript(content))
    else if (['.ts', '.mts', '.cts'].includes(extension)) new vm.Script(asScript(stripTypeScriptTypes(content, { mode: 'transform' })))
    else if (['.html', '.htm'].includes(extension)) {
      for (const tag of ['script', 'style', 'body', 'html']) {
        if ((content.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length !== (content.match(new RegExp(`</${tag}>`, 'gi')) || []).length) throw new Error(`Tag <${tag}> tidak seimbang.`)
      }
    } else if (extension === '.css') {
      if ((content.match(/\{/g) || []).length !== (content.match(/\}/g) || []).length) throw new Error('Kurung kurawal CSS tidak seimbang.')
    } else return { supported: false }
    return { supported: true, valid: true }
  } catch (error) { return { supported: true, valid: false, error: error.message } }
}

export async function validate_workspace_project({ path: input = '.' } = {}, context = {}) {
  try {
    const { userRoot, target } = resolveTarget(input, context)
    const results = []
    function inspect(file) {
      if (results.length >= 120 || fs.statSync(file).size > MAX_BYTES) return
      let content
      try { content = readText(file) } catch { return }
      const relative = path.relative(userRoot, file).replaceAll('\\', '/')
      const result = validateContent(relative, content)
      if (result.supported) results.push({ path: relative, valid: result.valid, error: result.error })
    }
    function visit(current) {
      const stat = fs.statSync(current)
      if (stat.isFile()) return inspect(current)
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || results.length >= 120) continue
        const full = path.join(current, entry.name)
        try { assertAllowed(path.relative(userRoot, full)) } catch { continue }
        if (entry.isDirectory()) visit(full); else if (entry.isFile()) inspect(full)
      }
    }
    visit(target)
    return { success: true, checked: results.length, valid: results.every(item => item.valid), files: results, note: 'Validasi statis aman; tidak menjalankan shell atau script proyek.' }
  } catch (error) { return { success: false, error: error.message } }
}

export default {
  list_workspace_files, read_workspace_file, search_workspace_code, create_workspace_file, replace_workspace_text,
  get_workspace_diff, rollback_workspace_file, patch_workspace_files, validate_workspace_project
  , run_workspace_tests
}
