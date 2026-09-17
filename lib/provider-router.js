import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_CIRCUIT_FAILURES = Math.max(1, Number(process.env.YUKI_PROVIDER_CIRCUIT_FAILURES || 3))
const DEFAULT_COOLDOWN_MS = Math.max(10_000, Number(process.env.YUKI_PROVIDER_COOLDOWN_MS || 60_000))

// Statistik provider disimpan ke disk agar akumulasi token/kegagalan tidak
// hilang setiap restart. Ditulis atomik (tmp + rename) dan di-throttle.
const STATS_FILE = path.resolve(process.env.YUKI_PROVIDER_STATS_FILE || './data/provider-stats.json')
const SAVE_THROTTLE_MS = Math.max(1000, Number(process.env.YUKI_PROVIDER_STATS_SAVE_MS || 5000))
const MAX_HISTORY_DAYS = Math.max(7, Number(process.env.YUKI_PROVIDER_STATS_HISTORY_DAYS || 90))

const records = new Map()
const alerts = []

let saveTimer = null
let dirty = false
let loadedAt = null
let dailyTotals = {}   // { 'YYYY-MM-DD': { calls, tokens, cost, failures } }

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function pruneDailyTotals() {
  const cutoff = new Date(Date.now() - MAX_HISTORY_DAYS * 86400_000).toISOString().slice(0, 10)
  for (const key of Object.keys(dailyTotals)) if (key < cutoff) delete dailyTotals[key]
}

function loadStats() {
  try {
    if (!existsSync(STATS_FILE)) return
    const raw = JSON.parse(readFileSync(STATS_FILE, 'utf8'))
    if (Array.isArray(raw.providers)) for (const item of raw.providers) if (item?.id) records.set(item.id, item)
    if (Array.isArray(raw.alerts)) alerts.push(...raw.alerts.slice(0, 30))
    if (raw.dailyTotals && typeof raw.dailyTotals === 'object') dailyTotals = raw.dailyTotals
    loadedAt = raw.savedAt || null
    pruneDailyTotals()
  } catch (error) {
    console.error('[provider-router] gagal memuat statistik:', error.message)
  }
}

function persistNow() {
  try {
    mkdirSync(path.dirname(STATS_FILE), { recursive: true })
    const payload = JSON.stringify({
      savedAt: new Date().toISOString(),
      providers: [...records.values()],
      alerts: alerts.slice(0, 30),
      dailyTotals
    })
    const tmp = `${STATS_FILE}.tmp`
    writeFileSync(tmp, payload)
    renameSync(tmp, STATS_FILE)
    dirty = false
  } catch (error) {
    console.error('[provider-router] gagal menyimpan statistik:', error.message)
  }
}

function scheduleSave() {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; if (dirty) persistNow() }, SAVE_THROTTLE_MS)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

function bumpDaily(fields) {
  const key = todayKey()
  const day = dailyTotals[key] || (dailyTotals[key] = { calls: 0, tokens: 0, cost: 0, failures: 0 })
  day.calls += fields.calls || 0
  day.tokens += fields.tokens || 0
  day.cost += fields.cost || 0
  day.failures += fields.failures || 0
  pruneDailyTotals()
}

loadStats()

function recordFor(provider) {
  if (!records.has(provider.id)) records.set(provider.id, {
    id: provider.id, name: provider.name, model: provider.model, state: 'closed',
    calls: 0, successes: 0, failures: 0, consecutiveFailures: 0,
    latencyTotalMs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
    estimatedCostUsd: 0, lastError: '', lastAttemptAt: null, openedAt: null
  })
  const record = records.get(provider.id)
  record.name = provider.name; record.model = provider.model
  return record
}

function pushAlert(type, provider, message) {
  alerts.unshift({ type, provider: provider.id, message: String(message || '').slice(0, 180), at: new Date().toISOString() })
  if (alerts.length > 30) alerts.length = 30
  scheduleSave()
}

function usageOf(result = {}) {
  const usage = result.usage || {}
  return {
    input: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    output: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    total: Number(usage.total_tokens ?? 0) || 0
  }
}

function costOf(provider, usage) {
  return (usage.input * Number(provider.inputCostPerMillion || 0) + usage.output * Number(provider.outputCostPerMillion || 0)) / 1_000_000
}

export function createRunBudget({ maxTokens = Number(process.env.YUKI_AGENT_TOKEN_BUDGET || 120_000), maxCostUsd = Number(process.env.YUKI_AGENT_COST_BUDGET_USD || 0.25) } = {}) {
  return { maxTokens, maxCostUsd, usedTokens: 0, estimatedCostUsd: 0, exhausted: false }
}

export async function routeProviderRequest({ providers, invoke, budget = createRunBudget(), now = Date.now, failureThreshold = DEFAULT_CIRCUIT_FAILURES, cooldownMs = DEFAULT_COOLDOWN_MS }) {
  if (!Array.isArray(providers) || providers.length === 0) throw new Error('Tidak ada provider LLM yang dikonfigurasi.')
  if (budget.exhausted || budget.usedTokens >= budget.maxTokens || budget.estimatedCostUsd >= budget.maxCostUsd) {
    budget.exhausted = true
    throw new Error('LLM_BUDGET_EXHAUSTED: batas token/biaya agent run sudah tercapai.')
  }
  let lastError
  let attempts = 0
  for (const provider of providers) {
    if (attempts >= 2) break
    const record = recordFor(provider)
    const currentTime = now()
    if (record.state === 'open' && currentTime - Number(record.openedAt || 0) < cooldownMs) continue
    if (record.state === 'open') record.state = 'half_open'
    attempts++
    record.calls++; record.lastAttemptAt = new Date(currentTime).toISOString()
    const started = now()
    try {
      const result = await invoke(provider)
      const latency = Math.max(0, now() - started)
      const usage = usageOf(result)
      const cost = costOf(provider, usage)
      record.successes++; record.consecutiveFailures = 0; record.state = 'closed'; record.lastError = ''
      record.latencyTotalMs += latency; record.inputTokens += usage.input; record.outputTokens += usage.output
      record.totalTokens += usage.total; record.estimatedCostUsd += cost; record.openedAt = null
      budget.usedTokens += usage.total; budget.estimatedCostUsd += cost
      if (budget.usedTokens > budget.maxTokens || budget.estimatedCostUsd > budget.maxCostUsd) budget.exhausted = true
      bumpDaily({ calls: 1, tokens: usage.total, cost, failures: 0 })
      scheduleSave()
      return { ...result, provider, route: { attempts, failover: attempts > 1 }, budget }
    } catch (error) {
      lastError = error
      record.failures++; record.consecutiveFailures++; record.lastError = String(error?.message || error).slice(0, 180)
      record.latencyTotalMs += Math.max(0, now() - started)
      if (record.consecutiveFailures >= failureThreshold) {
        record.state = 'open'; record.openedAt = currentTime
        pushAlert('circuit_open', provider, record.lastError)
      }
      bumpDaily({ calls: 1, tokens: 0, cost: 0, failures: 1 })
      scheduleSave()
    }
  }
  pushAlert('all_providers_failed', providers[0], lastError?.message || 'Tidak ada provider sehat.')
  scheduleSave()
  throw new Error(`Semua provider LLM gagal atau circuit sedang terbuka: ${lastError?.message || 'tidak ada provider sehat'}`, { cause: lastError })
}

export function getProviderOperations() {
  const now = Date.now()
  const providers = [...records.values()].map(record => ({
    ...record,
    averageLatencyMs: record.calls ? Math.round(record.latencyTotalMs / record.calls) : 0,
    successRate: record.calls ? Math.round((record.successes / record.calls) * 1000) / 10 : 0,
    estimatedCostUsd: Math.round(record.estimatedCostUsd * 1_000_000) / 1_000_000,
    averageTokensPerCall: record.calls ? Math.round(record.totalTokens / record.calls) : 0,
    circuitRemainingMs: record.state === 'open' && record.openedAt
      ? Math.max(0, DEFAULT_COOLDOWN_MS - (now - Number(record.openedAt)))
      : 0
  }))
  const totals = {
    calls: providers.reduce((sum, item) => sum + item.calls, 0),
    successes: providers.reduce((sum, item) => sum + item.successes, 0),
    failures: providers.reduce((sum, item) => sum + item.failures, 0),
    tokens: providers.reduce((sum, item) => sum + item.totalTokens, 0),
    inputTokens: providers.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: providers.reduce((sum, item) => sum + item.outputTokens, 0),
    estimatedCostUsd: Math.round(providers.reduce((sum, item) => sum + item.estimatedCostUsd, 0) * 1_000_000) / 1_000_000,
    openCircuits: providers.filter(item => item.state === 'open').length,
    averageLatencyMs: providers.length
      ? Math.round(providers.reduce((sum, item) => sum + item.averageLatencyMs, 0) / providers.length)
      : 0
  }
  totals.successRate = totals.calls ? Math.round((totals.successes / totals.calls) * 1000) / 10 : 0

  // Tren harian (urut naik) untuk grafik dashboard
  const daily = Object.entries(dailyTotals)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => ({
      date,
      calls: value.calls || 0,
      tokens: value.tokens || 0,
      failures: value.failures || 0,
      cost: Math.round((value.cost || 0) * 1_000_000) / 1_000_000
    }))

  return {
    providers, alerts: alerts.slice(0, 10),
    totals,
    daily,
    persisted: { file: STATS_FILE, savedAt: loadedAt, historyDays: MAX_HISTORY_DAYS },
    config: { maxAttemptsPerRequest: 2, failureThreshold: DEFAULT_CIRCUIT_FAILURES, cooldownMs: DEFAULT_COOLDOWN_MS }
  }
}

// Paksa tulis ke disk sekarang (dipakai endpoint admin / saat shutdown).
export function flushProviderOperations() { persistNow() }

export function resetProviderOperations() {
  records.clear()
  alerts.length = 0
  dailyTotals = {}
  loadedAt = null
  persistNow()
}

export function resetProviderOperationsForTests() { records.clear(); alerts.length = 0; dailyTotals = {} }
