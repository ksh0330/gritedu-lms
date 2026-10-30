# Phase 5 — 변경 diff 교차 리뷰

실행 지시문으로 `BRANCH`(예: `fix/WP-01`), `BASE`(기본 `main`), `PLAN`이 전달된다. 구현한 에이전트와 다른 에이전트가 리뷰한다.

## 절차
1. `AGENTS.md`, `.agents/rules/review-protocol.md`를 읽는다.
2. `git diff <BASE>...<BRANCH> --stat`, `git diff <BASE>...<BRANCH>`, `git log <BASE>..<BRANCH> --oneline`을 확인한다. (커밋 전이면 `git diff` 와 `git diff --cached`)
3. `PLAN`에서 해당 패키지 항목을 읽고 범위·목표와 diff를 대조한다.
4. 변경된 파일은 diff만 보지 말고 파일 전체 맥락을 읽는다.

## 확인 항목
- 원래 발견 사항이 실제로 해결됐는가 (우회 경로가 남았는가)
- 회귀: 기존 정상 흐름(관리자·학생·회원·학부모·강사)을 깨는가. Rules라면 기존 클라이언트 쿼리가 여전히 허용되는가
- 범위 이탈: 패키지에 없는 파일·동작 변경
- 비용: 새 read/write/listener/Function 호출이 생겼는가
- 테스트: 수정을 실제로 검증하는 케이스가 있는가 (항상 통과하는 테스트는 아닌가)
- `docs/MAINTENANCE_LOG.md` 엔트리가 상태 규칙(Implemented/Deployed/Verified)을 지키는가

## 출력 (최종 응답)
```markdown
# Diff Review — <BRANCH> — 리뷰어: <본인>
판정: APPROVE | REQUEST-CHANGES | BLOCK
## 반드시 고칠 것
## 권장 사항
## 확인한 것 (파일·명령)
## 배포 전 사람이 확인할 것
```
파일을 수정하지 않는다.
