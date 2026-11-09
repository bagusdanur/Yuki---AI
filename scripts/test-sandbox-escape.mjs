// Bukti escape node:vm (audit Nov 2026) sudah tertutup child-process sandbox.
import assert from 'node:assert'
import { executeRunJavascriptCode } from '../skills/computing/code-scratchpad/handler.js'

const ok = await executeRunJavascriptCode({ code: "console.log('halo'); return 1 + 2" })
assert(ok.success === true, 'kode normal harus sukses: ' + JSON.stringify(ok))
assert(ok.result === 3, 'result harus 3, dapat: ' + ok.result)
assert(ok.stdout.includes('halo'), 'stdout harus memuat halo')

// Escape klasik: .constructor -> process host. Di child process, process
// yang terlihat adalah milik child (env kosong, tanpa AUTH_SECRET).
const esc = await executeRunJavascriptCode({
  code: "const pid = console.log.constructor('return process.pid')(); console.log('PID:' + pid); console.log('SECRET:' + (process.env.AUTH_SECRET || 'NONE'))"
})
const outAll = String(esc.stdout || '') + String(esc.logs || '') + String(esc.result ?? '')
const blocked = esc.success === false && /Keamanan Sandbox/.test(String(esc.error || ''))
if (!blocked) {
  assert(!outAll.includes(String(process.pid)), 'PID host tidak boleh bocor: ' + outAll)
  assert(!process.env.AUTH_SECRET || !outAll.includes(process.env.AUTH_SECRET), 'AUTH_SECRET tidak boleh bocor')
  assert(outAll.includes('SECRET:NONE'), 'env child harus kosong: ' + outAll)
} else {
  console.log('  (escape ditolak blocklist statis — defense-in-depth aktif)')
}

// Baca file server harus gagal (node:fs tanpa izin).
const fsTry = await executeRunJavascriptCode({
  code: "import * as fs from 'node:fs'; console.log(fs.readFileSync('/home/ryukomik/Yuki---AI/.env', 'utf8').slice(0, 10))"
})
assert(fsTry.success === false, 'baca .env harus gagal: ' + JSON.stringify(fsTry))

console.log('ALL PASS (sandbox-escape tertutup)')
process.exit(0)
