# Firebase/GCP Usage And Cost Audit

최종 갱신: 2026-07-06

## 1. 요약

현재 Grit Edu LMS/CMS는 저비용 정적 아키텍처를 지향합니다. 공개 정적 사이트 배포는 Cloudflare Pages Git integration 기준이며, Firebase Auth, Cloud Firestore, Cloud Functions, Secret Manager는 계속 사용합니다. Firebase Storage는 의도적으로 사용하지 않으며, 자주 바뀌는 공개 이미지는 Cloudflare R2 public 계층으로 분리합니다.

비용 평가는 정성 기준입니다. 실제 월 비용은 Firebase/GCP 콘솔의 사용량과 청구 리포트로 확인해야 합니다.

2026-07-03 정책 문구 정비 메모: 공개 이용약관과 회원가입 동의 요약은 기술스택 노출을 줄였고, 개인정보처리방침 전문에는 Firebase/GCP 및 Cloudflare 관련 위탁, 국외이전, 접속 로그 가능성, 운영 기록 정리 기준을 사용자용 표현으로 유지했습니다. Google/Firebase/Gmail SMTP 및 Cloudflare 관련 위탁/국외이전 세부정보는 운영자 공식 문서 확인 항목으로 남아 있습니다.

## 2. 사용 중인 Firebase/GCP 서비스

| 서비스 | 사용 목적 | 비용 리스크 |
| --- | --- | --- |
| Cloudflare Pages | 운영 정적 사이트와 `dist/` 산출물 배포 | Pages 빌드/트래픽 한도, cache/header 설정 |
| Firebase Hosting | disable 완료; old URL 404 유지와 Search Console 정리 대상 | 의도치 않은 Hosting deploy 재개, old URL 색인 잔존 여부 |
| Firebase Authentication | 학생/회원/강사/관리자 로그인 | 사용자 수와 인증 요청 |
| Cloud Firestore | CMS/수강/오프라인/설정 데이터 | read/write/delete 횟수, 인덱스 |
| Cloud Functions for Firebase | 이메일 인증, 회원-자녀 연결 보조, 월간 운영 기록 자동 정리 | 호출 횟수, 실행 시간, Secret 사용 |
| Cloud Scheduler | `scheduledRecordCleanup` 월간 실행 trigger | job당 월 $0.10, 결제 계정당 3 job 무료 |
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
- 운영 기록 정리 화면의 수동 조회/삭제
- `scheduledRecordCleanup` 월간 full scan/delete (운영 기록 3종 + `settings/retentionPolicy` 기반 오프라인 회차)
- 불필요한 실시간 listener 도입

비용 통제:

- 필요한 화면에서만 데이터를 읽습니다.
- 카카오톡 채널 설정은 대상 공개 페이지에서만 읽고 `members/**`, 상세, 약관/정책 페이지에서는 읽지 않습니다.
- 페이지네이션/필터링을 유지합니다.
- 공개 read 컬렉션에는 민감 정보를 넣지 않습니다.
- 만료성 데이터는 월간 자동 정리와 월 1회 수동 정리로 관리합니다.
- 수동 운영 기록 정리는 `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts` 3개 컬렉션만 각 1회 조회합니다.
- 오프라인 회차 정리는 CMS `settings/retentionPolicy`로 설정하며, 기본 180일·게시/보관·실제 삭제·1회 200건·미리보기 50건입니다.

## 7. Functions

현재 Functions는 최소화된 보조 역할입니다.

확인된 주요 함수:

- `linkMemberChild`
- `sendVerificationCode`
- `verifyEmailCode`
- `scheduledRecordCleanup`

사용 목적:

- 일반 회원과 학생/자녀 연결 보조
- 이메일 인증 코드 발송/검증
- 만료성 운영 기록 월간 자동 정리
- `settings/retentionPolicy` 기반 오프라인 회차 정리 (같은 scheduler job)
- Secret Manager를 통한 이메일 계정 정보 사용

주의:

- 운영 cleanup은 관리자 클라이언트 수동 정리와 `scheduledRecordCleanup` 자동 정리를 병행합니다.
- `scheduledRecordCleanup`은 매월 1일 03:00 Asia/Seoul에 실행되며 운영 기록 3개 컬렉션 scan/delete + `offline-session-cleanup.js`(`settings/retentionPolicy`)를 이어서 실행합니다. **새 Cloud Scheduler job은 추가하지 않습니다.**
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
- 운영 기록 수동 정리 사용 여부. 수동 UI는 월 1회, 컬렉션 3개 각 1회 read, 컬렉션당 300건 삭제 상한
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
