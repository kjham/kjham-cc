#!/usr/bin/env node
// 무인 진행 hook. ~/.claude/autorun/<세션 이름 또는 session_id>.md 가 있는 세션에서만 동작한다.
//   UserPromptSubmit: 사람 없이 끝까지 하라는 지시면 원문을 지시 파일로 저장한다. 신호가 약하거나 지시에 대한 질문이면 저장하지 않고 모델에게 판단을 맡긴다.
//   SessionStart(compact·resume): 지시 파일을 context 에 다시 넣는다.
//   Stop: 지시가 끝나지 않았으면 한 번 되돌려 이어서 진행하게 한다. 다시 멈추면(stop_hook_active) 놓아준다.
// 파일에 `status: done` 줄이 있으면 SessionStart·Stop 은 아무것도 하지 않는다.
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'autorun')

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

// custom-title 줄은 transcript 곳곳에 반복되므로 끝부분만 읽는다.
function sessionTitle(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null
  const fd = openSync(transcriptPath, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, 4 * 1024 * 1024)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    const matches = [...buf.toString('utf8').matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)]
    return matches.length ? JSON.parse(`"${matches[matches.length - 1][1]}"`) : null
  } finally {
    closeSync(fd)
  }
}

const fileFor = name => join(dir, `${name.replace(/[\\/:*?"<>|]/g, '_')}.md`)
const isDone = text => /^status:\s*done\s*$/im.test(text)

function findDirective(input) {
  const names = [sessionTitle(input.transcript_path), input.session_id].filter(Boolean)
  for (const name of names) {
    const path = fileFor(name)
    if (existsSync(path)) return { path, text: readFileSync(path, 'utf8') }
  }
  return null
}

// 사람이 자리를 비워도 끝까지 하라는 신호. 강한 신호는 2점, 약한 신호는 1점이고 2점부터 저장한다.
const STRONG = [
  /멈추지\s*말/, /멈춤\s*없이/, /중단\s*없이/, /쉬지\s*말/,
  /(승인|컨펌|허락|확인|동의)\s*(없이|안\s*받고|받지\s*말)/, /(묻지|물어보지|되묻지)\s*말/,
  /무인\s*(으로|진행)/, /자율(적으로|\s*진행)/, /알아서\s*(끝까지|마무리|다\s)/,
  /자리를?\s*비/, /퇴근/, /밤새/, /(자는|없는)\s*동안/, /끝날\s*때까지\s*(계속|진행)/,
]
const WEAK = [
  /끝까지/, /마무리\s*(까지|하도록|해)/, /최종(적인|적으로)?.{0,20}까지/, /권고안?(을|대로|에\s*따라)/,
  /계속\s*진행/, /E2E\s*까지/i, /리뷰.{0,30}조치/, /(모두|전부)\s*(적용|진행|처리)/,
]
// 지시가 아니라 지시에 대해 묻거나 예로 든 글.
const ABOUT = /예를?\s*들(어|면)|예시|라고\s*(입력|지시|쓰|하)|하면\s*(되|돼)|[?？]\s*$/
const STOP = /(무인\s*진행|autorun).{0,10}(끄|꺼|중단|종료|그만|해제)/i

function context(text) {
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }))
}

function onPrompt(input) {
  const prompt = (input.prompt || '').trim()
  if (!prompt || prompt.startsWith('/')) return
  const name = sessionTitle(input.transcript_path) || input.session_id
  if (!name) return
  const path = fileFor(name)
  const active = existsSync(path) && !isDone(readFileSync(path, 'utf8'))

  if (STOP.test(prompt)) {
    if (!active) return
    appendFileSync(path, '\nstatus: done\n')
    return context(`[무인 진행] 사용자 요청으로 무인 진행을 끝냈다(${path}).`)
  }

  const score = STRONG.filter(r => r.test(prompt)).length * 2 + WEAK.filter(r => r.test(prompt)).length
  if (score === 0) return
  if (score < 2 || ABOUT.test(prompt)) {
    if (active) return
    return context(
      `[무인 진행 판단] 이 요청에 끝까지 진행하라는 표현이 있다. 사람이 자리를 비워도 승인 없이 끝까지 하라는 실제 작업 지시라면 ` +
        `작업을 시작하기 전에 원문과 완료 조건을 ${path} 에 저장하라. SessionStart·Stop hook 이 이 파일로 진행을 이어 준다. ` +
        `지시에 대한 질문이나 예시라면 저장하지 않는다. 저장했다면 사용자에게 한 줄로만 알린다.`,
    )
  }

  const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)
  mkdirSync(dir, { recursive: true })
  if (active) appendFileSync(path, `\n## 추가 지시 (${stamp})\n\n${prompt}\n`)
  else writeFileSync(path, `# 무인 진행 지시\n\n- 세션: ${name}\n- 저장: ${stamp} (UserPromptSubmit hook 자동 저장)\n\n## 지시 원문\n\n${prompt}\n`)
  context(
    `[무인 진행] 이 지시를 ${path} 에 ${active ? '추가' : '저장'}했다. compact 뒤에도 이 파일이 다시 들어오고, 멈추려 하면 한 번 되돌린다. ` +
      `완료 조건을 파일에 한 줄 덧붙이고 시작한다. 모두 끝나면 파일에 \`status: done\` 줄을 추가한다. 사용자에게는 무인 진행으로 저장했다는 사실을 한 줄로 알린다.`,
  )
}

const input = readStdin()
if (input.hook_event_name === 'UserPromptSubmit') {
  onPrompt(input)
  process.exit(0)
}

const directive = findDirective(input)
if (!directive || isDone(directive.text)) process.exit(0)

if (input.hook_event_name === 'SessionStart') {
  if (input.source !== 'compact' && input.source !== 'resume') process.exit(0)
  const additionalContext = [
    `[무인 진행 지시 — ${directive.path}]`,
    directive.text.trim(),
    '이 지시는 compact 이후에도 유효하다. 끝나면 이 파일에 `status: done` 줄을 추가한다.',
  ].join('\n\n')
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
} else if (input.hook_event_name === 'Stop') {
  if (input.stop_hook_active) process.exit(0)
  const reason = [
    `무인 진행 지시가 아직 끝나지 않았다(${directive.path}).`,
    '지시 파일을 다시 읽고 남은 단계를 사용자 승인 없이 권고안으로 이어서 진행하라.',
    '모두 끝났으면 파일에 `status: done` 줄을 추가하고 멈춘다.',
    '백그라운드 작업 완료를 기다리는 중이거나 사람만 풀 수 있는 차단이면 그 사실을 한 줄로 적고 멈춰도 된다.',
  ].join(' ')
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
}
