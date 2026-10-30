# Phase 3 — 종합 보고서와 개선안 (Claude 전담)

`OUTPUT_DIR`(실행 지시문에 전달됨) 안의 다음 파일을 모두 읽는다.
- `01-audit-claude.md`, `01-audit-codex.md`, `01-audit-gemini.md`
- `02-verify-claude.md`, `02-verify-codex.md`, `02-verify-gemini.md`

없는 파일이 있으면 보고서 맨 앞에 명시하고 있는 자료만으로 진행한다.

## 1. `OUTPUT_DIR/REPORT.md` — 종합 검토 보고서

1. **요약** (10줄 이내): 전체 위험 수준, P0/P1 개수, 가장 먼저 할 일 3가지
2. **합의 상태별 발견 사항 표**: 통합 ID(`F-001`…) / 원 ID들 / 최종 등급 / 합의 상태 / 영역 / 배포 단위 / 한 줄 제목
   - 합의 상태: `확정`(원 작성자 + 검증자 CONFIRMED/ADJUSTED) · `기각`(REJECTED, 반박 근거 유지) · `런타임 확인 필요` · `단독`(검증 안 됨)
   - 여러 에이전트가 같은 문제를 다른 ID로 보고했으면 하나로 합치고 원 ID를 모두 남긴다.
   - 검증자와 원 작성자의 판정이 충돌하면, 직접 코드를 확인해 결론을 내고 그 근거를 적는다.
3. **발견 사항 상세** (확정·런타임 확인 필요만, P0→P3): 위치, 근거, 시나리오, 개선안, 검증 방법
4. **기각된 항목 목록**: 한 줄씩, 기각 근거 `파일:줄`
5. **운영 확인이 필요한 항목** (Firebase Console, Cloudflare, 실제 계정 smoke test): 누가 무엇을 어떻게 확인하는지 체크리스트
6. **문서 ↔ 코드 불일치 요약**
7. **에이전트별 관점 차이**: 어떤 종류의 문제를 누가 잘 찾았고 무엇을 놓쳤는지 (다음 리뷰 개선용, 3~6줄)

## 2. `OUTPUT_DIR/IMPROVEMENT_PLAN.md` — 개선 작업 패키지

`AGENTS.md`의 "한 번에 한 문제·한 기능 영역", "정적/Rules/Functions 배포 분리" 원칙에 맞춰 작업 패키지로 나눈다.

각 패키지 형식:
```markdown
### WP-01 [P0] 제목
- 포함 발견 사항: F-001, F-004
- 배포 단위: rules   (static | rules | functions | data-migration | docs) — 하나만
- 수정 파일(예상): firestore.rules, tests/approval-course-rules.test.js
- 권장 구현 에이전트 / 리뷰 에이전트: Claude / Codex
- 변경 요지: (최소 변경, 기존 UI·URL·데이터 계약 보존)
- 테스트: 실행할 기존 명령 + 추가할 테스트 케이스
- 배포 절차: 사람이 실행할 명령 (예: npm run deploy:rules) — 에이전트는 실행하지 않음
- 롤백: ...
- 승인 필요: 없음 | 신규 Function | 스키마 변경 | 운영 데이터 변경 | UI 변경
- MAINTENANCE_LOG 초안: (docs/MAINTENANCE_LOG.md 형식의 엔트리 초안, 상태 Open)
```

- 순서: P0 → P1 → P2. 같은 등급 안에서는 배포 위험이 낮은 것 먼저.
- P3와 문서 정리는 마지막 `WP-DOCS` 하나로 묶는다.
- 구현 에이전트 배정 기준: Rules/Auth → Claude, Functions/스크립트/테스트 → Codex, 클라이언트 JS/문서 → Codex 또는 Gemini. 리뷰는 구현자와 다른 에이전트.

## 출력 방법
- `OUTPUT_DIR` 아래에 위 두 파일을 쓴다 (`.review/` 아래 쓰기만 허용된다).
- 파일 쓰기가 거부되면, 최종 응답에 `<<<REPORT.md>>>` 와 `<<<IMPROVEMENT_PLAN.md>>>` 구분선으로 두 문서를 모두 출력한다.
- 최종 응답 마지막에 P0/P1 개수와 WP 목록을 5줄 이내로 요약한다.
- 저장소의 다른 파일(canonical 문서 포함)은 수정하지 않는다. canonical 반영은 사람이 승인한 뒤 별도 작업으로 한다.
