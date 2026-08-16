const normalize = (text = '') => text.toLowerCase().replace(/\*[^*]+\*/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

export function textSimilarity(left = '', right = '') {
  const a = new Set(normalize(left).split(' ').filter((word) => word.length > 2))
  const b = new Set(normalize(right).split(' ').filter((word) => word.length > 2))
  if (!a.size || !b.size) return 0
  const overlap = [...a].filter((word) => b.has(word)).length
  return overlap / Math.max(1, Math.min(a.size, b.size))
}

export function responseTarget(userText = '', { serious = false, idle = false } = {}) {
  if (idle) return { max: 180, style: 'satu kalimat ringan' }
  if (serious) return { max: 900, style: '2-5 kalimat empatik dan fokus' }
  if (userText.length < 18) return { max: 220, style: '1-2 kalimat singkat' }
  if (userText.length > 280) return { max: 850, style: '2-5 kalimat yang menanggapi detail penting' }
  if (/\?|gimana|menurutmu|jelasin|kenapa|tolong|rekomendasi/i.test(userText)) return { max: 650, style: 'jawaban cukup lengkap, lalu satu respons natural' }
  return { max: 420, style: '1-3 kalimat natural' }
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
  if (gestureRequired && gestures.length === 0) issues.push('gesture emosional yang diminta tidak muncul')
  if (gestures.length > 1) issues.push('terlalu banyak gesture dalam satu balasan')
  const recentGestures = recentAssistant.slice(-5).flatMap((text) => [...text.matchAll(/\*([^*]+)\*/g)].map((match) => normalize(match[1])))
  if (gestures.some((gesture) => gesture && recentGestures.some((old) => textSimilarity(gesture, old) >= 0.65))) issues.push('gestur berulang')
  return { ok: issues.length === 0, issues, maxSimilarity }
}

export function shouldInitiate({ turns = 0, serious = false, hasOpenLoop = false, userText = '' } = {}) {
  if (serious) return true
  if (/^(ya|iya|oke|ok|hmm|hm|gak|nggak|entah|terserah)[.! ]*$/i.test(userText.trim())) return false
  if (hasOpenLoop) return turns > 0 && turns % 5 === 0
  return turns > 0 && turns % 4 === 0
}
