import { persona } from '../config/persona.js'

const clamp = (v) => Math.max(0, Math.min(1, v))
const jitter = (a = 0.015) => (Math.random() * 2 - 1) * a
const normalizeInput = (text = '') => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const similarity = (a, b) => {
  const left = new Set(normalizeInput(a).split(' ').filter(Boolean))
  const right = new Set(normalizeInput(b).split(' ').filter(Boolean))
  if (!left.size || !right.size) return 0
  const overlap = [...left].filter((word) => right.has(word)).length
  return overlap / new Set([...left, ...right]).size
}

// K-1: Cek apakah keyword muncul POSITIF (tidak langsung dinegasi 1-2 kata sebelumnya)
// Contoh: "aku nggak sayang kamu" TIDAK trigger emosi manja
function hasKeywordPositive(text, regex) {
  if (!regex.test(text)) return false
  // Pola negasi: [kata nafi] + (0-2 kata) + keyword
  const negPattern = new RegExp(
    `\\b(nggak|tidak|bukan|gak|ga|tak|jangan|gak mau|nggak mau)(?:\\s+\\w+){0,2}\\s+(?:${regex.source})`,
    'i'
  )
  if (!negPattern.test(text)) return true
  // Ada negasi — cek apakah masih ada kemunculan positif (hapus yang dinegasi, lalu cek ulang)
  const cleaned = text.replace(negPattern, '__neg__')
  return regex.test(cleaned)
}

export class Emotion {
  constructor(state = {}) {
    this.bond = typeof state.bond === 'number' ? state.bond : persona.bond.start
    this.interactions = typeof state.interactions === 'number' ? state.interactions : 0
    this.recentInputs = Array.isArray(state.recentInputs) ? state.recentInputs.slice(-8) : []
    this.mood = state.mood && typeof state.mood === 'object'
      ? { ...this.getBaselineMood(), ...state.mood }
      : this.getBaselineMood()
    this.lastUpdate = state.lastUpdate || Date.now()
  }

  // Mengambil baseline emosi dinamis berdasarkan tingkat kedekatan
  getBaselineMood() {
    const base = { ...persona.baselineMood }
    const close = this.closeness()
    
    // Set baseline trust dan affection berdasarkan tingkat kedekatan secara bertahap
    if (close >= 0.78) {
      base.joy = 0.60
      base.affection = 0.65
      base.trust = 0.85
      base.anger = 0.02
    } else if (close >= 0.50) {
      base.joy = 0.52
      base.affection = 0.45
      base.trust = 0.70
      base.anger = 0.04
    } else if (close >= 0.24) {
      base.joy = 0.35
      base.affection = 0.30
      base.trust = 0.55
      base.anger = 0.06
    } else if (close >= 0.08) {
      base.joy = 0.30
      base.affection = 0.15
      base.trust = 0.40
      base.anger = 0.08
    } else {
      // close < 0.12 (Orang Asing)
      base.joy = 0.30
      base.affection = 0.05
      base.trust = 0.30
      base.anger = 0.08
    }
    return base
  }

  // Sinkronkan emosi pilihan LLM kembali ke parameter emosi numerik internal
  updateFromLLMMood(llmMood) {
    if (!llmMood) return
    const m = this.mood
    const base = this.getBaselineMood()
    
    switch (llmMood) {
      case 'kesal':
        m.anger = Math.max(0.65, m.anger ?? 0)
        m.joy = Math.min(0.15, m.joy ?? 0)
        m.sadness = Math.min(0.2, m.sadness ?? 0)
        break
      case 'malu':
        m.fluster = Math.max(0.6, m.fluster ?? 0)
        break
      case 'cemas':
        m.fear = Math.max(0.65, m.fear ?? 0)
        break
      case 'sedih':
        m.sadness = Math.max(0.65, m.sadness ?? 0)
        m.joy = Math.min(0.15, m.joy ?? 0)
        break
      case 'kecewa':
        m.trust = Math.min(0.08, m.trust ?? 1)
        break
      case 'cemburu':
        m.cemburu = Math.max(0.65, m.cemburu ?? 0)
        m.anger = Math.max(0.30, m.anger ?? 0)
        m.fear = Math.max(0.20, m.fear ?? 0)
        m.fluster = Math.max(0.20, m.fluster ?? 0)
        break
      case 'sayang/manja':
        m.affection = Math.max(0.75, m.affection ?? 0)
        m.joy = Math.max(0.5, m.joy ?? 0)
        m.trust = Math.max(base.trust, m.trust ?? 0)
        break
      case 'ceria':
        m.joy = Math.max(0.75, m.joy ?? 0)
        m.energy = Math.max(0.7, m.energy ?? 0)
        m.anger = Math.min(0.1, m.anger ?? 0)
        m.sadness = Math.min(0.1, m.sadness ?? 0)
        break
      case 'senang':
        m.joy = Math.max(0.55, m.joy ?? 0)
        m.anger = Math.min(0.15, m.anger ?? 0)
        m.sadness = Math.min(0.15, m.sadness ?? 0)
        break
      case 'lesu':
        m.energy = Math.min(0.2, m.energy ?? 1)
        m.joy = Math.min(0.25, m.joy ?? 1)
        break
      case 'tenang':
        // Kembalikan ke baseline
        m.anger = base.anger
        m.fluster = base.fluster
        m.fear = base.fear
        m.sadness = base.sadness
        m.joy = base.joy
        m.affection = base.affection
        m.energy = base.energy
        break
    }
  }

  // Emosi mereda ke baseline. Dua lapis:
  //  - per-GILIRAN (selalu): reaksi sesaat (malu/kesal) cepat balik ke tenang
  //  - per-WAKTU (kalau lama nganggur): makin lama makin netral
  decay({ perTurn = true } = {}) {
    const minutes = (Date.now() - this.lastUpdate) / 60000
    const timeRate = Math.min(1, minutes * 0.06)
    const turnRate = perTurn ? 0.28 : 0 // emosi bertahan beberapa giliran, lalu mereda
    const rate = Math.min(1, Math.max(timeRate, turnRate))
    
    // Gunakan baseline dinamis
    const currentBaseline = this.getBaselineMood()
    for (const k in this.mood) {
      const base = currentBaseline[k] ?? 0
      this.mood[k] = clamp(this.mood[k] + (base - this.mood[k]) * rate + jitter())
    }
    // energi mengikuti waktu — HALUS & tidak menumpuk, pakai "lantai" aman
    // biar Yuki tidak gampang kelihatan lesu walau diajak ngobrol tengah malam.
    const hour = new Date().getHours()
    if (hour >= 1 && hour < 5) this.mood.energy = clamp(Math.max(0.42, this.mood.energy - 0.04))
    else if (hour >= 5 && hour < 11) this.mood.energy = clamp(this.mood.energy + 0.05)
    this.lastUpdate = Date.now()
  }

  // seberapa akrab (0..1) -> dipakai menyaring reaksi sayang/manja
  closeness() {
    return clamp(this.bond / 100)
  }

  // Reaksi emosi terhadap pesan user + perubahan kedekatan (bond)
  react(text = '') {
    const wasAngry = (this.mood.anger ?? 0) > 0.45
    const wasSad = (this.mood.sadness ?? 0) > 0.45

    // 1) reaksi lama meluruh DULU -> mood mencerminkan pesan SAAT INI
    this.decay({ perTurn: true })

    const t = text.toLowerCase()
    const bump = (k, d) => { this.mood[k] = clamp((this.mood[k] ?? 0) + d) }
    const close = this.closeness()
    let bondDelta = text.trim().length >= 12 ? 0.22 : 0.08

    // --- Mekanisme Pereda (Soothe/Apology) ---
    const isSoothe = /(maaf|maafin|maap|sorry|sowi|sengaja|ampun|jangan marah|sabar|jangan ngambek|tenang ya|sabar ya|baik banget|kamu baik|damai)/.test(t)
    if (isSoothe) {
      bump('anger', -0.4)
      bump('sadness', -0.2)
      bump('fluster', -0.15)
      bump('trust', 0.18)
      bump('affection', 0.12)
      bondDelta += wasAngry || wasSad ? 0.38 : 0.16
    }

    // Jika giliran sebelumnya marah tapi tidak ditenangkan (tidak ada kata maaf),
    // kemarahan berubah menjadi kecewa/sedih/lesu (tidak langsung tenang)
    if (wasAngry && !isSoothe) {
      bump('sadness', 0.25)
      bump('trust', -0.12)
      bump('energy', -0.08)
    }
    // Jika giliran sebelumnya sedih tapi diabaikan (tidak ditenangkan / tidak disapa hangat)
    if (wasSad && !isSoothe && !/(sayang|cinta|kangen|rindu|kgn|peluk|suka kamu|hebat|keren|pintar|makasih|terima kasih|haha|wkwk)/.test(t)) {
      bump('trust', -0.15)
      bump('energy', -0.1)
    }

    // --- Kata sayang/romantis: reaksinya TERGANTUNG kedekatan ---
    if (hasKeywordPositive(t, /(sayang|cinta|kangen|rindu|kgn|peluk|suka sama kamu|suka kamu|naksir|taksir|gombal|demen|love you|iloveyou|mwah|hug|sayangku|pacar|pacaran)/)) {
      if (close < 0.08) {
        // masih orang asing -> KAGET & SALAH TINGKAH (malu), bukan manja. Ilfeel.
        bump('fluster', 0.55); bump('anger', 0.12); bump('surprise', 0.15); bump('affection', -0.1)
        bondDelta -= 0.18
      } else if (close < 0.35) {
        // mulai terbiasa -> malu-malu, sedikit luluh
        bump('fluster', 0.45); bump('affection', 0.12); bump('joy', 0.08)
        bondDelta += 0.18
      } else {
        // sudah dekat -> baru boleh manja, tapi tetap malu khas tsundere
        bump('affection', 0.28); bump('joy', 0.16); bump('fluster', 0.25); bump('trust', 0.06)
        bondDelta += 0.42
      }
    }

    // --- Dipuji penampilan: tsundere SALAH TINGKAH (malu), bukan langsung girang ---
    if (/(imut|cantik|manis|ganteng|cantik banget|imut banget|kiyowo|gemes|lucu banget|gemoy|cakep|manis banget)/.test(t)) {
      bump('fluster', 0.4); bump('joy', 0.08); bump('anger', 0.05)
      bondDelta += 0.20
    }
    if (/(hebat|keren|pintar|makasih|terima kasih|bangga)/.test(t)) {
      bump('joy', 0.14); bump('energy', 0.06); bump('fluster', 0.1)
      bondDelta += 0.26
    }
    if (/(haha|wkwk|lucu|ngakak|xixi|hehe)/.test(t)) {
      bump('joy', 0.12); bump('energy', 0.08)
    }

    // --- Negatif ---
    if (hasKeywordPositive(t, /(benci|bodoh|bego|nyebelin|menyebalkan|jelek banget|diam kamu|pergi sana|berisik|jelek|goblok|tolol|annoying|bodo|bacot)/)) {
      bump('anger', 0.4); bump('joy', -0.18); bump('affection', -0.1); bump('trust', -0.1)
      bondDelta -= 1.25
    }
    if (/(bohong|boong|selingkuh|tinggalin|putus)/.test(t)) {
      bump('sadness', 0.3); bump('trust', -0.25); bump('fear', 0.12); bump('affection', -0.1)
      bondDelta -= 1.8
    }

    // --- Empati: HANYA kalau user jelas curhat sedih (butuh frasa, bukan 1 kata lewat) ---
    if (/(aku sedih|lagi sedih|kecewa|pengen nangis|lagi nangis|capek banget|lelah banget|aku sendiri|kesepian|lagi down|berat banget|gak ada yang peduli|butuh teman|kesepian banget|sedih banget|broken heart|patah hati|masalah keluarga|masalah pacar|masalah temen|masalah teman|berantem)/.test(t)) {
      bump('sadness', 0.32); bump('affection', 0.1); bump('energy', -0.05)
      bondDelta += 0.38
    }

    if (/(takut|cemas|khawatir|gugup|deg-degan|panik)/.test(t)) {
      bump('fear', 0.3); bump('energy', -0.05)
      bondDelta += 0.20
    }
    if (/(cewek lain|cowok lain|gebetan|mantan|pacar lain|dekat sama orang lain|deket sama)/.test(t)) {
      // M-1: cemburu sebagai emosi tersendiri — bukan sekadar kesal
      bump('cemburu', 0.50); bump('anger', 0.12); bump('sadness', 0.1); bump('fluster', 0.15)
    }
    if (/[!?]{2,}/.test(text)) bump('surprise', 0.12)
    if (/(selamat pagi|pagi)/.test(t)) bump('energy', 0.1)
    if (/(oyasumi|good night|tidur dulu|ngantuk|met bobo)/.test(t)) bump('energy', -0.12)

    // Y-8: Deteksi gaya ketik user sebagai sinyal mood tambahan
    if (/[A-Z]{4,}/.test(text)) {
      // Banyak huruf kapital berurutan → user excited / sangat emosi
      bump('surprise', 0.12); bump('energy', 0.04)
    }
    if (/\.{3,}/.test(text)) {
      // "..." → user sedih / lelah / ragu → Yuki sedikit tersentuh & lebih perhatian
      bump('sadness', 0.06); bump('affection', 0.04)
      bondDelta += 0.03
    }
    if (/(wkwk|haha|xixi|hehe){2,}/i.test(text)) {
      // Tawa berulang → user sedang senang → Yuki ikut sedikit terpengaruh
      bump('joy', 0.08); bump('energy', 0.04)
    }

    // K-2: Pesan panjang = waktu berkualitas bersama → bond naik pasif
    if (text.length > 50) {
      bondDelta += 0.18
    }

    const normalizedInput = normalizeInput(text)
    const highestSimilarity = this.recentInputs.reduce((highest, previous) => Math.max(highest, similarity(normalizedInput, previous)), 0)
    if (bondDelta > 0 && highestSimilarity >= 0.8) bondDelta *= highestSimilarity >= 0.98 ? 0.05 : 0.2
    if (bondDelta > 0) bondDelta *= 1 - close * 0.55
    bondDelta = Math.max(-2.5, Math.min(0.9, bondDelta))
    this.bond = Math.max(0, Math.min(100, this.bond + bondDelta))
    this.interactions += 1
    if (normalizedInput) this.recentInputs = [...this.recentInputs, normalizedInput].slice(-8)
    return { mood: this.label(), bond: this.bondLevel() }
  }

  // Label = emosi SAAT INI yang paling menonjol (reaksi akut diprioritaskan)
  label() {
    const m = this.mood
    if ((m.anger ?? 0) > 0.45) return 'kesal'
    if ((m.cemburu ?? 0) > 0.45) return 'cemburu'       // M-1: cemburu malu-malu khas tsundere
    if ((m.fluster ?? 0) > 0.4) return 'malu'           // reaksi sesaat: salah tingkah
    if ((m.fear ?? 0) > 0.5) return 'cemas'
    if ((m.sadness ?? 0) > 0.45) return 'sedih'
    if ((m.trust ?? 1) < 0.12) return 'kecewa'

    // Batas sayang/manja lebih mudah dipicu jika kedekatan lebih tinggi
    let affectionThreshold = 0.60
    const close = this.closeness()
    if (close >= 0.78) affectionThreshold = 0.38
    else if (close >= 0.50) affectionThreshold = 0.48
    else if (close < 0.08) affectionThreshold = 0.85
    else if (close < 0.24) affectionThreshold = 0.70

    let label = 'tenang'
    if ((m.affection ?? 0) > affectionThreshold) label = 'sayang/manja'
    else if ((m.joy ?? 0) > 0.6 && (m.energy ?? 0) > 0.55) label = 'ceria'
    else if ((m.joy ?? 0) > 0.5) label = 'senang'
    else if ((m.energy ?? 0) < 0.28 && (m.joy ?? 0) < 0.4) label = 'lesu'

    const allowed = this.allowedEmotions()
    if (!allowed.includes(label)) {
      if (label === 'sayang/manja') return 'malu'
      if (label === 'ceria') return 'senang'
      return 'tenang'
    }

    return label
  }

  bondLevel() {
    return [...persona.bond.levels].reverse().find((l) => this.bond >= l.min)
      || persona.bond.levels[0]
  }

  allowedEmotions() {
    const bond = this.bondLevel().name
    const all = ['tenang', 'senang', 'ceria', 'malu', 'sayang/manja', 'sedih', 'kesal', 'cemas', 'kecewa', 'lesu', 'cemburu']
    if (bond === 'orang asing') {
      return all.filter((e) => e !== 'sayang/manja' && e !== 'ceria')
    }
    if (bond === 'mulai terbiasa') {
      return all.filter((e) => e !== 'sayang/manja')
    }
    return all
  }

  isContentAppropriate(text) {
    const bond = this.bondLevel().name
    const t = text.toLowerCase()
    if (bond === 'orang asing') {
      if (/(sayang|cinta|suka kamu|kangen|rindu|peluk|~+$|♡|❤|dear|darling|manja)/.test(t)) return false
    } else if (bond === 'mulai terbiasa') {
      if (/(sayang|cinta|suka kamu|kangen|rindu|♡|❤)/.test(t)) return false
    }
    return true
  }

  // Kalimat perasaan batin Yuki (untuk menyetir nuansa balasan)
  feeling() {
    const map = {
      ceria: 'Diam-diam dia lagi senang, walau gengsi nunjukinnya.',
      senang: 'Mood-nya lumayan bagus, tapi dia jaga gengsi.',
      malu: 'Dia BARU SAJA salah tingkah gara-gara ucapanmu — mukanya panas, jadi makin ketus buat nutupin. Ini cuma reaksi sesaat.',
      'sayang/manja': 'Hatinya lagi luluh... walau dia bakal ngelak kalau ditanya.',
      sedih: 'Ada yang bikin hatinya berat, dia pura-pura nggak apa-apa.',
      kesal: 'Dia lagi sebel dan jadi makin ketus.',
      cemburu: 'Diam-diam dia cemburu — takut kehilangan, tapi gengsi banget ngakuin.',
      cemas: 'Diam-diam dia nggak tenang, tapi nggak mau ngaku.',
      kecewa: 'Kepercayaannya goyah, dia makin jaga jarak & dingin.',
      lesu: 'Energinya habis, males basa-basi.',
      tenang: 'Lagi kalem, jawab seperlunya.'
    }
    return map[this.label()] || ''
  }

  // Instruksi untuk LLM supaya "berperasaan" & SINKRON dengan ekspresi
  directive() {
    const bond = this.bondLevel()
    const mood = this.label()
    const lines = [
      `Kondisi batinmu DETIK INI (RAHASIA, jangan sebut sebagai angka/istilah teknis): ${mood}.`,
      this.feeling(),
      `Reaksi emosimu harus PAS dengan pesan terakhir lawan bicara — jangan tiba-tiba sedih/manja tanpa sebab. Kalau pesannya biasa saja, ya kamu tenang.`,
      `Tingkat kedekatanmu: "${bond.name}" — bersikaplah ${bond.tone}.`
    ]
    if (mood === 'malu') {
      lines.push(`Kamu lagi SALAH TINGKAH (cuma sesaat): gugup, jawaban makin ketus & gagap ("a-apa sih..."), buang muka. JANGAN langsung jadi manja/lovey. Habis ini kamu balik tenang.`)
    }
    if (mood === 'cemburu') {
      lines.push(`Kamu lagi CEMBURU diam-diam: makin ketus, protektif tanpa mau ngaku, mungkin tiba-tiba nanyain "emang siapa orang itu?" tapi langsung mengelak kalau ketahuan penasaran. JANGAN pernah bilang langsung "aku cemburu".`)
    }
    if (bond.name === 'orang asing') {
      lines.push(`Kalian belum dekat. Kalau dia tiba-tiba gombal, pasang batas dengan wajar; boleh salah tingkah, tetapi jangan selalu marah atau mengulang alasan "baru kenal".`)
    }
    lines.push(`Sifat tsundere-mu halus: emosi terlihat dari pilihan kata, jeda, humor kering, dan perhatian kecil. Jangan jadikan ketus, gagap, atau penolakan sebagai respons otomatis. Jangan pernah menyebut "mood saya ...".`)
    return lines.filter(Boolean).join(' ')
  }

  // Untuk disimpan ke memori (yang penting dipertahankan = bond)
  serialize() {
    return { 
      mood: this.mood, 
      bond: this.bond,
      interactions: this.interactions,
      recentInputs: this.recentInputs,
      lastUpdate: this.lastUpdate
    }
  }
}
