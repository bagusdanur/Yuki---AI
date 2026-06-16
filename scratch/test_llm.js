import 'dotenv/config';
import { persona } from '../config/persona.js';

const DEEPSEEK = {
  key: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  base: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
};

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
  ];
  return prompts.join('\n');
}

function buildSystemPromptDynamic({ emotionDirective = '', memoryContext = '', comicContext = '', isIdle = false, bondName = 'orang asing' } = {}) {
  const prompts = [];
  if (emotionDirective) prompts.push(emotionDirective);
  if (memoryContext) prompts.push(memoryContext);
  if (comicContext) prompts.push(comicContext);
  return prompts.filter(Boolean).join('\n');
}

async function callLLM(provider, messages) {
  const url = `${provider.base.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: provider.model,
    messages,
    stream: false,
    temperature: 0.8
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function runTest() {
  const systemStatic = buildSystemPromptStatic();
  const systemDynamic = buildSystemPromptDynamic({
    bondName: 'orang asing',
    emotionDirective: '[Directives: Kamu bersikap agak dingin dan tsundere]',
    memoryContext: 'Fakta: User baru pertama kali menyapamu.'
  });

  const messages = [
    { role: 'user', content: 'Halo Yuki, siapa namamu?' }
  ];

  const full = [
    { role: 'system', content: systemStatic },
    ...messages
  ];

  if (systemDynamic && full.length > 1) {
    full.splice(full.length - 1, 0, { role: 'system', content: systemDynamic });
  }

  console.log('Sending payload messages:', JSON.stringify(full, null, 2));
  console.log('\nWaiting for API response...');
  const rawResponse = await callLLM(DEEPSEEK, full);
  console.log('Raw API Response:\n------------------');
  console.log(rawResponse);
  console.log('------------------');
}

runTest();
