export type Role = 'user' | 'assistant'
export type ChatMode = 'companion' | 'agent'

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

export interface ArtifactItem {
  id: string
  title: string
  type: 'html' | 'javascript' | 'svg' | string
  content: string
}

export interface AgentStep {
  id: string
  tool: string
  title: string
  input: any
  output?: any
  status: 'running' | 'done' | 'error'
  durationMs?: number
  skillName?: string
  skillTitle?: string
}

export interface SkillInfo {
  name: string
  title: string
  category: string
  description: string
  version: string
}

export interface Message {
  role: Role
  content: string
  mode?: ChatMode
  steps?: AgentStep[]
  thinking?: string
  artifacts?: ArtifactItem[]
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
  mode?: ChatMode
  steps?: AgentStep[]
  thinking?: string
  artifacts?: ArtifactItem[]
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
