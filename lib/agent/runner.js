// lib/agent/runner.js
import { callLLM } from '../llm.js'
import { buildAgentSystemPrompt } from './persona.js'
import { getAvailableTools, executeTool, listSkills } from './skills-engine.js'

function extractEmotion(text = '') {
  const m = text.match(/\[emosi:\s*([^\]]+)\]/i)
  const rawEmotion = m ? m[1].trim().toLowerCase() : null
  const reply = text.replace(/\[emosi:\s*[^\]]*\]/gi, '').trim()
  return { reply, emotion: rawEmotion }
}

function stripThink(s = '') {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function formatStepTitle(toolName, args = {}) {
  switch (toolName) {
    case 'web_search':
      return `Mencari web: "${args.query || 'info'}"`
    case 'read_url':
      return `Membaca artikel web: ${args.url ? new URL(args.url).hostname : 'halaman'}`
    case 'search_ryukomik':
      return `Mencari komik Ryukomik: "${args.query || ''}"`
    case 'get_latest_comics':
      return `Mengecek update chapter terbaru Ryukomik`
    case 'add_user_note':
      return `Menyimpan catatan: "${args.title || 'tugas'}"`
    case 'list_user_notes':
      return `Membaca daftar catatan / to-do pengguna`
    case 'delete_user_note':
      return `Menghapus catatan ID #${args.note_id}`
    case 'get_current_time':
      return `Mengecek waktu & kalender (${args.timezone || 'WIB'})`
    case 'calculate_date_difference':
      return `Menghitung selisih tanggal: ${args.target_date}`
    case 'calculate_expression':
      return `Menghitung rumus: ${args.expression}`
    case 'run_javascript_code':
      return `Menjalankan kode scratchpad di sandbox`
    default:
      return `Menjalankan aksi: ${toolName}`
  }
}

export async function runAgent({
  userId,
  messages = [],
  memoryContext = '',
  bondName = 'mulai terbiasa',
  maxTurns = 4
} = {}) {
  const systemPrompt = buildAgentSystemPrompt({ memoryContext, bondName, userId })
  const tools = await getAvailableTools()

  const conversation = [
    { role: 'system', content: systemPrompt },
    ...messages
  ]

  const steps = []
  const comicResults = []
  let finalContent = ''
  let finalModel = 'Agent Engine'

  for (let turn = 1; turn <= maxTurns; turn++) {
    const result = await callLLM(conversation, {
      tools,
      temperature: 0.5
    })

    finalModel = result.provider?.model || finalModel
    const message = result.message || {}
    const toolCalls = result.tool_calls || []

    // Jika tidak ada tool yang dipanggil, kita sudah mendapatkan jawaban final
    if (!toolCalls.length) {
      finalContent = message.content || result.content || ''
      break
    }

    // Masukkan pesan assistant dengan tool_calls ke riwayat lokal iterasi
    conversation.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: toolCalls
    })

    // Eksekusi tiap tool call
    for (const tc of toolCalls) {
      const toolName = tc.function?.name
      let args = {}
      try {
        args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {})
      } catch (err) {
        console.warn(`[agent] Gagal parse argument tool ${toolName}:`, err.message)
      }

      const stepRecord = {
        id: tc.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool: toolName,
        title: formatStepTitle(toolName, args),
        input: args,
        status: 'running',
        startedAt: Date.now()
      }
      steps.push(stepRecord)

      // Jalankan tool
      const execResult = await executeTool(toolName, args, { userId })
      stepRecord.status = execResult.error ? 'error' : 'done'
      stepRecord.durationMs = execResult.durationMs
      stepRecord.skillName = execResult.skillName
      stepRecord.skillTitle = execResult.skillTitle
      stepRecord.output = execResult.data || execResult.error

      // Jika tool komik mengembalikan kartu komik, kumpulkan
      if (execResult.data?.comics && Array.isArray(execResult.data.comics)) {
        comicResults.push(...execResult.data.comics)
      }

      // Masukkan hasil ke conversation sebagai role: 'tool'
      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: toolName,
        content: JSON.stringify(execResult.data || { error: execResult.error })
      })
    }
  }

  // Jika setelah maxTurns belum ada teks final, panggil sekali lagi tanpa tools
  if (!finalContent.trim()) {
    const finalCall = await callLLM(conversation, { temperature: 0.6 })
    finalContent = finalCall.content || ''
  }

  const stripped = stripThink(finalContent)
  const { reply, emotion } = extractEmotion(stripped)

  return {
    reply: reply || 'Tugas telah selesai dieksekusi.',
    mood: emotion || 'tenang',
    model: finalModel,
    mode: 'agent',
    steps,
    comics: comicResults.slice(0, 6)
  }
}
