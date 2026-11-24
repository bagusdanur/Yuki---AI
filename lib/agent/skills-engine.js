// lib/agent/skills-engine.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildEvidence, createToolResult, verifyToolResult } from './tool-result.js'
import { validateSafeOutboundUrl } from '../security.js'

let isInitialized = false
const skillsCatalog = new Map() // skillName -> { name, title, category, description, version, author, triggers, source, isCustom, instructions, tools, handlerModule }
const toolsRegistry = new Map() // toolName -> { name, description, parameters, skillName, skillTitle, handler }
const STATE_PATH = path.resolve('data', 'skills-state.json')
const CUSTOM_SKILLS_DIR = path.resolve('skills', 'custom')
let disabledSkills = new Set()

function loadSkillsState() {
  try {
    if (!fs.existsSync(STATE_PATH)) { disabledSkills = new Set(); return }
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    disabledSkills = new Set(Array.isArray(raw?.disabled) ? raw.disabled.map(String) : [])
  } catch {
    disabledSkills = new Set()
  }
}

function saveSkillsState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    fs.writeFileSync(STATE_PATH, JSON.stringify({ disabled: [...disabledSkills].sort() }, null, 2), 'utf8')
  } catch (err) {
    console.error('[skills-engine] Gagal menyimpan skills-state.json:', err.message)
  }
}

// Simple YAML Frontmatter parser for SKILL.md (supports Claude Skills metadata + triggers)
function parseSkillFile(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { metadata: {}, body: content }

  const yamlStr = match[1]
  const body = match[2].trim()
  const metadata = {}

  const lines = yamlStr.split(/\r?\n/)
  const stripQuotes = (v) => v.replace(/^["']|["']$/g, '').trim()

  for (const line of lines) {
    if (line.startsWith('name:')) metadata.name = stripQuotes(line.replace('name:', '').trim())
    else if (line.startsWith('category:')) metadata.category = stripQuotes(line.replace('category:', '').trim())
    else if (line.startsWith('title:')) metadata.title = stripQuotes(line.replace('title:', '').trim())
    else if (line.startsWith('description:')) metadata.description = stripQuotes(line.replace('description:', '').trim())
    else if (line.startsWith('version:')) metadata.version = stripQuotes(line.replace('version:', '').trim())
    else if (line.startsWith('author:')) metadata.author = stripQuotes(line.replace('author:', '').trim())
    else if (line.startsWith('source:')) metadata.source = stripQuotes(line.replace('source:', '').trim())
    else if (line.startsWith('triggers:')) {
      const rawTrig = stripQuotes(line.replace('triggers:', '').trim()).replace(/^\[|\]$/g, '')
      metadata.triggers = rawTrig.split(',').map(s => stripQuotes(s).toLowerCase()).filter(Boolean)
    } else if (line.startsWith('tools:')) {
      metadata.tools = []
    }
  }

  return { metadata, body }
}

export async function initSkills(baseDir = path.resolve('skills')) {
  skillsCatalog.clear()
  toolsRegistry.clear()
  _cachedTools = null
  loadSkillsState()

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
    const isCustom = path.resolve(dir).startsWith(CUSTOM_SKILLS_DIR + path.sep) || path.resolve(dir) === CUSTOM_SKILLS_DIR

    try {
      const mdContent = fs.readFileSync(skillMdPath, 'utf8')
      const { metadata, body } = parseSkillFile(mdContent)

      let handlerModule = null
      if (!isCustom && fs.existsSync(handlerPath)) {
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
        category: metadata.category || (isCustom ? 'plugin' : 'general'),
        description: metadata.description || '',
        version: metadata.version || '1.0.0',
        author: metadata.author || (isCustom ? 'Custom Plugin' : 'Yuki Agent Team'),
        source: metadata.source || '',
        triggers: Array.isArray(metadata.triggers) ? metadata.triggers : [],
        isCustom,
        rawMarkdown: mdContent,
        instructions: body,
        dir,
        handler: handlerModule?.default || handlerModule || {}
      }

      skillsCatalog.set(skillName, skillEntry)

      // Registrasikan tools dari handler (hanya built-in yang boleh eksekusi kode JS)
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

// Return list of enabled skills for frontend catalog
export async function listSkills() {
  await ensureSkillsLoaded()
  return Array.from(skillsCatalog.values())
    .filter(s => !disabledSkills.has(s.name))
    .map(s => ({
      name: s.name,
      title: s.title,
      category: s.category,
      description: s.description,
      version: s.version,
      isCustom: Boolean(s.isCustom)
    }))
}

export async function getSkillsHealth() {
  await ensureSkillsLoaded()
  const missingSchemas = []
  const skills = Array.from(skillsCatalog.values()).map(skill => {
    const tools = Array.from(toolsRegistry.values()).filter(tool => tool.skillName === skill.name).map(tool => tool.name)
    for (const tool of tools) if (!TOOL_SCHEMAS[tool]) missingSchemas.push(tool)
    const healthy = skill.isCustom
      ? Boolean(skill.instructions && skill.instructions.length > 10)
      : (tools.length > 0 && tools.every(tool => Boolean(TOOL_SCHEMAS[tool])))
    return { name: skill.name, tools: tools.length, isCustom: Boolean(skill.isCustom), enabled: !disabledSkills.has(skill.name), healthy }
  })
  return { success: missingSchemas.length === 0, healthy: missingSchemas.length === 0,
    skills_count: skills.length, tools_count: toolsRegistry.size, missing_schemas: missingSchemas, skills }
}

// Schema definisi tool untuk OpenAI Function Calling
const TOOL_SCHEMAS = {
  run_skill_health_check: {
    type: 'function', function: {
      name: 'run_skill_health_check', description: 'Memeriksa apakah semua skill, handler, dan schema tool berhasil dimuat. Read-only dan tidak menjalankan tool lain.',
      parameters: { type: 'object', properties: {} }
    }
  },
  list_workspace_files: {
    type: 'function',
    function: {
      name: 'list_workspace_files',
      description: 'Melihat struktur file hanya di coding workspace terisolasi milik pengguna dan tidak dapat melihat project lain.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'Path relatif dalam workspace, default "."' },
        depth: { type: 'integer', description: 'Kedalaman daftar folder 1-5' }
      } }
    }
  },
  read_workspace_file: {
    type: 'function',
    function: {
      name: 'read_workspace_file',
      description: 'Membaca rentang baris file teks dalam workspace dan mengembalikan hash yang wajib dipakai saat mengedit.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'Path relatif file dalam workspace' },
        start_line: { type: 'integer', description: 'Baris awal, default 1' },
        end_line: { type: 'integer', description: 'Baris akhir, maksimal 400 baris per panggilan' }
      }, required: ['path'] }
    }
  },
  search_workspace_code: {
    type: 'function',
    function: {
      name: 'search_workspace_code',
      description: 'Mencari teks atau simbol di seluruh file workspace sebelum menentukan lokasi perbaikan.',
      parameters: { type: 'object', properties: {
        query: { type: 'string', description: 'Teks atau simbol yang dicari' },
        path: { type: 'string', description: 'Folder/file relatif, default "."' },
        max_results: { type: 'integer', description: 'Maksimal hasil, default 50' }
      }, required: ['query'] }
    }
  },
  create_workspace_file: {
    type: 'function',
    function: {
      name: 'create_workspace_file',
      description: 'Membuat file baru di workspace. Gagal jika file sudah ada; jangan gunakan untuk mengganti kode lama.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'Path relatif file baru' },
        content: { type: 'string', description: 'Isi file baru' }
      }, required: ['path', 'content'] }
    }
  },
  replace_workspace_text: {
    type: 'function',
    function: {
      name: 'replace_workspace_text',
      description: 'Menerapkan patch minimal dengan mengganti satu potongan teks yang cocok tepat satu kali. Wajib membaca file dahulu dan menyertakan hash terbaru.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'Path relatif file yang diperbaiki' },
        old_text: { type: 'string', description: 'Potongan kode lama yang cocok tepat satu kali' },
        new_text: { type: 'string', description: 'Kode pengganti' },
        replacements: { type: 'array', description: 'Alternatif untuk beberapa penggantian atomik dalam file yang sama.', items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['old_text', 'new_text'] } },
        expected_hash: { type: 'string', description: 'Hash dari read_workspace_file terakhir' }
      }, required: ['path', 'expected_hash'] }
    }
  },
  get_workspace_diff: {
    type: 'function', function: {
      name: 'get_workspace_diff', description: 'Melihat diff ringkas antara file saat ini dan snapshot sebelum edit terakhir.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path relatif file' } }, required: ['path'] }
    }
  },
  rollback_workspace_file: {
    type: 'function', function: {
      name: 'rollback_workspace_file', description: 'Mengembalikan file ke snapshot sebelum perubahan terakhir jika patch menimbulkan regresi.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'Path relatif file' },
        snapshot_id: { type: 'string', description: 'ID snapshot opsional; default snapshot terbaru' }
      }, required: ['path'] }
    }
  },
  patch_workspace_files: {
    type: 'function', function: {
      name: 'patch_workspace_files', description: 'Menerapkan 2-10 patch file sebagai satu kelompok setelah semua hash dan old_text tervalidasi.',
      parameters: { type: 'object', properties: {
        patches: { type: 'array', items: { type: 'object', properties: {
          path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, expected_hash: { type: 'string' }
        }, required: ['path', 'old_text', 'new_text', 'expected_hash'] } }
      }, required: ['patches'] }
    }
  },
  validate_workspace_project: {
    type: 'function', function: {
      name: 'validate_workspace_project', description: 'Memvalidasi sintaks dasar JS, TypeScript, JSON, HTML, dan CSS dalam workspace tanpa menjalankan shell atau kode proyek.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path relatif file/folder, default "."' } } }
    }
  },
  run_workspace_tests: {
    type: 'function', function: {
      name: 'run_workspace_tests', description: 'Menjalankan satu file test JavaScript di Node permission sandbox tanpa shell, network, child process, atau akses file di luar workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path relatif test pada folder test/tests/__tests__ atau file *.test.js/*.spec.js' } }, required: ['path'] }
    }
  },
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
          limit: { type: 'integer', description: 'Jumlah hasil yang diminta (1-10). Gunakan 1 jika pengguna meminta satu rekomendasi.' },
          format: { type: 'string', enum: ['MANGA', 'MANHWA', 'MANHUA', 'KOMIK'], description: 'Tipe karya eksplisit bila diminta pengguna.' },
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
          limit: { type: 'integer', description: 'Jumlah komik (default 6)' },
          genre: { type: 'string', description: 'Genre opsional, misalnya romance, aksi, fantasi, atau horror' }
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
          , idempotency_key: { type: 'string', description: 'Kunci idempotensi opsional agar retry tidak membuat catatan ganda' }
          , timezone: { type: 'string', description: 'Zona waktu IANA pengguna, default Asia/Jakarta' }
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
          target_date: { type: 'string', description: 'Tanggal target (YYYY-MM-DD) yang dibandingkan dengan hari ini' }
        },
        required: ['target_date']
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
          headers: { type: 'object', description: 'Header request opsional. Jangan kirim token/cookie kecuali benar-benar diperlukan.' },
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
  validate_interactive_artifact: {
    type: 'function', function: {
      name: 'validate_interactive_artifact', description: 'Memeriksa keseimbangan tag dan sintaks JavaScript artifact tanpa menjalankannya atau menyimpan file.',
      parameters: { type: 'object', properties: {
        html_content: { type: 'string', description: 'Kode HTML/CSS/JavaScript artifact yang diperiksa' }
      }, required: ['html_content'] }
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
          , timezone: { type: 'string', description: 'Zona waktu IANA pengguna, default Asia/Jakarta' }
          , idempotency_key: { type: 'string', description: 'Kunci idempotensi opsional agar retry tidak menggandakan jadwal' }
        },
        required: ['schedule']
      }
    }
  },
  reschedule_task: {
    type: 'function',
    function: {
      name: 'reschedule_task',
      description: 'Mengubah waktu pengingat aktif. Jika task_id tidak diberikan, ubah pengingat aktif yang paling baru.',
      parameters: { type: 'object', properties: {
        task_id: { type: 'integer', description: 'ID pengingat opsional; default pengingat aktif terbaru' },
        schedule: { type: 'string', description: 'Jadwal baru, misalnya "hari ini jam 08:56", "10 menit lagi", atau "besok jam 9"' },
        timezone: { type: 'string', description: 'Zona waktu IANA, default Asia/Jakarta' }
      }, required: ['schedule'] }
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
  },
  patch_interactive_artifact: {
    type: 'function', function: {
      name: 'patch_interactive_artifact', description: 'Menerapkan 1-20 penggantian teks atomik pada artifact aktif tanpa mengirim ulang seluruh HTML. Pilihan utama untuk bugfix game agar hemat token.',
      parameters: { type: 'object', properties: {
        id: { type: 'string', description: 'ID artifact opsional; default artifact aktif' },
        old_text: { type: 'string', description: 'Potongan lama untuk satu patch' },
        new_text: { type: 'string', description: 'Potongan pengganti untuk satu patch' },
        replacements: { type: 'array', items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['old_text', 'new_text'] } },
        patch_note: { type: 'string', description: 'Penjelasan perubahan yang tampil di laporan Yuki' }
      } }
    }
  }
}

let _cachedTools = null

export async function getAvailableTools() {
  await ensureSkillsLoaded()
  if (_cachedTools) return _cachedTools
  const tools = []
  for (const [toolName, reg] of toolsRegistry.entries()) {
    if (disabledSkills.has(reg.skillName)) continue
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
  const startedAt = new Date(started).toISOString()
  const toolCallId = context.toolCallId
  try {
    const result = await reg.handler(args, context)
    if (result?.success === false || result?.error) {
      const message = result.error || 'Tool gagal tanpa detail.'
      const contract = createToolResult({
        toolCallId, skillId: reg.skillName, toolName, status: 'failed', data: result,
        error: { code: result.code || 'TOOL_FAILED', message, retryable: Boolean(result.retryable) },
        startedAt, durationMs: Date.now() - started
      })
      return {
        tool: toolName,
        skillName: reg.skillName,
        skillTitle: reg.skillTitle,
        durationMs: Date.now() - started,
        error: message,
        data: result,
        contract,
        evidence: []
      }
    }
    const evidence = buildEvidence(toolName, result)
    const contract = createToolResult({
      toolCallId, skillId: reg.skillName, toolName, status: 'succeeded', data: result,
      evidence, startedAt, durationMs: Date.now() - started
    })
    const verification = verifyToolResult(contract)
    if (!verification.verified) {
      contract.status = 'failed'
      contract.error = { code: 'EVIDENCE_MISSING', message: verification.reason, retryable: false }
      return {
        tool: toolName, skillName: reg.skillName, skillTitle: reg.skillTitle,
        durationMs: Date.now() - started, error: verification.reason, data: result,
        contract, evidence
      }
    }
    return {
      tool: toolName,
      skillName: reg.skillName,
      skillTitle: reg.skillTitle,
      durationMs: Date.now() - started,
      data: result,
      contract,
      evidence
    }
  } catch (err) {
    const message = `Eksekusi tool ${toolName} gagal: ${err.message}`
    return {
      tool: toolName,
      skillName: reg.skillName,
      skillTitle: reg.skillTitle,
      durationMs: Date.now() - started,
      error: message,
      contract: createToolResult({
        toolCallId, skillId: reg.skillName, toolName, status: 'failed',
        error: { code: 'TOOL_EXCEPTION', message, retryable: false }, startedAt, durationMs: Date.now() - started
      }),
      evidence: []
    }
  }
}

export function buildSkillsCatalogPrompt() {
  const list = []
  for (const s of skillsCatalog.values()) {
    if (disabledSkills.has(s.name)) continue
    list.push(`- **${s.title}** (${s.name}): ${s.description}`)
  }
  return `### SKILLS & CAPABILITIES AKTIF (Yuki Engine):\n${list.join('\n')}`
}

// Claude-Style Progressive Skill Disclosure:
// Injeksikan instruksi lengkap SKILL.md dari skill yang tool-nya aktif ATAU plugin kustom Claude SKILL.md yang trigger-nya cocok dengan pesan user.
export function buildActiveSkillsPrompt(selectedToolNames = [], userQuery = '') {
  const toolSet = new Set(Array.isArray(selectedToolNames) ? selectedToolNames : [...selectedToolNames])
  const matchedSkills = new Map()

  for (const toolName of toolSet) {
    const reg = toolsRegistry.get(toolName)
    if (!reg?.skillName || disabledSkills.has(reg.skillName) || matchedSkills.has(reg.skillName)) continue
    const skill = skillsCatalog.get(reg.skillName)
    if (skill?.instructions) matchedSkills.set(reg.skillName, skill)
    if (matchedSkills.size >= 4) break
  }

  // Cocokkan juga plugin kustom Claude SKILL.md (instruction-only) berdasarkan triggers / nama / deskripsi
  const q = String(userQuery || '').toLowerCase()
  if (q) {
    for (const skill of skillsCatalog.values()) {
      if (!skill.isCustom || disabledSkills.has(skill.name) || matchedSkills.has(skill.name)) continue
      const tokens = [
        skill.name.toLowerCase(),
        ...skill.triggers,
        ...String(skill.title || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4)
      ]
      const hit = tokens.some(tok => tok && q.includes(tok))
      if (hit && skill.instructions) {
        matchedSkills.set(skill.name, skill)
        if (matchedSkills.size >= 6) break
      }
    }
  }

  if (!matchedSkills.size) return ''
  const blocks = []
  for (const skill of matchedSkills.values()) {
    const body = String(skill.instructions || '').trim().slice(0, 2600)
    blocks.push(`#### SKILL AKTIF: ${skill.title} (${skill.name})\n${body}`)
  }
  return `\n### PANDUAN SKILL AKTIF (WAJIB DIIKUTI SESUAI ARAHAN):\n${blocks.join('\n\n')}`
}

/* ══════════ ADMIN SKILLS & PLUGIN MANAGER (CLAUDE SKILL.MD) ══════════ */
export async function listSkillsDetailed() {
  await ensureSkillsLoaded()
  const list = []
  for (const skill of skillsCatalog.values()) {
    const tools = Array.from(toolsRegistry.values())
      .filter(t => t.skillName === skill.name)
      .map(t => t.name)
    const healthy = skill.isCustom
      ? Boolean(skill.instructions && skill.instructions.length > 10)
      : (tools.length > 0 && tools.every(t => Boolean(TOOL_SCHEMAS[t])))
    list.push({
      name: skill.name,
      title: skill.title,
      category: skill.category,
      description: skill.description,
      version: skill.version,
      author: skill.author,
      source: skill.source,
      triggers: skill.triggers || [],
      isCustom: Boolean(skill.isCustom),
      enabled: !disabledSkills.has(skill.name),
      healthy,
      tools,
      rawMarkdown: skill.rawMarkdown || '',
      instructionsLength: (skill.instructions || '').length
    })
  }
  return list.sort((a, b) => Number(b.isCustom) - Number(a.isCustom) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

export async function setSkillEnabled(skillName, enabled) {
  await ensureSkillsLoaded()
  const name = String(skillName || '').trim()
  if (!skillsCatalog.has(name)) throw new Error(`Skill "${name}" tidak ditemukan.`)
  if (enabled) disabledSkills.delete(name)
  else disabledSkills.add(name)
  saveSkillsState()
  invalidateToolsCache()
  return { name, enabled: !disabledSkills.has(name) }
}

function sanitizeSlug(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export async function installCustomSkill({ slug = '', markdown = '', sourceUrl = '' } = {}) {
  await ensureSkillsLoaded()
  const rawMd = String(markdown || '').trim()
  if (!rawMd || rawMd.length < 20) throw new Error('Isi SKILL.md terlalu pendek (minimal 20 karakter).')
  if (rawMd.length > 65_000) throw new Error('Ukuran SKILL.md terlalu besar (maksimal 64 KB).')
  if (/<script\b/i.test(rawMd)) throw new Error('Tag <script> tidak diperbolehkan di dalam SKILL.md.')

  const parsed = parseSkillFile(rawMd)
  const finalSlug = sanitizeSlug(slug || parsed.metadata.name || parsed.metadata.title)
  if (!finalSlug || finalSlug.length < 2) throw new Error('Slug nama skill tidak valid (gunakan huruf kecil, angka, dan tanda hubung).')

  const existing = skillsCatalog.get(finalSlug)
  if (existing && !existing.isCustom) {
    throw new Error(`Nama "${finalSlug}" sudah dipakai skill bawaan sistem. Gunakan nama slug lain.`)
  }

  // Pastikan ada frontmatter YAML standar Claude SKILL.md
  let finalContent = rawMd
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(rawMd)) {
    const title = parsed.metadata.title || finalSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    finalContent = [
      '---',
      `name: ${finalSlug}`,
      `title: ${title}`,
      'category: plugin',
      `description: Plugin Claude SKILL.md (${title})`,
      'version: 1.0.0',
      sourceUrl ? `source: ${sourceUrl}` : '',
      '---',
      '',
      rawMd
    ].filter(Boolean).join('\n')
  } else if (sourceUrl && !/^source:/m.test(rawMd.split('---')[1] || '')) {
    finalContent = rawMd.replace(/^---\r?\n/, `---\nsource: ${sourceUrl}\n`)
  }

  const targetDir = path.join(CUSTOM_SKILLS_DIR, finalSlug)
  if (!path.resolve(targetDir).startsWith(CUSTOM_SKILLS_DIR + path.sep)) {
    throw new Error('Path skill tidak valid.')
  }
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(path.join(targetDir, 'SKILL.md'), finalContent, 'utf8')
  disabledSkills.delete(finalSlug)
  saveSkillsState()
  await initSkills()
  return (await listSkillsDetailed()).find(s => s.name === finalSlug)
}

export async function importSkillFromUrl({ url = '', slug = '' } = {}) {
  const input = String(url || '').trim()
  if (!/^https?:\/\//i.test(input)) throw new Error('URL harus diawali http:// atau https://')

  // Auto-convert GitHub blob URL -> raw.githubusercontent.com
  let rawUrl = input
  const ghBlob = input.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i)
  if (ghBlob) {
    rawUrl = `https://raw.githubusercontent.com/${ghBlob[1]}/${ghBlob[2]}/${ghBlob[3]}`
  }
  // Jika user paste folder GitHub (tree/main/skills/foo), otomatis arahkan ke SKILL.md di dalamnya
  const ghTree = input.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+?)\/?$/i)
  if (ghTree) {
    rawUrl = `https://raw.githubusercontent.com/${ghTree[1]}/${ghTree[2]}/${ghTree[3]}/SKILL.md`
  }

  const check = await validateSafeOutboundUrl(rawUrl)
  if (!check.safe) throw new Error(`URL diblokir demi keamanan: ${check.reason}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  let res
  try {
    res = await fetch(check.cleanUrl, {
      headers: { 'User-Agent': 'Yuki-AI-SkillImporter/5.4', Accept: 'text/plain, text/markdown, */*' },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`Gagal mengunduh SKILL.md (HTTP ${res.status}). Pastikan URL mengarah ke file SKILL.md publik.`)
  const text = await res.text()
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
    throw new Error('URL mengembalikan halaman HTML, bukan file markdown SKILL.md mentah.')
  }

  const inferredSlug = slug || (() => {
    const parts = new URL(rawUrl).pathname.split('/').filter(Boolean)
    const last = parts.at(-1) || ''
    if (/^skill\.md$/i.test(last) && parts.length >= 2) return parts.at(-2)
    return last.replace(/\.md$/i, '')
  })()

  return installCustomSkill({ slug: inferredSlug, markdown: text, sourceUrl: input })
}

export async function deleteCustomSkill(skillName) {
  await ensureSkillsLoaded()
  const name = String(skillName || '').trim()
  const entry = skillsCatalog.get(name)
  if (!entry) throw new Error(`Skill "${name}" tidak ditemukan.`)
  if (!entry.isCustom) throw new Error('Skill bawaan sistem tidak dapat dihapus (gunakan tombol Nonaktifkan).')
  const targetDir = path.resolve(entry.dir)
  if (!targetDir.startsWith(CUSTOM_SKILLS_DIR + path.sep)) throw new Error('Path skill kustom tidak valid.')
  fs.rmSync(targetDir, { recursive: true, force: true })
  disabledSkills.delete(name)
  saveSkillsState()
  await initSkills()
  return { deleted: name }
}

export async function testSkillByName(skillName, context = {}) {
  await ensureSkillsLoaded()
  const name = String(skillName || '').trim()
  const skill = skillsCatalog.get(name)
  if (!skill) throw new Error(`Skill "${name}" tidak ditemukan.`)
  const t0 = Date.now()
  if (skill.isCustom) {
    const ok = Boolean(skill.instructions && skill.instructions.length > 10)
    return {
      ok,
      durationMs: Date.now() - t0,
      summary: ok
        ? `Plugin Claude SKILL.md valid (${skill.instructions.length} karakter instruksi${skill.triggers?.length ? `, triggers: ${skill.triggers.join(', ')}` : ''}).`
        : 'Instruksi SKILL.md kosong.'
    }
  }

  const SMOKE_MAP = {
    'code-analyzer': ['analyze_code_syntax', { code: 'const ok = 1 + 2;', language: 'javascript' }],
    'code-scratchpad': ['run_javascript_code', { code: 'return 21 * 2' }],
    'safe-calculator': ['calculate_expression', { expression: '(100 + 50) * 2' }],
    'workspace-files': ['list_workspace_files', { path: '.' }],
    'html-canvas-builder': ['validate_interactive_artifact', { html_content: '<!doctype html><html><head><title>OK</title></head><body><main><h1>OK</h1></main></body></html>' }],
    'self-improvement': ['list_self_improvements', {}],
    'ryukomik-expert': ['get_latest_comics', { limit: 1 }],
    'datetime-helper': ['get_current_time', { timezone: 'WIB' }],
    'task-planner': ['list_user_notes', {}],
    'task-scheduler': ['list_scheduled_tasks', {}],
    'api-tester': ['http_api_request', { method: 'GET', url: 'https://httpbin.org/get' }],
    'url-reader': ['read_url', { url: 'https://example.com/' }],
    'web-search': ['web_search', { query: 'Node.js', max_results: 1 }],
    'browser-agent': ['browse_page', { url: 'https://example.com/' }],
    'skill-health': ['run_skill_health_check', {}]
  }
  if (name === 'delegate-task') {
    return { ok: true, durationMs: Date.now() - t0, summary: 'Subagent orchestrator siap (max 4 subtask, 2 paralel, read-only terisolasi).' }
  }
  const spec = SMOKE_MAP[name]
  if (!spec) {
    return { ok: true, durationMs: Date.now() - t0, summary: `Terdaftar (${Array.from(toolsRegistry.values()).filter(t => t.skillName === name).length} tool).` }
  }
  const [toolName, args] = spec
  const res = await executeTool(toolName, args, { userId: context.userId || 'admin_skill_test', username: 'Admin' })
  return {
    ok: !res.error,
    durationMs: Date.now() - t0,
    tool: toolName,
    summary: res.error ? res.error : `OK via ${toolName} (${JSON.stringify(res.data).slice(0, 140)})`
  }
}
