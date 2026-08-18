import { callLLM } from '../llm.js'
import { buildAgentSystemPrompt } from './persona.js'
import { getAvailableTools, executeTool } from './skills-engine.js'
import { sanitizeOutputSecrets } from '../security.js'

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

// 🛡️ Deduplicate tool calls berdasarkan name+arguments
function deduplicateToolCalls(toolCalls = []) {
  const seen = new Set()
  return toolCalls.filter(tc => {
    const key = `${tc.function?.name}:${tc.function?.arguments}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
        function: { name: toolName, arguments: argsJson }
      })
    } catch {}
  }

  // 3. Format: Direct JSON — deteksi nama tool secara DINAMIS (tidak lagi hardcode whitelist)
  const directJsonRegex = /\{\s*"(?:name|tool)":\s*"([a-z][a-z0-9_]{2,40})"\s*,\s*"(?:arguments|parameters)":\s*(\{[\s\S]*?\})\s*\}/gi
  while ((match = directJsonRegex.exec(content)) !== null) {
    try {
      let toolName = match[1]
      if (toolName === 'html-canvas-builder') toolName = 'build_interactive_artifact'
      const argsJson = match[2]
      JSON.parse(argsJson) // validasi JSON — lempar error jika tidak valid
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: { name: toolName, arguments: argsJson }
      })
    } catch {}
  }

  return deduplicateToolCalls(toolCalls)
}

export function extractHtmlArtifactsFromText(text = '') {
  const artifacts = []
  let cleanText = text
  const htmlBlockRegex = /```(?:html|xml)?\s*\n([\s\S]*?(?:<!DOCTYPE|<html|<canvas|<div id="game|<div id="app)[\s\S]*?)(?:```|$)/gi
  let match
  while ((match = htmlBlockRegex.exec(text)) !== null) {
    let code = match[1].trim()

    // 🛡️ Auto-Healing: Tutup tag yang terpotong agar sandbox tidak crash
    if ((code.match(/<script\b/gi) || []).length > (code.match(/<\/script>/gi) || []).length) {
      code += '\n</script>'
    }
    if ((code.match(/<style\b/gi) || []).length > (code.match(/<\/style>/gi) || []).length) {
      code += '\n</style>'
    }
    if (!code.includes('</body>')) {
      code += '\n</body>'
    }
    if (!code.includes('</html>')) {
      code += '\n</html>'
    }

    if (!code.includes('<html') && !code.includes('<!DOCTYPE')) {
      code = `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Interactive Canvas App</title><style>body{margin:0;background:#0d1117;color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;}</style></head>\n<body>\n${code}\n</body>\n</html>`
    }

    const titleMatch = code.match(/<title>([^<]+)<\/title>/i) || code.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    const title = titleMatch ? titleMatch[1].trim() : 'Interactive HTML Canvas'
    const artifactId = `art_block_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    artifacts.push({
      id: artifactId,
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
    case 'schedule_task':
      return `Menjadwalkan tugas: "${args.title || 'pengingat'}" (${args.schedule || ''})`
    case 'list_scheduled_tasks':
      return `Mengecek daftar pengingat & jadwal aktif`
    case 'cancel_scheduled_task':
      return `Membatalkan jadwal tugas #${args.task_id}`
    case 'delegate_tasks':
      return `Mendelegasikan ${Array.isArray(args.tasks) ? args.tasks.length : ''} subagent paralel`
    case 'browse_page':
      return `Membuka browser web: ${args.url ? (args.url.length > 35 ? args.url.slice(0, 35) + '...' : args.url) : 'halaman'}`
    case 'screenshot_url':
      return `Mengambil screenshot web: ${args.url || ''}`
    case 'browser_extract':
      return `Mengekstrak elemen web (${args.selector || '*'})`
    default:
      return `Menjalankan aksi: ${toolName}`
  }
}

// 🛡️ EFISIENSI TOKEN & PRESERVASI KODE ARTIFACT:
// Optimalkan riwayat percakapan masa lalu, sambil mempertahankan kode artifact aktif terbaru untuk keperluan bug fixing & iterasi.
function prepareAgentMessages(messages = []) {
  const recent = messages.slice(-10)
  
  // 1. Temukan kode artifact terbaru dari riwayat pesan untuk acuan bug fix
  let latestArtifactCode = null
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]
    if (m.role === 'assistant') {
      const match = String(m.content || '').match(/```(?:html|xml)?\s*\n([\s\S]*?(?:<!DOCTYPE|<html|<canvas|<div id="game|<div id="app)[\s\S]*?)(?:```|$)/i)
      if (match) {
        let rawCode = match[1].trim()
        // Jika kode terlalu raksasa (>12000 char), padatkan CSS boilerplate dan pertahankan script logikanya
        if (rawCode.length > 12000) {
          rawCode = rawCode.slice(0, 12000) + '\n... [sisa kode diabaikan demi efisiensi]'
        }
        latestArtifactCode = rawCode
        break
      }
    }
  }

  let preservedLatest = false
  return recent.map((msg) => {
    let content = String(msg.content || '')
    // a. Buang <thinking> dari balasan lama
    content = content.replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '').trim()

    // b. Ringkas blok kode lama dari balasan sebelumnya
    content = content.replace(/```(?:html|xml|svg)\s*\n[\s\S]*?```/gi, '[Lampiran File Artifact Versi Sebelumnya]')

    // c. Jika ini pesan asisten terakhir dan ada artifact aktif, sertakan kodenya sebagai acuan iterasi
    if (msg.role === 'assistant' && latestArtifactCode && !preservedLatest) {
      preservedLatest = true
      content += `\n\n[KONTEKS ARTIFACT KODE AKTIF SEBELUMNYA]:\n\`\`\`html\n${latestArtifactCode}\n\`\`\`\n*(Instruksi: Jika user meminta perbaikan bug/revisi, modifikasi dan perbaiki kode di atas daripada membuat baru dari nol)*`
    }

    // d. Batasi panjang pesan teks asisten lampau
    if (msg.role === 'assistant' && content.length > 15000) {
      content = content.slice(0, 15000) + '... [output dipadatkan]'
    }
    return { role: msg.role, content }
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

// ⏱️ Per-tool timeout helper — mencegah tool hang memblokir seluruh agent request
async function executeToolWithTimeout(toolName, args, context, timeoutMs = 18000) {
  return Promise.race([
    executeTool(toolName, args, context),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool "${toolName}" timeout setelah ${timeoutMs / 1000}s`)), timeoutMs)
    )
  ])
}

export async function runAgent({
  userId,
  messages = [],
  memoryContext = '',
  bondName = 'mulai terbiasa',
  maxTurns = 6 // Ditingkatkan dari 4 → 6 untuk task kompleks multi-step
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

    // Deduplicate tool calls sebelum eksekusi (Optimasi F)
    const uniqueToolCalls = deduplicateToolCalls(toolCalls)

    // Masukkan pesan assistant dengan tool_calls ke riwayat lokal iterasi
    conversation.push({
      role: 'assistant',
      content: rawContent,
      tool_calls: uniqueToolCalls
    })

    // Parse semua args terlebih dahulu
    const parsedCalls = uniqueToolCalls.map(tc => {
      const toolName = tc.function?.name
      let args = {}
      try {
        args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {})
      } catch (err) {
        console.warn(`[agent] Gagal parse argument tool ${toolName}:`, err.message)
      }
      return { tc, toolName, args }
    })

    // Buat step records dan jalankan semua tool secara PARALEL (Optimasi A)
    // Tool yang berjalan bersamaan dipercepat drastis vs eksekusi serial
    const toolPromises = parsedCalls.map(async ({ tc, toolName, args }) => {
      const stepRecord = {
        id: tc.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool: toolName,
        title: formatStepTitle(toolName, args),
        input: args,
        status: 'running',
        startedAt: Date.now()
      }
      steps.push(stepRecord)

      // Jalankan tool dengan timeout per-tool 18 detik (Bug #3 fix)
      let execResult
      try {
        execResult = await executeToolWithTimeout(toolName, args, { userId })
      } catch (timeoutErr) {
        execResult = { tool: toolName, error: timeoutErr.message, durationMs: 18000 }
      }

      stepRecord.status = execResult.error ? 'error' : 'done'
      stepRecord.durationMs = execResult.durationMs
      stepRecord.skillName = execResult.skillName
      stepRecord.skillTitle = execResult.skillTitle
      stepRecord.output = execResult.data || execResult.error

      return { tc, toolName, execResult }
    })

    const toolResults = await Promise.all(toolPromises)

    // Kumpulkan hasil dan masukkan ke conversation (urutan deterministik)
    for (const { tc, toolName, execResult } of toolResults) {
      if (execResult.data?.comics && Array.isArray(execResult.data.comics)) {
        comicResults.push(...execResult.data.comics)
      }
      if (execResult.data?.artifact) {
        artifactResults.push(execResult.data.artifact)
      }
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

  cleanReply = sanitizeOutputSecrets(cleanReply)

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
