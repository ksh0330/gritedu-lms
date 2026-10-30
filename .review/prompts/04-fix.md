# Phase 4 — 작업 패키지 구현

실행 지시문으로 `PACKAGE`(예: `WP-01`)와 `PLAN`(IMPROVEMENT_PLAN.md 경로)이 전달된다.

## 시작 전
1. `AGENTS.md`, `.agents/rules/review-protocol.md`를 읽는다.
2. `PLAN`에서 `PACKAGE` 항목과 그에 포함된 `F-xxx` 상세를 `REPORT.md`(같은 폴더)에서 읽는다.
3. `git status`와 현재 브랜치를 확인한다. 브랜치가 `fix/<PACKAGE>`가 아니면 멈추고 사람에게 알린다.
4. 구현 계획을 5~10줄로 먼저 제시하고, 사람의 확인을 받은 뒤 수정을 시작한다.

## 구현 규칙
- 패키지의 "수정 파일" 범위만 고친다. 범위를 넘어야 하면 멈추고 이유를 설명한다.
- 최소 변경. 기존 UI·URL·DOM·이벤트·데이터 계약을 보존한다. 관련 없는 정리·리팩터링 금지.
- 신규 Function export, 실시간 listener, summary/counter 컬렉션 추가 금지 (패키지에 `승인 필요`로 승인된 경우만 예외).
- 테스트를 먼저 추가하거나 함께 추가한다. Rules 변경은 Emulator 테스트 케이스를 포함한다.
- `docs/MAINTENANCE_LOG.md`에 패키지의 초안 엔트리를 추가한다 (상태 `Implemented`는 로컬 검사 통과 후에만).
- commit, push, 배포는 하지 않는다. 사람이 diff 리뷰 후 결정한다.

## 끝나기 전 실행
```
npm run check:rules:strict
npm run check:functions:strict
npm --prefix functions test          # functions를 건드린 경우
node --test tests/<관련 테스트>.test.js
git diff --check
git diff --stat
```
Rules 변경 시 (Java 필요): `firebase emulators:exec --only firestore --project gritedu-lms "node --test tests/<관련>.test.js"`

## 마지막 응답
- 변경 파일과 이유 (파일별 한 줄)
- 실행한 검사와 결과
- 사람이 해야 할 일: diff 리뷰 → 교차 리뷰(`run-review.ps1 -Phase review-diff`) → commit → 해당 배포 단위만 배포 → 운영 확인
