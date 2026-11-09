import { validateSafeCodeExecution } from '../../../lib/security.js'
import { runSandboxedNodeSnippet } from '../../../lib/agent/sandbox-runner.js'

export async function executeRunJavascriptCode({ code }) {
  if (!code || typeof code !== 'string') {
    return { error: 'Kode JavaScript tidak boleh kosong.' }
  }
  if (code.length > 8000) {
    return { success: false, error: '[Keamanan Sandbox]: kode terlalu panjang (maks 8000 karakter).' }
  }

  // Defense-in-depth: blocklist statis tetap dipakai untuk menolak pola
  // paling jelas, tapi BOUNDARY resminya adalah child process terisolasi
  // (node --permission, tanpa fs/child_process/network, env kosong).
  // Audit Nov 2026: vm in-process bisa di-escape via .constructor.
  const secCheck = validateSafeCodeExecution(code)
  if (!secCheck.safe) {
    return {
      success: false,
      error: `[Keamanan Sandbox]: ${secCheck.reason}`
    }
  }

  let run
  try {
    run = await runSandboxedNodeSnippet({ code })
  } catch (err) {
    return { success: false, error: `Error saat eksekusi kode: ${err.message}` }
  } finally {
    try { run?.cleanup?.() } catch {}
  }

  const marker = '\n__YUKI_RESULT__'
  let stdout = String(run?.stdout || '')
  let result = null
  const idx = stdout.lastIndexOf(marker)
  if (idx >= 0) {
    const payload = stdout.slice(idx + marker.length).trim()
    stdout = stdout.slice(0, idx)
    try { result = JSON.parse(payload) } catch { result = payload || null }
  }

  if (run?.timedOut) {
    return { success: false, error: 'Error saat eksekusi kode: eksekusi melebihi batas 5 detik.', logs: stdout || undefined, stdout, stderr: String(run?.stderr || ''), exitCode: 1, timedOut: true, sandbox: 'child-process', timeoutMs: 5000 }
  }
  if (run?.code !== 0) {
    const errText = String(run?.stderr || '').trim() || `proses keluar dengan kode ${run?.code}`
    return { success: false, error: `Error saat eksekusi kode: ${errText.slice(0, 500)}`, logs: stdout || undefined, stdout, stderr: String(run?.stderr || ''), exitCode: run?.code ?? 1, timedOut: false, sandbox: 'child-process', timeoutMs: 5000 }
  }

  return {
    success: true,
    result,
    logs: stdout ? stdout : undefined,
    stdout,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    sandbox: 'child-process',
    timeoutMs: 5000
  }
}

export default { run_javascript_code: executeRunJavascriptCode }
