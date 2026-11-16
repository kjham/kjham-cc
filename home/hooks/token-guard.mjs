#!/usr/bin/env node
// 토큰 절감 hook. 입력의 hook_event_name 으로 동작을 고른다.
//   UserPromptSubmit: 마지막 응답 뒤 60분 넘게 쉬었고 context 가 200k 를 넘으면 한 번 막고 /compact 를 권한다.
//     prompt cache(1h)가 이미 만료돼 다음 호출이 context 전체를 cache write 로 다시 쓰기 때문이다. 같은 내용을 다시 보내면 통과한다.
//   PreToolUse(CronCreate): 30분보다 짧은 반복 간격이면 사용자 확인을 받는다.
//   SessionStart(startup): 이 프로젝트의 MEMORY.md 가 80줄을 넘으면 알린다.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const IDLE_MINUTES = 60
const CONTEXT_LIMIT = 200_000
const CRON_MIN_MINUTES = 30
const MEMORY_MAX_LINES = 80

const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

const out = obj => process.stdout.write(JSON.stringify(obj))

function tail(path, bytes) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** transcript 끝에서 마지막 main 응답의 시각과 context 크기를 찾는다. */
function lastAssistant(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null
  const lines = tail(transcriptPath, 2 * 1024 * 1024).split('\n').reverse()
  for (const line of lines) {
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    const u = entry.message?.usage
    if (!u || !entry.timestamp) continue
    const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    return { at: Date.parse(entry.timestamp), tokens }
  }
  return null
}

function onPrompt(input) {
  const prompt = (input.prompt || '').trim()
  if (!prompt || prompt.startsWith('/')) return
  const last = lastAssistant(input.transcript_path)
  if (!last || Number.isNaN(last.at)) return
  const idle = (Date.now() - last.at) / 60000
  if (idle < IDLE_MINUTES || last.tokens < CONTEXT_LIMIT) return

  // 같은 쉰 구간에서는 한 번만 막는다.
  const markDir = join(claudeDir, 'token-guard')
  const mark = join(markDir, `${String(input.session_id || 'unknown').replace(/[^\w-]/g, '_')}.idle`)
  const key = String(last.at)
  if (existsSync(mark) && readFileSync(mark, 'utf8') === key) return
  mkdirSync(markDir, { recursive: true })
  writeFileSync(mark, key)

  out({
    decision: 'block',
    reason:
      `[토큰 절감] ${Math.round(idle)}분 쉬었고 context 가 ${Math.round(last.tokens / 1000)}k 입니다. ` +
      'cache 가 만료돼 이대로 보내면 context 전체를 다시 씁니다. /compact 후 보내거나, 이어 할 일이 다르면 /clear 하세요. ' +
      '그대로 진행하려면 같은 내용을 다시 보내면 됩니다.',
  })
}

/** cron 분·시 필드로 가장 짧은 반복 간격(분)을 어림한다. 알 수 없으면 null. */
function cronIntervalMinutes(expr) {
  const [minute, hour] = String(expr || '').trim().split(/\s+/)
  if (minute === undefined || hour === undefined) return null
  const step = f => (f === '*' ? 1 : /^\*\/(\d+)$/.test(f) ? Number(f.slice(2)) : null)
  const list = f => (/^\d+(,\d+)+$/.test(f) ? f.split(',').map(Number).sort((a, b) => a - b) : null)

  const minuteStep = step(minute)
  if (minuteStep !== null) return minuteStep
  const minutes = list(minute)
  if (minutes) {
    const gaps = minutes.map((m, i) => (i ? m - minutes[i - 1] : m + 60 - minutes[minutes.length - 1]))
    return Math.min(...gaps)
  }
  const hourStep = step(hour)
  if (hourStep !== null) return hourStep * 60
  return null
}

function onCron(input) {
  const tool = input.tool_input || {}
  if (tool.recurring === false) return
  const interval = cronIntervalMinutes(tool.cron)
  if (interval === null || interval >= CRON_MIN_MINUTES) return
  out({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason:
        `[토큰 절감] ${interval}분마다 도는 반복 작업입니다. 매번 context 전체를 다시 읽습니다. ` +
        '변화 감시라면 Monitor 나 OS 스케줄러가 더 쌉니다. 그래도 만들까요?',
    },
  })
}

function onSessionStart(input) {
  if (input.source && input.source !== 'startup') return
  const cwd = input.cwd || process.cwd()
  const memory = join(claudeDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'MEMORY.md')
  if (!existsSync(memory)) return
  const lines = readFileSync(memory, 'utf8').split('\n').filter(l => l.trim()).length
  if (lines <= MEMORY_MAX_LINES) return
  out({
    systemMessage: `[토큰 절감] MEMORY.md 가 ${lines}줄입니다(기준 ${MEMORY_MAX_LINES}줄). 매 세션 context 에 들어가니 끝난 항목을 묶거나 지워 주세요: ${memory}`,
  })
}

const input = readStdin()
try {
  if (input.hook_event_name === 'UserPromptSubmit') onPrompt(input)
  else if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'CronCreate') onCron(input)
  else if (input.hook_event_name === 'SessionStart') onSessionStart(input)
} catch {
  // hook 오류로 대화를 막지 않는다.
}
