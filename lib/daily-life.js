// Aktivitas harian ringan Yuki ("Daily Life") berbasis waktu WIB dan hari.
// Deterministik per slot waktu agar konsisten antara header UI dan konteks prompt.

function getWibParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now)
  const pick = (type) => parts.find((p) => p.type === type)?.value || ''
  return {
    weekday: pick('weekday'),
    year: Number(pick('year')) || 2026,
    month: Number(pick('month')) || 1,
    day: Number(pick('day')) || 1,
    hour: Number(pick('hour')) || 0,
    minute: Number(pick('minute')) || 0
  }
}

const SLOTS = {
  earlyMorning: [
    { id: 'coffee', label: 'baru bangun · bikin kopi', detail: 'Yuki baru bangun, masih agak mager sambil menyeduh kopi hangat.' },
    { id: 'stretch', label: 'masih setengah melek', detail: 'Yuki baru bangun tidur dan masih mengumpulkan nyawa pagi ini.' }
  ],
  morning: [
    { id: 'reading_morning', label: 'lagi baca komik pagi', detail: 'Yuki sedang santai membaca beberapa chapter komik terbaru di Ryukomik.' },
    { id: 'music_morning', label: 'dengerin playlist pagi', detail: 'Yuki sedang mendengarkan musik santai sambil mengecek ponselnya.' }
  ],
  midday: [
    { id: 'lunch_break', label: 'lagi cari makan siang', detail: 'Yuki sedang istirahat siang dan bingung mau makan apa.' },
    { id: 'scroll_komik', label: 'scrolling update Ryukomik', detail: 'Yuki sedang melihat-lihat daftar komik yang baru update siang ini.' }
  ],
  afternoon: [
    { id: 'chill_afternoon', label: 'lagi santai sore', detail: 'Yuki sedang bersantai sore di kamar sambil rebahan tipis.' },
    { id: 'anime_ep', label: 'habis nonton 1 episode anime', detail: 'Yuki baru saja selesai menonton satu episode anime dan masih kepikiran ceritanya.' }
  ],
  evening: [
    { id: 'night_read', label: 'lagi baca manhwa malam', detail: 'Yuki sedang asyik membaca manhwa sambil menemani waktu malam.' },
    { id: 'tea_evening', label: 'santai malam · teh hangat', detail: 'Yuki sedang minum teh hangat sambil menunggu obrolan santai malam ini.' }
  ],
  lateNight: [
    { id: 'sleepy_scroll', label: 'agak ngantuk tapi masih melek', detail: 'Sudah larut malam, Yuki agak mengantuk tapi belum mau tidur dulu.' },
    { id: 'late_music', label: 'dengerin lagu pelan', detail: 'Yuki sedang mendengarkan musik pelan di kamar yang sudah sepi.' }
  ]
}

function slotKeyForHour(hour) {
  if (hour >= 5 && hour < 9) return 'earlyMorning'
  if (hour >= 9 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 15) return 'midday'
  if (hour >= 15 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'lateNight'
}

export function getYukiDailyStatus({ now = new Date(), bondValue = 0 } = {}) {
  const { year, month, day, hour } = getWibParts(now)
  const slotKey = slotKeyForHour(hour)
  const pool = SLOTS[slotKey]
  const seed = year * 10000 + month * 100 + day + Math.floor(hour / 3)
  const picked = pool[Math.abs(seed) % pool.length]

  const starters = buildConversationStarters({ hour, bondValue, activity: picked })
  return {
    id: picked.id,
    slot: slotKey,
    label: picked.label,
    detail: picked.detail,
    starters
  }
}

export function buildConversationStarters({ hour = 12, bondValue = 0, activity = null } = {}) {
  const list = []
  if (hour >= 5 && hour < 11) {
    list.push({ id: 'greet_morning', label: 'Sapa Pagi', text: 'Pagi Yuki, udah bangun? Lagi ngapain?' })
  } else if (hour >= 22 || hour < 5) {
    list.push({ id: 'late_chat', label: 'Belum Tidur', text: 'Yuki, kamu masih melek jam segini?' })
  } else {
    list.push({ id: 'ask_activity', label: 'Lagi Ngapain?', text: 'Yuki lagi ngapain sekarang?' })
  }

  list.push({ id: 'story_day', label: 'Cerita Hariku', text: 'Yuki, aku mau cerita soal hariku hari ini nih.' })
  list.push({ id: 'tired', label: 'Lagi Capek', text: 'Hari ini capek banget rasanya, temenin ngobrol bentar dong.' })

  if (bondValue >= 50) {
    list.push({ id: 'miss_you', label: 'Kangen Ngobrol', text: 'Yuki, aku kangen ngobrol sama kamu nih.' })
  } else {
    list.push({ id: 'comic_pick', label: 'Rekomendasi Komik', text: 'Rekomendasikan komik seru yang lagi rame di Ryukomik dong.' })
  }

  if (activity?.id === 'anime_ep') {
    list[0] = { id: 'ask_anime', label: 'Nonton Apa?', text: 'Eh kamu habis nonton anime apa, Yuki? Seru nggak?' }
  }

  return list.slice(0, 4)
}

export function buildDailyLifePrompt(status) {
  if (!status?.detail) return ''
  return `Aktivitas ringanmu saat ini (WIB): ${status.detail} (status tampilan: "${status.label}"). Gunakan hanya secara alami kalau relevan atau ditanya "lagi ngapain?", jangan dipaksakan di setiap balasan.`
}
