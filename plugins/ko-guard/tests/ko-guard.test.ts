import { expect, test } from 'claude-code/testing'

import { REMINDER, isEnglish } from '../hooks/logic'

test('영어 위주 답변만 영어로 보고, 코드·경로·짧은 답은 판단하지 않는다', () => {
  expect(isEnglish('I updated the configuration service and added two unit tests. Everything passes now, and the remaining work is the image rebuild.')).toBe(true)
  expect(isEnglish('설정 서비스를 고쳤고 `config_service.py` 에 unit test 2건을 더했습니다. 남은 일은 image rebuild 입니다. 테스트는 모두 통과했습니다.')).toBe(false)
  expect(isEnglish('```ts\nconst answer = computeEverythingInEnglishHereWithLongIdentifiers()\n```\n완료했습니다.')).toBe(false)
  expect(isEnglish('OK, done.')).toBe(false)
})

test('사람이 입력한 프롬프트에만 상기문을 붙인다', async ($, on) => {
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: '고쳐 줘' } as never)
  expect(seen.at(-1)).toContain(REMINDER)
})
