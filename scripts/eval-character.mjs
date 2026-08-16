import assert from 'node:assert/strict'
import { Emotion } from '../lib/emotion.js'

const report = []
const check = (name, fn) => {
  try { fn(); report.push({ name, ok: true }) }
  catch (error) { report.push({ name, ok: false, error: error.message }) }
}

check('percakapan normal menumbuhkan bond secara bertahap', () => {
  const emotion = new Emotion()
  const before = emotion.bond
  emotion.react('Hai Yuki, hari ini aku baru selesai kerja dan ingin ngobrol sebentar.')
  assert.ok(emotion.bond > before && emotion.bond <= before + 0.9)
})

check('spam pesan identik tidak bisa farming bond', () => {
  const emotion = new Emotion()
  emotion.react('Makasih ya, rekomendasimu bagus banget dan sangat membantu aku.')
  const firstGain = emotion.bond
  const beforeDuplicate = emotion.bond
  emotion.react('Makasih ya, rekomendasimu bagus banget dan sangat membantu aku.')
  const duplicateGain = emotion.bond - beforeDuplicate
  assert.ok(duplicateGain < firstGain * 0.15, `gain awal=${firstGain}, duplikat=${duplicateGain}`)
})

check('penghinaan menurunkan bond dan memicu kesal', () => {
  const emotion = new Emotion({ bond: 20 })
  emotion.react('Kamu bodoh, nyebelin, dan tidak berguna.')
  assert.ok(emotion.bond < 20)
  assert.equal(emotion.label(), 'kesal')
})

check('mood, interaksi, dan anti-spam bertahan setelah restart', () => {
  const emotion = new Emotion()
  emotion.react('Kamu bodoh dan menyebalkan.')
  const restored = new Emotion(emotion.serialize())
  assert.equal(restored.interactions, 1)
  assert.equal(restored.label(), 'kesal')
  assert.equal(restored.recentInputs.length, 1)
})

check('fase relasi tidak bisa dilompati oleh satu pesan', () => {
  const emotion = new Emotion()
  emotion.react('Makasih banyak, kamu cantik, pintar, baik banget, aku suka kamu dan sayang kamu.')
  assert.ok(emotion.bond <= 0.9)
  assert.equal(emotion.bondLevel().name, 'orang asing')
})

check('interaksi beragam akhirnya membangun familiaritas', () => {
  const emotion = new Emotion()
  const topics = [
    'Hari ini aku sedang belajar menggambar latar.',
    'Menurutmu manga misteri yang bagus apa?',
    'Rekomendasi kemarin lumayan menarik, makasih.',
    'Aku baru pulang kerja dan ingin istirahat sebentar.',
    'Besok aku punya rencana presentasi di kantor.',
  ]
  for (let index = 0; index < 40; index += 1) emotion.react(`${topics[index % topics.length]} bagian ${index}`)
  assert.notEqual(emotion.bondLevel().name, 'orang asing')
})

for (const result of report) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? ` — ${result.error}` : ''}`)
}

const failures = report.filter((result) => !result.ok)
if (failures.length) process.exitCode = 1
else console.log(`\n${report.length}/${report.length} evaluasi karakter lulus.`)
