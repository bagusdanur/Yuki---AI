// lib/agent/skills-engine.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let isInitialized = false
const skillsCatalog = new Map() // skillName -> { name, title, category, description, version, instructions, tools, handlerModule }
const toolsRegistry = new Map() // toolName -> { name, description, parameters, skillName, skillTitle, handler }

// Simple YAML Frontmatter parser for SKILL.md
function parseSkillFile(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { metadata: {}, body: content }

  const yamlStr = match[1]
  const body = match[2].trim()
  const metadata = {}

  let currentTool = null
  let currentKey = null

  const lines = yamlStr.split(/\r?\n/)
  let inTools = false
  let inParameters = false

  for (const line of lines) {
    if (line.startsWith('name:')) metadata.name = line.replace('name:', '').trim()
    else if (line.startsWith('category:')) metadata.category = line.replace('category:', '').trim()
    else if (line.startsWith('title:')) metadata.title = line.replace('title:', '').trim()
    else if (line.startsWith('description:')) metadata.description = line.replace('description:', '').trim()
    else if (line.startsWith('version:')) metadata.version = line.replace('version:', '').trim()
    else if (line.startsWith('author:')) metadata.author = line.replace('author:', '').trim()
    else if (line.startsWith('tools:')) {
      metadata.tools = []
      inTools = true
    }
  }

  // Fallback: load structured tools directly from handlers if needed or robust parsing
  return { metadata, body }
}

export async function initSkills(baseDir = path.resolve('skills')) {
  skillsCatalog.clear()
  toolsRegistry.clear()

  if (!fs.existsSync(baseDir)) {
    console.warn(`[skills-engine] Directory ${baseDir} does not exist.`)
    isInitialized = true
    return
  }

  // Recursive scan
  function scan(dir) {
    let files = []
    const items = fs.readdirSync(dir, { withFileTypes: true })
    for (const item of items) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        files = files.concat(scan(full))
      } else if (item.name === 'SKILL.md') {
        files.push(path.dirname(full))
      }
    }
    return files
  }

  const skillDirs = scan(baseDir)

  for (const dir of skillDirs) {
    const skillMdPath = path.join(dir, 'SKILL.md')
    const handlerPath = path.join(dir, 'handler.js')

    try {
      const mdContent = fs.readFileSync(skillMdPath, 'utf8')
      const { metadata, body } = parseSkillFile(mdContent)

      let handlerModule = null
      if (fs.existsSync(handlerPath)) {
        try {
          const fileUrl = pathToFileURL(handlerPath).href
          handlerModule = await import(fileUrl)
        } catch (err) {
          console.error(`[skills-engine] Gagal memuat handler di ${handlerPath}:`, err.message)
        }
      }


      const skillName = metadata.name || path.basename(dir)
      const skillEntry = {
        name: skillName,
        title: metadata.title || skillName,
        category: metadata.category || 'general',
        description: metadata.description || '',
        version: metadata.version || '1.0.0',
        instructions: body,
        dir,
        handler: handlerModule?.default || handlerModule || {}
      }

      skillsCatalog.set(skillName, skillEntry)

      // Registrasikan tools dari handler
      if (handlerModule) {
        const handlers = handlerModule.default || handlerModule
        for (const [toolName, fn] of Object.entries(handlers)) {
          if (typeof fn === 'function') {
            toolsRegistry.set(toolName, {
              name: toolName,
              skillName: skillEntry.name,
              skillTitle: skillEntry.title,
              category: skillEntry.category,
              handler: fn
            })
          }
        }
      }
    } catch (e) {
      console.error(`[skills-engine] Gagal memproses skill di ${dir}:`, e.message)
    }
  }

  console.info(`[skills-engine] Terdaftar ${skillsCatalog.size} skills & ${toolsRegistry.size} tools.`)
  isInitialized = true
}

export async function ensureSkillsLoaded() {
  if (!isInitialized) {
    await initSkills()
  }
}

// Return list of skills for frontend catalog
export async function listSkills() {
  await ensureSkillsLoaded()
  return Array.from(skillsCatalog.values()).map(s => ({
    name: s.name,
    title: s.title,
    category: s.category,
    description: s.description,
    version: s.version
  }))
}

// Schema definisi tool untuk OpenAI Function Calling
const TOOL_SCHEMAS = {
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Mencari informasi artikel, berita anime, fakta aktual, jadwal rilis, atau data terkini dari internet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Kata kunci pencarian spesifik' },
          max_results: { type: 'integer', description: 'Jumlah hasil (1-6, default 4)' }
        },
        required: ['query']
      }
    }
  },
  read_url: {
    type: 'function',
    function: {
      name: 'read_url',
      description: 'Membaca dan mengekstrak teks isi dari tautan web atau artikel online.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL halaman web lengkap (http:// atau https://)' }
        },
        required: ['url']
      }
    }
  },
  search_ryukomik: {
    type: 'function',
    function: {
      name: 'search_ryukomik',
      description: 'Mencari komik/manga/manhwa/manhua di katalog Ryukomik berdasarkan judul atau kata kunci.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Judul komik atau kata kunci pencarian' },
          is_adult: { type: 'boolean', description: 'Kategori dewasa (default false)' }
        },
        required: ['query']
      }
    }
  },
  get_latest_comics: {
    type: 'function',
    function: {
      name: 'get_latest_comics',
      description: 'Mengambil daftar komik dengan chapter yang baru saja diupdate di Ryukomik.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Jumlah komik (default 6)' }
        }
      }
    }
  },
  add_user_note: {
    type: 'function',
    function: {
      name: 'add_user_note',
      description: 'Menyimpan catatan baru, tugas, to-do list, atau target ke agenda pengguna di database permanen.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Judul catatan / tugas' },
          content: { type: 'string', description: 'Detail isi catatan' },
          category: { type: 'string', description: 'Kategori opsional: "todo", "watchlist", "study", "general"' }
        },
        required: ['title', 'content']
      }
    }
  },
  list_user_notes: {
    type: 'function',
    function: {
      name: 'list_user_notes',
      description: 'Melihat seluruh catatan atau to-do list tersimpan milik pengguna.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter kategori opsional ("todo", "watchlist", "study", dll)' }
        }
      }
    }
  },
  delete_user_note: {
    type: 'function',
    function: {
      name: 'delete_user_note',
      description: 'Menghapus catatan atau to-do list berdasarkan ID nomor catatan.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'integer', description: 'ID catatan yang ingin dihapus' }
        },
        required: ['note_id']
      }
    }
  },
  get_current_time: {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Mengambil jam, tanggal, hari, dan zona waktu saat ini (WIB/WITA/WIT/UTC).',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Zona waktu ("WIB", "WITA", "WIT", "UTC", default "WIB")' }
        }
      }
    }
  },
  calculate_date_difference: {
    type: 'function',
    function: {
      name: 'calculate_date_difference',
      description: 'Menghitung selisih hari atau hitung mundur menuju tanggal target (YYYY-MM-DD).',
      parameters: {
        type: 'object',
        properties: {
          target_date: { type: 'string', description: 'Tanggal target (YYYY-MM-DD)' }
        },
        required: ['target_date']
      }
    }
  },
  calculate_expression: {
    type: 'function',
    function: {
      name: 'calculate_expression',
      description: 'Menghitung rumus matematika, persentase, atau kalkulasi angka presisi.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Rumus matematika (misal "(250000 * 0.85) + 12000")' }
        },
        required: ['expression']
      }
    }
  },
  run_javascript_code: {
    type: 'function',
    function: {
      name: 'run_javascript_code',
      description: 'Menjalankan snippet kode JavaScript di sandbox terisolasi untuk manipulasi teks, regex, atau algoritma.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Kode JavaScript yang akan dijalankan' }
        },
        required: ['code']
      }
    }
  },
  analyze_code_syntax: {
    type: 'function',
    function: {
      name: 'analyze_code_syntax',
      description: 'Menganalisis sintaks kode, mendeteksi bug, memeriksa format JSON/SQL/JS/Python, dan validasi struktur kode.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Potongan kode atau teks yang ingin dianalisis' },
          language: { type: 'string', description: 'Bahasa pemrograman ("javascript", "json", "python", "html", "css", "sql")' }
        },
        required: ['code']
      }
    }
  },
  http_api_request: {
    type: 'function',
    function: {
      name: 'http_api_request',
      description: 'Melakukan live test request HTTP/REST API (GET, POST, PUT, DELETE) ke URL target dengan metrik status code, latency ms, dan format JSON.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL endpoint lengkap (http:// atau https://)' },
          method: { type: 'string', description: 'Metode HTTP ("GET", "POST", "PUT", "DELETE", default "GET")' },
          headers: { type: 'string', description: 'JSON string headers request opsional' },
          body: { type: 'string', description: 'Request body opsional untuk POST/PUT' }
        },
        required: ['url']
      }
    }
  },
  build_interactive_artifact: {
    type: 'function',
    function: {
      name: 'build_interactive_artifact',
      description: 'Merakit mini-aplikasi web interaktif, game Canvas 2D, kalkulator, widget, atau visualisasi mandiri untuk ditampilkan di Live Artifact Sandbox Viewer.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Judul aplikasi/game artifact (misal: "Mini Game Retro Pong")' },
          type: { type: 'string', description: 'Tipe artifact ("html", "javascript", "svg", default "html")' },
          html_content: { type: 'string', description: 'Kode HTML/CSS/JavaScript mandiri lengkap yang dapat langsung dieksekusi di browser' }
        },
        required: ['title', 'html_content']
      }
    }
  }
}

let _cachedTools = null

export async function getAvailableTools() {
  await ensureSkillsLoaded()
  if (_cachedTools) return _cachedTools
  const tools = []
  for (const [toolName] of toolsRegistry.entries()) {
    if (TOOL_SCHEMAS[toolName]) {
      tools.push(TOOL_SCHEMAS[toolName])
    }
  }
  _cachedTools = tools
  return tools
}

// Invalidate cache jika skills di-reload (berguna untuk hot-reload dev)
export function invalidateToolsCache() {
  _cachedTools = null
}

export async function executeTool(toolName, args = {}, context = {}) {
  await ensureSkillsLoaded()
  const reg = toolsRegistry.get(toolName)
  if (!reg || typeof reg.handler !== 'function') {
    return { error: `Tool "${toolName}" tidak ditemukan atau belum terdaftar.` }
  }

  const started = Date.now()
  try {
    const result = await reg.handler(args, context)
    return {
      tool: toolName,
      skillName: reg.skillName,
      skillTitle: reg.skillTitle,
      durationMs: Date.now() - started,
      data: result
    }
  } catch (err) {
    return {
      tool: toolName,
      skillName: reg.skillName,
      skillTitle: reg.skillTitle,
      durationMs: Date.now() - started,
      error: `Eksekusi tool ${toolName} gagal: ${err.message}`
    }
  }
}

export function buildSkillsCatalogPrompt() {
  const list = []
  for (const s of skillsCatalog.values()) {
    list.push(`- **${s.title}** (${s.name}): ${s.description}`)
  }
  return `### SKILLS & CAPABILITIES AKTIF (Hermes/OpenCode Style):\n${list.join('\n')}`
}
