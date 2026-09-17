import 'dotenv/config'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

// Jalankan backup harian via cron. Setiap backup baru dibuat, backup lama
// di atas batas retensi langsung dihapus (default: simpan 3 hari terakhir).
const source = path.resolve(process.env.MEMORY_DB || './data/yuki.db')
const directory = path.resolve(process.env.BACKUP_DIR || './data/backups')
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 3))
const retentionCount = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT || retentionDays))

mkdirSync(directory, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const target = path.join(directory, `yuki-${stamp}.sqlite`)
if (!target.startsWith(directory + path.sep)) throw new Error('Target backup tidak aman')

const db = new DatabaseSync(source)
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
db.close()

// --- Pembersihan: hapus backup lama berdasarkan umur DAN jumlah ------------
const cutoff = Date.now() - retentionDays * 86400_000
const backups = readdirSync(directory)
  .filter(name => /^yuki-[\dT-]+Z\.sqlite$/.test(name))
  .map(name => {
    const file = path.join(directory, name)
    return { name, file, mtimeMs: statSync(file).mtimeMs }
  })
  .sort((a, b) => b.mtimeMs - a.mtimeMs)   // terbaru dulu

const removed = []
backups.forEach((item, index) => {
  const tooOld = item.mtimeMs < cutoff
  const tooMany = index >= retentionCount
  if (!tooOld && !tooMany) return
  try {
    unlinkSync(item.file)
    removed.push(`${item.name} (${tooOld ? 'kedaluwarsa' : 'melebihi batas'})`)
  } catch (error) {
    console.error(`[backup] gagal menghapus ${item.name}: ${error.message}`)
  }
})

const kept = backups.filter(item => !removed.some(name => name.startsWith(item.name)))
console.log(`Backup selesai: ${target}`)
console.log(`Retensi: ${retentionDays} hari / maks ${retentionCount} file`)
if (removed.length) console.log(`Dihapus ${removed.length} backup lama:\n  - ${removed.join('\n  - ')}`)
console.log(`Tersisa ${kept.length} backup: ${kept.map(item => item.name).join(', ') || '(tidak ada)'}`)
