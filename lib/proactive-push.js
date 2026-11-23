// Proactive Follow-Up Cerdas via Web Push (Yuki v5.0).
// Menanyakan kabar rencana / open_loop user yang sudah lewat >= 6 jam,
// menghormati opt-in user, quiet hours WIB, dan cooldown 12 jam.

import { listProactiveFollowUpCandidates, recordProactivePush, saveChatMessage } from './memory.js'
import { evaluateMemoryTemporality } from './memory-temporal.js'
import { sendPushToUser } from './push.js'

function currentWibHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hour12: false
  }).formatToParts(now)
  return Number(parts.find((p) => p.type === 'hour')?.value || 0)
}

export function isQuietHour(hour, quietStart = 22, quietEnd = 7) {
  if (quietStart === quietEnd) return false
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd
  // Melintasi tengah malam (mis. 22 -> 07)
  return hour >= quietStart || hour < quietEnd
}

export function buildFollowUpMessage(candidate = {}) {
  const rawTopic = String(candidate.content || '').trim().replace(/\s+/g, ' ').slice(0, 90)
  const call = candidate.nickname || candidate.username || ''
  const prefix = call ? `${call}, ` : ''
  return `*melirik layar sebentar*\n${prefix}tadi kamu sempat bilang soal "${rawTopic}". Gimana kelanjutannya? Bukan karena aku kepo banget sih... cuma nanya aja.`
}

export async function runProactiveFollowUpTick({ now = new Date() } = {}) {
  const hour = currentWibHour(now)
  const candidates = listProactiveFollowUpCandidates()
  const seenUsers = new Set()
  let sentCount = 0

  for (const item of candidates) {
    if (seenUsers.has(item.userId)) continue
    // Jangan kirim notifikasi follow-up jika acara sudah lewat lebih dari 1 hari
    const temp = evaluateMemoryTemporality(item.content, item.updatedAt, now)
    if (temp.timeBound && temp.daysPast > 1) continue
    const quietStart = Number.isInteger(item.quietStart) ? item.quietStart : 22
    const quietEnd = Number.isInteger(item.quietEnd) ? item.quietEnd : 7
    if (isQuietHour(hour, quietStart, quietEnd)) continue

    seenUsers.add(item.userId)
    const message = buildFollowUpMessage(item)
    const memoryKey = `sm:${item.memoryId}`
    try {
      const pushRes = await sendPushToUser(item.userId, {
        title: 'Yuki menanyakan kabarmu',
        body: message.replace(/\*[^*]+\*\s*/g, '').slice(0, 140),
        url: '/',
        tag: `yuki-followup-${item.memoryId}`
      })
      if (pushRes.sent > 0) {
        saveChatMessage(item.userId, 'assistant', message)
        recordProactivePush(item.userId, memoryKey, message)
        sentCount += 1
        console.info(`[proactive-push] Follow-up terkirim ke ${item.userId} (${memoryKey})`)
      }
    } catch (error) {
      console.error('[proactive-push] gagal mengirim follow-up:', error.message)
    }
  }
  return { checked: candidates.length, sent: sentCount }
}

let proactiveTimer = null
export function startProactivePushLoop(intervalMs = 30 * 60_000) {
  if (proactiveTimer) return proactiveTimer
  proactiveTimer = setInterval(() => {
    runProactiveFollowUpTick().catch((err) => console.error('[proactive-push] tick error:', err.message))
  }, Math.max(60_000, intervalMs))
  if (typeof proactiveTimer.unref === 'function') proactiveTimer.unref()
  return proactiveTimer
}
