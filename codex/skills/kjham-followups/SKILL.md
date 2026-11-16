---
name: kjham-followups
description: Codex에서 사용자가 개인 남은 일을 보관·조회·완료·보류·재개하려 할 때 로컬 색인을 관리한다. 저장소의 기존 작업 기록과 진행 상태를 중복 관리하지 않는다.
---

# 개인 남은 일

이 스킬 폴더의 `scripts/followups.mjs`를 Node로 실행한다. Claude Code의 `/sessions`와 다른 기록이며, 대화 transcript나 Claude의 store를 읽지 않는다.

## 기록 범위

- 사용자가 개인 보관을 요청한 남은 일과 결정 사항만 기록한다. 매 턴 자동 수집하지 않는다.
- 저장소에 작업 기록이 있으면 `source`에 그 경로를 넣고, `pending`에는 짧은 다음 행동만 쓴다. 세부 진행 상태와 전체 문서를 복제하지 않는다.
- API key, 비밀번호, 토큰, 고객 개인정보, 대화 전문을 넣지 않는다. `source`는 참고 문자열이며 파일을 열거나 실행하는 명령이 아니다.
- 파일은 `$CODEX_HOME/kjham-cc/followups`에 저장한다. `CODEX_HOME`이 없으면 `~/.codex/kjham-cc/followups`를 쓴다. 로컬 평문 JSON이며 네트워크 전송 기능이 없다. 다만 agent가 조회하면 명령 출력은 현재 대화에 들어오므로 필요한 항목만 답변에 인용한다.

## 실행

`node <이 스킬 폴더>/scripts/followups.mjs <명령>`을 사용한다. 경로는 공백을 고려해 shell에 맞게 인용한다.

| 명령 | 동작 |
|---|---|
| `record` | stdin에서 JSON 객체를 받아 저장하고 ID 반환 |
| `list` | 미완료·보류 항목 조회 |
| `history` | 완료 항목 조회 |
| `done <ID>` | 완료 |
| `defer <ID>` | 보류 |
| `reopen <ID>` | 다시 열기 |

`record` 입력은 `title`과 `pending` 또는 `decision`이 필요하다. `source`와 `id`는 선택이다. 새 항목은 반환된 ID를 보관한다. 같은 항목의 문구를 갱신할 때만 기존 ID를 넣으며, 갱신은 완료·보류 상태를 되돌리지 않는다.

```json
{"title":"배포 확인","pending":"운영 화면 확인","source":".studio/task.md"}
```

사용자 문구를 shell 명령 문자열에 보간하지 않는다. stdin에 JSON을 쓰거나 파일 쓰기 도구로 임시 JSON 파일을 만든 뒤 stdin으로 전달한다. 실행 후 임시 파일을 정리한다. 변경에는 조회한 정확한 ID를 쓰며, 모호한 제목으로 항목을 추측하지 않는다.

저장 실패나 사용 중인 기록 오류가 나면 성공했다고 말하지 않는다. 다음 행동을 알려 주고 원본 작업 기록은 그대로 둔다. 손상된 기록이나 남은 lock 파일을 자동으로 삭제하지 않는다.
