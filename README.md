# kjham-cc

Claude Code·Codex 개인 설정 저장소. Claude Code mods와 hook, Codex 지침·스킬·선택형 CLI 프로필을 Windows·macOS에 배포한다. 제품별 설정과 기록은 분리한다.
설계 배경 문서는 별도 보관.

> **다른 PC에서 최신 내용을 받을 때는 `git pull` 뒤에 설치 스크립트를 다시 실행해야 한다.** 설정·전역 지침·hook 은 `~/.claude` 로 복사되는 파일이라 pull 만으로는 바뀌지 않는다. 아래 [업데이트](#업데이트) 참고.

## 구성

| 이름 | 종류 | 하는 일 | 명령 |
|---|---|---|---|
| `usage-hud` | mod | 입력창 위 한 줄: 5시간·주간 한도와 초기화까지 남은 시간, 소진 예상 시각, compact 까지 남은 토큰, 컨텍스트, 세션 비용, Claude 장애. 한도 값은 모든 세션이 공유해 쉬는 세션도 최신값을 보인다 | `/hud` 패널 |
| `fleet` | mod | 세션 현황·진행도를 보고, 결과 카드의 남은 일과 결정 필요를 세션 종료 후에도 보관한다 | `/sessions` 패널 |
| `session-nickname` | mod | 이름 없는 대화형 세션에 별명을 붙이고 입력창 힌트에 표시한다. 기존 이름·resume 세션은 보존한다 | `/rename`으로 변경 |
| `long-turn-notify` | mod | 2분 이상 작업의 완료·오류, 질문·권한 대기를 Windows·macOS 알림으로 표시한다. 기본 무음 | — |
| `compact-tool-rows` | mod | 정상 접힌 Bash 행은 화면 폭에 맞춰 줄이고 펼침·실패·중단 행에서는 원문을 보여 준다 | — |
| `ko-guard` | mod | 매 턴 한국어·결과 카드 상기, 영어 답변 감지 toast, 감지 통계 | `/ko`, `/ko-stats` |
| `turn-divider` | mod | 내 질문 위에 구분선 | — |
| `slide-craft` | 스킬 | `slide-deck`: 발표 자료를 스토리라인 → 다이어그램 → 제작 → 렌더링 검수 → 정제 → 사실 대조 순으로 만든다. `humanize-ko`: 한국어 글·장표에서 AI 티를 점검표로 걷어 낸다. Codex 가 있는 PC 에는 `~/.codex/skills` 로도 복사된다 | `/slide-craft:slide-deck`, `/slide-craft:humanize-ko` |
| `agent-radar` | 서드파티 mod | 실행 중인 서브에이전트당 한 줄 (hamzafer/claude-code-mods, 커밋 고정) | `/radar` |
| `home/CLAUDE.md` | 전역 지침 | 한국어 규칙, **결과 카드** 형식(`fleet` 이 읽어 세션 현황에 표시) | — |
| `home/settings.base.json` | 설정 | `language: korean`, 상태줄, 마켓플레이스·플러그인 활성화, 무인 진행 hook 등록, 토큰 절감 설정(아래) | — |
| `home/hooks/autorun.mjs` | command hook | 무인 진행. "멈추지 말고", "승인 없이", "퇴근" 같은 지시를 받으면 원문을 `~/.claude/autorun/<세션 이름>.md` 에 저장한다(신호가 약하거나 예로 든 글이면 저장 여부를 모델이 판단, "무인 진행 꺼"로 끔). 이 파일이 있는 세션만: compact·resume 직후 지시를 다시 넣고, 멈추려 하면 한 번 되돌린다. 파일에 `status: done` 을 쓰면 꺼진다. 10분 자기 알림 cron 대신 쓴다. mod API 는 멈춤을 막을 수 없어 command hook 으로 둔다 | — |
| `home/hooks/token-guard.mjs` | command hook | 토큰 절감 알림 3가지. 60분 넘게 쉬었고 context 가 200k 를 넘으면 첫 입력을 한 번 막고 `/compact` 를 권한다(다시 보내면 통과). 30분보다 짧은 반복 cron 은 만들기 전에 확인을 받는다. 새 세션 시작 때 프로젝트 `MEMORY.md` 가 80줄을 넘으면 알린다 | — |
| `home/agents/Explore.md` | subagent | 내장 `Explore` 를 같은 이름으로 덮어 Haiku 로 돌린다. 읽기 전용 탐색, 한국어 보고 | — |
| `tools/usage/` | 측정 스크립트 | `~/.claude/projects` 기록으로 일·모델·세션·context 분포·tool 출력 크기(`analyze_usage.py`)와 턴을 시작한 주체별 비용(`turn_attribution.py`)을 낸다 | `python tools/usage/analyze_usage.py 2026-11-12 2026-11-13` |
| `home/ccstatusline/` | 상태줄 | 모델·브랜치·변경·**캐시 타이머·적중률**·compaction 횟수 (캐시 값은 mod API 에 없어 상태줄이 맡는다) | — |

## 세션 현황과 남은 일

입력창 위에는 대기·작업·새 결과·미해결 항목 수를 짧게 표시한다. `/sessions` 패널은 현재 세션과 보관된 남은 일을 나눈다. 작업 단계 수가 있으면 진행 표시를 붙이며, 기존 테마의 의미별 색상을 따른다.

결과 카드의 `남은 일` 또는 `결정 필요`가 있는 메인 답변을 보관한다. 새 답변이나 세션 종료가 예전 항목을 자동으로 완료시키지 않는다. 패널의 ID를 복사해 정리한다. 유일하게 식별되는 ID 앞부분도 사용할 수 있다.

```text
/sessions done <ID>       완료
/sessions defer <ID>      보류
/sessions reopen <ID>     다시 열기
/sessions history         완료 기록과 ID 조회
```

`완료`, `보류`, `재개`도 명령 인자로 쓸 수 있다. 완료 항목은 패널에 24시간 표시하며 이후에도 `history`에서 찾을 수 있다. 기록은 `fleet`의 로컬 plugin store에 남고, 다른 PC와 동기화되지 않는다. 기존 결과 카드 형식을 활용하므로 진행 기록용 모델 호출을 추가하지 않는다.

알림은 사용자가 중단한 턴과 2분 미만 작업에는 완료 알림을 보내지 않는다. 실행·대기 중인 subagent가 있으면 완료 알림을 미룬다. 질문·권한 대기는 작업 시간과 관계없이 알린다. Windows는 PowerShell의 OS toast, macOS는 `osascript`를 사용하며 실제 표시 여부는 OS 알림 설정에 따른다. 지원하지 않는 OS에서는 알리지 않는다.

세션 별명과 권한 대기 감지는 Claude Code의 `sessions/*.json` 기록을 읽는다. `CLAUDE_CONFIG_DIR`, `USERPROFILE`, `HOME`을 지원한다. 엔진의 기록 형식이 바뀌면 확인이 필요하다. 기존 `wj-mods`의 같은 기능을 함께 활성화하면 이름 변경·알림·화면 처리가 겹칠 수 있다.

`session-nickname`, `long-turn-notify`, `compact-tool-rows`는 [wonjangcloud9/wj-mods](https://github.com/wonjangcloud9/wj-mods/tree/5244bd0f768474cc05e694e3ed6bbcb71ea2ac7c)를 참고·수정했다. 각 plugin에 원본 MIT 고지를 보존한다. `fleet`의 구역 구분과 단순한 상태 기호도 이 저장소의 화면 구성을 참고했다. `usage-hud`, `ko-guard`, `turn-divider`는 기존 구현을 유지하며, 추가 모델 호출이 필요한 `plain-summary`는 포함하지 않는다.

## Codex 적용 범위

| 기능 | Claude Code | Codex |
|---|---|---|
| 개인 지침 | `home/CLAUDE.md` | `codex/AGENTS.md`를 기존 전역 AGENTS의 관리 블록에 병합 |
| 사용량·상태 표시 | `usage-hud`, `fleet` mod | CLI의 `/statusline`, `/usage`, `/title`; 선택형 `kjham-cc` 프로필 |
| 여러 대화 확인 | `/sessions` | 앱 Activity 또는 CLI `codex agents` |
| 완료·입력 대기 알림 | `long-turn-notify` | 앱 기본 알림과 기존 사용자 설정 유지 |
| 개인 남은 일 | 결과 카드에서 자동 수집 | 사용자가 요청할 때 `kjham-followups` 스킬로 보관·조회·완료·보류·재개 |
| 발표 자료·한국어 다듬기 | `slide-craft` plugin | 같은 스킬 원본을 Codex skills에 복사 |

Codex만 설치하려면 다음을 실행한다.

```bash
node bootstrap/install.mjs --target=codex
codex -p kjham-cc
```

첫 명령은 지침과 스킬을 설치하고 `$CODEX_HOME/kjham-cc.config.toml`을 만든다. 두 번째 명령은 CLI에 모델·남은 context·브랜치·현재 디렉터리 상태줄과 프로젝트·상태·대화·진행도 제목을 선택 적용한다. CLI 프로필은 데스크톱 앱의 화면 디자인을 바꾸지 않는다. 앱에서는 새 대화에서 설치된 지침과 스킬을 사용한다.

기존 Codex `config.toml`, `notify`, hooks, 모델·권한·MCP 설정은 수정하지 않는다. Computer Use 등이 쓰는 `notify`를 다른 알림으로 교체하지 않으며 hook 신뢰 승인도 자동 추가하지 않는다. 개인 남은 일은 `$CODEX_HOME/kjham-cc/followups`에 보관해 Claude의 plugin store와 섞이지 않는다. 두 제품 사이에 항목을 자동 복사하거나 동기화하지 않는다.

Codex 기록은 로컬 평문 JSON이다. 비밀키·토큰·개인정보·대화 전문을 넣지 않는다. 파일 자체를 네트워크로 보내는 기능은 없지만 agent가 조회한 출력은 현재 대화에 포함된다. 기존 저장소 작업 기록이 있으면 개인 색인에는 경로와 짧은 다음 행동만 남긴다. 자동 기록 hook이나 별도 모델 호출은 추가하지 않는다.

기존 Claude 배포 경로는 호환성을 위해 유지하고 Codex 전용 파일은 `codex/`에 모았다. 공유 스킬의 원본은 `plugins/slide-craft/skills/` 한 곳이다. 설치 대상은 `--target=claude`, `--target=codex`, `--target=all`로 선택한다. 기본은 `all`이며 Codex 홈이 이미 있는 PC에만 Codex도 설치한다. `--target=codex`는 홈이 없어도 만든다.

공식 설정 근거: [Codex CLI 명령](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [알림](https://learn.chatgpt.com/docs/notifications), [설정](https://learn.chatgpt.com/docs/config-file/config-advanced).

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
| `home/hooks/token-guard.mjs` | hook 3개 | 오래 쉰 큰 세션의 첫 입력 전 `/compact` 권유, 30분 미만 반복 cron 확인, `MEMORY.md` 80줄 초과 알림 |
| `home/CLAUDE.md` | 결과 카드·도구 사용 규칙 | 작업이 바뀌면 `/clear` 후 새 세션으로 하라고 안내한다. 짧은 명령은 foreground로, subagent는 필요한 만큼만, 넓은 탐색은 `Explore`로, 답변은 결론부터 짧게 |

- 기기별 값(`model`, Bedrock `env`, 권한)은 넣지 않는다. 각 PC의 `settings.json`에 둔다.
- 측정: `PYTHONUTF8=1 python tools/usage/analyze_usage.py <시작일> <끝일(미포함)>`. 인자를 생략하면 이번 달 1일부터 본다.

## 설치

Claude Code 2.1.287+, Node 18+ (설치 스크립트·상태줄·hook 용), git.

Windows의 Claude 설치 단계는 native `claude.exe`를 사용한다. shell을 거치지 않아 npm의 `claude.cmd`만 있는 환경은 지원하지 않는다. `--target=codex` 설치에는 Claude 실행 파일이 필요 없다. 새 mod는 Claude Code 2.1.325에서 검증했다.

```bash
git clone https://github.com/kjham/kjham-cc.git
cd kjham-cc
./bootstrap/install.sh            # macOS
.\bootstrap\install.ps1           # Windows
```

- `settings.json` 은 덮어쓰지 않고 병합하며, 바뀌는 파일은 `.bak-<시각>` 으로 백업한다.
- `--dev`: 마켓플레이스를 이 클론 폴더로 등록한다. 편집 후 `/reload-plugins` 만으로 반영된다(주 개발 PC 용).
- `--settings-only`, `--dry-run`, `--target=all|claude|codex` 지원. Codex 단독 설치는 Claude 설정과 marketplace에 접근하지 않는다.
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
node --test bootstrap/codex.test.mjs codex/tests/followups.test.mjs
# Windows PowerShell 문자열 주입 회귀 테스트 — Node 22.6+에서 실행
node --experimental-strip-types --test plugins/long-turn-notify/tests/powershell-string.test.mjs
```

- 타입: 세션이 hot-reload 하는 폴더에서는 엔진이 `.claude-plugin/types/` 를 깔아 준다(커밋 제외).
- 서드파티 mod 는 `marketplace.json` 에서 `sha` 를 고정한다. 올릴 때는 소스를 읽고 `claude plugin validate` 로 calls 를 확인한 뒤 sha 를 바꾼다.

## 알아 둘 제약

- **조직 관리 환경**(Team/Enterprise 로그인)에서는 `prompt.compose`·`classic.*`·`session.compact` 같은 이벤트가 개인 mod 에 오지 않는다(`sec-default` 가 건너뜀). 그래서 언어 고정은 `language` 설정·전역 CLAUDE.md 로 하고, mod 는 매 턴 상기·감지만 한다.
- VS Code 확장 채팅 패널은 입력창 위 띠를 그리지 않는다 → `/hud`, `/sessions` 패널을 쓴다.
- 다른 IDE 창으로 포커스를 옮기는 API 는 없다. `/sessions` 는 어느 레포·브랜치·화면인지까지만 알려 준다.
- 개인 mod 는 공용 레포의 규칙(AGENTS.md, 권한 deny, 리뷰 게이트)을 우회하지 않는다. 이상 동작 재현은 `claude --safe-mode`.
