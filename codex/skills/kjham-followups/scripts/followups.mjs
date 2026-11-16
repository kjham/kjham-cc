#!/usr/bin/env node
// Codex 개인 후속 작업 색인. Claude store, 대화 기록, 모델 API는 읽거나 호출하지 않는다.
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/
const MAX_BYTES = 64 * 1024
const actions = new Map([['done', 'done'], ['defer', 'deferred'], ['reopen', 'open']])

function validId(id) {
  if (typeof id === 'string' && /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(id)) {
    throw new Error('Windows 예약된 장치 이름은 ID로 사용할 수 없습니다.')
  }
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('ID는 영문·숫자로 시작하는 1~80자의 영문·숫자·하이픈·밑줄이어야 합니다.')
  return id
}

function field(value, name, required = false) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length > 4096 || (required && !value.trim())) throw new Error(`${name}은 4096자 이하의${required ? ' 비어 있지 않은' : ''} 문자열이어야 합니다.`)
  return value.trim() || undefined
}

function ensureRegular(path, directory = false) {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('심볼릭 링크나 일반 파일이 아닌 기록은 사용하지 않습니다.')
  if (!directory && info.size > MAX_BYTES) throw new Error('기록이 허용 크기를 넘었습니다.')
}

export function createStore(root) {
  root = resolve(root)
  function prepare() {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    ensureRegular(root, true)
  }
  function pathOf(id) { return join(root, `${validId(id)}.json`) }
  function read(id) {
    const path = pathOf(id)
    if (!existsSync(path)) return undefined
    ensureRegular(path)
    let item
    try { item = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error(`기록 손상: ${id}`) }
    if (!item || item.id !== id || !['open', 'deferred', 'done'].includes(item.status)
      || typeof item.title !== 'string' || !item.title.trim()
      || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)
      || !['pending', 'decision', 'source'].every(key => item[key] === undefined || typeof item[key] === 'string')
      || (!item.pending && !item.decision)) throw new Error(`기록 손상: ${id}`)
    return item
  }
  function mutate(id, change) {
    validId(id)
    prepare()
    const lock = join(root, `${id}.lock`)
    let fd
    try { fd = openSync(lock, 'wx', 0o600) } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`다른 작업이 기록을 사용 중입니다: ${id}. 잠시 뒤 다시 시도하세요.`)
      throw error
    }
    const temp = join(root, `${id}-${randomUUID()}.tmp`)
    try {
      const item = change(read(id))
      const serialized = JSON.stringify(item, null, 2) + '\n'
      if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('저장할 기록이 64 KiB를 넘었습니다.')
      writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 })
      renameSync(temp, pathOf(id))
      return item
    } finally {
      closeSync(fd)
      if (existsSync(temp)) unlinkSync(temp)
      unlinkSync(lock)
    }
  }
  return {
    record(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('기록 입력은 JSON 객체여야 합니다.')
      const id = input.id === undefined ? randomUUID() : validId(input.id)
      const title = field(input.title, 'title', true)
      const pending = field(input.pending, 'pending')
      const decision = field(input.decision, 'decision')
      const source = field(input.source, 'source')
      if (!pending && !decision) throw new Error('pending 또는 decision이 있어야 합니다.')
      return mutate(id, previous => ({
        id, title, pending, decision, source,
        status: previous?.status ?? 'open', createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(),
      }))
    },
    change(id, action) {
      const status = actions.get(action)
      if (!status) throw new Error('done, defer, reopen 중 하나를 사용하세요.')
      return mutate(id, previous => {
        if (!previous) throw new Error(`기록을 찾지 못했습니다: ${id}`)
        return { ...previous, status, updatedAt: Date.now() }
      })
    },
    list(history = false) {
      if (!existsSync(root)) return []
      ensureRegular(root, true)
      return readdirSync(root).filter(name => name.endsWith('.json'))
        .map(name => read(name.slice(0, -5)))
        .filter(item => item && (history ? item.status === 'done' : item.status !== 'done'))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
  }
}

async function main(args) {
  const [action, id, ...extra] = args
  if (extra.length || (['record', 'list', 'history'].includes(action) && id !== undefined)
    || (actions.has(action) && id === undefined)
    || !['record', 'list', 'history', ...actions.keys()].includes(action)) {
    throw new Error('사용법: followups.mjs record < JSON stdin | list | history | done|defer|reopen <ID>')
  }
  const store = createStore(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'kjham-cc', 'followups'))
  let result
  if (action === 'record') {
    process.stdin.setEncoding('utf8')
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (Buffer.byteLength(input) > MAX_BYTES) throw new Error('입력이 64 KiB를 넘었습니다.')
    }
    result = store.record(JSON.parse(input))
  } else if (action === 'list' || action === 'history') result = store.list(action === 'history')
  else result = store.change(id, action)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    // JSON encoding keeps terminal control sequences in input or IDs inert in error output.
    process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n')
    process.exitCode = 1
  })
}
