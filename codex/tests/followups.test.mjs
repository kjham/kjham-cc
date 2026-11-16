import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createStore } from '../skills/kjham-followups/scripts/followups.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kjham-codex-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, store: createStore(root) }
}

test('record survives reopening and supports defer, done, reopen, history', t => {
  const { root, store } = fixture(t)
  const item = store.record({ title: '배포 확인', pending: '운영 결과 확인', source: 'repo/task.md' })
  assert.equal(createStore(root).list()[0].id, item.id)
  assert.equal(store.change(item.id, 'defer').status, 'deferred')
  assert.equal(store.change(item.id, 'done').status, 'done')
  assert.equal(store.list().length, 0)
  assert.equal(store.list(true)[0].id, item.id)
  assert.equal(store.change(item.id, 'reopen').status, 'open')
})

test('repeated record preserves manually completed state and unrelated items', t => {
  const { store } = fixture(t)
  store.record({ id: 'task-a', title: 'A', pending: '확인' })
  store.record({ id: 'task-b', title: 'B', decision: '선택' })
  store.change('task-a', 'done')
  assert.equal(store.record({ id: 'task-a', title: 'A 수정', pending: '확인' }).status, 'done')
  assert.equal(store.list()[0].id, 'task-b')
})

test('invalid IDs, commands, oversized fields and missing work cannot mutate records', t => {
  const { root, store } = fixture(t)
  store.record({ id: 'safe', title: 'A', pending: '확인' })
  const before = readFileSync(join(root, 'safe.json'), 'utf8')
  for (const id of ['../escape', '..', 'a/b', 'a\\b', 'C:escape', '']) {
    assert.throws(() => store.change(id, 'done'))
    assert.throws(() => store.record({ id, title: 'A', pending: 'x' }))
  }
  for (const action of ['__proto__', 'constructor', 'toString', 'delete']) assert.throws(() => store.change('safe', action))
  assert.throws(() => store.record({ title: 'A' }))
  assert.throws(() => store.record({ title: 'A', pending: 'x'.repeat(4097) }))
  assert.equal(readFileSync(join(root, 'safe.json'), 'utf8'), before)
})

test('busy or corrupt record fails explicitly and leaves existing bytes unchanged', t => {
  const { root, store } = fixture(t)
  store.record({ id: 'safe', title: 'A', pending: '확인' })
  writeFileSync(join(root, 'safe.lock'), '')
  assert.throws(() => store.change('safe', 'done'), /사용 중/)
  assert.equal(store.list()[0].status, 'open')
  rmSync(join(root, 'safe.lock'))
  writeFileSync(join(root, 'safe.json'), '{broken')
  assert.throws(() => store.list(), /손상/)
  assert.throws(() => store.record({ id: 'safe', title: 'A', pending: 'x' }), /손상/)
  assert.equal(readFileSync(join(root, 'safe.json'), 'utf8'), '{broken')
  assert.equal(readdirSync(root).filter(name => name.endsWith('.tmp')).length, 0)
})

test('CLI uses only Codex namespace and treats shell-like text as data', t => {
  const { root } = fixture(t)
  const script = fileURLToPath(new URL('../skills/kjham-followups/scripts/followups.mjs', import.meta.url))
  const run = args => spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8',
    input: JSON.stringify({ id: 'safe', title: 'name', pending: "$(echo injected); ' 명령 아님" }),
  })
  const result = run(['record'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).pending, "$(echo injected); ' 명령 아님")
  assert.equal(JSON.parse(run(['list']).stdout).length, 1)
  assert.ok(readFileSync(join(root, 'kjham-cc', 'followups', 'safe.json')))
  assert.equal(run(['done', '../escape']).status, 1)
  assert.equal(run(['list', 'unexpected']).status, 1)
})

test('Windows device IDs are rejected before writing files', t => {
  const { root, store } = fixture(t)
  for (const id of ['CON', 'prn', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
    assert.throws(() => store.record({ id, title: 'A', pending: 'x' }), /예약된 장치 이름/)
    assert.throws(() => store.change(id, 'done'), /예약된 장치 이름/)
  }
  for (const id of ['COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³']) {
    assert.throws(() => store.record({ id, title: 'A', pending: 'x' }))
  }
  assert.deepEqual(readdirSync(root), [])
})

test('serialized size limit rejects an update without damaging the original record', t => {
  const { root, store } = fixture(t)
  const id = 'size-check'
  store.record({ id, title: '기존', pending: '보존할 내용' })
  const before = readFileSync(join(root, `${id}.json`), 'utf8')
  const input = { id, title: '\u0001'.repeat(4096), pending: '\u0001'.repeat(4096), decision: '\u0001'.repeat(2718) }
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 64 * 1024)
  assert.throws(() => store.record(input), /64 KiB/)
  assert.equal(readFileSync(join(root, `${id}.json`), 'utf8'), before)
  assert.equal(store.list()[0].pending, '보존할 내용')
  assert.deepEqual(readdirSync(root), [`${id}.json`])
})
