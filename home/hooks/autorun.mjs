#!/usr/bin/env node
// 무인 진행 hook. ~/.claude/autorun/<세션 이름 또는 session_id>.md 가 있는 세션에서만 동작한다.
//   SessionStart(compact·resume): 지시 파일을 context 에 다시 넣는다.
//   Stop: 지시가 끝나지 않았으면 한 번 되돌려 이어서 진행하게 한다. 다시 멈추면(stop_hook_active) 놓아준다.
// 파일에 `status: done` 줄이 있으면 아무것도 하지 않는다.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
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

function findDirective(input) {
  const names = [sessionTitle(input.transcript_path), input.session_id].filter(Boolean)
  for (const name of names) {
    const path = join(dir, `${name.replace(/[\\/:*?"<>|]/g, '_')}.md`)
    if (existsSync(path)) return { path, text: readFileSync(path, 'utf8') }
  }
  return null
}

const input = readStdin()
const directive = findDirective(input)
if (!directive || /^status:\s*done\s*$/im.test(directive.text)) process.exit(0)

const event = input.hook_event_name
if (event === 'SessionStart') {
  if (input.source !== 'compact' && input.source !== 'resume') process.exit(0)
  const additionalContext = [
    `[무인 진행 지시 — ${directive.path}]`,
    directive.text.trim(),
    '이 지시는 compact 이후에도 유효하다. 끝나면 이 파일에 `status: done` 줄을 추가한다.',
  ].join('\n\n')
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
} else if (event === 'Stop') {
  if (input.stop_hook_active) process.exit(0)
  const reason = [
    `무인 진행 지시가 아직 끝나지 않았다(${directive.path}).`,
    '지시 파일을 다시 읽고 남은 단계를 사용자 승인 없이 권고안으로 이어서 진행하라.',
    '모두 끝났으면 파일에 `status: done` 줄을 추가하고 멈춘다.',
    '백그라운드 작업 완료를 기다리는 중이거나 사람만 풀 수 있는 차단이면 그 사실을 한 줄로 적고 멈춰도 된다.',
  ].join(' ')
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
}
