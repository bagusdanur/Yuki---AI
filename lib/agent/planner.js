import crypto from 'node:crypto'

const CONTINUATION = /^(?:tolong\s+)?(?:lanjut(?:kan)?|teruskan|coba lagi|ulangi|retry|yang tadi|masih sama|belum berubah|tetap bug|masih bug|gak berubah|nggak berubah|belum keperbaiki)[.!?\s]*$/i

function latestUserMessages(messages = []) {
  return messages.filter(message => message?.role === 'user' && typeof message.content === 'string')
}

function classifyIntent(text = '') {
  const value = String(text).toLowerCase()
  if (/\b(analisis|review|jelaskan|cek saja|jangan ubah|tanpa mengubah)\b/.test(value)) return 'analyze'
  if (/\b(perbaiki\w*|benerin\w*|benahi\w*|betulin\w*|fix|bug|error|rusak|gagal|masih sama|belum berubah)\b/.test(value)) return 'fix'
  if (/\b(refactor|rapikan|optimasi|optimize)\b/.test(value)) return 'refactor'
  if (/\b(tambah|tambahkan|fitur|implementasikan)\b/.test(value)) return 'extend'
  if (/\b(buat(?:kan)?|create|generate)\b[\s\S]{0,60}\b(file|proyek|project|aplikasi|app|script|halaman|component|komponen)\b/.test(value)) return 'create'
  return 'general'
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  return value
}

function minimizeToolAllowlist(names, text, intent) {
  const selected = new Set(names)
  const value = String(text).toLowerCase()
  if (intent === 'analyze') {
    for (const name of [...selected]) if (/^(?:create_|replace_|patch_|update_|delete_|rollback_|schedule_|reschedule_|cancel_)/.test(name)) selected.delete(name)
  }
  if (intent === 'fix' && !/\b(buat(?:kan)?|create|tambahkan)\b[\s\S]{0,60}\b(file|component|komponen)\b/.test(value)) selected.delete('create_workspace_file')
  if (/\b(jadwal\w*|schedule\w*|reminder\w*|pengingat\w*|ingatkan\w*)\b|\b\d+\s+(?:menit|jam)\s+lagi\b/.test(value)) {
    const desired = /\b(ubah|ganti|maju|mundur|reschedule)\b/.test(value) ? 'reschedule_task'
      : /\b(batal|batalkan|cancel|hapus)\b/.test(value) ? 'cancel_scheduled_task'
      : /\b(list|daftar|tampil|lihat|semua)\b/.test(value) ? 'list_scheduled_tasks' : 'schedule_task'
    for (const name of ['schedule_task', 'reschedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task']) if (name !== desired) selected.delete(name)
    for (const name of ['add_user_note', 'list_user_notes', 'delete_user_note', 'calculate_expression', 'calculate_date_difference', 'get_current_time']) selected.delete(name)
  }
  if (/\b(catatan|note|todo)\b/.test(value)) {
    const desired = /\b(hapus|delete)\b/.test(value) ? 'delete_user_note'
      : /\b(list|daftar|tampil|lihat|semua)\b/.test(value) ? 'list_user_notes' : 'add_user_note'
    for (const name of ['add_user_note', 'list_user_notes', 'delete_user_note']) if (name !== desired) selected.delete(name)
  }
  return [...selected]
}

export function strategyHash(toolName, args = {}) {
  return crypto.createHash('sha256').update(`${String(toolName)}:${JSON.stringify(stableValue(args))}`).digest('hex').slice(0, 24)
}

export function createRetryGuard({ maxFailures = 4, maxAttemptsPerTool = 2 } = {}) {
  const attempts = new Map()
  const failedStrategies = new Set()
  let failures = 0
  return {
    inspect(toolName, args = {}) {
      const hash = strategyHash(toolName, args)
      const toolAttempts = attempts.get(toolName) || 0
      if (failedStrategies.has(hash)) return { allowed: false, hash, reason: 'IDENTICAL_FAILED_STRATEGY' }
      if (failures >= maxFailures || toolAttempts >= maxAttemptsPerTool) return { allowed: false, hash, reason: 'RETRY_BUDGET_EXHAUSTED' }
      return { allowed: true, hash }
    },
    record(toolName, args = {}, { failed = false } = {}) {
      const hash = strategyHash(toolName, args)
      if (failed) {
        attempts.set(toolName, (attempts.get(toolName) || 0) + 1)
        failures += 1
        failedStrategies.add(hash)
      }
      return { hash, failures, attempts: attempts.get(toolName) }
    },
    snapshot() { return { failures, attempts: Object.fromEntries(attempts), failedStrategies: [...failedStrategies] } }
  }
}

export function buildExecutionPlan(messages = [], { selectTools, hasActiveArtifact = false, maxSteps = 10 } = {}) {
  const users = latestUserMessages(messages)
  const current = users.at(-1)?.content?.trim() || ''
  const previous = users.slice(-3, -1).map(message => message.content).join('\n')
  const continuation = CONTINUATION.test(current)
  const routingText = continuation ? `${previous}\n${current}`.trim() : current
  let intent = classifyIntent(current)
  if (intent === 'general' && continuation) intent = classifyIntent(previous)
  if (hasActiveArtifact && continuation && /\b(bug|error|rusak|perbaiki|belum berubah|masih sama)\b/i.test(previous + current)) intent = 'fix'
  const toolAllowlist = minimizeToolAllowlist([...(selectTools?.(routingText) || [])], routingText, intent)

  const mutating = toolAllowlist.some(name => /^(?:create_|replace_|patch_|update_|delete_|schedule_|reschedule_|cancel_|rollback_)/.test(name))
  const verificationTools = toolAllowlist.filter(name => /(?:validate|diff|test)/.test(name))
  const steps = [
    { id: 'understand', title: 'Memahami tujuan terbaru', kind: 'planning' },
    ...(toolAllowlist.length ? [{ id: 'execute', title: 'Menjalankan tool yang relevan', kind: 'execution' }] : []),
    ...(mutating ? [{ id: 'verify', title: 'Memverifikasi perubahan dengan bukti', kind: 'verification' }] : []),
    { id: 'report', title: 'Menyusun laporan berdasarkan hasil aktual', kind: 'reporting' }
  ]
  return {
    version: 1, goal: current.slice(0, 2000), intent, continuation,
    contextSource: continuation ? 'explicit_continuation' : 'latest_request',
    toolAllowlist, verificationTools, requiresEvidence: mutating,
    maxSteps: Math.max(2, Math.min(20, Number(maxSteps) || 10)), steps
  }
}

export function validateExecutionPlan(plan) {
  if (!plan || plan.version !== 1 || !plan.goal || !Array.isArray(plan.toolAllowlist) || !Array.isArray(plan.steps)) return { valid: false, error: 'INVALID_PLAN_SCHEMA' }
  if (plan.toolAllowlist.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]{2,60}$/.test(name))) return { valid: false, error: 'INVALID_TOOL_ALLOWLIST' }
  if (plan.steps.length > plan.maxSteps) return { valid: false, error: 'PLAN_STEP_BUDGET_EXCEEDED' }
  return { valid: true }
}
