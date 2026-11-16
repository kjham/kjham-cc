import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { notificationCommand, powershellString } from '../hooks/notice.ts'

test('PowerShell treats every quotation mark and subexpression as literal notification data', { skip: process.platform !== 'win32' }, () => {
  const values = [
    '',
    "plain ' quote, \"quote\", $(), ` and ;",
    'repo\u2019 + $( $global:marker = "executed" ) + \u2018',
    'repo\u2018 + $( $global:marker = "executed" ) + \u2019',
    'repo\u201a + $( $global:marker = "executed" ) + \u201b',
    'repo\u201c; $global:marker = "executed"; \u201d',
    '한글 세션 😀\nsecond line\r\ntab\t\\path',
  ]
  for (const value of values) {
    const script = [
      "$global:marker = 'untouched'",
      `$value = ${powershellString(value)}`,
      '$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($value))',
      '@{ encoded = $encoded; marker = $global:marker } | ConvertTo-Json -Compress',
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr || String(result.error))
    const observed = JSON.parse(result.stdout)
    assert.equal(observed.marker, 'untouched')
    assert.equal(observed.encoded, Buffer.from(value, 'utf16le').toString('base64'))
  }
})

test('Windows notification XML preserves hostile title as text and stays silent', { skip: process.platform !== 'win32' }, () => {
  const title = 'repo\u2019 + $( $global:marker = "executed" ) + \u2018 <&"\''
  const body = '알림 확인'
  const argv = notificationCommand('windows', title, body)
  // 실행할 payload 구성문은 그대로 사용하되, OS 알림 전송 없이 .NET XML로 확인한다.
  const load = argv.at(-1).match(/\$doc\.LoadXml\(.+?\);(?= \$toast)/)?.[0]
  assert.ok(load)
  const script = [
    "$global:marker = 'untouched'",
    '$doc = New-Object System.Xml.XmlDocument',
    load,
    '$title = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($doc.SelectSingleNode("//text[1]").InnerText))',
    '$body = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($doc.SelectSingleNode("//text[2]").InnerText))',
    '@{ title = $title; body = $body; marker = $global:marker; silent = $doc.toast.audio.silent } | ConvertTo-Json -Compress',
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  assert.deepEqual(JSON.parse(result.stdout), {
    title: Buffer.from(title, 'utf16le').toString('base64'),
    body: Buffer.from(body, 'utf16le').toString('base64'),
    marker: 'untouched', silent: 'true',
  })
})
