import type { AgendaResponse, AgentMemory, AgentProgressResponse, BookmarkedComic, ChatMode, ChatResponse, ComicRecommendation, DynamicSkill, Message, Milestone, PlainMemory, SkillInfo } from './types'

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

async function request<T>(url: string, init: RequestInit, timeoutMs = 30_000, retries = 1): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = localStorage.getItem('yuki_session_token_v3')
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return await parse<T>(await fetch(url, { ...init, headers, signal: controller.signal }))
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('Permintaan membutuhkan waktu lebih lama. Silakan coba kirim ulang.')
    }
    // Auto-retry sekali jika koneksi terputus sesaat (misal saat server reload)
    if (retries > 0 && !(cause instanceof DOMException && cause.name === 'AbortError')) {
      await new Promise(r => setTimeout(r, 1500))
      return request<T>(url, init, timeoutMs, retries - 1)
    }
    if (cause instanceof TypeError && String(cause.message).includes('Failed to fetch')) {
      throw new Error('Koneksi ke server terputus sesaat. Coba kirim ulang pesanmu ya.')
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

export async function sendChat(userId: string, messages: Message[], isIdle = false, mode: ChatMode = 'companion', requestId = '') {
  const body = buildChatBody(userId, messages, isIdle, mode, requestId)
  return request<ChatResponse>('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, 150_000)
}

function buildChatBody(userId: string, messages: Message[], isIdle: boolean, mode: ChatMode, requestId: string) {
  // Padatkan pesan-pesan lampau agar payload ringan dan tidak overload
  const recentMessages = messages.slice(-30)
  const sanitizedMessages = recentMessages.map((m, idx) => {
    let content = m.content || ''
    // Jangan potong pesan terakhir dari user
    if (idx === recentMessages.length - 1 && m.role === 'user') {
      return { role: m.role, content }
    }
    // Ringkas lampiran kode artifact HTML raksasa dari pesan lama
    if (m.role === 'assistant' && (content.includes('<!DOCTYPE html') || content.includes('<html'))) {
      content = content.replace(/```(?:html|xml)?\s*\n\s*(?:<!DOCTYPE|<html)[\s\S]*?(?:```|$)/gi, '[Lampiran Aplikasi Visual]')
    }
    if (m.role === 'assistant' && content.length > 2500) {
      content = content.slice(0, 2500) + '... [bagian teks panjang dipadatkan]'
    }
    return { role: m.role, content }
  })

  const surface = new URLSearchParams(window.location.search).get('embed') === '1' ? 'embed' : 'app'
  return { userId, messages: sanitizedMessages, isIdle, mode, requestId, surface }
}

/**
 * Kirim chat dengan mode streaming (SSE). `onDelta` dipanggil tiap potongan teks untuk
 * tampilan realtime; nilai yang di-return adalah payload FINAL dari server (setelah semua
 * guard) — itulah yang harus disimpan sebagai pesan resmi.
 */
export async function sendChatStream(
  userId: string, messages: Message[], mode: ChatMode = 'companion',
  onDelta: (text: string) => void, signal?: AbortSignal
): Promise<ChatResponse> {
  const token = localStorage.getItem('yuki_session_token_v3')
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...buildChatBody(userId, messages, false, mode, ''), stream: true }),
    signal
  })
  if (!response.ok || !response.body) {
    // Fallback: server tidak mendukung streaming / error sebelum alir → pakai jalur biasa.
    return sendChat(userId, messages, false, mode)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: ChatResponse | null = null
  let streamError = ''

  const handleEvent = (raw: string) => {
    const lines = raw.split('\n')
    let event = 'message'
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (!dataLines.length) return
    let payload: any
    try { payload = JSON.parse(dataLines.join('\n')) } catch { return }
    if (event === 'delta' && typeof payload?.text === 'string') onDelta(payload.text)
    else if (event === 'done') final = payload as ChatResponse
    else if (event === 'error') streamError = String(payload?.error || 'Stream gagal')
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      handleEvent(raw)
    }
  }
  if (buffer.trim()) handleEvent(buffer)
  if (streamError) throw new Error(streamError)
  if (!final) throw new Error('Stream selesai tanpa balasan final.')
  return final
}

export async function getAgentProgress(requestId: string) {
  return request<AgentProgressResponse>(`/api/agent/progress/${encodeURIComponent(requestId)}`, { method: 'GET' }, 10_000, 0)
}

export async function getActiveAgentRun() {
  return request<{ run: AgentProgressResponse | null }>('/api/agent/runs/active', { method: 'GET' }, 10_000, 0)
}

export async function cancelAgentRun(requestId: string) {
  return request<{ success: true; run: AgentProgressResponse }>(`/api/agent/runs/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' }, 10_000, 0)
}

export async function decideAgentApproval(approvalId: string, decision: 'approve' | 'reject') {
  return request<ChatResponse & { success: true; status: 'approved' | 'rejected'; state?: string; workflowId?: string; duplicate?: boolean }>(`/api/agent/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision })
  }, 30_000, 0)
}

export async function getPendingAgentWorkflows() {
  return request<{ workflows: Array<{ id: string; requestId: string; state: string; toolName: string; reason: string; stepId: string; createdAt: string; expiresAt: string }> }>('/api/agent/workflows/pending', { method: 'GET' }, 10_000, 0)
}

export async function getScheduledReminders(afterId = 0) {
  return request<{ reminders: Message[] }>(`/api/chat/reminders?after=${Math.max(0, afterId)}`, { method: 'GET' }, 10_000, 0)
}

/** Riwayat obrolan lengkap (berpaging). `before` = id pesan tertua yang sudah dimuat. */
export async function getChatHistoryPage(before = 0, limit = 60) {
  return request<{ messages: Message[]; total: number; hasMore: boolean }>(
    `/api/chat/history?before=${Math.max(0, before)}&limit=${Math.max(1, limit)}`, { method: 'GET' }, 15_000, 0
  )
}

/** Cari pesan di seluruh riwayat obrolan. */
export async function searchChatHistory(query: string, limit = 60) {
  return request<{ messages: Message[]; total: number; hasMore: boolean }>(
    `/api/chat/history?q=${encodeURIComponent(query)}&limit=${Math.max(1, limit)}`, { method: 'GET' }, 15_000, 0
  )
}

export async function getAgenda() {
  return request<AgendaResponse>('/api/agenda', { method: 'GET' }, 10_000, 0)
}

export async function updateAgendaTask(taskId: number, body: Record<string, unknown>) {
  return request<{ success: true }>(`/api/agenda/${taskId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, 10_000, 0)
}

export async function getPushConfig() {
  return request<{ enabled: boolean; publicKey: string }>('/api/push/config', { method: 'GET' }, 10_000, 0)
}

export async function savePushSubscription(subscription: PushSubscriptionJSON) {
  return request<{ success: true }>('/api/push/subscriptions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription })
  }, 10_000, 0)
}

export async function getMemories(scopeType = '') {
  return request<{ memories: AgentMemory[]; settings: { autoCapture: boolean }; facts: PlainMemory[]; structured: PlainMemory[] }>(`/api/memories${scopeType ? `?scopeType=${encodeURIComponent(scopeType)}` : ''}`, { method: 'GET' }, 10_000, 0)
}
export async function setMemoryAutoCapture(autoCapture: boolean) {
  return request<{ settings: { autoCapture: boolean } }>('/api/memories/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoCapture }) }, 10_000, 0)
}
export async function updateMemory(id: number, body: Record<string, unknown>) {
  return request<{ success: true; memory: AgentMemory }>(`/api/memories/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10_000, 0)
}
export async function deleteMemory(id: number) {
  return request<{ success: true }>(`/api/memories/${id}`, { method: 'DELETE' }, 10_000, 0)
}
export async function deletePlainMemory(source: 'fact' | 'structured', id: number) {
  return request<{ success: true }>(`/api/memories/${source}/${id}`, { method: 'DELETE' }, 10_000, 0)
}
export async function getDynamicSkills() {
  return request<{ skills: DynamicSkill[] }>('/api/agent/dynamic-skills', { method: 'GET' }, 10_000, 0)
}
export async function createDynamicSkill(body: Record<string, unknown>) {
  return request<{ success: true; skill: DynamicSkill }>('/api/agent/dynamic-skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10_000, 0)
}
export async function dynamicSkillAction(id: string, action: 'validate' | 'approve' | 'disable') {
  return request<{ success: true; skill?: DynamicSkill }>(`/api/agent/dynamic-skills/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, 10_000, 0)
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
