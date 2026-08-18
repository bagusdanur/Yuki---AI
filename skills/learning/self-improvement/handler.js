// skills/learning/self-improvement/handler.js
import fs from 'node:fs'
import path from 'node:path'

const LEARNING_FILE = path.resolve('data/self_improvements.json')

export async function executeRecordSelfImprovement(params = {}) {
  const { topic, learning_summary, summary, skill_affected, patch_note } = params
  const cleanTopic = String(topic || 'General Improvement').trim()
  const cleanSummary = String(learning_summary || summary || patch_note || '').trim()
  const cleanSkill = String(skill_affected || 'core').trim()

  if (!cleanSummary) {
    return { error: 'Parameter "learning_summary" tidak boleh kosong.' }
  }

  const record = {
    id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    topic: cleanTopic,
    skill: cleanSkill,
    summary: cleanSummary
  }

  try {
    const dir = path.dirname(LEARNING_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    let list = []
    if (fs.existsSync(LEARNING_FILE)) {
      try {
        list = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'))
      } catch {
        list = []
      }
    }
    list.unshift(record)
    // Simpan maksimal 50 catatan pembelajaran terbaru
    if (list.length > 50) list = list.slice(0, 50)
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(list, null, 2), 'utf8')
  } catch (err) {
    console.warn('[self-improvement] Gagal menyimpan log pembelajaran:', err.message)
  }

  const reviewMessage = `💾 Self-improvement review: Memory updated — Patched knowledge on '${cleanSkill}' (${cleanTopic}: ${cleanSummary.slice(0, 80)}${cleanSummary.length > 80 ? '...' : ''})`

  return {
    success: true,
    review: reviewMessage,
    data: record
  }
}

export default {
  record_self_improvement: executeRecordSelfImprovement
}
