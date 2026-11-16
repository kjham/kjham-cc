import { expect, test } from 'claude-code/testing'
import { captureFollowup, changeFollowup, selectFollowup, visibleFollowups } from '../hooks/followups'
import type { Rec } from '../types'
import { parseCard } from '../hooks/logic'

const rec: Rec = { sessionId: 'session-a', cwd: 'C:/repo', repo: 'repo', branch: 'main', surface: 'terminal', state: 'idle', hasUnseen: true, updatedAt: 10 }
const card = { status: 'done' as const, did: '구현 완료', pending: '배포 확인', decision: '일정 선택', at: 100 }

test('남은 일은 세션 수명과 별도로 저장할 수 있고 카드가 없으면 기존 기록을 유지한다', () => {
  const item = captureFollowup(rec, card, 'named')!
  expect(item.pending).toBe('배포 확인')
  expect(item.sessionName).toBe('named')
  expect(captureFollowup(rec, undefined, 'named')).toBe(undefined)
  expect(visibleFollowups([item], 200)).toEqual([item])
})

test('반복 기록은 완료·보류 상태를 되돌리지 않고 새 카드의 남은 일은 별도로 보존한다', () => {
  const first = captureFollowup(rec, card, 'named')!
  const done = changeFollowup(first, 'done', 200)
  expect(captureFollowup(rec, card, 'named', done)?.status).toBe('done')
  expect(changeFollowup(first, 'deferred', 200).status).toBe('deferred')
  const fresh = captureFollowup(rec, { ...card, at: 300, pending: '문서 확인' }, 'named')!
  expect(fresh.id === first.id).toBe(false)
  expect(visibleFollowups([done, fresh], 400)).toHaveLength(2)
  expect(visibleFollowups([done, fresh], 200 + 86_400_001)).toEqual([fresh])
})

test('모호한 짧은 ID는 변경하지 않으며 완료 뒤 다시 열 수 있다', () => {
  const first = captureFollowup(rec, card, 'named')!
  const second = captureFollowup(rec, { ...card, at: 200 }, 'named')!
  expect(selectFollowup([first, second], 'session')).toBe(undefined)
  expect(selectFollowup([first, second], first.id)?.id).toBe(first.id)
  expect(changeFollowup(changeFollowup(first, 'done', 200), 'open', 300).status).toBe('open')
  expect(captureFollowup(rec, { status: 'done', at: 100 }, 'named')).toBe(undefined)
})

test('보관할 남은 일의 긴 설명을 잘라 버리지 않는다', () => {
  const pending = '배포 확인 항목 '.repeat(30).trim()
  expect(parseCard(`**결과** 완료\n- 남은 일: ${pending}`, 100)?.pending).toBe(pending)
})
