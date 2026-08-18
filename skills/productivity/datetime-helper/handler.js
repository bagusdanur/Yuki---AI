// skills/productivity/datetime-helper/handler.js

export async function executeGetCurrentTime({ timezone = 'WIB' } = {}) {
  const tzMap = {
    'wib': 'Asia/Jakarta',
    'wita': 'Asia/Makassar',
    'wit': 'Asia/Jayapura',
    'utc': 'UTC',
    'gmt': 'UTC',
    'tokyo': 'Asia/Tokyo',
    'jst': 'Asia/Tokyo'
  }

  const selectedTz = tzMap[String(timezone).toLowerCase()] || 'Asia/Jakarta'
  const now = new Date()

  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: selectedTz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now)

  return {
    timezone: timezone.toUpperCase(),
    ianaTimezone: selectedTz,
    datetime: formatted,
    iso: now.toISOString()
  }
}

export async function executeCalculateDateDifference({ target_date }) {
  if (!target_date) return { error: 'target_date harus diisi (format YYYY-MM-DD).' }
  
  const target = new Date(target_date)
  if (isNaN(target.getTime())) return { error: `Format tanggal "${target_date}" tidak valid. Gunakan format YYYY-MM-DD.` }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)

  const diffMs = target.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  return {
    today: today.toISOString().split('T')[0],
    targetDate: target_date,
    differenceDays: diffDays,
    status: diffDays === 0 ? 'hari ini' : diffDays > 0 ? `${diffDays} hari lagi` : `${Math.abs(diffDays)} hari yang lalu`
  }
}

export default {
  get_current_time: executeGetCurrentTime,
  calculate_date_difference: executeCalculateDateDifference
}
