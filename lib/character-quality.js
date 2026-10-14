const normalize = (text = '') => text.toLowerCase().replace(/\*[^*]+\*/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

export function textSimilarity(left = '', right = '') {
  const a = new Set(normalize(left).split(' ').filter((word) => word.length > 2))
  const b = new Set(normalize(right).split(' ').filter((word) => word.length > 2))
  if (!a.size || !b.size) return 0
  const overlap = [...a].filter((word) => b.has(word)).length
  return overlap / Math.max(1, Math.min(a.size, b.size))
}

export function responseTarget(userText = '', { serious = false, idle = false, comics = 0 } = {}) {
  if (idle) return { max: 180, style: 'satu kalimat ringan' }
  if (serious) return { max: 900, style: '2-5 kalimat empatik dan fokus' }
  // Rekomendasi komik butuh ruang untuk 1 blok per judul (judul + info + [Link]).
  // Jangan paksa pendek — kalau tidak, balasan dipotong dan blok [Link] jadi rusak.
  if (comics > 0) return { max: 320 + comics * 240, style: `1 kalimat pembuka singkat, lalu ${comics} blok judul TERPISAH (judul tebal, baris info, baris [Link]); jangan dipotong` }
  // Batas panjang: dulu 220/420 → balasan nyata median cuma 97 karakter dan obrolan
  // sering terasa "mati". Digeser naik supaya Yuki punya ruang bereaksi & merespons
  // tanpa jadi bertele-tele (batas atas tetap ada).
  if (userText.length < 18) return { max: 350, style: '1-2 kalimat singkat, boleh satu reaksi singkat' }
  if (userText.length > 280) return { max: 850, style: '2-5 kalimat yang menanggapi detail penting' }
  if (/\?|gimana|menurutmu|jelasin|kenapa|tolong|rekomendasi/i.test(userText)) return { max: 650, style: 'jawaban cukup lengkap, lalu satu respons natural' }
  return { max: 550, style: '2-4 kalimat natural, boleh diakhiri pertanyaan balik seperlunya' }
}

// Masalah yang WAJIB ditulis ulang oleh model (panggilan LLM tambahan layak).
// Selebihnya bersifat kosmetik dan cukup diperbaiki lokal — memanggil LLM ulang
// hanya untuk itu menggandakan latensi & biaya tanpa memperbaiki isi balasan.
const FATAL_ISSUE_PREFIXES = [
  'respons kosong',
  'balasan tanpa kata',
  'respons tampak terpotong',
  'format atau instruksi internal bocor',
  'mengklaim ingatan yang tidak tersedia',
  'terlalu mirip dengan balasan sebelumnya',
]

export function isFatalIssue(issue = '') {
  return FATAL_ISSUE_PREFIXES.some((prefix) => issue.startsWith(prefix))
}

export function validateCharacterReply(reply = '', recentAssistant = [], target = responseTarget(''), memoryContext = '', { gestureRequired = false } = {}) {
  const issues = []
  const clean = reply.trim()
  if (!clean) issues.push('respons kosong')
  if (clean.length > target.max) issues.push(`terlalu panjang (maksimal sekitar ${target.max} karakter)`)
  if (/[,;:\-–—]\s*$/.test(clean) || /\b(dan|atau|karena|tapi|kalau|yang|untuk|malah|supaya|agar|jadi|sehingga|dengan)\s*$/i.test(clean)) issues.push('respons tampak terpotong')
  if (/\[emosi:|<\/?(?:system|assistant|user)>|system prompt|instruksi sistem/i.test(clean)) issues.push('format atau instruksi internal bocor')
  if (/\b(kamu pernah bilang|aku ingat kamu|seperti waktu kita dulu|dulu kita pernah)\b/i.test(clean) && !memoryContext.trim()) issues.push('mengklaim ingatan yang tidak tersedia')
  const maxSimilarity = recentAssistant.slice(-5).reduce((max, previous) => Math.max(max, textSimilarity(clean, previous)), 0)
  if (clean.length > 24 && maxSimilarity >= 0.72) issues.push('terlalu mirip dengan balasan sebelumnya')
  const gestures = [...clean.matchAll(/\*([^*]+)\*/g)].map((match) => normalize(match[1]))
  // Balasan yang isinya cuma gesture + "..." (tanpa SATU KATA pun) membuat obrolan
  // terasa mati. Di kasus nyata ada balasan 20 karakter isinya "*...\n... Renn. Puas?*"
  // — kalau tanpa kata sama sekali, tolak dan minta model menulis ulang.
  const spoken = clean.replace(/\*[^*]+\*/g, '').replace(/[\s.…\-.?!,:;—]+/g, '')
  if (clean && spoken.length < 2 && issues.length === 0) issues.push('balasan tanpa kata (hanya gestur/...)')
  if (gestureRequired && gestures.length === 0) issues.push('gesture emosional yang diminta tidak muncul')
  if (gestures.length > 1) issues.push('terlalu banyak gesture dalam satu balasan')
  const recentGestures = recentAssistant.slice(-5).flatMap((text) => [...text.matchAll(/\*([^*]+)\*/g)].map((match) => normalize(match[1])))
  if (gestures.some((gesture) => gesture && recentGestures.some((old) => textSimilarity(gesture, old) >= 0.65))) issues.push('gestur berulang')
  const fatal = issues.filter(isFatalIssue)
  return { ok: issues.length === 0, issues, fatal, okFatal: fatal.length === 0, maxSimilarity }
}

// Perbaiki masalah KOSMETIK tanpa memanggil model lagi:
// - buang gesture berlebih (sisakan satu yang tidak berulang),
// - buang gesture yang mengulang gestur balasan sebelumnya.
// Panjang berlebih tidak disentuh di sini (server sudah memotong rapi di batas kalimat).
export function repairCharacterReply(reply = '', recentAssistant = []) {
  const original = String(reply || '').trim()
  const notes = []
  const recentGestures = recentAssistant.slice(-5)
    .flatMap((text) => [...String(text).matchAll(/\*([^*\n]+)\*/g)].map((match) => normalize(match[1])))

  const isRepeat = (gesture) => gesture && recentGestures.some((old) => textSimilarity(gesture, old) >= 0.65)

  const gestures = [...original.matchAll(/\*([^*\n]+)\*/g)]
  if (!gestures.length) return { reply: original, changed: false, notes }

  // Pilih SATU gesture untuk dipertahankan: yang pertama dan bukan pengulangan.
  const keepRaw = (gestures.find((match) => !isRepeat(normalize(match[1]))) || null)?.[0] || null

  let used = false
  let fixed = original.replace(/\*([^*\n]+)\*/g, (match) => {
    if (keepRaw && !used && match === keepRaw) { used = true; return match }
    return ''
  })

  if (gestures.length > 1) notes.push('gesture berlebih dibuang')
  else if (!keepRaw) notes.push('gesture berulang dibuang')

  fixed = fixed.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return { reply: fixed, changed: notes.length > 0, notes }
}

// Buang blok rekomendasi komik yang NYASAR — dipakai saat server TIDAK mendeteksi
// intent komik sama sekali. Mencegah Yuki menempelkan kartu komik ke obrolan biasa,
// yang biasanya terjadi karena riwayat lama berisi link membuat model meniru polanya.
export function stripStrayComicBlocks(reply = '') {
  const text = String(reply || '')
  const linkLine = /^\s*\[Link\]\s*\(\s*https?:\/\/ryukomik\.my\.id\/[^\s)]*\)?\s*$/i
  const isMetaLine = (line = '') => /\[(manga|manhwa|manhua|webtoon|doujin)\]|chapter|update|★|·/i.test(line)
  const isTitleLine = (line = '') => /^\*\*[^*\n]+\*\*\s*$/.test(line.trim())

  const lines = text.split('\n')
  const out = []
  let removed = false
  for (const line of lines) {
    if (linkLine.test(line)) {
      removed = true
      // Buang juga baris meta + judul tepat di atasnya (bagian dari blok yang sama).
      if (out.length && isMetaLine(out[out.length - 1])) out.pop()
      if (out.length && isTitleLine(out[out.length - 1])) out.pop()
      continue
    }
    out.push(line)
  }
  if (!removed) return { reply: text, changed: false }
  const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()
  return { reply: cleaned, changed: true }
}

export function shouldInitiate({ turns = 0, serious = false, hasOpenLoop = false, userText = '' } = {}) {
  if (serious) return true
  if (/^(ya|iya|oke|ok|hmm|hm|gak|nggak|entah|terserah)[.! ]*$/i.test(userText.trim())) return false
  // Frekuensi: setiap 3 giliran (bukan 4 — sebelumnya komentar menyebut 3 tapi kodenya 4).
  // Tetap tidak setiap giliran, supaya tidak terasa dipaksa.
  if (hasOpenLoop) return turns > 0 && turns % 4 === 0
  return turns > 0 && turns % 3 === 0
}
