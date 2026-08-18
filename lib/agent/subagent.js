// lib/agent/subagent.js — Yuki Subagent/Delegation Engine
// Spawn child agent workers dengan konteks terisolasi untuk task paralel

import { callLLM } from '../llm.js'
import { buildAgentSystemPrompt } from './persona.js'
import { getAvailableTools, executeTool } from './skills-engine.js'

const MAX_SUBAGENTS = 4
const MAX_TURNS_PER_SUBAGENT = 3
const SUBAGENT_TIMEOUT_MS = 45_000

// Jalankan satu subagent terisolasi untuk satu task spesifik
async function runSubagent({ task, context = '', userId, index = 0 }) {
  const tools = await getAvailableTools()
  const systemPrompt = buildAgentSystemPrompt({ bondName: 'mulai terbiasa', userId })

  // Subagent punya system prompt yang lebih fokus
  const subagentSystem = `${systemPrompt}

[SUBAGENT MODE]
Kamu adalah worker terfokus. Tugas spesifikmu:
"${task}"

Konteks tambahan: ${context || 'tidak ada'}

Selesaikan tugas ini secara mendalam dan terstruktur. Kembalikan hasil dalam format yang jelas dan mudah dirangkum.`

  const messages = [
    { role: 'system', content: subagentSystem },
    { role: 'user', content: `Kerjakan tugas ini: ${task}` }
  ]

  let finalContent = ''

  for (let turn = 1; turn <= MAX_TURNS_PER_SUBAGENT; turn++) {
    const result = await callLLM(messages, { tools, temperature: 0.3 })
    const message = result.message || {}
    const rawContent = message.content || result.content || ''
    let toolCalls = [...(result.tool_calls || [])]

    // Bersihkan thinking tags
    const cleanContent = rawContent.replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '').trim()

    if (!toolCalls.length) {
      finalContent = cleanContent
      break
    }

    // Eksekusi tools
    messages.push({ role: 'assistant', content: rawContent, tool_calls: toolCalls })

    const toolResults = await Promise.all(toolCalls.slice(0, 3).map(async tc => {
      const toolName = tc.function?.name
      let args = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
      const execResult = await Promise.race([
        executeTool(toolName, args, { userId }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`Tool ${toolName} timeout`)), 15_000))
      ]).catch(err => ({ error: err.message }))

      return { tc, toolName, execResult }
    }))

    for (const { tc, toolName, execResult } of toolResults) {
      const output = execResult.data
        ? JSON.stringify(execResult.data).slice(0, 1500)
        : JSON.stringify({ error: execResult.error })
      messages.push({ role: 'tool', tool_call_id: tc.id, name: toolName, content: output })
    }

    // Turn terakhir tanpa tools
    if (turn === MAX_TURNS_PER_SUBAGENT) {
      const finalResult = await callLLM(messages, { temperature: 0.4 })
      finalContent = (finalResult.content || '').replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '').trim()
    }
  }

  return {
    index,
    task,
    result: finalContent.replace(/\[emosi:[^\]]*\]/gi, '').trim() || '(tidak ada hasil)',
    success: finalContent.length > 0
  }
}

// ===== MAIN EXPORT: delegate beberapa task paralel =====
export async function delegateTasks({ tasks = [], userId, sharedContext = '' }) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { error: 'Tidak ada tasks yang diberikan.' }
  }

  const limitedTasks = tasks.slice(0, MAX_SUBAGENTS)
  console.info(`[subagent] Spawning ${limitedTasks.length} subagents untuk user ${userId}`)

  const started = Date.now()

  // Jalankan semua subagent secara paralel dengan timeout global
  const subagentPromises = limitedTasks.map((task, i) =>
    Promise.race([
      runSubagent({ task: typeof task === 'string' ? task : task.task, context: sharedContext, userId, index: i }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`Subagent #${i + 1} timeout setelah ${SUBAGENT_TIMEOUT_MS / 1000}s`)), SUBAGENT_TIMEOUT_MS)
      )
    ]).catch(err => ({
      index: i,
      task: typeof task === 'string' ? task : task.task,
      result: `(timeout atau error: ${err.message})`,
      success: false
    }))
  )

  const results = await Promise.all(subagentPromises)
  const durationMs = Date.now() - started

  console.info(`[subagent] ${results.length} subagents selesai dalam ${durationMs}ms`)

  return {
    totalSubagents: results.length,
    successful: results.filter(r => r.success).length,
    durationMs,
    results: results.map(r => ({
      subtask: r.task,
      result: r.result,
      success: r.success
    }))
  }
}
