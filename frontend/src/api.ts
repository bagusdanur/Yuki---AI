import type { ChatResponse, Message } from './types'

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`)
  return data as T
}

async function request<T>(url: string, init: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await parse<T>(await fetch(url, { ...init, signal: controller.signal }))
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('Permintaan terlalu lama. Coba kirim ulang sebentar lagi.')
    }
    throw cause
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function register(username: string) {
  return request<{ userId: string; accessCode: string; welcome?: string }>('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
  })
}

export async function restore(accessCode: string) {
  return request<{ userId: string; username: string; history: Message[]; bondValue?: number }>('/api/login-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode }),
  })
}

export async function sendChat(userId: string, messages: Message[]) {
  return request<ChatResponse>('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, messages }),
  }, 125_000)
}

export async function speak(text: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: controller.signal,
    })
    if (!response.ok) throw new Error('Suara Yuki sedang tidak tersedia')
    return URL.createObjectURL(await response.blob())
  } finally { window.clearTimeout(timeout) }
}
