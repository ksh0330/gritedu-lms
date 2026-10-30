# GRIT Edu LMS 작업 안전 원칙

## 제품과 호환성

- 베타 테스트를 통과하고 사용자 만족이 확인된 현재 동작과 화면을 기준선으로 보존한다.
- 재현 가능한 결함이나 명시적 요구 없이 정상 기능을 변경하지 않는다.
- 기존 UI를 `단순화` 명목으로 제거·통합·재설계하지 않는다. 단순성 원칙은 신규 기능과 필요한 수정에만 적용한다.
- 변경은 기존 흐름 위에 최소 범위로 추가한다.
- 공개 페이지, 관리자 CMS, 회원가입, 역할별 대시보드의 기존 URL·DOM·이벤트·데이터 계약을 함부로 변경하지 않는다.

## 저장소 기준 문서와 소스 우선순위

- 실행 코드와 `firestore.rules`, `functions/**`, `firebase.json`, `package.json`을 최우선 사실로 본다.
- 전체 현황은 `PROJECT_STATE.md`, 스키마는 `md/DATABASE_SCHEMA.md`, 운영은 `docs/OPERATION_MANUAL.md`를 따른다.
- Firebase 보안·CRUD 감사 기준은 `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md`를 따른다.
- Material maintenance history and deployment verification status are tracked in `docs/MAINTENANCE_LOG.md`.
- 문서가 코드와 다르면 추정으로 맞추지 말고 코드 근거와 미확인 운영 상태를 구분해 문서를 정정한다.
- 현재 공개 시간표 source-of-truth는 `settings/timetableCatalog`이다. `publicTimetableEntries`는 deprecated cleanup-only 데이터다.

## 운영 플랫폼과 배포 경계

- 운영 정적 프런트엔드는 Cloudflare Pages이며 production domain은 `https://gritedu.kr`이다. Firebase Hosting을 운영 정적 host나 fallback으로 간주하지 않는다.
- Firebase는 Authentication, Cloud Firestore, Cloud Functions, Firestore Rules에 사용한다. 일반 `main` push는 Cloudflare Pages 정적 배포만 유발하며 Functions·Rules·indexes는 자동 배포하지 않는다.
- 정적 사이트, 개별 Function, Firestore Rules는 독립 배포물이다. 실제 변경된 대상만 명시적으로 배포하고, Function/Rules 변경이 없으면 불필요한 Firebase deploy를 하지 않는다.

## 데이터 증가

- 학생·회원·강사·반·강좌가 계속 증가할 수 있음을 전제로 한다.
- 작고 제한된 엔터티 목록과 계속 누적되는 관계·기록 collection을 구분한다.
- `enrollments`, 반 배정, 세션 접근, 가입·인증·연결 시도 같은 누적 데이터는 전체 scan하지 않고 사용자·강좌·반·세션·기간 조건으로 조회한다.
- 현재 규모에서 불필요한 검색엔진·집계 서비스·분산 시스템을 도입하지 않는다.
- pagination은 모든 화면에 기계적으로 넣지 않고 실제 증가량·반복 Read·UX 필요가 확인될 때 적용한다.
- 문서에 적힌 수치 임계값은 코드가 자동 전환하지 않는 한 수동 검토용 초기 지표다. 변경 전 document count, P95 load time, daily reads, query shape, 작업자 불편을 측정한다.

## 비용

- 신규 Function, 실시간 Firestore listener, summary collection, counter, 외부 서비스는 근거와 사용자 승인 없이 추가하지 않는다.
- 화면 진입·탭 전환·키 입력만으로 반복적인 운영 DB query가 발생하지 않게 한다.
- 저장 후 전체 collection reload보다 변경 행과 현재 상세 상태 갱신을 우선한다.
- 운영 DB 대상 테스트는 최소 횟수, 명시적 limit, 사용자 승인 원칙을 따른다.
- 예산 알림에 의존하지 않고 코드에서 무제한 조회와 반복 호출을 방지한다.
- rate-limit에서 raw IP를 단독 사용자 식별자로 간주하지 않는다. IPv4 shared NAT와 IPv6 주소 변경을 고려해 이메일·계정 중심 정책에 대한 단기 보조 신호로만 사용한다.
- transient 인증·가입·연동 시도 기록에는 abuse 대응과 운영 진단에 필요한 최소 정보만 저장하고, 보관기간을 실제 대응 목적보다 길게 두지 않는다.
- 관계·기록 조회는 bounded query, visible-page UID batching, page-memory cache, explicit-button lazy load를 우선한다. 전체 scan, 행별 N+1, 키 입력·탭 전환에 따른 반복 reload를 새로 만들지 않는다.

## 검색과 캐시

- 이미 불러온 작은 목록의 일반 검색은 브라우저 배열만 필터링하며 Firestore query를 추가하지 않는다. 주요 관리자·공개 목록은 입력값과 적용 검색어를 분리하고 Enter 또는 검색 버튼으로 적용한다.
- 서버 조회가 필요한 검색도 키 입력마다 호출하지 않고 Enter 또는 검색 버튼으로 실행한다.
- 개인정보·수강·배정 데이터는 장기 `localStorage`에 캐시하지 않고 페이지 메모리 중심으로 처리한다.
- 설정·카탈로그처럼 비민감 데이터만 필요할 때 짧은 session cache를 사용한다.
- 캐시 때문에 권한 변경이나 저장 결과가 오래 지연되지 않게 한다.

## 학부모-자녀 관계

- canonical 관계는 `studentParentLinks/{studentUid}_{memberUid}` deterministic ID를 사용한다.
- 관리자 수동 link/reactivate/revoke는 member counter와 같은 transaction에서 처리하며 production에서 정상 create/revoke lifecycle이 검증됐다. 해제는 physical delete보다 `status: revoked`와 `revokedAt`을 사용한다.
- Firebase Console에서 relation 문서만 직접 삭제하지 않는다. `members.linkedChildrenCount`/`hasLinkedChildren`와 active relation 수의 정합성을 함께 보존하고 관리자 UI revoke 흐름을 사용한다.
- 일부 legacy/test data의 stale counter 가능성 때문에 정상 신규 흐름을 완화하거나 자동 repair/migration하지 않는다. repair나 migration은 exact 대상 inventory와 owner의 별도 승인 없이는 금지한다.

## Transient 기록과 cleanup

- `signupAttempts`는 accepted send event를 Auto ID로 저장하며 email 5/rolling hour, server-observed IP 30/rolling hour 정책과 생성 후 1일 `cleanupAt`을 사용한다. IP는 공유망 abuse 보조 신호이고 `userAgent`나 장기 `blockedUntil`을 새로 저장하지 않는다.
- `emailVerifications`의 OTP는 5분 유효하고 raw verification-session token은 DB에 저장하지 않으며 hash만 저장한다. `cleanupAt`은 OTP expiry 24시간 후이고 profile-create Rules가 최근 verification proof를 확인한다.
- `memberChildLinkAttempts`는 실패/입력 의존 비성공 7일, `linked`/`alreadyLinked` 1일이다. 입력 진단은 normalized 이름·학교·학년·digits-only 전체 전화번호·관계를 포함할 수 있으므로 read는 admin-only이며 console log에 전체 입력을 남기지 않는다.
- `scheduledRecordCleanup`은 매일 03:00 Asia/Seoul에 위 transient 3종만 stored `cleanupAt <= now` 기준으로 정리한다. business, role, relationship, learning, history, CMS, unknown collection은 자동 삭제하지 않는다.

## 다중 에이전트와 파일 충돌

- 병렬 하위 에이전트는 기본적으로 읽기 전용 분석·테스트·리뷰에 사용한다.
- 같은 파일을 여러 에이전트가 동시에 수정하지 않는다.
- 공통 파일과 canonical MD는 메인 통합 에이전트만 수정한다.
- 코드 구현은 기능 영역별로 한 번에 한 소유자만 진행한다.
- 작업 시작 전과 종료 전 `git status`와 diff를 확인한다.

## 변경과 배포

- 한 번에 한 문제와 한 기능 영역만 수정한다.
- 대규모 리팩터링과 무관한 정리는 별도 작업으로 분리한다.
- 사용자의 기존 변경을 덮어쓰지 않는다.
- 운영 데이터 변경, Rules 배포, Functions 배포, Cloudflare 배포는 명시적 요청 없이 하지 않는다.
- 스키마 변경은 호환 읽기·쓰기, 데이터 확인, 권한 전환, legacy 정리 순서로 단계적으로 진행한다.
- 위험한 삭제와 마이그레이션은 dry-run과 대상 수 확인 없이 실행하지 않는다.
- 정적 사이트 배포, Firestore Rules 배포, Functions 배포는 서로 다른 작업으로 취급한다.
- `firebase deploy`, `git commit`, `git push`는 사용자가 명시적으로 요청한 범위에서만 실행한다.
- Production Firebase Functions export는 현재 `linkMemberChild`, `sendVerificationCode`, `verifyEmailCode`, `scheduledRecordCleanup` 4개만 유지한다. 사용자 승인 없이 신규 Function export를 추가하지 않고, 일반 CRUD/search/pagination/count 최적화를 Function으로 우회하지 않는다.
- `functions/**`의 helper/policy 모듈과 `functions/test/**` 테스트 파일은 배포 Function export가 아니다. 파일 수를 이유로 검증 가능한 helper를 `functions/index.js`에 다시 합치지 않는다.
- 로컬 개발 Secret은 추적되는 Markdown이나 소스에 쓰지 않고 ignore된 `.env` 계열 파일 또는 Firebase Secret Manager에 둔다. 저장소에는 값 없는 `.env.example`만 둘 수 있다.
- `scheduledRecordCleanup`의 고정 schedule은 매일 03:00 Asia/Seoul이다. 자동 삭제는 검증된 transient 인증·가입·연결 시도 기록에 한정하고, role/business/relationship/learning/history/CMS/unknown 데이터는 age나 화면 부재만으로 삭제하지 않는다.
- 오래된 온라인 강좌와 오프라인 반은 물리 삭제보다 archive/status 전환을 우선한다.
- production data mutation, migration, delete는 owner의 명시적 승인과 exact 대상 확인 없이는 수행하지 않는다. `git push --force`와 force branch deletion은 사용하지 않는다.

## 검증

- 관리자 디자인 QA는 같은 용도의 버튼·입력·모달을 여러 화면의 같은 viewport에서 비교하고, 시각적 PASS는 실제 브라우저와 computed CSS 수치로 확인한 경우에만 기록한다. 기능 QA와 시각 QA를 별도로 기록하고 로컬 PASS를 운영 Verified로 해석하지 않는다.
- 공통 CSS 변경 시 관리자 외 역할별 회귀를 확인하고, 기존 QA 허브와 canonical 문서를 갱신한다. 동일 목적의 영구 감사 MD를 반복 생성하지 않는다.

- 저장소에 이미 있는 build, test, verify 명령을 우선 사용한다.
- 존재하지 않는 테스트 체계를 감사 단계에서 무겁게 새로 만들지 않는다.
- Emulator가 이미 준비되어 있으면 최소 Rules·Functions 테스트를 사용할 수 있다.
- Emulator 구성이 없다면 필요한 최소 테스트 목록만 문서화하고 설치하지 않는다.
- 변경 후 관리자·학생·회원·학부모·강사 핵심 흐름을 검증한다.
- 자동 검증이 통과해도 실제 역할 계정 smoke test가 필요한 항목은 별도로 보고한다.
- 감사·문서 작업의 기본 무비용 검증은 `npm run check:rules:strict`, `npm run check:functions:strict`, `git diff --check`다.
- 표준 유지보수 순서는 `npm run serve` 수동 smoke test, `npm run build`과 저장소 검사, diff 검토, 승인된 commit/push, Cloudflare Pages 자동 배포, 운영 smoke test다. 일반 push는 Rules·Functions·indexes를 배포하지 않는다.
- `scripts/check-rules.js`는 Rules 구조 점검이지 권한 동작 테스트가 아니며, `scripts/check-functions.js`도 실제 callable/scheduler 동작 테스트가 아니다.
- `firebase.json`에는 Auth/Firestore/Hosting Emulator가 있으나 Rules·Functions 행동 회귀 테스트 파일은 별도로 확인해야 한다.

## Maintenance tracking

- Every material code, Firestore Rules, Functions, schema, deployment, retention, or operational behavior change must update `docs/MAINTENANCE_LOG.md`.
- Update only the relevant canonical documents. Do not create a new permanent audit document for every task.
- Distinguish `Implemented`, `Deployed`, and `Verified`: local implementation and tests do not prove deployment, and deployment does not prove production behavior.
- Never mark a production change `Verified` using local tests alone. Record the required owner or production verification evidence.
- Trivial formatting-only changes do not require a maintenance-log entry.

## 확인된 고위험 경계

- 가입 이메일 인증은 클라이언트 성공 상태만 신뢰하면 안 되며, Rules 또는 서버 발급 증표가 profile create에 결합되어야 한다.
- 공개 `courses` 문서에 비공개 상태와 영상 URL을 함께 저장하지 않는다.
- 공개 `instructors` 문서와 로그인 계정·연락처·내부 메모를 분리한다.
- 오프라인 회차 접근은 UI 필터가 아니라 Rules/서버에서 입반일과 수동 revoke를 강제한다.
- 자동 정리는 접근권한 사전조회 실패 시 fail closed하고, 삭제 대상·순서·재시도 상태를 검증한다.
- 학생 자동 진급은 연도별 한 번만 실행되는 멱등 상태가 없으면 쓰지 않는다.
