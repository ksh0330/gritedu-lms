# 멀티 에이전트 리뷰 키트 사용법 (Claude · Codex · Gemini)

## 구성

```
CLAUDE.md                       Claude 진입점 (@AGENTS.md + 리뷰 프로토콜 import, 역할)
GEMINI.md                       Gemini(agy) 역할. agy는 AGENTS.md도 직접 읽음
AGENTS.md                       (기존, 수정하지 않음) Codex·agy가 읽는 공통 원칙
.agents/
  rules/review-protocol.md      공통 리뷰 규칙: 모드, 근거, 심각도, 발견 사항 형식
  skills/*/SKILL.md             공통 스킬 4개 (Codex·agy는 여기서, Claude는 .claude/skills 복사본에서 로드)
  hooks/guard.mjs               PreToolUse 가드 (배포·push·비밀파일·audit 중 쓰기 차단)
  hooks/session-context.mjs     SessionStart: 브랜치·모드·변경 수를 에이전트에 주입
.claude/settings.json           Claude 권한(allow/deny) + 훅 등록
.codex/config.toml              Codex 모델/추론/샌드박스 기본값 + audit/verify/fix 프로필
.codex/hooks.json               Codex 훅 등록 (Windows는 commandWindows 사용)
.review/prompts/                단계별 프롬프트 01~05
.review/runs/<RUN_ID>/          실행 결과 (보고서·로그·run.json)
tools/agents/*.ps1              PowerShell 실행기
```

## 모델·추론 수준 (tools/agents/common.ps1 에서 변경)

| 단계 | Claude (opus = Opus 5.5) | Codex (gpt-6.1-sol) | Gemini (agy, Argon) |
|---|---|---|---|
| 1 독립 감사 | `xhigh` — Rules·Auth | `xhigh` — Functions·테스트·스크립트 | `gemini-4-argon-high` / `high` — 전체 sweep·문서 |
| 2 교차검증 | `high` (Codex 보고서 검증) | `medium` (Gemini 보고서 검증) | `gemini-4-argon-medium` / `medium` (Claude 보고서 검증) |
| 3 종합 | `xhigh` (단독) | – | – |
| 4 구현 | `high` | `high` | `high` |
| 5 diff 리뷰 | `high` | `high` | `high` |

`max`는 비용이 크고 Claude는 settings에 저장되지 않으므로, P0 재검증처럼 꼭 필요한 한 번에만 `common.ps1`에서 올린다.

## 순서

```powershell
cd D:\gritedu-lms
powershell -ExecutionPolicy Bypass -File tools\agents\setup-agents.ps1 -InstallDeps   # 1회
# (setup이 출력하는 claude / codex / agy 1회 trust·확인 절차 수행)

.\tools\agents\run-review.ps1 -Phase audit        # 3개 병렬, 20~60분
.\tools\agents\run-review.ps1 -Phase verify       # 교차검증 (claude→codex, codex→gemini, gemini→claude)
.\tools\agents\run-review.ps1 -Phase synthesize   # REPORT.md + IMPROVEMENT_PLAN.md
#   또는 한 번에: -Phase all

# 사람: REPORT.md / IMPROVEMENT_PLAN.md 검토 → 진행할 WP 결정

.\tools\agents\run-fix.ps1 -Package WP-01 -Agent claude           # 대화형 구현 (fix/WP-01 브랜치)
.\tools\agents\run-review.ps1 -Phase review-diff -Branch fix/WP-01 -Reviewer codex
```

PowerShell 7(`pwsh`) 권장. 5.1에서도 동작하도록 작성했지만 한글 출력은 7이 안정적이다 (`winget install Microsoft.PowerShell`).

## 안전장치 3겹

1. **CLI 자체 제한** — Codex `-s read-only`, Claude `--allowedTools`/`--disallowedTools`, agy 헤드리스의 승인 필요 도구 soft-deny
2. **훅** — `guard.mjs`가 `firebase deploy`, `git push`, `wrangler`, `--write` 마이그레이션, `.env`·서비스 계정 키, audit 모드의 `.review/` 밖 쓰기를 exit 2로 차단 (Claude·Codex 공통)
3. **사람** — commit·push·배포는 스크립트가 절대 하지 않는다

훅은 Node가 없거나 스크립트가 깨지면 **통과(fail-open)** 한다. setup의 smoke test 결과를 확인할 것.
agy 훅 스키마는 공개 문서가 아직 불명확해 등록하지 않았다. Gemini는 감사·검증에서 파일을 쓰지 않는 역할로만 쓴다.

## 문제 해결

- **보고서가 비었거나 짧음** → `.review/runs/<RUN_ID>/logs/*.log` 확인. Codex는 trust 안 된 프로젝트면 AGENTS.md를 무시한다.
- **Gemini가 파일을 못 읽음** → agy 권한 설정(`~/.gemini/antigravity-cli/settings.json`의 `permissions.allow`)에 읽기 허용 추가, 또는 `agy` 대화형으로 한 번 실행해 권한 확인.
- **모델 slug 오류** → `agy models`, `codex` 의 `/model`, `claude` 의 `/model` 로 실제 이름 확인 후 `common.ps1` 수정.
- **Claude 종합 단계에서 파일 쓰기 거부** → 최종 응답의 `<<<REPORT.md>>>` 구분선으로 자동 분리 저장된다.
- **.review/runs 를 커밋할지** → 선택. 원본 운영 레포로 옮길 때는 canonical 문서(`docs/MAINTENANCE_LOG.md` 등)에 승인된 결과만 반영하고 runs는 제외한다.
