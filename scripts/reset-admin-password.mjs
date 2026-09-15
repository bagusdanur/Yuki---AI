import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

let password = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) password += chunk
password = password.replace(/[\r\n]+$/, '')

if (password.length < 10 || password.length > 128) {
  throw new Error('Password harus 10-128 karakter.')
}

const target = path.resolve(process.env.ADMIN_PASSWORD_FILE || '.runtime-secrets/admin-password.json')
const temporary = `${target}.tmp`
const salt = crypto.randomBytes(16).toString('hex')
const hash = crypto.scryptSync(password, salt, 64).toString('hex')

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(temporary, JSON.stringify({ salt, hash }), { mode: 0o600 })
fs.renameSync(temporary, target)
fs.chmodSync(target, 0o600)

const candidate = crypto.scryptSync(password, salt, 64).toString('hex')
if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate))) {
  throw new Error('Verifikasi hash gagal.')
}

console.log(`RESET_OK MODE=${(fs.statSync(target).mode & 0o777).toString(8)}`)
