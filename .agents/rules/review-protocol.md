# Multi-Agent Review Protocol (GRIT Edu LMS)

이 문서는 Claude / Codex / Gemini 세 에이전트가 이 저장소를 **분석·검토·검증·개선**할 때 공통으로 따르는 규칙이다.
`AGENTS.md`의 제품·비용·배포 원칙이 항상 우선하며, 이 문서는 그 위에 "리뷰 작업 방식"만 추가한다.

## 1. 작업 모드

환경변수 `GRIT_AGENT_MODE`가 모드를 정한다. 값이 없으면 `audit`로 간주한다.

| 모드 | 허용 | 금지 |
|---|---|---|
| `audit` (분석·교차검증·종합) | 파일 읽기, 검색, `git log/diff/show/status`, 저장소 기존 검사 명령 실행 | `.review/` 밖 파일 생성·수정, 의존성 설치, commit, branch 전환 |
| `fix` (승인된 작업 패키지 구현) | 지정된 작업 패키지 범위 파일 수정, 테스트 실행 | 범위 밖 수정, 배포, push, 운영 데이터 접근 |

모든 모드 공통 금지 (훅이 차단한다):
- `firebase deploy`, `firebase firestore:delete`, `functions:delete`, `wrangler` 배포·R2 쓰기, `gcloud`, `gsutil rm/cp`
- `git push`, `git reset --hard`, `git clean -f`, force 계열 명령
- `scripts/*` 마이그레이션의 `--write` 실행, `npm run *:write`
- `.env*`, `serviceAccountKey*.json`, `md/appPW.md` 읽기
- 운영 Firebase 프로젝트(`gritedu-lms`)에 대한 실제 read/write. Emulator만 허용.
- 에이전트 설정(`.agents/hooks/**`, `.claude/settings.json`, `.codex/**`) 수정

## 2. 근거 규칙

- 모든 발견 사항은 `파일경로:시작줄-끝줄`과 해당 코드 발췌(10줄 이하)를 포함한다. 줄 번호는 실제로 파일을 읽어서 확인한 값만 쓴다. 추정 줄 번호 금지.
- 근거 종류를 반드시 구분한다.
  - `코드` — 실행 코드, `firestore.rules`, `functions/**`, `firebase.json`, `package.json`에서 직접 확인
  - `문서` — MD 문서에만 근거 (코드와 다를 수 있음)
  - `운영 미확인` — Firebase Console / Cloudflare / 실제 데이터 확인이 필요
- "~일 수 있다"로 끝나는 막연한 지적은 금지. 공격·실패 시나리오를 구체적 단계로 적거나, 확인 방법을 적는다.
- 이미 `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md` 또는 `docs/MAINTENANCE_LOG.md`에 기록·해결된 항목은 "기존 기록"으로 표시하고 새 발견처럼 쓰지 않는다. 기록과 코드가 다르면 그 차이를 발견 사항으로 쓴다.

## 3. 심각도

| 등급 | 기준 |
|---|---|
| P0 | 개인정보 노출, 권한 상승, 타인 데이터 쓰기/삭제, 운영 데이터 손실이 현재 코드로 가능 |
| P1 | 조건부로 악용 가능한 보안 약점, 비용 폭증(무제한 read/쓰기/메일 발송), 핵심 흐름(가입·로그인·수강) 장애 |
| P2 | 정확성·견고성 결함, 경쟁 조건, 오류 처리 누락, 사용자 영향이 있는 성능 문제 |
| P3 | 유지보수성, 문서 불일치, 정리 대상 |

확신도: `High`(코드로 재현 경로 확인) / `Medium`(코드상 가능, 실행 미확인) / `Low`(정황).

## 4. 발견 사항 형식

에이전트별 ID 접두사: Claude `CL-`, Codex `CX-`, Gemini `GM-` (예: `CL-007`).

```markdown
### CL-007 [P1/High] 한 줄 제목

- 영역: Rules | Auth | Functions | Client | Build/Deploy | Infra(R2/Pages) | Docs
- 위치: `firestore.rules:652-668`
- 근거 종류: 코드
- 근거:
  ```
  (발췌 10줄 이하)
  ```
- 시나리오: 1) ... 2) ... 3) 결과
- 영향: 누가 / 무엇을 / 얼마나
- 개선안: 최소 변경 원칙의 구체적 수정 방향 (필요 시 diff 스케치)
- 배포 단위: static | rules | functions | data-migration | none
- 검증 방법: 어떤 테스트/Emulator/수동 확인으로 수정 효과를 확인하는지
- 승인 필요: 없음 | 신규 Function | 스키마 변경 | 운영 데이터 변경 | UI 변경
```

## 5. 보고서 구조 (audit 단계)

1. 범위와 실제로 읽은 파일 목록 (읽지 못한 파일은 이유와 함께)
2. 실행한 명령과 결과 요약 (실패한 명령 포함)
3. 요약 표: ID / 등급 / 확신도 / 제목 / 배포 단위
4. 발견 사항 상세 (P0 → P3 순)
5. 담당 영역 밖에서 본 것 (최대 5개, 한 줄씩)
6. 확인하지 못한 것과 다음에 확인할 방법

## 6. 출력 규칙

- 보고서는 한국어로 작성한다. 코드·경로·명령은 원문 유지.
- `audit` / `verify` 단계에서는 파일을 쓰지 말고 **최종 응답 전체를 보고서로** 출력한다. 실행 스크립트가 최종 응답을 그대로 저장한다.
- 보고서에 비밀값, 이메일, 전화번호, 운영 문서 내용, OTP를 쓰지 않는다.
- UI 재설계·"단순화" 명목의 제거·신규 Function·신규 실시간 listener 제안은 `승인 필요`로 표시하고 대안(기존 흐름 위 최소 변경)을 함께 적는다.
