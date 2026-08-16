import 'dotenv/config'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const source = path.resolve(process.env.MEMORY_DB || './data/yuki.db')
const directory = path.resolve(process.env.BACKUP_DIR || './data/backups')
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 14))
mkdirSync(directory, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const target = path.join(directory, `yuki-${stamp}.sqlite`)
if (!target.startsWith(directory + path.sep)) throw new Error('Target backup tidak aman')
const db = new DatabaseSync(source)
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
db.close()
const cutoff = Date.now() - retentionDays * 86400_000
for (const name of readdirSync(directory)) {
  if (!/^yuki-[\dT-]+Z\.sqlite$/.test(name)) continue
  const file = path.join(directory, name)
  if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
}
console.log(`Backup selesai: ${target}`)
