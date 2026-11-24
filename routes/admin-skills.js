// Admin Skills & Plugin Manager API routes (Claude SKILL.md compatible)
import {
  listSkillsDetailed,
  setSkillEnabled,
  installCustomSkill,
  importSkillFromUrl,
  deleteCustomSkill,
  testSkillByName
} from '../lib/agent/skills-engine.js'

export function registerAdminSkillRoutes(app, { requireAdmin, rateLimit }) {
  app.get('/api/admin/skills', rateLimit({ max: 60 }), requireAdmin, async (_req, res) => {
    try {
      const skills = await listSkillsDetailed()
      const total = skills.length
      const enabled = skills.filter(s => s.enabled).length
      const custom = skills.filter(s => s.isCustom).length
      const tools = skills.reduce((sum, s) => sum + (s.tools?.length || 0), 0)
      res.json({ skills, summary: { total, enabled, custom, tools } })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.post('/api/admin/skills/:name/toggle', rateLimit({ max: 60 }), requireAdmin, async (req, res) => {
    try {
      const result = await setSkillEnabled(req.params.name, Boolean(req.body?.enabled))
      res.json({ ok: true, ...result })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })

  app.post('/api/admin/skills/install', rateLimit({ max: 30 }), requireAdmin, async (req, res) => {
    try {
      const skill = await installCustomSkill({
        slug: req.body?.slug,
        markdown: req.body?.markdown,
        sourceUrl: req.body?.sourceUrl || ''
      })
      res.status(201).json({ ok: true, skill })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })

  app.post('/api/admin/skills/import-url', rateLimit({ max: 20 }), requireAdmin, async (req, res) => {
    try {
      const skill = await importSkillFromUrl({
        url: req.body?.url,
        slug: req.body?.slug
      })
      res.status(201).json({ ok: true, skill })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })

  app.delete('/api/admin/skills/:name', rateLimit({ max: 30 }), requireAdmin, async (req, res) => {
    try {
      const result = await deleteCustomSkill(req.params.name)
      res.json({ ok: true, ...result })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })

  app.post('/api/admin/skills/:name/test', rateLimit({ max: 30 }), requireAdmin, async (req, res) => {
    try {
      const result = await testSkillByName(req.params.name, { userId: 'admin_skill_test' })
      res.json(result)
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message })
    }
  })
}
