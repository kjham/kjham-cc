import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Followup } from '../types'

const NOW = 1_800_000_000_000
const ME = 'session-integration'
const START = { cwd: 'C:/workspace/repo', surface: 'terminal' as const, isInteractive: true }
const ANSWER = '**결과** ⚠ 부분 완료\n- 한 일: 알림 구현\n- 남은 일: 배포 확인\n- 결정 필요: 출시 날짜'

function world(on: On) {
  const clock = mock.clock(on, { now: NOW })
  const session = { id: ME }
  const values = new Map<string, unknown>()
  on('store.keys', () => ({ value: [...values.keys()] }))
  on('store.get', (_, e) => ({ value: values.get(e.key) }))
  on('store.set', (_, e) => { values.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { values.delete(e.key); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: session.id }))
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: START.cwd }))
  on('session.repo', () => ({ value: null }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_, e) => ({ value: {
    exitCode: 0, stdout: e.argv[0] === 'claude' ? '[]' : e.argv.includes('--show-toplevel') ? START.cwd : 'feature/notifications',
    stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
  } }))
  return { clock, values, session }
}

function finish(reason: 'answer' | 'aborted' = 'answer', agentId?: string) {
  return { answer: ANSWER, durationMs: 1000, isAborted: reason === 'aborted', turnId: 'turn-1', reason, agentId }
}

function stored(values: Map<string, unknown>): Followup[] {
  return [...values.entries()].filter(([key]) => key.startsWith('f:')).map(([, value]) => value as Followup)
}

function command($: Engine, args: string) {
  return $.command.run({ command: 'sessions', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
}

function pane($: Engine, bodyColumns: number) {
  return $.ui.mount({ plugin: 'fleet', surface: 'terminal', component: 'Pane', requestId: 'fleet',
    props: { title: '세션 현황', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
}

test('결과 카드의 남은 일은 세션 종료 뒤에도 보관되고 완료·보류·재개할 수 있다', async ($, on) => {
  const { values, session } = world(on)
  await $.session.start(START)
  await $.turn.complete(finish())
  const items = await stored(values)
  expect(items).toHaveLength(1)
  const item = items[0]!
  expect(item.pending).toBe('배포 확인')
  expect(item.decision).toBe('출시 날짜')
  expect(item.status).toBe('open')

  await $.session.end({ reason: 'exit' } as never)
  expect(values.get(`s:${ME}`)).toBeUndefined()
  expect(await stored(values)).toHaveLength(1)

  // 다른 세션이 다시 열려도 이전 업무를 정리할 수 있다.
  session.id = 'session-next'
  await $.session.start(START)
  for (const [action, status] of [['defer', 'deferred'], ['reopen', 'open'], ['done', 'done']] as const) {
    await command($, `${action} ${item.id}`)
    expect((await stored(values))[0]?.status).toBe(status)
  }
  await command($, `reopen ${item.id}`)
  expect((await stored(values))[0]?.status).toBe('open')
})

test('중단·subagent 결과는 남은 일로 저장하지 않는다', async ($, on) => {
  const { values } = world(on)
  await $.session.start(START)
  await $.turn.complete(finish('aborted'))
  await $.turn.complete(finish('answer', 'worker-1'))
  expect(await stored(values)).toEqual([])
})

test('다음 답변에 남은 일이 없어도 이전 미해결 항목은 지우지 않고 잘못된 명령은 상태를 바꾸지 않는다', async ($, on) => {
  const { values } = world(on)
  await $.session.start(START)
  await $.turn.complete(finish())
  const original = stored(values)[0]!
  await $.turn.complete({ ...finish(), turnId: 'turn-2', answer: '**결과** ✅ 완료\n- 남은 일: 없음\n- 결정 필요: 없음' })
  expect(stored(values)).toEqual([original])
  await command($, 'done missing-id')
  await command($, `delete ${original.id}`)
  await command($, `__proto__ ${original.id}`)
  await command($, `constructor ${original.id}`)
  await command($, `toString ${original.id}`)
  expect(stored(values)).toEqual([original])
})

test('완료한 남은 일은 현재 세션의 대기 표시에서 사라지고 중복 이벤트로 다시 열리지 않는다', async ($, on) => {
  const { values } = world(on)
  await $.session.start(START)
  await $.turn.complete(finish())
  const item = stored(values)[0]!
  await command($, `done ${item.id}`)
  await $.turn.complete(finish())
  expect(stored(values)).toHaveLength(1)
  expect(stored(values)[0]?.status).toBe('done')
  const mounted = await pane($, 100)
  const drawn = JSON.stringify(await mounted.drawn())
  // 완료 기록은 보관 영역에만 남고 현재 세션의 대기로 중복 표시하지 않는다.
  expect(drawn.match(/배포 확인/g)).toHaveLength(1)
  expect(drawn.match(/출시 날짜/g)).toHaveLength(1)
  expect(drawn).toContain('✓ 완료')
})

test('24시간 지난 완료 기록도 history에서 ID를 찾아 재개할 수 있다', async ($, on) => {
  const { values } = world(on)
  await $.session.start(START)
  await $.turn.complete(finish())
  const item = stored(values)[0]!
  await command($, `done ${item.id}`)
  values.set(`f:${item.id}`, { ...stored(values)[0]!, updatedAt: NOW - 86_400_001 })
  const history = await command($, 'history')
  expect(history.text).toContain(item.id)
  expect(history.text).toContain('배포 확인')
  const mounted = await pane($, 100)
  expect(JSON.stringify(await mounted.drawn())).not.toContain(item.id)
  await command($, `reopen ${item.id}`)
  expect(stored(values)[0]?.status).toBe('open')
})

for (const columns of [40, 120]) {
  test(`${columns}열 패널에서 세션·보관 항목·결정·조작 ID가 보인다`, async ($, on) => {
    const { values } = world(on)
    await $.session.start(START)
    await $.turn.complete(finish())
    const item = (await stored(values))[0]!
    // command의 poll 완료를 기다려 화면 상태를 갱신한다.
    await command($, `defer ${item.id}`)
    const mounted = await pane($, columns)
    const drawn = JSON.stringify(await mounted.drawn())
    expect(drawn).toContain('현재 세션')
    expect(drawn).toContain('보관된 남은 일')
    expect(drawn).toContain('배포 확인')
    expect(drawn).toContain('출시 날짜')
    expect(drawn).toContain('보류')
    expect(drawn).toContain(item.id)
  })
}
