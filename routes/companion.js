// Modular Companion API routes (v5.1):
// Status Daily Life, Pin Pesan, Buku Kenangan & Nickname, Proactive Push, Bookmarks, Feedback.

import {
  getPinnedMessages, pinMessage, unpinMessage,
  setUserNickname, getUserNickname, getRelationshipJournal,
  getProactivePushSettings, setProactivePushSettings,
  syncBondMilestones, getComicBookmarks, saveComicBookmark, deleteComicBookmark,
  saveResponseFeedback, dbHandle
} from '../lib/memory.js'
import { getYukiDailyStatus } from '../lib/daily-life.js'
import { getPushConfig } from '../lib/push.js'

export function registerCompanionRoutes(app, { requireSession, rateLimit, getEmotion }) {
  // Status & aktivitas harian Yuki ("Daily Life") + Quick Conversation Starters
  app.get('/api/companion/status', requireSession, rateLimit({ max: 60 }), async (req, res) => {
    try {
      const emotion = await getEmotion(req.authUserId)
      res.json(getYukiDailyStatus({ bondValue: emotion.bond }))
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // Sapaan "Welcome Back" otomatis jika user kembali setelah >= 24 jam tidak chat
  app.get('/api/companion/welcome-back', requireSession, rateLimit({ max: 30 }), async (req, res) => {
    try {
      const row = dbHandle.prepare('SELECT MAX(created_at) AS lastAt, COUNT(*) AS cnt FROM chat_history WHERE user_id = ?').get(String(req.authUserId))
      if (!row?.lastAt || Number(row.cnt || 0) < 2) return res.json({ shouldGreet: false })
      const lastIso = String(row.lastAt).includes('T') ? String(row.lastAt) : String(row.lastAt).replace(' ', 'T') + 'Z'
      const diffHours = (Date.now() - Date.parse(lastIso)) / 3600_000
      if (!Number.isFinite(diffHours) || diffHours < 24) return res.json({ shouldGreet: false })

      const daysAway = Math.max(1, Math.floor(diffHours / 24))
      const emotion = await getEmotion(req.authUserId)
      const bond = Number(emotion.bond) || 0
      const nick = bond >= 50 ? getUserNickname(req.authUserId) : ''
      const call = nick ? `, ${nick}` : ''

      let mood = 'tenang'
      let message = ''
      if (bond >= 78) {
        mood = daysAway >= 3 ? 'malu' : 'sayang/manja'
        message = daysAway >= 3
          ? `*langsung menoleh ke layar begitu namamu muncul* Akhirnya balik juga${call}... ${daysAway} hari nggak ada kabar, aku sempat kepikiran tahu. Bukan berarti aku nungguin terus sih, tapi lain kali kabari dong.`
          : `*tersenyum tipis lalu cepat-cepat memalingkan muka* Baru nongol lagi${call}? Yaudah sini cerita, kemarin sibuk apa aja?`
      } else if (bond >= 50) {
        mood = daysAway >= 3 ? 'kesal' : 'malu'
        message = daysAway >= 3
          ? `Baru kelihatan lagi setelah ${daysAway} hari${call}? Kirain udah lupa sama aku... yaudah, kamu baik-baik aja kan?`
          : `Oh, akhirnya balik juga${call}. Kemarin ke mana aja? Bukan kepo sih, cuma nanya aja.`
      } else if (bond >= 24) {
        mood = 'tenang'
        message = daysAway >= 3
          ? `Lama nggak kelihatan (${daysAway} hari). Sibuk banget ya sampai baru mampir lagi?`
          : `Eh, balik lagi. Ada cerita menarik apa sejak kemarin?`
      } else {
        mood = 'tenang'
        message = daysAway >= 3
          ? `Oh, kamu lagi. Kirain kemarin cuma mampir sekali terus hilang ${daysAway} hari.`
          : `Balik lagi? Yaudah, mau bahas apa hari ini?`
      }

      res.json({ shouldGreet: true, daysAway, mood, message })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // Pin pesan favorit
  app.get('/api/chat/pins', requireSession, rateLimit({ max: 60 }), (req, res) => {
    try {
      res.json({ pins: getPinnedMessages(req.authUserId) })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/chat/pins', requireSession, rateLimit({ max: 30 }), (req, res) => {
    try {
      const { messageId, role = 'assistant', content = '', note = '' } = req.body || {}
      if (!String(content || '').trim()) return res.status(400).json({ error: 'Isi pesan tidak boleh kosong.' })
      const pins = pinMessage(req.authUserId, { messageId, role, content, note })
      res.json({ ok: true, pins: pins || [] })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.delete('/api/chat/pins/:pinId', requireSession, rateLimit({ max: 30 }), (req, res) => {
    try {
      const pins = unpinMessage(req.authUserId, req.params.pinId)
      res.json({ ok: true, pins })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // Buku Kenangan (Relationship Journal) & Panggilan Khusus
  app.get('/api/relationship/:userId', requireSession, rateLimit({ max: 30 }), async (req, res) => {
    try {
      if (req.params.userId !== req.authUserId) return res.status(403).json({ error: 'Akses ditolak.' })
      const emotion = await getEmotion(req.authUserId)
      const journal = getRelationshipJournal(req.authUserId)
      res.json({
        bond: emotion.bondLevel().name,
        bondValue: emotion.bond,
        milestones: syncBondMilestones(req.authUserId, emotion.bond),
        nickname: journal.nickname,
        nicknameUnlocked: emotion.bond >= 50,
        stats: journal.stats,
        recentEvents: journal.recentEvents
      })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.put('/api/relationship/nickname', requireSession, rateLimit({ max: 20 }), async (req, res) => {
    try {
      const emotion = await getEmotion(req.authUserId)
      if (emotion.bond < 50) {
        return res.status(403).json({ error: 'Panggilan khusus baru terbuka saat kedekatan mencapai level Luluh (bond 50+).' })
      }
      const nickname = setUserNickname(req.authUserId, req.body?.nickname || '')
      res.json({ ok: true, nickname })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // Pengaturan Proactive Follow-Up Web Push
  app.get('/api/push/proactive', requireSession, rateLimit({ max: 30 }), (req, res) => {
    try {
      res.json({ ...getProactivePushSettings(req.authUserId), pushConfigured: getPushConfig().enabled })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.put('/api/push/proactive', requireSession, rateLimit({ max: 20 }), (req, res) => {
    try {
      const { enabled, quietStart, quietEnd } = req.body || {}
      const settings = setProactivePushSettings(req.authUserId, { enabled, quietStart, quietEnd })
      res.json({ ok: true, ...settings })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // Bookmarks komik Ryukomik
  app.get('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
    try {
      res.json({ bookmarks: getComicBookmarks(req.authUserId) })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.post('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
    try {
      const comic = req.body?.comic || req.body
      if (!comic?.title || !comic?.url) return res.status(400).json({ error: 'Data komik tidak valid.' })
      const bookmarks = saveComicBookmark(req.authUserId, comic)
      res.json({ ok: true, bookmarks })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  app.delete('/api/comics/bookmarks', requireSession, rateLimit({ max: 40 }), (req, res) => {
    try {
      const url = req.query?.url || req.body?.url
      if (!url) return res.status(400).json({ error: 'URL komik tidak valid.' })
      const bookmarks = deleteComicBookmark(req.authUserId, url)
      res.json({ ok: true, bookmarks })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })

  // Feedback balasan
  app.post('/api/feedback', requireSession, rateLimit({ max: 40 }), (req, res) => {
    try {
      const { messageId, rating, reason = '' } = req.body || {}
      if (![-1, 1].includes(Number(rating))) return res.status(400).json({ error: 'Feedback tidak valid.' })
      saveResponseFeedback(req.authUserId, messageId, Number(rating), reason)
      res.json({ ok: true })
    } catch (e) { console.error('[api 500]', e?.message || e); res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' }) }
  })
}
