/** 한 사용률 창(5시간·주간)의 마지막 측정값. */
export type Window = {
  kind: string
  percentUsed: number
  /** 초기화 시각, `$.clock.now()` 기준 밀리초. 모르면 null. */
  resetsAtMs: number | null
}

/** 모든 세션 중 가장 최근에 받은 한도 값. */
export type Limits = {
  windows: Window[]
  /** 측정 시각 */
  at: number
}

/** 창별 관측 이력: [시각, 사용률] */
export type History = Record<string, { resetsAtMs: number | null; samples: [number, number][] }>

export type Projection = {
  kind: string
  /** 지금 속도로 100%에 닿는 시각 */
  etaMs: number
  isBeforeReset: boolean
}

export type Ctx = {
  tokens?: number
  window: number
  percent?: number
  /** auto-compact 가 도는 토큰 수 */
  threshold?: number
  isAutoCompactEnabled: boolean
}

export type Cost = { usd: number; startedAt: number }

/** status.claude.com 의 전체 상태. */
export type Outage = {
  /** none · minor · major · critical · maintenance, 조회 실패면 unknown */
  indicator: string
  description: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': {
      limits: Limits | null
      projections: Projection[]
      ctx: Ctx | null
      cost: Cost | null
      outage: Outage | null
      /** 남은 시간 표시를 갱신하는 1분 틱 */
      now: number
    }
  }
}
