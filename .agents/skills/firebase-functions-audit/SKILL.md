---
name: firebase-functions-audit
description: Audit the GRIT Edu LMS Cloud Functions (functions/**) for auth, abuse, cost, data-safety, and correctness problems. Use when reviewing or changing linkMemberChild, sendVerificationCode, verifyEmailCode, scheduledRecordCleanup, or their policy modules and tests.
---

# Cloud Functions 감사 체크리스트

운영 export는 `linkMemberChild`, `sendVerificationCode`, `verifyEmailCode`, `scheduledRecordCleanup` 4개뿐이다 (`AGENTS.md`). `functions/index.js`와 `functions/*.js` policy 모듈, `functions/test/**`를 모두 읽는다.
현재 코드는 `firebase-functions/v1` API(1세대 스타일)를 `firebase-functions` v7 패키지에서 쓰고 있다.

## 1. 각 Function마다 표로 정리

| 항목 | 확인 내용 |
|---|---|
| 호출자 | 비로그인 허용? `context.auth` 확인 위치 |
| 입력 검증 | 타입·길이·형식·정규화, 알 수 없는 필드 처리 |
| 남용 방지 | rate limit 키(email/계정/IP), 우회 가능성, App Check 사용 여부 |
| 비용 | 1회 호출당 read/write 수, 메일 발송, 최악의 경우 |
| 데이터 안전 | transaction 사용, 멱등성, 부분 실패 시 상태 |
| 비밀 | `defineSecret` 사용, 로그에 PII/OTP/토큰 출력 여부 |
| 오류 | `HttpsError` 코드 적절성, 내부 오류 메시지 노출, 계정 존재 여부 노출(enumeration) |
| 런타임 | region, timeout, memory, 최대 인스턴스 설정 |

## 2. Function별 집중 포인트

- **sendVerificationCode** (비로그인 호출 가능성 높음): 메일 폭탄·비용 공격, email 5/시간·IP 30/시간 정책이 transaction 안에서 원자적으로 집계되는지(동시 요청 레이스), 공유 NAT 오탐, App Check 부재 시 영향.
- **verifyEmailCode**: OTP 무차별 대입 제한(시도 횟수), 시간 비교가 상수시간인지, 5분 만료가 서버 시간 기준인지, verification-session token은 hash만 저장되는지, 검증 성공 후 재사용 방지.
- **linkMemberChild**: member uid와 학생 매칭 조건(이름·학교·학년·전화) 추측 공격, 결정적 link ID와 counter 갱신이 같은 transaction인지, 실패 응답이 학생 존재 여부를 노출하는지, `memberChildLinkAttempts`에 저장되는 입력 범위와 보관기간.
- **scheduledRecordCleanup**: 03:00 Asia/Seoul 고정, 3개 transient 컬렉션만 `cleanupAt <= now` + `orderBy` + `limit 500`, 500개 초과 시 다음 실행까지 밀리는 문제, 보호 컬렉션 삭제 경로가 정말 없는지(`offline-session-cleanup.js`가 export/호출되는지 확인).

## 3. 테스트와 실행

- 실행 가능한 무비용 검사: `npm --prefix functions test`, `npm --prefix functions run lint`, `npm run check:functions:strict`. (의존성은 사람이 미리 `npm ci`로 설치해 둔다. 에이전트는 설치하지 않는다.)
- 테스트가 policy 모듈만 검증하고 `index.js`의 실제 핸들러 흐름(transaction, 오류 경로)은 검증하지 않는 부분을 표시한다.
- 부족한 테스트는 "어떤 파일에 어떤 케이스"로 제안만 한다. 감사 단계에서 새 테스트 체계를 설치하지 않는다.

## 4. 개선안 원칙

- 신규 Function export 추가 금지(승인 필요 표시). 일반 CRUD를 Function으로 우회하는 제안 금지.
- 2세대(v2) 마이그레이션은 별도 작업으로만 제안하고, 이득(동시성·비용)과 위험(URL/리전/콜드스타트/클라이언트 호출 변경)을 같이 적는다.
- App Check 도입 제안 시 클라이언트(Cloudflare Pages 정적 사이트)와 reCAPTCHA Enterprise 비용·UX 영향도 함께 적는다.
