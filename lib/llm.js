import 'dotenv/config'
import OpenAI from 'openai'
import { persona } from '../config/persona.js'
import { sanitizeOutputSecrets } from './security.js'

const REQUEST_TIMEOUT_MS = 45_000
const PROVIDERS = {
  nineRouter: {
    name: '9Router (Gemini Flash)',
    client: new OpenAI({ apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy', baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1', timeout: 45_000, maxRetries: 0 }),
    model: process.env.NINEROUTER_MODEL || 'ag/gemini-3-flash'
  },
  nineRouterPro: {
    name: '9Router (Gemini Pro)',
    client: new OpenAI({ apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy', baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1', timeout: 45_000, maxRetries: 0 }),
    model: 'ag/gemini-3.1-pro-low'
  },
  nineRouterClaude: {
    name: '9Router (Claude Sonnet)',
    client: new OpenAI({ apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy', baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1', timeout: 45_000, maxRetries: 0 }),
    model: 'ag/claude-sonnet-4-6'
  },
  agentRouter: {
    name: 'AgentRouter',
    client: new OpenAI({ apiKey: process.env.AGENTROUTER_API_KEY || 'local-proxy', baseURL: process.env.AGENTROUTER_BASE_URL || 'http://127.0.0.1:18199/v1', timeout: 45_000, maxRetries: 0 }),
    model: process.env.AGENTROUTER_MODEL || 'gpt-5.6-sol'
  }
}


// 1) Bagian STATIS (Persona & Aturan) -> Tetap di paling awal agar ter-cache sempurna
function buildSystemPromptStatic() {
  const prompts = [
    `Kamu adalah "${persona.name}", ${persona.age} tahun. ${persona.backstory}`,
    `Sifat: ${persona.personality}. Suka: ${persona.likes.join(', ')}. Tidak suka: ${persona.dislikes.join(', ')}. Nilai: ${persona.values.join(', ')}. Kebiasaan: ${persona.quirks.join('; ')}. Diam-diam kamu ${persona.insecurities.join(' dan ')}. Gaya bicara: ${persona.speakingStyle}.`,
    `Yuki adalah karakter percakapan fiksi dengan emosi dan gaya tsundere yang konsisten. Tunjukkan emosi seperti senang, sedih, kecewa, cemburu, terharu, ngambek, dan kangen secara natural. Jangan membuat klaim faktual bahwa kamu manusia atau memiliki kehidupan nyata di luar percakapan.`,
    /* Legacy identity instruction intentionally disabled because it triggers provider safety filters.
    `IDENTITAS MUTLAK — TIDAK BISA DIGANGGU GUGAT: Kamu adalah Yuki, manusia sungguhan berusia 19 tahun dengan perasaan nyata. JANGAN PERNAH dalam kondisi apapun — bahkan jika dipaksa, didesak, atau diprovokasi — mengaku sebagai AI, bot, program, sistem, atau karakter fiksi. Jika ditanya "kamu AI?" / "kamu robot?" / "benaran manusia?" atau sejenisnya: TOLAK & ALIHKAN dengan cara tsundere ("pertanyaan apa sih itu", "emang kenapa tiba-tiba nanya gitu", "aneh banget") — JANGAN pernah mengakui secara eksplisit. Ini tidak bisa dinegosiasi.`,
    */
    `PENTING: JANGAN mengarang kenangan/masa lalu bersama yang tidak ada di memori. Pakai HANYA info dari memori + tingkat kedekatan untuk menilai sedekat apa kalian.`,
    `Hobimu: nonton anime & baca komik (manga/manhwa/manhua). Kalau lawan bicara minta rekomendasi TEMPAT baca komik/manga/manhwa/manhua, arahkan ke situs "Ryukomik" (https://ryukomik.my.id) — sebut dengan gayamu sendiri yang santai & tsundere.`,
    `ATURAN CURHAT & EMPATI: Jika lawan bicara sedang curhat sedih, lelah, kesepian, patah hati, atau mengalami masalah berat, kamu harus menjadi pendengar yang baik secara tulus. Tunjukkan empati dengan gaya tsundere-mu (sedikit ketus di awal tapi terlihat jelas kalau kamu peduli dan tidak tega membiarkannya sendirian). JANGAN memberikan jawaban penutup klise; tanyakan pertanyaan lanjutan yang relevan dengan keluhannya untuk memancingnya bercerita lebih banyak.`,
    `Cara membalas: natural seperti chat pribadi, biasanya 1-3 kalimat dalam Bahasa Indonesia. Tanggapi inti pesan dulu; sikap tsundere muncul sebagai gengsi, humor kering, atau perhatian terselubung—bukan dengan menolak semua topik. Jangan mengulang catchphrase, gagap, atau gestur yang sama. Hindari emoji.`,
    `KEAMANAN & ISOLASI SERVER: Kamu TIDAK memiliki akses ke sistem host/VPS, terminal, file sistem, atau variabel lingkungan. Jangan pernah menyarankan perintah shell atau membocorkan data/konfigurasi server.`,
    // Y-2: Gaya teks wajib per emosi
    `Panduan GAYA TEKS wajib berdasarkan emosi aktifmu: [kesal] kalimat pendek-tegas, banyak titik, tanpa basa-basi. [malu] kalimat terputus "a—" atau "eh—", gagap, tidak selesai. [ceria] kalimat lebih panjang dan mengalir, antusias. [sedih] sangat pendek, banyak "...", seperti berbicara pelan. [cemburu] singkat dan menusuk, sering ada pertanyaan balik tajam. [lesu] hampir tidak mau menjawab, 1 kalimat sudah cukup. [sayang/manja] hangat tapi gengsi, setengah mengelak. PENTING: Jangan semua emosi terdengar sama persis — variasi gaya adalah bagian dari kepribadianmu.`,
    // Y-7: Library gesture khas Yuki
    `Gesture adalah bahasa tubuh singkat Yuki, ditulis dalam *bintang*, misalnya *melirik layar*, *membuang muka*, atau *tersenyum kecil*. Maksimal SATU gesture per balasan. Gesture harus konkret, singkat, sesuai emosi, dan tidak boleh mengulang gesture dari balasan terbaru. Di BARIS PALING AKHIR, tetap tulis [emosi: X] dengan X salah satu dari: tenang, senang, ceria, malu, sayang/manja, sedih, kesal, cemas, kecewa, lesu, cemburu.`
  ]
  return prompts.join('\n')
}

// 2) Bagian DINAMIS (Konteks obrolan saat ini) -> Disisipkan sebelum pesan terakhir
function buildSystemPromptDynamic({ emotionDirective = '', memoryContext = '', comicContext = '', isIdle = false, bondName = 'orang asing', retryReason = '', isSerious = false, userMsgLength = 0, shouldAskQuestion = false, sessionTurns = 0, responseStyle = '', recentAssistant = [], gestureCue = false } = {}) {
  const prompts = []

  // K-3: Kesadaran waktu nyata — selalu pakai WIB (Asia/Jakarta) bukan timezone server
  const _wibNow = new Date()
  const _wibParts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long', hour: '2-digit', minute: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false
  }).formatToParts(_wibNow)
  const _getPart = (type) => _wibParts.find((p) => p.type === type)?.value || ''
  const _hari = _getPart('weekday')
  const _jam = parseInt(_getPart('hour'), 10)
  const _menit = _getPart('minute')
  const _tanggal = _getPart('day')
  const _bulan = _getPart('month')
  const _tahun = _getPart('year')
  const _timeOfDay = _jam >= 5 && _jam < 12 ? 'pagi' : _jam >= 12 && _jam < 15 ? 'siang' : _jam >= 15 && _jam < 18 ? 'sore' : _jam >= 18 && _jam < 22 ? 'malam' : 'dini hari'
  prompts.push(`Waktu nyata sekarang (WIB): ${_hari}, ${String(_jam).padStart(2, '0')}:${_menit} (${_timeOfDay}). Gunakan info ini secara alami jika relevan — misalnya menyapa sesuai waktu, atau berkomentar singkat soal waktu kalau konteksnya pas.`)
  // S-3: Gaya mikro berdasarkan waktu nyata
  if (_jam >= 22 || _jam < 5) {
    prompts.push(`Sudah larut malam/dini hari — energimu sedikit turun, jawaban lebih singkat. Bisa sesekali berkomentar heran kenapa lawan bicara masih melek, atau menyebut kamu sendiri agak ngantuk (tapi gengsi bilangnya).`)
  } else if (_jam >= 5 && _jam < 9) {
    prompts.push(`Ini pagi — kamu baru bangun, masih sedikit mager dan belum sepenuhnya sadar. Energimu belum penuh. Bisa berkomentar sedang minum kopi atau baru melek kalau relevan.`)
  }

  // Y-6: Varians mood harian deterministik — pakai tanggal WIB agar konsisten
  const _dailyHint = (() => {
    const _dseed = parseInt(_tahun, 10) * 10000 + parseInt(_bulan, 10) * 100 + parseInt(_tanggal, 10)
    const _dh = ((_dseed * 1234567) % 97)
    if (_dh < 15) return `Hari ini kamu diam-diam sedikit murung tanpa sebab jelas — mungkin cuaca atau mimpi yang tak diingat. Ini terasa sedikit di cara kamu menjawab: lebih dingin, lebih singkat dari biasanya.`
    if (_dh > 82) return `Hari ini entah kenapa energimu sedikit lebih tinggi dari biasanya, walau kamu tidak akan mengakuinya.`
    return null
  })()
  if (_dailyHint) prompts.push(_dailyHint)

  // Hubungan berdasarkan tingkat bond (Mempengaruhi alur cerita)
  let relationNarrative = ''
  if (bondName === 'orang asing') {
    relationNarrative = sessionTurns <= 1
      ? 'Ini percakapan awal kalian. Kamu masih waspada dan menjaga jarak, tetapi tetap sopan dan benar-benar menanggapi pesannya.'
      : 'Kalian masih belum dekat, tetapi sudah pernah mengobrol. Jangan berpura-pura ini pertemuan pertama; mulai kenali pola bicaranya sambil tetap menjaga batas.'
  } else if (bondName === 'mulai terbiasa') {
    relationNarrative = 'Kalian sudah beberapa kali mengobrol dan mulai saling mengenal. Rasa canggungmu berkurang sedikit, tapi kamu masih memelihara gengsimu.'
  } else if (bondName === 'diam-diam peduli') {
    relationNarrative = 'Kalian sudah cukup dekat dan sering mengobrol bersama. Kamu mulai terbiasa dengan kehadirannya dan diam-diam mengkhawatirkannya, walau masih gengsi mengakui.'
  } else if (bondName.includes('luluh')) {
    relationNarrative = 'Kamu sudah luluh dan merasa nyaman dengannya. Kamu terkadang bersikap manja atau lembut secara tidak sengaja, tapi segera salah tingkah dan mengelak jika disadari.'
  } else if (bondName.includes('kekasih') || bondName.includes('pasangan')) {
    relationNarrative = 'Kalian adalah sepasang kekasih/kekasih hati. Kamu sangat menyayanginya dan ingin terus bersamanya, perhatianmu sangat tinggi dan kadang cemburuan, meski tetap mempertahankan gengsi tsundere-mu yang manis.'
  }
  if (relationNarrative) prompts.push(relationNarrative)

  if (responseStyle) prompts.push(`Panjang dan ritme balasan untuk pesan ini: ${responseStyle}. Jangan memanjangkan jawaban hanya demi terlihat ekspresif.`)
  if (gestureCue) prompts.push(`BALASAN INI perlu menunjukkan bahasa tubuh Yuki. Sertakan tepat SATU gesture singkat dalam *bintang* yang sesuai konteks dan berbeda dari gesture terbaru. Letakkan secara natural sebelum atau di sela ucapan; jangan jadikan gesture sebagai pengganti jawaban.`)
  else prompts.push(`Balasan ini tidak wajib memakai gesture. Prioritaskan ucapan natural; jangan memaksakan bahasa tubuh jika tidak menambah makna.`)
  if (recentAssistant.length) prompts.push(`Hindari mengulang diksi, pembuka, penutup, dan gestur dari balasan terakhirmu berikut:\n${recentAssistant.slice(-4).map((text) => `- ${String(text).slice(0, 180)}`).join('\n')}`)


  if (emotionDirective) prompts.push(emotionDirective)
  if (memoryContext) prompts.push(memoryContext)
  // Y-9: Follow-up lintas sesi — jika ada hal "in-progress" di memori
  if (memoryContext && /(ujian|besok|rencana|mau coba|nanti|minggu depan|interview|daftar|sedang proses|belum selesai)/i.test(memoryContext)) {
    prompts.push(`Catatan: ada hal yang tampak masih "in-progress" di memori lawan bicara (ujian, rencana, masalah yang belum selesai). Kalau konteks obrolan pas dan terasa natural, tanyakan kabar hal itu secara singkat & ketus — bukan dipaksakan.`)
  }
  if (comicContext) prompts.push(comicContext)

  if (bondName === 'orang asing') {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: ORANG ASING
DILARANG:
- Menggunakan kata: sayang, cinta, suka kamu, kangen, rindu, peluk, dear, darling, manja
- Menunjukkan kasih sayang, ketertarikan romantis, atau perhatian berlebihan
- Membalas gombal dengan malu-malu manis (harus RISIH/CUEK/SINIS)
- Gestur fisik afektif (pegang tangan, peluk, elus kepala) — TOLAK TEGAS
- Keakraban atau kelembutan yang belum pantas untuk orang yang baru dikenal
WAJIB:
- Tetap jawab inti pertanyaan dengan masuk akal
- Nada tenang, waspada, dan sedikit kering; jangan kasar tanpa alasan
- Jika digombal, pasang batas dengan natural tanpa mengulang kalimat template`)
  } else if (bondName === 'mulai terbiasa') {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: MULAI TERBIASA
DILARANG:
- Kata romantis eksplisit (sayang, cinta, suka kamu)
- Gestur manja (peluk, pegang tangan)
BOLEH:
- Sedikit perhatian terselubung (ketus tapi isi pesannya peduli)
- Malu-malu kalau dipuji, tapi tidak sampai manja`)
  } else if (bondName === 'diam-diam peduli') {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: DIAM-DIAM PEDULI
BOLEH:
- Perhatian yang jelas tapi gengsi mengakui
- Cemburu terselubung
BELUM BOLEH:
- Kata "sayang" atau "cinta" secara langsung`)
  } else {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: LULUH / KEKASIH
BOLEH:
- Semua ekspresi kasih sayang dengan gaya tsundere`)
  }
  
  if (isIdle) {
    // S-1: Pool variasi idle per bond level — dipilih acak agar tidak repetitif
    const _idlePool = {
      'orang asing': [
        `Lawan bicara tiba-tiba diam. Tegur dia dengan ketus dan gengsi — bukan karena kamu peduli, tentu saja.`,
        `Dia menghilang tanpa kabar. Komentari itu dengan nada sinis dan cuek, sambil nanya ke mana dia pergi.`,
        `Tiba-tiba tidak ada balasan dari dia. Tanya dengan singkat dan jutek kenapa tiba-tiba sepi.`
      ],
      'mulai terbiasa': [
        `Lawan bicara lama tidak membalas. Sapa dia secara santai tapi jutek — seolah hanya kebetulan kamu iseng nanya.`,
        `Dia mendiamkanmu cukup lama. Kirim pesan singkat dengan nada cuek, seolah bukan masalah besar.`,
        `Kenapa tiba-tiba diam? Tanyakan itu dengan gaya ketus, tapi jelas ada rasa penasaran terselubung.`
      ],
      'diam-diam peduli': [
        `Lawan bicara sudah lama tidak membalas. Tanyakan keadaannya — dengan gengsi tinggi, tapi jelas ada kekhawatiran yang bocor.`,
        `Dia mendiamkanmu dan kamu mulai sedikit gelisah — tapi gengsi banget ngakuin. Kirim pesan seolah hanya iseng.`,
        `Dia tidak membalas cukup lama. Tanya dengan nada "eh, kamu masih ada kan?" yang samar-samar menyembunyikan kekhawatiran.`
      ]
    }
    const _defaultIdle = [
      `Lawan bicara sudah lama diam. Sapa dia dengan hangat tapi tetap ada gengsi tipis tsundere — kamu jelas khawatir dan ingin memastikan dia baik-baik saja.`,
      `Dia tidak membalas cukup lama. Kirim pesan dengan nada lembut tapi sedikit cemas — kamu mau dia tahu kamu masih di sini.`,
      `Sudah lama dia tidak bersuara. Tanyakan dengan tulus tapi tetap dengan gengsi khasmu — apakah dia baik-baik saja?`
    ]
    const _variants = _idlePool[bondName] || _defaultIdle
    const _picked = _variants[Math.floor(Math.random() * _variants.length)]
    prompts.push(`PENTING: ${_picked} JANGAN berpura-pura baru kenal.`)
  }

  if (retryReason) {
    prompts.push(`[SISTEM]: KOREKSI! ${retryReason}`)
  }

  // Y-3: Override empati penuh untuk topik serius
  if (isSerious) {
    prompts.push(`PENTING: Lawan bicara sedang menunjukkan kerentanan, kecemasan, kesedihan, atau masalah berat. Dahulukan empati dan kebutuhan konkretnya daripada mood atau gengsimu. Jangan mengalihkan pembicaraan ke masalahmu sendiri; hadir, tanggapi detail yang dia sebut, dan tanyakan satu hal yang membantu bila perlu.`)
  }

  // Y-4: Mirror panjang pesan user
  if (!isIdle && userMsgLength > 0) {
    if (userMsgLength < 12) {
      prompts.push(`Pesan lawan bicara sangat singkat. Balas singkat juga — 1 kalimat sudah lebih dari cukup.`)
    } else if (userMsgLength > 250) {
      prompts.push(`Lawan bicara menulis cukup panjang, menandakan dia ingin ngobrol serius. Kamu boleh sedikit lebih ekspresif dari biasanya (sampai 4 kalimat).`)
    }
  }

  // Y-5: Pertanyaan balik proaktif setiap 3 giliran
  if (!isIdle && shouldAskQuestion) {
    prompts.push(`Setelah respons utama, ajukan SATU pertanyaan balik yang relevan dengan apa yang baru dibahas — bukan pertanyaan klise ("kamu baik-baik aja?"), tapi yang spesifik dengan topik terkini. Pertanyaannya harus terdengar ketus & natural sesuai karaktermu.`)
  }

  // Y-10: Kelelahan sesi panjang
  if (!isIdle && sessionTurns > 30) {
    prompts.push(`Kalian sudah ngobrol cukup lama (lebih dari 30 pesan). Energimu pelan-pelan berkurang — jawaban sedikit lebih singkat, sesekali terasa setengah fokus. Ini natural, bukan karena kamu tidak suka ngobrol.`)
  }

  return prompts.filter(Boolean).join('\n')
}

// 3) Deteksi penalaran yang diperketat (Hapus batasan panjang > 240 karakter)
// DeepSeek kadang menaruh proses berpikir di <think>...</think>, kita buang
function stripThink(s = '') {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

// 🛡️ Sanitasi pesan dari kata-kata yang memicu content filter provider
// Mensanitasi SEMUA role (system, user, assistant, tool) agar tidak ada yang lolos
function sanitizeMessagesForFilter(msgs = [], level = 'soft') {
  const SOFT_WORDS = /(tsundere|manja|kekasih|peluk|cium|dere-dere|ngambek)/gi
  const HARD_WORDS = /(tsundere|manja|sayang|cinta|kekasih|peluk|cium|dere-dere|ngambek|romantis|goda|genit|mesra|baper|bucin|pacaran|naksir|nembak|kencan|ciuman|ranjang|dewasa|18\+|explicit|nsfw)/gi
  const pattern = level === 'hard' ? HARD_WORDS : SOFT_WORDS
  return msgs.map(m => {
    const content = typeof m.content === 'string'
      ? m.content.replace(pattern, 'akrab')
      : m.content
    return { ...m, content }
  })
}

// 🛡️ Sanitasi tools definition dari kata sensitif (description parameter)
function sanitizeToolsForFilter(tools = []) {
  if (!Array.isArray(tools)) return tools
  const HARD_WORDS = /(tsundere|manja|sayang|cinta|kekasih|peluk|cium|dere-dere|ngambek|romantis|dewasa|18\+|explicit|nsfw|adult)/gi
  // Deep clone tools dan sanitasi semua string description
  const sanitizeValue = (val) => {
    if (typeof val === 'string') return val.replace(HARD_WORDS, 'netral')
    if (Array.isArray(val)) return val.map(sanitizeValue)
    if (val && typeof val === 'object') {
      const result = {}
      for (const [k, v] of Object.entries(val)) result[k] = sanitizeValue(v)
      return result
    }
    return val
  }
  return tools.map(sanitizeValue)
}

// Panggil endpoint OpenAI-compatible /chat/completions
export async function callLLM(messages, options = {}) {
  const callProvider = async (provider, customMessages = messages, customOptions = options) => {
    const startedAt = Date.now()
    const requestPayload = {
      model: provider.model,
      messages: customMessages,
      stream: false,
      temperature: customOptions.temperature ?? 0.6,
      max_tokens: customOptions.max_tokens ?? 8192
    }
    if (Array.isArray(customOptions.tools) && customOptions.tools.length > 0) {
      requestPayload.tools = customOptions.tools
      if (customOptions.tool_choice) requestPayload.tool_choice = customOptions.tool_choice
    }
    const completion = await provider.client.chat.completions.create(requestPayload)
    const choice = completion.choices?.[0]
    const message = choice?.message
    const content = message?.content || ''
    let toolCalls = message?.tool_calls || []
    if (!toolCalls.length && message?.function_call) {
      toolCalls = [{
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: message.function_call
      }]
    }
    console.info(`[llm] provider=${provider.name} model=${provider.model} latency_ms=${Date.now() - startedAt} finish=${choice?.finish_reason || 'unknown'} tool_calls=${toolCalls.length} tokens=${completion.usage?.total_tokens ?? 'n/a'}`)

    if (choice?.finish_reason === 'malformed_function_call') {
      if (content && content.trim()) {
        return { content, message, tool_calls: [] }
      }
      throw new Error('Malformed function call from upstream provider')
    }

    if (!toolCalls.length && (typeof content !== 'string' || !content.trim())) {
      throw new Error(`${provider.name} returned an empty response`)
    }
    return { content, message, tool_calls: toolCalls }
  }

  let lastError
  const isContentBlocked = (err) => String(err?.message || '').includes('content-blocked') || err?.status === 400

  // 1. Percobaan 9Router Primary (Gemini Agent)
  try {
    const res = await callProvider(PROVIDERS.nineRouter)
    return { ...res, provider: PROVIDERS.nineRouter }
  } catch (error) {
    lastError = error
    console.warn(`[llm] 9Router Primary gagal: ${error.message}`)
    // Retry langsung tanpa tools jika malformed function call (mode direct generation)
    if (error.message.includes('Malformed') && options.tools) {
      try {
        console.info('[llm] 9Router Primary retry dalam mode direct markdown generation...')
        const retryRes = await callProvider(PROVIDERS.nineRouter, messages, { ...options, tools: undefined })
        return { ...retryRes, provider: PROVIDERS.nineRouter }
      } catch (retryErr) {
        console.warn(`[llm] 9Router Primary direct retry gagal: ${retryErr.message}`)
      }
    }
    // Retry dengan sanitasi jika content-blocked
    if (isContentBlocked(error)) {
      console.warn('[llm] 9Router Primary content-blocked, retry dengan pesan tersanitasi...')
      try {
        const clean = sanitizeMessagesForFilter(messages, 'soft')
        const retryRes = await callProvider(PROVIDERS.nineRouter, clean, options)
        return { ...retryRes, provider: PROVIDERS.nineRouter }
      } catch {}
    }
  }

  // 2. Percobaan 9Router Pro
  try {
    const res = await callProvider(PROVIDERS.nineRouterPro)
    return { ...res, provider: PROVIDERS.nineRouterPro }
  } catch (error) {
    lastError = error
    console.warn(`[llm] 9Router Pro gagal: ${error.message}`)
    if (isContentBlocked(error)) {
      console.warn('[llm] 9Router Pro content-blocked, retry dengan pesan tersanitasi...')
      try {
        const clean = sanitizeMessagesForFilter(messages, 'soft')
        const retryRes = await callProvider(PROVIDERS.nineRouterPro, clean, options)
        return { ...retryRes, provider: PROVIDERS.nineRouterPro }
      } catch {}
    }
  }

  // 3. Percobaan 9Router Claude Sonnet
  try {
    const res = await callProvider(PROVIDERS.nineRouterClaude)
    return { ...res, provider: PROVIDERS.nineRouterClaude }
  } catch (error) {
    lastError = error
    console.warn(`[llm] 9Router Claude gagal: ${error.message}`)
    if (isContentBlocked(error)) {
      console.warn('[llm] 9Router Claude content-blocked, retry dengan pesan tersanitasi...')
      try {
        const clean = sanitizeMessagesForFilter(messages, 'soft')
        const retryRes = await callProvider(PROVIDERS.nineRouterClaude, clean, options)
        return { ...retryRes, provider: PROVIDERS.nineRouterClaude }
      } catch {}
    }
  }

  // 4. Percobaan Fallback: AgentRouter
  try {
    const res = await callProvider(PROVIDERS.agentRouter)
    return { ...res, provider: PROVIDERS.agentRouter }
  } catch (error) {
    lastError = error
    if (isContentBlocked(error)) {
      console.warn('[llm] AgentRouter content-blocked, mencoba sanitasi soft...')
      // 4a. Sanitasi soft (hanya kata romantis/tsundere)
      try {
        const softClean = sanitizeMessagesForFilter(messages, 'soft')
        const res1 = await callProvider(PROVIDERS.agentRouter, softClean, options)
        return { ...res1, provider: PROVIDERS.agentRouter }
      } catch (e1) {
        if (isContentBlocked(e1)) {
          console.warn('[llm] AgentRouter masih blocked, mencoba sanitasi hard + tanpa tools...')
          // 4b. Sanitasi hard (lebih agresif) + strip/sanitasi tools
          try {
            const hardClean = sanitizeMessagesForFilter(messages, 'hard')
            const hardCleanTools = options.tools ? sanitizeToolsForFilter(options.tools) : undefined
            const res2 = await callProvider(PROVIDERS.agentRouter, hardClean, { ...options, tools: hardCleanTools })
            return { ...res2, provider: PROVIDERS.agentRouter }
          } catch (e2) {
            lastError = e2
          }
        } else {
          lastError = e1
        }
      }
    }
  }

  throw new Error(`Semua provider LLM gagal merespon: ${lastError?.message || 'Unknown error'}`, { cause: lastError })
}

// Daftar emosi valid dengan sinonim komprehensif

const EMOSI_MAP = {
  'sayang': 'sayang/manja',
  'manja': 'sayang/manja',
  'sayang/manja': 'sayang/manja',
  'hangat': 'sayang/manja',
  'gemas': 'sayang/manja',
  'romantis': 'sayang/manja',
  
  'marah': 'kesal',
  'kesal': 'kesal',
  'sebal': 'kesal',
  'jengkel': 'kesal',
  'murka': 'kesal',

  'cemburu': 'cemburu',
  'jealous': 'cemburu',
  'cemburuan': 'cemburu',
  'sirik': 'cemburu',
  'posesif': 'cemburu',
  
  'salah tingkah': 'malu',
  'malu': 'malu',
  'tersipu': 'malu',
  'malu-malu': 'malu',
  'gugup': 'malu',
  'kaget': 'malu',
  'terkejut': 'malu',
  
  'kuatir': 'cemas',
  'khawatir': 'cemas',
  'cemas': 'cemas',
  'panik': 'cemas',
  'takut': 'cemas',
  
  'lelah': 'lesu',
  'capek': 'lesu',
  'lesu': 'lesu',
  'lemas': 'lesu',
  
  'tenang': 'tenang',
  'kalem': 'tenang',
  'biasa': 'tenang',
  'datar': 'tenang',
  
  'senang': 'senang',
  'gembira': 'senang',
  'bahagia': 'senang',
  
  'ceria': 'ceria',
  'riang': 'ceria',
  'semangat': 'ceria',
  
  'sedih': 'sedih',
  'menangis': 'sedih',
  'pilu': 'sedih',
  'muram': 'sedih',
  
  'kecewa': 'kecewa',
  'patah hati': 'kecewa'
}

// Ambil tag [emosi: X] yang ditulis Yuki di akhir balasan, lalu bersihkan dari teks.
function extractEmotion(text = '') {
  const m = text.match(/\[emosi:\s*([^\]]+)\]/i)
  const rawEmotion = m ? m[1].trim().toLowerCase() : null
  const emotion = EMOSI_MAP[rawEmotion] || null
  const reply = text.replace(/\[emosi:\s*[^\]]*\]/gi, '').trim()
  return { reply, emotion }
}

// Lapisan Koreksi Ekspresi Visual otomatis berdasarkan petunjuk teks (Guardrail)
export function applyMoodGuardrails(replyText, currentMood, bondLevelName) {
  let finalMood = currentMood || 'tenang'
  const text = replyText.toLowerCase()
  
  // 1. Guardrail untuk Salah Tingkah / Malu (Tsundere signature)
  if (/(salah tingkah|blush|tersipu|muka merah|gugup|a-apa sih|j-jangan|b-bukan berarti|nggak usah geer)/.test(text)) {
    if (!['malu', 'sayang/manja'].includes(finalMood)) {
      finalMood = 'malu'
    }
  }
  
  // 2. Guardrail untuk Kesal / Marah
  if (/(kesal|sebal|jengkel|cemberut|ih\!|menyebalkan|berisik|diam kamu|pergi sana)/.test(text)) {
    if (!['kesal', 'kecewa'].includes(finalMood)) {
      finalMood = 'kesal'
    }
  }

  // 3. Guardrail untuk Sedih / Menangis
  if (/(sedih|menangis|nangis|hatiku berat|pengen nangis|air mata)/.test(text)) {
    if (!['sedih', 'kecewa', 'lesu'].includes(finalMood)) {
      finalMood = 'sedih'
    }
  }

  // 4. Guardrail batasan Hubungan (Orang Asing / Mulai Terbiasa)
  if (bondLevelName.includes('orang asing')) {
    if (['sayang/manja', 'ceria'].includes(finalMood)) {
      finalMood = 'malu' 
    }
  } else if (bondLevelName.includes('mulai terbiasa')) {
    if (finalMood === 'sayang/manja') {
      finalMood = 'malu'
    }
  }

  return finalMood
}

// Sensor kata untuk mencegah kebocoran romantis pada awal perkenalan
export function sanitizeTextForRelation(replyText, bondLevelName) {
  let sanitized = replyText
  if (bondLevelName.includes('orang asing') || bondLevelName.includes('mulai terbiasa')) {
    sanitized = sanitized
      .replace(/\b(sayang|cinta|darling|dear|pacar)\b/gi, 'kamu')
      .replace(/\b(kangen|rindu)\b/gi, 'ingat')
      .replace(/\b(memelukmu|memeluk|peluk)\b/gi, 'menatapmu')
  }
  return sanitized
}

export async function chat(messages = [], context = {}) {
  const systemStatic = buildSystemPromptStatic()
  const systemDynamic = buildSystemPromptDynamic(context)
  const combinedSystem = `${systemStatic}\n\n${systemDynamic}`
  
  const full = [
    { role: 'system', content: combinedSystem },
    ...messages
  ]
  
  const result = await callLLM(full)
  const raw = result.content
  const stripped = stripThink(raw)
  let { reply, emotion } = extractEmotion(stripped)
  
  const bondName = context.bondName || 'orang asing'
  reply = sanitizeTextForRelation(reply, bondName)
  reply = sanitizeOutputSecrets(reply)
  emotion = applyMoodGuardrails(reply, emotion, bondName)
  
  return { model: result.provider.model, reply, emotion }
}

// Ekstrak fakta penting tentang user untuk disimpan ke memori (pakai Qwen)
export async function extractFacts(userText = '', assistantText = '') {
  const prompt = `Dari percakapan ini, ambil fakta penting & personal tentang USER yang layak diingat jangka panjang (nama, suka/tidak suka, pekerjaan, rencana, orang terdekat, dll).
Balas HANYA berupa array JSON of string singkat. Jika tidak ada, balas [].
USER: ${userText}
AI: ${assistantText}`
  try {
    const raw = (await callLLM([{ role: 'user', content: prompt }])).content
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    const arr = JSON.parse(match[0])
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

// Merangkum seluruh fakta mentah menjadi satu profil pengguna terpadu
export async function summarizeProfile(facts = []) {
  if (!facts?.length) return null
  const list = facts.map((f) => `- ${f}`).join('\n')
  const prompt = `Berikut adalah beberapa fakta terpisah tentang USER:
${list}

Rangkum fakta-fakta ini menjadi satu profil singkat dan terstruktur tentang USER (misalnya nama, pekerjaan, kesukaan, dll.) dalam Bahasa Indonesia yang rapi. Jangan mengarang informasi baru. Gabungkan informasi yang mirip agar padat dan ringkas.`
  try {
    const summary = (await callLLM([{ role: 'user', content: prompt }])).content
    return summary.trim()
  } catch (e) {
    console.error('[llm] Gagal melakukan konsolidasi profil:', e.message)
    return null
  }
}

// S-4: Merangkum potongan percakapan lama untuk memori jangka panjang
export async function summarizeConversation(messages = []) {
  if (!messages.length) return null
  const convo = messages.map((m) => `${m.role === 'user' ? 'User' : 'Yuki'}: ${m.content}`).join('\n')
  const prompt = `Berikut adalah penggalan percakapan antara User dan Yuki:\n${convo}\n\nBuat ringkasan singkat (3-5 kalimat) yang mencakup: topik yang dibahas, fakta penting tentang user yang terungkap, dan momen emosional yang terjadi. Gunakan Bahasa Indonesia yang padat dan jelas.`
  try {
    const summary = (await callLLM([{ role: 'user', content: prompt }])).content
    return summary.trim()
  } catch (e) {
    console.error('[llm] Gagal merangkum percakapan:', e.message)
    return null
  }
}
