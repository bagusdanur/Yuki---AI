import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuki-provider-settings-'))
process.env.LLM_PROVIDER_CONFIG_FILE = path.join(dir, 'providers.json')
const { getProviderSettings, getPublicProviderSettings, saveProviderSettings } = await import('../lib/provider-settings.js')
const saved = saveProviderSettings({
  primary: { name: 'Custom Primary', baseURL: 'https://api.example.com/v1', model: 'model-a', apiKey: 'secret-a', inputCostPerMillion: 1, outputCostPerMillion: 2 },
  backup: { name: 'Local Backup', baseURL: 'http://127.0.0.1:20128/v1', model: 'model-b', apiKey: 'secret-b' }
})
assert.equal(saved.primary.hasApiKey, true); assert.equal(saved.primary.apiKey, undefined)
assert.equal(getProviderSettings().primary.apiKey, 'secret-a')
assert.equal((fs.statSync(process.env.LLM_PROVIDER_CONFIG_FILE).mode & 0o777), 0o600)
saveProviderSettings({ primary: { ...saved.primary, apiKey: '', model: 'model-a2' }, backup: { ...saved.backup, apiKey: '' } })
assert.equal(getProviderSettings().primary.apiKey, 'secret-a')
assert.equal(getProviderSettings().primary.model, 'model-a2')
assert.equal(getPublicProviderSettings().backup.apiKey, undefined)
assert.throws(() => saveProviderSettings({ primary: { ...saved.primary, baseURL: 'http://example.com/v1' }, backup: saved.backup }), /HTTPS/)
fs.rmSync(dir, { recursive: true, force: true })
console.log('PASS  provider settings persistence, redaction, key preservation, permission, dan URL policy')
