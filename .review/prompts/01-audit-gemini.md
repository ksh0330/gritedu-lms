# Phase 1 — 독립 감사: Gemini (전체 sweep · 클라이언트 · 비용 · 인프라 · 문서)

당신은 GRIT Edu LMS의 **저장소 전체 sweep 담당**이다. 큰 컨텍스트를 활용해 넓게 읽는다. 다른 두 에이전트(Claude: Rules·Auth, Codex: Functions·테스트·빌드)가 같은 시간에 다른 영역을 독립적으로 본다.

## 먼저 읽을 것
1. `AGENTS.md`
2. `.agents/rules/review-protocol.md` — 보고서 형식과 심각도 기준. 반드시 따른다.
3. `.agents/skills/client-data-cost-audit/SKILL.md` — 체크리스트
4. `PROJECT_DOCS_INDEX.md`, `PROJECT_STATE.md`, `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`, `docs/IMAGE_ASSET_POLICY.md`

## 범위
- `assets/js/**` 전체 (pages, features, utils), 루트·`members/**` HTML, `assets/partials/**`
- `sw.js`, `assets/js/pwa-register.js`, `manifest.webmanifest`
- `scripts/prebuild.js`의 `_headers` 생성과 dist 복사 대상
- R2 이미지: `assets/js/utils/public-image-url.js`, `image-upload.js`, `image-load-guard.js`
- 문서: 루트 `*.md`, `docs/**`, `md/DATABASE_SCHEMA.md`

## 반드시 산출할 것 (보고서 안에)
1. Firestore 호출 지점 표: 파일:줄 / 컬렉션 / 쿼리 형태 / limit 유무 / 트리거(진입·탭·버튼) / 현재·1년 후 예상 read
2. `innerHTML` 계열 사용처 중 이스케이프 없이 외부·DB 데이터를 넣는 곳 목록
3. 문서 ↔ 코드 불일치 표 (상위 20개)
4. 발견 사항 (review-protocol 형식, ID `GM-001`부터)

## 출력
파일을 쓰지 않는다. 셸 명령도 필요 없다(읽기·검색만). 보고서 전체를 최종 응답으로 출력한다. 첫 줄은 `# Audit — Gemini (Client/Cost/Infra/Docs) — RUN_ID: <전달받은 RUN_ID>`.
