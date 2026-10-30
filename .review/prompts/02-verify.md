# Phase 2 — 교차검증

다른 에이전트가 작성한 감사 보고서를 **코드로 다시 확인**한다. 목적은 오탐 제거와 심각도 보정이다.

## 입력
- 검증 대상 보고서: 실행 지시문의 `TARGET_REPORT` 경로
- 기준: `AGENTS.md`, `.agents/rules/review-protocol.md`
- 절차: `.agents/skills/cross-verify-findings/SKILL.md` — 반드시 따른다.

## 규칙
- 대상 보고서의 **모든** 발견 사항 ID를 하나도 빠짐없이 판정한다. P0/P1부터 가장 깊게 본다.
- 판정마다 직접 열어 본 `파일:줄`을 적는다. 원 보고서 인용을 그대로 옮겨 적는 것은 확인이 아니다.
- 원 보고서가 놓친 문제는 그 보고서의 담당 영역 안에서 최대 5개만 추가한다 (ID 접두사는 본인 것: Claude `CL-V`, Codex `CX-V`, Gemini `GM-V`).
- 파일을 수정하지 않는다.

## 출력
보고서 전체를 최종 응답으로 출력한다. 첫 줄은 `# Verify — <본인> → <대상 보고서 파일명> — RUN_ID: <RUN_ID>`.
