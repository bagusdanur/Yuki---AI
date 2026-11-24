// Modular Companion API routes (v5.1):
// Status Daily Life, Pin Pesan, Buku Kenangan & Nickname, Proactive Push, Bookmarks, Feedback.

import {
  getPinnedMessages, pinMessage, unpinMessage,
  setUserNickname, getRelationshipJournal,
  getProactivePushSettings, setProactivePushSettings,
  syncBondMilestones, getComicBookmarks, saveComicBookmark, deleteComicBookmark,
  saveResponseFeedback
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
