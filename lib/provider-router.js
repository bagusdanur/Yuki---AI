const DEFAULT_CIRCUIT_FAILURES = Math.max(1, Number(process.env.YUKI_PROVIDER_CIRCUIT_FAILURES || 3))
const DEFAULT_COOLDOWN_MS = Math.max(10_000, Number(process.env.YUKI_PROVIDER_COOLDOWN_MS || 60_000))

const records = new Map()
const alerts = []

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
      return { ...result, provider, route: { attempts, failover: attempts > 1 }, budget }
    } catch (error) {
      lastError = error
      record.failures++; record.consecutiveFailures++; record.lastError = String(error?.message || error).slice(0, 180)
      record.latencyTotalMs += Math.max(0, now() - started)
      if (record.consecutiveFailures >= failureThreshold) {
        record.state = 'open'; record.openedAt = currentTime
        pushAlert('circuit_open', provider, record.lastError)
      }
    }
  }
  pushAlert('all_providers_failed', providers[0], lastError?.message || 'Tidak ada provider sehat.')
  throw new Error(`Semua provider LLM gagal atau circuit sedang terbuka: ${lastError?.message || 'tidak ada provider sehat'}`, { cause: lastError })
}

export function getProviderOperations() {
  const providers = [...records.values()].map(record => ({
    ...record,
    averageLatencyMs: record.calls ? Math.round(record.latencyTotalMs / record.calls) : 0,
    successRate: record.calls ? Math.round((record.successes / record.calls) * 1000) / 10 : 0,
    estimatedCostUsd: Math.round(record.estimatedCostUsd * 1_000_000) / 1_000_000
  }))
  return {
    providers, alerts: alerts.slice(0, 10),
    totals: {
      calls: providers.reduce((sum, item) => sum + item.calls, 0),
      tokens: providers.reduce((sum, item) => sum + item.totalTokens, 0),
      estimatedCostUsd: providers.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
      openCircuits: providers.filter(item => item.state === 'open').length
    },
    config: { maxAttemptsPerRequest: 2, failureThreshold: DEFAULT_CIRCUIT_FAILURES, cooldownMs: DEFAULT_COOLDOWN_MS }
  }
}

export function resetProviderOperationsForTests() { records.clear(); alerts.length = 0 }
