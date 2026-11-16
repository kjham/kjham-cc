import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mergeGuidance } from './codex.mjs'

const installer = fileURLToPath(new URL('./install.mjs', import.meta.url))
test('개인 지침을 보존하고 소유한 블록만 한 번 교체한다', () => {
  const once = mergeGuidance('기존 개인 지침\n', 'v1')
  const twice = mergeGuidance(once, 'v2')
  assert.equal(twice, '기존 개인 지침\n\n<!-- kjham-cc:begin -->\nv2\n<!-- kjham-cc:end -->\n')
  assert.equal(mergeGuidance(twice, 'v2'), twice)
  assert.throws(() => mergeGuidance('before <!-- kjham-cc:begin -->', 'new'))
})

function home(t) {
  const root = mkdtempSync(join(tmpdir(), 'kjham-install-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const codex = join(root, 'codex')
  const claude = join(root, 'claude')
  mkdirSync(codex); mkdirSync(claude)
  return { codex, claude, run: (...args) => spawnSync(process.execPath, [installer, '--target=codex', ...args], {
    encoding: 'utf8', env: { ...process.env, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude },
  }) }
}

test('Codex 단독 설치는 기존 notify·hooks·Claude 설정을 변경하지 않고 재실행할 수 있다', t => {
  const h = home(t)
  const config = 'notify = ["existing-notifier"]\n[permissions]\nkeep = true\n'
  const hooks = '{"hooks":{"Stop":[]}}\n'
  writeFileSync(join(h.codex, 'config.toml'), config)
  writeFileSync(join(h.codex, 'hooks.json'), hooks)
  writeFileSync(join(h.codex, 'AGENTS.md'), '개인 지침\n')
  writeFileSync(join(h.claude, 'settings.json'), '{"language":"korean"}\n')
  for (let i = 0; i < 2; i++) {
    const r = h.run('--settings-only')
    assert.equal(r.status, 0, r.stderr)
  }
  assert.equal(readFileSync(join(h.codex, 'config.toml'), 'utf8'), config)
  assert.equal(readFileSync(join(h.codex, 'hooks.json'), 'utf8'), hooks)
  assert.equal(readFileSync(join(h.claude, 'settings.json'), 'utf8'), '{"language":"korean"}\n')
  assert.equal(readFileSync(join(h.codex, 'AGENTS.md'), 'utf8').split('<!-- kjham-cc:begin -->').length, 2)
  assert.ok(existsSync(join(h.codex, 'skills', 'kjham-followups', 'SKILL.md')))
  assert.ok(existsSync(join(h.codex, 'kjham-cc.config.toml')))
})

test('dry-run은 Codex 파일을 쓰지 않는다', t => {
  const h = home(t)
  const r = h.run('--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(join(h.codex, 'AGENTS.md')), false)
  assert.equal(existsSync(join(h.codex, 'kjham-cc.config.toml')), false)
})
