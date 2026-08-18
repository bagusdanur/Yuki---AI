// lib/security.js — Yuki Enterprise Host & VPS Isolation Shield
// Mencegah segala bentuk SSRF, Sandbox Escape, Path Traversal, dan kebocoran credential VPS

import { isIP } from 'node:net'
import dns from 'node:dns/promises'

// Daftar port internal & layanan VPS yang DILARANG KERAS diakses AI/Tools
const FORBIDDEN_PORTS = new Set([
  22,    // SSH
  21,    // FTP
  23,    // Telnet
  25,    // SMTP
  3306,  // MySQL / MariaDB
  5432,  // PostgreSQL
  6379,  // Redis
  27017, // MongoDB
  9222,  // Chromium Remote Debugger
  18199, // AgentRouter Proxy Internal
  20128, // 9Router Proxy Internal
  3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010,
  3020, 3021, 3022, 3023, 3024, 3025, // Internal Apps & Yuki API
  8080, 8443, 8000, 9000 // Common internal gateways
])

// Cek apakah string IP termasuk private / loopback / cloud metadata
export function isPrivateOrReservedIP(ip) {
  if (!ip) return true

  // IPv4 Check
  const v4Parts = ip.split('.').map(Number)
  if (v4Parts.length === 4 && !v4Parts.some(isNaN)) {
    const [a, b] = v4Parts
    if (a === 127) return true // Loopback 127.0.0.0/8
    if (a === 10) return true // Private 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // Private 172.16.0.0/12
    if (a === 192 && b === 168) return true // Private 192.168.0.0/16
    if (a === 169 && b === 254) return true // Link-local & Cloud Metadata (AWS/DO/GCP) 169.254.0.0/16
    if (a === 0 || a >= 224) return true // 0.0.0.0/8 and Multicast/Reserved 224.0.0.0/4
    if (a === 100 && b >= 64 && b <= 127) return true // Carrier-grade NAT 100.64.0.0/10
  }

  // IPv6 Check
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc00:') || lower.startsWith('fd00:')) {
    return true
  }

  return false
}

// Validasi ketat untuk URL sebelum diakses oleh tool apapun (Browser, HTTP Tester, URL Reader)
export async function validateSafeOutboundUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, reason: 'URL tidak valid atau kosong.' }
  }

  let parsed
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { safe: false, reason: 'Format URL tidak valid.' }
  }

  // 1. Protokol WAJIB http: atau https:
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { safe: false, reason: `Protokol "${parsed.protocol}" dilarang demi keamanan server.` }
  }

  const hostname = parsed.hostname.toLowerCase()

  // 2. Blokir hostname loopback / internal nama
  const forbiddenHostnames = [
    'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
    'internal', 'local', 'corp', 'lan', 'home',
    'metadata.google.internal', 'instance-data'
  ]
  if (forbiddenHostnames.includes(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { safe: false, reason: 'Akses ke hostname lokal/internal VPS dilarang.' }
  }

  // 3. Cek Port
  if (parsed.port) {
    const portNum = Number(parsed.port)
    if (FORBIDDEN_PORTS.has(portNum)) {
      return { safe: false, reason: `Port internal :${portNum} dilarang diakses oleh AI.` }
    }
  }

  // 4. Cek Direct IP
  if (isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      return { safe: false, reason: 'Akses ke IP privat/lokal/metadata cloud dilarang.' }
    }
  } else {
    // 5. DNS Resolution untuk mencegah DNS Rebinding (pakai getaddrinfo)
    try {
      const addresses = await dns.lookup(hostname, { all: true })
      for (const entry of addresses) {
        if (isPrivateOrReservedIP(entry.address)) {
          return { safe: false, reason: `Hostname "${hostname}" mengarah ke IP privat (${entry.address}). Akses diblokir.` }
        }
      }
    } catch (dnsErr) {
      // Jika DNS gagal resolve (misal offline/NXDOMAIN), jangan izinkan agar tidak bypass
      return { safe: false, reason: `Hostname "${hostname}" tidak valid atau tidak dapat ditemukan di DNS.` }
    }
  }

  return { safe: true, cleanUrl: parsed.toString() }
}

// ===== ULTRA-HARDENED CODE EXECUTION CHECKER =====
// Memeriksa AST / pola teks sebelum kode dijalankan di VM Scratchpad
export function validateSafeCodeExecution(code = '') {
  if (!code || typeof code !== 'string') {
    return { safe: false, reason: 'Kode kosong.' }
  }

  // Kata kunci dan pola terlarang yang bisa menembus sandbox VPS
  const FORBIDDEN_PATTERNS = [
    /\bprocess\b/i,
    /\bchild_process\b/i,
    /\brequire\s*\(/i,
    /\bimport\s*\(/i,
    /\bimport\s+.*\s+from/i,
    /\bfs\b/i,
    /\bpath\b/i,
    /\bos\b/i,
    /\bnet\b/i,
    /\bhttp\b/i,
    /\bhttps\b/i,
    /\btls\b/i,
    /\bvm\b/i,
    /\bv8\b/i,
    /\bcluster\b/i,
    /\bglobalThis\b/i,
    /\bglobal\b/i,
    /\bwindow\b/i,
    /\bconstructor\s*\.\s*constructor\b/i,
    /\bFunction\s*\(/i,
    /\beval\s*\(/i,
    /\b__proto__\b/i,
    /\bprototype\b/i,
    /\bmainModule\b/i,
    /\bmodule\b/i,
    /\bexports\b/i,
    /\bfetch\s*\(/i,
    /\bXMLHttpRequest\b/i,
    /\bWebSocket\b/i,
    /\bBuffer\b/i
  ]

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return {
        safe: false,
        reason: `Kode mengandung instruksi berbahaya (${pattern.source}) yang dilarang dieksekusi.`
      }
    }
  }

  return { safe: true }
}

// ===== OUTPUT SANITIZER (Data Loss Prevention) =====
// Mencegah AI tanpa sengaja membocorkan ENV / API Key / Secret VPS ke user
export function sanitizeOutputSecrets(text = '') {
  if (!text || typeof text !== 'string') return text

  let sanitized = text

  // 1. Sensor kunci OpenAI / 9Router / Auth Secret jika ada
  const keysToMask = [
    process.env.AUTH_SECRET,
    process.env.ADMIN_TOKEN,
    process.env.ADMIN_PASSWORD,
    process.env.NINEROUTER_API_KEY,
    process.env.AGENTROUTER_API_KEY
  ].filter(k => k && k.length > 8)

  for (const secret of keysToMask) {
    sanitized = sanitized.replaceAll(secret, '[PROTECTED_SERVER_SECRET]')
  }

  // 2. Sensor path absolut server Linux/VPS
  sanitized = sanitized.replace(/\/home\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/g, '[server-path]')
  sanitized = sanitized.replace(/\/var\/www\/[a-zA-Z0-9_.-]+/g, '[server-path]')
  sanitized = sanitized.replace(/\/etc\/[a-zA-Z0-9_.-]+/g, '[system-path]')

  return sanitized
}
