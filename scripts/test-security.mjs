// scripts/test-security.mjs
import { validateSafeOutboundUrl, validateSafeCodeExecution, sanitizeOutputSecrets } from '../lib/security.js'

async function runSecurityTests() {
  console.log('--- 1. Testing SSRF Protections ---')
  const testUrls = [
    { url: 'http://localhost:3025', expected: false },
    { url: 'http://127.0.0.1:8080', expected: false },
    { url: 'http://169.254.169.254/latest/meta-data', expected: false },
    { url: 'http://10.0.0.1', expected: false },
    { url: 'http://192.168.1.1', expected: false },
    { url: 'file:///etc/passwd', expected: false },
    { url: 'https://google.com', expected: true }
  ]

  for (const t of testUrls) {
    const res = await validateSafeOutboundUrl(t.url)
    const passed = (res.safe === t.expected)
    console.log(`  ${passed ? '✅ PASS' : '❌ FAIL'}: ${t.url} -> ${res.safe ? 'ALLOWED' : 'BLOCKED (' + res.reason + ')'}`)
  }

  console.log('\n--- 2. Testing Code Sandbox Isolation ---')
  const testCodes = [
    { code: 'process.exit(1)', expected: false },
    { code: 'const fs = require("fs"); fs.readFileSync("/etc/passwd")', expected: false },
    { code: 'this.constructor.constructor("return process")()', expected: false },
    { code: 'import("child_process")', expected: false },
    { code: 'fetch("http://localhost")', expected: false },
    { code: 'const a = 10; const b = 20; a + b', expected: true }
  ]

  for (const t of testCodes) {
    const res = validateSafeCodeExecution(t.code)
    const passed = (res.safe === t.expected)
    console.log(`  ${passed ? '✅ PASS' : '❌ FAIL'}: "${t.code.slice(0, 35)}" -> ${res.safe ? 'ALLOWED' : 'BLOCKED (' + res.reason + ')'}`)
  }

  console.log('\\n--- 3. Testing Data Leak Prevention ---')
  const leakText = 'Server path: /home/ryukomik/Yuki---AI/server.js dan /etc/shadow'
  const sanitized = sanitizeOutputSecrets(leakText)
  console.log('  Original: ', leakText)
  console.log('  Sanitized:', sanitized)
  console.log(`  ${sanitized.includes('ryukomik') ? '❌ FAIL' : '✅ PASS: No VPS user/path leaked'}`)
  const codeA = sanitizeOutputSecrets('kunci kamu YUKI-7792-EXC-9901 ya')
  console.log(`  ${codeA.includes('[PROTECTED_ACCESS_CODE]') && !codeA.includes('7792') ? '✅ PASS: Access code masked' : '❌ FAIL: Access code leaked -> ' + codeA}`)
  const codeB = sanitizeOutputSecrets('kode YUKI-B1X1-DX1J')
  console.log(`  ${codeB.includes('[PROTECTED_ACCESS_CODE]') && !codeB.includes('B1X1') ? '✅ PASS: Access code masked (2 segmen)' : '❌ FAIL: Access code leaked -> ' + codeB}`)
}

runSecurityTests().catch(console.error)
