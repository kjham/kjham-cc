/** 답변 끝의 결과 카드에서 읽은 것. */
export type Card = {
  /** ✅ 완료 · ⚠ 부분 완료 · ❌ 실패 */
  status: 'done' | 'partial' | 'failed'
  did?: string
  pending?: string
  decision?: string
  at: number
}

export type RunState = 'working' | 'waiting' | 'idle'

/** 한 세션이 $.store 의 `s:<sessionId>` 에 게시하는 상태. */
export type Rec = {
  sessionId: string
  cwd: string
  repo: string | null
  /** 워크트리에서 연 세션이면 그 폴더 이름 */
  worktree?: string
  branch: string | null
  surface: string
  state: RunState
  waitingFor?: string
  prompt?: string
  step?: string
  todos?: { done: number; total: number }
  subagents?: { running: number; waiting: number }
  ctxPct?: number
  card?: Card
  /** 턴이 끝난 뒤 그 세션에서 아직 아무것도 입력하지 않았다 */
  hasUnseen: boolean
  turnStartedAt?: number
  updatedAt: number
}

/** `claude agents --json` 한 줄에서 쓰는 것. */
export type AgentRow = {
  sessionId?: string
  name?: string
  cwd?: string
  kind?: string
  status?: string
  state?: string
}

/** 화면에 그리는 한 행: 게시한 세션이거나 mod 없이 목록에만 있는 세션. */
export type Row = {
  sessionId: string
  name: string
  isSelf: boolean
  isStale: boolean
  rec?: Rec
  agent?: AgentRow
}

declare module 'claude-code' {
  interface PluginState {
    fleet: {
      rows: Row[]
      /** 경과 시간 표시를 갱신하는 틱 */
      now: number
    }
  }
}
