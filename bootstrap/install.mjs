#!/usr/bin/env node
// kjham-cc 설치: Claude 설정·plugins와 Codex 지침·skills·선택형 CLI 프로필.
// Windows·macOS 공용. 사용법은 README 참고.
//   --dev            마켓플레이스를 GitHub 대신 이 클론 폴더로 등록한다(편집이 /reload-plugins 로 바로 반영).
//   --settings-only  설정·파일만 반영하고 플러그인 설치는 건너뛴다.
//   --dry-run        바꿀 내용만 출력한다.
//   --target=...     all(기본), claude, codex 중 선택한다.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installCodex } from './codex.mjs'

const args = new Set(process.argv.slice(2))
const isDev = args.has('--dev')
const isDry = args.has('--dry-run')
const isSettingsOnly = args.has('--settings-only')
const targetArg = [...args].find(arg => arg.startsWith('--target='))
const target = targetArg?.slice('--target='.length) ?? 'all'
if (!['all', 'claude', 'codex'].includes(target) || [...args].some(arg => !['--dev', '--dry-run', '--settings-only', targetArg].includes(arg))) {
  throw new Error('사용법: node bootstrap/install.mjs [--target=all|claude|codex] [--dev] [--settings-only] [--dry-run]')
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const MARKETPLACE = 'kjham-cc'

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** base 의 키가 이긴다. 객체(enabledPlugins 등)는 키 단위로 합친다. statusLine 은 통째로 바꾼다. */
function merge(current, base) {
  const out = { ...current }
  for (const [key, value] of Object.entries(base)) {
    out[key] = isObject(value) && isObject(current[key]) && key !== 'statusLine' ? merge(current[key], value) : value
  }
  return out
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

function write(path, text) {
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (prev === text) return console.log(`  = ${path} (변경 없음)`)
  if (isDry) return console.log(`  ~ ${path} (바뀜, dry-run)`)
  mkdirSync(dirname(path), { recursive: true })
  if (prev !== null) copyFileSync(path, `${path}.bak-${stamp}`)
  writeFileSync(path, text)
  console.log(`  ✓ ${path}${prev !== null ? ` (백업: .bak-${stamp})` : ''}`)
}

function run(argv) {
  console.log(`  $ ${argv.join(' ')}`)
  if (isDry) return 0
  // 저장소 경로의 &, 괄호, 공백도 명령이 아닌 인자로 전달한다.
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: false, windowsHide: true })
  if (r.error) throw new Error(`${argv[0]} 실행 실패: ${r.error.message}`)
  return r.status ?? 1
}

const codexDir = process.env.CODEX_HOME || join(homedir(), '.codex')
if (target !== 'claude' && (target === 'codex' || existsSync(codexDir))) {
  console.log(`Codex 설치 — ${codexDir}`)
  installCodex({ repo, codexDir, write })
  console.log('Codex 기본 config.toml·notify·hooks는 보존했습니다. CLI 화면은 codex -p kjham-cc 로 선택합니다.')
}
if (target === 'codex') process.exit(0)

console.log(`Claude Code 설치 — ${isDev ? '개발(로컬 폴더)' : 'GitHub'} 모드, 대상 ${claudeDir}`)

console.log('\n[1] 설정 병합')
const base = readJson(join(repo, 'home', 'settings.base.json'))
// 개발 모드는 CLI 로 로컬 폴더를 등록하므로 GitHub 선언을 넣지 않는다(같은 이름 충돌 방지).
if (isDev) delete base.extraKnownMarketplaces?.[MARKETPLACE]
const settingsPath = join(claudeDir, 'settings.json')
write(settingsPath, JSON.stringify(merge(readJson(settingsPath), base), null, 2) + '\n')

console.log('\n[2] 전역 지침·출력 스타일·상태줄 설정')
write(join(claudeDir, 'CLAUDE.md'), readFileSync(join(repo, 'home', 'CLAUDE.md'), 'utf8'))
write(join(claudeDir, 'output-styles', 'plain-korean.md'), readFileSync(join(repo, 'home', 'output-styles', 'plain-korean.md'), 'utf8'))
for (const sub of ['hooks', 'agents']) {
  for (const name of readdirSync(join(repo, 'home', sub))) write(join(claudeDir, sub, name), readFileSync(join(repo, 'home', sub, name), 'utf8'))
}
const ccsl = join(homedir(), '.config', 'ccstatusline', 'settings.json')
if (existsSync(ccsl)) console.log(`  = ${ccsl} (이미 있어 그대로 둠 — 바꾸려면 npx ccstatusline@2.2.30 로 편집)`)
else write(ccsl, readFileSync(join(repo, 'home', 'ccstatusline', 'settings.json'), 'utf8'))

if (isSettingsOnly) process.exit(0)

console.log('\n[3] 마켓플레이스 등록·플러그인 설치')
const source = isDev ? repo : 'kjham/kjham-cc'
if (run(['claude', 'plugin', 'marketplace', 'add', source]) !== 0 && run(['claude', 'plugin', 'marketplace', 'update', MARKETPLACE]) !== 0) {
  throw new Error('Claude Code marketplace 등록·갱신 실패')
}
for (const [id, enabled] of Object.entries(base.enabledPlugins ?? {})) {
  if (enabled && run(['claude', 'plugin', 'install', id]) !== 0) throw new Error(`플러그인 설치 실패: ${id}`)
}

console.log('\n완료. 열려 있는 세션에서는 /reload-plugins, 새 세션은 바로 적용됩니다.')
