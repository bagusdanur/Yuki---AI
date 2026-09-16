import fs from 'node:fs'
import path from 'node:path'
import { callLLM } from '../llm.js'
import { buildAgentSystemPrompt } from './persona.js'
import { getAvailableTools, executeTool } from './skills-engine.js'
import { sanitizeOutputSecrets } from '../security.js'
import { getLatestUserArtifact, saveUserArtifact } from '../memory.js'
import { traceEvent } from './observability.js'
import { buildExecutionPlan, createRetryGuard, validateExecutionPlan } from './planner.js'

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

export function extractToolCallsFromText(content = '') {
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

  // 1b. Format namespaced beberapa provider:
  // <call:workspace-files:list_workspace_files>{}</call:workspace-files:list_workspace_files>
  const normalizedCallContent = content.replace(/\\_/g, '_').replace(/\\<\/call:/gi, '</call:')
  const namespacedCallRegex = /<call:(?:[a-z0-9_-]+:)*([a-z][a-z0-9_]{2,60})\s*>\s*([\s\S]*?)\s*<\\?\/call:(?:call:)?(?:[a-z0-9_-]+:)*\1\s*>/gi
  while ((match = namespacedCallRegex.exec(normalizedCallContent)) !== null) {
    try {
      const args = match[2].trim() || '{}'
      JSON.parse(args)
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function', function: { name: match[1], arguments: args }
      })
    } catch {}
  }

  // 1c. Format inline provider tanpa JSON/closing tag:
  // <call:default_api:replace_workspace_text{hash:abc,path:index.html,replacements:[{new_text:...,old_text:...}]}
  const inline = normalizedCallContent.match(/\\?<call:(?:default_api:)?([a-z][a-z0-9_]{2,60})\s*\{([\s\S]*)\}\s*$/i)
  if (inline) {
    const toolName = inline[1]
    const body = inline[2].replace(/&#x20;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\\_/g, '_').replace(/\\</g, '<')
    const hash = body.match(/(?:^|,)\s*(?:hash|expected_hash)\s*:\s*([^,}\s]+)/i)?.[1]
    const filePath = body.match(/(?:^|,)\s*path\s*:\s*([^,}\n]+)/i)?.[1]?.trim()
    const replacementsBody = body.match(/replacements\s*:\s*\[([\s\S]*)\]\s*$/i)?.[1]
    const replacements = []
    if (replacementsBody) {
      const itemRegex = /\{\s*new_text\s*:\s*([\s\S]*?),\s*old_text\s*:\s*([\s\S]*?)\s*\}(?=\s*,\s*\{|\s*$)/gi
      let item
      while ((item = itemRegex.exec(replacementsBody)) !== null) replacements.push({ new_text: item[1], old_text: item[2] })
    }
    if (toolName && filePath && hash && replacements.length) {
      toolCalls.push({ id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'function',
        function: { name: toolName, arguments: JSON.stringify({ path: filePath, expected_hash: hash, replacements }) } })
    }
  }

  // 1d. Format style-call provider: style:default_api:build_interactive_artifact{html_content:...,title:...}
  const styleCall = normalizedCallContent.match(/(?:^|\n)\s*(?:style|call):default_api:([a-z][a-z0-9_]{2,60})\s*\{([\s\S]*)\}\s*$/i)
  if (styleCall) {
    const toolName = styleCall[1]
    const body = styleCall[2]
    const htmlStart = body.search(/html_content\s*:/i)
    const titleMarker = body.lastIndexOf(',title:')
    if (htmlStart >= 0 && titleMarker > htmlStart) {
      const htmlContent = body.slice(body.indexOf(':', htmlStart) + 1, titleMarker)
      const title = body.slice(titleMarker + 7).trim()
      toolCalls.push({ id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'function',
        function: { name: toolName, arguments: JSON.stringify({ html_content: htmlContent, title }) } })
    }
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
      code = `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Interactive Canvas App</title><style>:root{--background:#f7f7f5;--foreground:#1d1d1b;--surface:#fff;--border:#deded8;--primary:#3f4f3b}body{margin:0;background:var(--background);color:var(--foreground);display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head>\n<body>\n${code}\n</body>\n</html>`
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
    cleanText = cleanText.replace(match[0], '').trim()
  }
  return { cleanText: cleanText.trim(), artifacts }
}

function formatStepTitle(toolName, args = {}) {
  switch (toolName) {
    case 'run_skill_health_check':
      return `Memeriksa kesehatan runtime seluruh skill`
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
    case 'list_workspace_files':
      return `Melihat struktur coding workspace: ${args.path || '.'}`
    case 'read_workspace_file':
      return `Membaca file workspace: ${args.path || ''}`
    case 'search_workspace_code':
      return `Mencari kode di workspace: "${args.query || ''}"`
    case 'create_workspace_file':
      return `Membuat file workspace baru: ${args.path || ''}`
    case 'replace_workspace_text':
      return `Menerapkan patch minimal: ${args.path || ''}`
    case 'get_workspace_diff':
      return `Memeriksa diff perubahan: ${args.path || ''}`
    case 'rollback_workspace_file':
      return `Rollback file workspace: ${args.path || ''}`
    case 'patch_workspace_files':
      return `Menerapkan patch multi-file (${Array.isArray(args.patches) ? args.patches.length : 0} file)`
    case 'validate_workspace_project':
      return `Memvalidasi proyek workspace: ${args.path || '.'}`
    case 'run_workspace_tests':
      return `Menjalankan test sandbox terisolasi: ${args.path || ''}`
    case 'http_api_request':
      return `Testing endpoint API: ${args.method || 'GET'} ${args.url || ''}`
    case 'build_interactive_artifact':
      return `Merakit Live Artifact baru: "${args.title || 'Interactive Widget'}"`
    case 'validate_interactive_artifact':
      return `Memvalidasi sintaks Live Artifact`
    case 'get_active_artifact':
      return `Membaca file artifact aktif di workspace`
    case 'read_artifact_file':
      return `Membaca file artifact: ${args.id || ''}`
    case 'update_interactive_artifact':
      return `Memperbarui artifact: "${args.title || 'Canvas App'}" (${args.patch_note || 'modifikasi'})`
    case 'patch_interactive_artifact':
      return `Menerapkan patch kecil pada artifact aktif (${args.patch_note || 'bugfix'})`
    case 'schedule_task':
      return `Menjadwalkan tugas: "${args.title || 'pengingat'}" (${args.schedule || ''})`
    case 'reschedule_task':
      return `Mengubah jadwal pengingat${args.task_id ? ` #${args.task_id}` : ' terbaru'} (${args.schedule || ''})`
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
    case 'record_self_improvement':
      return `Mencatat wawasan ke Self-Improvement: ${args.topic || ''}`
    case 'list_self_improvements':
      return `Membaca riwayat wawasan Self-Improvement`
    default:
      return `Menjalankan aksi: ${toolName}`
  }
}

// 🛡️ UNIVERSAL PERSISTENT WORKSPACE & INJEKSI KODE AKTIF (Hermes-Grade Multi-Language):
// Optimalkan riwayat chat lampau sambil menjamin LLM selalu memiliki akses penuh ke kode file/script (Python, JS, TS, HTML, CSS, SQL, dll.) yang sedang dikerjakan.
function prepareAgentMessages(messages = [], activeArtifact = null) {
  const recent = messages.slice(-10)
  
  // 1. Temukan kode terbaru dari database persistent workspace ATAU riwayat pesan
  let latestArtifactCode = activeArtifact ? activeArtifact.content : null
  let latestArtifactTitle = activeArtifact ? activeArtifact.title : 'Active File'
  let latestArtifactVersion = activeArtifact ? (activeArtifact.version || 1) : 1
  let latestArtifactType = activeArtifact ? (activeArtifact.type || 'html') : 'html'

  if (!latestArtifactCode) {
    for (let i = recent.length - 1; i >= 0; i--) {
      const m = recent[i]
      if (m.role === 'assistant') {
        // Deteksi blok kode apapun: js, javascript, ts, typescript, py, python, html, css, sql, json, bash, sh, cpp, dll.
        const match = String(m.content || '').match(/```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/)
        if (match && match[2].trim().length > 15) {
          latestArtifactType = match[1].trim() || 'code'
          latestArtifactCode = match[2].trim()
          latestArtifactTitle = `File/Script ${latestArtifactType.toUpperCase()}`
          break
        }
      }
    }
  }

  let preservedLatest = false
  return recent.map((msg) => {
    let content = String(msg.content || '')
    // a. Buang <thinking> dari balasan lama
    content = content.replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '').trim()

    // b. Ringkas blok kode lama dari balasan sebelumnya
    content = content.replace(/```(?:html|xml|svg|javascript|js|typescript|ts|python|py|sql|json|css|bash|sh|cpp|c|go|rust)\s*\n[\s\S]*?```/gi, '[Lampiran File/Kode Versi Sebelumnya]')

    // c. Jika ini pesan asisten terakhir dan ada kode aktif di workspace, sertakan kodenya sebagai acuan iterasi Hermes
    if (msg.role === 'assistant' && latestArtifactCode && !preservedLatest) {
      preservedLatest = true
      content += `\n\n[FILE/KODE AKTIF SEBELUMNYA DI WORKSPACE USER (${latestArtifactType.toUpperCase()})]:\n- Judul: "${latestArtifactTitle}" (v${latestArtifactVersion})\n- Kode Sumber:\n\`\`\`${latestArtifactType}\n${latestArtifactCode}\n\`\`\`\n*(PANDUAN ITERASI KODE & FIX BUG HERMES: Kode di atas adalah file/script yang sebelumnya kamu buatkan untuk user. Jika user meminta perbaikan bug, penambahan fitur/fungsi baru, optimasi, atau refactoring, BACA KODE DI ATAS dan pertahankan seluruh struktur/fungsi yang sudah berjalan, lalu terapkan modifikasi atau patch langsung pada kode tersebut! JANGAN MEMBUAT KODE BARU DARI NOL TANPA MEMPERBAIKI KODE SEBELUMNYA!)*`
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
  // Pembacaan file perlu konteks cukup untuk patch; tool lain tetap dipadatkan.
  const hardLimit = toolName === 'read_workspace_file' ? 18000 : 1500
  if (str.length > hardLimit) {
    return str.slice(0, hardLimit) + '... [output dipadatkan]'
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

const WORKSPACE_MUTATIONS = new Set([
  'create_workspace_file', 'replace_workspace_text', 'patch_workspace_files', 'rollback_workspace_file'
])
const WORKSPACE_INSPECTIONS = new Set(['list_workspace_files', 'read_workspace_file', 'search_workspace_code'])
const WORKSPACE_VERIFICATIONS = new Set(['get_workspace_diff', 'validate_workspace_project'])
const DESTRUCTIVE_TOOLS = new Set(['delete_user_note', 'cancel_scheduled_task'])

function latestUserRequest(messages = []) {
  return [...messages].reverse().find(message => message?.role === 'user')?.content || ''
}

function explicitlyRequestsNewFile(text = '') {
  return /\b(buat(?:kan)?|create|tambahkan|add|generate)\b[\s\S]{0,60}\b(file|proyek|project|aplikasi|app|script|halaman|component|komponen)\b/i.test(String(text))
}

export function evaluateWorkspaceToolPolicy({ toolName, args = {}, userRequest = '', completedTools = [] } = {}) {
  if (toolName === 'http_api_request' && !['GET', 'HEAD'].includes(String(args.method || 'GET').toUpperCase())) {
    return { allowed: false, error: 'APPROVAL_REQUIRED: request HTTP yang dapat mengubah data membutuhkan persetujuan satu kali.' }
  }
  if (DESTRUCTIVE_TOOLS.has(toolName) && !/\b(hapus|delete|batalkan|cancel|setuju|izinkan|approve)\b/i.test(String(userRequest))) {
    return { allowed: false, error: 'APPROVAL_REQUIRED: tindakan penghapusan/pembatalan harus diminta atau disetujui pengguna secara eksplisit pada permintaan aktif.' }
  }
  if (!WORKSPACE_MUTATIONS.has(toolName)) return { allowed: true }
  if (detectCodingIntent(userRequest) === 'analyze') return { allowed: false, error: 'WORKFLOW_BLOCKED: permintaan aktif hanya meminta analisis/review, sehingga workspace tidak boleh diubah.' }
  const inspected = completedTools.some(name => WORKSPACE_INSPECTIONS.has(name))
  if (!inspected) return { allowed: false, error: 'WORKFLOW_BLOCKED: periksa struktur dan baca/cari kode terkait sebelum mengubah workspace.' }
  if (toolName === 'create_workspace_file' && !explicitlyRequestsNewFile(userRequest)) {
    return { allowed: false, error: 'APPROVAL_REQUIRED: pengguna tidak meminta file baru secara eksplisit. Perbaiki file yang ada atau jelaskan file baru yang dibutuhkan dan minta persetujuan.' }
  }
  if (toolName === 'patch_workspace_files' && (!Array.isArray(args.patches) || args.patches.length > 5) && !/\b(setuju|izinkan|lanjutkan|kerjakan|approve)\b/i.test(userRequest)) {
    return { allowed: false, error: 'APPROVAL_REQUIRED: perubahan besar lebih dari 5 file memerlukan persetujuan pengguna.' }
  }
  return { allowed: true }
}

export function detectCodingIntent(text = '') {
  const value = String(text).toLowerCase()
  if (/\b(analisis|review|jelaskan|cek saja|jangan ubah|tanpa mengubah)\b/.test(value)) return 'analyze'
  if (/\b(perbaiki\w*|benerin\w*|benahi\w*|betulin\w*|fix|bug|error|rusak|gagal|masih sama|belum berubah)\b/.test(value)) return 'fix'
  if (/\b(refactor|rapikan|optimasi|optimize)\b/.test(value)) return 'refactor'
  if (/\b(tambah|tambahkan|fitur|implementasikan)\b/.test(value)) return 'extend'
  if (explicitlyRequestsNewFile(value)) return 'create'
  return 'general'
}

export function selectAgentToolNames(text = '') {
  const query = String(text).toLowerCase()
  const selected = new Set()
  const add = names => names.forEach(name => selected.add(name))
  // Permintaan skill/tool eksplisit selalu menang atas klasifikasi kata kunci umum.
  if (/\b(code scratchpad|run_javascript_code|scratchpad)\b/.test(query)) return new Set(['run_javascript_code'])
  if (/\b(self[- ]?improvement|record_self_improvement|list_self_improvements)\b/.test(query)) {
    return new Set(/\b(list|lihat|baca|riwayat)\b/.test(query) ? ['list_self_improvements'] : ['record_self_improvement'])
  }
  if (/\b(skill health|health check|run_skill_health_check|kesehatan skill)\b/.test(query)) return new Set(['run_skill_health_check'])
  if (/\b(url reader|read_url)\b/.test(query)) return new Set(['read_url'])
  if (/\b(browser agent|browse_page|browser_extract|screenshot_url)\b/.test(query)) return new Set(['browse_page', 'browser_extract', 'screenshot_url'])
  if (/\b(safe calculator|calculate_expression)\b/.test(query)) return new Set(['calculate_expression'])
  if (/\b(kode|code|bug|fix|perbaiki|refactor|file|project|proyek|javascript|typescript|python|html|css|json|test|build)\b/.test(query)) {
    add(['analyze_code_syntax', 'list_workspace_files', 'read_workspace_file', 'search_workspace_code', 'create_workspace_file', 'replace_workspace_text', 'get_workspace_diff', 'rollback_workspace_file', 'patch_workspace_files', 'validate_workspace_project', 'run_workspace_tests'])
  }
  if (/\b(game|chess|catur|canvas|artifact|aplikasi interaktif|mini.?game)\b/.test(query)) add(['validate_interactive_artifact', 'build_interactive_artifact', 'get_active_artifact', 'read_artifact_file', 'update_interactive_artifact', 'patch_interactive_artifact'])
  if (/https?:\/\//.test(query) && !/\b(api|endpoint|rest|webhook)\b/.test(query)) add(['read_url'])
  else if (/\b(cari|web|internet|berita|artikel|riset|harga|terbaru)\b/.test(query)) add(['web_search'])
  if (/\b(komik|manga|manhwa|manhua|ryukomik|chapter)\b/.test(query)) add(['search_ryukomik', 'get_latest_comics'])
  if (/\b(todo|catatan|note|agenda|ingatkan\w*|pengingat\w*|jadwal\w*|schedule\w*|reminder\w*|hapus catatan|batalkan jadwal|ubah reminder|ganti pengingat)\b/.test(query)) add(['add_user_note', 'list_user_notes', 'delete_user_note', 'schedule_task', 'reschedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task'])
  if (/\b(hitung|kalkulasi|rumus|tanggal|waktu|jam|hari)\b/.test(query)) add(['calculate_expression', 'calculate_date_difference', 'get_current_time'])
  if (/\b(api|endpoint|rest|webhook)\b/.test(query)) add(['http_api_request'])
  if (/\b(skill|health|kesehatan runtime)\b/.test(query)) add(['run_skill_health_check'])
  if (/\b(paralel|parallel|delegasi|subagent|bagi tugas)\b/.test(query)) add(['delegate_tasks'])
  return selected
}

export function selectAgentToolsForConversation(messages = []) {
  const userMessages = messages.filter(message => message?.role === 'user')
  const currentRequest = userMessages.at(-1)?.content || ''
  const currentSelection = selectAgentToolNames(currentRequest)
  if (currentSelection.size > 0) return currentSelection
  return selectAgentToolNames(userMessages.slice(-3).map(message => message.content).join('\n'))
}

export function resolveAgentTaskIntent(userRequest = '', recentUserContext = '', hasActiveArtifact = false) {
  const currentIntent = detectCodingIntent(userRequest)
  const currentToolSelection = selectAgentToolNames(userRequest)
  const continuesPreviousTask = /^(?:tolong\s+)?(?:lanjut(?:kan)?|teruskan|coba lagi|ulangi|yang tadi|masih sama|belum berubah|tetap bug|masih bug|gak berubah|nggak berubah|belum keperbaiki)[.!?\s]*$/i.test(String(userRequest).trim())
  if (hasActiveArtifact && /\b(masih sama|belum berubah|tetap bug|masih bug|gak berubah|nggak berubah|belum keperbaiki)\b/i.test(userRequest)) return 'fix'
  if (currentIntent !== 'general' || currentToolSelection.size > 0) return currentIntent
  return continuesPreviousTask ? detectCodingIntent(recentUserContext) : 'general'
}

export function buildDeterministicAgentReport({ steps = [], changedPaths = [], artifactResults = [], completedTools = [] } = {}) {
  const actualSteps = steps.filter(step => step.tool !== 'agent_core')
  const unresolved = actualSteps.filter(step => step.status === 'error')
  if (unresolved.length) return `*menatap hasil pemeriksaan dengan serius*\n\nPekerjaan belum bisa dinyatakan selesai. **${unresolved.length} langkah** masih gagal: ${unresolved.map(step => step.title).join('; ')}. Lihat Todo & Progress untuk detailnya.\n\n[emosi: cemas]`
  const updatedArtifact = [...artifactResults].reverse().find(Boolean)
  const updateStep = [...actualSteps].reverse().find(step => ['update_interactive_artifact', 'patch_interactive_artifact'].includes(step.tool) && step.status === 'done')
  if (updatedArtifact && completedTools.some(tool => ['update_interactive_artifact', 'patch_interactive_artifact'].includes(tool))) {
    const version = updatedArtifact.version ? ` ke versi ${updatedArtifact.version}` : ''
    const note = updateStep?.input?.patch_note || 'Bugfix diterapkan langsung pada kode artifact aktif.'
    return `*menatap papan catur itu sebentar, lalu mengangguk puas*\n\nNah, sudah Yuki perbaiki. ${updatedArtifact.title || 'Game aktif'} sekarang tersimpan${version}. Hmph, kali ini bukan cuma diperiksa lalu ditinggal begitu saja.\n\nYang Yuki ubah: ${note}\n\nGame yang lama tetap dipakai${updatedArtifact.id ? ` — ID-nya masih ${updatedArtifact.id}` : ''}, jadi tidak ada salinan atau redesign baru. Sintaksnya juga sudah lolos pemeriksaan dan hasil update berhasil disimpan.\n\nCoba buka Mainkan Live dan mainkan beberapa langkah. Kalau masih terasa aneh, bilang tepatnya terjadi setelah langkah apa—nanti Yuki telusuri bagian itu lagi.\n\n[emosi: senang]`
  }
  const verified = completedTools.includes('validate_workspace_project')
  return `*memeriksa hasilnya sekali lagi sebelum menyerahkan kepadamu*\n\n${changedPaths.length ? `Perubahan berhasil diterapkan pada **${changedPaths.join(', ')}**.` : 'Pemeriksaan selesai tanpa perubahan file.'}${verified ? ' Diff sudah diperiksa dan validasi proyek lulus.' : ''}\n\n[emosi: tenang]`
}

export function buildDeterministicSchedulerReport(steps = []) {
  const schedulerSteps = steps.filter(item => ['schedule_task', 'reschedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task'].includes(item.tool))
  const step = [...schedulerSteps].reverse().find(item => item.status === 'done')
  if (!step && schedulerSteps.some(item => item.status === 'error')) {
    const lastError = [...schedulerSteps].reverse().find(item => item.status === 'error')
    return `*memeriksa record scheduler dan tidak menemukannya*\n\nPengingat **belum berhasil disimpan atau diubah**. Scheduler menolak permintaan pada langkah: ${lastError?.title || 'penjadwalan'}. Yuki tidak akan mengaku jadwal aktif sebelum ada record terverifikasi.\n\nCoba gunakan format seperti **10 menit lagi**, **hari ini jam 09:00**, atau **besok jam 9**.\n\n[emosi: cemas]`
  }
  if (!step) return ''
  const data = step.output || {}
  if (step.tool === 'schedule_task' && data.task) {
    const task = data.task
    return `*memeriksa record scheduler sebelum melapor*\n\nPengingat **${task.title}** berhasil dijadwalkan.\n\n- ID internal: **${task.id}**\n- Jadwal: ${task.humanSchedule || '-'}\n- Eksekusi berikutnya (UTC): ${task.nextRunAtUtc || '-'}\n- Zona waktu: ${task.timezone || 'Asia/Jakarta'}\n\n[emosi: tenang]`
  }
  if (step.tool === 'reschedule_task' && data.task) {
    const task = data.task
    return `*memastikan perubahan tersimpan di record scheduler*\n\nPengingat **${task.title}** berhasil diubah.\n\n- ID internal: **${task.id}**\n- Jadwal baru: ${task.humanSchedule || '-'}\n- Eksekusi berikutnya (UTC): ${task.nextRunAtUtc || '-'}\n- Zona waktu: ${task.timezone || 'Asia/Jakarta'}\n\n[emosi: tenang]`
  }
  if (step.tool === 'list_scheduled_tasks') {
    const tasks = Array.isArray(data.tasks) ? data.tasks : []
    if (!tasks.length) return '*memeriksa daftar scheduler*\n\nTidak ada jadwal aktif saat ini.\n\n[emosi: tenang]'
    return `*memeriksa daftar scheduler*\n\n${tasks.map(task => `- ID **${task.id}** — **${task.title}**; ${task.schedule || '-'}; berikutnya ${task.nextRunAtUtc || '-'} UTC; zona ${task.timezone || 'Asia/Jakarta'}`).join('\n')}\n\n[emosi: tenang]`
  }
  if (step.tool === 'cancel_scheduled_task' && data.success) {
    return `*memastikan perubahan scheduler tersimpan*\n\nJadwal **${data.title || ''}** dengan ID **${data.id}** berhasil dibatalkan.\n\n[emosi: tenang]`
  }
  return ''
}

export function guardGroundedFinalResponse(text = '', toolContracts = [], steps = []) {
  const value = String(text || '').trim()
  const makesSideEffectClaim = /(?:\b(berhasil|sudah|telah)\b[\s\S]{0,90}\b(disimpan|dibuat|dijalankan|dihapus|dijadwalkan|diperbarui|diubah|ubah|pasang|dipasang|diterapkan|diperbaiki|selesai)\b|\b(disimpan|dibuat|dijalankan|dihapus|dijadwalkan|diperbarui|diubah|dipasang|diterapkan|diperbaiki)\b[\s\S]{0,90}\b(berhasil|sudah|telah)\b)/i.test(value)
  const unresolved = steps.filter(step => step?.tool !== 'agent_core' && step?.status === 'error')
  if (makesSideEffectClaim && unresolved.length) {
    return `*menahan laporan karena masih ada langkah gagal*\n\nPekerjaan belum dapat dinyatakan selesai. **${unresolved.length} langkah** masih gagal dan tidak boleh ditutupi oleh laporan sukses.\n\n[emosi: cemas]`
  }
  const evidenceKinds = new Set(toolContracts
    .filter(contract => contract?.status === 'succeeded')
    .flatMap(contract => Array.isArray(contract.evidence) ? contract.evidence.map(item => item?.kind) : []))
  const requiredKinds = []
  if (/\b(disimpan|dibuat|diperbarui|diubah|dipasang|pasang)\b/i.test(value)) requiredKinds.push(new Set(['file', 'record', 'artifact']))
  if (/\bdijalankan\b/i.test(value)) requiredKinds.push(new Set(['stdout', 'http']))
  if (/\bdijadwalkan\b/i.test(value)) requiredKinds.push(new Set(['record']))
  if (/\b(dibatalkan|cancelled)\b/i.test(value)) requiredKinds.push(new Set(['record']))
  const hasMatchingEvidence = requiredKinds.length > 0 && requiredKinds.every(accepted => [...accepted].some(kind => evidenceKinds.has(kind)))
  if (makesSideEffectClaim && !hasMatchingEvidence) {
    return '*menahan laporan sampai ada bukti yang valid*\n\nTindakan belum dapat dinyatakan berhasil karena tool tidak mengembalikan bukti yang dapat diverifikasi. Tidak ada status sukses yang dicatat.\n\n[emosi: cemas]'
  }
  return value
}

export async function runAgent({
  userId,
  username = '',
  messages = [],
  memoryContext = '',
  bondName = 'mulai terbiasa',
  maxTurns = 6,
  onProgress = () => {},
  onApproval = () => null,
  shouldCancel = () => false,
  resume = null
} = {}) {
  const activeArtifact = userId ? getLatestUserArtifact(userId) : null
  const systemPrompt = buildAgentSystemPrompt({ memoryContext, bondName, userId })
  const userRequest = latestUserRequest(messages)
  const executionPlan = buildExecutionPlan(messages, { selectTools: selectAgentToolNames, hasActiveArtifact: Boolean(activeArtifact), maxSteps: 10 })
  const planValidation = validateExecutionPlan(executionPlan)
  if (!planValidation.valid) throw new Error(`AGENT_PLAN_INVALID: ${planValidation.error}`)
  const taskIntent = executionPlan.intent
  const selectedToolNames = new Set(executionPlan.toolAllowlist)
  const explicitSkill = /\b(code scratchpad|self[- ]?improvement|skill health|health check|url reader|browser agent|safe calculator)\b/i.test(userRequest)
  traceEvent('skill_selected', { userId: String(userId || ''), selectedTools: selectedToolNames.size, confidence: explicitSkill ? 1 : selectedToolNames.size ? 0.78 : 0.4 })
  if (activeArtifact && taskIntent === 'fix') {
    selectedToolNames.clear()
    selectedToolNames.add('get_active_artifact')
    selectedToolNames.add('patch_interactive_artifact')
    selectedToolNames.add('update_interactive_artifact')
    executionPlan.toolAllowlist = [...selectedToolNames]
    executionPlan.requiresEvidence = true
  }
  const tools = (await getAvailableTools()).filter(tool => selectedToolNames.has(tool.function?.name))
  const effectiveMaxTurns = activeArtifact && taskIntent === 'fix' ? 5 : Math.min(maxTurns, tools.length === 0 ? 2 : selectedToolNames.has('replace_workspace_text') ? 6 : 4)

  // Siapkan conversation teroptimasi token dengan akses ke activeArtifact
  const optimizedHistory = prepareAgentMessages(messages, activeArtifact)
  const conversation = [
    { role: 'system', content: systemPrompt },
    ...optimizedHistory
  ]

  if (resume?.approvedTool) {
    conversation.push({ role: 'system', content: `WORKFLOW RESUME: tindakan ${resume.approvedTool.toolName} telah disetujui dan dieksekusi tepat satu kali. Hasil terverifikasi: ${formatToolOutputForLLM(resume.approvedTool.toolName, resume.approvedTool.data, resume.approvedTool.error)}. Lanjutkan tujuan awal dari langkah berikutnya. Jangan panggil ulang side effect yang sama.` })
  }

  const steps = resume?.approvedTool ? [{
    id: resume.approvedTool.stepId || `approved_${Date.now()}`,
    tool: resume.approvedTool.toolName,
    title: formatStepTitle(resume.approvedTool.toolName, resume.approvedTool.args),
    input: resume.approvedTool.args,
    output: resume.approvedTool.data,
    status: resume.approvedTool.error ? 'error' : 'done',
    durationMs: resume.approvedTool.durationMs,
    evidence: resume.approvedTool.evidence || []
  }] : []
  const comicResults = []
  const artifactResults = []
  const thoughtList = []
  const completedToolNames = resume?.approvedTool && !resume.approvedTool.error ? [resume.approvedTool.toolName] : []
  const toolContracts = resume?.approvedTool?.contract ? [resume.approvedTool.contract] : []
  const changedWorkspacePaths = new Set()
  if (resume?.approvedTool && !resume.approvedTool.error && WORKSPACE_MUTATIONS.has(resume.approvedTool.toolName)) {
    if (resume.approvedTool.toolName === 'patch_workspace_files') for (const patch of resume.approvedTool.args?.patches || []) changedWorkspacePaths.add(patch.path)
    else if (resume.approvedTool.args?.path) changedWorkspacePaths.add(resume.approvedTool.args.path)
  }
  const readOnlyToolCache = new Map()
  const approvedToolCache = new Map()
  const retryGuard = createRetryGuard({ maxFailures: 4, maxAttemptsPerTool: 2 })
  if (resume?.approvedTool) approvedToolCache.set(`${resume.approvedTool.toolName}:${JSON.stringify(resume.approvedTool.args || {})}`, resume.approvedTool)
  let finalContent = ''
  let truncated = false
  let awaitingApproval = null
  let finalModel = 'Yuki Agent Engine'
  let cancelled = false
  const emitProgress = (step) => {
    try { onProgress({ ...step }) } catch {}
  }
  const analysisStep = {
    id: 'agent_analysis', tool: 'agent_core', skillTitle: 'Yuki Agent',
    title: `Menyusun rencana ${executionPlan.steps.length} langkah (${taskIntent}, ${selectedToolNames.size} tool diizinkan)`,
    status: 'running', startedAt: Date.now()
  }
  emitProgress(analysisStep)

  for (let turn = 1; turn <= effectiveMaxTurns; turn++) {
    if (shouldCancel()) {
      cancelled = true
      finalContent = '*menghentikan pekerjaan dengan aman*\n\nRun dibatalkan sesuai permintaanmu. Langkah yang sudah selesai tetap tercatat; Yuki tidak menjalankan langkah baru.\n\n[emosi: tenang]'
      break
    }
    const result = await callLLM(conversation, {
      tools,
      temperature: 0.4
    })
    if (result.finishReason === 'length') truncated = true

    finalModel = result.provider?.model || finalModel
    const message = result.message || {}
    let toolCalls = [...(result.tool_calls || [])]
    const rawContent = message.content || result.content || ''
    if (turn === 1) {
      analysisStep.status = 'done'
      analysisStep.durationMs = Date.now() - analysisStep.startedAt
      emitProgress(analysisStep)
    }

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
    if (!toolCalls.length && !cleanTextOnly && turn < effectiveMaxTurns) {
      console.info(`[agent] Turn ${turn}: Model hanya mengeluarkan <think>, melanjutkan ke turn ${turn + 1}...`)
      conversation.push({
        role: 'assistant',
        content: rawContent
      })
      // Beberapa gateway Gemini menolak request yang riwayatnya berakhir pada
      // giliran model. Tambahkan giliran user sintetis supaya retry tetap valid
      // di semua provider OpenAI-compatible.
      conversation.push({
        role: 'user',
        content: 'Lanjutkan tugas sekarang. Gunakan tool yang diperlukan atau berikan hasil akhir yang terverifikasi.'
      })
      continue
    }

    // Jika tidak ada tool yang dipanggil, kita sudah mendapatkan jawaban final
    if (!toolCalls.length) {
      const artifactRead = completedToolNames.some(name => ['get_active_artifact', 'read_artifact_file'].includes(name))
      const artifactUpdated = completedToolNames.some(name => ['update_interactive_artifact', 'patch_interactive_artifact'].includes(name))
      if (activeArtifact && taskIntent === 'fix' && (!artifactRead || !artifactUpdated) && turn < effectiveMaxTurns) {
        conversation.push({ role: 'assistant', content: rawContent })
        conversation.push({ role: 'user', content: !artifactRead
          ? `Ini bugfix untuk artifact aktif "${activeArtifact.title}" (${activeArtifact.id}). Kamu belum membaca artifact melalui tool. Panggil get_active_artifact sekarang; jangan hanya mengatakan akan membacanya.`
          : `Artifact aktif sudah dibaca tetapi belum diperbarui. Panggil patch_interactive_artifact pada ID "${activeArtifact.id}" sekarang dengan old_text/new_text kecil berdasarkan akar bug yang sudah ditemukan. Jangan membaca ulang, jangan hanya memvalidasi, dan jangan membuat artifact/redesign baru.` })
        continue
      }
      const needsDiff = changedWorkspacePaths.size > 0 && !completedToolNames.includes('get_workspace_diff')
      const needsValidation = changedWorkspacePaths.size > 0 && !completedToolNames.includes('validate_workspace_project')
      if ((needsDiff || needsValidation) && turn < effectiveMaxTurns) {
        conversation.push({ role: 'assistant', content: rawContent })
        conversation.push({ role: 'user', content: `Perubahan workspace belum boleh dilaporkan selesai. Lakukan ${needsDiff ? 'get_workspace_diff pada file yang berubah' : ''}${needsDiff && needsValidation ? ' lalu ' : ''}${needsValidation ? 'validate_workspace_project' : ''}. Jika validasi gagal, perbaiki atau rollback.` })
        continue
      }
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
      let toolName = tc.function?.name
      let args = {}
      try {
        args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {})
      } catch (err) {
        console.warn(`[agent] Gagal parse argument tool ${toolName}:`, err.message)
      }
      if (toolName === 'build_interactive_artifact' && activeArtifact && taskIntent === 'fix') {
        toolName = 'update_interactive_artifact'
        args = { ...args, id: activeArtifact.id, title: activeArtifact.title, patch_note: args.patch_note || 'Bugfix pada artifact aktif' }
      }
      if (activeArtifact && taskIntent === 'fix' && ['list_workspace_files', 'read_workspace_file', 'search_workspace_code', 'read_artifact_file', 'validate_interactive_artifact', 'analyze_code_syntax'].includes(toolName)) {
        toolName = 'get_active_artifact'
        args = {}
      }
      if (activeArtifact && taskIntent === 'fix' && toolName === 'replace_workspace_text') {
        const edits = Array.isArray(args.replacements) ? args.replacements : [{ old_text: args.old_text, new_text: args.new_text }]
        let updated = String(activeArtifact.content || '')
        let applicable = edits.length > 0
        for (const edit of edits) {
          const count = typeof edit.old_text === 'string' ? updated.split(edit.old_text).length - 1 : 0
          if (count !== 1) { applicable = false; break }
          updated = updated.replace(edit.old_text, String(edit.new_text || ''))
        }
        if (applicable) {
          toolName = 'update_interactive_artifact'
          args = { id: activeArtifact.id, title: activeArtifact.title, html_content: updated, patch_note: `Patch minimal pada ${edits.length} bagian artifact aktif` }
        }
      }
      return { tc, toolName, args }
    })

    // Jalankan berurutan agar hasil baca/hash selalu tersedia sebelum patch dan
    // agar guard workflow dapat menilai aksi sebelumnya secara deterministik.
    const toolResults = []
    for (const { tc, toolName, args } of parsedCalls) {
      if (shouldCancel()) {
        cancelled = true
        finalContent = '*menghentikan pekerjaan dengan aman*\n\nRun dibatalkan sesuai permintaanmu. Langkah yang sudah selesai tetap tercatat; Yuki tidak menjalankan langkah baru.\n\n[emosi: tenang]'
        break
      }
      const earlyCacheKey = `${toolName}:${JSON.stringify(args)}`
      if (approvedToolCache.has(earlyCacheKey)) {
        toolResults.push({ tc, toolName, execResult: approvedToolCache.get(earlyCacheKey) })
        continue
      }
      if ((WORKSPACE_INSPECTIONS.has(toolName) || ['get_active_artifact', 'read_artifact_file'].includes(toolName)) && readOnlyToolCache.has(earlyCacheKey)) {
        toolResults.push({ tc, toolName, execResult: readOnlyToolCache.get(earlyCacheKey) })
        continue
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
      emitProgress(stepRecord)
      traceEvent('tool_call_started', { userId: String(userId || ''), toolName })

      // Jalankan tool dengan timeout per-tool 18 detik dan context userId + username + activeArtifactId
      let execResult
      const retryDecision = retryGuard.inspect(toolName, args)
      const policy = evaluateWorkspaceToolPolicy({
        toolName, args, userRequest: latestUserRequest(messages), completedTools: completedToolNames
      })
      if (!retryDecision.allowed) {
        execResult = { tool: toolName, error: `WORKFLOW_BLOCKED: ${retryDecision.reason === 'IDENTICAL_FAILED_STRATEGY' ? 'strategi identik sudah gagal; gunakan pendekatan atau argumen berbeda' : 'batas retry tool sudah habis'}.`, durationMs: 0 }
      } else if (!selectedToolNames.has(toolName)) {
        execResult = { tool: toolName, error: `WORKFLOW_BLOCKED: tool ${toolName} tidak sesuai target dan intent tugas aktif.`, durationMs: 0 }
      } else if (!policy.allowed) {
        const approvalRequired = policy.error.startsWith('APPROVAL_REQUIRED:')
        const approval = approvalRequired ? onApproval({ toolName, args, stepId: stepRecord.id, reason: policy.error.replace('APPROVAL_REQUIRED:', '').trim() }) : null
        execResult = { tool: toolName, error: policy.error, durationMs: 0, approval }
      } else {
        try {
          const cacheKey = `${toolName}:${JSON.stringify(args)}`
          const cacheable = WORKSPACE_INSPECTIONS.has(toolName) || ['get_active_artifact', 'read_artifact_file'].includes(toolName)
          execResult = cacheable && readOnlyToolCache.has(cacheKey)
            ? readOnlyToolCache.get(cacheKey)
            : await executeToolWithTimeout(toolName, args, { userId, username, activeArtifactId: activeArtifact?.id })
          if (cacheable && !execResult.error) readOnlyToolCache.set(cacheKey, execResult)
        } catch (timeoutErr) {
          execResult = { tool: toolName, error: timeoutErr.message, durationMs: 18000 }
        }
      }

      stepRecord.status = execResult.approval ? 'awaiting_approval' : execResult.error ? 'error' : 'done'
      stepRecord.durationMs = execResult.durationMs
      stepRecord.skillName = execResult.skillName
      stepRecord.skillTitle = execResult.skillTitle
      stepRecord.output = execResult.data || execResult.error
      stepRecord.strategyHash = retryDecision.hash
      stepRecord.evidence = execResult.evidence || []
      if (execResult.approval) stepRecord.approval = execResult.approval
      if (execResult.approval) awaitingApproval = execResult.approval
      if (execResult.contract) toolContracts.push(execResult.contract)
      emitProgress(stepRecord)
      if (!execResult.error) {
        traceEvent('tool_call_completed', { userId: String(userId || ''), toolName, durationMs: execResult.durationMs || 0 })
        const recovered = [...steps].reverse().find(previous => previous !== stepRecord && previous.status === 'error' && previous.tool === toolName && previous.input?.path === args.path)
        if (recovered) {
          recovered.status = 'done'
          recovered.title = `${recovered.title} (retry berikutnya berhasil)`
          recovered.durationMs = recovered.durationMs || 0
          emitProgress(recovered)
        }
        completedToolNames.push(toolName)
        if (WORKSPACE_MUTATIONS.has(toolName)) {
          if (toolName === 'patch_workspace_files') for (const patch of args.patches || []) changedWorkspacePaths.add(patch.path)
          else if (args.path) changedWorkspacePaths.add(args.path)
        }
      }
      if (execResult.error && !execResult.approval) traceEvent('tool_call_failed', { userId: String(userId || ''), toolName, durationMs: execResult.durationMs || 0 })
      if (execResult.error && !execResult.approval) retryGuard.record(toolName, args, { failed: true })
      toolResults.push({ tc, toolName, execResult })
    }
    if (cancelled) break

    // Kumpulkan hasil dan masukkan ke conversation (urutan deterministik)
    for (const { tc, toolName, execResult } of toolResults) {
      if (execResult.data?.comics && Array.isArray(execResult.data.comics)) {
        comicResults.push(...execResult.data.comics)
      }
      if (execResult.data?.artifact && ['build_interactive_artifact', 'update_interactive_artifact', 'patch_interactive_artifact'].includes(toolName)) {
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
    const failedArtifactPatch = toolResults.find(({ toolName, execResult }) => toolName === 'patch_interactive_artifact' && execResult.error)
    if (failedArtifactPatch && turn < effectiveMaxTurns) {
      conversation.push({
        role: 'user',
        content: `Patch teks gagal karena potongan old_text tidak cocok dengan source artifact aktif. Jangan ulangi patch perkiraan yang sama. Gunakan update_interactive_artifact dengan seluruh HTML artifact aktif yang sudah dikoreksi, pertahankan ID dan struktur game, lalu pastikan sintaks valid dan implementasi tetap ringan.`
      })
    }
    if (awaitingApproval) {
      finalContent = `*menunggu keputusanmu sebelum menyentuh data*\n\nTugas dijeda pada langkah yang memerlukan izin. Setelah kamu memilih **Izinkan**, Yuki akan melanjutkan langkah berikutnya dan melakukan verifikasi—bukan langsung menandainya selesai.\n\n[emosi: tenang]`
      break
    }
  }

  // Verifikasi deterministik setelah mutasi. Ini tidak bergantung pada sisa turn/model,
  // sehingga agent tidak bisa berhenti sesudah patch tanpa diff dan validasi.
  if (!cancelled && !awaitingApproval && changedWorkspacePaths.size > 0) {
    if (!completedToolNames.includes('get_workspace_diff')) {
      for (const changedPath of changedWorkspacePaths) {
        const startedAt = Date.now()
        const verification = await executeToolWithTimeout('get_workspace_diff', { path: changedPath }, { userId, username, activeArtifactId: activeArtifact?.id })
        const step = { id: `verify_diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, tool: 'get_workspace_diff', skillTitle: verification.skillTitle,
          title: `Memeriksa diff perubahan: ${changedPath}`, input: { path: changedPath }, status: verification.error ? 'error' : 'done',
          startedAt, durationMs: Date.now() - startedAt, output: verification.data || verification.error }
        steps.push(step); emitProgress(step)
        if (!verification.error) completedToolNames.push('get_workspace_diff')
      }
    }
    if (!completedToolNames.includes('validate_workspace_project')) {
      const startedAt = Date.now()
      const verification = await executeToolWithTimeout('validate_workspace_project', { path: '.' }, { userId, username, activeArtifactId: activeArtifact?.id })
      const invalid = verification.error || verification.data?.valid === false
      const step = { id: `verify_project_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, tool: 'validate_workspace_project', skillTitle: verification.skillTitle,
        title: 'Memvalidasi proyek workspace setelah patch', input: { path: '.' }, status: invalid ? 'error' : 'done',
        startedAt, durationMs: Date.now() - startedAt, output: verification.data || verification.error }
      steps.push(step); emitProgress(step)
      if (!invalid) completedToolNames.push('validate_workspace_project')
    }
  }

  // Jika setelah maxTurns belum ada teks final, panggil sekali lagi tanpa tools
  const finalStep = {
    id: 'agent_final', tool: 'agent_core', skillTitle: 'Yuki Agent',
    title: 'Memverifikasi hasil dan menyusun laporan akhir', status: 'running', startedAt: Date.now()
  }
  if (!cancelled && !awaitingApproval) emitProgress(finalStep)
  if (!cancelled && !awaitingApproval && !finalContent.trim()) {
    const finalCall = await callLLM(conversation, { temperature: 0.5 })
    if (finalCall.finishReason === 'length') truncated = true
    finalContent = finalCall.content || ''
  }
  const completedMutation = completedToolNames.some(name => WORKSPACE_MUTATIONS.has(name) || ['update_interactive_artifact', 'patch_interactive_artifact'].includes(name))
  if (!cancelled && taskIntent === 'fix' && !completedMutation) {
    const failed = steps.filter(step => step.tool !== 'agent_core' && step.status === 'error').map(step => step.title)
    finalContent = `*mengernyit sambil memeriksa hasilnya sekali lagi*\n\nHmph... Yuki belum berhasil menyimpan perbaikannya. Aku tidak akan berpura-pura bilang tugasnya selesai kalau kodenya belum berubah.${failed.length ? ` Yang tersendat ada di: ${failed.join('; ')}.` : ''}\n\nGame lamamu tetap aman dan tidak ditimpa. Coba kirim ulang sekali lagi; Yuki akan melanjutkan dari artifact yang sama, bukan membuat game baru.\n\n[emosi: kesal]`
  }
  if (completedToolNames.some(name => ['update_interactive_artifact', 'patch_interactive_artifact'].includes(name)) && (finalContent.trim().length < 180 || !/(perubahan|diperbarui|verifikasi|validasi)/i.test(finalContent))) {
    finalContent = buildDeterministicAgentReport({ steps, changedPaths: [...changedWorkspacePaths], artifactResults, completedTools: completedToolNames })
  }
  const schedulerReport = cancelled ? '' : buildDeterministicSchedulerReport(steps)
  if (schedulerReport) finalContent = schedulerReport
  if (!finalContent.trim()) {
    const actualSteps = steps.filter(step => step.tool !== 'agent_core')
    const unresolved = actualSteps.filter(step => step.status === 'error')
    const changed = [...changedWorkspacePaths]
    const verified = completedToolNames.includes('validate_workspace_project')
    finalContent = unresolved.length
      ? `*menatap hasil pemeriksaan dengan serius*\n\nPekerjaan belum bisa dinyatakan selesai. **${unresolved.length} langkah** masih gagal: ${unresolved.map(step => step.title).join('; ')}. Tidak ada hasil yang disembunyikan—lihat Todo & Progress untuk detailnya.\n\n[emosi: cemas]`
      : `*memeriksa hasilnya sekali lagi sebelum menyerahkan kepadamu*\n\n${changed.length ? `Perubahan berhasil diterapkan pada **${changed.join(', ')}**.` : 'Pemeriksaan selesai tanpa perubahan file.'}${verified ? ' Diff sudah diperiksa dan validasi proyek lulus.' : ''}\n\n[emosi: tenang]`
  }
  if (!cancelled && !awaitingApproval) {
    finalStep.status = 'done'
    finalStep.durationMs = Date.now() - finalStep.startedAt
    emitProgress(finalStep)
  }

  const { clean: contentWithoutThink, thinking: finalThought } = extractThinking(finalContent)
  if (finalThought) thoughtList.push(finalThought)

  const { reply: rawReply, emotion } = extractEmotion(contentWithoutThink)
  const { cleanText: extractedText, artifacts: autoArtifacts } = extractHtmlArtifactsFromText(rawReply)
  if (autoArtifacts.length > 0) {
    artifactResults.push(...autoArtifacts)
  }

  // 🛡️ DEDUPLIKASI ARTIFACTS: Cegah duplikasi tombol artifact jika LLM memanggil tool DAN menulis kode di respon
  const uniqueArtifacts = []
  const seenTitles = new Set()
  for (let i = artifactResults.length - 1; i >= 0; i--) {
    const art = artifactResults[i]
    const key = (art.title || 'untitled').toLowerCase().trim()
    if (!seenTitles.has(key)) {
      seenTitles.add(key)
      uniqueArtifacts.unshift(art)
    }
  }

  // Simpan/sinkronkan artifact yang dihasilkan ke user_artifacts database & disk
  if (userId && uniqueArtifacts.length > 0) {
    const cleanUser = String(username || 'user').trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'user'
    const userArtifactsDir = path.resolve(`public/artifacts/${cleanUser}`)
    const rootArtifactsDir = path.resolve('public/artifacts')
    try {
      if (!fs.existsSync(userArtifactsDir)) fs.mkdirSync(userArtifactsDir, { recursive: true })
      if (!fs.existsSync(rootArtifactsDir)) fs.mkdirSync(rootArtifactsDir, { recursive: true })
    } catch {}

    for (const art of uniqueArtifacts) {
      try {
        const saved = saveUserArtifact(userId, art)
        const cleanTitleSlug = String(art.title || 'app').trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'app'
        fs.writeFileSync(path.join(userArtifactsDir, `${cleanTitleSlug}.html`), art.content, 'utf8')
        fs.writeFileSync(path.join(userArtifactsDir, `${art.id}.html`), art.content, 'utf8')
        fs.writeFileSync(path.join(rootArtifactsDir, `${art.id}.html`), art.content, 'utf8')
        art.version = saved?.version || art.version || 1
      } catch (err) {
        console.warn('[runner] Gagal simpan artifact ke user_artifacts/disk:', err.message)
      }
    }
  }

  let cleanReply = extractedText
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/```(?:json)?\s*\{[\s\S]*?"(?:name|tool)":\s*"(?:html-canvas-builder|build_interactive_artifact|update_interactive_artifact)"[\s\S]*?```/gi, '')
    .replace(/```(?:json)?\s*\{\s*"name":\s*"[^"]+",\s*"arguments":[\s\S]*?\}\s*```/gi, '')
    .replace(/<call:[^>]{1,180}>[\s\S]*?<\\?\/call:[^>]{1,180}>\s*(?:Response\s*:\s*)?/gi, '')
    .replace(/\\?<call:(?:default_api:)?[a-z][a-z0-9_]{2,60}\s*\{[\s\S]*$/gi, '')
    .replace(/(?:^|\n)\s*(?:style|call):default_api:[a-z][a-z0-9_]{2,60}\s*\{[\s\S]*$/gi, '')
    .replace(/```(?:html|xml)?\s*\n\s*(?:<!DOCTYPE|<html)[\s\S]*?(?:```|$)/gi, '')
    .trim()

  if (!cleanReply && uniqueArtifacts.length > 0) {
    const art = uniqueArtifacts[0]
    const isUpdate = (art.version || 1) > 1
    cleanReply = isUpdate
      ? `Artifact **"${art.title}"** berhasil diperbarui ke versi ${art.version}. Perubahan sudah disimpan dan siap diperiksa melalui kartu di bawah.`
      : `Artifact **"${art.title}"** berhasil dibuat. Hasilnya sudah disimpan dan siap dijalankan melalui kartu di bawah.`
  }

  cleanReply = sanitizeOutputSecrets(cleanReply)
  cleanReply = guardGroundedFinalResponse(cleanReply, toolContracts, steps)

  if (!cleanReply) {
    const unresolved = steps.filter(step => step.tool !== 'agent_core' && step.status === 'error')
    cleanReply = unresolved.length
      ? `*menghentikan proses sebelum hasil yang rusak ditampilkan*\n\nPerubahan belum selesai karena ${unresolved.map(step => step.title).join('; ')} gagal. Source internal tidak ditampilkan ke chat.`
      : '*merapikan hasil kerja dan menutup panel kode internal*\n\nProses selesai. Tidak ada source internal yang ditampilkan ke chat; detail tindakan tersedia di Todo & Progress.'
  }

  const gestureMatch = cleanReply.match(/^\s*\*(?!\*)([^*\n]{2,120})\*(?!\*)\s*/)
  const gesture = gestureMatch ? gestureMatch[1].trim() : ''
  const markdown = gestureMatch ? cleanReply.slice(gestureMatch[0].length).trim() : cleanReply

  return {
    reply: cleanReply,
    gesture,
    markdown,
    mood: emotion || 'tenang',
    model: finalModel,
    mode: 'agent',
    steps,
    workflowState: cancelled ? 'cancelled' : awaitingApproval ? 'awaiting_approval' : steps.some(step => step.status === 'error') ? 'partially_succeeded' : 'succeeded',
    awaitingApproval,
    evidence: toolContracts.flatMap(contract => contract?.evidence || []),
    truncated,
    artifacts: uniqueArtifacts,
    comics: comicResults.slice(0, 6),
    plan: executionPlan
  }
}
