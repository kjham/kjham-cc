import type { Register } from 'claude-code'

/** 구분선 길이: 화면 폭에서 여백을 빼고, 폭을 모르면 60칸. */
export function rule(columns: number | undefined): string {
  const width = Math.max(10, Math.min(200, (columns ?? 62) - 2))
  return '─'.repeat(width)
}

export const register: Register = on => {
  // 내가 입력창에서 보낸 질문(composer)·원격(bridge) 줄에만 긋는다.
  // 백그라운드 작업 알림이나 다른 에이전트의 메시지 줄은 그대로 둔다.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const kind = e.props.origin.kind
    if (kind !== 'composer' && kind !== 'bridge') return next(e)

    const own = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="subtle">{rule(e.viewport?.columns)}</Text>
        {own}
      </Box>
    )
  })
}
