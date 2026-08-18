// skills/computing/code-scratchpad/handler.js
import vm from 'node:vm'

export async function executeRunJavascriptCode({ code }) {
  if (!code || typeof code !== 'string') {
    return { error: 'Kode JavaScript tidak boleh kosong.' }
  }

  const logs = []
  const customConsole = {
    log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    info: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    warn: (...args) => logs.push('[warn] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    error: (...args) => logs.push('[error] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  }

  const sandbox = {
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
  }

  const context = vm.createContext(sandbox)

  try {
    // Bungkus jika ada return langsung atau blok ekspresi
    const wrappedCode = `
      (() => {
        try {
          ${code.includes('return') ? code : `return (${code});`}
        } catch (e) {
          ${code}
        }
      })()
    `
    const script = new vm.Script(wrappedCode)
    const result = script.runInContext(context, { timeout: 3000 })

    return {
      success: true,
      result: result !== undefined ? (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)) : null,
      logs: logs.length > 0 ? logs.join('\n') : undefined
    }
  } catch (err) {
    return {
      success: false,
      error: `Error saat eksekusi kode: ${err.message}`,
      logs: logs.length > 0 ? logs.join('\n') : undefined
    }
  }
}

export default {
  run_javascript_code: executeRunJavascriptCode
}
