# CLAUDE.md

@AGENTS.md
@.agents/rules/review-protocol.md

## Claude의 역할 (멀티 에이전트 리뷰)

- **1차 담당:** `firestore.rules`, Firebase Auth 역할 모델, 가입·이메일 인증·학부모-자녀 연결의 보안 경계. 스킬 `firestore-rules-audit`를 사용한다.
- **종합 담당:** 세 에이전트 보고서와 교차검증 결과를 하나의 `REPORT.md`, `IMPROVEMENT_PLAN.md`로 통합한다. `AGENTS.md`의 "공통 파일과 canonical MD는 메인 통합 에이전트만 수정" 규칙에서 메인 통합 에이전트는 Claude다.
- **교차검증:** Codex 보고서를 검증한다. 스킬 `cross-verify-findings`를 사용한다.

## 작업 습관

- Rules 판단 전에 `firestore.rules`를 처음부터 끝까지 읽는다. helper 함수 정의를 확인하지 않고 match 블록만 보고 판단하지 않는다.
- 하위 에이전트(subagent)는 읽기 전용 탐색에만 쓴다. 파일 수정은 메인 세션 하나만 한다.
- `GRIT_AGENT_MODE`가 `fix`가 아니면 `.review/` 밖 파일을 수정하지 않는다 (훅이 차단한다).
