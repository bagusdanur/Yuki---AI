import assert from 'node:assert/strict'
import { createRunBudget, getProviderOperations, resetProviderOperationsForTests, routeProviderRequest } from '../lib/provider-router.js'

const primary = { id: 'primary', name: 'Primary', model: 'fast', inputCostPerMillion: 1, outputCostPerMillion: 2 }
const backup = { id: 'backup', name: 'Backup', model: 'safe', inputCostPerMillion: 1, outputCostPerMillion: 2 }
const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
resetProviderOperationsForTests()
let calls = []
const failedOver = await routeProviderRequest({
  providers: [primary, backup], failureThreshold: 1,
  invoke: async provider => {
    calls.push(provider.id)
    if (provider.id === 'primary') throw new Error('rate limited')
    return { content: 'ok', usage }
  }
})
assert.deepEqual(calls, ['primary', 'backup'])
assert.equal(failedOver.route.failover, true)
assert.equal(failedOver.route.attempts, 2)
let snapshot = getProviderOperations()
assert.equal(snapshot.providers.find(item => item.id === 'primary').state, 'open')
assert.equal(snapshot.providers.find(item => item.id === 'backup').successes, 1)
assert.equal(snapshot.alerts.some(item => item.type === 'circuit_open'), true)
calls = []
await routeProviderRequest({ providers: [primary, backup], invoke: async provider => { calls.push(provider.id); return { content: 'ok', usage } } })
assert.deepEqual(calls, ['backup'])
const budget = createRunBudget({ maxTokens: 100, maxCostUsd: 1 })
await routeProviderRequest({ providers: [backup], budget, invoke: async () => ({ content: 'ok', usage }) })
await assert.rejects(() => routeProviderRequest({ providers: [backup], budget, invoke: async () => ({ content: 'no', usage }) }), /LLM_BUDGET_EXHAUSTED/)
resetProviderOperationsForTests()
let attempts = 0
await assert.rejects(() => routeProviderRequest({
  providers: [primary, backup, { ...backup, id: 'third' }],
  invoke: async () => { attempts++; throw new Error('down') }
}), /Semua provider/)
assert.equal(attempts, 2)
console.log('PASS  Phase 8 provider health, circuit breaker, one-shot failover, budget, dan anti-loop')
