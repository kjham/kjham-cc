import { expect, mock, test } from 'claude-code/testing'

import { clock, compactLeft, crossings, project, record, remaining, tokens } from '../hooks/logic'

const BAND = {
  plugin: 'usage-hud',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 140, scroll: { offset: 0, bodyRows: 3 } } as never,
} as const

const MIN = 60_000

test('남은 시간과 토큰 수를 줄여 말한다', () => {
  expect(remaining(12 * MIN)).toBe('12분')
  expect(remaining(130 * MIN)).toBe('2시간 10분')
  expect(remaining((3 * 1440 + 4 * 60) * MIN)).toBe('3일 4시간')
  expect(tokens(312_400)).toBe('312K')
  expect(tokens(1_250_000)).toBe('1.3M')
})

test('창마다 넘은 문턱 중 가장 높은 것 하나만, 이미 알린 것은 빼고 고른다', () => {
  const w = { kind: 'five_hour', percentUsed: 96, resetsAtMs: 1 }
  expect(crossings([w], []).map(c => c.threshold)).toEqual([95])
  expect(crossings([w], ['five_hour:1:95'])).toEqual([])
})

test('관측 이력의 기울기로 100% 도달 시각을 내고, 초기화가 먼저면 경고하지 않는다', () => {
  let h = record({}, [{ kind: 'five_hour', percentUsed: 20, resetsAtMs: 1000 * MIN }], 0)
  h = record(h, [{ kind: 'five_hour', percentUsed: 40, resetsAtMs: 1000 * MIN }], 60 * MIN)
  const p = project(h, 'five_hour')
  expect(p?.etaMs).toBe(240 * MIN)
  expect(p?.isBeforeReset).toBe(true)

  const late = record(h, [{ kind: 'five_hour', percentUsed: 41, resetsAtMs: 100 * MIN }], 61 * MIN)
  expect(late.five_hour?.samples).toHaveLength(1)
  expect(project(late, 'five_hour')).toBe(null)
})

test('compact 까지 남은 토큰은 기준에서 사용량을 뺀 값이다', () => {
  expect(compactLeft({ tokens: 600_000, window: 1_000_000, threshold: 967_000, isAutoCompactEnabled: true })).toEqual({ left: 367_000, usedPct: 62 })
  expect(compactLeft({ tokens: 1, window: 1, isAutoCompactEnabled: false })).toBe(null)
})

test('측정값이 오면 띠에 한도를 그리고 문턱 알림은 세션을 넘어 한 번만 울린다', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Text, {}, '다른 띠') as never)
  on('session.measure', ($, e) => ({ changed: e.changed }))

  const measure = {
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 82, resetsAt: '2099-01-01T00:00:00Z' },
      { kind: 'seven_day', percentUsed: 41 },
    ],
    changed: ['rateLimits'],
  } as const
  await $.session.measure(measure as never)
  await $.session.measure(measure as never)

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('5시간 사용량 82%')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('5시간')
  expect(drawn).toContain('82%')
  expect(drawn).toContain('주간')
  expect(drawn).toContain('다른 띠')
})

test('소진 예상 시각은 오늘이면 시:분, 아니면 날짜를 붙인다', () => {
  const now = new Date(2026, 9, 16, 9, 0).getTime()
  expect(clock(new Date(2026, 9, 16, 6, 4).getTime(), now)).toBe('06:04')
  expect(clock(new Date(2026, 9, 18, 6, 4).getTime(), now)).toBe('10/18 06:04')
})
