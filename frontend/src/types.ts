export type Role = 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

export interface ChatResponse {
  reply: string
  model: string
  mood: string
  bond: string
  bondValue: number
  feeling: string
}

export interface Session {
  userId: string
  username: string
  accessCode: string
}
