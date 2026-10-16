import type { SessionRateLimit } from 'claude-code'

import type { Ctx, History, Projection, Window } from '../types'

export const LABEL: Record<string, string> = { five_hour: '5시간', seven_day: '주간' }
/** 높은 문턱부터 본다. 한 번에 둘 다 넘으면 높은 쪽만 알린다. */
export const THRESHOLDS = [95, 80] as const
/** 소진 예측에 쓰는 최소 관측 구간. 이보다 짧으면 기울기가 튄다. */
const MIN_SPAN_MS = 10 * 60 * 1000
const MAX_SAMPLES = 60

export function toWindows(limits: readonly SessionRateLimit[]): Window[] {
  return limits
    .filter(l => l.kind in LABEL)
    .map(l => {
      const parsed = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      return { kind: l.kind, percentUsed: l.percentUsed, resetsAtMs: Number.isFinite(parsed) ? parsed : null }
    })
}

/** 3일 4시간, 2시간 10분, 12분. */
export function remaining(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}일 ${hours}시간`
  if (hours > 0) return `${hours}시간 ${mins}분`
  return `${mins}분`
}

/** 312K, 1.2M */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

/** 06:04, 오늘이 아니면 10/18 06:04 */
export function clock(ms: number, now: number): string {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 새로 넘은 문턱: 창마다 가장 높은 것 하나. 이미 알린 것은 뺀다. */
export function crossings(windows: readonly Window[], alerted: readonly string[]) {
  const found: { key: string; window: Window; threshold: number }[] = []
  for (const w of windows) {
    const threshold = THRESHOLDS.find(t => w.percentUsed >= t)
    if (threshold === undefined) continue
    const key = `${w.kind}:${w.resetsAtMs ?? '?'}:${threshold}`
    if (!alerted.includes(key)) found.push({ key, window: w, threshold })
  }
  return found
}

/** 창별 관측 이력에 한 점을 더한다. 초기화 시각이 바뀌면 새 창이므로 비운다. */
export function record(history: History, windows: readonly Window[], now: number): History {
  const next: History = { ...history }
  for (const w of windows) {
    const prev = next[w.kind]
    const samples = prev && prev.resetsAtMs === w.resetsAtMs ? prev.samples : []
    const last = samples[samples.length - 1]
    if (last && last[1] === w.percentUsed) continue
    next[w.kind] = { resetsAtMs: w.resetsAtMs, samples: [...samples, [now, w.percentUsed] as [number, number]].slice(-MAX_SAMPLES) }
  }
  return next
}

/**
 * 지금 속도로 100%에 닿는 시각. 관측 구간이 짧거나 줄어드는 중이면 모른다.
 * 초기화보다 늦으면 `isBeforeReset` 이 false 다.
 */
export function project(history: History, kind: string): Projection | null {
  const h = history[kind]
  if (!h || h.samples.length < 2) return null
  const [t0, p0] = h.samples[0]!
  const [t1, p1] = h.samples[h.samples.length - 1]!
  if (t1 - t0 < MIN_SPAN_MS || p1 <= p0) return null
  const etaMs = t1 + ((100 - p1) * (t1 - t0)) / (p1 - p0)
  return { kind, etaMs, isBeforeReset: h.resetsAtMs === null || etaMs < h.resetsAtMs }
}

/** compact 까지 남은 토큰과 그 기준 대비 사용률. 기준을 모르면 null. */
export function compactLeft(ctx: Ctx): { left: number; usedPct: number } | null {
  if (!ctx.isAutoCompactEnabled || ctx.threshold === undefined || ctx.tokens === undefined) return null
  return {
    left: Math.max(0, ctx.threshold - ctx.tokens),
    usedPct: Math.min(100, Math.round((ctx.tokens / ctx.threshold) * 100)),
  }
}

export function level(percent: number): 'error' | 'warning' | 'subtle' {
  if (percent >= 95) return 'error'
  if (percent >= 80) return 'warning'
  return 'subtle'
}
