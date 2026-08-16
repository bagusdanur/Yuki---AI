import type { ChatResponse, Message } from './types'

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`)
  return data as T
}

export async function register(username: string) {
  return parse<{ userId: string; accessCode: string }>(await fetch('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
  }))
}

export async function restore(accessCode: string) {
  return parse<{ userId: string; username: string; history: Message[] }>(await fetch('/api/login-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode }),
  }))
}

export async function sendChat(userId: string, messages: Message[]) {
  return parse<ChatResponse>(await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, messages }),
  }))
}

export async function speak(text: string) {
  const response = await fetch('/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })
  if (!response.ok) throw new Error('Suara Yuki sedang tidak tersedia')
  return URL.createObjectURL(await response.blob())
}
