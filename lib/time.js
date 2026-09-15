const ZONE_ALIASES = { WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura', UTC: 'UTC' }

export function normalizeTimezone(value = 'Asia/Jakarta') {
  const zone = ZONE_ALIASES[String(value).toUpperCase()] || String(value || 'Asia/Jakarta')
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date()); return zone } catch { return 'Asia/Jakarta' }
}

export function ensureUtcIso(value) {
  if (!value) return null
  const text = String(value).trim().replace(' ', 'T')
  const withZone = /(?:Z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text}Z`
  const date = new Date(withZone)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function formatInTimezone(value, timezone = 'Asia/Jakarta', locale = 'id-ID') {
  const iso = ensureUtcIso(value)
  if (!iso) return null
  const zone = normalizeTimezone(timezone)
  return {
    isoUtc: iso,
    timezone: zone,
    label: new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(iso))
  }
}

export function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timezone = 'Asia/Jakarta') {
  const zone = normalizeTimezone(timezone)
  let guess = Date.UTC(year, month - 1, day, hour, minute, second)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(guess)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second)
    guess += wanted - rendered
  }
  return new Date(guess).toISOString()
}

export function zonedParts(value = new Date(), timezone = 'Asia/Jakarta') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  return parts
}
