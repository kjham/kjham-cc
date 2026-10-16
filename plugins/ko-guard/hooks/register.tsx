import type { EngineInterface, Register } from 'claude-code'

import { REMINDER, REWRITE, isEnglish } from './logic'

type Stats = { turns: number; english: number; since: number }

/** 1주 운영 뒤 효과를 보려고 메인 턴 수와 영어 감지 수를 센다. */
async function count($: EngineInterface, isEn: boolean) {
  const prev = ((await $.store.get('stats')) as Stats | undefined) ?? { turns: 0, english: 0, since: await $.clock.now() }
  await $.store.set('stats', { ...prev, turns: prev.turns + 1, english: prev.english + (isEn ? 1 : 0) })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'ko', description: '방금 답변을 한국어로 다시 쓰게 한다' })
    await $.command.register({ name: 'ko-stats', description: '영어 응답 감지 통계를 보여 준다' })
    return result
  })

  // 시스템 프롬프트(prompt.compose)는 조직 관리 환경에서 개인 mod 에 오지 않는다.
  // 언어 고정은 language 설정·전역 CLAUDE.md 가 맡고, 여기서는 매 턴 상기와 감지만 한다.
  // 슬래시 명령·숨은 프롬프트에는 붙이지 않는다.
  on('prompt.submit', ($, e, next) =>
    e.command || e.isMeta ? next(e) : next({ ...e, context: [...(e.context ?? []), REMINDER] }),
  )

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer') return result
    const isEn = isEnglish(e.answer)
    await count($, isEn)
    return isEn ? { ...result, text: `${result.text}\n\n⚠ 영어로 답했습니다 — /ko 로 한국어로 다시 받기` } : result
  })

  on('command.run', { command: 'ko' }, async $ => {
    await $.prompt.submit({ text: REWRITE, asUser: true })
    return { text: '한국어로 다시 쓰도록 요청했습니다.' }
  })

  on('command.run', { command: 'ko-stats' }, async $ => {
    const s = (await $.store.get('stats')) as Stats | undefined
    if (!s || s.turns === 0) return { text: '아직 기록이 없습니다.' }
    const days = Math.max(1, Math.round(((await $.clock.now()) - s.since) / 86_400_000))
    const pct = ((s.english / s.turns) * 100).toFixed(1)
    return { text: `최근 ${days}일: 메인 턴 ${s.turns}회 중 영어 응답 ${s.english}회 (${pct}%)` }
  })
}
