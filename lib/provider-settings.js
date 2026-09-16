import 'dotenv/config'
import OpenAI from 'openai'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs'

const FILE = path.resolve(process.env.LLM_PROVIDER_CONFIG_FILE || './.runtime-secrets/llm-providers.json')
const DEFAULTS = {
  primary: {
    id: 'primary', name: '9Router · Harbor DeepSeek',
    baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1',
    model: process.env.NEBULA_MODEL || 'harbor/deepseek-v4.1-flash:free',
    apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy', inputCostPerMillion: 0, outputCostPerMillion: 0
  },
  backup: {
    id: 'backup', name: '9Router · Gemini Flash',
    baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1',
    model: process.env.NINEROUTER_MODEL || 'ag/gemini-3-flash',
    apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy', inputCostPerMillion: 0, outputCostPerMillion: 0
  }
}

function validateBaseURL(value) {
  const url = new URL(String(value || ''))
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Base URL wajib HTTPS; HTTP hanya boleh untuk localhost.')
  if (!local && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error('Private network tidak diizinkan.')
  return url.toString().replace(/\/$/, '')
}

function cleanSlot(value, current, id) {
  const apiKey = String(value.apiKey || '').trim() || current.apiKey
  if (!apiKey) throw new Error(`API key ${id} belum diisi.`)
  const model = String(value.model || '').trim().slice(0, 160)
  if (!model) throw new Error(`Model ${id} wajib diisi.`)
  return {
    id, name: String(value.name || id).trim().slice(0, 80),
    baseURL: validateBaseURL(value.baseURL), model, apiKey,
    inputCostPerMillion: Math.max(0, Number(value.inputCostPerMillion || 0)),
    outputCostPerMillion: Math.max(0, Number(value.outputCostPerMillion || 0))
  }
}

export function getProviderSettings() {
  if (!existsSync(FILE)) return structuredClone(DEFAULTS)
  try {
    const stored = JSON.parse(readFileSync(FILE, 'utf8'))
    return {
      primary: cleanSlot(stored.primary || {}, DEFAULTS.primary, 'primary'),
      backup: cleanSlot(stored.backup || {}, DEFAULTS.backup, 'backup')
    }
  } catch (error) {
    console.error('[provider-settings] config invalid, memakai environment defaults:', error.message)
    return structuredClone(DEFAULTS)
  }
}

export function getPublicProviderSettings() {
  const settings = getProviderSettings()
  return Object.fromEntries(Object.entries(settings).map(([key, item]) => [key, { ...item, apiKey: undefined, hasApiKey: Boolean(item.apiKey) }]))
}

export function saveProviderSettings(input = {}) {
  const current = getProviderSettings()
  const next = {
    primary: cleanSlot(input.primary || {}, current.primary, 'primary'),
    backup: cleanSlot(input.backup || {}, current.backup, 'backup')
  }
  mkdirSync(path.dirname(FILE), { recursive: true })
  const temp = `${FILE}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(temp, FILE); chmodSync(FILE, 0o600)
  return getPublicProviderSettings()
}

export function runtimeProviders() {
  return Object.values(getProviderSettings()).map(item => ({
    ...item,
    client: new OpenAI({ apiKey: item.apiKey, baseURL: item.baseURL, timeout: 45_000, maxRetries: 0 })
  }))
}

export async function testProviderConnection(input = {}) {
  const current = getProviderSettings()
  const id = input.id === 'backup' ? 'backup' : 'primary'
  const config = cleanSlot(input, current[id], id)
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 15_000, maxRetries: 0 })
  const started = Date.now()
  const completion = await client.chat.completions.create({
    model: config.model, messages: [{ role: 'user', content: 'Balas tepat: OK' }],
    max_tokens: 8, temperature: 0, stream: false
  })
  if (!completion.choices?.[0]) throw new Error('Provider tidak mengembalikan completion.')
  return { ok: true, latencyMs: Date.now() - started, model: config.model, reply: String(completion.choices[0].message?.content || '').slice(0, 80) }
}
