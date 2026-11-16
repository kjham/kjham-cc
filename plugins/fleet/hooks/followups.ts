import type { Card, Followup, Rec } from '../types'

export function captureFollowup(rec: Rec, card: Card | undefined, name: string, previous?: Followup): Followup | undefined {
  if (!card || (!card.pending && !card.decision)) return undefined
  const id = `${rec.sessionId}-${card.at.toString(36)}`
  if (previous?.id === id) return previous
  return {
    id, sessionId: rec.sessionId, sessionName: name,
    location: [rec.worktree ?? rec.repo ?? rec.cwd, rec.branch].filter(Boolean).join(' · '),
    did: card.did, pending: card.pending, decision: card.decision,
    status: 'open', createdAt: card.at, updatedAt: card.at,
  }
}

export function changeFollowup(item: Followup, status: Followup['status'], now: number): Followup {
  return { ...item, status, updatedAt: now }
}

export function selectFollowup(items: readonly Followup[], id: string): Followup | undefined {
  const exact = items.find(item => item.id === id)
  if (exact) return exact
  const matches = id ? items.filter(item => item.id.startsWith(id)) : []
  return matches.length === 1 ? matches[0] : undefined
}

export function visibleFollowups(items: readonly Followup[], now: number): Followup[] {
  const order = { open: 0, deferred: 1, done: 2 }
  return items.filter(item => item.status !== 'done' || now - item.updatedAt < 86_400_000)
    .sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt)
}

/** 완료된 기록도 명령으로 다시 열 수 있도록 저장소에서는 지우지 않는다. */
export function isFollowup(value: unknown): value is Followup {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.sessionId === 'string' && typeof v.sessionName === 'string'
    && typeof v.location === 'string' && typeof v.createdAt === 'number' && typeof v.updatedAt === 'number'
    && ['open', 'deferred', 'done'].includes(String(v.status))
    && ['did', 'pending', 'decision'].every(k => v[k] === undefined || typeof v[k] === 'string')
}
