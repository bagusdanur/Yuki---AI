export type Role = 'user' | 'assistant'

export interface ComicRecommendation {
  title: string
  url: string
  format?: 'MANHWA' | 'MANGA' | 'MANHUA' | 'KOMIK' | string
  type?: string
  chapter?: string
  score?: string
  image?: string
  createdAt?: string
}

export type BookmarkedComic = ComicRecommendation

export interface Message {
  role: Role
  content: string
  comics?: ComicRecommendation[]
  messageId?: number
}

export interface Milestone {
  kind: string
  title: string
  detail?: string
  bondValue: number
  createdAt: string
}

export interface ChatResponse {
  reply: string
  model: string
  mood: string
  bond: string
  bondValue: number
  feeling: string
  messageId?: number
  milestones?: Milestone[]
  comics?: ComicRecommendation[]
}

export interface Session {
  userId: string
  username: string
  accessCode: string
  sessionToken: string
}
