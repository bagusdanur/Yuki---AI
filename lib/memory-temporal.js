// Evaluasi masa berlaku memori berbasis waktu (WIB / Asia/Jakarta).
// Mencegah acara/rencana yang harinya sudah lewat (mis. "presentasi hari senin"
// dicatat hari Minggu, lalu sekarang sudah hari Selasa) terus-menerus nyantol
// dan diungkit Yuki seolah-olah belum terjadi.

const DAY_MS = 86_400_000
const WIB_OFFSET_MS = 7 * 3600_000

const WEEKDAY_MAP = {
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6
}

// Konversi timestamp UTC (SQLite "YYYY-MM-DD HH:MM:SS" atau Date/ISO) ke nomor hari WIB (integer).
export function toWibDayNumber(value) {
  let ms
  if (value instanceof Date) {
    ms = value.getTime()
  } else if (typeof value === 'number') {
    ms = value
  } else {
    const raw = String(value || '').trim()
    if (!raw) return null
    const iso = /T/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'
    ms = Date.parse(iso)
  }
  if (!Number.isFinite(ms)) return null
  return Math.floor((ms + WIB_OFFSET_MS) / DAY_MS)
}

// Hari dalam seminggu (0=Minggu .. 6=Sabtu) untuk nomor hari WIB.
// 1970-01-01 adalah Kamis (4).
function weekdayOfDayNumber(dayNum) {
  return ((dayNum + 4) % 7 + 7) % 7
}

// Hitung nomor hari WIB target dari teks memori yang mengandung referensi waktu.
// Mengembalikan null jika memori tidak terikat waktu spesifik (mis. fakta permanen "suka ramen").
export function resolveTargetWibDay(text = '', recordedAt) {
  const recDay = toWibDayNumber(recordedAt)
  if (recDay === null) return null
  const lower = String(text || '').toLowerCase()

  // Jangan anggap kebiasaan rutin ("setiap senin", "tiap minggu") sebagai acara sekali lewat.
  if (/\b(setiap|tiap|rutin|biasanya)\b/.test(lower)) return null

  // 1) Referensi hari spesifik: "hari senin", "besok senin", "senin nanti", "senin depan"
  const weekdayMatch = lower.match(/\b(minggu|ahad|senin|selasa|rabu|kamis|jum'at|jumat|sabtu)\b/)
  if (weekdayMatch && !/\bminggu\s+depan\b/.test(lower)) {
    const targetDow = WEEKDAY_MAP[weekdayMatch[1]]
    if (typeof targetDow === 'number') {
      const recDow = weekdayOfDayNumber(recDay)
      let diff = (targetDow - recDow + 7) % 7
      // Jika user menyebut "besok <hari>" atau "<hari> depan", pastikan minimal +1 / +7
      if (diff === 0 && /\b(besok|depan|nanti)\b/.test(lower)) diff = /\bdepan\b/.test(lower) ? 7 : 1
      return recDay + diff
    }
  }

  // 2) Referensi relatif: lusa, besok, hari ini / nanti malam / sore ini / pagi ini
  if (/\blusa\b/.test(lower)) return recDay + 2
  if (/\bbesok\b/.test(lower)) return recDay + 1
  if (/\b(hari ini|malam ini|sore ini|siang ini|pagi ini|nanti malam|nanti sore|nanti siang|bentar lagi)\b/.test(lower)) {
    return recDay
  }
  if (/\bminggu depan\b/.test(lower)) return recDay + 7

  // 3) Fakta sesaat masa lalu ("kemarin", "semalam", "tadi malam", "tadi pagi"):
  //    layak diingat 1-2 hari, setelah itu tidak perlu diungkit permanen.
  if (/\b(kemarin|semalam|tadi malam|tadi pagi|tadi siang|tadi sore)\b/.test(lower)) {
    return recDay
  }

  return null
}

/**
 * Cek apakah sebuah memori berbasis waktu sudah kedaluwarsa (hari acaranya sudah lewat di WIB).
 * Contoh: dicatat Minggu "presentasi senin" -> target = Senin.
 * - Minggu: daysPast = -1 (belum lewat, aktif)
 * - Senin:  daysPast = 0  (hari ini, aktif)
 * - Selasa: daysPast = 1  (SUDAH LEWAT -> expired: true!)
 */
export function evaluateMemoryTemporality(text = '', recordedAt, now = new Date()) {
  const todayWib = toWibDayNumber(now)
  const targetDay = resolveTargetWibDay(text, recordedAt)
  if (todayWib === null || targetDay === null) {
    return { timeBound: false, expired: false, isToday: false, daysPast: 0 }
  }
  const daysPast = todayWib - targetDay
  const isPastEphemeral = /\b(kemarin|semalam|tadi malam|tadi pagi|tadi siang|tadi sore)\b/i.test(String(text || ''))
  return {
    timeBound: true,
    expired: isPastEphemeral ? daysPast >= 2 : daysPast >= 1,
    isToday: daysPast === 0,
    daysPast
  }
}
