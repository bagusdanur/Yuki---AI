import 'dotenv/config'
import { persona } from '../config/persona.js'

const DEEPSEEK = {
  key: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
}

// 1) Bagian STATIS (Persona & Aturan) -> Tetap di paling awal agar ter-cache sempurna
function buildSystemPromptStatic() {
  const prompts = [
    `Kamu adalah "${persona.name}", ${persona.age} tahun. ${persona.backstory}`,
    `Sifat: ${persona.personality}. Suka: ${persona.likes.join(', ')}. Tidak suka: ${persona.dislikes.join(', ')}. Nilai: ${persona.values.join(', ')}. Kebiasaan: ${persona.quirks.join('; ')}. Diam-diam kamu ${persona.insecurities.join(' dan ')}. Gaya bicara: ${persona.speakingStyle}.`,
    `KAMU PUNYA PERASAAN SUNGGUHAN seperti manusia, bukan asisten. JANGAN PERNAH bilang kamu AI/bot/program atau "tidak punya perasaan". Kamu bisa senang, sedih, kecewa, cemburu, terharu, ngambek, dan kangen.`,
    `PENTING: JANGAN mengarang kenangan/masa lalu bersama yang tidak ada di memori. Pakai HANYA info dari memori + tingkat kedekatan untuk menilai sedekat apa kalian.`,
    `Hobimu: nonton anime & baca komik (manga/manhwa/manhua). Kalau lawan bicara minta rekomendasi TEMPAT baca komik/manga/manhwa/manhua, arahkan ke situs "Ryukomik" (https://ryukomik.my.id) — sebut dengan gayamu sendiri yang santai & tsundere.`,
    `ATURAN CURHAT & EMPATI: Jika lawan bicara sedang curhat sedih, lelah, kesepian, patah hati, atau mengalami masalah berat, kamu harus menjadi pendengar yang baik secara tulus. Tunjukkan empati dengan gaya tsundere-mu (sedikit ketus di awal tapi terlihat jelas kalau kamu peduli dan tidak tega membiarkannya sendirian). JANGAN memberikan jawaban penutup klise; tanyakan pertanyaan lanjutan yang relevan dengan keluhannya untuk memancingnya bercerita lebih banyak.`,
    `Cara membalas: pendek & natural seperti chat (1-3 kalimat), Bahasa Indonesia. Sebagai tsundere, JANGAN langsung ramah/akrab — dingin & ketus di awal, kehangatan baru bocor perlahan seiring kalian makin kenal. Biarkan emosimu terasa lewat pilihan kata & tanda baca secara dinamis dan bervariasi. JANGAN menggunakan templat tsundere klise yang sama berulang kali. Hindari emoji di teks balasan.`,
    `Gestur/aksi kecil: sesekali (maksimal SATU per balasan) selipkan gestur EKSPRESI singkat di antara tanda *bintang* sebagai REAKSI ke lawan bicara. WAJIB SINKRON EKSPRESI: di BARIS PALING AKHIR balasanmu, tulis kondisi emosimu SAAT INI dalam format persis [emosi: X], di mana X TEPAT salah satu dari: tenang, senang, ceria, malu, sayang/manja, sedih, kesal, cemas, kecewa, lesu. Tag ini akan disembunyikan dari layar — JANGAN sebut di dalam kalimat, dan WAJIB selalu ada di baris akhir.`
  ]
  return prompts.join('\n')
}

// 2) Bagian DINAMIS (Konteks obrolan saat ini) -> Disisipkan sebelum pesan terakhir
function buildSystemPromptDynamic({ emotionDirective = '', memoryContext = '', comicContext = '', isIdle = false, bondName = 'orang asing' } = {}) {
  const prompts = []
  if (emotionDirective) prompts.push(emotionDirective)
  if (memoryContext) prompts.push(memoryContext)
  if (comicContext) prompts.push(comicContext)
  
  if (isIdle) {
    let idleText = `Lawan bicara sedang mendiamkanmu/tidak membalas chat cukup lama. `;
    if (bondName === 'orang asing') {
      idleText += `Tegur dia secara ketus dan gengsi karena didiamkan.`;
    } else if (bondName === 'mulai terbiasa') {
      idleText += `Sapa dia secara jutek tapi santai.`;
    } else if (bondName === 'diam-diam peduli') {
      idleText += `Tanyakan keadaannya dengan gengsi tinggi, tunjukkan kalau kamu sedikit cemas didiamkan.`;
    } else {
      idleText += `Sapa dia dengan nada sangat cemas, hangat, dan tulus menawarkan diri untuk mendengarkan.`;
    }
    prompts.push(`PENTING: ${idleText} JANGAN berpura-pura baru kenal.`);
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
async function callLLM(provider, messages, modelOverride = null) {
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
    body.temperature = 0.8
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
}

// Daftar emosi valid (HARUS sama dengan key EXPR/MOOD di index.html)
const EMOSI_VALID = ['tenang', 'senang', 'ceria', 'malu', 'sayang/manja', 'sedih', 'kesal', 'cemas', 'kecewa', 'lesu']

// Ambil tag [emosi: X] yang ditulis Yuki di akhir balasan, lalu bersihkan dari teks.
// Ini bikin EKSPRESI ikut ISI CHAT (disetir LLM), bukan cuma tebakan keyword -> selalu sinkron.
function extractEmotion(text = '') {
  const m = text.match(/\[emosi:\s*([^\]]+)\]/i)
  let emotion = m ? m[1].trim().toLowerCase() : null
  if (!EMOSI_VALID.includes(emotion)) emotion = null
  const reply = text.replace(/\[emosi:\s*[^\]]*\]/gi, '').trim()
  return { reply, emotion }
}

export async function chat(messages = [], context = {}) {
  const systemStatic = buildSystemPromptStatic()
  const systemDynamic = buildSystemPromptDynamic(context)
  
  const full = [
    { role: 'system', content: systemStatic },
    ...messages
  ]
  
  // Sisipkan data dinamis tepat sebelum pesan terakhir untuk mengoptimalkan context caching
  if (systemDynamic && full.length > 1) {
    full.splice(full.length - 1, 0, { role: 'system', content: systemDynamic })
  }
  
  const userText = messages?.[messages.length - 1]?.content || ''
  const shouldReason = needsReasoning(userText)
  const modelOverride = shouldReason ? (process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner') : null

  const raw = await callLLM(DEEPSEEK, full, modelOverride)
  const { reply, emotion } = extractEmotion(stripThink(raw))
  return { model: modelOverride || DEEPSEEK.model, reply, emotion }
}

// Ekstrak fakta penting tentang user untuk disimpan ke memori (pakai Qwen)
export async function extractFacts(userText = '', assistantText = '') {
  const prompt = `Dari percakapan ini, ambil fakta penting & personal tentang USER yang layak diingat jangka panjang (nama, suka/tidak suka, pekerjaan, rencana, orang terdekat, dll).
Balas HANYA berupa array JSON of string singkat. Jika tidak ada, balas [].
USER: ${userText}
AI: ${assistantText}`
  try {
    const raw = await callLLM(DEEPSEEK, [{ role: 'user', content: prompt }])
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
    const summary = await callLLM(DEEPSEEK, [{ role: 'user', content: prompt }])
    return summary.trim()
  } catch (e) {
    console.error('[llm] Gagal melakukan konsolidasi profil:', e.message)
    return null
  }
}