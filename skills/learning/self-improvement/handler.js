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

  const reviewMessage = `💾 Self-improvement: Wawasan baru tersimpan di memori — [${cleanSkill}] ${cleanTopic}: ${cleanSummary.slice(0, 100)}`

  return {
    success: true,
    message: reviewMessage,
    data: record
  }
}

export async function executeListSelfImprovements() {
  try {
    if (!fs.existsSync(LEARNING_FILE)) {
      return { total: 0, lessons: [], message: 'Belum ada catatan self-improvement yang tersimpan.' }
    }
    const list = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'))
    return {
      total: list.length,
      lessons: list.slice(0, 15)
    }
  } catch (err) {
    return { error: `Gagal membaca memori pembelajaran: ${err.message}` }
  }
}

export function getRecentSelfImprovements(limit = 6) {
  try {
    if (!fs.existsSync(LEARNING_FILE)) return []
    const list = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'))
    return Array.isArray(list) ? list.slice(0, limit) : []
  } catch {
    return []
  }
}

export default {
  record_self_improvement: executeRecordSelfImprovement,
  list_self_improvements: executeListSelfImprovements
}
