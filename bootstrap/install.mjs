#!/usr/bin/env node
// kjham-cc 설치: ~/.claude 설정 병합 + 전역 지침·출력 스타일·상태줄 설정 복사 + 마켓플레이스 등록·플러그인 설치.
// Windows·macOS 공용. 사용법은 README 참고.
//   --dev            마켓플레이스를 GitHub 대신 이 클론 폴더로 등록한다(편집이 /reload-plugins 로 바로 반영).
//   --settings-only  설정·파일만 반영하고 플러그인 설치는 건너뛴다.
//   --dry-run        바꿀 내용만 출력한다.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = new Set(process.argv.slice(2))
const isDev = args.has('--dev')
const isDry = args.has('--dry-run')
const isSettingsOnly = args.has('--settings-only')

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
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
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  return r.status ?? 1
}

console.log(`kjham-cc 설치 — ${isDev ? '개발(로컬 폴더)' : 'GitHub'} 모드, 대상 ${claudeDir}`)

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

// Codex 도 같은 SKILL.md 형식을 읽는다. Codex 를 쓰는 PC 에서만 스킬을 ~/.codex/skills 로 복사한다.
const codexDir = process.env.CODEX_HOME || join(homedir(), '.codex')
if (existsSync(codexDir)) {
  console.log('\n[2-1] Codex 스킬')
  const skillsRoot = join(repo, 'plugins', 'slide-craft', 'skills')
  // SKILL.md 가 가리키는 딸린 파일(assets 등)도 같은 상대 경로로 복사한다.
  for (const rel of readdirSync(skillsRoot, { recursive: true, withFileTypes: true })) {
    if (!rel.isFile()) continue
    const from = join(rel.parentPath ?? rel.path, rel.name)
    write(join(codexDir, 'skills', from.slice(skillsRoot.length + 1)), readFileSync(from, 'utf8'))
  }
}

if (isSettingsOnly) process.exit(0)

console.log('\n[3] 마켓플레이스 등록·플러그인 설치')
const source = isDev ? repo : 'kjham/kjham-cc'
if (run(['claude', 'plugin', 'marketplace', 'add', source]) !== 0) run(['claude', 'plugin', 'marketplace', 'update', MARKETPLACE])
for (const id of Object.keys(base.enabledPlugins ?? {})) run(['claude', 'plugin', 'install', id])

console.log('\n완료. 열려 있는 세션에서는 /reload-plugins, 새 세션은 바로 적용됩니다.')
