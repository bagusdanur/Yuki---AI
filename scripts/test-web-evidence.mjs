// scripts/test-web-evidence.mjs
import assert from 'node:assert'
import { fetchSiteEvidence } from '../lib/web-evidence.js'
// URL internal harus ditolak tanpa request
const r1 = await fetchSiteEvidence('http://localhost:3025')
assert(r1.ok === false, 'localhost harus ditolak')
const r2 = await fetchSiteEvidence('http://169.254.169.254/latest/meta-data')
assert(r2.ok === false, 'cloud metadata harus ditolak')
const r3 = await fetchSiteEvidence('notaurl')
assert(r3.ok === false, 'format salah harus ditolak')
console.log('ALL PASS (tolak internal)')
