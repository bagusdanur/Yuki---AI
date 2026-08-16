import assert from 'node:assert/strict'
import { Emotion } from '../lib/emotion.js'
import { responseTarget, shouldInitiate, textSimilarity, validateCharacterReply } from '../lib/character-quality.js'

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

check('emosi kuat bertahan lintas giliran dan tersimpan', () => {
  const emotion = new Emotion({ bond: 20 })
  emotion.react('Kamu menyebalkan dan bodoh.')
  assert.equal(emotion.label(), 'kesal')
  assert.ok(emotion.episode?.turnsRemaining >= 2)
  const restored = new Emotion(emotion.serialize())
  restored.react('Aku cuma mau membahas hal lain sekarang.')
  assert.ok(restored.episode || restored.label() === 'kesal')
})

check('permintaan maaf memperbaiki konflik tanpa menghapus riwayatnya', () => {
  const emotion = new Emotion({ bond: 20 })
  emotion.react('Kamu bodoh dan menyebalkan.')
  const afterConflict = emotion.bond
  emotion.react('Maaf ya, tadi aku keterlaluan. Aku sungguh menyesal.')
  assert.ok(emotion.bond > afterConflict)
  assert.ok(emotion.relationship.conflict >= 1)
  assert.ok(emotion.relationship.repair >= 1)
})

check('validator menangkap respons terpotong dan repetitif', () => {
  const target = responseTarget('ceritain dong')
  assert.equal(validateCharacterReply('Aku sebenarnya ingin bilang tapi', [], target).ok, false)
  const repeated = validateCharacterReply('Ya sudah, istirahat dulu. Jangan dipaksakan.', ['Ya sudah, istirahat dulu. Jangan terlalu dipaksakan.'], target)
  assert.ok(repeated.issues.includes('terlalu mirip dengan balasan sebelumnya'))
})

check('validator menolak ingatan palsu tanpa konteks memori', () => {
  const result = validateCharacterReply('Aku ingat kamu pernah bilang suka hujan.', [], responseTarget('kamu ingat aku?'), '')
  assert.ok(result.issues.includes('mengklaim ingatan yang tidak tersedia'))
})

check('panjang respons mengikuti bobot pesan', () => {
  assert.ok(responseTarget('hai').max < responseTarget('Aku sedang menghadapi masalah panjang dan butuh bantuan', { serious: true }).max)
})

check('inisiatif terkontrol dan tidak muncul setiap giliran', () => {
  const decisions = Array.from({ length: 12 }, (_, index) => shouldInitiate({ turns: index + 1, userText: 'Aku lanjut cerita soal kerjaan.' }))
  assert.equal(decisions.filter(Boolean).length, 3)
  assert.equal(shouldInitiate({ turns: 4, userText: 'hmm' }), false)
  assert.equal(shouldInitiate({ turns: 2, serious: true, userText: 'Aku sedang berduka.' }), true)
})

check('simulasi 100 giliran tidak merusak batas bond atau state', () => {
  const emotion = new Emotion()
  for (let index = 0; index < 100; index += 1) {
    const text = index % 17 === 0 ? `Maaf tadi aku agak kasar bagian ${index}` : `Hari ini aku cerita topik berbeda nomor ${index}`
    emotion.react(text)
  }
  assert.ok(emotion.bond >= 0 && emotion.bond <= 100)
  assert.equal(emotion.interactions, 100)
  assert.ok(emotion.recentInputs.length <= 8)
})

check('kemiripan jawaban berbeda tetap rendah', () => {
  assert.ok(textSimilarity('Aku sedang membaca manga misteri.', 'Istirahat dulu kalau kepalamu pusing.') < 0.4)
})

for (const result of report) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? ` — ${result.error}` : ''}`)
}

const failures = report.filter((result) => !result.ok)
if (failures.length) process.exitCode = 1
else console.log(`\n${report.length}/${report.length} evaluasi karakter lulus.`)
