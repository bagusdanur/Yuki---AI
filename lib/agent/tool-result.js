import crypto from 'node:crypto'
import { sanitizeOutputSecrets } from '../security.js'

const nowIso = () => new Date().toISOString()

function safeValue(value) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return sanitizeOutputSecrets(value).slice(0, 16_000)
  try { return JSON.parse(sanitizeOutputSecrets(JSON.stringify(value)).slice(0, 16_000)) } catch { return '[evidence redacted]' }
}

export function buildEvidence(toolName, data = {}) {
  if (!data || typeof data !== 'object') return []
  const evidence = []
  const push = (kind, value) => value !== undefined && value !== null && evidence.push({ kind, value: safeValue(value) })

  if (data.path && (data.hash || data.after_hash || data.created || data.replacements)) {
    push('file', { path: data.path, hash: data.hash || data.after_hash, created: Boolean(data.created), snapshotId: data.snapshot_id })
  }
  if (Array.isArray(data.files) && data.files.length) push('file', data.files.map(item => ({ path: item.path, hash: item.hash, valid: item.valid })))
  if (data.stdout !== undefined || data.stderr !== undefined || data.code !== undefined || data.exitCode !== undefined) {
    push('stdout', { stdout: data.stdout || data.logs || '', stderr: data.stderr || '', exitCode: data.exitCode ?? data.code ?? 0, timedOut: Boolean(data.timedOut) })
  }
  if (data.id !== undefined || data.note?.id !== undefined || data.task?.id !== undefined || data.learning_entry_id) {
    push('record', {
      id: data.learning_entry_id || data.note?.id || data.task?.id || data.id,
      type: toolName,
      timestamp: data.timestamp || data.note?.createdAt || data.task?.createdAt
    })
  }
  if (data.status !== undefined && data.url) push('http', { url: data.url, status: data.status, ok: data.ok, durationMs: data.durationMs, responseSize: data.responseSize })
  if (data.artifact) push('artifact', { id: data.artifact.id, title: data.artifact.title, version: data.artifact.version, validated: data.validated !== false })
  if (Array.isArray(data.results)) push('source', data.results.map(item => ({ title: item.title, url: item.url, relevance: item.relevance, publishedAt: item.publishedAt })))
  if (Array.isArray(data.comics)) push('source', data.comics.map(item => ({ title: item.title, url: item.url, format: item.format })))
  return evidence
}

export function createToolResult({ toolCallId, skillId, toolName, status, data, error, evidence = [], startedAt, durationMs }) {
  const finishedAt = nowIso()
  return {
    toolCallId: toolCallId || `tool_${crypto.randomUUID()}`,
    skillId,
    toolName,
    status,
    data,
    error,
    evidence,
    startedAt,
    finishedAt,
    durationMs
  }
}

export function verifyToolResult(result) {
  if (!result || result.status !== 'succeeded') return { verified: false, reason: result?.error?.message || 'Tool belum berhasil.' }
  const kinds = new Set((result.evidence || []).map(item => item.kind))
  const requirements = {
    create_workspace_file: 'file', replace_workspace_text: 'file', patch_workspace_files: 'file',
    run_workspace_tests: 'stdout', run_javascript_code: 'stdout', add_user_note: 'record',
    schedule_task: 'record', record_self_improvement: 'record', http_api_request: 'http',
    build_interactive_artifact: 'artifact', update_interactive_artifact: 'artifact', patch_interactive_artifact: 'artifact'
  }
  const required = requirements[result.toolName]
  if (required && !kinds.has(required)) return { verified: false, reason: `Bukti ${required} tidak tersedia untuk ${result.toolName}.` }
  return { verified: true }
}

export function resultCanClaimSuccess(result) {
  return verifyToolResult(result).verified
}
