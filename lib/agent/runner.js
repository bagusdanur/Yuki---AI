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

function extractThinking(text = '') {
  const thoughts = []
  const clean = text.replace(/<(?:thinking|think)>([\s\S]*?)<\/(?:thinking|think)>/gi, (_match, thoughtContent) => {
    if (thoughtContent.trim()) {
      thoughts.push(thoughtContent.trim())
    }
    return ''
  }).trim()

  return { clean, thinking: thoughts.join('\n\n') }
}

function extractHtmlCodeBlocks(text = '') {
  const artifacts = []
  const htmlBlockRegex = /```(?:html|xml)\s*\n([\s\S]*?<!DOCTYPE[\s\S]*?<\/html>[\s\S]*?)```/gi
  let match
  while ((match = htmlBlockRegex.exec(text)) !== null) {
    const code = match[1].trim()
    const titleMatch = code.match(/<title>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : 'Interactive HTML Artifact'
    artifacts.push({
      id: `art_block_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      type: 'html',
      content: code
    })
  }
  return artifacts
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
    case 'build_interactive_artifact':
      return `Merakit Live Artifact: "${args.title || 'Interactive Widget'}"`
    default:
      return `Menjalankan aksi: ${toolName}`
  }
}

export async function runAgent({
  userId,
  messages = [],
  memoryContext = '',
  bondName = 'mulai terbiasa',
  maxTurns = 5
} = {}) {
  const systemPrompt = buildAgentSystemPrompt({ memoryContext, bondName, userId })
  const tools = await getAvailableTools()

  const conversation = [
    { role: 'system', content: systemPrompt },
    ...messages
  ]

  const steps = []
  const comicResults = []
  const artifactResults = []
  const thoughtList = []
  let finalContent = ''
  let finalModel = 'Hermes Codex Engine'

  for (let turn = 1; turn <= maxTurns; turn++) {
    const result = await callLLM(conversation, {
      tools,
      temperature: 0.4
    })

    finalModel = result.provider?.model || finalModel
    const message = result.message || {}
    const toolCalls = result.tool_calls || []
    const rawContent = message.content || result.content || ''

    if (rawContent) {
      const { thinking } = extractThinking(rawContent)
      if (thinking) thoughtList.push(thinking)
    }

    // Jika tidak ada tool yang dipanggil, kita sudah mendapatkan jawaban final
    if (!toolCalls.length) {
      finalContent = rawContent
      break
    }

    // Masukkan pesan assistant dengan tool_calls ke riwayat lokal iterasi
    conversation.push({
      role: 'assistant',
      content: rawContent,
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

      // Jika tool artifact mengembalikan artifact, kumpulkan
      if (execResult.data?.artifact) {
        artifactResults.push(execResult.data.artifact)
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
    const finalCall = await callLLM(conversation, { temperature: 0.5 })
    finalContent = finalCall.content || ''
  }

  const { clean: contentWithoutThink, thinking: finalThought } = extractThinking(finalContent)
  if (finalThought) thoughtList.push(finalThought)

  const { reply, emotion } = extractEmotion(contentWithoutThink)

  // Ekstrak artifact dari blok HTML mandiri jika belum ada artifact dari tool
  if (artifactResults.length === 0) {
    const detectedArtifacts = extractHtmlCodeBlocks(reply)
    if (detectedArtifacts.length > 0) {
      artifactResults.push(...detectedArtifacts)
    }
  }

  return {
    reply: reply || 'Tugas telah selesai dieksekusi.',
    mood: emotion || 'tenang',
    model: finalModel,
    mode: 'agent',
    steps,
    thinking: thoughtList.filter(Boolean).join('\n\n---\n\n'),
    artifacts: artifactResults,
    comics: comicResults.slice(0, 6)
  }
}
