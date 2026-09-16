import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_LIMITS = Object.freeze({ timeoutMs: 10_000, outputBytes: 16_000, memoryMb: 256, virtualMemoryMb: 2048, cpuSeconds: 8, fileBytes: 1_048_576 })
const NETWORK_BUILTINS = ['node:net', 'net', 'node:http', 'http', 'node:https', 'https', 'node:http2', 'http2', 'node:dgram', 'dgram', 'node:dns', 'dns', 'node:tls', 'tls']

function preloadSource() {
  return `import { registerHooks } from 'node:module';
const denied = new Set(${JSON.stringify(NETWORK_BUILTINS)});
registerHooks({ resolve(specifier, context, nextResolve) { if (denied.has(specifier)) throw new Error('SANDBOX_NETWORK_DENIED'); return nextResolve(specifier, context); } });
const deny = () => { throw new Error('SANDBOX_NETWORK_DENIED'); };
Object.defineProperty(globalThis, 'fetch', { value: deny, configurable: false, writable: false });
if ('WebSocket' in globalThis) Object.defineProperty(globalThis, 'WebSocket', { value: class { constructor() { deny(); } }, configurable: false, writable: false });
if (process.getBuiltinModule) Object.defineProperty(process, 'getBuiltinModule', { value(name) { if (denied.has(name) || denied.has('node:' + name)) deny(); throw new Error('SANDBOX_BUILTIN_ACCESS_DENIED'); }, configurable: false, writable: false });`
}

export function sandboxPolicy(limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits }
  return {
    ...merged,
    network: false, childProcess: false, workers: false, addons: false,
    writableFilesystem: false, environmentAllowlist: ['LANG', 'TZ'], shell: false
  }
}

export async function runSandboxedNodeTest({ entry, workspaceRoot, limits = {} }) {
  const policy = sandboxPolicy(limits)
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(entry)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('SANDBOX_ENTRY_OUTSIDE_WORKSPACE')

  const nodeArgs = [
    '--permission', '--no-addons', `--max-old-space-size=${policy.memoryMb}`,
    `--allow-fs-read=${root}`, `--import=data:text/javascript,${encodeURIComponent(preloadSource())}`, target
  ]
  let command = process.execPath
  let args = nodeArgs
  let resourceLimits = 'node-runtime'
  if (process.platform === 'linux' && existsSync('/usr/bin/prlimit')) {
    command = '/usr/bin/prlimit'
    // RLIMIT_NPROC is counted per OS user, not per sandboxed task. Applying a
    // small value here can stop Node from creating its own runtime threads on
    // shared hosts/CI. Child processes and workers are denied by Node's
    // permission model; prlimit remains responsible for resource ceilings.
    args = [`--as=${policy.virtualMemoryMb * 1024 * 1024}`, `--cpu=${policy.cpuSeconds}`, `--fsize=${policy.fileBytes}`, '--', process.execPath, ...nodeArgs]
    resourceLimits = 'linux-prlimit+node-runtime'
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root, env: { LANG: 'C.UTF-8', TZ: 'UTC' }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32'
    })
    let stdout = ''; let stderr = ''; let outputBytes = 0; let timedOut = false; let outputTruncated = false
    const collect = (chunk, stream) => {
      const buffer = Buffer.from(chunk)
      const remaining = Math.max(0, policy.outputBytes - outputBytes)
      outputBytes += Math.min(buffer.length, remaining)
      if (buffer.length > remaining) outputTruncated = true
      const text = buffer.subarray(0, remaining).toString()
      if (stream === 'stdout') stdout += text
      else stderr += text
      if (outputTruncated) {
        try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }
    child.stdout.on('data', chunk => collect(chunk, 'stdout'))
    child.stderr.on('data', chunk => collect(chunk, 'stderr'))
    child.on('error', reject)
    const timer = setTimeout(() => {
      timedOut = true
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }, policy.timeoutMs)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, outputTruncated, sandbox: resourceLimits, policy })
    })
  })
}
