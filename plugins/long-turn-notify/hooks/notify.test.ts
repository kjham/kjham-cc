import { expect, mock, test } from 'claude-code/testing'
import type { On, AgentInfo } from 'claude-code'
import { notificationCommand, projectName } from './notice'
import { isWaitingForPermission } from './session-name'
function world(on: On) {
  const runs: (readonly string[])[] = []
  const clock = mock.clock(on, { now: 0 })
  const state = { agents: [] as AgentInfo[], waiting: false }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.list', () => ({ value: state.agents }))
  on('session.cwd', () => ({ value: 'C:/workspace/repo' }))
  on('session.id', () => ({ value: 's' }))
  on('env.get', (_, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : 'C:/Users/test' }))
  on('fs.list', () => ({ value: [{ name: '1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: JSON.stringify({ sessionId: 's', waitingFor: state.waiting ? 'permission prompt' : '' }) }))
  on('process.run', (_, e) => { runs.push(e.argv); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('ui.toast', () => ({ value: undefined }))
  return { runs, clock, state }
}
const start = { cwd: 'C:/workspace/repo', surface: 'terminal', isInteractive: true } as const
const finish = (reason: 'answer' | 'aborted' | 'error' = 'answer') => ({ answer: 'done', durationMs: 180000, isAborted: reason === 'aborted', turnId: 't', reason })
test('OS commands escape data and Windows hides its console', () => {
  const win = notificationCommand('windows', "repo'; boom <&", 'done')!
  expect(win).toContain('Hidden')
  expect(win.at(-1)?.includes("repo'; boom <&")).toBe(false)
  expect(notificationCommand('macos', 'repo', 'done')?.[0]).toBe('osascript')
  expect(notificationCommand('other', 'repo', 'done')).toBeUndefined()
  expect(projectName('C:\\work\\repo')).toBe('repo')
  expect(isWaitingForPermission({ sessionId: 'other', waitingFor: 'permission prompt' }, 's')).toBe(false)
})
test('long turn notifies once and aborted turn stays silent', async ($, on) => {
  const { runs, clock } = world(on)
  await $.session.start(start)
  await $.turn.start({ text: 'work', turnId: 't' })
  await clock.advance(180000)
  await $.turn.complete(finish())
  await clock.advance(1); await clock.settle()
  expect(runs.filter(r => r[0] === 'powershell.exe')).toHaveLength(1)
  await $.turn.complete(finish())
  await $.turn.start({ text: 'work', turnId: 't2' })
  await clock.advance(180000)
  await $.turn.complete(finish('aborted'))
  await clock.advance(1); await clock.settle()
  expect(runs.filter(r => r[0] === 'powershell.exe')).toHaveLength(1)
})
test('pending agent delays completion until the resumed turn ends', async ($, on) => {
  const { runs, clock, state } = world(on)
  state.agents = [{ id: 'a', type: 'general-purpose', description: 'work', status: 'pending' }]
  await $.session.start(start)
  await $.turn.start({ text: 'work', turnId: 't' })
  await clock.advance(180000)
  await $.turn.complete(finish())
  await clock.advance(1); await clock.settle()
  expect(runs).toHaveLength(0)
  state.agents = []
  await $.turn.start({ text: '', turnId: 't2' })
  await $.turn.complete(finish())
  await clock.advance(1); await clock.settle()
  expect(runs).toHaveLength(1)
})
test('permission polling deduplicates and rearms after dialog closes', async ($, on) => {
  const { runs, clock, state } = world(on)
  await $.session.start(start)
  state.waiting = true
  await clock.advance(4501); await clock.settle()
  expect(runs).toHaveLength(1)
  state.waiting = false
  await clock.advance(1500); await clock.settle()
  state.waiting = true
  await clock.advance(1501); await clock.settle()
  expect(runs).toHaveLength(2)
})

test('short turns and headless sessions do not notify', async ($, on) => {
  const { runs, clock } = world(on)
  await $.session.start(start)
  await $.turn.start({ text: 'short', turnId: 't' })
  await clock.advance(90000)
  await $.turn.complete(finish())
  await clock.advance(1); await clock.settle()
  expect(runs).toHaveLength(0)
  await $.session.start({ ...start, isInteractive: false, surface: null })
  await $.turn.start({ text: 'headless', turnId: 't2' })
  await clock.advance(180000)
  await $.turn.complete(finish())
  await clock.advance(1); await clock.settle()
  expect(runs).toHaveLength(0)
})
