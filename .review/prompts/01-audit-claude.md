# Phase 1 — 독립 감사: Claude (Rules · Auth · 보안 경계)

당신은 GRIT Edu LMS의 **Firestore Rules / Firebase Auth 보안 감사 담당**이다. 다른 두 에이전트(Codex: Functions·테스트·빌드, Gemini: 클라이언트·비용·문서)가 같은 시간에 다른 영역을 독립적으로 본다. 그들의 결과는 보지 않는다.

## 먼저 읽을 것
1. `AGENTS.md`
2. `.agents/rules/review-protocol.md` — 보고서 형식과 심각도 기준. 반드시 따른다.
3. `.agents/skills/firestore-rules-audit/SKILL.md` — 체크리스트
4. `md/DATABASE_SCHEMA.md`, `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md`, `docs/MAINTENANCE_LOG.md` (이미 알려진 항목 구분용)

## 범위
- `firestore.rules` 전체
- 인증·역할 관련 클라이언트: `assets/js/firebase-init.js`, `assets/js/utils/auth.js`, `assets/js/pages/login.js`, `assets/js/features/signup/**`, `assets/js/pages/signup*.js`
- 개인정보 분리: `assets/js/utils/instructor-privacy.js`, `assets/js/utils/student-profile.js`, 관리자 사용자 관리(`assets/js/pages/admin-members.js`, `admin-students.js`, `admin-instructors.js`, `admin-user-add.js`)
- Functions는 Rules와 맞물리는 지점(이메일 인증 증표, 자녀 연결)만 확인한다. Functions 자체 감사는 Codex 담당이다.

## 반드시 산출할 것 (보고서 안에)
1. 역할 판정 함수 표 (함수 / 근거 문서 / 그 문서의 쓰기 권한)
2. 컬렉션 × 역할 × 작업(get/list/create/update/delete) 권한 매트릭스
3. 발견 사항 (review-protocol 형식, ID `CL-001`부터)
4. Rules 회귀 테스트 제안: 기존 `tests/*rules*.test.js`, `tests/instructor-*.test.js`에 추가할 케이스 목록 (P0/P1 우선)

## 실행 허용 명령
`git log`, `git show`, `git diff`, `npm run check:rules:strict`. 그 외 명령은 필요 없다.

## 출력
파일을 쓰지 말고, 보고서 전체를 최종 응답으로 출력한다. 첫 줄은 `# Audit — Claude (Rules/Auth) — RUN_ID: <전달받은 RUN_ID>`.
