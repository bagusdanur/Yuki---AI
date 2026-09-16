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
  status: 'queued' | 'planning' | 'running' | 'awaiting_approval' | 'resuming' | 'verifying' | 'done' | 'error' | 'cancelled'
  durationMs?: number
  skillName?: string
  skillTitle?: string
  approval?: { id: string; reason: string; status: 'pending' | 'approved' | 'rejected' }
  evidence?: Array<{ kind: string; value: unknown }>
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
  gesture?: string
  markdown?: string
  workflowState?: string
  truncated?: boolean
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
  gesture?: string
  markdown?: string
  workflowState?: string
  awaitingApproval?: { id: string; reason: string; status: string }
  evidence?: Array<{ kind: string; value: unknown }>
  truncated?: boolean
  artifacts?: ArtifactItem[]
  messageId?: number
  milestones?: Milestone[]
  comics?: ComicRecommendation[]
}

export interface AgentProgressResponse {
  requestId?: string
  steps: AgentStep[]
  done: boolean
  state: string
  result?: ChatResponse
  errorCode?: string
  cancelRequested?: boolean
}

export interface Session {
  userId: string
  username: string
  accessCode: string
  sessionToken: string
}

export interface AgendaTask {
  id: number
  title: string
  description: string
  human_schedule: string
  next_run_at_utc?: string
  last_run?: string
  status: 'active' | 'paused' | 'done' | 'failed' | 'cancelled'
  timezone: string
  run_once: number
}

export interface AgendaDelivery {
  id: string
  task_id: number
  title: string
  scheduled_for: string
  status: 'pending' | 'delivering' | 'retrying' | 'delivered' | 'failed'
  attempt_count: number
  last_error?: string
  delivered_at?: string
}

export interface AgendaResponse {
  timezone: string
  tasks: AgendaTask[]
  deliveries: AgendaDelivery[]
}
