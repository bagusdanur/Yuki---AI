import assert from 'node:assert/strict'

const base = String(process.env.BASE_URL || 'http://127.0.0.1:3025').replace(/\/$/, '')
const username = `progress_test_${Date.now()}`
const requestId = `agent_progress_${Date.now()}`

async function json(url, init = {}) {
  const response = await fetch(`${base}${url}`, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`)
  return data
}

const registration = await json('/api/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username })
})
const auth = { Authorization: `Bearer ${registration.sessionToken}` }

try {
  const imported = await json('/api/agent/workspace/import', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [
      { path: 'sample-project/index.js', content: 'export const greeting = "Halo Yuki"\n' },
      { path: 'sample-project/config.json', content: '{"name":"sample"}\n' }
    ] })
  })
  assert.equal(imported.imported, 2)

  const chatPromise = json('/api/chat', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'agent', requestId,
      messages: [
        ...Array.from({ length: 60 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `riwayat lama ${index}` })),
        { role: 'user', content: 'Gunakan tool get_current_time untuk mengecek waktu WIB sekarang, lalu laporkan singkat.' }
      ]
    })
  })

  const observed = new Map()
  let done = false
  for (let attempt = 0; attempt < 100 && !done; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250))
    const progress = await json(`/api/agent/progress/${requestId}`, { headers: auth })
    for (const step of progress.steps || []) observed.set(step.id, step)
    done = Boolean(progress.done)
  }

  const result = await chatPromise
  assert.ok(result.reply)
  assert.ok(observed.has('agent_analysis'), 'tahap analisis tidak pernah tampil')
  assert.ok([...observed.values()].some(step => step.tool === 'get_current_time'), 'tool aktual tidak muncul di progress')
  assert.ok([...observed.values()].some(step => step.status === 'done'), 'tidak ada todo yang selesai')
  assert.ok((result.steps || []).some(step => step.tool === 'get_current_time'), 'response final kehilangan langkah aktual')
  console.log('PASS  progres aktual terlihat sebelum/selama agent bekerja')
  console.log(`PASS  ${observed.size} langkah tercatat; tool get_current_time terverifikasi`)
  console.log('PASS  balasan agent tetap terikat pada langkah tool yang benar-benar dijalankan')
  console.log('PASS  endpoint import workspace menerima proyek multi-file')
  console.log('PASS  riwayat panjang dipadatkan tanpa error validasi')
} finally {
  await json('/api/account', { method: 'DELETE', headers: auth }).catch(() => {})
}
