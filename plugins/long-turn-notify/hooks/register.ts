import type { EngineInterface, Register } from 'claude-code'
import { MIN_DURATION_MS, notificationCommand, projectName, type Platform } from './notice'
import { isWaitingForPermission, readSessionName, readSessionRecord, type RecordCache } from './session-name'

// Lifecycle follows wj-mods long-turn-notify-team (MIT, LICENSE.upstream).
const WAKING = new Set(['pending', 'running', 'waiting'])
let interactive = false
let platform: Platform = 'other'
let startedAt: number | undefined
let asking = false
let permissionNotified = false
let polling = false
const cache: RecordCache = {}

async function notify($: EngineInterface, body: string) {
  try {
    const name = (await readSessionName($)) || projectName(await $.session.cwd())
    const argv = notificationCommand(platform, `Claude Code · ${name}`, body)
    if (!argv) return
    const result = await $.process.run(argv, { timeoutMs: 5000 })
    if (result.exitCode !== 0) $.ui.toast(`알림을 보내지 못했습니다 · ${body}`)
  } catch {
    $.ui.toast(`알림을 보내지 못했습니다 · ${body}`)
  }
}
function schedule($: EngineInterface, body: string) {
  if (interactive) $.clock.after(0, () => void notify($, body))
}
async function watchPermission($: EngineInterface) {
  if (!interactive || polling) return
  polling = true
  try {
    const waiting = isWaitingForPermission(await readSessionRecord($, cache), await $.session.id())
    if (!waiting) permissionNotified = false
    else if (!permissionNotified && !asking) {
      permissionNotified = true
      schedule($, '권한 확인을 기다리고 있습니다')
    }
  } finally { polling = false }
}
export const register: Register = on => {
  interactive = false
  platform = 'other'
  startedAt = undefined
  asking = false
  permissionNotified = false
  polling = false
  cache.path = undefined
  on('session.end', async ($, e, next) => {
    interactive = false
    startedAt = undefined
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    interactive = e.isInteractive
    if (!interactive) return result
    if ((await $.env.get('OS')) === 'Windows_NT') platform = 'windows'
    else {
      const os = await $.process.run(['uname', '-s'], { timeoutMs: 3000 }).catch(() => undefined)
      platform = os?.stdout.trim() === 'Darwin' ? 'macos' : 'other'
    }
    if (platform !== 'other') $.clock.every(1500, () => void watchPermission($).catch(() => undefined))
    return result
  })
  on('turn.start', async ($, e, next) => {
    if (interactive && e.agentId === undefined) startedAt ??= await $.clock.now()
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!interactive || e.agentId !== undefined) return result
    if (e.reason === 'aborted') { startedAt = undefined; return result }
    if (e.reason === 'answer') {
      // If the list cannot be read, avoid claiming the whole job finished.
      const agents = await $.agent.list().catch(() => undefined)
      if (!agents || agents.some(a => WAKING.has(a.status))) return result
    }
    const began = startedAt
    startedAt = undefined
    if (began !== undefined && (await $.clock.now()) - began >= MIN_DURATION_MS) {
      schedule($, e.reason === 'error' ? '작업이 오류로 멈췄습니다' : '작업이 끝났습니다')
    }
    return result
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId !== undefined || !interactive) return next(e)
    asking = true
    permissionNotified = true
    schedule($, '질문에 답변을 기다리고 있습니다')
    try { return await next(e) } finally { asking = false }
  })
}
