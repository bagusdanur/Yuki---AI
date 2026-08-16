export type Role = 'user' | 'assistant'

export interface ComicRecommendation {
  title: string
  url: string
  type?: string
  chapter?: string
  score?: string
  image?: string
}

export interface Message {
  role: Role
  content: string
  comics?: ComicRecommendation[]
}

export interface ChatResponse {
  reply: string
  model: string
  mood: string
  bond: string
  bondValue: number
  feeling: string
  comics?: ComicRecommendation[]
}

export interface Session {
  userId: string
  username: string
  accessCode: string
}
