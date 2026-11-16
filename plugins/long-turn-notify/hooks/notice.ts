export const MIN_DURATION_MS = 120_000
export type Platform = 'windows' | 'macos' | 'other'
export function projectName(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '세션'
}
// PowerShell은 ASCII 외의 따옴표도 구분자로 읽는다. 사용자 문자열을 코드에
// 직접 넣지 않고 UTF-16 숫자 배열로 전달해 모든 문자를 데이터로 복원한다.
export function powershellString(value: string): string {
  const units = value.split('').map(char => char.charCodeAt(0)).join(',')
  return `[string]::new([char[]]@(${units}))`
}
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export function notificationCommand(platform: Platform, title: string, body: string): string[] | undefined {
  if (platform === 'macos') {
    const quoted = (s: string) => JSON.stringify(s)
    return ['osascript', '-e', `display notification ${quoted(body)} with title ${quoted(title)}`]
  }
  if (platform !== 'windows') return undefined
  const payload = `<toast><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual><audio silent="true"/></toast>`
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$doc.LoadXml(${powershellString(payload)})`,
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.Windows.PowerShell").Show($toast)',
  ].join('; ')
  return ['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script]
}
