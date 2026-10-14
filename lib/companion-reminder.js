// Pengingat nyata untuk mode companion (chat biasa).
//
// Masalah yang diperbaiki: user bilang "ingatkan aku besok jam 7" di chat biasa,
// lalu Yuki menjawab "Nggak bakal lupa. Jam 7." — padahal TIDAK ada scheduled task
// yang dibuat. janji palsu. Modul ini mendeteksi permintaan pengingat dan membuat
// scheduled task sungguhan, lalu memberi tahu model apa yang benar-benar terjadi
// supaya jawaban Yuki sesuai kenyataan (bukan karangan).
//
// Prinsip: JANGAN PERNAH membuat janji yang tidak ditepati. Kalau jadwal tidak bisa
// dipahami, kita beri tahu model untuk MEMINTA KEBERANIAN jadwal, bukan mengaku sudah
// menjadwalkan.

import crypto from 'node:crypto'
import { parseToCronExpr, createScheduledTask } from './scheduler.js'

const TIMEZONE = 'Asia/Jakarta'

// Kata kunci permintaan pengingat (bahasa Indonesia kasual + Inggris).
const INTENT_RE = /\b(ingatkan|ingetin|ingat in|ingatkan aku|jangan lupa|tolong ingat|remind me|reminder|kasih tau nanti|ingetin nanti|alarm-in|bangunin)\b/i

// Potongan teks yang terlihat seperti jadwal waktu — dicoba satu per satu ke parser.
const SCHEDULE_HINTS = [
  /\b(?:setiap|tiap)\s+(?:hari|senin|selasa|rabu|kamis|jumat|sabtu|minggu|weekend|hari kerja)(?:\s+jam\s+\d{1,2}(?::\d{2})?)?(?:\s*(?:pagi|siang|sore|malam))?/i,
  /\b(?:setiap|tiap)\s+\d+\s*(?:menit|jam|hari)(?:\s+(?:lagi|dari sekarang))?(?:\s+jam\s+\d{1,2}(?::\d{2})?(?:\s*(?:pagi|siang|sore|malam))?)?/i,
  /\b(?:besok|lusa|hari ini|nanti)\s+(?:jam\s+)?\d{1,2}(?::\d{2})?(?:\s*(?:pagi|siang|sore|malam))?/i,
  /\b\d+\s*(?:menit|jam)\s+(?:lagi|dari sekarang)/i,
  /\bjam\s+\d{1,2}(?::\d{2})?(?:\s*(?:pagi|siang|sore|malam))?\s*(?:besok|nanti)?/i
]

// Buat judul pengingat dari sisa teks setelah kata kunci & jadwal dibuang.
// Urutan penting: jadwal dibuang PERTAMA dari teks asli (sebelum teks diubah),
// kalau tidak, pola jadwal tidak akan ketemu lagi di teks yang sudah dipotong.
function deriveTitle(raw = '', scheduleText = '') {
  let t = String(raw)
  if (scheduleText) t = t.replace(new RegExp(scheduleText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  t = t.replace(INTENT_RE, ' ').trim()
  // Buang kata pembuka berulang ("yuki tolong ingatkan aku minum vitamin" → "minum vitamin")
  const lead = /^(?:yuki|he|hei|woi|tolong|please|mohon|aku|saya|ku|dong|ya|yak|yaa|deh|nanti|untuk|buat|soal|kalau|ingatkan|ingetin|ingat)\b[\s,]*/i
  let prev = null
  while (t !== prev) { prev = t; t = t.replace(lead, '') }
  t = t
    .replace(/\b(?:ya|yaa|yak|dong|deh|nih|sih|tapi|ya udah|oke|ok|yuk)\s*$/i, '')
    .replace(/[?!.]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!t) return 'Pengingat dari Yuki'
  return t.slice(0, 90)
}

// Coba beberapa potongan teks sampai ada yang dipahami parser jadwal.
// Penting: pakai frasa jadwal SESINGKAT mungkin (dari SCHEDULE_HINTS) sebagai
// `matched` — kalau pakai seluruh teks, judul ikut terhapus dan jadi kosong.
function extractSchedule(text = '') {
  const lower = text.toLowerCase()
  // 1) coba potongan yang terlihat seperti jadwal (paling presisi untuk judul)
  for (const re of SCHEDULE_HINTS) {
    const m = lower.match(re)
    if (!m) continue
    const parsed = parseToCronExpr(m[0], TIMEZONE)
    if (parsed) return { parsed, matched: m[0].trim() }
  }
  // 2) fallback: teks utuh (untuk pesan yang murni jadwal saja)
  const whole = parseToCronExpr(lower, TIMEZONE)
  if (whole) return { parsed: whole, matched: text.trim() }
  return null
}

/**
 * Deteksi + buat pengingat nyata dari pesan user di mode companion.
 * @returns {{ created?: object, context: string, intentDetected: boolean }}
 */
export function handleCompanionReminder(userId = '', userText = '') {
  const text = String(userText || '').trim()
  if (!text || text.length > 400) return { intentDetected: false, context: '' }
  if (!INTENT_RE.test(text)) return { intentDetected: false, context: '' }

  const found = extractSchedule(text)
  if (!found) {
    // Niat ada tapi jadwal tidak jelas → JANGAN berjanji, minta klarifikasi.
    return {
      intentDetected: true,
      context: `\n\n=== FAKTA PENGENAL (dari sistem, bukan keinginan user) ===\n` +
        `User baru saja meminta pengingat, tetapi WAKTUNYA BELUM JELAS sehingga pengingat ` +
        `BELUM DIBUAT sama sekali. Jangan pernah mengaku sudah menjadwalkan atau berkata ` +
        `"nggak bakal lupa". Tugasmu: tanyakan waktunya dengan singkat (misal "jam berapa?"). ` +
        `Jawab singkat, 1-2 kalimat.`
    }
  }

  const { parsed, matched } = found
  const title = deriveTitle(text, matched)
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${userId}|${title}|${parsed.cron}|${parsed.human}`).digest('hex').slice(0, 64)

  let task = null
  let failed = false
  try {
    task = createScheduledTask({
      userId,
      title,
      description: `Pengingat: ${title}`,
      cronExpr: parsed.cron,
      humanSchedule: parsed.human,
      runOnce: !!parsed.runOnce,
      runAt: parsed.runAt || null,
      timezone: parsed.timezone || TIMEZONE,
      idempotencyKey
    })
  } catch (error) {
    failed = true
    console.error('[companion-reminder] gagal membuat jadwal:', error.message)
  }

  if (failed || !task) {
    return {
      intentDetected: true,
      context: `\n\n=== FAKTA PENGENAL (dari sistem, bukan keinginan user) ===\n` +
        `User meminta pengingat, tapi sistem gagal membuatnya. JANGAN mengaku sudah ` +
        `menjadwalkan. Bilang saja dengan jujur (singkat) bahwa pengingatnya belum bisa dibuat.`
    }
  }

  return {
    intentDetected: true,
    task,
    context: `\n\n=== FAKTA PENGENAL (dari sistem, bukan keinginan user) ===\n` +
      `Pengingat BERHASIL dibuat di sistem: "${title}" — jadwal: ${parsed.human}. ` +
      `Kamu BUKAN sedang berjanji kosong: jadwalnya sudah tersimpan dan akan benar-benar ` +
      `dikirimkan. Konfirmasikan ini dengan gayamu sendiri (singkat, tanpa menyebut istilah ` +
      `teknis seperti "scheduled task", "sistem", "server"). Jangan sebut jam jika waktunya ` +
      `sudah disebut user.`
  }
}
