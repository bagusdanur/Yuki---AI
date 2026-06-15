import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { embed, cosineSim } from './semantic.js'

const FILE = process.env.MEMORY_FILE || './data/memory.json'
const MAX_FACTS = Number(process.env.MEMORY_MAX_FACTS || 60)
const MAX_EVENTS = Number(process.env.MEMORY_MAX_EVENTS || 30)
const TOPK = Number(process.env.RECALL_TOPK || 5)

const EMPTY = {
  facts: [],        // [{ text, vec }] fakta tentang user
  events: [],       // [{ ts, summary, mood, vec }] momen emosional
  emotion: null,    // { mood, bond, lastUpdate }
  updatedAt: null
}

// migrasi data lama: fakta/event berupa string -> bentuk objek + slot embedding
function normalize(raw = {}) {
  const m = { ...structuredClone(EMPTY), ...raw }
  m.facts = (m.facts || []).map((f) => (typeof f === 'string' ? { text: f, vec: null } : f))
  m.events = (m.events || []).map((e) => (typeof e === 'string' ? { summary: e, vec: null } : e))
  return m
}

export async function loadMemory() {
  try {
    if (!existsSync(FILE)) return structuredClone(EMPTY)
    return normalize(JSON.parse(await readFile(FILE, 'utf8')))
  } catch {
    return structuredClone(EMPTY)
  }
}

export async function saveMemory(mem) {
  mem.updatedAt = new Date().toISOString()
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(mem, null, 2), 'utf8')
  return mem
}

// Tambah fakta baru + embedding-nya (anti-duplikat)
export async function addFacts(facts = []) {
  const mem = await loadMemory()
  for (const f of facts) {
    const text = String(f).trim()
    if (!text || mem.facts.some((x) => x.text === text)) continue
    const vec = await embed(text)
    mem.facts.push({ text, vec })
  }
  mem.facts = mem.facts.slice(-MAX_FACTS)
  return saveMemory(mem)
}

// Catat momen emosional + embedding ("waktu kamu bilang X, aku merasa Y")
export async function addEvent(event) {
  if (!event?.summary) return
  const mem = await loadMemory()
  const vec = await embed(event.summary)
  mem.events.push({ ts: new Date().toISOString(), vec, ...event })
  mem.events = mem.events.slice(-MAX_EVENTS)
  return saveMemory(mem)
}

// Simpan kondisi emosi & kedekatan (biar Yuki ingat perasaannya lintas sesi)
export async function saveEmotion(emotionState) {
  const mem = await loadMemory()
  mem.emotion = emotionState
  return saveMemory(mem)
}

// === RECALL SEMANTIK ===
// Ambil K memori yang MAKNANYA paling mirip dengan pesan user (bukan exact match).
// Kalau embedding tak tersedia (model belum siap), fallback: ambil yang terbaru.
export async function recallMemory(query = '', mem = null) {
  const data = mem || (await loadMemory())
  const qvec = await embed(query)
  const sim = (item) => (qvec && item.vec ? cosineSim(qvec, item.vec) : -1)

  let facts, events
  if (qvec) {
    facts = data.facts.map((f) => ({ it: f, s: sim(f) }))
      .sort((a, b) => b.s - a.s).slice(0, TOPK).filter((x) => x.s > 0.25).map((x) => x.it)
    events = data.events.map((e) => ({ it: e, s: sim(e) }))
      .sort((a, b) => b.s - a.s).slice(0, 3).filter((x) => x.s > 0.25).map((x) => x.it)
  } else {
    facts = data.facts.slice(-TOPK)
    events = data.events.slice(-3)
  }
  return { facts, events }
}

// Ubah hasil recall jadi konteks untuk system prompt
export function buildMemoryContext(recall) {
  const parts = []
  if (recall?.facts?.length) {
    parts.push(`Yang kamu ingat tentang dia:\n- ${recall.facts.map((f) => f.text).join('\n- ')}`)
  }
  if (recall?.events?.length) {
    const recent = recall.events.map((e) => `- ${e.summary}`).join('\n')
    parts.push(`Momen yang membekas di hatimu:\n${recent}`)
  }
  return parts.join('\n\n')
}