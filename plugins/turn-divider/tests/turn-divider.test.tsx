import { expect, test } from 'claude-code/testing'

import { rule } from '../hooks/register'

test('구분선은 화면 폭에 맞추고 폭을 모르면 60칸이다', () => {
  expect(rule(82)).toHaveLength(80)
  expect(rule(undefined)).toHaveLength(60)
  expect(rule(3)).toHaveLength(10)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: 내 질문 줄 위에 구분선을 긋고 알림 줄은 그대로 둔다`, async ($, on) => {
    on('ui.render', { component: 'UserMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    const mine = await $.ui.mount({
      plugin: 'turn-divider', surface, component: 'UserMessage',
      props: { text: '질문입니다', origin: { kind: 'composer' }, isExpanded: false } as never,
    })
    const drawn = JSON.stringify(await mine.drawn())
    expect(drawn).toContain('─')
    expect(drawn).toContain('질문입니다')

    const note = await $.ui.mount({
      plugin: 'turn-divider', surface, component: 'UserMessage',
      props: { text: '작업 완료', origin: { kind: 'task-notification' }, isExpanded: false } as never,
    })
    expect(JSON.stringify(await note.drawn())).not.toContain('─')
  })
}
