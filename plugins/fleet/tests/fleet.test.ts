import { expect, test } from 'claude-code/testing'

import { counts, describeStep, elapsed, kindOf, mergeRows, newlyWaiting, parseAgents, parseCard, waitKey } from '../hooks/logic'
import type { Rec } from '../types'

const base = (over: Partial<Rec>): Rec => ({
  sessionId: 'x',
  cwd: 'C:\\workspace\\repo',
  repo: 'repo',
  branch: 'develop',
  surface: 'terminal',
  state: 'idle',
  hasUnseen: false,
  updatedAt: 1000,
  ...over,
})

test('결과 카드에서 상태·한 일·남은 일·결정 필요를 읽고 "없음"은 비운다', () => {
  const answer = [
    '본문',
    '---',
    '**결과** ⚠ 부분 완료',
    '- 한 일: 폴백 추가, 테스트 2건',
    '- 변경: a.py (미커밋)',
    '- 남은 일: 이미지 재빌드',
    '- 결정 필요: 없음',
  ].join('\n')
  expect(parseCard(answer, 5)).toEqual({ status: 'partial', did: '폴백 추가, 테스트 2건', pending: '이미지 재빌드', decision: undefined, at: 5 })
  expect(parseCard('카드 없음', 5)).toBe(undefined)
  expect(parseCard('**결과** ✅ 완료\n- 결정 필요: 커밋 범위 승인', 1)?.decision).toBe('커밋 범위 승인')
})

test('도구 호출을 짧은 말로 줄인다', () => {
  expect(describeStep('Edit', { file_path: 'C:\\a\\b\\register.tsx' })).toBe('Edit register.tsx')
  expect(describeStep('Bash', { command: 'git status' })).toBe('Bash git status')
  expect(describeStep('mcp__dooray__list_tasks', {})).toBe('dooray:list_tasks')
})

test('대기 → 결정 → 작업 → 새 결과 → idle 순으로 세우고, 목록에만 있는 세션도 넣는다', () => {
  const recs = [
    base({ sessionId: 'a', state: 'idle', hasUnseen: true, card: { status: 'done', decision: '승인', at: 1 } }),
    base({ sessionId: 'b', state: 'working' }),
    base({ sessionId: 'c', state: 'waiting', waitingFor: '권한 확인: Bash' }),
    base({ sessionId: 'd', state: 'idle', hasUnseen: true }),
    base({ sessionId: 'me', state: 'idle', updatedAt: 0 }),
  ]
  const agents = [{ sessionId: 'c', name: 'sess_alpha' }, { sessionId: 'z', name: 'bg', state: 'blocked' }]
  const rows = mergeRows(recs, agents, 'me', 1000 + 40_000)
  expect(rows.map(r => r.sessionId)).toEqual(['z', 'c', 'a', 'b', 'd', 'me'])
  expect(rows[1]?.name).toBe('sess_alpha')
  expect(rows.find(r => r.sessionId === 'me')?.isSelf).toBe(true)
  expect(rows.every(r => r.isStale === (r.rec !== undefined))).toBe(true)

  const c = counts(rows)
  expect([c.waiting.length, c.decision.length, c.working.length, c.unseen.length, c.idle.length]).toEqual([2, 1, 1, 1, 1])
  expect(kindOf(rows[1]!)).toBe('waiting')
})

test('새로 대기에 들어온 다른 세션만 한 번 알린다', () => {
  const rows = mergeRows([base({ sessionId: 'a', state: 'waiting', waitingFor: 'q' }), base({ sessionId: 'me', state: 'waiting' })], [], 'me', 1000)
  const first = newlyWaiting(rows, new Set())
  expect(first.map(r => r.sessionId)).toEqual(['a'])
  expect(newlyWaiting(rows, new Set(first.map(waitKey)))).toEqual([])
})

test('claude agents --json 을 읽고 형식이 다르면 빈 목록', () => {
  expect(parseAgents('[{"sessionId":"s","name":"n","kind":"interactive","status":"busy"}]')).toEqual([
    { sessionId: 's', name: 'n', cwd: undefined, kind: 'interactive', status: 'busy', state: undefined },
  ])
  expect(parseAgents('oops')).toEqual([])
  expect(elapsed(75 * 60_000)).toBe('1h15')
})
