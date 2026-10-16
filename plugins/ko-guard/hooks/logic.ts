/** 매 프롬프트에 붙는 짧은 상기문. 사용자에게는 보이지 않는다. */
export const REMINDER = '(응답은 한국어로. 파일 수정·명령 실행을 했다면 전역 지침의 **결과** 카드로 끝낸다.)'

/** 한국어로 다시 쓰라는 요청. /ko 가 보낸다. */
export const REWRITE = '방금 답변을 같은 내용으로 한국어로 다시 써 줘. 코드·경로·식별자는 그대로 두고, 작업 보고였다면 결과 카드도 붙여 줘.'

/** 한글 비율을 볼 때 빼는 것: 코드 블록, 인라인 코드, URL, 경로. */
function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:[A-Za-z]:)?[\\/]?(?:[\w.-]+[\\/])+[\w.-]+/g, ' ')
}

/**
 * 영어로 쓴 답변인지. 글자가 충분히 많고(80자 이상) 그중 한글이
 * 30% 미만이면 영어로 본다. 짧은 답·코드만 있는 답은 판단하지 않는다.
 */
export function isEnglish(answer: string): boolean {
  const text = prose(answer)
  const hangul = (text.match(/[가-힣]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const letters = hangul + latin
  return letters >= 80 && hangul / letters < 0.3
}
