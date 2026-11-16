import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Followup, Rec, Row } from '../types'
import { captureFollowup, changeFollowup, isFollowup, selectFollowup, visibleFollowups } from './followups'
import {
  GONE_MS,
  basename,
  counts,
  countTodos,
  describeStep,
  elapsed,
  kindOf,
  mergeRows,
  newlyWaiting,
  oneLine,
  worktreeName,
  parseAgents,
  parseCard,
  waitKey,
} from './logic'

const rowsAtom = atom({ plugin: 'fleet', key: 'rows' } as const, [] as Row[])
const nowAtom = atom({ plugin: 'fleet', key: 'now' } as const, 0)
const followupsAtom = atom({ plugin: 'fleet', key: 'followups' } as const, [] as Followup[])

const PANE = 'fleet'
const POLL_MS = 4000
const HEARTBEAT_MS = 10_000
const WRITE_DELAY_MS = 1500
const LEADER_TTL_MS = 15_000
const AGENTS_EVERY_MS = 20_000

/*
 * 세션마다 자기 상태를 $.store 의 `s:<sessionId>` 에 쓰고, 4초마다 전부 읽어 그린다.
 * 키를 세션별로 나눠 쓰기 충돌을 피한다. `claude agents --json` 조회·청소는 리더 한 세션만 한다.
 */
/** 이 세션의 게시 상태. 모듈 변수라 다시 불러오면 session.start 가 새로 채운다. */
const S = {
  me: '',
  rec: null as Rec | null,
  pending: null as ReturnType<EngineInterface['clock']['after']> | null,
  lastAgentsAt: 0,
  notified: new Set<string>(),
}

async function flush($: EngineInterface) {
  S.pending = null
  if (!S.rec) return
  S.rec = { ...S.rec, updatedAt: await $.clock.now() }
  await $.store.set(`s:${S.me}`, S.rec)
}

/** 도구 호출마다 쓰지 않도록 1.5초 모아서 쓴다. */
async function patch($: EngineInterface, change: Partial<Rec>, isUrgent = false) {
  if (!S.rec) return
  S.rec = { ...S.rec, ...change }
  if (isUrgent) {
    S.pending?.cancel()
    await flush($)
    await poll($, false)
  } else if (!S.pending) {
    S.pending = $.clock.after(WRITE_DELAY_MS, () => void flush($).catch(() => undefined))
  }
}

/** 작업 트리의 최상위 폴더. 워크트리면 원래 레포 루트와 다르다. */
async function worktreeTop($: EngineInterface): Promise<string | null> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() || null : null
  } catch {
    return null
  }
}

async function branchOf($: EngineInterface): Promise<string | null> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() || null : null
  } catch {
    return null
  }
}

async function isLeader($: EngineInterface, now: number): Promise<boolean> {
  const held = (await $.store.get('leader')) as { sessionId: string; until: number } | undefined
  if (held && held.sessionId !== S.me && held.until > now) return false
  await $.store.set('leader', { sessionId: S.me, until: now + LEADER_TTL_MS })
  return true
}

async function refreshAgents($: EngineInterface, now: number) {
  if (now - S.lastAgentsAt < AGENTS_EVERY_MS) return
  S.lastAgentsAt = now
  try {
    const r = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 15_000 })
    if (r.exitCode === 0) await $.store.set('agents', { at: now, list: parseAgents(r.stdout) })
  } catch {
    // claude 를 PATH 에서 못 찾는 환경: 게시된 세션만 보인다.
  }
}

async function poll($: EngineInterface, refreshList = true) {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  const recs: Rec[] = []
  const followups: Followup[] = []
  for (const key of keys) {
    if (key.startsWith('f:')) {
      const saved = await $.store.get(key)
      if (isFollowup(saved)) followups.push(saved)
    }
    if (!key.startsWith('s:')) continue
    const r = (await $.store.get(key)) as Rec | undefined
    if (r && typeof r.updatedAt === 'number') recs.push(r)
  }
  const agents = ((await $.store.get('agents')) as { list: AgentRow[] } | undefined)?.list ?? []

  if (refreshList && await isLeader($, now)) {
    await refreshAgents($, now)
    const alive = new Set(agents.map(a => a.sessionId))
    for (const r of recs) {
      if (r.sessionId !== S.me && now - r.updatedAt > GONE_MS && !alive.has(r.sessionId)) await $.store.delete(`s:${r.sessionId}`)
    }
  }

  // 원본 결과 카드는 유지하되, 정리한 남은 일을 현재 대기로 다시 표시하지 않는다.
  const displayRecs = recs.map(rec => {
    const saved = followups.find(item => item.sessionId === rec.sessionId && item.createdAt === rec.card?.at)
    if (!rec.card || !saved || saved.status === 'open') return rec
    return { ...rec, card: { ...rec.card, decision: undefined,
      pending: saved.status === 'deferred' ? `보류: ${saved.pending ?? saved.decision}` : undefined } }
  })
  const rows = mergeRows(displayRecs, agents, S.me, now)
  for (const r of newlyWaiting(rows, S.notified)) {
    S.notified.add(waitKey(r))
    $.ui.toast(`⏳ ${r.name}: ${r.rec?.waitingFor ?? '입력 대기'}`)
  }
  const prev = await read($, rowsAtom)
  if (JSON.stringify(prev) !== JSON.stringify(rows)) await update($, rowsAtom, () => rows)
  const before = await read($, followupsAtom)
  if (JSON.stringify(before) !== JSON.stringify(followups)) await update($, followupsAtom, () => followups)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    S.me = await $.session.id()
    const now = await $.clock.now()
    const cwd = await $.session.cwd()
    const repo = await $.session.repo()
    const surface = (await $.session.surfaces())[0] ?? 'headless'
    S.rec = {
      sessionId: S.me,
      cwd,
      repo: repo ? basename(repo.root) : null,
      worktree: worktreeName(repo?.root ?? null, await worktreeTop($)),
      branch: await branchOf($),
      surface,
      state: 'idle',
      hasUnseen: false,
      updatedAt: now,
    }
    await $.command.register({ name: 'sessions', description: '이 PC의 모든 Claude Code 세션 현황 패널을 열고 닫는다' })
    await flush($)
    await poll($)
    $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    $.clock.every(HEARTBEAT_MS, () => void flush($).catch(() => undefined))
    $.clock.every(60_000, () => void update($, nowAtom, n => n + 1))
    return result
  })

  on('session.end', async ($, e, next) => {
    S.pending?.cancel()
    S.pending = null
    S.rec = null
    if (S.me) await $.store.delete(`s:${S.me}`)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await patch($, { state: 'working', prompt: oneLine(e.text, 60), step: undefined, waitingFor: undefined, hasUnseen: false, turnStartedAt: now }, true)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const input = e as unknown as Record<string, unknown>
    const change: Partial<Rec> = { step: describeStep(String(e.tool), input) }
    if (e.tool === 'TodoWrite') change.todos = countTodos(input.todos)
    const isQuestion = e.tool === 'AskUserQuestion'
    await patch($, isQuestion ? { ...change, state: 'waiting', waitingFor: '질문에 답 대기' } : change, isQuestion)
    const ran = await next(e)
    if (S.rec?.state === 'waiting') await patch($, { state: 'working', waitingFor: undefined }, true)
    return ran
  })

  // 권한 확인이 뜨는 호출: 사람이 답할 때까지 대기.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (!e.agentId && verdict.decision === 'ask') await patch($, { state: 'waiting', waitingFor: `권한 확인: ${String(e.tool)}` }, true)
    return verdict
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') && e.context.percent !== undefined) await patch($, { ctxPct: e.context.percent })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const list = await $.agent.list()
    await patch($, {
      subagents: {
        running: list.filter(a => a.status === 'running' || a.status === 'pending').length,
        waiting: list.filter(a => a.status === 'waiting').length,
      },
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const now = await $.clock.now()
    const list = await $.agent.list()
    const running = list.filter(a => a.status === 'running' || a.status === 'pending').length
    const card = e.reason === 'answer' ? parseCard(e.answer, now) : undefined
    if (S.rec && card) {
      const name = (await read($, rowsAtom)).find(r => r.isSelf)?.name ?? basename(S.rec.cwd)
      const item = captureFollowup(S.rec, card, name)
      if (item) {
        // 세션 정리와 별도로 보관한다. 새 답변이 예전 미해결 항목을 지우지 않는다.
        try {
          const previous = await $.store.get(`f:${item.id}`)
          await $.store.set(`f:${item.id}`, isFollowup(previous) ? previous : item)
        } catch {
          await $.ui.toast('남은 일을 저장하지 못했습니다. 결과 카드를 확인해 주세요.')
        }
      }
    }
    await patch(
      $,
      {
        state: 'idle',
        step: undefined,
        waitingFor: undefined,
        hasUnseen: e.reason !== 'aborted',
        card: card ?? S.rec?.card,
        subagents: running > 0 ? { running, waiting: list.filter(a => a.status === 'waiting').length } : undefined,
        branch: (await branchOf($)) ?? S.rec?.branch ?? null,
      },
      true,
    )
    return result
  })

  // 한 번 더 치면 닫는다. 열 때 키보드를 가져가 Esc 로도 닫힌다.
  on('command.run', { command: 'sessions' }, async ($, e) => {
    if (e.args.trim()) {
      const [action, id, ...extra] = e.args.trim().split(/\s+/)
      if (action === 'history' && !id) {
        await poll($)
        const done = (await read($, followupsAtom)).filter(item => item.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt)
        return { text: done.length ? done.map(item => `✓ ${item.pending ?? item.decision} · ${item.location}\nID ${item.id}`).join('\n\n') : '완료한 남은 일이 없습니다.' }
      }
      const statuses: Record<string, Followup['status']> = { done: 'done', defer: 'deferred', reopen: 'open', 완료: 'done', 보류: 'deferred', 재개: 'open' }
      const status = action && Object.prototype.hasOwnProperty.call(statuses, action) ? statuses[action] : undefined
      if (!status || !id || extra.length) return { text: '/sessions done|defer|reopen <ID> — 완료·보류·재개. /sessions history — 지난 완료 기록과 ID.' }
      await poll($)
      const item = selectFollowup(await read($, followupsAtom), id)
      if (!item) return { text: '일치하는 항목이 없거나 ID가 모호합니다. 패널의 전체 ID를 사용하세요.' }
      await $.store.set(`f:${item.id}`, changeFollowup(item, status, await $.clock.now()))
      await poll($)
      return { text: `남은 일 ${status === 'done' ? '완료' : status === 'deferred' ? '보류' : '재개'}: ${item.pending ?? item.decision}` }
    }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: '세션 현황 패널을 닫았습니다.' }
    }
    await poll($)
    await $.ui.open({ id: PANE, title: '세션 현황', focus: true, closeOnEscape: true })
    return { text: '세션 현황 패널을 열었습니다. Esc 또는 /sessions 로 닫습니다.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const rows = (await read($, rowsAtom)).filter(r => !r.isSelf)
    const pending = (await read($, followupsAtom)).filter(item => item.status === 'open').length
    if (rows.length === 0 && pending === 0) return rest

    const c = counts(rows)
    const names = (list: Row[]) => list.slice(0, 3).map(r => r.name).join(', ') + (list.length > 3 ? ` 외 ${list.length - 3}` : '')
    const { Box, Text } = $.ui.resolve(e)
    const mine = (
      <Box key="band:fleet" width={e.props.bodyColumns}>
        <Text wrap="truncate-end">
          <Text dimColor>세션 </Text>
          {c.waiting.length > 0 ? (
            <Text color="warning" bold>! 대기 {c.waiting.length}{e.props.bodyColumns >= 100 ? ` (${names(c.waiting)})` : ''}  </Text>
          ) : null}
          {c.decision.length > 0 ? (
            <Text color="permission" bold>? 결정 {c.decision.length}  </Text>
          ) : null}
          <Text color="claude">● 작업 {c.working.length}  </Text>
          {c.unseen.length > 0 ? <Text color="success">✓ 새 결과 {c.unseen.length}  </Text> : null}
          {pending > 0 ? <Text color="warning">□ 남은 일 {pending}  </Text> : null}
          <Text dimColor>/sessions</Text>
        </Text>
      </Box>
    )
    return rest ? (
      <Box key="bands" flexDirection="column">
        {rest}
        {mine}
      </Box>
    ) : mine
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const rows = await read($, rowsAtom)
    await read($, nowAtom)
    const now = await $.clock.now()
    const followups = visibleFollowups(await read($, followupsAtom), now)
    const { Box, Text } = $.ui.resolve(e)
    const icon = { waiting: '!', decision: '?', working: '●', unseen: '✓', idle: '○' } as const
    const color = { waiting: 'warning', decision: 'permission', working: 'claude', unseen: 'success', idle: 'subtle' } as const
    const width = e.props.bodyColumns

    return (
      <Box flexDirection="column">
        <Text bold>현재 세션 · {rows.length}</Text>
        {rows.length === 0 ? <Text dimColor>표시할 세션이 없습니다.</Text> : null}
        {rows.map(row => {
          const k = kindOf(row)
          const r = row.rec
          const where = [r?.worktree ?? r?.repo, r?.branch].filter(Boolean).join(' · ') || (row.agent?.cwd ? basename(row.agent.cwd) : '')
          const doing =
            k === 'waiting'
              ? (r?.waitingFor ?? '입력 대기')
              : k === 'working'
                ? (r?.step ?? r?.prompt ?? '작업 중')
                : k === 'decision'
                  ? `결정 필요: ${r?.card?.decision}`
                  : (r?.card?.did ?? r?.prompt ?? '')
          const meta = [
            r?.todos ? `${r.todos.done}/${r.todos.total}` : '',
            r?.subagents?.running ? `sub ${r.subagents.running}` : '',
            r?.ctxPct !== undefined ? `ctx ${r.ctxPct}%` : '',
            r?.turnStartedAt && k === 'working' ? elapsed(now - r.turnStartedAt) : r ? elapsed(now - r.updatedAt) : '',
            r?.surface && r.surface !== 'terminal' ? r.surface : '',
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <Box key={row.sessionId} flexDirection="column" width={width}>
              <Text dimColor={row.isStale} wrap="truncate-end">
                <Text color={color[k]} bold={k === 'waiting' || k === 'decision'}>
                  {icon[k]} {row.name}
                </Text>
                {row.isSelf ? <Text dimColor> (여기)</Text> : null}
                <Text dimColor>  {where}</Text>
                {meta ? <Text dimColor>  {meta}</Text> : null}
              </Text>
              {doing ? <Text dimColor={k === 'idle'}>    {oneLine(doing, Math.max(20, width - 6))}</Text> : null}
              {r?.todos && r.todos.total > 0 ? <Text color="claude">    {'●'.repeat(Math.min(12, Math.round(12 * r.todos.done / r.todos.total)))}{'○'.repeat(Math.max(0, 12 - Math.round(12 * r.todos.done / r.todos.total)))} {r.todos.done}/{r.todos.total}</Text> : null}
              {r?.card?.pending ? <Text color="warning">    남은 일: {r.card.pending}</Text> : null}
              {r?.card?.decision && k !== 'decision' ? <Text color="permission">    결정 필요: {r.card.decision}</Text> : null}
            </Box>
          )
        })}
        <Box marginTop={1} flexDirection="column">
          <Text bold>보관된 남은 일 · {followups.filter(item => item.status !== 'done').length}</Text>
          {followups.length === 0 ? <Text dimColor>결과 카드의 남은 일과 결정 필요를 여기에 보관합니다.</Text> : null}
          {followups.map(item => (
            <Box key={item.id} flexDirection="column" width={width}>
              <Text wrap="truncate-end" color={item.status === 'done' ? 'success' : item.status === 'deferred' ? 'subtle' : 'warning'}>
                {item.status === 'done' ? '✓ 완료' : item.status === 'deferred' ? '‖ 보류' : '□ 남은 일'} · {item.sessionName} · {item.location}
              </Text>
              {item.pending ? <Text>    {item.pending}</Text> : null}
              {item.decision ? <Text color="permission">    결정 필요: {item.decision}</Text> : null}
              <Text dimColor>    ID {item.id}</Text>
            </Box>
          ))}
          <Text dimColor>/sessions done|defer|reopen &lt;ID&gt;</Text>
          <Text dimColor>완료 항목은 24시간 표시 · 이전 기록: /sessions history</Text>
        </Box>
      </Box>
    )
  })
}
