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
          filter_special: { type: 'boolean', description: 'Filter kategori khusus, true atau false (default false)' }
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
      description: 'Menghitung selisih hari/bulan/tahun antara dua tanggal.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Tanggal awal (YYYY-MM-DD)' },
          end_date: { type: 'string', description: 'Tanggal akhir (YYYY-MM-DD)' }
        },
        required: ['start_date', 'end_date']
      }
    }
  },
  record_self_improvement: {
    type: 'function',
    function: {
      name: 'record_self_improvement',
      description: 'Mencatat evaluasi mandiri, wawasan coding, solusi bug, atau pelajaran baru ke memori pengalaman Yuki (Self-Improvement Review).',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topik evaluasi (misal: "Canvas Touch Scaling", "Tetris Controls", "API Optimization")' },
          learning_summary: { type: 'string', description: 'Ringkasan pelajaran atau perbaikan yang dipelajari' },
          skill_affected: { type: 'string', description: 'Skill yang terkait (misal: "html-canvas-builder", "code-scratchpad", "general")' }
        },
        required: ['topic', 'learning_summary']
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
  },

  // ====== SCHEDULER TOOLS ======
  schedule_task: {
    type: 'function',
    function: {
      name: 'schedule_task',
      description: 'Membuat pengingat atau tugas terjadwal baru yang persisten (sekali atau berulang). Mendukung jadwal harian, mingguan, atau relatif ("30 menit lagi").',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Nama singkat pengingat (misal "Review Anime Mingguan")' },
          description: { type: 'string', description: 'Detail apa yang harus dilakukan saat waktu tiba' },
          schedule: { type: 'string', description: 'Jadwal bahasa natural: "setiap Senin jam 8", "setiap hari jam 20:00", "30 menit lagi", "besok jam 9"' }
        },
        required: ['title', 'description', 'schedule']
      }
    }
  },
  list_scheduled_tasks: {
    type: 'function',
    function: {
      name: 'list_scheduled_tasks',
      description: 'Menampilkan semua pengingat dan tugas terjadwal aktif milik pengguna.',
      parameters: { type: 'object', properties: {} }
    }
  },
  cancel_scheduled_task: {
    type: 'function',
    function: {
      name: 'cancel_scheduled_task',
      description: 'Membatalkan pengingat atau tugas terjadwal berdasarkan ID.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: 'ID tugas dari list_scheduled_tasks' }
        },
        required: ['task_id']
      }
    }
  },

  // ====== SUBAGENT DELEGATION ======
  delegate_tasks: {
    type: 'function',
    function: {
      name: 'delegate_tasks',
      description: 'Membagi task besar menjadi 2-4 subtask yang dikerjakan paralel oleh subagent mandiri, lalu hasilnya digabungkan. Gunakan untuk riset multi-aspek, perbandingan, atau analisis kompleks.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Daftar 2-4 subtask spesifik yang dikerjakan paralel (tiap item adalah string deskripsi tugas)',
            items: { type: 'string' }
          },
          shared_context: { type: 'string', description: 'Konteks bersama untuk semua subagent (topik utama, batasan)' }
        },
        required: ['tasks']
      }
    }
  },

  // ====== BROWSER AUTOMATION ======
  browse_page: {
    type: 'function',
    function: {
      name: 'browse_page',
      description: 'Membuka URL dengan browser nyata (headless), menunggu JavaScript selesai render, lalu mengekstrak teks konten halaman. Gunakan saat read_url biasa tidak berhasil (SPA, JS-heavy pages).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL lengkap halaman (https://...)' },
          wait_for: { type: 'string', description: '"networkidle2" untuk halaman kompleks, "domcontentloaded" untuk cepat (default: networkidle2)' }
        },
        required: ['url']
      }
    }
  },
  screenshot_url: {
    type: 'function',
    function: {
      name: 'screenshot_url',
      description: 'Mengambil screenshot halaman web dan mengembalikannya sebagai gambar.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL halaman yang ingin di-screenshot' },
          full_page: { type: 'boolean', description: 'Screenshot seluruh halaman atau hanya viewport (default false)' }
        },
        required: ['url']
      }
    }
  },
  browser_extract: {
    type: 'function',
    function: {
      name: 'browser_extract',
      description: 'Mengekstrak data spesifik dari elemen HTML halaman web menggunakan CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL halaman' },
          selector: { type: 'string', description: 'CSS selector (misal "h1", ".price", "#main p", "table tr")' },
          attribute: { type: 'string', description: '"text", "href", atau "src" (default: text)' }
        },
        required: ['url', 'selector']
      }
    }
  },

  // ====== SELF-IMPROVEMENT & CONTINUOUS LEARNING ======
  record_self_improvement: {
    type: 'function',
    function: {
      name: 'record_self_improvement',
      description: 'Mencatat evaluasi mandiri, wawasan coding, pelajaran perbaikan bug, atau teknik baru ke database memori jangka panjang agar Yuki semakin pintar di masa mendatang.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topik perbaikan atau pelajaran (misal "Platformer Collision Bugfix", "Audio Autoplay Fix")' },
          skill_affected: { type: 'string', description: 'Skill yang terkait ("computing", "browser", "research", "general")' },
          learning_summary: { type: 'string', description: 'Ringkasan pelajaran atau solusi perbaikan bug yang ditemukan' }
        },
        required: ['topic', 'learning_summary']
      }
    }
  },
  list_self_improvements: {
    type: 'function',
    function: {
      name: 'list_self_improvements',
      description: 'Membaca daftar riwayat pelajaran, catatan perbaikan bug, dan evaluasi mandiri yang tersimpan di memori Yuki.',
      parameters: { type: 'object', properties: {} }
    }
  },

  // ====== PERSISTENT ARTIFACT WORKSPACE (Hermes-Grade) ======
  build_interactive_artifact: {
    type: 'function',
    function: {
      name: 'build_interactive_artifact',
      description: 'Merakit mini-aplikasi web mandiri baru (HTML5/CSS/JS/Canvas/WebAudio) yang langsung dapat dijalankan di Live Sandbox dan disimpan ke workspace user.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Judul artifact (misal "Retro Platformer", "Neon Snake 2D")' },
          type: { type: 'string', enum: ['html', 'javascript', 'svg'], description: 'Tipe artifact (default: html)' },
          html_content: { type: 'string', description: 'Kode HTML/JS lengkap mandiri' }
        },
        required: ['title', 'html_content']
      }
    }
  },
  get_active_artifact: {
    type: 'function',
    function: {
      name: 'get_active_artifact',
      description: 'Membaca seluruh kode sumber, versi, dan metadata dari file artifact/game yang sedang aktif di workspace user saat ini.',
      parameters: { type: 'object', properties: {} }
    }
  },
  read_artifact_file: {
    type: 'function',
    function: {
      name: 'read_artifact_file',
      description: 'Membaca file artifact spesifik berdasarkan ID uniknya.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID unik artifact (misal "art_xxxx")' }
        },
        required: ['id']
      }
    }
  },
  update_interactive_artifact: {
    type: 'function',
    function: {
      name: 'update_interactive_artifact',
      description: 'Memperbarui file artifact yang sudah ada (menambahkan level baru, memperbaiki bug, menyetel parameter game) tanpa membuat ulang dari nol, serta menaikkan nomor versinya.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID artifact yang diperbarui (opsional)' },
          title: { type: 'string', description: 'Judul artifact' },
          html_content: { type: 'string', description: 'Seluruh kode HTML/JS lengkap hasil modifikasi/penambahan fitur' },
          patch_note: { type: 'string', description: 'Ringkasan perubahan (misal "Menambahkan Level 4 dan Level 5")' }
        },
        required: ['html_content']
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
  return `### SKILLS & CAPABILITIES AKTIF (Yuki Engine):\n${list.join('\n')}`
}
