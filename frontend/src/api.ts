import type { BookmarkedComic, ChatMode, ChatResponse, ComicRecommendation, Message, Milestone, SkillInfo } from './types'

async function parse<T>(response: Response): Promise<T> {
  const rawText = await response.text()
  let data: any
  try {
    data = rawText ? JSON.parse(rawText) : {}
  } catch {
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Sesi tidak valid atau telah berakhir. Muat ulang halaman untuk masuk kembali.')
      }
      if (response.status === 502 || response.status === 504) {
        throw new Error('Server sedang sibuk. Silakan coba kirim ulang beberapa saat lagi.')
      }
      throw new Error(`Permintaan gagal (${response.status}): ${response.statusText || 'Server Error'}`)
    }
    throw new Error('Format balasan server tidak dapat dibaca.')
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request gagal (${response.status})`)
  }
  return data as T
}

async function request<T>(url: string, init: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = localStorage.getItem('yuki_session_token_v3')
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return await parse<T>(await fetch(url, { ...init, headers, signal: controller.signal }))
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
  return request<{ userId: string; accessCode: string; sessionToken: string; welcome?: string; milestones?: Milestone[] }>('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
  })
}

export async function restore(accessCode: string) {
  return request<{ userId: string; username: string; sessionToken: string; history: Message[]; bondValue?: number; milestones?: Milestone[] }>('/api/login-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode }),
  })
}

export async function sendChat(userId: string, messages: Message[], isIdle = false, mode: ChatMode = 'companion') {
  return request<ChatResponse>('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, messages, isIdle, mode }),
  }, 125_000)
}

export async function getSkills() {
  return request<{ skills: SkillInfo[] }>('/api/agent/skills', { method: 'GET' })
}

export async function sendFeedback(userId: string, messageId: number | undefined, rating: 1 | -1) {
  return request<{ ok: true }>('/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, messageId, rating }),
  })
}

export async function getRelationship(userId: string) {
  return request<{ bond: string; bondValue: number; milestones: Milestone[] }>(`/api/relationship/${encodeURIComponent(userId)}`, { method: 'GET' })
}

export async function speak(text: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  try {
    const token = localStorage.getItem('yuki_session_token_v3') || ''
    const response = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text }), signal: controller.signal,
    })
    if (!response.ok) throw new Error('Suara Yuki sedang tidak tersedia')
    return URL.createObjectURL(await response.blob())
  } finally { window.clearTimeout(timeout) }
}

export async function getBookmarks() {
  return request<{ bookmarks: BookmarkedComic[] }>('/api/comics/bookmarks', { method: 'GET' })
}

export async function addBookmark(comic: ComicRecommendation) {
  return request<{ ok: true; bookmarks: BookmarkedComic[] }>('/api/comics/bookmarks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comic }),
  })
}

export async function removeBookmark(url: string) {
  return request<{ ok: true; bookmarks: BookmarkedComic[] }>(`/api/comics/bookmarks?url=${encodeURIComponent(url)}`, {
    method: 'DELETE',
  })
}

export async function deleteAccount() {
  return request<{ ok: true }>('/api/account', { method: 'DELETE' })
}
