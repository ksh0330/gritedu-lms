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
- **.review/runs** → 현재 공개 저장소에서는 취약점 상세·로그·임시 브라우저 파일을 업로드하지 않는다. `.gitignore`로 제외하며, 필요한 원본 보고서는 별도 비공개 경로로 전달한다.

## 다른 PC에서 이어서 작업하기 (2026-10-30)

현재 작업은 `main`이 아닌 `codex/urgent-review-20261030`에 저장돼 있다.

```powershell
git clone --branch codex/urgent-review-20261030 https://github.com/ksh0330/gritedu-lms.git
cd gritedu-lms
npm ci
npm --prefix functions ci
```

- 코드 체크포인트: `2f9162a`. 긴급 관리자 출력 이스케이프, SheetJS 버전 고정, 가입 발송 기록 처리, 관련 테스트와 리뷰 키트가 포함된다.
- 현재 상태: 로컬 구현과 자동 검사 완료. **운영 배포 보류**. 저장용 커밋의 `[CF-Pages-Skip]` 표시는 유지한다. `main` merge/push, Firebase deploy, 운영 DB 조회·변경을 자동 실행하지 않는다.
- 검증: `npm run ready:deploy` 통과, Functions 36/36 통과. 루트 테스트 121건 중 113 통과·7 Emulator 미기동 실패·1 건너뜀. `node --test "tests/*.test.js"` 형식을 사용했다. 실제 역할 계정·엑셀·가입 메일·동시성 검증을 완료했다는 의미는 아니다.
- 작업 이력과 현재 제한: `docs/MAINTENANCE_LOG.md`의 2026-10-30 엔트리, 특히 마지막 두 후속 엔트리를 먼저 읽는다. 초기 엔트리와 충돌하면 후속 기록 및 현재 코드를 대조한다.
- 다음 작업: 실제 로그인 화면 및 XLSX 확인, 가입 Function의 공유 IP 동시 요청·재시도·비용 검증. 기존 Rules 권한과 프로필 검증 문제 등은 미해결이며, 이번 수정으로 전체 감사 항목이 해결된 것은 아니다. 기존 보안 이슈는 `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md`도 함께 확인한다.
- 원본 `REPORT.md`, `IMPROVEMENT_PLAN.md`, `FIX_SUMMARY.md`와 리뷰 로그는 `.review/runs/20261030-1153/`에 로컬로만 남는다. clone에는 포함되지 않으므로, 원본 없이 `run-fix.ps1 -RunId 20261030-1153`을 바로 실행하지 않는다. 코드를 직접 검토해 이어가거나 원본을 비공개 방식으로 전달받는다.
- 로컬 Secret, CLI 로그인, 의존성, build 산출물은 clone으로 이동하지 않는다. 필요한 인증은 새 PC에서 직접 설정하고 값을 소스·문서에 기록하지 않는다.
