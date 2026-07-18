# Project State

최종 갱신: 2026-07-06

## 1. 프로젝트 목적

Grit Edu LMS/CMS는 학원 운영자가 온라인 강의, 오프라인 수업, 회원/학생/강사 계정, 공개 시간표, 팝업/사이트 콘텐츠를 관리하기 위한 Firebase 기반 정적 웹 서비스입니다.

현재 목표는 과금, DRM, 앱 중심 서비스가 아니라 낮은 운영비로 학원 운영에 필요한 핵심 LMS와 관리자 CMS를 안정적으로 제공하는 것입니다.

## 2. 현재 아키텍처

| 영역 | 현재 상태 |
| --- | --- |
| 프론트엔드 | 정적 HTML/CSS/JS |
| 정적 Hosting | Cloudflare Pages, 연결된 production branch Git push 기반 자동 배포, `dist/` 산출물 배포 |
| 백엔드 | Firebase Authentication, Cloud Firestore, Firebase Functions 유지 |
| Firebase Hosting | disable 완료; `gritedu-lms.web.app`/`gritedu-lms.firebaseapp.com`은 404 유지, fallback/redirect 용도로 미사용 |
| Functions | 이메일 인증, 일반 회원-자녀 연결 보조 로직, 월간 운영 기록 자동 정리 |
| 이미지/파일 계층 | Firebase Storage 미사용; 고정 자산은 로컬 `/assets`, 자주 바뀌는 공개 이미지(popup/instructor/story)는 Cloudflare R2 public URL 공식 지원 |
| 빌드 | `npm run prebuild`가 `dist/` 생성 및 이미지/WebP 검증 수행 |
| 캐시/버전 | `prebuild`가 HTML에 build version meta와 JS/CSS query version을 적용하고, `version.json` 기반 새 버전 안내를 제공; Cloudflare Pages용 `_headers`도 산출물에 생성 |

2026-06-29 기준 Hosting/DNS/Search Console/QA 상태:

- 공식 대표 운영 도메인 `https://gritedu.kr`은 Cloudflare Pages 프로젝트 `gritedu`의 custom domain이며, Cloudflare Pages 대표 도메인은 `gritedu.kr` 하나로 확정한다.
- Cloudflare Pages production branch는 `main`, build command는 `npm run prebuild`, output directory는 `dist`다.
- `www.gritedu.kr`은 `https://gritedu.kr`로 301 redirect 완료 상태다.
- `gritedu.pages.dev`는 `https://gritedu.kr`로 301 redirect 완료 상태다.
- Cloudflare Pages deployment alias도 하위 도메인 포함 설정으로 `https://gritedu.kr` 301 redirect가 확인되었고, path/query 보존도 확인 완료 상태다.
- 일반 정적 사이트 배포는 `git push origin main` 후 Cloudflare Pages 자동 빌드/배포로 처리한다.
- Firebase Auth/Firestore/Functions는 이전 대상이 아니며, 클라이언트 SDK가 기존 Firebase project `gritedu-lms`를 계속 호출한다.
- Firebase Hosting은 `firebase hosting:disable` 완료 상태다. `https://gritedu-lms.web.app/`와 `https://gritedu-lms.firebaseapp.com/`은 curl 기준 404 확인 완료이며, fallback/redirect 용도로도 사용하지 않는다.
- Firebase Hosting old URL을 `gritedu.kr`로 301 redirect하는 작업은 하지 않는다. redirect-only 전환안은 미채택 상태다.
- `npm run deploy` 또는 `firebase deploy --only hosting`은 일반 운영에서 사용하지 않는다.
- Firebase CLI는 Functions 배포나 Firestore rules 배포가 필요할 때만 Hosting deploy와 구분해 사용한다.
- R2 public custom domain은 `https://assets.gritedu.kr`이며, legacy `r2.dev` URL은 과도기 호환으로 허용한다.
- `gritedu.kr` Search Console 속성에는 `https://gritedu.kr/sitemap.xml` 제출이 완료되었다. sitemap에서 발견된 페이지는 6개이며, 주요 URL은 페이지 색인 생성됨 상태로 확인했다.
- old `gritedu-lms.web.app` Search Console 속성은 처리 상태 확인용으로 당분간 유지한다. old Firebase Hosting URL은 임시 삭제 요청 처리 중이며 404 유지로 색인 제거를 유도한다.
- Naver Search Advisor에서는 old 도메인 검색 제외 요청이 완료되었다.
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 모두 `https://gritedu.kr`로 수렴한다.
- `gritedu.online`은 검색 제외 처리 후 재확인 대상이다.
- R2 이미지 로딩 QA와 `gritedu.kr` 기준 회원가입 QA 1차는 완료되었다.
- Cloudflare Pages `_headers` live QA, forbidden URL live QA, 관리자 CMS QA, 모바일/iPhone/KakaoTalk QA는 남은 확인 항목이다.
- Cloudflare Dashboard/DNS, Firebase Console 설정은 문서화 대상이며 코드 작업으로 직접 변경하지 않는다.
- 공식 공개 도메인은 `https://gritedu.kr`입니다.
- 공개 HTML의 canonical, `og:url`, sitemap, JSON-LD는 `gritedu.kr` 기준으로 정리되었습니다.
- 홈 title은 `그릿에듀학원 | 중고등 내신과 입시 전문 학원` 방향이며, 공개 페이지별 title/description/H1/intro가 SEO 1차 보강되었습니다.
- sitemap은 핵심 공개 페이지 6개(`/`, `/courses.html`, `/instructors.html`, `/contact.html`, `/schedule.html`, `/story.html`)만 포함하는 방향입니다.
- query 없는 detail page, `members`, `admin`, `login`, `dashboard` 계열은 sitemap에서 제외합니다.
- `gritedu.online`은 과거 Adobe Portfolio 도메인으로, 코드 수정 대상이 아니라 검색 제외 처리 후 재확인 대상입니다.
- `gritedu-lms.web.app`과 `gritedu-lms.firebaseapp.com`은 old URL로만 취급하며, 404 유지와 Search Console 임시 삭제 요청으로 정리합니다.
- Cloudflare R2 custom domain `assets.gritedu.kr`은 공개 이미지 운영 도메인으로 사용하며, helper whitelist에는 custom domain과 legacy `r2.dev`를 함께 둡니다.
- Story 학원 안내 이미지는 `https://assets.gritedu.kr/public/story/` 또는 허용된 `https://assets.gritedu.kr/public/pages/story/` prefix의 R2 public URL을 사용합니다.

2026-07-03 약관/개인정보처리방침 문구 축소 메모:

- `terms.html`의 이용약관과 회원가입 약관/개인정보 동의 요약에서 기술스택 노출과 내부 로드맵처럼 보이는 문구를 줄였습니다.
- 개인정보처리방침 전문은 실제 코드/스키마 기준의 처리 목적, 처리 항목, 보유/정리 기간, 위탁/국외이전, 자동수집, 14세 미만 안내, 안전성 조치 항목을 유지하되 내부 메모형 표현을 제거했습니다.
- 개인정보보호위원회 공식 게시판의 `2026 개인정보 처리방침 작성지침` 및 `알기쉬운 개인정보 처리 동의 안내서` 게시 사실을 확인했습니다.
- `LEGAL_POLICY_VERSION`은 `firestore.rules`의 `legalPolicyVersion()`과 함께 `2026-06-12`로 고정되어 있습니다. rules 변경/배포가 이번 범위에서 금지되어 약관/방침의 시행일 및 동의 저장 버전은 유지했습니다.
- Cloudflare/Google의 국외이전 세부 국가, 연락처, 보유기간, 14세 미만 온라인 가입 운영 정책, 개인정보 보호책임자 표기, 기존 가입자 재동의 필요 여부는 운영자 확인 후 다음 정책 버전/rules 배포와 함께 확정해야 합니다.

로컬 `localhost:5000`은 개발/화면 테스트용이며 production Firestore에 연결될 수 있습니다. 운영 데이터 변경은 배포된 관리자 CMS에서 수행합니다.

Firebase Storage는 의도적으로 사용하지 않습니다. CMS에는 로컬 `/assets/...` 경로 또는 허용된 R2 public URL을 저장합니다. 로컬 파일은 저장소의 `assets/**`에 배치한 뒤 Cloudflare Pages 배포가 필요하고, R2 public URL은 R2 업로드 후 CMS 저장만으로 반영될 수 있습니다.

## 3. 사용자 역할

| 역할 | 설명 | 주요 화면 |
| --- | --- | --- |
| 학생 | 온라인 강의 수강, 오프라인 수업/세션 확인 | `members/students/dashboard.html`, `members/students/course.html` |
| 일반 회원 | 본인 온라인 수강, 자녀 연결/조회 | `members/member/dashboard.html`, `members/member/course.html` |
| 학부모 회원 | 일반 회원 모델 안에서 자녀 연결을 통해 학생 데이터 일부 확인 | `members/member/dashboard.html` |
| 강사 | 담당 온라인 강의, 수강생, 오프라인 반/수강생 조회 | `members/instructors/dashboard.html` |
| 관리자 | 전체 CMS, 계정/강의/오프라인/콘텐츠/운영 정리 관리 | `members/admin/**` |

역할 판정은 canonical collection(`admins`, `students`, `members`, `instructorAccounts`, `instructors`)을 기준으로 합니다. Legacy `users/*` 집계 모델은 폐기되었고 Firestore rules에서 차단됩니다.

## 4. 구현된 핵심 기능

### 온라인 강의

- `courses` 컬렉션이 공개 읽기 가능하도록 구성되어 있습니다.
- 강의 공개 상태는 `status`, `accessType`, `published`, `archived` 계열 값을 함께 고려합니다.
- 일반 공개 강의와 회원 전용 강의를 구분합니다.
- 학생과 일반 회원 모두 `enrollments`를 통해 수강 연결을 가질 수 있습니다.
- 강의 삭제 시 관련 수강 신청 정리 동작이 관리자 UI에 포함되어 있습니다.
- 결제, DRM, 비공개 projection 모델은 아직 구현하지 않았습니다.

### 오프라인 수업/세션

- `offlineClasses`가 오프라인 반의 원천 데이터입니다.
- `offlineClassMembers`가 반-학생 연결을 저장합니다.
- `offlineClassSessions`가 회차/세션을 저장합니다.
- `offlineSessionAccess`가 학생별 세션 접근 상태를 저장합니다.
- `scheduleVisible`이 공개 시간표 노출 여부를 제어합니다.
- `groupId`로 정규/기간 시간표·오프라인 반을 구분합니다(`settings/timetableCatalog.scheduleGroups`). `groupId` 없는 기존 문서는 `regular`로 처리합니다.
- 과목/학년/학교/강의실/시간표 이미지 기준값은 `settings/timetableCatalog.groupCatalogs[groupId]`에 그룹별로 저장합니다. `regular` 저장 시 legacy top-level 필드도 동기화하며, 그룹별 데이터가 없으면 `regular` → legacy top-level 순으로 fallback합니다.
- 시간표/오프라인 반 `기준값 저장`은 `updateDoc`으로 `groupCatalogs.{groupId}`에 직접 반영합니다(정규는 top-level sync). 저장 직후 UI는 draft를 유지합니다.
- 공개 `/schedule-images/?group=` 페이지는 Cloudflare `_redirects`(또는 `dist/schedule-images/index.html`)로 `schedule-images.html`을 제공합니다.
- `scheduleItems` 빈 배열 저장을 허용합니다(수업 일정 선택 입력).
- 공개 시간표는 `publicTimetableEntries`에 복사된 데이터로 운영되며, 오프라인 반과 실시간 동기화되는 live view가 아닙니다.

### 공개 사이트/CMS

- 공개 사이트는 Cloudflare Pages의 정적 페이지로 서비스됩니다.
- `pages`와 `settings`가 사이트 문구, 팝업, 시간표, 온라인 강좌/강사/오프라인 반 기준값 설정을 관리합니다.
- 중앙 `settings/operationCatalog` 모델은 폐기되었고, 기준값은 `courseCatalog`, `timetableCatalog`, `instructorsMenu`처럼 각 관리 페이지 책임에 맞는 settings 문서에서 관리합니다.
- 온라인 강좌 기준값은 `settings/courseCatalog.chipGroups.subject/grade/year`, 공개 강사진 필터는 `settings/instructorsMenu.subjects`, 오프라인 반/시간표 기준값은 `settings/timetableCatalog`를 사용합니다. `전체`와 직접 입력 관련 예약값은 settings 기준값이 아니라 UI/개별 문서 처리 대상입니다.
- 팝업 CMS는 `settings/popups`를 사용합니다.
- Story/사이트 콘텐츠는 `pages/{slug}` 계열을 사용합니다.
- Story 학원 안내 페이지(`story.html`)는 정적 shell/fallback이고, 실제 운영 콘텐츠는 관리자 `사이트 관리 -> 학원 안내`에서 Firestore `pages/story` v2 구조로 관리합니다.
- Story v2 공개 렌더링 우선순위는 `pages/story.version === 2`, legacy `content`, HTML fallback입니다.
- Story v2 CMS 입력 필드는 상단 배너 이미지 URL, 대표 인사말 제목/부제/본문, 회사명/직함, 대표명, 대표 사진 URL, G/R/I/T 설명, 마지막 멘트 1줄/2줄입니다.
- Story greeting panel은 desktop grid/flex containment를 보강해 대표 사진, GRIT 문구, 마지막 멘트가 panel 내부에서 wrap/contain되도록 수정되었습니다.
- Story 이미지 alt 기본값, `pageTitle`, `gritValues[].letter`, `gritValues[].word`는 코드 내부 기본값으로 처리합니다.
- Story 저장 시 legacy/중복 필드(`content`, `structure`, `closingMessage`, `greeting.signature`, `greeting.ceoTitle`, `greeting.ceoName`, `lead`, `gritValues[].body`)는 CMS 저장 payload에서 자동 정리됩니다. 콘솔에서 수동 삭제할 필요는 없습니다.
- Contact 상담 문의 페이지는 관리자 `사이트 관리 -> 상담 문의`에서 Firestore `pages/contact` canonical 구조(`slug`, `structure.locations[]`, `updatedAt`)로 관리합니다. 공개 페이지 제목은 코드에서 「상담 문의」로 고정됩니다.
- Contact `locations[]` 주요 필드: `label`, `phone`, `messageLines[]`(최대 3줄), `onlineBookingUrl`, `hours`, `address`, `mapEmbedQuery`, `mapIframeSrc`, `mapLinks.{naver,google,kakao}`, `transportItems[]`.
- Contact `transportItems[]`는 `{ id, type, label, text, sortOrder }`만 저장합니다. 관리자 UI는 유형 select + 안내문구 textarea이며, `phoneNote`, `callableHours`, `transportation`, `transportItems[].lines`, `structure.pageTitle/directions/content/extraNotes` 등 legacy 필드는 저장하지 않습니다.
- Contact 저장은 `setDoc` overwrite로 canonical payload만 남기며, admin load 시에만 legacy 값을 draft로 이관합니다. 공개 렌더링은 canonical 구조 우선이며, pre-migration DB용 최소 legacy fallback만 유지합니다.
- Popup CMS(`settings/popups`)는 팝업 이미지 1개(선택)와 `popups[].textItems[]`로 문구별 `text`, `linkUrl`, `align`, `sortOrder`, `enabled`를 관리합니다. **이미지만·문구만·혼합** 팝업을 지원하며, 문구만(`textItems` + URL)도 활성화 시 홈에 표시됩니다. 공개 렌더링은 `textItems` 우선이며 legacy `content`/`contentLinkUrl` fallback을 유지합니다.
- 카카오톡 채널 플로팅 버튼은 관리자 `사이트 관리 -> 카카오톡 채널`에서 `settings/kakaoChannel`로 관리합니다. SDK, Kakao Developers 앱키, `Kakao.init`, `Kakao.Channel`을 쓰지 않고 저장된 `https://pf.kakao.com/...` URL을 그대로 여는 단순 링크 방식입니다.
- 카카오톡 채널 버튼은 CMS에서 선택한 공개 페이지 6개(`/`, `/story.html`, `/schedule.html`, `/contact.html`, `/instructors.html`, `/courses.html`)에만 우측 하단 플로팅 링크로 표시됩니다. URL 변경과 노출 페이지 변경은 Firestore 저장만으로 반영되며 배포가 필요 없습니다.
- 학원정보조회·교습비·환불규정은 `settings/tuitionImages`의 R2 이미지 URL 목록을 사용합니다. 관리자 `사이트 관리 -> 푸터 정보`에서 URL 추가·수정·순서 변경·삭제가 가능하고, 공개 `tuition.html`은 탭별 이미지를 저장 순서대로 표시합니다.
- 학원정보 이미지는 `https://assets.gritedu.kr/public/footer/` 아래의 PNG/JPG/JPEG/WebP만 허용합니다. CMS에서 R2로 직접 업로드하지 않으며 기존 PDF iframe/download fallback은 사용하지 않습니다.
- 관리자 강좌·강사·학생·오프라인 반·팝업 편집은 공통 확인 대화상자를 사용합니다. 실제 변경이 있을 때만 닫기 경고를 표시하고, 영구 삭제는 확인 문구 입력 방식으로 보호합니다.
- 공개 사이트의 대표 도메인, SEO meta, JSON-LD, header/footer anchor text, footer 전화/SNS URL은 2026-06-24 SEO 1차 기준으로 보강되었습니다.
- R2 public image 운영은 popup, instructor profile, instructor 참고 자료, story hero/CEO image 범위에 적용되어 있으며, `assets.gritedu.kr` 기준 이미지 로딩 QA는 완료되었습니다.
- Popup main/content image, instructor profile/참고 자료 image, story hero/CEO image는 허용된 R2 public URL 운영이 가능하며, contact image attach와 `data:image`/base64 저장은 차단합니다.
- 관리자 CMS modal 작업 중 URL 검증/저장 오류는 modal 내부 alert에 우선 표시합니다(강사 프로필 이미지는 입력칸 바로 아래). modal이 열려 있을 때는 상단 toast로 오류를 띄우지 않습니다.
- R2 public image 1차 완료 후 Hosting download/cache 감사와 cache/version 운영 master plan 정리가 진행되었습니다.
- Version coverage 정밀 감사 이후 Phase D-1/D-2로 local ES module/dynamic import와 공통 partial fetch versioning이 보강되었습니다. 2026-06-23 Phase D-3으로 `school.csv` fetch/cache, public image cache-buster, root `/` cache header를 정리했습니다.
- 로컬 소스 및 prebuild/verify 기준 구현 완료 상태이며, 운영 URL 기준 `_headers`, forbidden URL, 관리자 CMS, 모바일/iPhone/KakaoTalk QA는 별도 확인이 필요합니다.

### 운영 정리 센터

- 관리자 운영 기록 정리 화면은 `members/admin/operation-tasks.html`입니다.
- 운영 기록 정리 대상은 `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts` 3개 컬렉션입니다.
- 오프라인 회차 정리 정책은 같은 화면에서 `settings/retentionPolicy`로 관리합니다. 기본값: enabled true, 실제 삭제 실행, 180일, `published`/`archived`, perRunLimit 200, skipActiveAccess true.
- CMS 정리 대상 확인은 최대 50건만 조회(버튼 클릭 시).
- `functions/record-cleanup.js`가 운영 기록 정리 기준이며, `functions/offline-session-cleanup.js`가 오프라인 회차 정리 기준입니다. `assets/js/pages/admin-operation-tasks.js`와 기본값을 동기화합니다.
- `scheduledRecordCleanup` Cloud Function은 매일 03:00 Asia/Seoul에 운영 기록 정리 후 오프라인 회차 정리를 실행합니다. 운영 기록은 `cleanupAt <= now` 쿼리로 컬렉션당 최대 500건을 처리하며, `cleanupAt`이 없는 legacy 문서는 매월 1일 호환 정리합니다. 단일 scheduler job을 유지합니다.
- 수동 UI(운영 기록): localStorage 30일 쿨다운, 컬렉션 3개 각 1회 조회, 컬렉션당 최대 300건 삭제.
- 오프라인 회차: CMS 설정 저장 + 미리보기만. 수동 삭제/callable 없음. `offlineSessionAccess`는 session cascade.
- Functions 배포 후 retention·실제 삭제 여부·status·limit은 CMS만 변경. rules/hosting 재배포 불필요.
- `operationTasks` 신규 생성은 중단되었습니다. 기존 문서는 legacy로 보며 자동/수동 정리 대상에서 제외하고, 필요 시 Firebase Console에서 1회 수동 정리합니다.
- 위험 작업은 UI 확인, rules 권한, Functions 정리 정책을 함께 전제로 해야 합니다.

### 계정/데이터 정리

- 학생, 일반 회원, 강사 계정은 각각 canonical collection을 기준으로 관리합니다.
- 일반 회원-학생 연결은 `studentParentLinks`와 `memberChildLinkAttempts`로 분리합니다.
- `users/*`는 더 이상 사용하지 않으며 rules에서 read/write가 거부됩니다.
- `changeHistory`는 더 이상 운영 기록 저장소로 사용하지 않으며 rules에서 read/write가 거부됩니다.
- 회원가입 유형은 학생과 일반/학부모로 구분합니다. 학생의 가입 경로는 선택 사항, 학부모는 가입 경로를 저장하지 않으며, 일반 회원은 가입 경로가 필수이고 `기타` 선택 시 직접 입력값이 필요합니다.
- 회원가입 버튼은 이름·학교·학년·전화번호·비밀번호 등 유형별 필수값이 유효할 때만 활성화합니다. 화면 검증, 최종 저장 검증, Firestore rules의 `signupSource` 정책을 동일하게 유지합니다.

## 5. 현재 저장소와 문서 구조

저장소 hygiene cleanup은 완료된 상태로 취급합니다. `functions/node_modules/**`, 루트 `node_modules/.package-lock.json` 같은 의존성 noise는 추적 대상에서 제거되어야 하며, `dist/**`는 빌드 산출물로 계속 무시합니다.

문서 구조는 다음 원칙으로 정리했습니다.

- 현재 의사결정용 문서: 루트 주요 state 문서와 `md/DATABASE_SCHEMA.md`
- 운영/발표/비용 문서: `docs/`
- 감사 보고서: `docs/audits/`
- 과거 진행/마일스톤 문서: `docs/archive/`
- 외부 벤치마크/리서치: `docs/research/`

자세한 문서 map은 `PROJECT_DOCS_INDEX.md`를 기준으로 봅니다.

## 6. 보안/권한 기준

- Firestore rules가 클라이언트 권한의 최종 경계입니다.
- 관리자만 쓸 수 있는 컬렉션과 공개 읽기 가능한 컬렉션을 문서/코드에서 분리해야 합니다.
- `courses`는 공개 읽기 가능하므로 민감한 비공개 영상 URL, 결제 권한, DRM 토큰을 직접 저장하지 않습니다.
- 이메일 인증/가입 보조 데이터는 Functions와 rules로 제한합니다.
- 운영 기록 수동 정리는 관리자 권한 UI에서만 노출되어야 하며, 월 1회 쿨다운과 컬렉션당 300건 상한을 유지해야 합니다.

## 7. 의도적으로 미구현/보류된 기능

| 기능 | 상태 | 이유 |
| --- | --- | --- |
| 결제 | 보류 | 정책/PG/환불/권한 모델 필요 |
| DRM | 보류 | 공개 읽기 `courses`와 분리된 비공개 projection 필요 |
| 네이티브 앱 | 보류 | 현재는 웹 기반 운영 안정화 우선 |
| Push 알림 | 보류 | 알림 정책, 수신 동의, 운영 프로세스 필요 |
| PWA Lite | 제한 구현 | 홈 화면 추가와 네트워크 장애 안내 fallback만 제공. Push/FCM/offline-first LMS는 미구현 |
| Firebase Storage 업로드 CMS | 보류 | 현재 비용/운영 단순성을 위해 로컬 `/assets` 정책 유지 |

## 8. 남은 위험

- 이미지 경로가 Firestore/CMS에 저장되므로 파일 누락 시 런타임 이미지가 깨질 수 있습니다.
- 공개 읽기 가능한 `courses`에 민감한 영상 정보를 넣으면 보안 모델이 깨집니다.
- 오프라인 반과 공개 시간표는 복사 기반이라 운영자가 시간표 반영 상태를 확인해야 합니다.
- Legacy collection이 다시 사용되지 않도록 신규 기능에서 canonical collection만 사용해야 합니다.
- 결제/DRM/Push/완전한 offline-first PWA 같은 확장 기능은 현재 모델에 덧붙이는 것이 아니라 데이터/권한 모델 재설계가 필요합니다.
- Firebase Hosting은 disable 완료 상태이므로 운영 fallback으로 보지 않습니다. old Firebase Hosting URL은 404 유지, Search Console 임시 삭제 요청, 잔여 색인 제거 상태를 추적합니다.
- 정적 사이트 배포는 Cloudflare Pages 자동 배포 기준입니다. `npm run deploy` 또는 `firebase deploy --only hosting`으로 Hosting을 되살리는 작업은 일반 운영 금지입니다.
- JS/CSS는 top-level URL에 build version query가 붙고, 2026-06-23 Phase D-1 이후 generated `dist/assets/js/**/*.js`의 local ES module import/export/dynamic/side-effect import에도 build version query가 적용됩니다. Phase D-2 이후 공통 partial HTML fetch도 build version query를 사용합니다. Phase D-3 이후 `school.csv` fetch는 build version query + `force-cache` + 페이지 생명주기 메모리 캐시를 사용하고, public instructor image cache-buster와 root `/` cache header 불일치는 정리되었습니다.
- public instructor image는 R2/local URL을 query cache-buster 없이 사용하며, 이미지 변경은 새 R2 key 또는 새 local 파일명으로 처리합니다.
- CMS 데이터 변경은 Hosting 정적 파일 cache와 별개이므로 Firestore 저장/읽기/local cache 기준으로 먼저 판단해야 합니다.
- `/` root cache normalization은 소스에 반영되었지만, Cloudflare Pages 운영 URL에서 `/`, `/index.html`, `/version.json`, `/assets/school.csv`, `_headers` 적용 여부와 browser Network는 남은 live QA 항목입니다.
- R2 custom domain 완료 후에도 legacy `r2.dev` 기반 URL과 `assets.gritedu.kr` URL이 과도기적으로 섞일 수 있습니다. 신규 운영 입력은 `assets.gritedu.kr` 기준을 우선합니다.
- 강사 기본 placeholder는 R2 public URL 기준으로 운영되며, 기존 local placeholder 참조가 남아 있으면 `prebuild`/`verify` 경고와 실제 화면 fallback을 함께 확인해야 합니다.
- 2026-07-18 누적 변경은 정적 사이트/CMS, 회원가입, Rules, Functions, 운영 정리, ESLint 도입을 하나의 배포 단위로 검토했습니다. 운영 Firebase DB를 직접 삭제하거나 수정한 작업은 포함하지 않습니다.

## 9. 다음 권장 작업

1. 현재 source 변경과 문서 변경을 분리해 리뷰합니다.
2. 배포 전 `npm run prebuild`, `npm run verify`, `git diff --check`, sitemap/robots, 이미지 fallback을 확인합니다.
3. 정적 사이트 배포는 `git push origin main` 후 Cloudflare Pages 자동 배포로 처리하고, `gritedu.kr` 운영 URL에서 QA합니다.
4. Google Search Console에서는 `gritedu.kr` sitemap/색인 상태와 old `gritedu-lms.web.app` 임시 삭제 요청 상태를 추적합니다.
5. Naver Search Advisor old 도메인 검색 제외 요청 상태와 `gritedu.online` 검색 제외 후 재확인을 추적합니다.
6. Cloudflare Pages `_headers` live QA와 forbidden URL live QA를 마무리합니다.
7. 관리자 CMS 주요 화면과 모바일/iPhone/KakaoTalk 환경을 운영자 기준으로 QA합니다.
8. `courses` 공개 읽기 전제에 맞춰 영상/권한 필드 사용을 재검토합니다.
9. 공개 시간표 운영 절차를 실제 운영자와 리허설합니다.
10. 결제/DRM을 도입할 경우 별도 설계 문서를 먼저 작성합니다.
11. 큰 asset/CSS/JS 중복과 `main.css` 크기를 별도 감사합니다.
