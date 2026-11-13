# kjham-cc

개인 Claude Code 환경 — mods 마켓플레이스와 전역 설정. Windows·macOS 공용, 모든 레포에 user 스코프로 적용된다.
설계 배경 문서는 별도 보관.

> **다른 PC에서 최신 내용을 받을 때는 `git pull` 뒤에 설치 스크립트를 다시 실행해야 한다.** 설정·전역 지침·hook 은 `~/.claude` 로 복사되는 파일이라 pull 만으로는 바뀌지 않는다. 아래 [업데이트](#업데이트) 참고.

## 구성

| 이름 | 종류 | 하는 일 | 명령 |
|---|---|---|---|
| `usage-hud` | mod | 입력창 위 한 줄: 5시간·주간 한도와 초기화까지 남은 시간, 소진 예상 시각, compact 까지 남은 토큰, 컨텍스트, 세션 비용, Claude 장애. 한도 값은 모든 세션이 공유해 쉬는 세션도 최신값을 보인다 | `/hud` 패널 |
| `fleet` | mod | 이 PC의 모든 세션을 모아 대기·결정 필요·작업·새 결과 수를 보여 주고, 다른 세션이 권한 확인·질문으로 멈추면 알린다 | `/sessions` 패널 |
| `ko-guard` | mod | 매 턴 한국어·결과 카드 상기, 영어 답변 감지 toast, 감지 통계 | `/ko`, `/ko-stats` |
| `turn-divider` | mod | 내 질문 위에 구분선 | — |
| `slide-craft` | 스킬 | `slide-deck`: 발표 자료를 스토리라인 → 다이어그램 → 제작 → 렌더링 검수 → 정제 → 사실 대조 순으로 만든다. `humanize-ko`: 한국어 글·장표에서 AI 티를 점검표로 걷어 낸다. Codex 가 있는 PC 에는 `~/.codex/skills` 로도 복사된다 | `/slide-craft:slide-deck`, `/slide-craft:humanize-ko` |
| `agent-radar` | 서드파티 mod | 실행 중인 서브에이전트당 한 줄 (hamzafer/claude-code-mods, 커밋 고정) | `/radar` |
| `home/CLAUDE.md` | 전역 지침 | 한국어 규칙, **결과 카드** 형식(`fleet` 이 읽어 세션 현황에 표시) | — |
| `home/settings.base.json` | 설정 | `language: korean`, 상태줄, 마켓플레이스·플러그인 활성화, 무인 진행 hook 등록, 토큰 절감 설정(아래) | — |
| `home/hooks/autorun.mjs` | command hook | 무인 진행. "멈추지 말고", "승인 없이", "퇴근" 같은 지시를 받으면 원문을 `~/.claude/autorun/<세션 이름>.md` 에 저장한다(신호가 약하거나 예로 든 글이면 저장 여부를 모델이 판단, "무인 진행 꺼"로 끔). 이 파일이 있는 세션만: compact·resume 직후 지시를 다시 넣고, 멈추려 하면 한 번 되돌린다. 파일에 `status: done` 을 쓰면 꺼진다. 10분 자기 알림 cron 대신 쓴다. mod API 는 멈춤을 막을 수 없어 command hook 으로 둔다 | — |
| `home/agents/Explore.md` | subagent | 내장 `Explore` 를 같은 이름으로 덮어 Haiku 로 돌린다. 읽기 전용 탐색, 한국어 보고 | — |
| `tools/usage/` | 측정 스크립트 | `~/.claude/projects` 기록으로 일·모델·세션·context 분포·tool 출력 크기(`analyze_usage.py`)와 턴을 시작한 주체별 비용(`turn_attribution.py`)을 낸다 | `python tools/usage/analyze_usage.py 2026-11-12 2026-11-13` |
| `home/ccstatusline/` | 상태줄 | 모델·브랜치·변경·**캐시 타이머·적중률**·compaction 횟수 (캐시 값은 mod API 에 없어 상태줄이 맡는다) | — |

## 토큰 절감 설정

설치하면 아래가 함께 들어간다. 근거는 2026-11 사용량 분석이다. 그달 비용의 90%가 긴 context 재읽기와 cache 쓰기였다.

| 설정 | 값 | 하는 일 |
|---|---|---|
| `autoCompactWindow` | `300000` | 1M context 모델도 300k에서 compact 한다. 기본값으로는 1M 가까이 가서야 compact 한다 |
| `env.CLAUDE_CODE_SUBAGENT_MODEL` | `sonnet` | 모델을 지정하지 않은 subagent(general-purpose, Explore 등)를 Sonnet으로 돌린다. 레포 agent가 `model:`을 지정했으면 그 값을 따른다 |
| `promptCacheTtl` | `1h` | 쉬었다 돌아와도 cache가 남는다. API key·Bedrock은 기본값이 5분이다 |
| `skillOverrides` | 거의 안 쓰는 문서 skill 9개 `name-only` | 매 호출에 실리는 skill 설명문을 줄인다. 이름은 남아 모델이 여전히 부를 수 있다 |
| `home/agents/Explore.md` | `model: haiku` | 넓은 코드 탐색 subagent를 Haiku로 돌린다. 새 세션부터 적용된다 |
| `home/hooks/autorun.mjs` | hook 3개 | 10분 자기 알림 cron 없이 무인 진행 |
| `home/CLAUDE.md` | 결과 카드·도구 사용 규칙 | 작업이 바뀌면 `/clear` 후 새 세션으로 하라고 안내한다. 짧은 명령은 foreground로, subagent는 필요한 만큼만, 넓은 탐색은 `Explore`로 |

- 기기별 값(`model`, Bedrock `env`, 권한)은 넣지 않는다. 각 PC의 `settings.json`에 둔다.
- 측정: `PYTHONUTF8=1 python tools/usage/analyze_usage.py <시작일> <끝일(미포함)>`. 인자를 생략하면 이번 달 1일부터 본다.

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

## 업데이트

다른 PC(맥북 등)에서 이 레포의 새 내용을 받을 때마다 아래 두 줄을 실행한다.

```bash
cd kjham-cc && git pull
./bootstrap/install.sh            # macOS
.\bootstrap\install.ps1           # Windows
```

| 바뀐 것 | pull 만으로 반영 | 설치 스크립트 필요 | 적용 시점 |
|---|---|---|---|
| mod·스킬(`plugins/`) | ✗ | ✓ 마켓플레이스 갱신·재설치 | 열린 세션은 `/reload-plugins` |
| 설정(`home/settings.base.json`) | ✗ | ✓ `~/.claude/settings.json` 에 병합 | hook·`promptCacheTtl` 은 바로, `autoCompactWindow`·`env` 는 새 세션부터 |
| 전역 지침(`home/CLAUDE.md`) | ✗ | ✓ `~/.claude/CLAUDE.md` 로 복사 | 새 세션 또는 `/clear` 뒤 |
| hook 스크립트(`home/hooks/`) | ✗ | ✓ `~/.claude/hooks/` 로 복사 | 바로 |
| subagent 정의(`home/agents/`) | ✗ | ✓ `~/.claude/agents/` 로 복사 | 새 세션부터 |
| 측정 스크립트(`tools/`) | ✓ | — | 바로 |

- 같은 내용을 다시 설치해도 안전하다. 바뀐 파일만 백업 후 덮어쓰고 나머지는 `(변경 없음)` 으로 건너뛴다.
- 반영됐는지 확인: `grep -E 'autoCompactWindow|UserPromptSubmit' ~/.claude/settings.json` 이 두 줄을 내면 최신이다.

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
