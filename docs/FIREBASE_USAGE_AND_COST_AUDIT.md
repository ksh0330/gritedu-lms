# Firebase/GCP Usage And Cost Audit

최종 갱신: 2026-09-12

## 1. 요약

현재 Grit Edu LMS/CMS는 저비용 정적 아키텍처를 지향합니다. 공개 정적 사이트 배포는 Cloudflare Pages Git integration 기준이며, Firebase Auth, Cloud Firestore, Cloud Functions, Secret Manager는 계속 사용합니다. Firebase Storage는 의도적으로 사용하지 않으며, 자주 바뀌는 공개 이미지는 Cloudflare R2 public 계층으로 분리합니다.

비용 평가는 정성 기준입니다. 실제 월 비용은 Firebase/GCP 콘솔의 사용량과 청구 리포트로 확인해야 합니다.

보안·권한·CRUD 분류는 `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md`가 우선합니다. 이론적 비용 최적화는 현재 결함과 구분하고, 성장 수치는 자동 전환이 아닌 수동 검토용 초기 지표로만 사용합니다.

2026-07-03 정책 문구 정비 메모: 공개 이용약관과 회원가입 동의 요약은 기술스택 노출을 줄였고, 개인정보처리방침 전문에는 Firebase/GCP 및 Cloudflare 관련 위탁, 국외이전, 접속 로그 가능성, 운영 기록 정리 기준을 사용자용 표현으로 유지했습니다. Google/Firebase/Gmail SMTP 및 Cloudflare 관련 위탁/국외이전 세부정보는 운영자 공식 문서 확인 항목으로 남아 있습니다.

## 2. 사용 중인 Firebase/GCP 서비스

| 서비스 | 사용 목적 | 비용 리스크 |
| --- | --- | --- |
| Cloudflare Pages | 운영 정적 사이트와 `dist/` 산출물 배포 | Pages 빌드/트래픽 한도, cache/header 설정 |
| Firebase Hosting | disable 완료; old URL 404 유지와 Search Console 정리 대상 | 의도치 않은 Hosting deploy 재개, old URL 색인 잔존 여부 |
| Firebase Authentication | 학생/회원/강사/관리자 로그인 | 사용자 수와 인증 요청 |
| Cloud Firestore | CMS/수강/오프라인/설정 데이터 | read/write/delete 횟수, 인덱스 |
| Cloud Functions for Firebase | Email verification, member-child linking, and daily transient-record cleanup | Invocation count, runtime, and Secret usage |
| Cloud Scheduler | `scheduledRecordCleanup` 매일 실행 trigger | job당 월 $0.10, 결제 계정당 3 job 무료 |
| Secret Manager | 이메일 발송 계정 비밀값 | secret 버전/접근 |
| Cloud Build / Artifact Registry | Functions 배포 산출물 | 배포 빈도, 오래된 artifact 보관 |
| Cloudflare R2 | 공개 팝업/강사/Story 이미지 및 향후 파일 계층 | storage/request/egress 정책, public/private 경계 |

## 3. 사용하지 않는 서비스

| 서비스 | 상태 | 이유 |
| --- | --- | --- |
| Firebase Storage | 의도적으로 미사용 | 이미지 운영은 로컬 `/assets`와 Cloudflare R2 public URL로 처리 |
| 결제/PG | 미구현 | 상품/환불/권한 모델 필요 |
| DRM/비공개 영상 권한 서버 | 미구현 | 공개 read `courses`와 분리된 권한 모델 필요 |
| Push 알림 | 미구현 | 수신 동의와 운영 정책 필요 |
| PWA Lite | 제한 구현 | 홈 화면 추가와 오프라인 안내 fallback만 제공. Push/FCM/offline-first LMS는 미구현 |

## 4. Hosting 계층

현재 운영 Hosting 기준:

- `https://gritedu.kr` → Cloudflare Pages
- `https://www.gritedu.kr` → `https://gritedu.kr` 301 redirect 완료
- `https://gritedu.pages.dev` → `https://gritedu.kr` 301 redirect 완료
- Cloudflare Pages deployment alias → 하위 도메인 포함 `https://gritedu.kr` 301 redirect 확인 완료
- `gritedu-lms.web.app`, `gritedu-lms.firebaseapp.com` → `firebase hosting:disable` 완료, curl 기준 404 확인 완료
- Firebase Auth/Firestore/Functions는 Hosting 이전과 무관하게 유지
- 일반 배포는 `git push origin main`을 하면 Cloudflare Pages가 `npm run prebuild`로 빌드하고 `dist`를 배포하는 방식입니다.

Cloudflare Pages 전환 효과:

- 운영 정적 HTML/CSS/JS/image/CSV/PDF 트래픽의 중심이 Firebase Hosting에서 Cloudflare Pages로 이동합니다.
- Firebase Hosting은 일반 운영 트래픽과 fallback/redirect 용도로 사용하지 않습니다.
- Firebase Auth, Firestore, Functions 비용은 계속 Firebase/GCP 기준으로 발생합니다.
- `firebase.json`의 Hosting headers는 Cloudflare Pages에 자동 적용되지 않습니다. 현재 운영 cache/header 기준은 `dist/_headers`입니다.
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 `https://gritedu.kr` 301 redirect로 대표 도메인에 수렴합니다. path/query 보존 확인도 완료되었습니다.

현재 `firebase.json`은 과거 Hosting 설정을 포함할 수 있지만 일반 운영 배포 기준이 아닙니다. `firebase.json` redirect-only 변경이나 Hosting deploy는 하지 않습니다.

비용/운영 포인트:

- Cloudflare Pages 운영에서는 이미지와 정적 파일 크기가 Pages/R2 트래픽과 사용자 체감 성능에 영향을 줍니다.
- Firebase Hosting download 증가는 현재 정상 운영 지표가 아닙니다. 증가가 보이면 old URL 접근, 의도치 않은 Hosting deploy, 테스트 조건을 확인합니다.
- WebP 사용은 트래픽 비용 절감에 도움이 됩니다.
- `dist/`는 빌드 산출물이므로 Git에 추적하지 않습니다.
- `npm run prebuild`는 `dist/_headers`와 `dist/version.json`을 생성합니다. `scripts/verify-build.js`는 `_headers`, `version.json`, 금지 파일 노출 여부를 검사합니다.

과거 2026-06-23 기준 Firebase Hosting download 관찰값(`120.7MB / 360MB per day` 수준)은 현재 운영 기준이 아니라 Cloudflare Pages 전환 전후의 참고 기록입니다. 2026-06-29 현재 Firebase Hosting은 `firebase hosting:disable` 완료 상태이므로 old URL 404 유지와 Search Console 색인 제거 상태를 중심으로 확인합니다.

현재 cache/download 감사 요약:

- `version.json`은 `no-cache, no-store, must-revalidate`로 새 배포 감지에 사용됩니다.
- HTML과 JS/CSS는 stale 방지를 위해 `no-cache` 계열입니다.
- 이미지와 폰트는 긴 cache가 가능하도록 설정되어 있습니다.
- `prebuild.js`는 HTML의 top-level JS/CSS URL에 build version query를 붙입니다.
- Phase D-1 이후 generated `dist/assets/js/**/*.js`의 local ES module import도 build version query가 적용됩니다. JS/CSS cache header를 길게 늘리는 작업은 browser QA 이후 별도 검토합니다.
- `/` root와 `/index.html`은 로컬 소스 기준 `no-cache, must-revalidate` 계열로 맞췄습니다. 운영 URL 기준 Cloudflare Pages `_headers` live response와 forbidden URL live response는 별도 QA 항목입니다.
- public instructor image는 `Date.now()` query cache-buster 없이 R2/local URL을 그대로 사용합니다. 이미지 변경은 새 R2 key 또는 새 local 파일명으로 처리합니다.

다운로드 증가를 만들 수 있는 운영 패턴:

- DevTools Disable cache 상태에서 반복 QA
- 배포 직후 여러 사용자의 일반 새로고침 또는 강력 새로고침 안내
- 관리자 화면 반복 테스트
- JS/CSS `no-cache`로 인한 반복 재검증
- local `/assets` popup/profile/curriculum 이미지 fallback 사용
- `school.csv`는 약 1MB 정적 파일이며, `no-store` 제거, build version query, `force-cache`, Promise/data 재사용으로 반복 다운로드 위험을 낮췄습니다. 파일 변경 시 `prebuild` 후 배포가 필요합니다.

Hosting 정적 파일과 Firestore CMS 데이터는 비용/캐시 기준을 분리해서 봅니다.

- HTML/CSS/JS, `version.json`, partial HTML, local `/assets`, CSV/PDF는 현재 운영 기준으로 Cloudflare Pages 트래픽에 영향을 줍니다.
- CMS 문구, 팝업 설정, 강사 정보, 시간표 노출 여부 같은 Firestore 데이터 변경은 Hosting 재배포나 Hosting cache 문제가 아닙니다.
- CMS 변경이 반영되지 않을 때는 hard refresh를 반복 안내하기보다 저장 성공, Firestore read, localStorage/sessionStorage cache, 화면 렌더링을 먼저 확인합니다.
- 강력 새로고침은 배포 직후 QA나 stale HTML/JS 문제가 의심될 때만 제한적으로 사용합니다.
- fixed local asset은 긴 immutable cache 대상이므로 같은 파일명을 덮어쓰지 않고 새 파일명과 새 배포로 교체합니다.
- R2 public image는 mutable public image를 정적 배포 산출물 밖에서 운영하게 해주지만, 같은 R2 key를 덮어쓰지 않고 새 key와 CMS URL 교체로 운영해야 cache 혼선을 줄일 수 있습니다.
- Firebase Console 사용량/청구 관찰값과 DevTools Network의 transferred 값은 측정 기준이 다르므로 같은 수치로 해석하지 않습니다.

도메인/SEO 운영 상태:

- 공식 대표 도메인은 `https://gritedu.kr`이며, 현재 Cloudflare Pages custom domain입니다. Cloudflare Pages 대표 도메인은 `gritedu.kr` 하나로 확정합니다.
- 공개 HTML의 canonical, `og:url`, sitemap, JSON-LD는 `gritedu.kr` 기준으로 정리되었습니다.
- `gritedu.kr` Search Console 속성에는 `https://gritedu.kr/sitemap.xml` 제출이 완료되었습니다. sitemap 발견 페이지는 6개이며, 주요 URL은 페이지 색인 생성됨 상태로 확인했습니다.
- old `gritedu-lms.web.app` Search Console 속성은 임시 삭제 요청 처리 상태 확인용으로 유지합니다. old Firebase Hosting URL은 임시 삭제 요청 처리 중이며, 404 유지로 색인 제거를 유도합니다.
- `gritedu-lms.web.app`과 `gritedu-lms.firebaseapp.com`은 Firebase Hosting disable 완료로 curl 기준 404를 반환하며, fallback/rollback/redirect 용도로 사용하지 않습니다.
- `www.gritedu.kr`은 `https://gritedu.kr`로 301 redirect 완료 상태입니다.
- `gritedu.pages.dev`는 `https://gritedu.kr`로 301 redirect 완료 상태입니다.
- Cloudflare Pages deployment alias도 하위 도메인 포함 설정으로 `https://gritedu.kr` 301 redirect 확인 완료 상태입니다.
- Cloudflare redirect는 path/query 보존 확인까지 완료되었습니다.
- Naver Search Advisor old 도메인 검색 제외 요청은 완료되었습니다.
- `gritedu.online`은 과거 Adobe Portfolio 도메인으로, 현재 코드에서 직접 제어하기보다 검색 제외 처리 후 재확인 대상으로 추적합니다.
- 대표 도메인 신호는 sitemap/robots/canonical/OG/JSON-LD로 유지합니다. Firebase Hosting old URL의 `gritedu.kr` 301 redirect 작업은 하지 않습니다.

## 5. Authentication

Auth는 역할별 로그인에 사용합니다.

역할 판정 기준:

- `admins`
- `students`
- `members`
- `instructorAccounts`
- `instructors`

주의:

- Auth 계정 삭제와 Firestore profile 삭제는 별도 작업일 수 있습니다.
- 관리자 계정 생성/삭제는 운영 절차와 권한 검토가 필요합니다.

## 6. Firestore

Firestore는 현재 시스템의 핵심 데이터 저장소입니다.

주요 collection:

- `admins`
- `students`
- `members`
- `studentParentLinks`
- `memberChildLinkAttempts`
- `instructors`
- `instructorAccounts`
- `courses`
- `enrollments`
- `offlineClasses`
- `offlineClassMembers`
- `offlineClassSessions`
- `offlineSessionAccess`
- `publicTimetableEntries`
- `pages`
- `settings` (운영 정리 정책: `settings/retentionPolicy` — 관리자 전용)
- `emailVerifications`
- `signupAttempts`
- legacy `operationTasks` (신규 생성 중단, cleanup 대상 제외)

비용 리스크:

- 관리자 목록 화면의 broad read
- 공개 강의/시간표 페이지 read
- 카카오톡 채널 플로팅 버튼 대상 공개 페이지의 `settings/kakaoChannel` 로드 시 1회 read
- 학생/강사 대시보드의 enrollment/class/session 조회
- Operation-tasks page entry reads only `settings/retentionPolicy` once for the last-run summary; there is no offline preview or transient manual-delete handler
- `scheduledRecordCleanup`: three daily bounded `cleanupAt` queries and transient deletes only
- 불필요한 실시간 listener 도입

비용 통제:

- 필요한 화면에서만 데이터를 읽습니다.
- 카카오톡 채널 설정은 대상 공개 페이지에서만 읽고 `members/**`, 상세, 약관/정책 페이지에서는 읽지 않습니다.
- 페이지네이션/필터링을 유지합니다.
- 공개 read 컬렉션에는 민감 정보를 넣지 않습니다.
- Expiring transient data is managed by the daily bounded scheduler. The current administrator page displays the last-run summary but does not implement transient manual deletion.
- The administrator UI now performs one read of the current cleanup summary and exposes no offline-retention form or preview. It does not query `offlineClassSessions` or `offlineSessionAccess`, and it performs no client write.

### 6-1. Offline session/access lifecycle cost

Current official Firestore billing references:

- [Firebase Firestore billing](https://firebase.google.com/docs/firestore/pricing)
- [Google Cloud Firestore pricing by location](https://cloud.google.com/firestore/pricing)
- [Firestore quotas](https://firebase.google.com/docs/firestore/quotas)
- [Firestore TTL behavior](https://firebase.google.com/docs/firestore/ttl)
- [Firestore index behavior](https://firebase.google.com/docs/firestore/query-data/index-overview)

As checked on 2026-08-13, the official free quota for the one eligible database is 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day, and 20,000 deletes/day. The Seoul (`asia-northeast3`) default rates displayed beyond free quota are USD $0.03/100,000 reads, $0.09/100,000 writes, and $0.01/100,000 deletes. Pricing, billing currency, database eligibility, and regional rates can change; the live official pages and the project's billing console control.

Document count alone does not establish zero cost. Firestore bills returned document reads, eligible index-entry reads, writes, deletes, stored document metadata, automatic/composite indexes, and bandwidth. Every query has a minimum one-read charge, including an empty result. Count aggregations read index entries and have a minimum one-read charge. Rules-dependent `get()`/`exists()` evaluations can add reads.

For this data model:

- session growth is `C * F * W`;
- access growth is `E * C * F * W * M`, where `E` is the measured manual-exception fraction, not the full roster by default;
- current page costs grow with returned class history and student exception history. The administrator offline-class list previously issued `2 * C` count aggregations; the deployed implementation issues them only for uncached visible rows (`2 * min(C, pageSize)` on the first view);
- indexed equality query performance is not a full collection scan merely because the collection grows, but unbounded result sets and N+1 request counts still increase reads and latency;
- storage estimates must include URL length, repeated field names, document IDs, metadata, legacy duplicates, and index entries. The scenario and illustrative size tables are in `OFFLINE_CLASS_SYSTEM_PLAN.md`.

Native Firestore TTL is **not included in free usage** and requires billing. TTL deletes are normally asynchronous, may take about 24 hours, do not cascade subcollections, are not transactional or guaranteed in expiration order, can bulk-delete already-expired documents when enabled, and trigger listeners/Firestore triggers. Those properties do not solve the current authorization dependency or reopen behavior.

Retention mechanism comparison:

| Mechanism | Read/delete cost shape | Operational control | Decision |
| --- | --- | --- | --- |
| Keep + archive | No purge reads/deletes; continued storage and normal page reads | Reversible and preserves evidence | **Recommended now** |
| Native TTL | Billed deletes outside free usage; no candidate-read query, but new TTL field/index policy and possible initial bulk deletion | Asynchronous and nontransactional; weak dependency control | **Not approved** |
| Existing bounded scheduled Function | Predictable bounded reads/deletes and count logs | Already allowlisted for transient records only | Do not add offline records back |
| Owner-approved manual purge | Candidate reads plus explicit delete operations | Highest review control; can stop after each small batch | Deferred until inventory and approval |

The first expected pressure at the current academy scale is read shape, not proven storage cost. Reconsider query bounds and count aggregation before choosing physical deletion merely to reduce document count.

### 6-2. 2026-08-24 focused read-shape correction

Owner-provided reference: repeated beta testing previously showed **151,086 Firestore document reads** and approximately **KRW 8** for the Seoul database. This is a historical console observation supplied for prioritization, not a measurement reproduced by this audit and not a forecast of monthly production cost.

| Flow | Before | Current deployed implementation | Expected effect |
| --- | --- | --- | --- |
| Administrator student status | `students` list plus 2 relationship queries for every student whose page became visible; moving/searching could repeat those reads | After the explicit button, one `students` list plus two relationship queries per uncached UID chunk of at most 10. Default first page and each unseen 10-row page use 2; 20/50-row views use up to 4/10. Search commit filters locally and does not fetch an unseen summary; cached pages use 0 | Query requests and document reads are separate: each unseen chunk uses 2 query requests, while charged document reads depend on matching relationship documents returned (plus the normal minimum charge for an empty query). Revisited cached UIDs add neither relationship query nor relationship document read. |
| Student detail titles | Relationship queries and course/class document gets could repeat per detail open | Summary IDs are reused; each distinct course/class document has one promise per current page load | Reopening details avoids duplicate master-document gets within the load. |
| Administrator member child summary | No child column on the member list | Query `studentParentLinks` for visible member UIDs in `in` chunks of at most 10, filter active status in memory, render names from the stored student snapshot, and cache each member result in page memory | The default 10-row page adds 1 bounded relationship query, while 20/50 rows add up to 2/5. Charged reads include every returned link for those UIDs, including revoked history; there is no per-row query or student-document get, and cached revisits add 0. |
| Administrator member records | Recent child attempts used a broad ordered fallback and signup attempts required Console inspection | General-member detail has no child-attempt DOM. Parent detail performs no attempt read until `연동 기록 보기`; that click runs `memberUid == selectedUid`, limit 30 and locally displays up to 3 failures or 5 total. Signup records remain an exact-email, limit-20 explicit read with a 10-card cap | Opening the member list/detail adds 0 attempt reads. Each first explicit click reads only returned matching documents within its hard limit; view toggles reuse page-memory rows. No direct-ID/global fallback, listener, IP-wide search, or `emailVerifications` query was added. |
| Child auto-link candidate lookup | One full `students` collection read per accepted attempt | Exact `name == input.studentName` candidate query, then school/grade/phone comparison in memory; only when no complete match is found, up to two legacy-name prefix queries run with limit 50 each | Normal candidate reads change from `S` student documents to `K` same-name candidates. The bounded fallback preserves legacy whitespace variants without restoring an unbounded collection scan; each query still has the normal minimum query charge. |
| Child link/count transaction | Link creation was followed by a separate member-scoped recount query and member update | The deterministic link write, current member validation, member-scoped active-link query, and exact member count/flag update share one transaction | The scoped relationship query remains, but the late recount/write race and separate post-transaction member update are removed. Concurrent manual/automatic writes conflict on the member document and retry or fail closed. |
| Member linked-child dashboard | Per child, 2 relationship queries plus sequential master document gets | Children load concurrently; shared course/class IDs reuse one promise | Relationship document count is unchanged under current Rules, but latency is reduced and duplicate shared master reads become one per distinct ID. |
| Public footer | CMS call failed before Firestore because `footer` was absent from the allowlist; static HTML always remained | One `settings/footer` server read, then up to 5-minute memory/session reuse; static fallback remains | Adds the intended CMS read, bounded to one per session-cache window instead of one per public-page navigation. |
| Signup attempt limiter | IP/email histories could remain for 30 days or beyond a week-long block and be returned by single-field queries | New accepted attempts expire after 1 day; email 5/hour is primary and IP 30/hour is auxiliary | One day still covers the one-hour limiter window. After old records age out by stored `cleanupAt`, each limiter query returns a shorter diagnostic history. |
| Administrator offline-class counts | One sessions count and one members count aggregation for every loaded class (`2 * C`) | Count only uncached rows on the visible page and reuse a page-memory map; default first/unseen 10-row page uses up to 20 aggregation queries, cached revisit uses 0 | Query request count falls from `2 * C` to `2 * min(C, pageSize)` on the first view. Aggregations are billed from index entries with a minimum charge; they do not return relationship documents, so they must not be reported as `2 * visible rows` document reads. |

`S` is the number of loaded student profiles and `K` is the number of exact-name candidates. For administrator student status, default first and first-seen pages cost 2 relationship-query requests; for member child summaries they cost 1. Cached pages and local search commits cost 0. A 20/50 page-size selection can cost up to 4/10 student-summary queries or 2/5 member-summary queries for uncached visible UIDs. Document reads are the matching relationship documents for newly queried UIDs, not the number of query requests. Explicit student export can query uncached UIDs in `2 * ceil(U / 10)` requests, where `U` is the number of uncached exported students. Whether server pagination is needed still depends on measured document count, P95 time, daily reads, and operator workflow. No listener, summary collection, counter service, search service, or index was added.

The one-day signup-attempt lifetime covers the one-hour rolling abuse window and is proportionate to this transient rate-limit event. Firestore Auto IDs remain in use to avoid sequential/time-derived keys and hotspots. Operators must use exact email/IP plus `timestamp` ordering/range, not document-ID order. The one-day/no-user-agent writer is production `Deployed`; historical attempts keep their existing `cleanupAt` and no migration or bulk delete is authorized.

### 6-3. Primary list query/read map

`N` below means documents returned by a full master-list query, not the 10 rows rendered by UI pagination. `P` is the public published-course result count, and `V` is the visible offline-class count.

| Screen | First list load | Search/filter/page | Detail/save behavior |
| --- | --- | --- | --- |
| Students | Explicit `students` query returns all `S`; current-page summaries use `2 * ceil(uncachedVisible/10)` relationship queries | Search/filter commit is local and adds 0; unseen page may add the scoped summary queries above; cached page 0 | Detail reuses cached relationship IDs; only a summary-missing student adds 2 scoped relationship queries. Referenced course/class documents are promise-cached. Save refreshes the full student list. |
| Members | Explicit one-query full `members` load returns `M`; uncached visible child summaries use `ceil(visible/10)` member-UID link queries and no student get | Search/page/page-size are local; unseen pages may add only the scoped summary queries, cached pages add 0 | Detail uses 2 member-scoped relationship queries; each linked child adds one student get and 2 child-scoped relationship queries. Referenced course/class gets are cached. The redundant selected-member get was removed. Manual link/unlink uses one Firestore transaction and refreshes only the selected detail plus affected summary cache entry. |
| Instructors | Full `instructors`, `instructorAccounts`, `courses`, and `offlineClasses` collection queries plus bounded settings reads | Search/page/page-size are local, 0 query; assignments are joined in memory, so no row N+1 | Create/update/delete paths refresh the relevant full lists; editing a linked name also queries assigned courses for propagation. |
| Consolidated accounts | Explicit five full collection queries: `students`, `members`, `instructorAccounts`, `instructors`, `admins` | Search/filter/page/page-size are local, 0 query | Cleanup/detail actions use selected-UID queries/gets. Successful mutations generally reload all five lists. |
| Online courses (admin) | Full ordered `courses` query, full `instructors` query, and bounded settings reads | Search/filter/page/page-size are local, 0 query | Enrollment modal is course-scoped; CRUD generally reloads the full courses list. |
| Offline classes (admin) | Full `offlineClasses` and `instructors` queries plus settings; visible uncached rows use `2 * V` count aggregations | Search/filter commit is local and loads no new counts; unseen page/page-size/group selection loads only uncached visible counts | Member/session/access modals are class/session scoped. Student-add modal loads the full student master once per page lifetime for local substring search. Class CRUD commonly reloads the full class list. |
| Online courses (public) | One published/public `courses` query returns all `P`, plus bounded catalog/color settings reads | Search/filter/page/page-size are local, 0 query. UI pagination does not reduce `P` document reads | Card open navigates to detail; the list is read-only. |

Popup, timetable, and site-management rows are bounded settings/page document arrays without a general text-search list. Their existing editor-specific previews and small catalogs were kept; forcing server pagination there would add complexity without reducing a collection scan.

### 6-4. Role dashboard query/read map

Direct document gets, query requests, and returned document reads are different measures. The shared role guard checks role documents in order until one exists, so its direct gets are additional to the feature reads below. A missing direct document and an empty query can still incur the applicable minimum read charge.

| Dashboard | Initial/explicit reads | Local interaction and detail behavior | Remaining characteristic |
| --- | --- | --- | --- |
| Student | After the role guard, one transaction read of `students/{uid}` checks the annual grade marker and reuses the result for the welcome name. Normal entry remains one profile read; only transaction contention can retry it, and an eligible account adds at most one profile write per year. Bounded settings reads feed labels/colors/D-Day. One student-scoped `enrollments` query returns `E`; one get per distinct referenced course returns up to `C`. One `offlineClassMembers where studentUid == uid` query returns `M`; referenced class gets return up to distinct `O`. | Course status tabs and list-count/stat calculation reuse arrays and add 0 reads. Unenroll deletes the selected enrollment and updates memory without a full dashboard reload. Offline list has no client filter query. | Course/class master resolution is still a scoped N-document get fan-out; document reads track distinct referenced documents, not the number of cards shown. The removed list summaries had no count-only query. |
| Member (general) | After the role guard, one `members/{uid}` get, bounded color settings, one member-scoped enrollment query, and one get per distinct course. | No list count query; rendered course count text was removed. Profile updates do not reload the course list. | Master course gets remain proportional to distinct enrolled courses. |
| Member/parent | After the role guard and member get, one `studentParentLinks where memberUid == uid` query. Each active child uses two child-scoped relationship queries (`enrollments`, `offlineClassMembers`); shared course/class document IDs reuse one promise per load. | Expanding child cards is local. Only successful/already-linked callable results reload the child query set; notFound/failure/timeout do not. | Relationship document reads remain proportional to returned child rows. A combined cross-child query is not used because client authorization has not been proven for a broader shape. |
| Instructor | After the role guard, bounded settings plus one shared page-memory `instructorAccounts/{uid}` promise serve settings and welcome resolution; a profile get/query is used only when needed. Assigned online courses use 2-6 exact instructor-field queries; assigned offline classes use 2-4 exact queries, with duplicate IDs joined in memory. Roster reads are deferred until the explicit buttons: one enrollment query per member-only course and one member query per assigned class. | Course/class searches, filters, pagination, expansion, and stat calculation are local, 0 reads. Re-clicking a roster button explicitly refreshes that roster. Removed list summaries had no count-only query. | Query requests and returned documents must be counted separately; a document matching multiple legacy/current instructor-field queries can be returned and billed more than once. Course/class-scoped roster fan-out remains a measured follow-up, not an initial-entry cost. |

The list UI correction keeps fixed viewport/min-height solely for layout. Sparse last pages do not stretch cards or rows, positive result/range/total summaries are absent, and pagination clicks do not scroll the browser. None of those presentation changes alter the master-query document counts in section 6-3.

Unchanged paths were deliberately left as follows:

- Public course/instructor lists load their current master data/settings and filter the in-memory arrays; public timetable loads `settings/timetableCatalog`. Committed search/filter/page changes are not additional Firestore reads.
- Administrator member, instructor, course, and offline-class screens keep their explicit small-master loads and local search. Member child summaries and offline-class counts are visible-page lazy queries/aggregations with memory reuse; no counter service or summary collection was added.
- Student dashboards keep student-scoped enrollment/class queries and referenced document gets, with the initial student profile reused for the welcome name. The same transaction initializes a missing promotion marker without changing the stored grade and adds no extra read. Student profile and administrator edit screens reuse their already loaded grade to detect a real grade change; the current-year marker is added to the existing document write, so name/phone-only edits do not touch it and Firestore operation counts do not increase. Instructor dashboards keep assigned course/class/roster scopes and share the account read within initialization. Remaining referenced-master fan-out and explicit roster reads need P95/document-count evidence before broader batching or denormalization.
- Member linked children still require child-scoped relationship queries under current Rules. A combined cross-child query was not introduced because client authorization must be proven before broadening query scope.

### 6-5. 2026-09-12 account-cleanup source measurement

This measurement counts the current source operations for one explicit administrator preview or execute action. It is not a production daily-read total. Firestore billing still depends on returned documents, minimum query charges, Rules-dependent reads, retries, and actual operator frequency.

| Explicit action | Direct gets and scoped queries | Routine page-load impact |
| --- | --- | --- |
| Student cleanup preview | One student profile get; five UID-scoped queries for enrollments, class memberships, session access, parent links, and matched child-link attempts; then one exact verification-document get and one exact-email signup-attempt query. Total source requests: 8, plus returned documents. | 0. Runs only after the operator opens cleanup. |
| Student cleanup execute | Repeats the same 8 current-state requests immediately before deletion. An active or malformed/non-revoked parent link stops all writes and requires the existing administrator revoke transaction first. | 0. No list entry, search, or typing trigger. |
| General/parent cleanup preview | One member profile get; three member-scoped queries for enrollments, links, and attempts; one exact verification-document get; one exact-email signup-attempt query; plus up to five course-title gets for preview samples. Total source requests: 6 to 11. | 0. Runs only after the operator opens cleanup. |
| General/parent cleanup execute | Repeats the six current-state profile/relationship/transient requests without course-title sample gets, then deletes dependencies before the member profile. | 0. No listener, collection-wide fallback, or row N+1 was added. |

The last available production observation remains the owner-supplied historical 151,086 document reads and approximately KRW 8. A new console time-series could not be reproduced during this local task because the Firebase Console required an interactive Google account login; compare the same date range and similar beta/administrator traffic after deployment before prioritizing more query changes.

No rate-limit reset API or administrator delete button was added. Normal users receive the rolling-window retry time and recover without a week-long block. Automated testing uses pure in-memory policy fixtures. Any exceptional production reset would require a separately approved, exact-key bounded inventory/action; collection-wide deletion is not an accepted test procedure.

## 7. Functions

현재 Functions는 최소화된 보조 역할입니다.

확인된 주요 함수:

- `linkMemberChild`
- `sendVerificationCode`
- `verifyEmailCode`
- `scheduledRecordCleanup`

`functions/index.js` exports exactly these four. `member-child-link-policy.js`, `signup-rate-limit-policy.js`, `email-verification-policy.js`, and their tests are helper/test modules and do not create deployable Functions. General CRUD/search/pagination/count work must not add a Function export without owner approval.

사용 목적:

- 일반 회원과 학생/자녀 연결 보조
- 이메일 인증 코드 발송/검증
- 만료성 운영 기록 3종 매일 자동 정리
- The scheduler no longer reads offline-retention policy fields or deletes offline session/access records.
- Secret Manager를 통한 이메일 계정 정보 사용

주의:

- The obsolete administrator offline preview has been removed. The status page and `scheduledRecordCleanup` remain separate: the page reads one summary document, while the scheduler performs the bounded transient cleanup.
- `scheduledRecordCleanup` runs daily at 03:00 Asia/Seoul. It performs exactly three indexed `cleanupAt <= now` queries, each ordered by `cleanupAt` and limited to 500 documents. It does not perform the former monthly full scans.
- A due `cleanupAt` is sufficient within the three transient allowlist collections; the Function no longer spends reads on due documents only to defer them behind obsolete 30/90/180-day age checks.
- Each delete carries the document snapshot `updateTime` as a last-update precondition. A resend or other writer that updates a due document after preflight therefore aborts that batch instead of deleting the newer active state; a later scheduler run reevaluates it from a fresh snapshot.
- Verification send/verify now use one transaction each against the canonical email document. This replaces the resend query/batch invalidation path, prevents concurrent replay/update races, and adds no index or collection. Profile self-create adds one Rules-dependent direct read of the exact verification document.
- All three prerequisite reads finish before deletion. A read failure aborts the run. The Function does not read `settings/retentionPolicy` for offline cleanup and never targets `offlineClassSessions` or `offlineSessionAccess`.
- Expected scheduled Firestore work is at most three bounded queries, up to three 500-operation delete batches, and one summary write. Empty-result query billing and actual deployment usage must be confirmed in Firebase/GCP monitoring.
- Cloud Scheduler는 job당 월 $0.10이며 결제 계정당 3 job 무료입니다. 실행 횟수보다 Firestore read/delete가 실질 비용 판단의 중심입니다.
- Functions 배포는 Cloud Build/Artifact Registry 흔적을 만들 수 있습니다.
- Functions 의존성은 `functions/package.json`과 `functions/package-lock.json`으로 관리합니다. `functions/node_modules`는 Git에 추적하지 않습니다.

## 8. Secret Manager, Cloud Build, Artifact Registry

Secret Manager는 이메일 발송 계정 같은 민감 값을 저장합니다.

Cloud Build와 Artifact Registry는 Functions 배포 과정에서 자동으로 사용될 수 있습니다. Firebase Storage를 사용하지 않아도 GCP 콘솔에 artifact/storage 관련 항목이 보일 수 있습니다.

운영 기준:

- 오래된 build artifact 보관 정책을 주기적으로 확인합니다.
- Secret version이 불필요하게 늘어나지 않게 관리합니다.
- Functions 배포 빈도를 통제합니다.

## 9. Firebase Storage 미사용 정책

이미지는 다음 방식으로 운영합니다.

- 고정 브랜드/앱 자산은 로컬 `assets/**`에 둡니다.
- 자주 바뀌는 공개 운영 이미지(popup, instructor profile/curriculum, story hero/CEO)는 Cloudflare R2 public HTTPS URL을 CMS에 저장할 수 있습니다.
- 운영 R2 public base URL은 `https://assets.gritedu.kr`입니다.
- legacy `r2.dev` URL은 과도기 호환으로 허용하지만, 신규 운영 입력은 custom domain을 우선합니다.
- 로컬 경로는 CMS에 `/assets/...`를 저장하고 `npm run prebuild`, `npm run verify`, commit, `git push`, Cloudflare Pages 배포 확인이 필요합니다.
- R2 public URL은 prebuild missing asset 검사 대상이 아니며 mutable public image를 정적 산출물 트래픽에서 분리할 수 있습니다.
- Cloudflare Pages가 `dist/assets/**`를 제공하고, CMS에 저장된 외부 R2 URL은 Cloudflare R2 public domain에서 직접 로드됩니다.
- R2 public URL whitelist는 `assets/js/utils/public-image-url.js`에서 관리합니다.
- 2026-06-29 기준 `assets.gritedu.kr` 기반 R2 이미지 로딩 QA는 완료되었습니다.

R2 public 이미지 이전은 자주 바뀌는 public image를 정적 배포 산출물과 분리하는 효과가 있습니다. 특히 popup, instructor profile, instructor curriculum, Story hero/CEO 이미지는 R2 public URL + 새 key 정책을 쓰면 배포 없이 교체할 수 있고, immutable `/assets` 같은 파일명 교체 문제도 줄일 수 있습니다.

Story 이미지 정책:

- 공식 prefix: `https://assets.gritedu.kr/public/story/`
- 필요 시 허용 prefix: `https://assets.gritedu.kr/public/pages/story/`
- 허용 확장자: `.jpg`, `.jpeg`, `.png`, `.webp`
- 권장 교체 방식: 같은 key overwrite가 아니라 `banner_main-20260626.webp` 같은 새 key + CMS URL 교체
- 학생 리포트, 자료실 PDF, 과제 첨부 같은 private 파일은 R2 public Story prefix와 섞지 않습니다.

단, 다음 범위는 여전히 Cloudflare Pages 또는 외부 CDN 대상입니다.

- HTML, JS, CSS
- `version.json`
- `assets/partials/**/*.html`
- 고정 로고/아이콘/hero 이미지
- local rollback/fallback 이미지
- `assets/school.csv`
- footer/legal PDF
- Google Fonts와 Firebase SDK 외부 CDN

Storage를 도입하려면 별도 설계가 필요합니다.

- Storage rules
- 업로드/삭제 권한
- 비용 모니터링
- 기존 `/assets` 경로 migration
- 이미지 최적화 파이프라인

## 10. 현재 비용 모델 평가

현재 구조는 소규모 학원 운영에 적합한 저비용 모델입니다.

강점:

- Cloudflare Pages 정적 Hosting 중심
- Functions 최소 사용
- Storage 미사용
- 이미지 WebP 최적화
- Firestore rules 기반 단순 권한 모델

주의:

- 관리자 화면이 많은 문서를 한 번에 읽으면 Firestore read 비용이 늘 수 있습니다.
- 공개 강의/시간표 트래픽이 커지면 Cloudflare Pages/R2 트래픽이 늘 수 있습니다.
- 이메일 인증 Functions가 공격받으면 호출/메일 비용 리스크가 있습니다.

## 11. 모니터링 체크리스트

월 1회 확인:

- Firebase Hosting old URL 404 유지 여부와 의도치 않은 Hosting deploy 부재
- Cloudflare Pages 배포 성공률, preview/production 상태, `_headers` 적용 여부
- Cloudflare R2 storage/request/download 사용량
- Firestore read/write/delete 추세
- Functions 호출 수, 오류율, 실행 시간
- `scheduledRecordCleanup` 실행 결과와 삭제 건수
- Operation-tasks read-only status display and authenticated administrator smoke result; no offline preview or transient manual-delete handler exists
- Secret Manager 접근/버전
- Cloud Build/Artifact Registry artifact 보관량
- 예산 알림 설정 상태
- 큰 asset 파일과 `dist` 상위 파일 크기
- hard refresh 또는 강력 새로고침 안내 사용 여부
- 배포 후 version prompt 동작과 일반 reload로 최신 버전이 반영되는지
- R2 public 이미지가 같은 key overwrite 없이 새 key로 교체되는지
- Google Search Console `gritedu.kr` sitemap/색인 상태와 old `gritedu-lms.web.app` 임시 삭제 요청 상태
- Naver Search Advisor old 도메인 검색 제외 상태
- `gritedu.online` 검색 제외 후 재확인 상태
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias의 `https://gritedu.kr` 301 redirect와 path/query 보존 상태
- R2 이미지 QA 완료 상태와 새 URL 교체 운영 상태
- Cloudflare Pages `_headers` live QA, forbidden URL live QA, 관리자 CMS QA, 모바일/iPhone/KakaoTalk QA 상태

배포 전 확인:

- `dist/`가 Git에 추적되지 않는지
- `dist/_headers`와 `dist/version.json`이 생성되었는지
- `dist/firestore.rules`, `dist/firebase.json`, `dist/.firebaserc`, `dist/storage.rules`가 없는지
- `functions/node_modules`가 Git에 추적되지 않는지
- 이미지 누락 참조가 없는지
- 공개 read 데이터에 민감 정보가 없는지
- `prebuild` 산출물의 `version.json`과 HTML `grit-build-version`이 일치하는지
- JS/CSS URL version query가 주요 public/admin HTML에 붙었는지

관련 감사:

- `docs/audits/CACHE_VERSIONING_OPERATIONS_PLAN.md`
- `docs/audits/HOSTING_CACHE_DOWNLOAD_AUDIT.md`

## 12. 미구현/보류 리스크

- 결제는 구현되지 않았습니다.
- DRM은 구현되지 않았습니다.
- 비공개 영상 projection 모델은 구현되지 않았습니다.
- Native app과 Push 알림은 구현되지 않았습니다.
- PWA Lite는 홈 화면 추가와 네트워크 장애 안내 fallback 범위로 제한 구현되어 있으며, Firebase Cloud Messaging, 푸시 구독 정보 저장, 학생/회원/관리자 화면의 offline-first 캐시는 구현되지 않았습니다.
- Firebase Storage 업로드 CMS는 구현되지 않았습니다.

이 기능들은 단순 추가 작업이 아니라 권한/비용/운영 모델 재설계가 필요한 영역입니다.
