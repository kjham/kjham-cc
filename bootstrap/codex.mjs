import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const START = '<!-- kjham-cc:begin -->'
const END = '<!-- kjham-cc:end -->'

export function mergeGuidance(current, guidance) {
  const block = `${START}\n${guidance.trim()}\n${END}`
  const starts = current.split(START).length - 1
  const ends = current.split(END).length - 1
  if (!starts && !ends) return `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
  if (starts !== 1 || ends !== 1 || current.indexOf(END) < current.indexOf(START)) {
    throw new Error('Codex AGENTS.md의 kjham-cc 관리 블록이 불완전합니다. 기존 파일을 보존했습니다.')
  }
  return current.slice(0, current.indexOf(START)) + block + current.slice(current.indexOf(END) + END.length)
}

function treeFiles(source, destination) {
  const files = []
  for (const item of readdirSync(source, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error(`스킬 배포에서 링크를 지원하지 않습니다: ${item.name}`)
    const from = join(source, item.name)
    const to = join(destination, item.name)
    if (item.isDirectory()) files.push(...treeFiles(from, to))
    else if (item.isFile()) files.push([to, readFileSync(from, 'utf8')])
  }
  return files
}

export function installCodex({ repo, codexDir, write }) {
  const guidancePath = join(codexDir, 'AGENTS.md')
  const current = existsSync(guidancePath) ? readFileSync(guidancePath, 'utf8') : ''
  // 모든 원본을 먼저 읽어 잘못된 관리 블록이나 누락 파일 때문에 일부만 설치하지 않는다.
  const files = [
    [guidancePath, mergeGuidance(current, readFileSync(join(repo, 'codex', 'AGENTS.md'), 'utf8'))],
    [join(codexDir, 'kjham-cc.config.toml'), readFileSync(join(repo, 'codex', 'kjham-cc.config.toml'), 'utf8')],
    ...treeFiles(join(repo, 'codex', 'skills'), join(codexDir, 'skills')),
    ...treeFiles(join(repo, 'plugins', 'slide-craft', 'skills'), join(codexDir, 'skills')),
  ]
  for (const [path, content] of files) write(path, content)
}
