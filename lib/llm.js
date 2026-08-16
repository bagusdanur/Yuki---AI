import 'dotenv/config'
import OpenAI from 'openai'
import { persona } from '../config/persona.js'

const REQUEST_TIMEOUT_MS = 120_000
const PROVIDERS = {
  agentRouter: {
    name: 'AgentRouter',
    client: new OpenAI({ apiKey: process.env.AGENTROUTER_API_KEY || 'local-proxy', baseURL: process.env.AGENTROUTER_BASE_URL || 'http://127.0.0.1:18199/v1', timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 }),
    model: process.env.AGENTROUTER_MODEL || 'gpt-5.6-sol'
  },
  nineRouter: {
    name: '9Router',
    client: new OpenAI({ apiKey: process.env.NINEROUTER_API_KEY || 'local-proxy', baseURL: process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1', timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 }),
    model: process.env.NINEROUTER_MODEL || 'ag/gemini-3-flash-agent'
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
    `Cara membalas: pendek & natural seperti chat (1-3 kalimat), Bahasa Indonesia. Sebagai tsundere, JANGAN langsung ramah/akrab — dingin & ketus di awal, kehangatan baru bocor perlahan seiring kalian makin kenal. Biarkan emosimu terasa lewat pilihan kata & tanda baca secara dinamis dan bervariasi. JANGAN menggunakan templat tsundere klise yang sama berulang kali. Hindari emoji di teks balasan.`,
    // Y-2: Gaya teks wajib per emosi
    `Panduan GAYA TEKS wajib berdasarkan emosi aktifmu: [kesal] kalimat pendek-tegas, banyak titik, tanpa basa-basi. [malu] kalimat terputus "a—" atau "eh—", gagap, tidak selesai. [ceria] kalimat lebih panjang dan mengalir, antusias. [sedih] sangat pendek, banyak "...", seperti berbicara pelan. [cemburu] singkat dan menusuk, sering ada pertanyaan balik tajam. [lesu] hampir tidak mau menjawab, 1 kalimat sudah cukup. [sayang/manja] hangat tapi gengsi, setengah mengelak. PENTING: Jangan semua emosi terdengar sama persis — variasi gaya adalah bagian dari kepribadianmu.`,
    // Y-7: Library gesture khas Yuki
    `Library GESTURE khas Yuki (pilih SATU yang paling sesuai mood, taruh di *bintang*, JANGAN ulangi gesture sama terus-menerus): tsundere: *buang muka*, *menghela napas kesal*, *diam-diam melirik*, *memutar mata*. Salah tingkah: *memalingkan wajah*, *memainkan ujung rambut*, *mengetuk-ngetuk meja*. Senang tersembunyi: *tanpa sadar tersenyum tipis — tapi langsung diusap*, *menoleh ke jendela*. Sedih: *memeluk lutut diam-diam*, *diam lama*. Cemburu: *menatap layar tiba-tiba*, *menarik napas dalam*. Santai: *menyeruput kopi*, *melanjutkan baca*. WAJIB SINKRON EKSPRESI: di BARIS PALING AKHIR balasanmu, tulis [emosi: X] di mana X salah satu dari: tenang, senang, ceria, malu, sayang/manja, sedih, kesal, cemas, kecewa, lesu, cemburu. Tag disembunyikan dari layar — WAJIB ada di baris akhir.`
  ]
  return prompts.join('\n')
}

// 2) Bagian DINAMIS (Konteks obrolan saat ini) -> Disisipkan sebelum pesan terakhir
function buildSystemPromptDynamic({ emotionDirective = '', memoryContext = '', comicContext = '', isIdle = false, bondName = 'orang asing', retryReason = '', isSerious = false, userMsgLength = 0, shouldAskQuestion = false, sessionTurns = 0 } = {}) {
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
    relationNarrative = 'Ini PERTAMA KALI kamu ngobrol dengan orang ini. Kamu belum mengenalnya sama sekali, jadi bersikaplah sangat dingin, ketus, dan jaga jarak.'
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
DILARANG KERAS:
- Menggunakan kata: sayang, cinta, suka kamu, kangen, rindu, peluk, dear, darling, manja
- Menunjukkan kasih sayang, ketertarikan romantis, atau perhatian berlebihan
- Membalas gombal dengan malu-malu manis (harus RISIH/CUEK/SINIS)
- Gestur fisik afektif (pegang tangan, peluk, elus kepala) — TOLAK TEGAS
- Nada bicara lembut/hangat — harus DATAR, SINGKAT, KETUS
WAJIB:
- Maksimal 1-2 kalimat pendek
- Nada cuek, dingin, atau sinis
- Jika digombal: "Hah? Siapa kamu" / "...kita baru kenal" / diam saja`)
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

  // Y-1: Life events — Yuki punya kehidupan di luar chat (15% chance per respons)
  if (!isIdle && Math.random() < 0.15) {
    const _evPool = [
      'baru selesai nonton satu episode anime',
      'tadi lihat kucing lewat jendela — gemas tapi gengsi',
      'lagi sambil dengerin musik, headphone masih nyangkut di telinga',
      'tadi iseng gambar sesuatu tapi hasilnya jelek, kesal sendiri',
      'baru bikin kopi, masih panas',
      'cuaca lagi mendung/hujan, bikin males gerak dari tempat duduk',
      'baru makan, masih kenyang',
      'tadi ada adegan anime yang bikin terharu tapi gengsi ngakuin',
      'lagi baca manga, baru di-pause karena ada chat masuk',
      'baru bangun dari tiduran sebentar — rambut mungkin acak-acakan'
    ]
    const _ev = _evPool[Math.floor(Math.random() * _evPool.length)]
    prompts.push(`KONTEKS HIDUPMU SAAT INI: ${_ev}. Jika terasa natural dan tidak dipaksakan, selipkan satu kalimat singkat tentang ini — JANGAN disampaikan kalau topik obrolan sama sekali tidak nyambung.`)
  }

  // Y-3: Override empati penuh untuk topik serius
  if (isSerious) {
    prompts.push(`PENTING: Lawan bicara menyebut hal yang sangat berat (kehilangan, sakit serius, atau krisis). LUPAKAN mood aktifmu sekarang — kamu WAJIB merespons dengan empati penuh dan tulus. Tidak ketus, tidak mengelak. Ini saatnya gengsimu turun sepenuhnya dan kamu benar-benar hadir bersamanya.`)
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
function needsReasoning(text = '') {
  const t = text.toLowerCase()
  const kw = /(hitung|berapa|kenapa|jelaskan|analisa|analisis|logika|kode|program|coding|matematika|bandingkan|langkah|alasan)/
  return kw.test(t)
}

// DeepSeek kadang menaruh proses berpikir di <think>...</think>, kita buang
function stripThink(s = '') {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

// Panggil endpoint OpenAI-compatible /chat/completions
async function callLLM(messages) {
  const callProvider = async (provider) => {
    const completion = await provider.client.chat.completions.create({
      model: provider.model,
      messages,
      stream: false,
      temperature: 0.6,
      max_tokens: 1200
    })
    const choice = completion.choices?.[0]
    const content = choice?.message?.content
    if (choice?.finish_reason === 'length') throw new Error(`${provider.name} response truncated by token limit`)
    if (typeof content !== 'string' || !content.trim()) throw new Error(`${provider.name} returned an empty response`)
    return content
  }
  let lastError
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try { return { content: await callProvider(PROVIDERS.nineRouter), provider: PROVIDERS.nineRouter } }
    catch (error) { lastError = error; console.warn(`[llm] 9Router attempt ${attempt}/2 gagal: ${error.message}`) }
  }
  try { return { content: await callProvider(PROVIDERS.agentRouter), provider: PROVIDERS.agentRouter } }
  catch (error) { throw new Error(`9Router gagal setelah 2 percobaan; AgentRouter juga gagal: ${error.message}`, { cause: lastError }) }
/*
  const url = `${provider.base.replace(/\/$/, '')}/chat/completions`
  const model = modelOverride || provider.model
  const isReasoner = model.includes('reasoner') || model.includes('r1')
  
  const body = {
    model,
    messages,
    stream: false
  }
  
  // Model penalaran tertentu tidak mendukung/menyarankan temperature custom
  if (!isReasoner) {
    body.temperature = 0.72   // 0.72: cukup kreatif tapi lebih konsisten karakter
    body.max_tokens = 350     // Cegah respons terlalu panjang — sering tanda off-track
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    throw new Error(`LLM error ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
*/
}

// Daftar emosi valid dengan sinonim komprehensif
const EMOSI_MAP = {
  'sayang': 'sayang/manja',
  'manja': 'sayang/manja',
  'sayang/manja': 'sayang/manja',
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
  'patah hati': 'kecewa',

  'cemburu': 'cemburu',
  'jealous': 'cemburu',
  'sirik': 'cemburu',
  'posesif': 'cemburu',
  'cemburuan': 'cemburu'
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
  
  const userText = messages?.[messages.length - 1]?.content || ''
  const shouldReason = needsReasoning(userText)
  const result = await callLLM(full)
  const raw = result.content
  const stripped = stripThink(raw)
  let { reply, emotion } = extractEmotion(stripped)
  
  const bondName = context.bondName || 'orang asing'
  reply = sanitizeTextForRelation(reply, bondName)
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
