// 접힌 행은 한눈에 읽히게 줄이고, 원문은 펼친 행과 실행 기록에 남긴다.
export function shortCommand(command: string, columns?: number): string {
  const maxChars = columns === undefined || !Number.isFinite(columns)
    ? 60 : Math.max(12, Math.min(80, Math.floor(columns) - 12))
  const trimmed = command.trim()
  const first = trimmed.split(/\r?\n/)[0] ?? ''
  const chars = Array.from(first)
  const head = chars.length > maxChars ? chars.slice(0, maxChars).join('') : first
  return head === trimmed ? trimmed : `${head.trimEnd()} …`
}
