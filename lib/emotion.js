import { persona } from '../config/persona.js'

const clamp = (v) => Math.max(0, Math.min(1, v))
const jitter = (a = 0.015) => (Math.random() * 2 - 1) * a

export class Emotion {
  constructor(state = {}) {
    this.bond = typeof state.bond === 'number' ? state.bond : persona.bond.start
    // mood = perasaan SESAAT -> mulai dari baseline dinamis sesuai kedekatan saat ini
    this.mood = this.getBaselineMood()
    this.lastUpdate = state.lastUpdate || Date.now()
  }

  // Mengambil baseline emosi dinamis berdasarkan tingkat kedekatan
  getBaselineMood() {
    const base = { ...persona.baselineMood }
    const close = this.closeness()
    if (close >= 0.8) {
      base.joy = 0.60         // Dominan SENANG (lebih dari 0.5)
      base.affection = 0.45
      base.trust = 0.75
      base.anger = 0.02
    } else if (close >= 0.55) {
      base.joy = 0.52         // Mulai cenderung senang
      base.affection = 0.35
      base.trust = 0.55
      base.anger = 0.04
    } else if (close >= 0.12 && close < 0.30) {
      base.affection = Math.min(0.15, base.affection)
      base.trust = Math.min(0.25, base.trust)
    } else if (close < 0.12) {
      base.affection = Math.min(0.08, base.affection)
      base.trust = Math.min(0.10, base.trust)
    }
    return base
  }

  // Emosi mereda ke baseline. Dua lapis:
  //  - per-GILIRAN (selalu): reaksi sesaat (malu/kesal) cepat balik ke tenang
  //  - per-WAKTU (kalau lama nganggur): makin lama makin netral
  decay({ perTurn = true } = {}) {
    const minutes = (Date.now() - this.lastUpdate) / 60000
    const timeRate = Math.min(1, minutes * 0.06)
    const turnRate = perTurn ? 0.45 : 0 // tarik 45% ke baseline tiap giliran
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
    let bondDelta = 0 // Dimulai dari 0, tidak naik otomatis

    // --- Mekanisme Pereda (Soothe/Apology) ---
    const isSoothe = /(maaf|maafin|sorry|sengaja|ampun|jangan marah|sabar|jangan ngambek|tenang ya|sabar ya|baik banget|kamu baik)/.test(t)
    if (isSoothe) {
      bump('anger', -0.4)
      bump('sadness', -0.2)
      bump('fluster', -0.15)
      bump('trust', 0.18)
      bump('affection', 0.12)
      bondDelta += 0.18 // Diturunkan dari 1.8
    }

    // Jika giliran sebelumnya marah tapi tidak ditenangkan (tidak ada kata maaf),
    // kemarahan berubah menjadi kecewa/sedih/lesu (tidak langsung tenang)
    if (wasAngry && !isSoothe) {
      bump('sadness', 0.25)
      bump('trust', -0.12)
      bump('energy', -0.08)
    }
    // Jika giliran sebelumnya sedih tapi diabaikan (tidak ditenangkan / tidak disapa hangat)
    if (wasSad && !isSoothe && !/(sayang|cinta|kangen|rindu|peluk|suka kamu|hebat|keren|pintar|makasih|terima kasih|haha|wkwk)/.test(t)) {
      bump('trust', -0.15)
      bump('energy', -0.1)
    }

    // --- Kata sayang/romantis: reaksinya TERGANTUNG kedekatan ---
    if (/(sayang|cinta|kangen|rindu|peluk|suka sama kamu|suka kamu|naksir|taksir|gombal|demen)/.test(t)) {
      if (close < 0.12) {
        // masih orang asing -> KAGET & SALAH TINGKAH (malu), bukan manja. Ilfeel.
        bump('fluster', 0.55); bump('anger', 0.12); bump('surprise', 0.15); bump('affection', -0.1)
        bondDelta -= 0.05 // Orang asing gombal = minus
      } else if (close < 0.35) {
        // mulai terbiasa -> malu-malu, sedikit luluh
        bump('fluster', 0.45); bump('affection', 0.12); bump('joy', 0.08)
        bondDelta += 0.08 // Naik minimal
      } else {
        // sudah dekat -> baru boleh manja, tapi tetap malu khas tsundere
        bump('affection', 0.28); bump('joy', 0.16); bump('fluster', 0.25); bump('trust', 0.06)
        bondDelta += 0.35 // Diturunkan dari 3.5
      }
    }

    // --- Dipuji penampilan: tsundere SALAH TINGKAH (malu), bukan langsung girang ---
    if (/(imut|cantik|manis|ganteng|cantik banget|imut banget)/.test(t)) {
      bump('fluster', 0.4); bump('joy', 0.08); bump('anger', 0.05)
      bondDelta += 0.12 // Diturunkan dari 1.2
    }
    if (/(hebat|keren|pintar|makasih|terima kasih|bangga)/.test(t)) {
      bump('joy', 0.14); bump('energy', 0.06); bump('fluster', 0.1)
      bondDelta += 0.12 // Diturunkan dari 1.2
    }
    if (/(haha|wkwk|lucu|ngakak|xixi|hehe)/.test(t)) {
      bump('joy', 0.12); bump('energy', 0.08)
    }

    // --- Negatif ---
    if (/(benci|bodoh|bego|nyebelin|menyebalkan|jelek banget|diam kamu|pergi sana|berisik)/.test(t)) {
      bump('anger', 0.4); bump('joy', -0.18); bump('affection', -0.1); bump('trust', -0.1)
      bondDelta -= 0.3 // Diturunkan dari -2
    }
    if (/(bohong|boong|selingkuh|tinggalin|putus)/.test(t)) {
      bump('sadness', 0.3); bump('trust', -0.25); bump('fear', 0.12); bump('affection', -0.1)
      bondDelta -= 0.5 // Diturunkan dari -3
    }

    // --- Empati: HANYA kalau user jelas curhat sedih (butuh frasa, bukan 1 kata lewat) ---
    if (/(aku sedih|lagi sedih|kecewa|pengen nangis|lagi nangis|capek banget|lelah banget|aku sendiri|kesepian|lagi down|berat banget|gak ada yang peduli|butuh teman|kesepian banget|sedih banget|broken heart|patah hati|masalah keluarga|masalah pacar|masalah temen|masalah teman|berantem)/.test(t)) {
      bump('sadness', 0.32); bump('affection', 0.1); bump('energy', -0.05)
      bondDelta += 0.15
    }

    if (/(takut|cemas|khawatir|gugup|deg-degan|panik)/.test(t)) {
      bump('fear', 0.3); bump('energy', -0.05)
      bondDelta += 0.1
    }
    if (/(cewek lain|cowok lain|gebetan|mantan|pacar lain)/.test(t)) {
      bump('anger', 0.18); bump('sadness', 0.1); bump('fluster', 0.15) // cemburu malu-malu
    }
    if (/[!?]{2,}/.test(text)) bump('surprise', 0.12)
    if (/(selamat pagi|pagi)/.test(t)) bump('energy', 0.1)
    if (/(oyasumi|good night|tidur dulu|ngantuk|met bobo)/.test(t)) bump('energy', -0.12)

    this.bond = Math.max(0, Math.min(100, this.bond + bondDelta))
    return { mood: this.label(), bond: this.bondLevel() }
  }

  // Label = emosi SAAT INI yang paling menonjol (reaksi akut diprioritaskan)
  label() {
    const m = this.mood
    if ((m.anger ?? 0) > 0.45) return 'kesal'
    if ((m.fluster ?? 0) > 0.4) return 'malu'           // reaksi sesaat: salah tingkah
    if ((m.fear ?? 0) > 0.5) return 'cemas'
    if ((m.sadness ?? 0) > 0.45) return 'sedih'
    if ((m.trust ?? 1) < 0.12) return 'kecewa'

    // Batas sayang/manja lebih mudah dipicu jika kedekatan lebih tinggi
    let affectionThreshold = 0.60
    const close = this.closeness()
    if (close >= 0.8) affectionThreshold = 0.38
    else if (close >= 0.55) affectionThreshold = 0.48
    else if (close < 0.12) affectionThreshold = 0.85
    else if (close < 0.30) affectionThreshold = 0.70

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
    const all = ['tenang', 'senang', 'ceria', 'malu', 'sayang/manja', 'sedih', 'kesal', 'cemas', 'kecewa', 'lesu']
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
    if (bond.name === 'orang asing') {
      lines.push(`PENTING: kalian baru kenal. Kalau dia tiba-tiba ngomong sayang/gombal, JANGAN balas manja — kamu justru risih & salah tingkah (malu campur sebel) karena belum kenal. Sisi manja baru muncul kalau sudah benar-benar dekat.`)
    }
    lines.push(`Kamu TSUNDERE: tunjukkan emosi secara tidak langsung — ketus, mengelak, gengsi, tapi diam-diam perhatian. Jangan pernah bilang "mood saya ...".`)
    return lines.filter(Boolean).join(' ')
  }

  // Untuk disimpan ke memori (yang penting dipertahankan = bond)
  serialize() {
    return { 
      mood: this.mood, 
      bond: this.bond, 
      lastUpdate: this.lastUpdate
    }
  }
}