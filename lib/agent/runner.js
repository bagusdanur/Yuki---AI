// lib/agent/runner.js
import { callLLM } from '../llm.js'
import { buildAgentSystemPrompt } from './persona.js'
import { getAvailableTools, executeTool } from './skills-engine.js'

function extractEmotion(text = '') {
  const m = text.match(/\[emosi:\s*([^\]]+)\]/i)
  const rawEmotion = m ? m[1].trim().toLowerCase() : null
  const reply = text.replace(/\[emosi:\s*[^\]]*\]/gi, '').trim()
  return { reply, emotion: rawEmotion }
}

function extractThinking(text = '') {
  const thoughts = []
  if (!text) return { clean: '', thinking: '' }

  let clean = text

  // 1. Tag XML: <think>...</think>, <thinking>...</thinking>, <thought>...</thought>
  clean = clean.replace(/<(?:thinking|think|thought)>([\s\S]*?)(?:<\/(?:thinking|think|thought)>|$)/gi, (_match, thoughtContent) => {
    if (thoughtContent.trim()) {
      thoughts.push(thoughtContent.trim())
    }
    return ''
  })

  // 2. Format Colocated Markdown: :::thought ... ::: atau :::thinking ... :::
  clean = clean.replace(/:::(?:thought|thinking)\s*([\s\S]*?)(?::::|$)/gi, (_match, thoughtContent) => {
    if (thoughtContent.trim()) {
      thoughts.push(thoughtContent.trim())
    }
    return ''
  })

  // 3. Format Tag Kurung: [THOUGHT]...[/THOUGHT] atau [THINKING]...[/THINKING]
  clean = clean.replace(/\[(?:THOUGHT|THINKING)\]([\s\S]*?)(?:\[\/(?:THOUGHT|THINKING)\]|$)/gi, (_match, thoughtContent) => {
    if (thoughtContent.trim()) {
      thoughts.push(thoughtContent.trim())
    }
    return ''
  })

  // 4. Bersihkan sisa-sisa tag yatim piatu
  clean = clean.replace(/:::(?:thought|thinking)?/gi, '')
  clean = clean.replace(/<\/?(?:thinking|think|thought)>/gi, '')

  return { clean: clean.trim(), thinking: thoughts.join('\n\n') }
}

function extractToolCallsFromText(content = '') {
  const toolCalls = []
  if (!content) return toolCalls

  // 1. Format: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
  let match
  while ((match = xmlRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      let toolName = parsed.name || parsed.tool
      if (toolName === 'html-canvas-builder') toolName = 'build_interactive_artifact'
      if (toolName) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'function',
          function: {
            name: toolName,
            arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments || parsed.parameters || {})
          }
        })
      }
    } catch {}
  }

  // 2. Format: ```json\n{"name": "...", "arguments": {...}}\n```
  const jsonBlockRegex = /```(?:json)?\s*\n\s*\{\s*"(?:name|tool)":\s*"([^"]+)",\s*"(?:parameters|arguments|input)":\s*([\s\S]*?)\}\s*\n```/gi
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      let toolName = match[1]
      if (toolName === 'html-canvas-builder') toolName = 'build_interactive_artifact'
      const argsRaw = match[2].trim()
      const argsJson = argsRaw.startsWith('{') ? argsRaw : `{${argsRaw}`
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: argsJson
        }
      })
    } catch {}
  }

  // 3. Format: Direct JSON tool calling
  const directJsonRegex = /\{\s*"(?:name|tool)":\s*"(build_interactive_artifact|html-canvas-builder|calculate_expression|web_search|search_ryukomik|add_user_note)"\s*,\s*"(?:arguments|parameters)":\s*(\{[\s\S]*?\})\s*\}/gi
  while ((match = directJsonRegex.exec(content)) !== null) {
    try {
      let toolName = match[1]
      if (toolName === 'html-canvas-builder') toolName = 'build_interactive_artifact'
      const argsJson = match[2]
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: argsJson
        }
      })
    } catch {}
  }

  return toolCalls
}

export function extractHtmlArtifactsFromText(text = '') {
  const artifacts = []
  let cleanText = text
  const htmlBlockRegex = /```(?:html|xml)?\s*\n([\s\S]*?(?:<!DOCTYPE|<html|<canvas|<div id="game|<div id="app)[\s\S]*?)(?:```|$)/gi
  let match
  while ((match = htmlBlockRegex.exec(text)) !== null) {
    let code = match[1].trim()
    if (!code.includes('<html') && !code.includes('<!DOCTYPE')) {
      code = `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"><title>Interactive Canvas App</title><style>body{margin:0;background:#0d1117;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;}</style></head>\n<body>\n${code}\n</body>\n</html>`
    }
    const titleMatch = code.match(/<title>([^<]+)<\/title>/i) || code.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    const title = titleMatch ? titleMatch[1].trim() : 'Interactive HTML Canvas'

    artifacts.push({
      id: `art_block_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      type: 'html',
      content: code
    })
    cleanText = cleanText.replace(match[0], `\n\n*(Visual Artifact "${title}" siap dimainkan/dijalankan secara langsung di Sandbox)*\n\n`)
  }
  return { cleanText: cleanText.trim(), artifacts }
}

function formatStepTitle(toolName, args = {}) {
  switch (toolName) {
    case 'web_search':
      return `Mencari web: "${args.query || 'info'}"`
    case 'read_url':
      return `Membaca artikel web: ${args.url ? (args.url.length > 35 ? args.url.slice(0, 35) + '...' : args.url) : 'halaman'}`
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
    case 'analyze_code_syntax':
      return `Menganalisis & debugging kode ${args.language || 'script'}`
    case 'http_api_request':
      return `Testing endpoint API: ${args.method || 'GET'} ${args.url || ''}`
    case 'build_interactive_artifact':
      return `Merakit Live Artifact: "${args.title || 'Interactive Widget'}"`
    default:
      return `Menjalankan aksi: ${toolName}`
  }
}

// 🛡️ EFISIENSI TOKEN: Optimalkan riwayat percakapan masa lalu untuk Agent Runner
function prepareAgentMessages(messages = []) {
  // Ambil hanya 6 percakapan terakhir agar prompt token tidak bocor/meledak
  const recent = messages.slice(-6)
  return recent.map(msg => {
    let content = String(msg.content || '')
    // 1. Buang <thinking> dari balasan lama karena hanya relevan di giliran saat itu
    content = content.replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '').trim()
    // 2. Ringkas kode HTML/Canvas raksasa dari balasan sebelumnya
    content = content.replace(/```(?:html|xml|svg)\s*\n[\s\S]*?```/gi, '[Lampiran File Artifact Visual Sebelumnya]')
    // 3. Batasi panjang pesan asisten lampau jika terlalu panjang
    if (msg.role === 'assistant' && content.length > 1200) {
      content = content.slice(0, 1200) + '... [bagian teks panjang dipadatkan]'
    }
    return {
      role: msg.role,
      content
    }
  })
}

// 🛡️ EFISIENSI TOKEN: Padatkan return value tool sebelum dikirim kembali ke LLM
function formatToolOutputForLLM(toolName, data, error) {
  if (error) {
    return JSON.stringify({ error: String(error) })
  }
  if (!data) {
    return JSON.stringify({ status: 'ok' })
  }

  let compactData = data
  if (typeof data === 'object') {
    // Jika ada preview body yang terlalu panjang, potong rapi
    if (data.bodyPreview && data.bodyPreview.length > 800) {
      compactData = { ...data, bodyPreview: data.bodyPreview.slice(0, 800) + '... (output terpotong demi efisiensi)' }
    }
    // Jika tool artifact mengembalikan ratusan baris kode, LLM tidak perlu membaca ulang seluruh kodenya
    if (data.artifact && data.artifact.content) {
      compactData = {
        success: true,
        artifact: {
          id: data.artifact.id,
          title: data.artifact.title,
          type: data.artifact.type,
          summary: 'Artifact interaktif berhasil dirakit dan siap dirender di Live Viewer.'
        }
      }
    }
    // Jika komik mengembalikan list panjang, ambil 5 teratas
    if (Array.isArray(data.comics) && data.comics.length > 5) {
      compactData = {
        ...data,
        comics: data.comics.slice(0, 5)
      }
    }
  }

  const str = typeof compactData === 'string' ? compactData : JSON.stringify(compactData)
  // Hard limit 1,500 karakter per tool return untuk mencegah token explosion
  if (str.length > 1500) {
    return str.slice(0, 1500) + '... [output dipadatkan]'
  }
  return str
}

export async function runAgent({
  userId,
  messages = [],
  memoryContext = '',
  bondName = 'mulai terbiasa',
  maxTurns = 4 // Dibatasi 4 giliran agar tidak loop tanpa batas
} = {}) {
  const systemPrompt = buildAgentSystemPrompt({ memoryContext, bondName, userId })
  const tools = await getAvailableTools()

  // Siapkan conversation teroptimasi token
  const optimizedHistory = prepareAgentMessages(messages)
  const conversation = [
    { role: 'system', content: systemPrompt },
    ...optimizedHistory
  ]

  const steps = []
  const comicResults = []
  const artifactResults = []
  const thoughtList = []
  let finalContent = ''
  let finalModel = 'Yuki Agent Engine'

  for (let turn = 1; turn <= maxTurns; turn++) {
    const result = await callLLM(conversation, {
      tools,
      temperature: 0.4
    })

    finalModel = result.provider?.model || finalModel
    const message = result.message || {}
    let toolCalls = [...(result.tool_calls || [])]
    const rawContent = message.content || result.content || ''

    let cleanTextOnly = ''
    if (rawContent) {
      const { clean, thinking } = extractThinking(rawContent)
      cleanTextOnly = clean.trim()
      if (thinking) thoughtList.push(thinking)
      if (!toolCalls.length) {
        const textCalls = extractToolCallsFromText(rawContent)
        if (textCalls.length > 0) {
          toolCalls.push(...textCalls)
        }
      }
    }

    // Jika model HANYA mengeluarkan <think>...</think> tanpa isi teks atau tool_calls sama sekali:
    // Lanjutkan iterasi berikutnya agar model benar-benar mengeksekusi rencananya!
    if (!toolCalls.length && !cleanTextOnly && turn < maxTurns) {
      console.info(`[agent] Turn ${turn}: Model hanya mengeluarkan <think>, melanjutkan ke turn ${turn + 1}...`)
      conversation.push({
        role: 'assistant',
        content: rawContent
      })
      continue
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

      // Masukkan hasil ke conversation sebagai role: 'tool' dengan data yang sudah dioptimasi token
      const compactedToolOutput = formatToolOutputForLLM(toolName, execResult.data, execResult.error)
      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: toolName,
        content: compactedToolOutput
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

  const { reply: rawReply, emotion } = extractEmotion(contentWithoutThink)
  const { cleanText: extractedText, artifacts: autoArtifacts } = extractHtmlArtifactsFromText(rawReply)
  if (autoArtifacts.length > 0) {
    artifactResults.push(...autoArtifacts)
  }

  let cleanReply = extractedText
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|tool)":\s*"(?:html-canvas-builder|build_interactive_artifact)"[\s\S]*?```/gi, '')
    .replace(/```(?:json)?\s*\{\s*"name":\s*"[^"]+",\s*"arguments":[\s\S]*?\}\s*```/gi, '')
    .replace(/```(?:html|xml)?\s*\n\s*(?:<!DOCTYPE|<html)[\s\S]*?(?:```|$)/gi, '')
    .trim()

  if (!cleanReply && artifactResults.length > 0) {
    cleanReply = `Aku sudah merakit game "${artifactResults[0].title}" untukmu. Buka kartu di bawah untuk langsung memainkannya!`
  }

  return {
    reply: cleanReply || 'Tugas telah selesai dieksekusi.',
    mood: emotion || 'tenang',
    model: finalModel,
    mode: 'agent',
    steps,
    thinking: thoughtList.filter(Boolean).join('\n\n---\n\n'),
    artifacts: artifactResults,
    comics: comicResults.slice(0, 6)
  }
}
