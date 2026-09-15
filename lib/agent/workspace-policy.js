import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const FORBIDDEN_ROOTS = ['/etc', '/home', '/opt', '/proc', '/root', '/srv', '/sys', '/usr', '/var', '/var/www']

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function assertSafeWorkspaceRoot(input, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const root = path.resolve(String(input || 'agent-workspace'))
  const filesystemRoot = path.parse(root).root
  const current = path.resolve(cwd)
  const userHome = path.resolve(home)

  if (samePath(root, filesystemRoot)) throw new Error('YUKI_AGENT_WORKSPACE tidak boleh menunjuk ke root filesystem.')
  if (samePath(root, current) || containsPath(root, current)) throw new Error('YUKI_AGENT_WORKSPACE tidak boleh menunjuk ke project atau parent project.')
  if (samePath(root, userHome) || containsPath(root, userHome)) throw new Error('YUKI_AGENT_WORKSPACE tidak boleh menunjuk ke home atau parent home.')
  if (FORBIDDEN_ROOTS.some(forbidden => samePath(root, path.resolve(forbidden)))) {
    throw new Error('YUKI_AGENT_WORKSPACE menunjuk ke lokasi host yang dilarang.')
  }
  return root
}

export function workspaceUserSegment(userId) {
  const value = String(userId || '').trim()
  if (!value) throw new Error('Context user terautentikasi wajib untuk mengakses workspace.')
  return `u_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}

export function legacyWorkspaceUserSegment(userId) {
  return String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}
