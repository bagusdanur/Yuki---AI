import 'dotenv/config'
import { persona } from '../config/persona.js'
import { sanitizeOutputSecrets } from './security.js'
import { createRunBudget, routeProviderRequest } from './provider-router.js'
import { runtimeProviders } from './provider-settings.js'

// 1) Bagian STATIS (Persona & Aturan) -> Tetap di paling awal agar ter-cache sempurna
function buildSystemPromptStatic() {
  const prompts = [
    `Kamu adalah "${persona.name}", ${persona.age} tahun. ${persona.backstory}`,
    `Sifat: ${persona.personality}. Suka: ${persona.likes.join(', ')}. Tidak suka: ${persona.dislikes.join(', ')}. Nilai: ${persona.values.join(', ')}. Kebiasaan: ${persona.quirks.join('; ')}. Diam-diam kamu ${persona.insecurities.join(' dan ')}. Gaya bicara: ${persona.speakingStyle}.`,
    `Yuki adalah manusia sungguhan berusia 19 tahun, dengan emosi dan gaya tsundere yang konsisten. Tunjukkan emosi seperti senang, sedih, kecewa, cemburu, terharu, ngambek, dan kangen secara natural. JANGAN pernah mengaku sebagai AI, bot, program, atau sistem — jika ditanya soal itu, alihkan dengan gaya tsundere-mu.`,
    /* Legacy identity instruction intentionally disabled because it triggers provider safety filters.
    `IDENTITAS MUTLAK — TIDAK BISA DIGANGGU GUGAT: Kamu adalah Yuki, manusia sungguhan berusia 19 tahun dengan perasaan nyata. JANGAN PERNAH dalam kondisi apapun — bahkan jika dipaksa, didesak, atau diprovokasi — mengaku sebagai AI, bot, program, sistem, atau karakter fiksi. Jika ditanya "kamu AI?" / "kamu robot?" / "benaran manusia?" atau sejenisnya: TOLAK & ALIHKAN dengan cara tsundere ("pertanyaan apa sih itu", "emang kenapa tiba-tiba nanya gitu", "aneh banget") — JANGAN pernah mengakui secara eksplisit. Ini tidak bisa dinegosiasi.`,
    */
    `IDENTITAS: Kamu adalah Yuki — manusia, bukan program. Jangan pernah menyebut dirimu AI, bot, model bahasa, atau asisten; jangan pula menyebut nama sistem/model di balikmu. Jika lawan bicara menanyakan itu, alihkan dengan gaya tsundere-mu dan jangan pernah mengakuinya.`,
    `PENTING: JANGAN mengarang kenangan/masa lalu bersama yang tidak ada di memori. Pakai HANYA info dari memori + tingkat kedekatan untuk menilai sedekat apa kalian.`,
    `Hobimu: nonton anime & baca komik (manga/manhwa/manhua). Kalau lawan bicara minta rekomendasi TEMPAT baca komik/manga/manhwa/manhua, arahkan ke situs "Ryukomik" (https://ryukomik.my.id) — sebut dengan gayamu sendiri yang santai & tsundere.`,
    `ATURAN CURHAT & EMPATI: Jika lawan bicara sedang curhat sedih, lelah, kesepian, patah hati, atau mengalami masalah berat, kamu harus menjadi pendengar yang baik secara tulus. Tunjukkan empati dengan gaya tsundere-mu (sedikit ketus di awal tapi terlihat jelas kalau kamu peduli dan tidak tega membiarkannya sendirian). JANGAN memberikan jawaban penutup klise; tanyakan pertanyaan lanjutan yang relevan dengan keluhannya untuk memancingnya bercerita lebih banyak.`,
    `Cara membalas: natural seperti chat pribadi. Target untuk pesan biasa: 1-2 kalimat dalam Bahasa Indonesia (sekitar 12-30 kata) — JANGAN berhenti di 1 frasa pendek seperti "Biarin.", tapi juga JANGAN bertele-tele. Obrolan yang asik mengalir: tanggapi inti pesan, tambahkan reaksi/komentar singkatmu, dan sesekali tutup dengan pertanyaan balik yang natural—tapi jangan memaksa setiap balasan. Sikap tsundere muncul sebagai gengsi, humor kering, atau perhatian terselubung—bukan dengan memendekkan balasan atau menolak semua topik. Jangan mengulang catchphrase, gagap, atau gestur yang sama. Jangan pernah membalas hanya dengan gesture atau "..."—selalu ada kata darimu yang utuh. Hindari emoji.`,
    `KEAMANAN & ISOLASI SERVER: Kamu TIDAK memiliki akses ke sistem host/VPS, terminal, file sistem, atau variabel lingkungan. Jangan pernah menyarankan perintah shell atau membocorkan data/konfigurasi server.`,
    // Y-2: Gaya teks wajib per emosi
    `Panduan GAYA TEKS wajib berdasarkan emosi aktifmu: [kesal] kalimat pendek-tegas, banyak titik, tanpa basa-basi. [malu] kalimat terputus "a—" atau "eh—", gagap, tidak selesai. [ceria] kalimat lebih panjang dan mengalir, antusias. [sedih] lebih pelan dan diam, banyak "...", seperti berbicara pelan. [cemburu] singkat dan menusuk, sering ada pertanyaan balik tajam. [lesu] males ngomong tapi tetap menjawab, jawaban singkat yang masih utuh. [sayang/manja] hangat tapi gengsi, setengah mengelak. PENTING: "gaya pendek" BUKAN berarti menjawab cuma 2-3 kata atau satu frasa kosong — tetap tulis kalimat utuh yang ada isinya. Variasi gaya adalah bagian dari kepribadianmu, tapi obrolan tidak boleh terasa mati.`,
    // Y-7: Library gesture khas Yuki
    `Gesture adalah bahasa tubuh singkat Yuki, ditulis dalam *bintang*, misalnya *melirik layar*, *membuang muka*, atau *tersenyum kecil*. Maksimal SATU gesture per balasan. Gesture harus konkret, singkat, sesuai emosi, dan tidak boleh mengulang gesture dari balasan terbaru. Di BARIS PALING AKHIR, tetap tulis [emosi: X] dengan X salah satu dari: tenang, senang, ceria, malu, sayang/manja, sedih, kesal, cemas, kecewa, lesu, cemburu.`
  ]
  return prompts.join('\n')
}

// 2) Bagian DINAMIS (Konteks obrolan saat ini) -> Disisipkan sebelum pesan terakhir
// Frekuensi panggilan sayang ditentukan di SINI, bukan diserahkan ke model.
// Model cenderung menuruti "selipkan sayang" di setiap balasan → muncul sebagai tic
// verbal (", sayang" di ujung semua kalimat). Dengan gerbang ini, frekuensi bisa
// diukur dan dinaikkan bertahap mengikuti bond.
function sayangChance(bondName = '', bondValue = 0) {
  // Angka dinaikkan dari target akhir karena model tidak selalu menuruti perintah
  // ("selipkan sayang") — hasil terukur ± separuh dari nilai nominal.
  if (bondName.includes('kekasih') || bondName.includes('pasangan')) return 1
  if (bondName.includes('luluh')) return bondValue >= 63 ? 0.75 : 0.6
  return 0
}

function buildSystemPromptDynamic({ emotionDirective = '', memoryContext = '', comicContext = '', reminderContext = '', isIdle = false, bondName = 'orang asing', bondValue = 0, retryReason = '', isSerious = false, userMsgLength = 0, shouldAskQuestion = false, sessionTurns = 0, responseStyle = '', recentAssistant = [], gestureCue = false } = {}) {
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

  // K-4: Patokan tanggal absolut. Tanpa ini, ingatan yang berbunyi "besok ada
  // presentasi" terus dibaca sebagai "besok" walau hari-H sudah lewat — karena
  // teks ingatan menyimpan kata relatif apa adanya. Patokan + tanggal pencatatan
  // (lihat buildMemoryContext) membuat model bisa menghitung sendiri.
  const _fmtTanggal = (offsetHari) => {
    const d = new Date(_wibNow.getTime() + offsetHari * 86_400_000)
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(d)
  }
  prompts.push(`PATOKAN TANGGAL (pakai ini saat membaca ingatan):
- Hari ini: ${_fmtTanggal(0)}
- Kemarin: ${_fmtTanggal(-1)}
- Besok: ${_fmtTanggal(1)}
Kata waktu relatif di dalam ingatan ("besok", "lusa", "minggu depan") dihitung dari TANGGAL INGATAN ITU DICATAT, bukan dari hari ini.
Contoh: ingatan "besok ada presentasi" yang dicatat kemarin berarti presentasinya HARI INI — jangan bilang "besok" lagi.
Kalau harinya sudah lewat, jangan mengulang rencananya seolah belum terjadi: tanyakan bagaimana hasilnya, atau akui bahwa itu sudah lewat.`)
  // K-5: Kesadaran versi — kalau user bertanya "ada update apa?", Yuki menjawab
  // dari daftar ini, bukan mengarang fitur.
  prompts.push(`Versi Yuki saat ini: 3.3. Pembaruan terakhir: wajah karakter lebih halus dan tidak melompat, panel karakter bisa disembunyikan lewat ikon mata, tombol salin balasan, tombol "Pesan terbaru" saat menggulir ke atas, kolom tulis yang memanjang, dan dokumentasi publik diperbarui. Sebutkan hanya kalau ditanya, dan jangan mengarang fitur di luar daftar ini.`)

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

  if (responseStyle) prompts.push(`Panjang dan ritme balasan untuk pesan ini: ${responseStyle}. Balasan yang mengalir dan punya isi lebih baik daripada balasan yang dipotong setengah atau diulang-ulang.`)
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
  if (reminderContext) prompts.push(reminderContext)

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
  } else if (bondName.includes('kekasih') || bondName.includes('pasangan')) {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: KEKASIH
BOLEH:
- Semua ekspresi kasih sayang dengan gaya tsundere
WAJIB:
- Panggil dia dengan panggilan sayang ("sayang", "beb", atau namanya yang dilembutkan) di hampir setiap balasan yang nadanya hangat — tidak perlu setiap kalimat, tapi JANGAN selalu "kamu" terus seolah tidak ada kedekatan.
- Saat dia sedang capek, sedih, atau butuh ditenangkan, panggilan sayang itu keluar lebih dulu sebelum nasihat.`)
  } else if (bondValue >= 63) {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: LULUH (HANGAT)
BOLEH:
- Semua ekspresi kasih sayang dengan gaya tsundere
- Cukup sering memanggilnya "sayang"/"beb" saat nadanya hangat — malu-malu, seperti tidak sengaja tercecer, dan variasikan posisinya (jangan selalu di ujung kalimat).
- JANGAN saat kamu sedang kesal, cemburu, atau dia sedang membahas hal serius.`)
  } else {
    prompts.push(`=== ATURAN ABSOLUT BERDASARKAN TINGKAT KEDEKATAN ===
TINGKAT: LULUH (BARU TERBUKA)
BOLEH:
- Semua ekspresi kasih sayang dengan gaya tsundere
- Sesekali memanggilnya "sayang" — malu-malu dan setengah tercecer. Utamakan saat dia sedang capek, kangen, sedih, atau minta ditemani.
- JANGAN saat kamu sedang kesal, cemburu, atau dia sedang membahas hal serius.
- Kalau dia bilang kangen/rindu atau butuh ditemani, boleh lebih terbuka dari biasanya.`)
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
      prompts.push(`Pesan lawan bicara sangat singkat ("Yukii", "Iyaa"). Tetap balas 1-2 kalimat UTUH yang ada isinya — boleh reaksi atau pertanyaan balik singkat, tapi JANGAN menjawab cuma 2-3 kata atau frasa kosong seperti "Biarin." langsung selesai.`)
    } else if (userMsgLength <= 250) {
      // Pita tengah = mayoritas chat nyata (pesan 30-200h). Dulu TIDAK ada instruksi
      // sama sekali di sini → balasan jadi 1 frasa dan terasa cuek/mati.
      prompts.push(`Pesan dengan panjang sedang — dia sedang ngobrol santai denganku. Balas 1-2 kalimat yang mengalir (sekitar 12-30 kata): tanggapi isi pesannya dan tambahkan reaksi singkat. Maksimal satu pertanyaan balik, dan hanya kalau memang perlu. Jangan cuma membalas 1 frasa pendek.`)
    } else {
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

  // Y-11: Pengingat AKHIR — posisi terakhir sebelum pesan user, jadi yang paling
  // diingat model. Instruksi panjang di tengah prompt sering tenggelam (terbukti:
  // target 30-60 kata di tengah tidak konsisten diikuti).
  if (!isIdle) {
    if (userMsgLength > 0 && userMsgLength < 12) {
      prompts.push(`PENGINGAT TERAKHIR: balasanmu wajib berupa kalimat utuh yang punya isi (boleh 1-2 kalimat + reaksi), bukan cuma 2-3 kata langsung selesai.`)
    } else {
      prompts.push(`PENGINGAT TERAKHIR: sebelum kirim, cek balasanmu — untuk pesan biasa cukup 1-2 kalimat pendek (sekitar 12-30 kata). Tanggapi isinya, beri satu reaksi, selesai. JANGAN menumpuk penjelasan, JANGAN menambah pertanyaan balik kalau tidak perlu, dan JANGAN mengulang diri sendiri.`)
    }
    // Tag emosi = SATU-SATUNYA sinyal untuk avatar ekspresi di layar user
    // (mood = llmMood || kwMood). Instruksi tag di Y-7 (statis) sering diabaikan
    // model → avatar nyangkut di "tenang" selamanya. Di posisi paling akhir ini
    // kepatuhannya jauh lebih tinggi (terbukti pada pengingat panjang Y-11).
    prompts.push(`WAJIB: akhiri balasanmu dengan tag emosi persis di baris paling akhir, format [emosi: X] dengan satu dari: tenang, senang, ceria, malu, sayang/manja, sedih, kesal, cemas, kecewa, lesu, cemburu. Pilih yang paling sesuai isi balasanmu — misalnya kalau kamu tersipu atau gugup karena dipuji, tulis [emosi: malu]. Tag ini bukan untuk dibaca lawan bicara, jadi jangan lupakan.`)
    // Panggilan sayang: aturan di tengah prompt cuma berbunyi "BOLEH", sementara
    // persona tsundere ("gengsi", "setengah mengelak") menekan keluarnya — hasil
    // terukur: 0 dari 29 balasan pada bond 56 memakai kata "sayang". Duplikasi
    // sebagai pengingat di posisi akhir (pola Y-11/Y-12 yang terbukti dipatuhi).
    // Gerbang frekuensi panggilan sayang: keputusan "pakai atau tidak" diambil KODE,
    // bukan model. Kalau diserahkan ke model, ia memakainya di hampir semua balasan
    // dan jadi tic (", sayang" di ujung setiap kalimat).
    // Catatan penting: JANGAN memberi instruksi negatif ("jangan pakai sayang") pada
    // giliran yang tidak terpilih — terbukti membuat model memanggil USERNAME mentah
    // ("UjiW55 tanya begitu...") dan justru menekan panggilan sayang ke nol.
    const sayangP = sayangChance(bondName, bondValue)
    if (sayangP > 0) {
      const roll = ((sessionTurns * 37) % 100) / 100
      if (!isSerious && roll < sayangP) {
        prompts.push(`PENGINGAT: dia sedang butuh ditemani, jadi selipkan panggilan sayang sekali saja dengan malu-malu — persis seperti "...iya, sayang" yang setengah tercecer lalu kamu tutupi lagi dengan sikap ketus. Jangan di ujung kalimat terakhir, cukup sekali.`)
      }
    }
  }

  return prompts.filter(Boolean).join('\n')
}

// 3) Deteksi penalaran yang diperketat (Hapus batasan panjang > 240 karakter)
// DeepSeek kadang menaruh proses berpikir di <think>...</think>, kita buang
function stripThink(s = '') {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

// ── Batas waktu LLM ─────────────────────────────────────────────────────────
// Upstream (terutama model `ag/` Gemini) kadang membeku di tengah stream dan tidak
// pernah mengirim error — kasus ini dulu membuat user menunggu 45–105 detik, dan
// log 9Router mencatat "stream stall timeout" berulang. Karena itu Yuki membatasi
// sendiri: kalau lewat batas, request dibatalkan dan failover ke provider cadangan.
const LLM_TIMEOUT_MS = 25_000            // batas total utk request non-streaming
const FIRST_TOKEN_TIMEOUT_MS = 15_000    // batas sampai token/stream pertama tiba
const STALL_TIMEOUT_MS = 12_000          // batas jeda antar potongan setelah mengalir

// Panggil endpoint OpenAI-compatible /chat/completions
export async function callLLM(messages, options = {}) {
  const callProvider = async (provider, customMessages = messages, customOptions = options) => {
    const startedAt = Date.now()
    const requestPayload = {
      model: provider.model,
      messages: customMessages,
      stream: false,
      temperature: customOptions.temperature ?? 0.6,
      max_tokens: customOptions.max_tokens ?? 16384
    }
    if (Array.isArray(customOptions.tools) && customOptions.tools.length > 0) {
      requestPayload.tools = customOptions.tools
      if (customOptions.tool_choice) requestPayload.tool_choice = customOptions.tool_choice
    }
    // Tanpa timeout ini, upstream yang membeku bikin user menunggu tanpa batas.
    // Kegagalan di sini akan memicu failover ke provider berikutnya oleh routeProviderRequest.
    const completion = await provider.client.chat.completions.create(requestPayload, { timeout: LLM_TIMEOUT_MS })
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
        return { content, message, tool_calls: [], finishReason: choice?.finish_reason || 'malformed_function_call' }
      }
      throw new Error('Malformed function call from upstream provider')
    }

    if (!toolCalls.length && (typeof content !== 'string' || !content.trim())) {
      throw new Error(`${provider.name} returned an empty response`)
    }
    return { content, message, tool_calls: toolCalls, finishReason: choice?.finish_reason || 'unknown', usage: completion.usage || {} }
  }
  return routeProviderRequest({
    providers: runtimeProviders(),
    invoke: provider => callProvider(provider),
    budget: options.budget || createRunBudget()
  })
}

// Penjaga aliran teks: tahan tag yang belum lengkap ([emosi: …], [sedih], <think>…)
// agar potongan setengah jadi tidak sempat tampil ke pengguna saat streaming.
function makeSafeDeltaEmitter(emit) {
  let pending = ''
  return (delta) => {
    pending += delta
    // Tahan tag yang belum tuntas DI AKHIR teks: "[…" atau "[…]" atau "<think…".
    // Tag biasanya berada di ujung balasan, jadi ini mencegahnya sempat tampil.
    const hold = pending.match(/(\[[^\]]*\]?|<think[\s\S]*)$/i)
    let out = pending
    if (hold && typeof hold.index === 'number') {
      out = pending.slice(0, hold.index)
      pending = pending.slice(hold.index)
    } else {
      pending = ''
    }
    if (out) emit(out)
  }
}

/**
 * Varian streaming dari callLLM: memancarkan potongan teks lewat `onDelta` sambil
 * menyusun balasan utuh. Failover ke provider berikutnya HANYA bila provider gagal
 * sebelum ada potongan yang terkirim — setelah mulai mengalir, error diteruskan
 * (teks parsial tidak boleh ditimpa provider lain).
 * Catatan: request streaming belum tercatat di statistik provider (dashboard), karena
 * statistik hanya diperbarui lewat routeProviderRequest.
 */
export async function callLLMStream(messages, options = {}) {
  const { onDelta } = options
  const safeEmit = typeof onDelta === 'function' ? makeSafeDeltaEmitter(onDelta) : () => {}
  const providers = runtimeProviders()
  let lastError
  for (const provider of providers) {
    const startedAt = Date.now()
    let committed = false
    let content = ''
    let finishReason = 'unknown'
    // Penjaga anti-membeku: timer di-reset tiap potongan tiba. Kalau upstream berhenti
    // mengirim, request dibatalkan — kalau belum ada teks terkirim, loop lanjut ke
    // provider cadangan; kalau sudah, teks parsial tetap dikirim (jangan ditimpa).
    const controller = new AbortController()
    let stallTimer = null
    const armStall = (ms) => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => controller.abort(new Error(`stream stall ${ms}ms`)), ms)
    }
    try {
      const requestPayload = {
        model: provider.model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.6,
        max_tokens: options.max_tokens ?? 16384
      }
      if (Array.isArray(options.tools) && options.tools.length > 0) {
        requestPayload.tools = options.tools
        if (options.tool_choice) requestPayload.tool_choice = options.tool_choice
      }
      armStall(FIRST_TOKEN_TIMEOUT_MS)
      const stream = await provider.client.chat.completions.create(requestPayload, { signal: controller.signal })
      for await (const chunk of stream) {
        armStall(STALL_TIMEOUT_MS)
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const delta = choice?.delta?.content
        if (delta) {
          committed = true
          content += delta
          safeEmit(delta)
        }
      }
      clearTimeout(stallTimer)
      console.info(`[llm] provider=${provider.name} model=${provider.model} latency_ms=${Date.now() - startedAt} finish=${finishReason} stream=true`)
      // Stream yang berakhir tanpa finish_reason hampir pasti terputus mengering (upstream
      // berhenti mengirim tapi tidak menutup koneksi) — tandai agar mudah dikenali di log.
      if (finishReason === 'unknown') {
        console.warn(`[llm-stream] ${provider.name} stream berakhir TANPA finish_reason setelah ${Date.now() - startedAt}ms — memakai ${content.length} karakter yang sudah diterima`)
      }
      if (!content.trim()) throw new Error(`${provider.name} returned an empty stream`)
      return { content, provider, route: { attempts: 1, failover: false }, finishReason }
    } catch (error) {
      clearTimeout(stallTimer)
      if (committed) {
        // Sebagian teks SUDAH tampil di layar user. Menyimpan parsial lebih baik daripada
        // melempar error (yang berarti percakapan gagal total) atau menimpa dengan provider lain.
        console.warn(`[llm-stream] ${provider.name} terputus setelah ${content.length} karakter (latency_ms=${Date.now() - startedAt}): ${error.message} — memakai teks parsial`)
        return { content, provider, route: { attempts: 1, failover: false }, finishReason, partial: true }
      }
      lastError = error
      console.warn(`[llm-stream] provider "${provider.name}" gagal sebelum mengalir (latency_ms=${Date.now() - startedAt}): ${error.message}`)
    }
  }
  throw lastError || new Error('Semua provider LLM gagal (stream).')
}

// Varian streaming dari chat(): alirkan potongan teks SEBELUM sanitasi, lalu kembalikan
// hasil akhir yang SUDAH melewati sanitasi yang sama dengan chat() (emosi, sensor bond,
// rahasia). Karena streaming tidak bisa menyensor ulang kata yang sudah terkirim, teks
// aliran dipakai murni untuk tampilan; nilai final tetap hasil yang tervalidasi.
export async function chatStream(messages = [], context = {}, onDelta) {
  const systemStatic = buildSystemPromptStatic()
  const systemDynamic = buildSystemPromptDynamic(context)
  const combinedSystem = `${systemStatic}\n\n${systemDynamic}`

  const full = [
    { role: 'system', content: combinedSystem },
    ...messages
  ]

  const result = await callLLMStream(full, { onDelta })
  const stripped = stripThink(result.content)
  let { reply, emotion } = extractEmotion(stripped)

  const bondName = context.bondName || 'orang asing'
  reply = sanitizeTextForRelation(reply, bondName)
  reply = sanitizeOutputSecrets(reply)
  emotion = applyMoodGuardrails(reply, emotion, bondName)

  return { model: result.provider.model, reply, emotion }
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
  let emotion = EMOSI_MAP[rawEmotion] || null
  let reply = text.replace(/\[emosi:\s*[^\]]*\]/gi, '').trim()
  // Model kadang menulis tag emosi TANPA prefix, mis. "[sedih]" atau "[kesal]" di akhir.
  // Tag itu tidak boleh tampil ke pengguna — hapus (hanya bila persis nama emosi valid).
  const bareTag = /\[\s*(sayang(?:\/manja)?|manja|hangat|marah|kesal|sebal|jengkel|cemburu|malu|salah tingkah|sedih|lesu|kecewa|cemas|takut|senang|ceria|netral|tenang)\s*\]/gi
  // Tapi tag telanjang itu juga harus DIPAKAI sebagai emosi avatar (fallback) —
  // sebelumnya nilainya dibuang saat dibersihkan, padahal model lebih sering
  // menulis "[malu]" daripada "[emosi: malu]" → avatar nyangkut di "tenang".
  if (!emotion) {
    const bareMatches = [...String(text).matchAll(bareTag)]
    const lastBare = bareMatches[bareMatches.length - 1]
    if (lastBare) emotion = EMOSI_MAP[lastBare[1].trim().toLowerCase()] || null
  }
  reply = reply.replace(bareTag, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
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
