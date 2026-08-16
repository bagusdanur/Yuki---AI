const base = String(process.env.BASE_URL || 'http://127.0.0.1:3025').replace(/\/$/, '')
const code = process.env.ACCESS_CODE
const total = Math.max(1, Number(process.env.REQUESTS || 100))
const concurrency = Math.max(1, Math.min(20, Number(process.env.CONCURRENCY || 5)))
if (!code) throw new Error('Set ACCESS_CODE untuk akun pengujian khusus.')
const login = await fetch(`${base}/api/login-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode: code }) })
if (!login.ok) throw new Error(`Login load test gagal (${login.status})`)
const session = await login.json()
let cursor = 0, ok = 0, failed = 0
const latencies = []
async function worker() {
  while (cursor < total) {
    cursor += 1; const started = performance.now()
    const response = await fetch(`${base}/api/relationship/${encodeURIComponent(session.userId)}`, { headers: { Authorization: `Bearer ${session.sessionToken}` } }).catch(() => null)
    latencies.push(performance.now() - started)
    if (response?.ok) ok += 1; else failed += 1
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
latencies.sort((a, b) => a - b)
const percentile = value => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * value))] || 0)
console.log(JSON.stringify({ total, concurrency, ok, failed, p50Ms: percentile(.5), p95Ms: percentile(.95) }, null, 2))
if (failed / total > .1) process.exitCode = 1
