import vm from 'node:vm'
import { validateSafeCodeExecution } from '../../../lib/security.js'

export async function executeRunJavascriptCode({ code }) {
  if (!code || typeof code !== 'string') {
    return { error: 'Kode JavaScript tidak boleh kosong.' }
  }

  // 🛡️ SECURITY CHECK: Blokir akses ke process, fs, child_process, network, require, import, constructor escape
  const secCheck = validateSafeCodeExecution(code)
  if (!secCheck.safe) {
    return {
      success: false,
      error: `[Keamanan Sandbox]: ${secCheck.reason}`
    }
  }

  const logs = []
  const customConsole = Object.freeze({
    log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    info: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    warn: (...args) => logs.push('[warn] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    error: (...args) => logs.push('[error] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  })

  // Sandbox bersih tanpa process, require, global, atau network
  const sandbox = Object.create(null)
  Object.assign(sandbox, {
    console: customConsole,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent
  })

  const context = vm.createContext(sandbox)

  try {
    const wrappedCode = `
      "use strict";
      (() => {
        ${code}
      })()
    `
    const script = new vm.Script(wrappedCode, { filename: 'yuki-isolated-scratchpad.js' })
    const result = script.runInContext(context, { timeout: 3000, breakOnSigint: true })

    return {
      success: true,
      result: result !== undefined ? (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)) : null,
      logs: logs.length > 0 ? logs.join('\n') : undefined,
      stdout: logs.join('\n'),
      stderr: '',
      exitCode: 0,
      timedOut: false,
      sandbox: 'node-vm',
      timeoutMs: 3000
    }
  } catch (err) {
    return {
      success: false,
      error: `Error saat eksekusi kode: ${err.message}`,
      logs: logs.length > 0 ? logs.join('\n') : undefined,
      stdout: logs.join('\n'),
      stderr: String(err.message || err),
      exitCode: 1,
      timedOut: /timed out/i.test(String(err.message || ''))
    }
  }

}

export default {
  run_javascript_code: executeRunJavascriptCode
}
