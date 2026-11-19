#!/usr/bin/env node
// 공개 레포에 비밀값·사내 용어가 들어가지 않게 막는 검사.
//   --staged           커밋할 변경(pre-commit)
//   --message=<file>   커밋 메시지(commit-msg)
//   --push             push 할 커밋들의 변경과 메시지(pre-push, stdin 으로 ref 목록을 받는다)
//   --history          모든 브랜치의 전체 이력 점검(수동)
// 사내 용어 목록은 레포 밖 파일에만 둔다. 목록 자체가 감출 대상이기 때문이다.
//   기본 위치: ~/.config/kjham-cc/blocked-terms.txt (KJHAM_CC_BLOCKED_TERMS 로 바꿀 수 있다)
// 오탐인 줄은 같은 줄에 `guard:allow` 를 적어 통과시킨다. 사내 용어에는 적용되지 않는다.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ZERO = /^0+$/

const SECRET_PATTERNS = [
  ['AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS secret key', /aws_secret_access_key\s*[:=]\s*\S{20,}/i],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['password/secret 값', /\b(password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'][^"'\s$<{]{8,}["']/i],
  ['URL 안 자격증명', /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{4,}@/i],
]

const BLOCKED_FILES = [
  /(^|\/)\.env(\..*)?$/, /\.pem$/, /\.p12$/, /\.pfx$/, /\.key$/, /(^|\/)id_(rsa|ed25519|ecdsa)$/,
  /(^|\/)credentials(\.json)?$/, /settings\.local\.json$/, /\.npmrc$/, /\.netrc$/,
]
const ALLOWED_FILES = [/\.env\.example$/]

function git(args, input) {
  const r = spawnSync('git', args, { encoding: 'utf8', input, maxBuffer: 1 << 30 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${r.stderr}`)
  return r.stdout
}

function loadTerms() {
  const file = process.env.KJHAM_CC_BLOCKED_TERMS || join(homedir(), '.config', 'kjham-cc', 'blocked-terms.txt')
  if (!existsSync(file)) {
    console.error(`[guard] 사내 용어 목록이 없습니다: ${file}`)
    console.error('[guard] 한 줄에 하나씩 감출 용어를 적은 파일을 만든 뒤 다시 시도하세요. 목록 없이 통과시키지 않습니다.')
    process.exit(1)
  }
  return readFileSync(file, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    // 왼쪽만 영문자 경계를 둔다. 낱말 가운데 우연히 든 글자열(fromisoformat 등)은 넘기고 접두로 쓴 경우는 잡는다.
    .map(term => [term, new RegExp(`(?<![A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')])
}

const findings = []
function checkText(where, text, terms) {
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [term, re] of terms) if (re.test(line)) findings.push(`${where}:${i + 1} 사내 용어 「${term}」`)
    if (line.includes('guard:allow')) return
    for (const [name, re] of SECRET_PATTERNS) if (re.test(line)) findings.push(`${where}:${i + 1} ${name}`)
  })
}
function checkPath(where, path, terms) {
  const p = path.replace(/\\/g, '/')
  if (BLOCKED_FILES.some(re => re.test(p)) && !ALLOWED_FILES.some(re => re.test(p))) findings.push(`${where} 올리면 안 되는 파일 이름: ${p}`)
  for (const [term, re] of terms) if (re.test(p)) findings.push(`${where} 경로에 사내 용어 「${term}」: ${p}`)
}

/** unified diff 에서 더해진 줄과 새 파일 경로만 본다. 지운 줄은 막을 이유가 없다. */
function checkDiff(label, diff, terms) {
  let file = '?'
  let lineNo = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '')
      if (file !== '/dev/null') checkPath(label, file, terms)
    } else if (line.startsWith('@@')) {
      lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 0) - 1
    } else if (line.startsWith('+')) {
      lineNo++
      checkText(`${label} ${file}#${lineNo}`, line.slice(1), terms)
    } else if (!line.startsWith('-')) {
      lineNo++
    }
  }
}

function checkCommits(revArgs, terms) {
  const shas = git(['rev-list', ...revArgs]).split('\n').filter(Boolean)
  for (const sha of shas) {
    const short = sha.slice(0, 10)
    checkText(`${short} 커밋 메시지`, git(['log', '-1', '--format=%B', sha]), terms)
    checkDiff(short, git(['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', sha]), terms)
  }
  return shas.length
}

const argv = process.argv.slice(2)
const terms = loadTerms()
let scope = ''
if (argv.includes('--staged')) {
  scope = '커밋할 변경'
  checkDiff('staged', git(['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff']), terms)
} else if (argv.some(a => a.startsWith('--message='))) {
  scope = '커밋 메시지'
  const file = argv.find(a => a.startsWith('--message=')).slice('--message='.length)
  checkText('커밋 메시지', readFileSync(file, 'utf8').split(/\r?\n/).filter(l => !l.startsWith('#')).join('\n'), terms)
} else if (argv.includes('--push')) {
  const input = readFileSync(0, 'utf8')
  let count = 0
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(' ')
    if (ZERO.test(localSha)) continue
    count += checkCommits(ZERO.test(remoteSha) ? [localSha, '--not', '--remotes'] : [`${remoteSha}..${localSha}`], terms)
  }
  scope = `push 할 커밋 ${count}개`
} else if (argv.includes('--history')) {
  scope = `전체 이력 커밋 ${checkCommits(['--all'], terms)}개`
} else {
  console.error('사용법: node tools/guard/scan.mjs --staged | --message=<file> | --push | --history')
  process.exit(2)
}

if (findings.length) {
  console.error(`[guard] ${scope}에서 ${findings.length}건을 찾아 막았습니다.`)
  for (const f of [...new Set(findings)].slice(0, 50)) console.error(`  - ${f}`)
  console.error('[guard] 값을 지우거나 일반 표현으로 바꾼 뒤 다시 시도하세요. --no-verify 로 건너뛰지 마세요.')
  process.exit(1)
}
console.log(`[guard] ${scope}: 문제 없음`)
