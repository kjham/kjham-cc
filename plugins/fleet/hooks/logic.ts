import type { AgentRow, Card, Rec, Row } from '../types'

/** 이 시간 넘게 갱신이 없으면 흐리게 그린다. */
export const STALE_MS = 30_000
/** 이 시간 넘게 갱신이 없고 목록에도 없으면 지운다. */
export const GONE_MS = 3 * 60_000

export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** 워크트리면 그 폴더 이름, 원래 레포에서 연 세션이면 undefined. */
export function worktreeName(repoRoot: string | null, top: string | null): string | undefined {
  if (!repoRoot || !top) return undefined
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(repoRoot) === norm(top) ? undefined : basename(top)
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** 도구 호출을 "Edit register.tsx", "Bash git status" 같은 짧은 말로. */
export function describeStep(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const path = pick('file_path') ?? pick('notebook_path') ?? pick('path')
  const target = path
    ? basename(path)
    : (pick('command') ?? pick('pattern') ?? pick('url') ?? pick('description') ?? pick('query') ?? pick('skill') ?? '')
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(':') : tool
  return oneLine(target ? `${name} ${target}` : name, 60)
}

export function countTodos(todos: unknown): { done: number; total: number } | undefined {
  if (!Array.isArray(todos)) return undefined
  const done = todos.filter(t => (t as { status?: string })?.status === 'completed').length
  return { done, total: todos.length }
}

/** "부분 완료"가 완료로 읽히지 않도록 실패·부분을 먼저 본다. */
const STATUS: [RegExp, Card['status']][] = [
  [/❌|실패/, 'failed'],
  [/⚠|부분/, 'partial'],
  [/✅|완료/, 'done'],
]

/**
 * 답변 끝의 결과 카드를 읽는다. 형식:
 *   **결과** ✅ 완료
 *   - 한 일: ...
 *   - 남은 일: ...
 *   - 결정 필요: ...
 * 카드가 없으면 undefined.
 */
export function parseCard(answer: string, at: number): Card | undefined {
  const idx = answer.lastIndexOf('**결과**')
  if (idx < 0) return undefined
  const [head = '', ...lines] = answer.slice(idx).split(/\r?\n/)
  const status = STATUS.find(([re]) => re.test(head))?.[1] ?? 'done'
  const field = (label: string) => {
    const line = lines.find(l => l.replace(/^[\s>*-]+/, '').startsWith(label))
    if (!line) return undefined
    const value = line.slice(line.indexOf(label) + label.length).replace(/^\s*[:：]\s*/, '').trim()
    return value && !/^(없음|-|n\/a)$/i.test(value) ? oneLine(value, 120) : undefined
  }
  return { status, did: field('한 일'), pending: field('남은 일'), decision: field('결정 필요'), at }
}

/** 게시된 상태와 `claude agents` 목록을 합쳐 화면용 행으로. */
export function mergeRows(recs: readonly Rec[], agents: readonly AgentRow[], selfId: string, now: number): Row[] {
  const byId = new Map(agents.filter(a => a.sessionId).map(a => [a.sessionId!, a]))
  const rows: Row[] = recs.map(rec => {
    const agent = byId.get(rec.sessionId)
    return {
      sessionId: rec.sessionId,
      name: agent?.name || basename(rec.cwd),
      isSelf: rec.sessionId === selfId,
      isStale: now - rec.updatedAt > STALE_MS,
      rec,
      agent,
    }
  })
  const seen = new Set(recs.map(r => r.sessionId))
  for (const a of agents) {
    if (!a.sessionId || seen.has(a.sessionId)) continue
    rows.push({ sessionId: a.sessionId, name: a.name || basename(a.cwd ?? a.sessionId), isSelf: false, isStale: false, agent: a })
  }
  return rows.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name))
}

export type Kind = 'waiting' | 'decision' | 'working' | 'unseen' | 'idle'

/** 한 행이 지금 무엇인지. 결정 필요는 내 판단을 기다리므로 대기 다음으로 앞에 둔다. */
export function kindOf(row: Row): Kind {
  const rec = row.rec
  if (rec) {
    if (rec.state === 'waiting') return 'waiting'
    if (rec.state === 'working') return 'working'
    if (rec.hasUnseen && rec.card?.decision) return 'decision'
    if (rec.hasUnseen) return 'unseen'
    return 'idle'
  }
  const a = row.agent
  if (a?.state === 'blocked') return 'waiting'
  if (a?.state === 'working' || a?.status === 'busy') return 'working'
  return 'idle'
}

const ORDER: Kind[] = ['waiting', 'decision', 'working', 'unseen', 'idle']

function rank(row: Row): number {
  return ORDER.indexOf(kindOf(row))
}

export function counts(rows: readonly Row[]): Record<Kind, Row[]> {
  const out: Record<Kind, Row[]> = { waiting: [], decision: [], working: [], unseen: [], idle: [] }
  for (const r of rows) out[kindOf(r)].push(r)
  return out
}

/** 이번에 새로 대기로 들어온 세션. 이미 알린 것은 뺀다. */
export function newlyWaiting(rows: readonly Row[], notified: ReadonlySet<string>): Row[] {
  return rows.filter(r => !r.isSelf && kindOf(r) === 'waiting' && !notified.has(waitKey(r)))
}

export function waitKey(row: Row): string {
  return `${row.sessionId}:${row.rec?.waitingFor ?? row.agent?.state ?? ''}:${row.rec?.turnStartedAt ?? ''}`
}

export function elapsed(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${Math.floor(h / 24)}d`
}

/** `claude agents --json` 출력. 형식이 다르면 빈 목록. */
export function parseAgents(stdout: string): AgentRow[] {
  try {
    const list = JSON.parse(stdout) as unknown
    if (!Array.isArray(list)) return []
    return list.map(x => {
      const o = x as Record<string, unknown>
      const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
      return { sessionId: s('sessionId'), name: s('name'), cwd: s('cwd'), kind: s('kind'), status: s('status'), state: s('state') }
    })
  } catch {
    return []
  }
}
