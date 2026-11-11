# kjham-cc

개인 Claude Code 환경 — mods 마켓플레이스와 전역 설정. Windows·macOS 공용, 모든 레포에 user 스코프로 적용된다.
설계 배경 문서는 별도 보관.

## 구성

| 이름 | 종류 | 하는 일 | 명령 |
|---|---|---|---|
| `usage-hud` | mod | 입력창 위 한 줄: 5시간·주간 한도와 초기화까지 남은 시간, 소진 예상 시각, compact 까지 남은 토큰, 컨텍스트, 세션 비용, Claude 장애. 한도 값은 모든 세션이 공유해 쉬는 세션도 최신값을 보인다 | `/hud` 패널 |
| `fleet` | mod | 이 PC의 모든 세션을 모아 대기·결정 필요·작업·새 결과 수를 보여 주고, 다른 세션이 권한 확인·질문으로 멈추면 알린다 | `/sessions` 패널 |
| `ko-guard` | mod | 매 턴 한국어·결과 카드 상기, 영어 답변 감지 표시, 감지 통계 | `/ko`, `/ko-stats` |
| `turn-divider` | mod | 내 질문 위에 구분선 | — |
| `agent-radar` | 서드파티 mod | 실행 중인 서브에이전트당 한 줄 (hamzafer/claude-code-mods, 커밋 고정) | `/radar` |
| `home/CLAUDE.md` | 전역 지침 | 한국어 규칙, **결과 카드** 형식(`fleet` 이 읽어 세션 현황에 표시) | — |
| `home/settings.base.json` | 설정 | `language: korean`, 상태줄, 마켓플레이스·플러그인 활성화, 무인 진행 hook 등록, cache TTL 1h | — |
| `home/hooks/autorun.mjs` | command hook | 무인 진행. `~/.claude/autorun/<세션 이름>.md` 가 있는 세션만: compact·resume 직후 지시를 다시 넣고, 멈추려 하면 한 번 되돌린다. 파일에 `status: done` 을 쓰면 꺼진다. 10분 자기 알림 cron 대신 쓴다. mod API 는 멈춤을 막을 수 없어 command hook 으로 둔다 | — |
| `home/ccstatusline/` | 상태줄 | 모델·브랜치·변경·**캐시 타이머·적중률**·compaction 횟수 (캐시 값은 mod API 에 없어 상태줄이 맡는다) | — |

## 설치

Claude Code 2.1.287+, Node 18+ (설치 스크립트·상태줄용), git 자격증명(GitHub private 접근).

```bash
git clone https://github.com/kjham/kjham-cc.git
cd kjham-cc
./bootstrap/install.sh            # macOS
.\bootstrap\install.ps1           # Windows
```

- `settings.json` 은 덮어쓰지 않고 병합하며, 바뀌는 파일은 `.bak-<시각>` 으로 백업한다.
- `--dev`: 마켓플레이스를 이 클론 폴더로 등록한다. 편집 후 `/reload-plugins` 만으로 반영된다(주 개발 PC 용).
- `--settings-only`, `--dry-run` 지원.
- 열려 있는 세션은 `/reload-plugins`, 새 세션은 바로 적용.

## 개발

```bash
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

- 타입: 세션이 hot-reload 하는 폴더에서는 엔진이 `.claude-plugin/types/` 를 깔아 준다(커밋 제외).
- 서드파티 mod 는 `marketplace.json` 에서 `sha` 를 고정한다. 올릴 때는 소스를 읽고 `claude plugin validate` 로 calls 를 확인한 뒤 sha 를 바꾼다.

## 알아 둘 제약

- **조직 관리 환경**(Team/Enterprise 로그인)에서는 `prompt.compose`·`classic.*`·`session.compact` 같은 이벤트가 개인 mod 에 오지 않는다(`sec-default` 가 건너뜀). 그래서 언어 고정은 `language` 설정·전역 CLAUDE.md 로 하고, mod 는 매 턴 상기·감지만 한다.
- VS Code 확장 채팅 패널은 입력창 위 띠를 그리지 않는다 → `/hud`, `/sessions` 패널을 쓴다.
- 다른 IDE 창으로 포커스를 옮기는 API 는 없다. `/sessions` 는 어느 레포·브랜치·화면인지까지만 알려 준다.
- 개인 mod 는 공용 레포의 규칙(AGENTS.md, 권한 deny, 리뷰 게이트)을 우회하지 않는다. 이상 동작 재현은 `claude --safe-mode`.
