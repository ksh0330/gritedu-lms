# Firestore Security, CRUD, Functions Master Audit

최종 갱신: 2026-09-13
Status: 기존 coordinated rollout과 학생 자동 진급/계정 정리 Rules 및 `66132e67` 정적 client는 production 반영됐습니다. 수동 학년 수정이 영구 자동진급 차단으로 남는 문제의 후속 정적 코드 제공도 확인했으며, production 역할 계정 확인 전까지 `Deployed`, not `Verified`로 분류합니다. 오프라인 session Rules 확장은 owner 결정으로 이번 범위에서 보류했습니다.

## 1. 목적, 근거, 분류

이 문서는 Firebase Authentication, Firestore Rules, Cloud Functions, 공개·역할별 UI, CRUD, 조회 비용, 데이터 수명주기, 캐시와 배포 경계를 현재 저장소의 실행 코드로 검증한 단일 canonical audit입니다. 실행 코드와 Rules가 문서보다 우선하며, 운영 레코드 수·필드 값·배포 버전·사고 이력은 소스만으로 단정하지 않습니다.

검증 분류는 다음 여섯 개만 사용합니다.

- **Confirmed defect**: 도달 가능한 코드 경로와 결과가 확인된 결함
- **Conditional risk**: 특정 실패·경합·데이터 상태에서만 생기는 위험
- **Observed working**: 정상 사용 흐름이 알려진 대로 동작하며 보존할 기준선
- **Future hardening**: 유용하지만 현재 결함은 아닌 보강
- **False positive**: 이전 결론을 코드가 뒷받침하지 않음
- **Needs live-data check**: 운영 데이터나 배포 상태를 읽어야만 결론을 낼 수 있음

별도의 rollout 상태는 `Implemented`(코드만 존재), `Deployed`(production 배포 증거 존재), `Verified`(owner 또는 명확한 production smoke 존재)로 기록합니다. 위 감사 분류와 혼동하지 않으며 local test만으로 `Verified`로 올리지 않습니다.

## 2. 감사 범위와 이전 감사의 누락

### 2.1 추적 가능한 전체 범위

- Firestore collection: `admins`, `users`, `students`, `members`, `parents`, `instructors`, `instructorAccounts`, `courses`, `enrollments`, `offlineClasses`, `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`, `studentParentLinks`, `memberChildLinkAttempts`, `emailVerifications`, `signupAttempts`, `settings`, `pages`, `publicTimetableEntries`, `arrangements`, `exam_contents`, `changeHistory`, `operationTasks`. 문서에만 남은 `publicInstructorProfiles`도 owner inventory 대상으로 포함했습니다.
- Functions export: `linkMemberChild`, `sendVerificationCode`, `verifyEmailCode`, `scheduledRecordCleanup`. Phase 2A removed the obsolete `offline-session-cleanup.js`; the scheduler now uses only `record-cleanup.js`.
- 공개 entry: `/`, `404`, `contact`, `courses`, `course-detail`, `instructors`, `instructor-details`, `offline`, `privacy`, `schedule`, `schedule-images`, `story`, `terms`, `tuition`, 검색 인증 페이지와 공통 header/footer.
- 역할 entry: 학생 dashboard/course/offline-class, 회원·학부모 login/signup/dashboard/course, 강사 dashboard/course-detail/offline-class, 관리자 dashboard/courses/offline-classes/operation-tasks/popup/site/timetable/users·students·members·instructors.
- interaction: page entry, auth redirect, tab·modal open, Enter/검색-button committed local search, pagination/page-size, 상세 조회, create/update/delete, 저장 후 reload, 수동 refresh, 관계 데이터 N+1을 확인했습니다.
- 유지보수·정적 경계: `package.json`, `functions/package.json`, `firebase.json`, `scripts/prebuild.js`, `scripts/verify-build.js`, Rules/Functions check scripts, migration/cleanup scripts, `sw.js`, PWA registration, 생성되는 Cloudflare `_headers`, R2/로컬 이미지 정책과 배포 문서를 확인했습니다.

### 2.2 이전 감사에서 누락되거나 불충분했던 영역

- HTML과 page module을 연결한 완전한 entrypoint 목록
- Firestore SDK의 영속 cache 미사용 사실과 Auth session persistence의 구분
- service worker의 제외 경로, navigation 전략과 runtime asset cache 범위
- prebuild가 생성하는 `_headers`, build-version query, CSV cache와 R2 object naming
- collection별 수명주기·의존 관계와 owner read-only inventory 절차
- 성장 수치가 자동 전환이 아닌 수동 검토 신호라는 명시
- 실제 package scripts에 맞춘 static/Firebase 분리 배포 절차
- 넓은 Markdown ignore 때문에 `AGENTS.md`가 추적되지 않던 상태

## 3. 보존할 정상 기준선

베타 테스트를 통과한 현재 URL, 역할별 dashboard, DOM ID, 전역 `window.*` 계약, tab, modal, 검색, 삭제 확인과 UI/UX를 회귀 기준선으로 보존합니다.

- 정상 회원가입과 관리자 생성 계정은 Auth 사용자와 role 문서를 생성합니다.
- 공개 강좌 목록은 UI에서 `published + public`을 보여주며, 의도된 공개 강사 이름·과목·소개·사진·커리큘럼·영상은 공개 화면에 표시됩니다.
- 학생·회원 본인 enrollment, 강사 담당 course/class, 관리자 권한의 기존 Rules 경계를 보존합니다.
- 검색 입력은 이미 받은 배열을 로컬 필터링하며 키 입력마다 Firestore query를 만들지 않습니다.
- `onSnapshot()` listener가 없고 단발 조회 중심입니다.
- 개인정보·수강·배정 데이터를 장기 `localStorage`에 저장하지 않습니다.
- child link의 deterministic ID와 transaction, `cleanupAt` 기반 bounded query는 보존합니다.
- 공통 footer는 Firestore CMS가 실패해도 정적 markup으로 표시됩니다.

## 4. 이전 고우선순위 항목 재검증

| 항목 | 코드·Rules 근거와 필수 trigger | 기존 guard·현실 영향·정상 흐름 | 검증 분류 / live check |
| --- | --- | --- | --- |
| OTP와 profile/Auth 결합 | Production Rules require the Auth email and requested signup type to match an unexpired `emailVerifications` document with recent `verifiedAt`. `verifyEmailCode` writes that proof transactionally after the bound session/code succeeds. | 기존 UI 순서는 유지되며 admin create는 기존 admin 권한 경로를 사용합니다. Verification proof lookup adds one exact Rules-dependent document read on self-create. | Previous gap was a **Confirmed defect**. Coordinated deployment and owner normal-signup smoke are complete; current flow is **Observed working**. |
| 공개 `courses` | Rules는 모든 `courses` get/list를 공개합니다 (`firestore.rules:679-681`). 같은 문서가 `status`, `visibility`, `accessType`, preview 및 `weeks[].videos[].url`을 가질 수 있습니다 (`course-readonly.js:607-667`, `admin-courses.js:1894-1958`). 비공개 상태/보호 URL이 실제 문서에 있을 때 직접 read가 trigger입니다. | 공개 UI의 `published + public` 필터와 공개 강좌는 정상입니다. UI filter는 Rules guard가 아니지만, small-academy LMS의 모든 영상이 보호 대상이라고 가정할 수도 없습니다. | **Needs live-data check**. 보호 대상 draft/private/memberOnly/paid 문서나 URL 존재가 확인되면 별도 결함으로 승격. |
| 공개 `instructors` | Rules는 전체 profile을 공개합니다 (`firestore.rules:526-529`). admin payload가 `email`, `emailLower`, `phone`, `note`, `uid`, `pending`, `instructorId`를 같은 문서에 쓸 수 있습니다 (`admin-user-add.js:239-260,658-698`, `admin-instructors.js:2935-2955`). 해당 필드가 운영 문서에 있으면 공개 read가 trigger입니다. | 이름·과목·소개·사진·커리큘럼·영상 공개는 의도된 정상 흐름입니다. 실제 내부 필드의 존재·값·공개 의도는 코드만으로 결정할 수 없습니다. | **Needs live-data check**. field names만 확인하고 값은 출력하지 않음. |
| 오프라인 입반일·수동 revoke | active 반 배정 학생이면 모든 published session을 읽을 수 있고 Rules는 membership `joinedAt`과 access `manualRevoke`를 보지 않습니다 (`firestore.rules:736-747`). active 학생의 직접 SDK read가 trigger입니다. | UI는 `joinedAt`, `manualGrant`, `manualRevoke`를 필터링하며 정상 화면에서는 차단이 보입니다 (`student-offline-class.js:150-227,496-519`). UI filter는 authorization guard가 아닙니다. | **Confirmed defect**. 실제 영향 회차·revoke 수는 **Needs live-data check**. |
| Cleanup target policy | Before Phase 2A, the scheduler called offline cleanup after transient cleanup, with default real deletion at 180 days for published/archived sessions. | The fixed daily schedule was valid, but age/status deletion of learning and authorization history violated the retention boundary. | Current repository tests and the owner-reported manual production invocation are **Observed working** after removing the path. Prior production impact remains **Needs live-data check**. |
| Cleanup fail-open | Before Phase 2A, an access prefetch failure continued with empty lookup state, and access/session deletes were separate. | A prefetch failure or failure between deletes could expose protected data to deletion or leave a partial state. | Local failure-path tests are **Observed working**, and the owner-reported production invocation completed without lookup or index error. Prior occurrence remains **Needs live-data check**. |
| 반복 자동 진급 | dashboard entry는 학생 문서를 transaction으로 읽습니다. 유효한 marker가 있는 1~6학년, `createdAt`이 이전 연도이며 `lastAutoPromotionYear < 현재 연도`일 때만 `grade`와 marker를 함께 씁니다. marker가 없으면 저장 학년을 유지하고 현재 연도 marker만 초기화합니다. 실제 수동 학년 변경은 같은 저장에 현재 연도 marker를 기록합니다. | 같은 해 재진입·동시 transaction은 marker를 다시 읽어 중복 진급하지 않습니다. 이름·전화번호 수정은 marker에 영향이 없고, 실제 학년 수정은 올해 값을 유지하면서 다음 연도 자동 진급을 허용합니다. legacy `gradeManualOverride`는 더 이상 영구 차단하지 않습니다. | 반복 진급, markerless 위험, 수동 수정 후 영구 차단 보강은 production **Deployed**이며 코드 제공을 확인했습니다. 역할 계정 smoke 전이므로 동작은 아직 `Verified`가 아닙니다. 과거 영향 학생·복구 기준은 계속 **Needs live-data check**이며 자동 migration하지 않습니다. |
| Footer CMS | 이전에는 `common.js`가 `getPublicSettingDoc("footer")`를 호출해도 client allowlist가 read 전에 throw했습니다. Current repository는 `footer`를 허용하고 이 비민감 문서에만 5분 memory/session cache를 적용합니다. | 문서 없음/오류 시 정적 footer는 계속 표시되고, 관리자 저장은 현재 탭 cache를 무효화합니다. | 이전 CMS 미반영은 **Confirmed defect**. Correction is production **Deployed**; 정적 fallback/source contract는 **Observed working**. |
| 관리자 학생 pagination | 이전에는 `goToPage()`가 요청 page를 설정한 뒤 `applyFilters()`가 1로 reset했습니다. Current repository는 reset 여부를 분리해 page 이동에서는 보존합니다. | 검색은 page 1로 reset하고, page 이동은 요청 page를 유지합니다. source-contract test가 이 분기를 고정합니다. | 이전 pagination은 **Confirmed defect**. Current primary-list desktop/mobile behavior is owner production **Observed working**. |
| 다중 batch 영구 삭제 | course enrollment 450개 chunk와 offline access/session/member/class가 여러 commit으로 순차 삭제됩니다 (`admin-courses.js:1765-1813`, `admin-offline-classes.js:1552-1665`). 앞 commit 뒤 네트워크/권한/후속 commit 실패가 trigger입니다. | 관리자 명시 동작과 삭제 확인이 guard입니다. 여러 write라는 이유만으로 사고가 확정되지는 않지만 실패 시 일부 관계만 사라져 자동 rollback되지 않습니다. | **Conditional risk**. 실제 실패 이력은 **Needs live-data check**. |
| 인증번호 5회 오답 무효화 | Production send returns a 256-bit session token and stores only its hash. Verify rejects a missing/wrong session without incrementing the document; five wrong codes can invalidate only the holder of the current send session. | Email knowledge alone no longer changes `failedAttempts` or `used`. An attacker can still request a resend for a known email within the separate 5/hour and 30/IP send limits; that inherent resend nuisance remains bounded. | Previous email-only invalidation was a **Confirmed defect**. Policy/transaction tests pass and the corrected code is **Deployed**; owner normal-signup smoke passed. |
| OTP/rate-limit 비원자성 | Verification resend and verify document transitions now use Firestore transactions. Signup-send and child-link limiter count+event write remain separate operations, so parallel calls at the threshold can race. | Pure policy tests cover serial window/count behavior; transaction tests/source contracts cover OTP single-use/resend semantics. | Verification race locally corrected; limiter count/write remains a **Conditional risk**. |
| Signup shared-IP false block | 이전 구현은 IP 5회/시간 또는 20회/주 누적에서 7일 차단 문서를 만들었으므로 shared IPv4/NAT의 정상 사용자가 다른 사용자의 시도로 장기 차단될 수 있었습니다. Rotating IPv6에서는 반대로 IP key가 약한 신호입니다. | Current production uses email 5/hour as primary and server-observed IP 30/hour as auxiliary, creates no long block, stores no user agent, and retains attempts for 1 day. | Previous long IP block was a **Confirmed defect**. Corrected policy is **Deployed** and normal signup is owner-verified; non-atomic limiter count/write remains a **Conditional risk**. |
| parent-child link 전체 scan | 이전 구현은 accepted parent attempt마다 `students` 전체를 읽었습니다. Current production uses exact `name` query로 후보를 좁힌 뒤 school/grade/phone을 memory에서 확인합니다. | Auth guard, deterministic link ID와 transaction을 유지합니다. Rate limit runs before member/status/parent diagnostic writes and counts recorded non-success attempts at 5/10 minutes and 15/day; rate-limit/server-error responses create no document. | 이전 full scan correction, notFound diagnostics, successful auto-link, and parent LMS display are owner production **Observed working**. Limiter 원자성은 **Conditional risk**. |

이 검증에서 **False positive**로 확정한 항목은 없습니다. 공개 강좌·강사 항목은 이전의 단정적 결론을 유지하지 않고 운영 field/state 확인 전까지 보류했습니다.

## 5. 확인된 결함과 알려진 정상 흐름

Offline session joinedAt/revoke enforcement remains unresolved by owner decision; current UI filtering is not a Rules authorization boundary. Repeated grade advancement and student/member cleanup lifecycle now have local corrections pending deployment and production smoke. Signup/child limiter count+event threshold races remain conditional. Existing coordinated signup, relationship, list/read, and due-`cleanupAt` corrections remain deployed.

정상 가입 UI, 관리자 계정 생성, 공개 강좌·강사 표시, role dashboard, enrollment/roster의 일반 흐름, 수동 revoke UI, local input filtering, 정적 footer fallback, 일일 03:00 scheduler는 알려진 정상 기준선입니다. 이후 수정은 이 동작과 UI 계약을 보존해야 합니다.

## 6. Daily 03:00 cleanup validation

The schedule remains fixed at **03:00 Asia/Seoul**. Phase 2A limits the scheduled Function to three allowlisted transient collections. Every read uses `cleanupAt <= now`, `orderBy("cleanupAt")`, and `limit(500)`. All three reads finish before any delete starts, so a required query failure aborts the run without deleting a previously read collection.

| Collection | Confirmed writer retention | Automatic action |
| --- | --- | --- |
| `emailVerifications` | The code is valid for 5 minutes; `cleanupAt` is 24 hours after `expiresAt` so Rules can consume the signup proof | Delete after stored `cleanupAt` is due |
| `signupAttempts` | Current production writer: accepted send attempts use 1 day; no new week-long block document | Delete after stored `cleanupAt` is due; historical documents are not backfilled |
| `memberChildLinkAttempts` | Current production writer: failed/non-success 7 days; success/already-linked 1 day | Delete only the attempt record after `cleanupAt`; preserve `studentParentLinks` |

Documents without `cleanupAt` are not scanned or deleted automatically. Their retention is unresolved until owner inventory and dependency review. Within the allowlist, stored due `cleanupAt` is sufficient; no legacy 30/90/180-day age gate delays deletion. The previous monthly unbounded legacy scans were removed.

The scheduler never targets role/business data, courses, classes, enrollments, rosters, parent-child links, learning/session/access history, CMS, unknown, or legacy records. In particular, `offlineClassSessions` and `offlineSessionAccess` are protected. Existing course/class archival remains a status transition, not an automatic physical delete.

## 7. Collection 수명주기·의존 관계 지도

| collection | 수명주기 | writer / reader·참조 | 주요 의존·status/timestamp | 안전 조치 |
| --- | --- | --- | --- | --- |
| `admins` | active business | admin CRUD; Rules role lookup, 본인 role read | UID role, `createdAt/updatedAt` | keep |
| `students` | active business | admin·self create/update; student/member/admin 화면, Functions child lookup | enrollments, memberships, links; `grade`, `createdAt`, `updatedAt` | keep |
| `members` | active business | admin·self; member dashboard, Rules/Functions parent role | enrollments, links; `status`, `createdAt/updatedAt` | keep |
| `instructors` | active business | admin CMS; public·role 화면과 Rules | accounts, courses, classes; `status/pending`, timestamps | keep; public/private field inventory |
| `instructorAccounts` | active business | admin; instructor auth/profile lookup | instructor profile ID, `status`, timestamps | keep |
| `courses` | active business + archive candidate | admin CRUD; public/student/member/instructor reads, Rules | enrollments/instructor; `status/visibility/accessType`, timestamps | keep; old course archive |
| `offlineClasses` | active business + archive candidate | admin CRUD; role reads, Rules | members/sessions/access/instructor; `status`, timestamps | keep; old class archive |
| `pages` | active business CMS | admin CRUD; public pages and Rules | slug documents, `updatedAt` | keep |
| `settings` | active business CMS/config | admin CRUD; exact public keys, Functions policy summary | menus/catalogs/popup/footer/retention; `updatedAt` | keep; exact legacy docs investigate |
| `enrollments` | active relationship/history | admin/student/member/instructor CRUD/read, Rules | course + user/child; `status`, `createdAt/enrolledAt/updatedAt` | keep |
| `studentParentLinks` | active relationship/history | Function or administrator transaction; admin/student/member reads | deterministic student/member pair, snapshots, `status`, `createdAt/updatedAt/revokedAt` | keep; link/count changes atomic |
| `offlineClassMembers` | active relationship/history | admin CRUD; student/member/instructor reads, Rules | class + student; `status`, `joinedAt/createdAt/updatedAt` | keep |
| `offlineClassSessions` | active relationship/history | admin CRUD; student/instructor reads and Rules; no Phase 2A cleanup reference | class + access; `status`, `sessionDate`, timestamps | keep; no age-only auto delete |
| `offlineSessionAccess` | active relationship/history | admin CRUD; student/instructor reads and Rules; no Phase 2A cleanup reference | session + class + student; grant/revoke fields, timestamps | keep; no age-only auto delete |
| `emailVerifications` | transient | Functions C/U; admin/cleanup read-delete, Rules | email; `expiresAt/createdAt/cleanupAt/used` | expire by proven policy |
| `signupAttempts` | transient | Functions C; admin/cleanup read-delete, Rules | email primary + server IP auxiliary; `timestamp/cleanupAt`; legacy block fields may remain | expire by stored policy |
| `memberChildLinkAttempts` | transient | Function C; admin read, cleanup | member + result/count; failure-only submitted input/mismatch; `createdAt/cleanupAt`; legacy input may remain | expire attempt only |
| `publicTimetableEntries` | legacy read-compatible | Rules admin read/delete; admin timetable cleanup path | replaced by `settings/timetableCatalog`; timestamps vary | inventory, delete only after proof |
| `exam_contents` | legacy read-compatible | Rules public read/admin CRUD; migration source script | mapped to courses; legacy body/video, timestamps | inventory and dependency proof |
| `arrangements` | legacy read-compatible | Rules public read/admin CRUD; no current runtime screen found | unknown legacy content/timestamps | investigate, do not auto delete |
| `parents` | legacy read-compatible | Rules admin CRUD; parent role currently disabled | possible student relation; timestamps | investigate, do not auto delete |
| `operationTasks` | possible orphan | Rules admin access; current operation UI uses `settings/retentionPolicy` | legacy status/timestamps | inventory |
| `users` | possible orphan | Rules deny; no current runtime flow | unknown role migration | inventory |
| `changeHistory` | possible orphan/history | client Rules deny; maintenance audit reference | possible entity/action timestamps | inventory; history 보호 |
| `publicInstructorProfiles` | possible orphan | canonical history mentions it; current runtime/Rules reference not found | possible instructor projection | inventory |
| 그 밖의 발견 collection | unknown | 현재 소스 참조 없음 | dependency/status/timestamp unknown | investigate; 자동 삭제 금지 |

`settings`의 현재 exact docs는 `signup`, `coursesMenu`, `instructorsMenu`, `subjectColors`, `courseCatalog`, `timetableCatalog`, `offlineClassCatalog`, `popups`, `kakaoChannel`, `footer`, `tuitionImages`, `retentionPolicy`이고, `pages`는 `dday`, `story`, `contact`, `index` 사용이 확인됩니다. `settings/home`, `settings/instructors`, `settings/dday`, `settings/operationCatalog` 같은 legacy 이름은 실제 존재 여부를 inventory한 뒤 판단합니다.

## 8. Firestore Rules 경계 요약

표기: G get, L list/query, C/U/D create/update/delete, `—` 불가. Admin SDK Functions는 Rules를 우회합니다.

| 경로군 | public | admin | instructor | student | member/parent | 검증 메모 |
| --- | --- | --- | --- | --- | --- | --- |
| role/profile | instructors G/L | role/profile 전체 관리 | 본인 account/profile G/L | 본인 student G/C/제한 U | 본인 member G/C/제한 U | signup coupling 결함; instructor fields는 live check |
| public CMS | exact settings G, pages G/L | C/U/D | 공개 read | 공개 read | 공개 read | `footer` Rules와 client allowlist 일치; static fallback 유지 |
| courses | G/L | C/U/D | G/L | G/L | G/L | 보호 데이터 존재 여부 live check |
| enrollments | — | G/L/C/U/D | 담당 course G/L/U | 본인 G/L/C/U/D | 본인·linked child G/L/C/U/D | 정상 role flow 보존 |
| offline classes/members | class direct 범위 외 — | G/L/C/U/D | 담당 class G/L | active membership G/L | linked child/member 제한 read | joinedAt 기록 보호 |
| offline sessions/access | — | G/L/C/U/D | 담당 class G/L | active class published G/L, 본인 access G/L | — | joinedAt/revoke 미강제 |
| attempts/verification | — | G/L/D | — | — | — | admin G/L/D; Functions C/U; cleanup D |
| legacy | arrangements/exam_contents G/L | Rules별 관리 | 공개 read | 공개 read | 공개 read | actual docs live check |
| users/changeHistory/catch-all | — | client도 — | — | — | — | deny |

## 9. Functions 전수 지도

| Function | 호출·read/write | 검증 결과 |
| --- | --- | --- |
| `linkMemberChild` | Auth active parent, rate history then exact-name student candidate query plus bounded legacy-whitespace fallback; deterministic link, current member revalidation, active-link recount, and member flag/count update in one transaction | matching/rate/retention tests pass; notFound diagnostics and auto-link are production **Observed working**. Successful submitted input is **Deployed** pending one new document check; limiter count+event 경합은 **Conditional risk** |
| `sendVerificationCode` | pre-signup 무인증, signup/Auth/profile/attempt/verification 조회·쓰기, Firebase Secret 사용 | email-first/shared-IP policy, one-day Auto-ID retention, canonical resend transaction, CSPRNG code/session generation are **Deployed**; owner normal-signup smoke passed; count+write limiter 경합은 **Conditional risk** |
| `verifyEmailCode` | 무인증, verification transaction get/update | hashed session binding, expiry/used/replay checks, five-attempt session invalidation, and profile-create Rules proof are **Deployed**; owner normal-signup smoke passed |
| `scheduledRecordCleanup` | Pub/Sub daily at 03:00; three bounded `cleanupAt` queries, maximum 500 documents each; update-time-preconditioned deletes; summary write | Phase 2A and due-`cleanupAt` follow-up are deployed. Owner-reported production invocation is **Observed working**; update-time race behavior remains regression-tested rather than destructively production-tested. |

`functions/index.js` has exactly these four exports. `functions/member-child-link-policy.js`, `functions/signup-rate-limit-policy.js`, `functions/email-verification-policy.js`, and `functions/test/**` are helper/test modules, not deployable Functions. No callable, HTTP, scheduler, or trigger export was added.

## 10. 화면 CRUD, 검색과 cache 결론

- 공개 화면은 settings/pages/course/instructor를 단발 read하고 로컬 filter/pagination을 사용합니다. Footer is the only `getPublicSettingDoc` key given a five-minute public session cache; its static fallback remains. 역할 화면은 본인·담당 범위 관계 query와 문서 get을 조합합니다. 관리자 화면은 작은 master collection을 명시 동작으로 full load하고 상세/modal에서 관계 query를 추가합니다.
- Administrator student status now uses two UID-scoped relationship queries per chunk of at most 10 students, then local search/pagination with zero extra query. It reuses relationship IDs and promise-caches distinct course/class documents for the current load. A failed summary batch is displayed as failure, not zero.
- Main administrator/public searchable lists separate typed text from the applied keyword, apply only on Enter/search button, reset to page 1, and offer 10/20/50 rows. Member, instructor, account, admin-course, offline-class, and public-course search/filter/page transitions remain in memory and add no Firestore query. UI pagination does not reduce the initial full-master document reads described in the cost audit.
- Offline-class session/member counts changed from `2 * C` aggregation queries for every class to `2 * V` for uncached visible rows, cached in page memory. A local search/filter commit does not fetch missing counts; first/unseen page, page-size, or group navigation may do so. Aggregation query billing is based on index entries/minimum charge and is distinct from returned relationship-document reads.
- Member linked-child relationship queries remain child-scoped under current Rules, but children load concurrently and shared course/class document gets are deduplicated within one load. Instructor assignments are joined from four loaded master collections without row N+1. No summary collection/listener/counter was added.
- The member list resolves active child names for visible UIDs only, in chunks of at most 10, from `studentParentLinks.studentSnapshot`; page-memory cache avoids repeat queries and there is no per-row student get. General-member detail has no child-attempt DOM. Parent child-attempt and all-member signup panels perform no entry read. Explicit child/signup buttons run only selected-member UID limit-30 or exact-email limit-20 queries; child view displays at most 3 failures or 5 total and signup at most 10. View switches are local and the browser never reads OTP code/session token/hash fields from `emailVerifications`.
- Administrator manual parent-child link/reactivate/revoke uses the deterministic `{studentUid}_{memberUid}` document and a Firestore transaction that reads the exact member, student, and link. Rules require an active parent member, stable IDs, canonical lifecycle fields, and matching `getAfter()` member count/flag change. The automatic Function also updates the same member count in its transaction, so concurrent paths retry or fail closed on the shared member version.
- Firestore는 `getFirestore(app)`만 사용합니다. `initializeFirestore`, persistent local cache, IndexedDB persistence 설정이 없으므로 SDK의 영속 offline cache를 사용하지 않습니다. Auth는 `browserSessionPersistence`이고 Firestore cache와 별개입니다.
- `settings-cache.js`는 비민감 7종(`coursesMenu`, `instructorsMenu`, `courseCatalog`, `timetableCatalog`, `offlineClassCatalog`, `subjectColors`, `footer`)만 memory + `sessionStorage`에 5분 저장합니다. Public paths still force the server except for `footer`; admin getter uses the established cache contract and invalidation. 개인정보·수강·배정은 persistent browser storage에 cache하지 않습니다.
- `localStorage`는 theme, popup dismiss/update 신호 등 비민감 UI 상태에 한정됩니다. school CSV는 build version query와 page-lifetime promise, `force-cache`를 사용합니다.
- `sw.js`는 offline page와 icon 3개만 precache합니다. navigation은 network-first이며 admin/member/student/instructor 및 Firebase/Google URL은 cache하지 않습니다. runtime JS/CSS/image의 service-worker cache는 없습니다.
- prebuild의 Cloudflare `_headers`는 HTML/JS/CSS를 no-cache/must-revalidate, version manifest를 no-store, image/font를 1년 immutable, CSV/PDF를 1일로 만듭니다. build version query가 top-level/module JS·CSS·partials·school CSV에 주입됩니다.
- 로컬/R2 이미지는 WebP 우선이고 R2는 같은 key를 덮어쓰지 않고 새 object key + CMS URL로 교체합니다. `Date.now()` cache-buster를 붙이지 않는 현재 정책을 보존합니다.

## 11. 성장 기준

현재 audit의 20/50/100/200/450/500 같은 숫자를 보고 schema, pagination, archive, cache, 삭제 방식을 자동 전환하는 코드는 없습니다. 모두 **수동 검토를 시작하기 위한 초기 운영 지표**일 뿐 보장된 임계값이 아닙니다.

검토 전에는 collection/document count, 화면별 P95 load time, daily reads, query shape/index usage, 작업자 불편과 오류를 측정합니다. 작은 목록의 local filtering은 유지하고, server search가 실제 필요한 경우에만 Enter/검색 버튼 query를 설계합니다. 자동 전환은 도입하지 않습니다.

## 12. Owner 전용 read-only 운영 inventory

이 감사에서는 실행하지 않았습니다. owner가 Firebase Console에서 값이나 개인정보를 복사하지 말고 다음 묶음마다 확인합니다.

1. role/business: `admins`, `students`, `members`, `instructors`, `instructorAccounts`
2. course: `courses`, `enrollments`
3. offline: `offlineClasses`, `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`
4. parent: `studentParentLinks`, `memberChildLinkAttempts`
5. CMS: `pages`, `settings`
6. transient: `emailVerifications`, `signupAttempts`
7. legacy/orphan candidate: `users`, `parents`, `publicTimetableEntries`, `arrangements`, `exam_contents`, `changeHistory`, `operationTasks`, `publicInstructorProfiles`, 그리고 Console에서만 발견한 collection

각 collection에 대해 정확히 다음을 기록합니다.

- document count
- 적용 가능한 `createdAt`, `updatedAt`, `joinedAt`, `sessionDate`, `cleanupAt`의 oldest/newest
- status/visibility/accessType/result 분포
- 값이 아닌 field name 목록
- parent/reference ID 종류, 참조 수와 apparent orphan count
- 알려진 user/admin flow 전후에 collection이 변하는지 여부

추가로 Auth email과 student/member profile email 불일치 수, course 보호 상태별 문서·URL 포함 수, instructor 위험 field name 존재 수, joinedAt 이전/manual revoke 대상 회차 수, 배포된 cleanup Function 버전·retentionPolicy field·최근 오류/summary, 반복 진급 후보 수, composite index와 member-attempt fallback 여부만 read-only로 확인합니다. 실제 값, OTP, 전화번호, URL, 개인 식별 정보는 보고서에 적지 않습니다.

향후 물리 cleanup은 반드시 `read-only inventory → dependency classification → 필요 시 backup/export → dry-run candidate list → owner approval → very small batch → role-based smoke test → stop condition을 둔 gradual continuation` 순서로 수행합니다.

## 13. Canonical 유지보수·배포 체크리스트

1. `npm run serve`로 local server를 열고 공개·학생·회원/학부모·강사·관리자 대표 페이지를 수동 smoke test합니다. 이 명령은 production Firebase project 설정을 사용할 수 있으므로 쓰기/삭제 동작은 하지 않습니다.
2. `npm run build` 후 `npm run verify:strict`, `npm run check:rules:strict`, `npm run check:functions:strict`와 `git diff --check`를 실행합니다. 전체 사전 점검은 `npm run ready:deploy`입니다.
3. `git status`와 전체 diff에서 생성물, secret, 비의도 코드·문서 변경이 없는지 확인합니다.
4. 승인된 경우에만 commit과 `git push`를 합니다. `main` push는 Cloudflare Pages Git integration의 `npm run prebuild`와 `dist` 정적 배포를 유발합니다.
5. 공개 URL에서 핵심 역할·페이지 smoke test를 하고 오류나 회귀 시 배포를 중단/rollback합니다.

일반 `git push`는 Firestore Rules, Functions, indexes를 배포하지 않습니다. Rules는 `npm run deploy:rules`, Functions는 `npm run deploy:functions` 같은 별도 명시 작업입니다. `firebase.json`에는 Firestore index 파일 경로가 없고 저장소에도 `firestore.indexes.json`이 없습니다. Firebase Hosting 설정은 존재하지만 현재 정적 운영 배포는 Cloudflare Pages입니다.

## 14. 다음 구현과 검증 한계

학생 자동 진급을 연도별 1회로 만드는 transaction guard와 비운영 source/pure-helper 회귀 test는 2026-09-12 구현했고, 2026-09-13 marker가 없는 기존 학생은 학년을 유지한 채 marker만 초기화하도록 보강했습니다. 이어 학생/관리자의 실제 학년 변경은 현재 연도 marker를 함께 기록하고 legacy manual override가 다음 연도 진급을 영구 차단하지 않도록 수정했습니다. 학생 정리는 active/불명확 parent link를 먼저 정상 revoke하도록 차단하고, 일반/학부모 정리는 실행 직전 dependency를 재조회하며 두 흐름 모두 profile-last 삭제 순서를 사용합니다. 운영 영향 학생 판별·복구와 legacy counter repair는 별도 owner 승인 inventory/dry-run으로 분리합니다.

현재 저장소에는 Rules 동작을 증명하는 Emulator 회귀 test가 확인되지 않았습니다. `check-rules.js`는 구조 점검이고, `check-functions.js`는 cleanup unit tests를 실행하지만 실제 callable or scheduler timing을 증명하지 않습니다. The owner-reported Phase 2A production invocation verified successful execution, count-only logs, no missing-index error, protected offline targets, and no unusual Firestore activity. Prior production impact remains unverified.

## 15. Phase 2A implementation note

Phase 2A adds `functions/test/record-cleanup.test.js` using Node's built-in test runner. It verifies transient eligibility, preservation of active records, the protected-collection allowlist, fail-closed prerequisite reads, idempotent reruns, and bounded query construction. The implementation does not add a Function, collection, index, listener, or production read.

Firestore batch commits are atomic within each transient collection and the scheduler caps each collection at 500 documents, so one collection uses at most one delete batch per run. If a later collection batch fails, an earlier independent transient collection may already be cleaned; no business or relationship invariant spans these three technical collections, and a rerun safely resumes the remaining work.

## 16. Offline session/access lifecycle audit

### 16.1 Verified relationship and lifecycle behavior

- An administrator creates each `offlineClassSessions` document with a Firestore auto-ID. `sessionDate` is a date string, and video content is not uploaded to Firestore; the document stores HTTP(S) URL metadata in `videos[]` and the first URL again in `videoUrl` for compatibility.
- `offlineSessionAccess` is a sparse manual-exception collection, not a session-by-roster expansion. The canonical ID is `{sessionId}_{studentUid}`. No document is created for default `joinedAt` behavior; a record is written only for a manual grant or revoke. Legacy duplicate IDs may still exist until that pair is saved again.
- Deleting an access record is not a neutral cleanup. In the student UI, deleting a revoke can restore post-join visibility, deleting a grant can remove pre-join visibility, and either action erases the explicit decision. Current Rules ignore access-document presence and still permit an active member to read any published session, which is the separately tracked authorization defect.
- Archiving a class hides it in normal student UI, but current session Rules do not check class status. To end direct student reads under the current Rules, the session itself must be `archived`. Administrators and assigned instructors can still read archived sessions.
- Reopening a class preserves the original `joinedAt` and surviving grant/revoke exceptions. An archived session can be republished with the same document ID, making its retained access history relevant again.

### 16.2 Policy comparison and decision

| Option | Safety and cost result | Current decision |
| --- | --- | --- |
| A — retain indefinitely | Preserves history and is reversible, but existing unbounded-per-scope page reads should be measured and later bounded as histories grow. | Safe fallback; archive status is still needed for visibility. |
| B — archive without physical deletion | Preserves session/access history while excluding archived sessions from student queries and Rules. Class archive alone is insufficient under current Rules. | **Recommended now:** archive ended-class sessions; retain access records. |
| C — configurable per-class `keep`/3/6/12 months | The schema has no verified class-end or retention-start timestamp, and reopened classes can require the original session/access state. | **Not approved.** Do not give stale `settings/retentionPolicy` fields new meaning. |
| D — owner-approved physical purge | Irreversible, can alter access semantics, and existing multi-phase deletion can leave partial state. | **Deferred.** Require inventory, dependency proof, backup/export decision, dry run, small resumable batches, stop conditions, and explicit approval. |

Sessions and access records may use different lifecycle policies: sessions can be archived, while access records should remain at least as long as their session and may be retained longer as authorization evidence. Legacy and unknown records default to `keep`. Do not restore either collection to `scheduledRecordCleanup`, add TTL, or infer expiration from age alone.

### 16.3 Read shape and manual review triggers

There is no normal full-collection query for either collection, but several class-, session-, or student-scoped queries have no server limit. Student and instructor pages load all matching class sessions before five-row client pagination; a student loads all historical access exceptions before filtering by class. The administrator class list now issues one session count and one member count only for uncached visible classes instead of every class. Collection size alone does not make an indexed equality query scan the whole collection, but returned-document count, aggregation index entries, per-page query count, Rules-dependent reads, and storage/index overhead still affect cost.

These are exact **manual review triggers**, not automatic deletion or architecture switches:

- `offlineClassSessions` reaches 10,000 documents, or `offlineSessionAccess` reaches 50,000 documents;
- one class query returns at least 100 sessions;
- one student entry query returns at least 100 access exceptions;
- one session has at least 50 access documents, including duplicates;
- the administrator list reaches 100 classes, producing at least 200 per-class count queries per full load;
- an offline page exceeds 2 seconds P95 load time, or offline-related Firestore reads reach 10,000 per day;
- measured combined document-and-index storage reaches 0.5 GiB;
- any orphan reference, conflicting duplicate, or missing required ID is found, which triggers immediate correctness review regardless of count.

The detailed growth formulas, scenario table, annual projections, and owner checklist are maintained in `OFFLINE_CLASS_SYSTEM_PLAN.md`. No production query was run for this audit.

## 17. 2026-08-24 focused implementation note

This section records the implementation state at that time. It did not run a production Firestore query or write and did not deploy. Its rollout boundary was superseded by the coordinated production deployment at `4d1a83d1`, the sticky follow-up at `21705106`/`43d90779`, and the attempt UI/success-input rollout at `810941f3`/`38ea7295`.

### Historical implementation scope (subsequently deployed)

- Administrator student page: preserve requested pagination; query only visible UIDs in chunks of at most 10 after the explicit load action; cache queried UID summaries so cached pages and committed local search are zero-query. Default unseen 10-row pages use two relationship queries, while 20/50-row views use up to four/ten; show batch failure separately from zero; reuse relationship IDs and distinct master-document promises.
- Primary list UX: administrator students/members/instructors/accounts/courses/offline classes and public courses use committed Enter/search-button search, 10/20/50 page size, stable non-stretching list viewport, sticky administrator table headers, and shared pagination outside the scroll container. Item range/total summaries and pagination-triggered browser scroll were removed. These are browser-side presentation controls over already loaded masters, not claims of reduced Firestore document reads.
- Administrator offline classes: replace initial `2 * C` count aggregation N+1 with visible-page `2 * V` lazy aggregation and page-memory reuse. Search/filter commits remain zero-query and may show uncached counts as unavailable until page/group/page-size navigation loads them.
- Member child dashboard: concurrent per-child relationship loads, per-load course/class promise deduplication, grade 7 consistency, and explicit empty/partial/failure states.
- Role dashboards: simple list-count summaries were removed, while service stat cards and relationship details remain. No count-only query existed. Student initialization reuses the grade-check profile read for the welcome name; instructor initialization shares its account document promise between settings and welcome resolution. Instructor roster reads stay explicit-button deferred and course/class scoped.
- `linkMemberChild`: exact-name candidates instead of a full student scan, with up to two limit-50 prefix queries only after no complete match to preserve legacy whitespace variants; failure-only submitted inputs and mismatch diagnostics; 5 failed matches/10 minutes and 15/day; 7-day failure and 1-day success retention. The deterministic relationship and transaction are unchanged.
- `sendVerificationCode`: email-first 5/hour, auxiliary server-IP 30/hour, no week-long block, no client IP/user-agent trust or user-agent storage, 1-day attempt retention, and transactional CSPRNG resend/session state. Count+write limiter is still non-atomic and remains separately classified.
- `signupAttempts`: keep Firestore Auto IDs; use `timestamp` as the creation/order source of truth and email/IP/time queries for operational lookup. At this historical implementation point the one-day writer was not yet deployed; the section-level superseding note records its later `4d1a83d1` production rollout. Existing attempts retain their stored `cleanupAt`.
- Public settings/UI: `footer` allowlist + five-minute bounded session cache with static fallback, all schedule accordions initially closed, and future D-Day text `D-N`.

### Deferred or still open

- Repeated grade advancement, offline `joinedAt`/manual-revoke Rules enforcement, public course/instructor live-field inventory, and multi-batch destructive CRUD remain unchanged. OTP/profile coupling and five-error invalidation are locally implemented in section 18 but await deployment verification.
- Instructor and other small master-list full reads, unbounded class/session-scoped result sets, save-after-full-reload paths, and broader parent relationship query changes remain measurement-led follow-up. Client access was broadened only for administrator transactional link lifecycle writes; ordinary member/student attempt-log access remains denied.
- No rate-limit reset endpoint/UI was added: the corrected rolling window expires naturally and pure policy fixtures cover tests. A production reset would be a separately approved exact-key data operation, never a collection-wide cleanup.

### Deployment boundaries

- Historical plan: static JavaScript, the four existing Functions, and Rules required a coordinated rollout. That rollout completed at `4d1a83d1`; indexes, Scheduler configuration, cleanup allowlist, documents, and retentionPolicy data were not migrated.

### Callable deployment compatibility

- Callable names and the child-link response/error shape remain unchanged. Verification adds a required session token returned by `sendVerificationCode` and held only in page memory.
- Historical compatibility note: the coordinated rollout used static signup client, four existing Functions, then Rules to avoid an old cached client discarding the new session token. The rollout is complete; future maintenance deploys only the target whose source changed.

## 18. 2026-08-24 final Functions security/retention follow-up

This follow-up was local `Implemented` at the time and was later included in the coordinated `4d1a83d1` production rollout. It did not change production data, dependencies, runtime, scheduler count, allowlist collections, indexes, or the four-export surface.

- `signupAttempts`: accepted send events remain separate Auto-ID documents containing only email, server-observed IP, timestamp, and cleanupAt. Retention is one day, which exceeds the one-hour 5/email and 30/IP windows.
- `memberChildLinkAttempts`: `invalidInput`/`notFound`/`ambiguous` retain normalized submitted values, including the full digits-only phone, plus mismatch diagnostics for seven days. The later `810941f3` follow-up also stores the same five normalized input fields for `linked`/`alreadyLinked` for one day without mismatch diagnostics. Account/role preconditions keep minimal diagnostics; rate-limited/server-error paths write no attempt. Repository consumers are administrator-only.
- `sendVerificationCode`/`verifyEmailCode`: resend transactionally replaces the email-canonical document, resets failed state, uses `crypto.randomInt`, returns a 256-bit session token while storing only its hash, and makes the prior code/token pair unusable. Verification transactionally enforces token, expiry, used state, five wrong attempts, and single use. Email-only third parties cannot increment or invalidate another browser's active session.
- Signup self-create Rules require the Auth email and requested role type to match a recent successful server verification whose cleanupAt is still in the future. The existing 24-hour post-expiry cleanup grace is retained because Rules consume that document during profile creation.
- `scheduledRecordCleanup`: after the bounded `cleanupAt <= now` preflight queries, a due stored cleanupAt is sufficient. Each delete uses the snapshot update time as a precondition, so a resend/update after preflight aborts the batch rather than deleting newer state. Missing-cleanupAt legacy/unknown documents remain preserved and no collection outside the three-item allowlist is accessed.
- Administrator member management now includes visible-page cached child summaries, bounded exact attempt diagnostics, and deterministic manual link/reactivate/revoke transactions guarded by administrator-only Rules plus `getAfter()` member-count consistency. The UI does not query `emailVerifications`; login failures are not shown because no trusted Firestore login-failure writer exists.
- Deployment completed as a coordinated static/four-Function/Rules rollout at `4d1a83d1`; `linkMemberChild` was later redeployed alone for successful submitted input. No index or data migration was required.
## 19. 2026-10-18 강사 공개 필드 후속 상태

운영 QA 표본에서 `instructors`의 내부 필드명 `uid`, `email`, `emailLower`, `note`, `pending`이 확인됐고 일부 식별값은 비어 있지 않았다. 공개 문서 전체 읽기 Rules와 결합하여 P1 노출 결함으로 취급한다. 로컬 구현은 `instructorPrivate/{profileDocId}` 관리자 전용 메타데이터, 신규 관리자 분리 쓰기, 기존 프로필 호환 읽기, 최종 공개 필드 allowlist Rules까지 준비했다. 운영 데이터 이전·기존 필드 제거·정적/Rules 배포는 수행하지 않았다. 배포 순서와 dry-run/복구 조건은 `docs/OPERATION_MANUAL.md`의 강사 개인정보 분리 계획을 따른다. 로컬 구현 상태는 운영 노출 해결 또는 production 검증을 뜻하지 않는다.

**2026-10-18 제한된 운영 inventory 후속:** 허가된 관리자 QA 브라우저와 Firebase Console의 읽기 전용 50건 이하 페이지로 확인했다. `instructors` 20, `instructorPrivate` 0, `instructorAccounts` 20, `courses` 16, `offlineClasses` 79(50+29)건이다. 공개 문서 내부 필드 존재/실제 값 건수는 `uid` 20/20, `email` 20/20, `emailLower` 20/20, `note` 20/0, `pending` 20/0, `phone` 0/0이다. 공개 필드는 이름·과목·프로필 ID·생성/수정 시각 각각 20/20, `subjects` 20/19, 약력 20/16, 짧은 소개 20/14, 사진 20/17, 영상 배열 20/8, 참고 자료 URL 20/0, 참고 자료 배열 20/0이다(앞 수=필드 존재, 뒤 수=비어 있지 않음). 프로필 ID 필드와 문서 ID 불일치, 계정 없는 프로필, 프로필 없는 계정, 계정 UID·이메일 불일치, 정규화 이메일 중복은 모두 0건이었다. 강좌 14건·반 75건이 강사와 연결되어 있고 각각 2건·4건은 강사 참조가 없었다. UID-only 참조, 알 수 없는 UID/프로필 ID, UID·프로필 쌍 불일치, 복수 참조 배열의 미해결 항목은 모두 0건이다. 강좌·반 참조가 있는 프로필은 17건, 프로필당 두 컬렉션 참조 최댓값은 21건이다. 이 집계는 조사 시점의 다섯 컬렉션에 한정하며 원문 식별값을 기록하지 않았다. 운영 공개 문서 20건의 노출은 그대로이며 `instructorPrivate` 신규 구조는 운영에서 아직 검증되지 않았다. 회귀 상태와 미실행 항목은 `docs/ROLE_TEST_PLAN.md` §15에 기록한다.

**2026-10-19 로컬 보존 검증:** demo Emulator와 격리 로컬 브라우저에서 프로필·계정 생성의 두 순서, 이메일/메모 수정, 연결 해제·재연결·삭제, 강사 담당 강좌/반/학생 및 비담당 접근 제한, 공개 목록·상세의 private 비노출, 임시/최종 Rules 전환과 구버전 내부 필드 쓰기 거부를 합성 데이터로 확인했다. 이메일 수정 시 `emailLower`가 낡은 값으로 남는 로컬 결함을 수정했다. 기존 이메일 우선·이름/과목 fallback 자동 매칭은 충돌하는 입력을 Auth 생성 전에 거부하도록 강화했다. Auth 생성 뒤 Firestore 실패의 rollback·재시도는 통과했지만 rollback 자체가 실패하는 경우와 실제 구버전 캐시 탭은 미검증이다. 이는 운영 노출 해결이나 배포 승인이 아니다. 상세 결과는 QA 허브 §16과 운영 매뉴얼 §15에 기록한다.

**2026-10-19 출시 전 추가 로컬 QA:** 기존 강사 관리 `엑셀` 버튼은 처리 코드가 없었고 계정 관리의 기존 XLSX는 미연결 강사의 private 메모 대신 상태 문구를 내보냈다. 관리자 CSV 연결과 XLSX 메모 수정을 합성 파일 다운로드로 확인했다. 공개/홈 순서의 서로 다른 설정, 학생·회원·학부모의 관련 강사명 표시, 구버전 관리자 JS의 최종 Rules 거부(오류 표시·문서 불변), Auth/Firestore 이중 실패 안내와 잔존 Auth의 중복 재생성 거부, bridge Rules의 새 관리자 쓰기와 내부 필드 재유입 차단을 로컬에서 검증했다. 공개 프로필의 `order`/`sortOrder`/`category`는 기존 공개 fallback으로 남겨 최종 허용 목록에 포함했다. 실제 운영 전체 field key·캐시 탭·백업/이전·역할 smoke는 별도 승인 단계이며 운영 노출 20건은 변하지 않았다. QA 허브 §17과 운영 매뉴얼 §15가 실행 기준이다.
