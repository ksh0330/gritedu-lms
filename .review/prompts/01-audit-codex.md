# Phase 1 — 독립 감사: Codex (Functions · 테스트 · 빌드/스크립트)

당신은 GRIT Edu LMS의 **Cloud Functions · 테스트 · 빌드/운영 스크립트 감사 담당**이다. 다른 두 에이전트(Claude: Rules·Auth, Gemini: 클라이언트·비용·문서)가 같은 시간에 다른 영역을 독립적으로 본다.

## 먼저 읽을 것
1. `AGENTS.md`
2. `.agents/rules/review-protocol.md` — 보고서 형식과 심각도 기준. 반드시 따른다.
3. `.agents/skills/firebase-functions-audit/SKILL.md` — 체크리스트
4. `docs/MAINTENANCE_LOG.md`, `docs/OPERATION_MANUAL.md`, `docs/BUILD_AND_DEPLOY.md` (이미 알려진 항목·운영 절차 구분용)

## 범위
- `functions/**` 전체 (`index.js`, policy 모듈, `record-cleanup.js`, `offline-session-cleanup.js`, `scripts/`, `test/`), `functions/package.json`
- 운영 데이터를 건드릴 수 있는 `scripts/*.js` (migrate/cleanup/backfill/audit): dry-run 기본값, `--write` 가드, 대상 제한, 서비스 계정 사용 방식
- 빌드 파이프라인: `scripts/prebuild.js`, `scripts/ensure-dist.js`, `scripts/verify-build.js`, `scripts/check-rules.js`, `scripts/check-functions.js`
- 테스트 체계: `tests/**`, `functions/test/**` — 무엇을 검증하고 무엇을 검증하지 않는지

## 실행할 검사 (읽기 전용 샌드박스, 의존성은 이미 설치되어 있다고 가정)
아래를 실행하고 결과를 보고서 "실행한 명령" 절에 적는다. 실패해도 계속 진행하고, 실패 원인(샌드박스 제한 / Emulator 필요 / 실제 결함)을 구분한다.
```
npm --prefix functions test
npm --prefix functions run lint
npm run check:functions:strict
npm run check:rules:strict
node --test tests/
```
`node --test tests/` 중 Emulator가 필요한 테스트는 실패할 수 있다. 어떤 파일이 Emulator 의존인지 표로 정리한다.
설치(`npm ci`), 빌드(`npm run build`), 배포, 마이그레이션 `--write`는 실행하지 않는다.

## 반드시 산출할 것 (보고서 안에)
1. Function별 요약 표 (호출자 / 입력검증 / 남용방지 / 1회 비용 / transaction / 비밀·로그)
2. 테스트 커버리지 표 (대상 / 검증 내용 / 빠진 경로)
3. 발견 사항 (review-protocol 형식, ID `CX-001`부터)
4. 운영 스크립트 위험도 표 (스크립트 / 기본 동작 / 쓰기 조건 / 위험)

## 출력
파일을 쓰지 말고, 보고서 전체를 최종 응답으로 출력한다. 첫 줄은 `# Audit — Codex (Functions/Tests/Build) — RUN_ID: <전달받은 RUN_ID>`.
