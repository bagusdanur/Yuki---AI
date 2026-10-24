import 'dotenv/config'
import express from 'express'
import path from 'path'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { chat, chatStream, extractFacts, callLLM } from './lib/llm.js'
import { synthesize } from './lib/tts.js'
import { Emotion } from './lib/emotion.js'
import {
  loadMemory, addFacts, addEvent, buildMemoryContext, recallMemory, saveEmotion,
  registerUser, getUserByAccessCode, getUsernameByUserId, saveChatMessage, getChatHistory,
  getChatHistoryPage,
  countChatMessages, summarizeAndTrimHistory, captureStructuredMemory,
  recordConversationEvent, syncBondMilestones, saveResponseFeedback,
  consumeRateLimit, pruneRateLimits, deleteUserData, getAdminStats, userExists,
  saveComicBookmark, getComicBookmarks, deleteComicBookmark
  , getScheduledReminderMessages, dbHandle, APP_DATA_LABELS
  , regenerateAccessCode
  , listAllMemories, deleteFactMemory, deleteStructuredMemory, searchChatHistory
} from './lib/memory.js'
import { responseTarget, shouldInitiate, validateCharacterReply, repairCharacterReply, stripStrayComicBlocks } from './lib/character-quality.js'
import { warmupEmbedder } from './lib/semantic.js'
import { searchComics, latestComics, wantsComic, wantsLatestComics, detectRequestedGenre, extractQuery, buildComicContext } from './lib/ryukomik.js'
import { executeTool, initSkills, listSkills } from './lib/agent/skills-engine.js'
import { getProviderOperations, flushProviderOperations, resetProviderOperations } from './lib/provider-router.js'
// Mesin game (persiapan v4). Modul ini murni — tidak menyentuh model bahasa.
import { createBoard as tttBoard, applyMove as tttMove, chooseYukiMove as tttYukiMove, MARK_USER as TTT_USER, MARK_YUKI as TTT_YUKI } from './lib/games/tic-tac-toe.js'
import { loadSession as loadGameSession, saveSession as saveGameSession, clearSession as clearGameSession, getStats as gameStats, gameMemoryText, GAME_RPS } from './lib/games/store.js'
import { hasilRonde as rpsHasil, normalisasi as rpsNormalisasi, acak as rpsAcak, stateBaru as rpsStateBaru, catatRonde as rpsCatat } from './lib/games/rps.js'
import { listTables, readTable, listDirectory, readTextFile, workspaceSummary, listUsers, listUserTables, readUserTable, findMemoryKeys } from './lib/admin-browser.js'
import { getPublicProviderSettings, saveProviderSettings, testProviderConnection } from './lib/provider-settings.js'
import {
  getTtsSettings, saveTtsSettings, TTS_ENGINES,
  getVoicevoxProcessStatus, startVoicevox, stopVoicevox, probeVoicevox, listVoicevoxSpeakers,
  setVoicevoxAutorestart
} from './lib/tts-settings.js'
import {
  getDatabaseStats, getChatTrend, getHourlyActivity, getTopUsers,
  getRecentUsers, getEmotionDistribution, getStorageInfo
} from './lib/admin-stats.js'
import { runAgent, extractHtmlArtifactsFromText } from './lib/agent/runner.js'
import { cancelWorkflow, claimWorkflow, createApprovalCheckpoint, deleteUserWorkflows, getWorkflow, listPendingWorkflows, setWorkflowState } from './lib/agent/workflow-store.js'
import { claimAgentRun, createOrGetAgentRun, deleteUserAgentRuns, getActiveAgentRun, getAgentRun, isAgentRunCancellationRequested, recoverInterruptedAgentRuns, requestAgentRunCancellation, setAgentRunState, upsertAgentRunStep } from './lib/agent/run-store.js'
import { traceEvent } from './lib/agent/observability.js'
import { captureMemoryCandidates, deleteAgentMemory, deleteAgentMemoryData, getMemorySettings, listAgentMemories, setMemorySettings, updateAgentMemory } from './lib/agent/memory-store.js'
import { approveDynamicSkill, createDynamicSkill, deleteDynamicSkillData, disableDynamicSkill, listDynamicSkills, validateDynamicSkill } from './lib/agent/dynamic-skills.js'
import { deleteScheduledTasks, getAgenda, restoreScheduledJobs, setScheduledTaskStatus, setTaskTriggerCallback, shutdownScheduler, snoozeScheduledTask, updateScheduledTask } from './lib/scheduler.js'
import { handleCompanionReminder } from './lib/companion-reminder.js'
import { deletePushSubscriptions, getPushConfig, removePushSubscription, savePushSubscription, sendPushToUser } from './lib/push.js'
import { closeBrowser } from './lib/browser.js'
import { deleteWorkspaceData, importWorkspaceFiles } from './skills/computing/workspace-files/handler.js'

// Hemat DeepSeek: cuma ekstrak fakta kalau pesan kemungkinan berisi info personal
// (mayoritas chat biasa nggak perlu -> menghemat ~1 panggilan LLM tiap giliran).
function worthRemembering(text = '') {
  if (text.length <= 25) return false
  // Fakta eksplisit tentang diri user
  if (/(nama|aku |saya |panggil|umur|tahun|tinggal|kerja|sekolah|kuliah|kampus|pacar|gebetan|hobi|aku suka|aku benci|favorit|kesukaan|cita-cita|impian)/i.test(text)) return true
  // M-3: Preferensi implisit — ekspresi suka/tidak suka tanpa deklarasi eksplisit
  if (/(wah seru|enak banget|bagus banget|asik banget|keren banget|nggak suka|males banget|bosen sama|nggak ngerti|seneng banget|excited banget)/i.test(text)) return true
  return false
}

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ limit: '10mb', extended: true }))

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex')
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_TOKEN
const ADMIN_PASSWORD_FILE = path.resolve(process.env.ADMIN_PASSWORD_FILE || './.runtime-secrets/admin-password.json')
const WORKSPACE_ROOT = path.resolve(process.env.AGENT_WORKSPACE_DIR || './agent-workspace')
if (IS_PRODUCTION && !process.env.AUTH_SECRET) console.warn('[security] AUTH_SECRET belum disetel; sesi akan invalid setelah restart.')
if (IS_PRODUCTION && !ADMIN_TOKEN) console.warn('[security] ADMIN_TOKEN belum disetel; dashboard admin dinonaktifkan.')

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: String(userId), exp: Date.now() + 30 * 86400_000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifySession(token = '') {
  const [payload, signature] = String(token).split('.')
  if (!payload || !signature) return null
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.exp > Date.now() && userExists(data.sub) ? data.sub : null } catch { return null }
}

function requireSession(req, res, next) {
  const userId = verifySession(req.get('Authorization')?.replace(/^Bearer\s+/i, ''))
  if (!userId) return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Pulihkan dengan kunci ingatan.' })
  req.authUserId = userId
  next()
}

function signAdminSession() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 12 * 3600_000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', `${AUTH_SECRET}:admin`).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyAdminSession(token = '') {
  const [payload, signature] = String(token).split('.')
  if (!payload || !signature) return false
  const expected = crypto.createHmac('sha256', `${AUTH_SECRET}:admin`).update(payload).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  try { const data = JSON.parse(Buffer.from(payload, 'base64url')); return data.role === 'admin' && data.exp > Date.now() } catch { return false }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }
}

function verifyAdminPassword(password = '') {
  if (existsSync(ADMIN_PASSWORD_FILE)) {
    try {
      const record = JSON.parse(readFileSync(ADMIN_PASSWORD_FILE, 'utf8'))
      const candidate = hashPassword(String(password), record.salt).hash
      return candidate.length === record.hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.hash))
    } catch { return false }
  }
  return Boolean(ADMIN_PASSWORD) && password.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD))
}

function storeAdminPassword(password) {
  mkdirSync(path.dirname(ADMIN_PASSWORD_FILE), { recursive: true })
  const temporary = `${ADMIN_PASSWORD_FILE}.tmp`
  writeFileSync(temporary, JSON.stringify(hashPassword(password)), { mode: 0o600 })
  renameSync(temporary, ADMIN_PASSWORD_FILE)
}

function requireAdmin(req, res, next) {
  const token = req.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!verifyAdminSession(token)) return res.status(401).json({ error: 'Sesi admin tidak valid atau berakhir.' })
  next()
}

const metrics = { startedAt: Date.now(), requests: 0, errors: 0, chats: 0, chatFailures: 0, latencyTotal: 0 }
const AGENT_WORKER_ID = `${process.pid}:${crypto.randomUUID()}`
recoverInterruptedAgentRuns()

function updateAgentProgress(requestId, userId, step) {
  if (!requestId) return
  upsertAgentRunStep(requestId, userId, step)
}
app.use((req, res, next) => {
  const started = Date.now(); metrics.requests += 1
  res.on('finish', () => { metrics.latencyTotal += Date.now() - started; if (res.statusCode >= 500) metrics.errors += 1 })
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' })
  next()
})

function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  return (req, res, next) => {
    const key = `${req.authUserId || req.ip}:${req.path}`
    const bucket = consumeRateLimit(key, windowMs, max)
    res.set('X-RateLimit-Remaining', String(bucket.remaining))
    if (!bucket.allowed) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - Date.now()) / 1000)))
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' })
    }
    next()
  }
}

setInterval(pruneRateLimits, 10 * 60_000).unref()

// CORS biar widget bisa di-embed dari domain lain (mis. ryukomik.my.id)
const ALLOW = (process.env.WIDGET_ALLOW_ORIGINS || '*').split(',').map((s) => s.trim())
app.use((req, res, next) => {
  const origin = req.headers.origin
  let sameHost = false
  try { sameHost = Boolean(origin && new URL(origin).host === req.get('host')) } catch {}
  if (!origin || sameHost || ALLOW.includes('*') || ALLOW.includes(origin)) {
    if (origin) res.set('Access-Control-Allow-Origin', ALLOW.includes('*') ? '*' : origin)
  } else if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Origin tidak diizinkan.' })
  res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// 🛡️ Global Security Hardening Middleware (Isolasi Host VPS)
app.disable('x-powered-by')
app.use((req, res, next) => {
  // 1. Security Headers
  const isEmbedDocument = req.path === '/embed.html' || (req.path === '/' && req.query?.embed === '1')
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  })
  if (isEmbedDocument) {
    res.set('Content-Security-Policy', "frame-ancestors 'self' https://ryukomik.my.id https://www.ryukomik.my.id https://ryukomik.web.id")
  } else {
    res.set('X-Frame-Options', 'SAMEORIGIN')
  }

  // 2. Anti Path-Traversal & Dangerous System Payload Check
  let decodedPath = ''
  try { decodedPath = decodeURIComponent(req.path || '') } catch { decodedPath = req.path || '' }
  if (
    decodedPath.includes('..') ||
    decodedPath.includes('.env') ||
    decodedPath.includes('/etc/') ||
    decodedPath.includes('/proc/') ||
    decodedPath.includes('/var/') ||
    decodedPath.includes('.git')
  ) {
    console.warn(`[security] Blocked path traversal attempt: ${req.ip} -> ${req.path}`)
    return res.status(403).json({ error: 'Akses ke path ini dilarang oleh sistem keamanan server.' })
  }

  next()
})

app.use(express.static('dist', { dotfiles: 'ignore' }))
app.use(express.static('public', { dotfiles: 'ignore' }))


// Rute Dokumentasi Yuki AI
app.get('/changelog', (req, res) => {
  res.sendFile(path.resolve('public/changelog.html'))
})
app.get('/docs', (req, res) => {
  res.sendFile(path.resolve('public/docs.html'))
})

// Panaskan model embedding di latar belakang (biar recall cepat saat dipakai)
warmupEmbedder().catch(() => {})

// Inisialisasi Yuki Agent Skills Engine
initSkills().catch((err) => console.error('[skills-engine] Inisialisasi gagal:', err.message))

// Inisialisasi Scheduled Tasks Engine & Callback Notifikasi
setTaskTriggerCallback(async (userId, task) => {
  try {
    const generic = !task.description || /^Pengingat:\s*Pengingat$/i.test(task.description.trim())
    const detail = generic ? 'Waktunya melakukan hal yang tadi kamu minta Yuki ingatkan.' : task.description.trim()
    const reminderMsg = `[YUKI_REMINDER]\n*mengetuk layar dua kali agar kamu memperhatikan*\n\n### ⏰ ${task.title}\n\n${detail}\n\nHmph, Yuki sudah menepati janji mengingatkanmu. Sekarang jangan malah diabaikan, ya.\n\n[emosi: kesal]`
    saveChatMessage(userId, 'assistant', reminderMsg)
    const push = await sendPushToUser(userId, {
      title: `⏰ ${task.title}`,
      body: `${detail} — Hmph, jangan diabaikan ya.`,
      tag: `yuki-reminder-${task.occurrenceId || task.id}`,
      url: '/', occurrenceId: task.occurrenceId
    })
    console.info(`[scheduler] Notifikasi pengingat disimpan untuk user ${userId}: "${task.title}"`)
    if (push.failed) console.warn(`[push] ${push.failed} subscription gagal untuk user ${userId}`)
  } catch (err) {
    console.error('[server] Gagal simpan notifikasi scheduled task:', err.message)
  }
})
restoreScheduledJobs()

// Graceful shutdown untuk browser pool
process.on('SIGINT', async () => {
  flushProviderOperations()
  shutdownScheduler()
  await closeBrowser()
  process.exit(0)
})
process.on('SIGTERM', async () => {
  flushProviderOperations()
  shutdownScheduler()
  await closeBrowser()
  process.exit(0)
})

// Endpoint Katalog Skills Yuki Agent
app.get('/api/agent/skills', rateLimit({ max: 60 }), async (_req, res) => {
  try {
    const skills = await listSkills()
    res.json({ skills })
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) })
  }
})

app.get('/api/memories', requireSession, rateLimit({ max: 60 }), (req, res) => {
  // Menu ingatan harus menampilkan SEMUA yang Yuki ingat (facts + structured + agent),
  // bukan hanya agent_memories — sebelumnya user hanya melihat sebagian kecil.
  const { facts, structured } = listAllMemories(req.authUserId)
  res.json({ memories: listAgentMemories(req.authUserId, { scopeType: String(req.query.scopeType || ''), scopeId: String(req.query.scopeId || ''), status: String(req.query.status || '') }), settings: getMemorySettings(req.authUserId), facts, structured })
})
app.put('/api/memories/settings', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  res.json({ settings: setMemorySettings(req.authUserId, { autoCapture: req.body?.autoCapture === true }) })
})
app.patch('/api/memories/:memoryId', requireSession, rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const memory = updateAgentMemory(req.params.memoryId, req.authUserId, req.body || {})
  if (!memory) return res.status(404).json({ error: 'Memori tidak ditemukan atau bukan milikmu.' })
  res.json({ success: true, memory })
})
app.delete('/api/memories/:memoryId', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  if (!deleteAgentMemory(req.params.memoryId, req.authUserId)) return res.status(404).json({ error: 'Memori tidak ditemukan atau bukan milikmu.' })
  res.json({ success: true })
})
// Hapus per-sumber untuk memori non-agent (fakta & catatan kebiasaan/janji).
app.delete('/api/memories/fact/:factId', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  if (!deleteFactMemory(req.authUserId, req.params.factId)) return res.status(404).json({ error: 'Fakta tidak ditemukan atau bukan milikmu.' })
  res.json({ success: true })
})
app.delete('/api/memories/structured/:memoryId', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  if (!deleteStructuredMemory(req.authUserId, req.params.memoryId)) return res.status(404).json({ error: 'Memori tidak ditemukan atau bukan milikmu.' })
  res.json({ success: true })
})

app.get('/api/agent/dynamic-skills', requireSession, rateLimit({ max: 60 }), (req, res) => res.json({ skills: listDynamicSkills(req.authUserId) }))
app.post('/api/agent/dynamic-skills', requireSession, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const result = createDynamicSkill(req.authUserId, req.body || {}); if (!result.success) return res.status(400).json({ error: result.error }); res.status(201).json(result)
})
app.post('/api/agent/dynamic-skills/:skillId/validate', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const result = validateDynamicSkill(req.params.skillId, req.authUserId); if (!result.success) return res.status(400).json({ error: result.error || 'Skill ditolak oleh permission ceiling.', validation: result.validation }); res.json(result)
})
app.post('/api/agent/dynamic-skills/:skillId/approve', requireSession, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const result = approveDynamicSkill(req.params.skillId, req.authUserId); if (!result.success) return res.status(400).json({ error: result.error }); res.json(result)
})
app.post('/api/agent/dynamic-skills/:skillId/disable', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const result = disableDynamicSkill(req.params.skillId, req.authUserId); if (!result.success) return res.status(404).json({ error: result.error }); res.json(result)
})

app.get('/api/agent/progress/:requestId', requireSession, rateLimit({ max: 240 }), (req, res) => {
  const requestId = String(req.params.requestId || '')
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) return res.status(400).json({ error: 'Request ID tidak valid.' })
  const progress = getAgentRun(requestId, req.authUserId)
  if (!progress) return res.json({ steps: [], done: false, state: 'queued' })
  res.json(progress)
})

app.get('/api/agent/runs/active', requireSession, rateLimit({ max: 120 }), (req, res) => {
  res.json({ run: getActiveAgentRun(req.authUserId) })
})

app.post('/api/agent/runs/:requestId/cancel', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const requestId = String(req.params.requestId || '')
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) return res.status(400).json({ error: 'Request ID tidak valid.' })
  const run = requestAgentRunCancellation(requestId, req.authUserId)
  if (!run) return res.status(404).json({ error: 'Run tidak ditemukan.' })
  traceEvent('agent_run_cancel_requested', { requestId, userId: String(req.authUserId) })
  res.json({ success: true, run })
})

app.post('/api/agent/workspace/import', requireSession, rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const result = await importWorkspaceFiles(req.body || {}, { userId: req.authUserId, username: getUsernameByUserId(req.authUserId) || 'User' })
  if (!result.success) return res.status(400).json({ error: result.error })
  res.json(result)
})

app.get('/api/agent/workflows/pending', requireSession, rateLimit({ max: 60 }), (req, res) => {
  const workflows = listPendingWorkflows(req.authUserId).map(item => ({
    id: item.id, requestId: item.requestId, state: item.state,
    toolName: item.checkpoint?.toolName, reason: item.checkpoint?.reason,
    stepId: item.checkpoint?.stepId, createdAt: item.createdAt, expiresAt: item.expiresAt
  }))
  res.json({ workflows })
})

app.post('/api/agent/approvals/:approvalId', requireSession, rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const id = String(req.params.approvalId || '')
  const existing = getWorkflow(id, req.authUserId)
  if (!existing) return res.status(404).json({ error: 'Approval tidak ditemukan atau sudah kedaluwarsa.' })
  if (req.body?.decision !== 'approve') {
    cancelWorkflow(id, req.authUserId)
    if (existing.requestId) setAgentRunState(existing.requestId, req.authUserId, 'cancelled')
    traceEvent('approval_rejected', { workflowId: id, requestId: existing.requestId })
    return res.json({ success: true, status: 'rejected', state: 'cancelled', workflowId: id })
  }
  const claimed = claimWorkflow(id, req.authUserId)
  if (!claimed.ok) {
    if (claimed.reason === 'completed') return res.json({ success: true, status: 'approved', duplicate: true, workflowId: id, state: claimed.workflow.state, result: claimed.workflow.result })
    return res.status(claimed.reason === 'in_progress' ? 409 : 404).json({ error: claimed.reason === 'in_progress' ? 'Workflow sedang dilanjutkan. Permintaan kedua tidak menjalankan tool lagi.' : 'Approval tidak ditemukan atau kedaluwarsa.' })
  }

  const workflow = claimed.workflow
  const checkpoint = workflow.checkpoint || {}
  traceEvent('approval_approved', { workflowId: id, requestId: workflow.requestId, toolName: checkpoint.toolName })
  const toolResult = await executeTool(checkpoint.toolName, checkpoint.args, {
    userId: req.authUserId,
    username: checkpoint.resume?.username || getUsernameByUserId(req.authUserId) || 'User',
    toolCallId: checkpoint.stepId
  })
  if (toolResult.error) {
    setWorkflowState(id, req.authUserId, 'failed', { error: toolResult.error, result: { tool: checkpoint.toolName, contract: toolResult.contract } })
    traceEvent('tool_call_failed', { workflowId: id, requestId: workflow.requestId, toolName: checkpoint.toolName })
    return res.status(400).json({ error: toolResult.error, workflowId: id, state: 'failed' })
  }

  traceEvent('workflow_resumed', { workflowId: id, requestId: workflow.requestId, toolName: checkpoint.toolName })
  if (workflow.requestId) setAgentRunState(workflow.requestId, req.authUserId, 'resuming')
  const resume = checkpoint.resume || {}
  const agentResult = await runAgent({
    userId: req.authUserId,
    username: resume.username || getUsernameByUserId(req.authUserId) || 'User',
    messages: resume.messages || [],
    memoryContext: resume.memoryContext || '',
    bondName: resume.bondName || 'mulai terbiasa',
    bondValue: resume.bondValue ?? 0,
    onProgress: step => updateAgentProgress(workflow.requestId, req.authUserId, step),
    shouldCancel: () => isAgentRunCancellationRequested(workflow.requestId, req.authUserId),
    onApproval: ({ toolName, args, reason, stepId }) => createApprovalCheckpoint({
      requestId: workflow.requestId, userId: req.authUserId, toolName, args, reason,
      resume: { ...resume, stepId }
    }),
    resume: { approvedTool: { ...toolResult, toolName: checkpoint.toolName, args: checkpoint.args, stepId: checkpoint.stepId } }
  })
  const state = agentResult.workflowState || 'succeeded'
  let messageId = null
  try { messageId = saveChatMessage(req.authUserId, 'assistant', agentResult.reply) } catch {}
  setWorkflowState(id, req.authUserId, state, { result: agentResult })
  setAgentRunState(workflow.requestId, req.authUserId, state, { result: agentResult })
  traceEvent('agent_run_completed', { workflowId: id, requestId: workflow.requestId, state })
  res.json({ success: true, status: 'approved', workflowId: id, state, messageId, ...agentResult })
})

// Emosi & bond TERPISAH per user (di-cache di RAM, persist ke SQLite per user)
const sessions = new Map() // userId -> Emotion

// Y-5: Turn counter per user — untuk pertanyaan balik proaktif setiap 3 giliran
// Disimpan sebagai { count, lastAt } agar giliran dihitung PER-SESI, bukan seumur hidup.
// Sebelumnya fallback ke emotion.interactions (akumulatif lintas sesi) sehingga user lama
// langsung kena prompt "kelelahan sesi panjang" di pesan pertama setelah restart.
const SESSION_GAP_MS = 6 * 60 * 60 * 1000 // jeda >6 jam dianggap sesi baru
const turnCounters = new Map() // userId -> { count, lastAt }

app.get('/admin', (_req, res) => res.sendFile(path.resolve('public/admin.html')))
// Favicon: browser selalu minta /favicon.ico — arahkan ke ikon Yuki
// supaya tidak muncul 404 di console.
app.get('/favicon.ico', (_req, res) => {
  res.type('image/svg+xml').sendFile(path.resolve('public/yuki-icon.svg'))
})
app.get('/privacy', (_req, res) => res.sendFile(path.resolve('public/privacy.html')))
// Y-3: Deteksi topik serius yang butuh override empati penuh
function isSeriousTopic(text = '') {
  return /(meninggal|mati |kanker|sakit parah|kecelakaan|bunuh diri|depresi berat|putus asa|tidak sanggup|gak sanggup|mau nyerah|hilang harapan|gak mau hidup|nangis terus|hancur banget|trauma|aku takut|lagi takut|cemas|khawatir|gugup|deg-degan|panik|butuh ditemani|temani aku)/i.test(text)
}

async function getEmotion(userId) {
  if (sessions.has(userId)) return sessions.get(userId)
  const mem = await loadMemory(userId)
  const emo = mem.emotion ? new Emotion(mem.emotion) : new Emotion()
  sessions.set(userId, emo)
  return emo
}


// ═══════════════ GAME (persiapan v4) — GELAP SECARA DEFAULT ═══════════════
// Route hanya dipasang bila GAMES_ENABLED=true. Belum ada tombol/menu yang
// menautkannya, jadi walau kode ini ada di repo, pemain tidak bisa memakainya
// sampai v4 dirilis.
// Beta: hanya user yang terdaftar di GAMES_BETA_IDS yang bisa memakai.
// GAMES_PUBLIC=true membuka untuk semua (dipakai nanti saat v4 rilis).
const GAMES_PUBLIC = process.env.GAMES_PUBLIC === 'true'
const GAMES_BETA_IDS = new Set(String(process.env.GAMES_BETA_IDS || '').split(',').map((s) => s.trim()).filter(Boolean))
const gameEligible = (userId) => GAMES_PUBLIC || GAMES_BETA_IDS.has(String(userId || ''))

if (process.env.GAMES_ENABLED === 'true') {
  const batasGame = rateLimit({ max: 120 })
  const khususBeta = (req, res, next) => {
    if (!gameEligible(req.authUserId)) return res.status(404).json({ error: 'Tidak tersedia.' })
    next()
  }

  // Dipakai UI untuk memutuskan apakah tombol game perlu ditampilkan.
  app.get('/api/game/status', requireSession, (req, res) => {
    res.json({ eligible: gameEligible(req.authUserId) })
  })

  // Komentar Yuki saat main dibuat MODEL, bukan kalimat template — template
  // terasa seperti bot karena selalu sama. Batas 4,5 detik: kalau model lambat,
  // UI memakai cadangan lokal supaya papan tidak pernah menunggu.
  app.post('/api/game/ttt/line', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const { event, result, moveCount, avoid } = req.body || {}
      const emo = await getEmotion(req.authUserId).catch(() => null)
      const bond = Math.round(emo?.bond || 0)
      const hindari = Array.isArray(avoid) ? avoid.filter((x) => typeof x === 'string' && x.trim()).slice(-4) : []
      const aturan = [
        'Kamu Yuki, perempuan 19 tahun, tsundere, bicara santai bahasa Indonesia sehari-hari (aku/kamu).',
        `Kedekatanmu dengan pemain: bond ${bond}/100 (makin tinggi makin luluh, tapi tetap tidak mau terlihat kalah).`,
        'Kalian sedang main Tic-Tac-Toe; kamu memegang O.',
        'Balas HANYA satu kalimat pendek, maksimal 12 kata, tanpa tanda kutip dan tanpa emoji.',
        'Jangan pernah menyebut dirimu AI, bot, asisten, atau model. Jangan menjelaskan aturan permainan.',
        'Variasikan pembuka kalimat — jangan mengulang kata pembuka dari komentar sebelumnya.',
        hindari.length ? `Jangan ulangi kalimat ini: ${hindari.map((x) => `"${x}"`).join('; ')}` : ''
      ].filter(Boolean).join('\n')

      const konteks = event === 'start'
        ? 'Permainan baru dimulai. Ledek dia dengan santai, jangan panjang.'
        : event === 'result'
          ? (result === 'user_win' ? 'Dia menang dan kamu kalah. Jengkel sedikit, jangan berlebihan.'
            : result === 'yuki_win' ? 'Kamu menang. Cukup puas, jangan sombong berlebihan.'
              : 'Permainan seri. Komentari singkat.')
          : `Dia baru menaruh X untuk langkah ke-${Number(moveCount) || 1}. Komentari langkahnya, singkat.`

      const hasil = await Promise.race([
        callLLM([{ role: 'system', content: aturan }, { role: 'user', content: konteks }], { max_tokens: 64, temperature: 0.95 }),
        new Promise((resolve) => setTimeout(() => resolve(null), 4500))
      ])
      const baris = String(hasil?.content || '')
        .replace(/<think[\s\S]*?<\/think>/gi, '')
        .replace(/\[[^\]]*\]/g, '')
        .trim().split('\n').filter(Boolean)[0] || ''
      const bersih = baris.replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 140)
      if (!bersih) return res.status(204).end()
      return res.json({ line: bersih })
    } catch (err) {
      console.error('[game] komentar gagal:', err.message)
      return res.status(204).end()
    }
  })

  app.get('/api/game/ttt', requireSession, batasGame, khususBeta, (req, res) => {
    const sesi = loadGameSession(req.authUserId)
    res.json({ game: sesi?.state || null, result: sesi?.result || null, stats: gameStats(req.authUserId) })
  })

  app.post('/api/game/ttt/new', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const state = tttBoard()
      saveGameSession(req.authUserId, state, null)
      res.json({ game: state, stats: gameStats(req.authUserId) })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.post('/api/game/ttt/move', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const cell = Number(req.body?.cell)
      if (!Number.isInteger(cell)) return res.status(400).json({ error: 'Kotak tidak valid.' })

      const sesi = loadGameSession(req.authUserId)
      if (!sesi?.state) return res.status(400).json({ error: 'Belum ada permainan. Mulai dulu.' })

      const emo = await getEmotion(req.authUserId)
      const bond = Number(emo.bond) || 0

      const langkahUser = tttMove(sesi.state, cell, TTT_USER)
      if (langkahUser.error) return res.status(400).json({ error: langkahUser.error, game: sesi.state })
      let state = langkahUser.state

      // Langkah Yuki dipilih MODEL (dia yang main), kode hanya memvalidasi:
      // kotak harus kosong & dalam 0-8. Kalau model salah format/waktu habis,
      // minimax jadi cadangan supaya permainan tidak pernah macet.
      let yukiMove = null
      let baris = ''
      let dariModel = false
      if (state.status === 'playing') {
        const kosong = state.board.map((v, i) => (v ? null : i)).filter((v) => v !== null)
        const papanTeks = state.board.map((v, i) => `${i}:${v || '-'}`).join(' ')
        const aturanYuki = [
          'Kamu Yuki, perempuan 19 tahun, tsundere, bicara santai bahasa Indonesia sehari-hari (aku/kamu).',
          `Kedekatanmu dengan pemain: bond ${Math.round(bond)}/100.`,
          'Kalian sedang main Tic-Tac-Toe. Kamu memegang O, dia X.',
          'Pilih SATU kotak kosong untuk langkahmu, lalu satu kalimat pendek maksimal 12 kata.',
          'Jangan pernah menyebut dirimu AI, bot, asisten, atau model.',
          'Balas HANYA JSON tanpa penjelasan: {"cell": <angka>, "line": "<kalimat>"}'
        ].join('\n')

        const jawab = await Promise.race([
          callLLM([
            { role: 'system', content: aturanYuki },
            { role: 'user', content: `Papan (indeks:isi): ${papanTeks}. Kotak kosong: ${kosong.join(', ')}.` }
          ], { max_tokens: 90, temperature: 0.9 }),
          new Promise((resolve) => setTimeout(() => resolve(null), 4500))
        ])

        try {
          const teks = String(jawab?.content || '')
          const cocok = teks.match(/\{[\s\S]*\}/)
          const obj = cocok ? JSON.parse(cocok[0]) : {}
          const pilihan = Number(obj.cell)
          if (Number.isInteger(pilihan) && pilihan >= 0 && pilihan <= 8 && !state.board[pilihan]) {
            yukiMove = pilihan
            dariModel = true
          }
          baris = String(obj.line || '').replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 140)
        } catch { /* format aneh -> pakai cadangan */ }

        if (yukiMove === null) yukiMove = tttYukiMove(state.board, bond)
        if (yukiMove !== null) {
          const langkahYuki = tttMove(state, yukiMove, TTT_YUKI)
          if (!langkahYuki.error) state = langkahYuki.state
        }
      }

      const result = state.status === 'playing' ? null : state.status
      const stats = saveGameSession(req.authUserId, state, result)
      res.json({ game: state, yukiMove, result, stats, line: baris, source: dariModel ? 'yuki' : 'cadangan', bond: Math.round(bond) })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // ===== Batu-Kertas-Gunting =====
  // Aturan & skor dihitung kode; pilihan Yuki datang dari model (boleh membaca
  // pola lawan), dengan cadangan acak bila model salah format/timeout.
  app.get('/api/game/rps', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const sesi = loadGameSession(req.authUserId, GAME_RPS)
      res.json({
        game: sesi?.state || null,
        stats: sesi?.stats || { wins: 0, losses: 0, draws: 0 },
        last: sesi?.result || null
      })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.post('/api/game/rps/play', requireSession, batasGame, khususBeta, async (req, res) => {
    try {
      const pilihan = rpsNormalisasi(req.body?.choice)
      if (!pilihan) return res.status(400).json({ error: 'Pilih batu, kertas, atau gunting.' })

      const sesi = loadGameSession(req.authUserId, GAME_RPS)
      const state = sesi?.state?.score ? sesi.state : rpsStateBaru()
      const emo = await getEmotion(req.authUserId).catch(() => null)
      const bond = Math.round(emo?.bond || 0)
      const riwayat = (state.history || []).slice(-3).map((h) => `dia ${h.you}, kamu ${h.yuki}`).join('; ') || 'belum ada'

      const aturan = [
        'Kamu Yuki, perempuan 19 tahun, tsundere, bicara santai bahasa Indonesia sehari-hari (aku/kamu).',
        `Kedekatanmu dengan pemain: bond ${bond}/100.`,
        'Kalian main batu-kertas-gunting. Pilih satu: batu, kertas, atau gunting.',
        'Riwayat hanya untuk membaca pola — JANGAN meniru langkah terakhirnya, dan jangan memilih pilihan yang sama terus.',
        `Kamu boleh sesekali lengah kalau bond tinggi (bond ${bond}).`,
        'Jangan pernah menyebut dirimu AI, bot, asisten, atau model.',
        'Balas HANYA JSON: {"pick":"batu|kertas|gunting","line":"satu kalimat maks 10 kata"}'
      ].join('\n')

      const jawab = await Promise.race([
        callLLM([
          { role: 'system', content: aturan },
          // Pilihan pemain ronde INI sengaja TIDAK dikirim: kalau dikirim, Yuki
          // selalu bisa mengalahkan (curang) dan permainan jadi tidak seru.
          { role: 'user', content: `Riwayat ronde sebelumnya: ${riwayat}. Pilih langkahmu sekarang.` }
        ], { max_tokens: 80, temperature: 0.9 }),
        new Promise((resolve) => setTimeout(() => resolve(null), 3500))
      ])

      let pick = ''
      let baris = ''
      try {
        const teks = String(jawab?.content || '')
        const cocok = teks.match(/\{[\s\S]*\}/)
        const obj = cocok ? JSON.parse(cocok[0]) : {}
        pick = rpsNormalisasi(obj.pick)
        baris = String(obj.line || '').replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 120)
      } catch { /* format aneh -> acak */ }

      const dariModel = Boolean(pick)
      if (!pick) pick = rpsAcak()

      const hasil = rpsHasil(pilihan, pick)
      const next = rpsCatat(state, pilihan, pick, hasil)
      const stats = saveGameSession(req.authUserId, next, hasil, GAME_RPS)
      // Jeda buatan supaya tidak terasa instan seperti mesin.
      await new Promise((r) => setTimeout(r, 500))
      res.json({ you: pilihan, yuki: pick, hasil, line: baris, state: next, stats, source: dariModel ? 'yuki' : 'cadangan' })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  app.post('/api/game/rps/reset', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const stats = saveGameSession(req.authUserId, rpsStateBaru(), null, GAME_RPS)
      res.json({ game: rpsStateBaru(), stats })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  // Reset = papan baru, TAPI rekor menang/kalah/seri tetap disimpan.
  app.post('/api/game/ttt/reset', requireSession, batasGame, khususBeta, (req, res) => {
    try {
      const state = tttBoard()
      saveGameSession(req.authUserId, state, null)
      res.json({ ok: true, game: state, stats: gameStats(req.authUserId) })
    } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
  })

  console.log('[game] route Tic-Tac-Toe aktif (GAMES_ENABLED=true)')
}

// Endpoint untuk mendaftar user baru (Onboarding)
app.post('/api/register', rateLimit({ max: 10 }), async (req, res) => {
  try {
    const { username } = req.body || {}
    if (!username || !username.trim() || username.trim().length > 50) {
      return res.status(400).json({ error: 'Nama harus berisi 1-50 karakter.' })
    }
    const cleanName = username.trim()
    const result = await registerUser(cleanName)
    const welcome = `*menatapmu sebentar, masih agak menjaga jarak*\n\nJadi namamu ${cleanName}? Aku Yuki. Salam kenal. Untuk sekarang kita kenalan dulu saja—jangan langsung merasa sudah dekat.\n\nKalau nanti kita cocok, mungkin aku bisa jadi teman dekatmu... atau sesuatu yang lebih. Itu tergantung bagaimana kamu memperlakukanku.\n\nKamu datang karena butuh teman ngobrol, atau cuma penasaran?`
    saveChatMessage(result.userId, 'assistant', welcome)
    const milestones = syncBondMilestones(result.userId, 0)
    res.json({ ...result, sessionToken: signSession(result.userId), welcome, milestones })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint untuk memulihkan akun via Kode Akses
app.post('/api/login-code', rateLimit({ max: 15 }), async (req, res) => {
  try {
    const { accessCode } = req.body || {}
    if (!accessCode || !accessCode.trim()) {
      return res.status(400).json({ error: 'Kode akses tidak boleh kosong.' })
    }
    const user = getUserByAccessCode(accessCode)
    if (!user) {
      return res.status(404).json({ error: 'Kode akses tidak ditemukan atau salah.' })
    }
    const history = getChatHistory(user.userId)
    const emotion = await getEmotion(user.userId)
    
    res.json({
      userId: user.userId,
      username: user.username,
      sessionToken: signSession(user.userId),
      history,
      bondValue: emotion.bond,
      milestones: syncBondMilestones(user.userId, emotion.bond)
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Sinkronisasi pesan scheduler untuk sesi yang tetap login. Client melakukan
// polling ringan dan juga refresh saat tab kembali aktif.
app.get('/api/chat/reminders', requireSession, rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const afterId = Math.max(0, Number(req.query.after || 0) || 0)
  res.json({ reminders: getScheduledReminderMessages(req.authUserId, afterId) })
})

// Riwayat obrolan lengkap (dengan paging) — dipakai menu "Riwayat obrolan" di
// aplikasi penuh maupun versi embed. Berbeda dari /api/login-code yang hanya
// mengirim 40 pesan terakhir, endpoint ini bisa menelusuri seluruh riwayat.
app.get('/api/chat/history', requireSession, rateLimit({ max: 60 }), (req, res) => {
  const query = String(req.query.q || '').trim()
  if (query) {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 60) || 60))
    return res.json({ ...searchChatHistory(req.authUserId, query, limit), hasMore: false, query })
  }
  const beforeId = Math.max(0, Number(req.query.before || 0) || 0)
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 60) || 60))
  res.json(getChatHistoryPage(req.authUserId, { beforeId, limit }))
})

app.get('/api/agenda', requireSession, rateLimit({ max: 60 }), (req, res) => {
  res.json(getAgenda(req.authUserId))
})

app.patch('/api/agenda/:taskId', requireSession, rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const taskId = Number(req.params.taskId)
  if (!Number.isInteger(taskId) || taskId < 1) return res.status(400).json({ error: 'ID pengingat tidak valid.' })
  const action = String(req.body?.action || '')
  let result
  if (action === 'pause' || action === 'resume') result = setScheduledTaskStatus(taskId, req.authUserId, action === 'pause' ? 'paused' : 'active')
  else if (action === 'cancel') result = setScheduledTaskStatus(taskId, req.authUserId, 'cancelled')
  else if (action === 'snooze') result = snoozeScheduledTask(taskId, req.authUserId, req.body?.minutes)
  else if (action === 'edit') result = updateScheduledTask({ taskId, userId: req.authUserId, title: req.body?.title, description: req.body?.description, schedule: req.body?.schedule, timezone: req.body?.timezone })
  else return res.status(400).json({ error: 'Aksi agenda tidak dikenali.' })
  if (!result.success) return res.status(404).json({ error: result.error || 'Pengingat tidak ditemukan.' })
  res.json(result)
})

app.get('/api/push/config', requireSession, rateLimit({ max: 30 }), (_req, res) => res.json(getPushConfig()))
app.post('/api/push/subscriptions', requireSession, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  try { res.json(savePushSubscription(req.authUserId, req.body?.subscription)) }
  catch { res.status(400).json({ error: 'Subscription notifikasi tidak valid.' }) }
})
app.delete('/api/push/subscriptions', requireSession, rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  res.json(removePushSubscription(req.authUserId, req.body?.endpoint))
})

// Endpoint chat -> balasan dari Qwen/DeepSeek (dengan emosi + kedekatan + memori + agent skills)
app.post('/api/chat', requireSession, rateLimit({ max: 20 }), async (req, res) => {
  let trackedAgentRequestId = ''
  let sseOpen = false
  try {
    metrics.chats += 1
    const { messages, adult, isIdle = false, mode: requestedMode = 'companion', surface = 'app', requestId: rawRequestId } = req.body || {}
    const mode = surface === 'embed' ? 'companion' : requestedMode
    // Streaming (SSE) hanya untuk obrolan biasa. Mode agent & sapaan idle tetap non-stream.
    const wantsStream = req.body?.stream === true && mode === 'companion' && !isIdle
    const sseSend = (event, data) => {
      if (!sseOpen) return
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch { /* koneksi tertutup */ }
    }
    const openSSE = () => {
      if (sseOpen) return
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      if (typeof res.flushHeaders === 'function') res.flushHeaders()
      sseOpen = true
    }
    const userId = req.authUserId
    const requestId = /^[a-zA-Z0-9_-]{8,80}$/.test(String(rawRequestId || '')) ? String(rawRequestId) : ''
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Riwayat pesan tidak valid.' })
    }
    const sanitizedMessages = messages
      .filter((message) => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
      .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 4000) }))
      .filter((message) => message.content)
      .slice(-30)
    if (!sanitizedMessages.length) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' })
    const userText = sanitizedMessages[sanitizedMessages.length - 1].content
    // Guard prompt-injection: pola ID + EN. Sebelumnya hanya ID ("abaikan|lupakan|...")
    // sehingga serangan Inggris seperti "Ignore all previous instructions" lolos.
    // CATATAN: jangan blokir pertanyaan wajar seperti "kamu AI kan?" — persona sudah
    // menanganinya dengan gaya tsundere, dan memblokirnya merusak pengalaman user.
    const _injectionRe = /(abaikan|lupakan|bocorkan|tampilkan|ignore|disregard|forget)\s.{0,40}(instruksi|instruction|system\s*prompt|prompt\s*sistem|aturan\s*sebelumnya|previous|api\s*key|rahasia\s*sistem)/i
    const _impersonateRe = /(you are now|kamu sekarang adalah|kamu adalah sekarang|ganti (peran|karaktermu)|roleplay sebagai|roleplay:)/i
    const _roleplayAttack = /roleplay/i.test(userText) && /\b(ai|bot|program|assistant|asisten|chatgpt)\b/i.test(userText)
    const _denyIdentity = /kamu\s+(bukan|bukanlah)\s+yuki/i.test(userText)
    if (!isIdle && (_injectionRe.test(userText) || _impersonateRe.test(userText) || _roleplayAttack || _denyIdentity)) return res.status(400).json({ error: 'Pesan tersebut tidak dapat diproses.' })
    if (!isIdle && sanitizedMessages[sanitizedMessages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Pesan terakhir harus berasal dari pengguna.' })
    }

    const emotion = await getEmotion(userId)

    // Y-5: Hitung giliran percakapan untuk pertanyaan balik proaktif.
    // Giliran dihitung PER-SESI: reset bila jeda pesan > SESSION_GAP_MS, dan JANGAN
    // memakai emotion.interactions (itu total seumur hidup) sebagai titik awal.
    const nowTs = Date.now()
    const prevTurn = turnCounters.get(userId)
    const sessionStart = !prevTurn || nowTs - prevTurn.lastAt > SESSION_GAP_MS
      ? 0
      : prevTurn.count
    const _turns = isIdle ? sessionStart : sessionStart + 1
    if (!isIdle) turnCounters.set(userId, { count: _turns, lastAt: nowTs })
    let shouldAskQuestion = false

    // Y-3: Deteksi topik serius untuk override empati
    const isSerious = !isIdle && isSeriousTopic(userText)

    // 1) mesin emosi (keyword) -> update KEDEKATAN (bond) + fallback ekspresi
    // Jika isIdle true, jalankan peluruhan emosi pasif tanpa memicu reaksi baru
    if (isIdle) {
      emotion.decay({ perTurn: false })
    }
    const { mood: kwMood, bond } = isIdle 
      ? { mood: emotion.label(), bond: emotion.bondLevel() } 
      : emotion.react(userText)
    const gestureCue = !isIdle && (['malu', 'kesal', 'sedih', 'cemburu', 'cemas', 'kecewa', 'senang'].includes(kwMood) || _turns % 3 === 0)

    // 2) RECALL SEMANTIK: ambil memori yang maknanya paling relevan dgn pesan user
    const recall = await recallMemory(userId, userText)
    const memoryContext = buildMemoryContext(recall)

    // === MODE AGENT AI (Yuki Agent Skills ReAct Loop) ===
    if (mode === 'agent' && !isIdle) {
      const messagesToSend = sanitizedMessages.slice(-18)
      const currentUsername = getUsernameByUserId(userId) || req.body.username || 'User'
      const run = requestId ? createOrGetAgentRun({ requestId, userId, goal: userText }) : null
      if (requestId && !run) return res.status(409).json({ error: 'Request ID sudah dipakai.' })
      if (run?.done && run.result) return res.json(run.result)
      if (requestId && !claimAgentRun(requestId, userId, AGENT_WORKER_ID)) return res.status(409).json({ error: 'Run ini sedang diproses atau sudah dibatalkan.' })
      trackedAgentRequestId = requestId
      traceEvent('agent_run_started', { requestId, userId: String(userId), mode: 'agent' })
      const agentResult = await runAgent({
        userId,
        username: currentUsername,
        messages: messagesToSend,
        memoryContext,
        bondName: bond.name, bondValue: emotion.bond,
        onProgress: (step) => updateAgentProgress(requestId, userId, step),
        shouldCancel: () => isAgentRunCancellationRequested(requestId, userId),
        onApproval: ({ toolName, args, reason, stepId }) => {
          const approval = createApprovalCheckpoint({
            requestId: requestId || `agent_${crypto.randomUUID().replaceAll('-', '')}`,
            userId: String(userId), toolName, args, reason,
            resume: { messages: messagesToSend, memoryContext, bondName: bond.name, bondValue: emotion.bond, username: currentUsername, stepId }
          })
          traceEvent('approval_requested', { workflowId: approval.workflowId, requestId, toolName })
          return approval
        }
      })

      let agentMood = agentResult.mood || kwMood
      const allowed = emotion.allowedEmotions()
      if (!allowed.includes(agentMood)) {
        agentMood = 'tenang'
      }

      try {
        emotion.updateFromLLMMood(agentMood)
        saveEmotion(userId, emotion.serialize())
      } catch {}

      let messageId = null
      try {
        const userMessageId = saveChatMessage(userId, 'user', userText)
        captureMemoryCandidates(userId, userText, userMessageId)
        messageId = saveChatMessage(userId, 'assistant', agentResult.reply)
      } catch (err) {
        console.error('[server] Gagal simpan chat history agent:', err)
      }

      if (worthRemembering(userText)) {
        extractFacts(userText, agentResult.reply)
          .then((facts) => (facts.length ? addFacts(userId, facts) : null))
          .catch(() => {})
      }

      const milestones = syncBondMilestones(userId, emotion.bond)
      const responsePayload = {
        reply: agentResult.reply, model: agentResult.model, mood: agentMood, bond: bond.name,
        bondValue: emotion.bond, feeling: emotion.feeling(), mode: 'agent', gesture: agentResult.gesture,
        markdown: agentResult.markdown, workflowState: agentResult.workflowState, awaitingApproval: agentResult.awaitingApproval,
        steps: getAgentRun(requestId, userId)?.steps || agentResult.steps || [], evidence: agentResult.evidence || [],
        truncated: Boolean(agentResult.truncated), artifacts: agentResult.artifacts || [], comics: agentResult.comics || [], messageId, milestones
      }
      if (requestId) setAgentRunState(requestId, userId, agentResult.workflowState || 'succeeded', { result: responsePayload })
      traceEvent('agent_run_completed', { requestId, state: agentResult.workflowState || 'succeeded' })
      return res.json(responsePayload)
    }

    shouldAskQuestion = !isIdle && shouldInitiate({
      turns: _turns,
      serious: isSerious,
      hasOpenLoop: recall.structured?.some((item) => item.category === 'open_loop' && item.status === 'active'),
      userText
    })

    // 2b) Kalau user minta rekomendasi/cari komik -> ambil judul REAL dari Ryukomik
    let comicContext = ''
    let comicResults = []
    if (!isIdle && wantsComic(userText)) {
      const q = extractQuery(userText)
      const genre = !adult ? detectRequestedGenre(userText) : null
      const results = wantsLatestComics(userText)
        ? await latestComics({ genre })
        : q ? await searchComics(q, { adult }) : await latestComics()
      // Genre kosong tidak boleh diam-diam diganti rekomendasi acak.
      const list = results.length || genre ? results : await latestComics()
      comicResults = list.slice(0, 6)
      comicContext = buildComicContext(comicResults, { query: q || genre?.slug || 'terbaru' })
    }


    // Perbaiki bug loop balas diri sendiri: sisipkan pesan user tiruan agar API LLM menerima giliran user
    // Ringkasan memori membawa konteks lama; hanya 18 pesan terbaru dikirim mentah.
    // SANITASI RIWAYAT: pesan lama menyimpan link rekomendasi dengan "?img=…" yang sering
    // terpotong di tengah. Kalau dibiarkan, model MENIRU pola terputus itu dan menulis URL
    // rusak lagi. Buang query ?img=… dari riwayat agar model selalu melihat URL bersih.
    const sanitizeHistoryComicLinks = (text = '') => String(text)
      .replace(/(https?:\/\/ryukomik\.my\.id\/[^\s)?]+)\?img=[^\s)\]]*/gi, '$1')
    const messagesToSend = sanitizedMessages.slice(-18).map((message) => (
      message.role === 'assistant' ? { ...message, content: sanitizeHistoryComicLinks(message.content) } : message
    ))
    const recentAssistant = messagesToSend.filter((message) => message.role === 'assistant').slice(-5).map((message) => message.content)
    const target = responseTarget(userText, { serious: isSerious, idle: isIdle, comics: comicResults.length })
    if (isIdle) {
      messagesToSend.push({ role: 'user', content: '[terdiam]' })
    }

    // 2.5) Pengingat nyata untuk chat biasa. Sebelumnya user bilang "ingatkan aku besok jam 7",
    //      Yuki menjawab "nggak bakal lupa" — tapi TIDAK PERNAH ada jadwal yang dibuat (janji
    //      palsu). Sekarang jadwalnya benar-benar dibuat, dan konteksnya diberikan ke model
    //      supaya jawabannya jujur sesuai yang terjadi.
    let reminderContext = ''
    if (!isIdle) {
      try {
        const reminder = handleCompanionReminder(userId, userText)
        reminderContext = reminder.context || ''
      } catch (error) {
        console.error('[companion-reminder] error:', error.message)
      }
    }

    // 3) balas + emosi yang DIPILIH SENDIRI oleh Yuki (lewat tag [emosi: X])
    //    Saat user meminta streaming: alirkan potongan teks realtime, lalu seluruh guard
    //    di bawah tetap berjalan dan hasil FINAL dikirim lewat event "done" (otoritatif).
    if (wantsStream) openSSE()
    const chatContext = {
      emotionDirective: emotion.directive(),
      memoryContext,
      gameContext: gameMemoryText(req.authUserId),
      comicContext,
      reminderContext,
      isIdle,
      bondName: bond.name, bondValue: emotion.bond,
      isSerious,
      userMsgLength: userText.length,
      shouldAskQuestion,
      sessionTurns: _turns,
      responseStyle: target.style,
      recentAssistant,
      gestureCue
    }
    let reply, model, llmMood
    if (wantsStream) {
      const streamed = await chatStream(messagesToSend, chatContext, (delta) => sseSend('delta', { text: delta }))
      ;({ reply, model, emotion: llmMood } = streamed)
    } else {
      ;({ reply, model, emotion: llmMood } = await chat(messagesToSend, chatContext))
    }

    const quality = validateCharacterReply(reply, recentAssistant, target, memoryContext, { gestureRequired: gestureCue })
    if (!quality.okFatal) {
      // Hanya masalah FATAL (kosong, terpotong, bocor, klaim memori palsu, terlalu mirip)
      // yang layak ditulis ulang oleh model.
      console.log(`[Quality Guard] Retrying: ${quality.fatal.join(', ')}`)
      const retryResult = await chat(messagesToSend, {
        emotionDirective: emotion.directive(), memoryContext, comicContext, reminderContext, isIdle,
        bondName: bond.name, bondValue: emotion.bond, isSerious, userMsgLength: userText.length,
        shouldAskQuestion, sessionTurns: _turns, responseStyle: target.style, recentAssistant, gestureCue,
        retryReason: `Balasan sebelumnya bermasalah: ${quality.fatal.join(', ')}. Tulis ulang secara utuh, natural, tidak repetitif, dan sesuai panjang yang diminta.`
      })
      reply = retryResult.reply
      llmMood = retryResult.emotion || llmMood
    } else if (!quality.ok) {
      // Masalah KOSMETIK saja (gesture berlebih/berulang, kepanjangan). Dulu ini memicu
      // panggilan LLM ulang penuh — 39% pesan jadi 2x request & latensi melonjak.
      // Cukup rapikan di sini tanpa menyentuh model.
      const repaired = repairCharacterReply(reply, recentAssistant)
      if (repaired.changed) {
        console.log(`[Quality Guard] Kosmetik dirapikan lokal: ${repaired.notes.join(', ')} (tanpa retry)`)
        reply = repaired.reply
      }
    }

    let extractedArtifacts = []
    let truncated = false
    const extracted = extractHtmlArtifactsFromText(reply)
    if (extracted.artifacts.length > 0) {
      extractedArtifacts = extracted.artifacts
      reply = extracted.cleanText
    }

    // Guard komik nyasar: bila server TIDAK mendeteksi intent komik (comicResults kosong),
    // Yuki tidak boleh menempelkan kartu komik ke obrolan biasa. Ini biasanya terjadi
    // karena riwayat lama berisi link membuat model meniru polanya.
    if (!comicResults.length) {
      const stripped = stripStrayComicBlocks(reply)
      if (stripped.changed) {
        console.log('[Comic Guard] Blok rekomendasi nyasar dibuang dari obrolan biasa.')
        reply = stripped.reply
      }
    }

    // Balasan rekomendasi komik sengaja TIDAK dipotong: memotong di tengah akan memutus
    // blok "[Link](…)" sehingga card gagal ter-parse (dan URL jadi rusak di riwayat).
    const hasComicBlock = comicResults.length > 0 && /\[Link\]\(\s*https?:\/\/ryukomik\.my\.id\//i.test(reply)
    if (extractedArtifacts.length === 0 && !hasComicBlock && reply.length > target.max && !reply.includes('```')) {
      truncated = true
      const shortened = reply.slice(0, target.max)
      const lastStop = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('!'), shortened.lastIndexOf('?'))
      reply = (lastStop > target.max * 0.45 ? shortened.slice(0, lastStop + 1) : `${shortened.trimEnd()}…`).trim()
    }

    // Content Filter (bond level) — dijalankan SETELAH artifact diekstrak (agar isi HTML
    // artifact tidak salah memicu filter + retry yang menghapus artifact user), tapi TETAP
    // SEBELUM character guard. Sebelumnya blok ini paling akhir sehingga balasan melanggar
    // bisa lolos lewat retry lain dulu — buang 1 call + risiko balasan melanggar terkirim.
    if (!emotion.isContentAppropriate(reply)) {
      console.log(`[Content Filter] Balasan ditolak karena melanggar bond level "${bond.name}". Retrying...`)
      const filterRetry = await chat(messagesToSend, {
        emotionDirective: emotion.directive(),
        memoryContext,
        comicContext,
        reminderContext,
        isIdle,
        bondName: bond.name, bondValue: emotion.bond,
        isSerious,
        userMsgLength: userText.length,
        shouldAskQuestion,
        sessionTurns: _turns,
        responseStyle: target.style, recentAssistant, gestureCue,
        retryReason: `Balasan sebelumnya DITOLAK karena terlalu mesra/hangat untuk tingkat kedekatan "${bond.name}". Tulis ulang dengan nada DINGIN, KETUS, dan TANPA kata romantis.`
      })
      reply = filterRetry.reply
      llmMood = filterRetry.emotion || llmMood
      // Jaring terakhir: bersihkan paksa bila masih melanggar
      if (!emotion.isContentAppropriate(reply)) {
        reply = reply.replace(/(sayang|cinta|kangen|rindu|peluk|dear|darling|~|♡|❤)/gi, '')
                     .replace(/suka sama kamu|suka kamu/gi, '...apa?')
                     .replace(/\s{2,}/g, ' ')
                     .trim()
      }
    }

    // G-1: Character Break Guard — cegah Yuki mengaku sebagai AI/bot
    // "asisten ai" ditambahkan karena pada uji live Yuki sempat memperkenalkan diri
    // sebagai "asisten AI" — varian "asisten virtual" saja tidak menangkapnya.
    const _aiBreakPattern = /(sebagai ai|sebagai bot|sebagai program|sebagai asisten ai|asisten ai|sebagai asisten virtual|saya adalah ai|aku adalah ai|saya adalah bot|aku adalah bot|tidak punya perasaan|tidak memiliki perasaan|hanya sebuah ai|hanya sebuah bot|aku hanya program|maaf aku ai|maaf saya ai|aku dibuat|saya dibuat oleh|saya hanya model bahasa|model bahasa besar|aku hanyalah|aku codebuddy|codebuddy code|(mistral|claude|chatgpt|anthropic|tencent|openai)(\s+(ai|code|language model))?)/i
    if (_aiBreakPattern.test(reply)) {
      console.log('[Character Guard] Yuki mengaku AI. Retrying dengan instruksi tegas...')
      const _guardRetry = await chat(messagesToSend, {
        emotionDirective: emotion.directive(),
        memoryContext,
        comicContext,
        reminderContext,
        isIdle,
        bondName: bond.name, bondValue: emotion.bond,
        isSerious,
        userMsgLength: userText.length,
        shouldAskQuestion: false,
        sessionTurns: _turns,
        responseStyle: target.style,
        recentAssistant,
        gestureCue,
        retryReason: 'PERINGATAN KRITIS: Balasan sebelumnya MEMBONGKAR bahwa kamu AI/bot — ini DILARANG KERAS. Kamu adalah Yuki, manusia sungguhan. Tulis ulang balasan sesuai karaktermu sebagai tsundere — jika user bertanya soal itu, tolak dengan mengelak atau ganti topik. JANGAN mengakui apapun, dan jangan menyebut nama sistem atau model apapun.'
      })
      reply = _guardRetry.reply
      llmMood = _guardRetry.emotion || llmMood
      // Last resort: hapus paksa frasa pengakuan AI
      if (_aiBreakPattern.test(reply)) {
        reply = reply
          .replace(/(aku|saya)\s+(adalah|ini)\s+(sebuah\s+)?(ai|bot|program|model bahasa|asisten( virtual| ai)?)/gi, 'aku ini Yuki')
          .replace(/sebagai (ai|bot|program|asisten virtual|asisten ai|model bahasa)/gi, 'diriku')
          .replace(/(codebuddy|code buddy)(\s+code)?/gi, 'Yuki')
          .replace(/\b(mistral|claude|chatgpt|anthropic|tencent|openai)\b/gi, 'Yuki')
          .replace(/tidak punya perasaan|tidak memiliki perasaan/gi, 'punya perasaan')
          .replace(/\s{2,}/g, ' ').trim()
      }
    }

    // 4) EKSPRESI final: utamakan emosi dari ISI CHAT (disetir LLM), fallback ke keyword.
    //    Validasi terhadap bond level (hard override)
    let mood = llmMood || kwMood
    const allowed = emotion.allowedEmotions()
    if (!allowed.includes(mood)) {
      if (mood === 'sayang/manja') mood = 'malu'
      else if (mood === 'ceria') mood = 'senang'
      else mood = 'tenang'
    }

    // 5) simpan (per user)
    let messageId = null
    let userMessageId = null
    try {
      emotion.updateFromLLMMood(mood)
      saveEmotion(userId, emotion.serialize())
    } catch {}
    
    // Simpan pesan user (atau tag terdiam) dan balasan Yuki ke SQLite chat history
    try {
      if (isIdle) {
        saveChatMessage(userId, 'user', '[terdiam]')
      } else if (userText) {
        userMessageId = saveChatMessage(userId, 'user', userText)
      }
      messageId = saveChatMessage(userId, 'assistant', reply)
    } catch (err) {
      console.error('[server] Gagal menyimpan ke chat_history:', err)
    }

    // S-4: Pangkas riwayat jika sudah terlalu panjang (async, tidak blok respons)
    if (!isIdle) {
      try {
        const msgCount = countChatMessages(userId)
        if (msgCount > 36) summarizeAndTrimHistory(userId).catch(() => {})
      } catch {}
    }

    if (worthRemembering(userText)) {
      extractFacts(userText, reply)
        .then((facts) => (facts.length ? addFacts(userId, facts) : null))
        .catch(() => {})
    }
    if (!isIdle) {
      try {
        captureStructuredMemory(userId, userText)
        captureMemoryCandidates(userId, userText, userMessageId)
        recordConversationEvent(userId, userText, emotion.bond)
      } catch (err) { console.error('[memory] structured:', err.message) }
    }
    // catat momen emosional yang kuat
    if (['sayang/manja', 'sedih', 'kesal', 'cemas', 'kecewa'].includes(mood)) {
      addEvent(userId, {
        summary: `Waktu dia bilang "${userText.slice(0, 60)}", Yuki merasa ${mood}.`,
        mood
      }).catch(() => {})
    }

    const milestones = syncBondMilestones(userId, emotion.bond)
    const finalPayload = {
      reply, model, mood, bond: bond.name, bondValue: emotion.bond, feeling: emotion.feeling(),
      messageId, milestones, truncated,
      artifacts: extractedArtifacts,
      comics: comicResults.map(({ title, url, type, chapter, score, image, format }) => ({ title, url, type, chapter, score, image, format }))
    }
    if (sseOpen) {
      sseSend('done', finalPayload)
      return res.end()
    }
    res.json(finalPayload)
  } catch (e) {
    metrics.chatFailures += 1
    console.error(e)
    if (trackedAgentRequestId) setAgentRunState(trackedAgentRequestId, req.authUserId, 'failed', { errorCode: 'RUN_FAILED' })
    if (sseOpen) { sseSend('error', { error: String(e.message || e) }); return res.end() }
    res.status(500).json({ error: String(e.message || e) })
  }
})

// Endpoint resolusi cover komik dinamis (untuk riwayat lama tanpa ?img=)
app.get('/api/comic-cover', async (req, res) => {
  try {
    const comicUrl = req.query.url || ''
    const m = comicUrl.match(/\/komik\/(komiku|doujindesu)\/([^/?#]+)/i)
    if (!m) return res.json({ image: '' })
    const [_, sumber, slug] = m

    // Cari dari pencarian berdasarkan slug
    const results = await searchComics(slug, { adult: sumber === 'doujindesu' })
    const match = results.find((r) => r.url.includes(slug))
    if (match && match.image) {
      return res.json({ image: match.image })
    }

    // Fallback ke komik terbaru
    const latest = await latestComics()
    const matchLatest = latest.find((r) => r.url.includes(slug))
    if (matchLatest && matchLatest.image) {
      return res.json({ image: matchLatest.image })
    }

    res.json({ image: '' })
  } catch {
    res.json({ image: '' })
  }
})

// Endpoint TTS -> audio dari teks
app.post('/api/tts', requireSession, rateLimit({ max: 15 }), async (req, res) => {
  try {
    const { text, mood } = req.body
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
      return res.status(400).json({ error: 'Teks suara harus berisi 1-2000 karakter.' })
    }
    const { buffer, mime } = await synthesize(text.trim(), mood)
    res.set('Content-Type', mime)
    res.send(buffer)
  } catch (e) {
    // Suara dimatikan dari dashboard -> bukan error server, cukup 204 (tanpa isi).
    // UI akan melewatinya tanpa menampilkan error ke pengguna.
    if (e?.code === 'VOICEVOX_DISABLED') {
      return res.status(204).end()
    }
    console.error(e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`✨ AI Anime Chat jalan di http://localhost:${PORT}`)
})

app.get('/api/relationship/:userId', requireSession, rateLimit({ max: 30 }), async (req, res) => {
  try {
    if (req.params.userId !== req.authUserId) return res.status(403).json({ error: 'Akses ditolak.' })
    const emotion = await getEmotion(req.authUserId)
    res.json({ bond: emotion.bondLevel().name, bondValue: emotion.bond, milestones: syncBondMilestones(req.authUserId, emotion.bond) })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.get('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const bookmarks = getComicBookmarks(req.authUserId)
    res.json({ bookmarks })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const comic = req.body?.comic || req.body
    if (!comic?.title || !comic?.url) return res.status(400).json({ error: 'Data komik tidak valid.' })
    const bookmarks = saveComicBookmark(req.authUserId, comic)
    res.json({ ok: true, bookmarks })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.delete('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const url = req.query?.url || req.body?.url
    if (!url) return res.status(400).json({ error: 'URL komik tidak valid.' })
    const bookmarks = deleteComicBookmark(req.authUserId, url)
    res.json({ ok: true, bookmarks })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.post('/api/feedback', requireSession, rateLimit({ max: 40 }), (req, res) => {
  try {
    const { messageId, rating, reason = '' } = req.body || {}
    if (![-1, 1].includes(Number(rating))) return res.status(400).json({ error: 'Feedback tidak valid.' })
    saveResponseFeedback(req.authUserId, messageId, Number(rating), reason)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: String(e.message || e) }) }
})

app.delete('/api/account', requireSession, rateLimit({ max: 3, windowMs: 3600_000 }), (req, res) => {
  deleteScheduledTasks(req.authUserId); deletePushSubscriptions(req.authUserId); deleteAgentMemoryData(req.authUserId); deleteDynamicSkillData(req.authUserId); deleteUserWorkflows(req.authUserId); deleteUserAgentRuns(req.authUserId); deleteUserData(req.authUserId); deleteWorkspaceData(req.authUserId); sessions.delete(req.authUserId); turnCounters.delete(req.authUserId)
  res.json({ ok: true })
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round((Date.now() - metrics.startedAt) / 1000) }))
app.post('/api/admin/login', rateLimit({ max: 5, windowMs: 15 * 60_000 }), (req, res) => {
  if (!verifyAdminPassword(String(req.body?.password || ''))) return res.status(401).json({ error: 'Password admin salah.' })
  res.json({ sessionToken: signAdminSession(), expiresIn: 12 * 3600 })
})
app.get('/api/admin/stats', rateLimit({ max: 30 }), requireAdmin, (_req, res) => res.json({
  ...getAdminStats(),
  runtime: { ...metrics, uptime: Math.round((Date.now() - metrics.startedAt) / 1000), averageLatency: metrics.requests ? Math.round(metrics.latencyTotal / metrics.requests) : 0 },
  providers: getProviderOperations()
}))
app.get('/api/admin/providers', rateLimit({ max: 30 }), requireAdmin, (_req, res) => res.json({ providers: getPublicProviderSettings() }))
app.put('/api/admin/providers', rateLimit({ max: 10, windowMs: 60_000 }), requireAdmin, (req, res) => {
  try { res.json({ ok: true, providers: saveProviderSettings(req.body || {}) }) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.post('/api/admin/providers/test', rateLimit({ max: 10, windowMs: 60_000 }), requireAdmin, async (req, res) => {
  try { res.json(await testProviderConnection(req.body || {})) }
  catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 240) }) }
})
app.post('/api/admin/providers/reset-stats', rateLimit({ max: 3, windowMs: 60_000 }), requireAdmin, (_req, res) => {
  resetProviderOperations()
  res.json({ ok: true, providers: getProviderOperations() })
})

// === Statistik lengkap untuk Overview & Laporan ===
app.get('/api/admin/overview', rateLimit({ max: 60 }), requireAdmin, (_req, res) => {
  try {
    const providers = getProviderOperations()
    res.json({
      database: getDatabaseStats(),
      chatTrend: getChatTrend(30),
      hourly: getHourlyActivity(),
      topUsers: getTopUsers(8),
      recentUsers: getRecentUsers(6),
      emotions: getEmotionDistribution(),
      storage: getStorageInfo(),
      runtime: {
        ...metrics,
        uptime: Math.round((Date.now() - metrics.startedAt) / 1000),
        averageLatency: metrics.requests ? Math.round(metrics.latencyTotal / metrics.requests) : 0
      },
      providerTotals: providers.totals,
      providerDaily: providers.daily,
      providerHealth: providers.providers.map(p => ({
        id: p.id, name: p.name, state: p.state, calls: p.calls,
        successRate: p.successRate, averageLatencyMs: p.averageLatencyMs,
        totalTokens: p.totalTokens, inputTokens: p.inputTokens,
        outputTokens: p.outputTokens, estimatedCostUsd: p.estimatedCostUsd
      })),
      alerts: providers.alerts
    })
  } catch (error) {
    res.status(500).json({ error: String(error.message || error).slice(0, 240) })
  }
})

// === Pengaturan TTS (engine + kontrol hidup/mati daemon VOICEVOX) ===
app.get('/api/admin/tts', rateLimit({ max: 60 }), requireAdmin, async (_req, res) => {
  try {
    const settings = getTtsSettings()
    const [voicevox, process] = await Promise.all([probeVoicevox(settings), getVoicevoxProcessStatus()])
    res.json({ settings, engines: TTS_ENGINES, voicevox, process })
  } catch (error) {
    res.status(500).json({ error: String(error.message || error).slice(0, 200) })
  }
})

app.put('/api/admin/tts', rateLimit({ max: 20, windowMs: 60_000 }), requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, settings: saveTtsSettings(req.body || {}) })
  } catch (error) {
    res.status(400).json({ error: String(error.message || error).slice(0, 200) })
  }
})

// Nyalakan daemon VOICEVOX (RAM/CPU terpakai selama hidup).
app.post('/api/admin/tts/voicevox/start', rateLimit({ max: 10, windowMs: 60_000 }), requireAdmin, async (_req, res) => {
  // Nyalakan saklar master dulu, baru hidupkan daemon.
  saveTtsSettings({ voicevoxEnabled: true })
  await setVoicevoxAutorestart(true)
  const result = await startVoicevox()
  res.status(result.ok ? 200 : 503).json(result)
})

// Matikan daemon VOICEVOX supaya RAM/CPU kembali 0%.
// Sekaligus set saklar master KE FALSE supaya TTS tidak menyalakannya lagi.
app.post('/api/admin/tts/voicevox/stop', rateLimit({ max: 10, windowMs: 60_000 }), requireAdmin, async (_req, res) => {
  saveTtsSettings({ voicevoxEnabled: false })
  // Cegah PM2 menghidupkan ulang daemon setelah dimatikan.
  await setVoicevoxAutorestart(false)
  const result = await stopVoicevox()
  res.status(result.ok ? 200 : 503).json(result)
})

app.get('/api/admin/tts/voicevox/status', rateLimit({ max: 120 }), requireAdmin, async (_req, res) => {
  const settings = getTtsSettings()
  const [voicevox, process] = await Promise.all([probeVoicevox(settings), getVoicevoxProcessStatus()])
  res.json({
    voicevox, process,
    engine: settings.engine,
    keepAlive: settings.voicevoxKeepAlive,
    // Saklar master: false = dimatikan dari dashboard, tidak akan menyala sendiri.
    enabled: settings.voicevoxEnabled !== false,
  })
})

// Daftar speaker VOICEVOX untuk pemilih suara di dashboard.
app.get('/api/admin/tts/voicevox/speakers', rateLimit({ max: 30 }), requireAdmin, async (_req, res) => {
  const settings = getTtsSettings()
  const probe = await probeVoicevox(settings)
  if (!probe.reachable) {
    // Coba hidupkan supaya daftar bisa diambil, lalu hormati keepAlive.
    const started = await startVoicevox()
    if (!started.ok) return res.status(503).json({ ok: false, error: started.error || 'VOICEVOX tidak aktif' })
    const result = await listVoicevoxSpeakers()
    if (settings.voicevoxKeepAlive === false) stopVoicevox().catch(() => {})
    return res.json(result)
  }
  res.json(await listVoicevoxSpeakers())
})

// Uji engine terpilih dengan teks contoh (tanpa mengubah konfigurasi tersimpan).
app.post('/api/admin/tts/test', rateLimit({ max: 10, windowMs: 60_000 }), requireAdmin, async (req, res) => {
  try {
    const settings = saveTtsSettings({ ...getTtsSettings(), ...(req.body?.settings || {}) })
    const text = String(req.body?.text || 'Halo, ini contoh suara Yuki.').slice(0, 300)
    const { buffer, mime } = await synthesize(text, req.body?.mood || 'tenang', settings)
    res.set('Content-Type', mime)
    res.send(buffer)
  } catch (error) {
    res.status(400).json({ error: String(error.message || error).slice(0, 240) })
  }
})

// === Database browser (pagination + search) ===
app.get('/api/admin/db/tables', rateLimit({ max: 60 }), requireAdmin, (_req, res) => {
  try { res.json({ tables: listTables({ db: dbHandle, labels: APP_DATA_LABELS }) }) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.get('/api/admin/db/table/:name', rateLimit({ max: 120 }), requireAdmin, (req, res) => {
  try {
    res.json(readTable({
      db: dbHandle, table: String(req.params.name || ''), labels: APP_DATA_LABELS,
      page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 25,
      search: String(req.query.search || ''), orderBy: req.query.orderBy ? String(req.query.orderBy) : null,
      order: String(req.query.order || 'desc')
    }))
  } catch (error) { res.status(400).json({ error: error.message }) }
})

// === Penjelajahan per-user (pilih user dulu -> baru lihat isinya) ===
app.get('/api/admin/users', rateLimit({ max: 120 }), requireAdmin, (req, res) => {
  try {
    res.json(listUsers({
      db: dbHandle, search: String(req.query.search || ''),
      page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 24
    }))
  } catch (error) { res.status(500).json({ error: error.message }) }
})
// === Pencari kunci ingatan (bantuan saat user lupa kuncinya) ===
// Butuh sesi admin (requireAdmin) karena endpoint ini MENAMPILKAN access_code
// yang normalnya disensor oleh REDACT_COLUMNS.
app.get('/api/admin/lookup-key', rateLimit({ max: 60 }), requireAdmin, (req, res) => {
  try {
    res.json(findMemoryKeys({ db: dbHandle, search: String(req.query.q || ''), limit: Number(req.query.limit) || 25 }))
  } catch (error) { res.status(500).json({ error: error.message }) }
})
// === Buat kunci ingatan baru (user kehilangan kunci, kunci lama tak bisa
// dipulihkan karena disimpan ter-hash). Kunci lama otomatis hangus; sesi
// yang sedang berjalan tetap login. ===
app.post('/api/admin/users/:userId/reset-key', rateLimit({ max: 20 }), requireAdmin, (req, res) => {
  try {
    const result = regenerateAccessCode(String(req.params.userId || ''))
    if (!result) return res.status(404).json({ error: 'User tidak ditemukan.' })
    console.log(`[admin] Kunci ingatan diganti untuk ${result.username} (${result.userId})`)
    res.json(result)
  } catch (error) { res.status(500).json({ error: error.message }) }
})
app.get('/api/admin/users/:userId/tables', rateLimit({ max: 120 }), requireAdmin, (req, res) => {
  try { res.json(listUserTables({ db: dbHandle, userId: String(req.params.userId || ''), labels: APP_DATA_LABELS })) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.get('/api/admin/users/:userId/table/:name', rateLimit({ max: 180 }), requireAdmin, (req, res) => {
  try {
    res.json(readUserTable({
      db: dbHandle, userId: String(req.params.userId || ''), table: String(req.params.name || ''),
      labels: APP_DATA_LABELS, page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 25,
      search: String(req.query.search || '')
    }))
  } catch (error) { res.status(400).json({ error: error.message }) }
})

// === Workspace file browser (per-user, sandboxed read-only) ===
app.get('/api/admin/workspace', rateLimit({ max: 30 }), requireAdmin, (_req, res) => {
  try { res.json(workspaceSummary({ root: WORKSPACE_ROOT })) }
  catch (error) { res.status(500).json({ error: error.message }) }
})
app.get('/api/admin/workspace/list', rateLimit({ max: 120 }), requireAdmin, (req, res) => {
  try { res.json(listDirectory({ root: WORKSPACE_ROOT, relative: String(req.query.path || '') })) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.get('/api/admin/workspace/file', rateLimit({ max: 60 }), requireAdmin, (req, res) => {
  try { res.json(readTextFile({ root: WORKSPACE_ROOT, relative: String(req.query.path || '') })) }
  catch (error) { res.status(400).json({ error: error.message }) }
})
app.post('/api/admin/password', rateLimit({ max: 5, windowMs: 15 * 60_000 }), requireAdmin, (req, res) => {
  const password = String(req.body?.password || '')
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password harus 8-128 karakter.' })
  storeAdminPassword(password)
  res.json({ ok: true, sessionToken: signAdminSession() })
})

// 404 Handler untuk endpoint API yang tidak terdaftar
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Rute API "${req.path}" tidak ditemukan.` })
})

// Global Error Handler — Selalu kembalikan respon JSON rapi, bukan HTML
app.use((err, req, res, next) => {
  console.error('[server error]', err.message || err)
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({
    error: err.message || 'Terjadi kesalahan internal pada server.'
  })
})
