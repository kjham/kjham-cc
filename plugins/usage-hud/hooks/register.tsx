import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput } from 'claude-code'

import type { History, Limits, Outage, Projection } from '../types'
import { LABEL, clock, compactLeft, crossings, level, project, record, remaining, tokens, toWindows } from './logic'

const limitsAtom = atom({ plugin: 'usage-hud', key: 'limits' } as const, null as Limits | null)
const projectionsAtom = atom({ plugin: 'usage-hud', key: 'projections' } as const, [] as Projection[])
const ctxAtom = atom({ plugin: 'usage-hud', key: 'ctx' } as const, null)
const costAtom = atom({ plugin: 'usage-hud', key: 'cost' } as const, null)
const outageAtom = atom({ plugin: 'usage-hud', key: 'outage' } as const, null as Outage | null)
const nowAtom = atom({ plugin: 'usage-hud', key: 'now' } as const, 0)

const PANE = 'usage-hud'
const STATUS_URL = 'https://status.claude.com/api/v2/status.json'
const STATUS_EVERY_MS = 5 * 60 * 1000
const TICK_MS = 60 * 1000
const THRESHOLD_EVERY_MS = 5 * 60 * 1000
/** 이보다 짧게 돈 세션은 시간당 비용이 튀어서 숨긴다. */
const RATE_MIN_MS = 10 * 60 * 1000

/*
 * 한도 값은 그 세션이 요청을 보낼 때만 갱신된다. 쉬고 있는 세션도 최신 값을 보이도록
 * 모든 세션이 $.store 에 같이 쓰고 읽는다. 키: limits, history, alerted.
 */
async function storedLimits($: EngineInterface): Promise<Limits | null> {
  const v = (await $.store.get('limits')) as Limits | undefined
  return v && Array.isArray(v.windows) && typeof v.at === 'number' ? v : null
}

async function storedHistory($: EngineInterface): Promise<History> {
  const v = await $.store.get('history')
  return v && typeof v === 'object' ? (v as History) : {}
}

async function refreshProjections($: EngineInterface, history: History) {
  const list = Object.keys(LABEL).flatMap(kind => project(history, kind) ?? [])
  await update($, projectionsAtom, () => list)
}

async function ingest($: EngineInterface, e: Pick<SessionMeasureInput, 'rateLimits'>) {
  const windows = toWindows(e.rateLimits)
  if (windows.length === 0) return
  const now = await $.clock.now()
  const limits: Limits = { windows, at: now }
  await $.store.set('limits', limits)
  await update($, limitsAtom, () => limits)

  const history = record(await storedHistory($), windows, now)
  await $.store.set('history', history)
  await refreshProjections($, history)

  // 여러 세션이 같은 문턱을 받으므로 알림 이력도 공유해 한 번만 울린다.
  const alerted = ((await $.store.get('alerted')) as string[] | undefined) ?? []
  const fresh = crossings(windows, alerted)
  for (const { window, threshold } of fresh) {
    const left = window.resetsAtMs === null ? '' : ` — ${remaining(window.resetsAtMs - now)} 후 초기화`
    $.ui.toast(`${threshold >= 95 ? '🔴' : '🟠'} ${LABEL[window.kind]} 사용량 ${window.percentUsed}% (${threshold}% 넘음)${left}`)
  }
  if (fresh.length > 0) await $.store.set('alerted', [...alerted, ...fresh.map(f => f.key)].slice(-50))
}

/** 다른 세션이 더 최근 값을 받아 두었으면 가져온다. */
async function adopt($: EngineInterface) {
  const shared = await storedLimits($)
  const mine = await read($, limitsAtom)
  if (shared && (!mine || shared.at > mine.at)) {
    await update($, limitsAtom, () => shared)
    await refreshProjections($, await storedHistory($))
  }
}

async function measureContext($: EngineInterface, withThreshold: boolean) {
  const usage = await $.session.usage(withThreshold ? { breakdown: 'summary' } : undefined)
  const { tokens: used, window, percent, breakdown } = usage.context
  await update($, ctxAtom, prev => ({
    tokens: used,
    window,
    percent,
    threshold: breakdown ? breakdown.autoCompactThreshold : prev?.threshold,
    isAutoCompactEnabled: breakdown ? breakdown.isAutoCompactEnabled : (prev?.isAutoCompactEnabled ?? true),
  }))
  if (usage.cost) {
    const usd = usage.cost.usd
    await update($, costAtom, () => ({ usd, startedAt: usage.startedAt }))
  }
}

async function checkStatus($: EngineInterface) {
  let next: Outage
  try {
    const res = await $.http.fetch(STATUS_URL)
    const body = res.ok ? JSON.parse(res.text) : null
    next = body?.status
      ? { indicator: String(body.status.indicator), description: String(body.status.description) }
      : { indicator: 'unknown', description: `상태 조회 실패 (${res.status})` }
  } catch {
    next = { indicator: 'unknown', description: '상태 조회 실패' }
  }
  const prev = await read($, outageAtom)
  const isDown = next.indicator !== 'none' && next.indicator !== 'unknown'
  if (isDown && prev?.indicator !== next.indicator) {
    $.ui.toast(`⚠ Claude 장애: ${next.description} — status.claude.com`)
  } else if (next.indicator === 'none' && prev && prev.indicator !== 'none' && prev.indicator !== 'unknown') {
    $.ui.toast('✅ Claude 장애가 해소되었습니다')
  }
  await update($, outageAtom, () => next)
}

type Segment = { key: string; parts: { text: string; color?: string; bold?: boolean; dim?: boolean }[] }

/** 띠와 패널이 같이 쓰는 구간들. 아직 값이 없는 구간은 뺀다. */
async function segments($: EngineInterface): Promise<Segment[]> {
  const limits = await read($, limitsAtom)
  const projections = await read($, projectionsAtom)
  const ctx = await read($, ctxAtom)
  const cost = await read($, costAtom)
  const outage = await read($, outageAtom)
  await read($, nowAtom)
  const now = await $.clock.now()
  const out: Segment[] = []

  for (const w of limits?.windows ?? []) {
    const parts: Segment['parts'] = [
      { text: `${LABEL[w.kind]} `, dim: true },
      { text: `${w.percentUsed}%`, color: level(w.percentUsed), bold: w.percentUsed >= 80 },
    ]
    if (w.resetsAtMs !== null) parts.push({ text: ` ↻ ${remaining(w.resetsAtMs - now)}`, dim: true })
    const p = projections.find(x => x.kind === w.kind)
    if (p?.isBeforeReset) parts.push({ text: ` · 소진 예상 ${clock(p.etaMs, now)}`, color: 'warning', bold: true })
    out.push({ key: w.kind, parts })
  }
  if (limits && now - limits.at > 10 * 60 * 1000) {
    out.push({ key: 'age', parts: [{ text: `(${remaining(now - limits.at)} 전 값)`, dim: true }] })
  }

  if (ctx) {
    const parts: Segment['parts'] = [{ text: 'ctx ', dim: true }, { text: `${ctx.percent ?? 0}%`, color: 'subtle' }]
    const c = compactLeft(ctx)
    if (c) {
      parts.push({ text: ' · compact까지 ', dim: true }, { text: tokens(c.left), color: level(c.usedPct), bold: c.usedPct >= 80 })
    } else if (!ctx.isAutoCompactEnabled) {
      parts.push({ text: ' · auto-compact 꺼짐', dim: true })
    }
    out.push({ key: 'ctx', parts })
  }

  if (cost && cost.usd > 0) {
    const elapsed = now - cost.startedAt
    const rate = elapsed >= RATE_MIN_MS ? ` ($${((cost.usd * 3_600_000) / elapsed).toFixed(1)}/h)` : ''
    out.push({ key: 'cost', parts: [{ text: `$${cost.usd.toFixed(2)}${rate}`, dim: true }] })
  }

  if (outage && outage.indicator !== 'none' && outage.indicator !== 'unknown') {
    const color = outage.indicator === 'minor' || outage.indicator === 'maintenance' ? 'warning' : 'error'
    out.push({ key: 'outage', parts: [{ text: `● ${outage.description}`, color, bold: true }] })
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'hud', description: '사용량·한도·compact 상세 패널을 열고 닫는다' })
    await adopt($)
    await ingest($, await $.session.usage())
    await measureContext($, true)
    await checkStatus($)
    $.clock.every(TICK_MS, () => void (async () => {
      await adopt($)
      await update($, nowAtom, n => n + 1)
    })())
    $.clock.every(THRESHOLD_EVERY_MS, () => void measureContext($, true))
    $.clock.every(STATUS_EVERY_MS, () => void checkStatus($))
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await ingest($, e)
    if (e.changed.includes('context') || e.changed.includes('cost')) await measureContext($, false)
    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: '사용량 패널을 닫았습니다.' }
    }
    await $.ui.open({ id: PANE, title: '사용량', focus: true, closeOnEscape: true })
    return { text: '사용량 패널을 열었습니다. Esc 또는 /hud 로 닫습니다.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const segs = await segments($)
    if (segs.length === 0) return rest

    const { Box, Text } = $.ui.resolve(e)
    const mine = (
      <Box key="band:usage-hud" width={e.props.bodyColumns} justifyContent="flex-end" flexWrap="wrap">
        {segs.map((s, i) => (
          <Text key={s.key}>
            {i > 0 ? <Text dimColor>  │  </Text> : null}
            {s.parts.map(p => (
              <Text color={p.color} bold={p.bold} dimColor={p.dim}>{p.text}</Text>
            ))}
          </Text>
        ))}
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
    const segs = await segments($)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {segs.length === 0 ? <Text dimColor>아직 측정값이 없습니다. 첫 응답 뒤에 채워집니다.</Text> : null}
        {segs.map(s => (
          <Text key={s.key}>
            {s.parts.map(p => (
              <Text color={p.color} bold={p.bold} dimColor={p.dim}>{p.text}</Text>
            ))}
          </Text>
        ))}
      </Box>
    )
  })
}
