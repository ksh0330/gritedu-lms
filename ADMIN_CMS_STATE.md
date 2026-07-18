# Admin CMS State

최종 갱신: 2026-07-06

## 1. 목적

관리자 CMS는 학원 운영자가 계정, 학생/회원/강사, 온라인 강의, 오프라인 반, 공개 시간표, 사이트 콘텐츠, 팝업, 운영 기록 정리를 관리하는 내부 운영 도구입니다.

현재 CMS는 Firebase Auth와 Firestore rules의 관리자 권한을 전제로 동작합니다. 위험한 삭제/정리 작업은 운영자 확인을 거쳐야 하며, source-of-truth 컬렉션을 직접 다룹니다.

## 2. 관리자 화면 Map

| 화면 | 경로 | 목적 | 주요 액션 | 관련 컬렉션 | 위험 작업 | 상태/운영 메모 |
| --- | --- | --- | --- | --- | --- | --- |
| 대시보드 | `members/admin/dashboard.html` | 운영 현황 진입점 | 주요 관리 메뉴 이동, 상태 요약 확인 | 여러 collection read | 없음 | 운영자가 처음 보는 홈 |
| 계정 생성/관리 | `members/admin/users/add.html` | 학생/회원/강사/관리자 계정 생성 | Firebase Auth 계정 생성, canonical profile 생성 | `admins`, `students`, `members`, `instructors`, `instructorAccounts`, `settings/signup`, `settings/instructorsMenu` | 잘못된 역할 생성 | 강사 과목 선택값은 강사 관리의 `settings/instructorsMenu.subjects`를 공유 |
| 학생 관리 | `members/admin/users/students.html` | 학생 프로필/수강/오프라인 연결 관리 | 학생 조회, 정보 수정, 수강/반 연결 확인 | `students`, `enrollments`, `offlineClassMembers`, `studentParentLinks` | 학생 삭제, 연결 정리 | 학생 계정은 `users/*`가 아니라 `students/{uid}` 기준 |
| 회원 관리 | `members/admin/users/members.html` | 일반 회원/학부모 회원 관리 | 회원 조회, 자녀 연결 상태 확인, 연결 요청 확인 | `members`, `studentParentLinks`, `memberChildLinkAttempts`, `enrollments` | 회원 삭제, 자녀 연결 삭제 | 부모 전용 collection 대신 `members` + link 모델 사용 |
| 강사 관리 | `members/admin/users/instructors.html` | 강사 공개 프로필과 로그인 계정 관리 | 프로필 편집, 계정 연결, 담당 강의/반 확인, 강사 과목 기준값 관리 | `instructors`, `instructorAccounts`, `courses`, `offlineClasses`, `publicTimetableEntries`, `settings/instructorsMenu` | 강사 삭제, 담당 항목 orphan | 프로필과 계정은 분리 모델. 강사 과목 기준값은 페이지 상단 패널에서 관리하고 계정 생성 관리와 공유 |
| 온라인 강의 관리 | `members/admin/courses.html` | 강의 목록/상세/커리큘럼/노출 관리 | 강의 생성/수정/보관, 강사 연결, 수강생 정리, 과목/학년/연도 기준값 관리 | `courses`, `enrollments`, `settings/courseCatalog`, `settings/coursesMenu` | 강의 삭제, 수강 연결 삭제 | `courses`는 공개 읽기 가능하므로 민감 정보 금지. 온라인 강좌 과목 value는 내부 식별값이고 화면은 label 중심. 과목 직접 입력 가능, 학습 내용 소개(`lectureContent`) 입력 UI 없음 |
| 오프라인 반 관리 | `members/admin/offline-classes.html` | 오프라인 반, 학생 배정, 회차 관리 | 반 생성/수정, 학생 배정, 세션 생성, 접근 관리, 과목/학년/학교/강의실 기준값 관리 | `offlineClasses`, `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`, `settings/timetableCatalog` | 반 삭제, 세션/접근 삭제 | 공개 시간표와 별도 복사 모델. 기준값은 시간표 관리와 `settings/timetableCatalog`를 공유 |
| 시간표 관리 | `members/admin/timetable.html` | 공개 시간표 노출 관리 | 공개 시간표 항목 생성/수정/정렬, 과목/학년/학교/강의실 기준값 관리 | `publicTimetableEntries`, `offlineClasses`, `settings/timetableCatalog` | 공개 노출 오류 | `offlineClasses`에서 복사된 항목이며 live sync 아님. 기준값은 공개 시간표 필터 후보와 연결 |
| 사이트 관리 | `members/admin/site.html` | 공개 사이트 문구/강사진/카카오톡 채널 노출 설정 | 학원 안내, 상담 문의, 카카오톡 채널 URL/노출 페이지, 강사진 노출 순서/숨김/상세 섹션 관리 | `pages`, `settings/instructorsMenu`, `settings/kakaoChannel` | 잘못된 공개 문구/링크 | 사이트 관리는 과목/학년/학교/강의실 기준값을 관리하지 않음. Story는 `pages/story` v2, Contact는 `pages/contact.structure.locations[]`, 카카오톡 채널은 `settings/kakaoChannel` 기준 |
| 팝업 관리 | `members/admin/popup.html` | 메인 팝업 노출 관리 | 팝업 생성/수정/비활성화, 이미지 경로 관리 | `settings/popups` | 깨진 이미지/과도한 팝업 노출 | 이미지는 R2 public URL 또는 `/assets/popup/*.webp` rollback 경로 사용 |
| 운영 기록 정리 | `members/admin/operation-tasks.html` | 만료성 운영 기록 점검/정리 | 정리 대상 확인, 월 1회 수동 정리, 자동 정리 상태 확인 | `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts`; legacy `operationTasks` | 대량 삭제 | `scheduledRecordCleanup` 월간 자동 정리 + 관리자 수동 UI |

## 2-1. 기준값 관리 패널

중앙 운영 기준값 탭은 제거되었습니다. 기준값은 각 관리 페이지 상단 패널에서 관리하고, 해당 페이지 책임에 맞는 settings 문서에 저장합니다.

| 관리 화면 | 관리 기준값 | 저장 문서 | 공개/연결 영향 |
| --- | --- | --- | --- |
| 온라인 강의 관리 | 과목, 학년, 연도 | `settings/courseCatalog` | 온라인 강좌 관리/공개 강좌 label과 필터 |
| 오프라인 반 관리 | 과목, 학년, 학교, 강의실 | `settings/timetableCatalog` | 오프라인 반 입력값과 시간표 관리 기준값 공유 |
| 시간표 관리 | 과목, 학년, 학교, 강의실 | `settings/timetableCatalog` | 공개 시간표 필터 후보 |
| 강사 관리 | 강사 과목 | `settings/instructorsMenu.subjects` | 강사 관리, 계정 생성 관리, 공개 강사진 필터 (`courseCatalog.instructorSubjectChips`는 legacy/stale) |
| 사이트 관리 | 기준값 없음 | `pages/*`, `settings/instructorsMenu` 일부, `settings/kakaoChannel` | 공개 콘텐츠, 강사진 노출 순서/숨김/상세 섹션, 카카오톡 채널 링크 노출 관리 |

공통 운영 원칙:

- 기준값은 추가, 수정, 삭제, 순서 변경 후 각 패널의 `기준값 저장`을 눌러야 반영됩니다.
- 등록/수정 모달 안에는 기준값 CRUD가 없고, 기준값 선택 토글과 직접 입력만 있습니다.
- 직접 입력값은 해당 강좌/반/시간표/강사 문서에만 저장되며 settings catalog나 필터 후보에 자동 추가되지 않습니다.
- `"전체"`, `"all"`, `"선택"`, `"직접 입력"`, `"목록에 없음"` 같은 예약값은 기준값으로 저장하지 않습니다. `"전체"`는 필터 UI에서만 가상으로 추가합니다.
- 공개 강사진 필터 source는 `settings/instructorsMenu.subjects`입니다. `courseCatalog.instructorSubjectChips`는 더 이상 primary source가 아닙니다.
- 온라인 강좌 기준값은 `settings/courseCatalog.chipGroups`의 `subject`, `grade`, `year`를 사용합니다.
- 온라인 강좌 과목은 내부 `value`와 화면 `label` 구조를 유지하지만, 관리자 UI는 과목명 중심입니다. 신규 과목 식별값은 관리자가 직접 지정하지 않고 `CUSTOM_001` 형식으로 자동 생성됩니다.
- 기본 온라인 과목 식별값(`KOR`, `ENG`, `MATH`, `SCI`, `ESSAY`, `ETC`)도 기준값 목록에서 삭제할 수 있습니다. 삭제된 과목 식별값을 쓰는 기존 강좌는 마이그레이션하지 않고 fallback label로 표시합니다.
- 온라인 강좌 추가/수정 모달의 `lectureContent` 입력 UI는 제거되었습니다. 기존 문서의 `lectureContent`/`learningContent` 값은 삭제하거나 마이그레이션하지 않으며 읽기 호환만 유지합니다.
- 기존 문서가 삭제된 기준값을 사용하더라도 기존 항목은 삭제하지 않습니다. 수정 화면에서는 현재 저장값을 표시하고 필요하면 다른 기준값으로 바꿉니다.
- `settings/operationCatalog`, 중앙 운영 기준값 탭, `operation-catalog.js`, `admin-operation-catalog-ui.js`는 폐기되었습니다.

## 3. Canonical 데이터 모델

| 영역 | Canonical collection | 비고 |
| --- | --- | --- |
| 관리자 | `admins` | 관리자 권한 판정 |
| 학생 | `students` | 학생 대시보드와 수강/오프라인 연결 기준 |
| 일반/학부모 회원 | `members` | 일반 회원과 학부모 역할을 함께 수용 |
| 회원-학생 연결 | `studentParentLinks`, `memberChildLinkAttempts` | 확정 링크와 시도/요청 분리 |
| 강사 공개 프로필 | `instructors` | 공개 강사 소개와 담당 연결 |
| 강사 로그인 계정 | `instructorAccounts` | Auth uid 기반 계정 데이터 |
| 온라인 강의 | `courses` | 공개 읽기 가능 |
| 온라인 수강 | `enrollments` | 학생/회원 모두 연결 가능 |
| 오프라인 반 | `offlineClasses` | 반 source-of-truth |
| 오프라인 반 학생 | `offlineClassMembers` | 학생 배정 |
| 오프라인 세션 | `offlineClassSessions` | 회차 데이터 |
| 오프라인 세션 접근 | `offlineSessionAccess` | 학생별 접근 |
| 공개 시간표 | `publicTimetableEntries` | 공개 페이지용 복사 데이터 |
| 사이트 설정/콘텐츠 | `settings`, `pages` | 공개/관리자 설정 |
| 운영 기록 정리 | `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts` | 월간 자동 정리와 관리자 수동 정리 대상. `operationTasks`는 legacy |
| 가입/인증 보조 | `emailVerifications`, `signupAttempts` | Functions와 rules로 제한 |

## 4. Deprecated/금지 모델

| 항목 | 상태 | 운영 기준 |
| --- | --- | --- |
| `users/*` | deprecated, rules deny | 새 기능에서 사용 금지 |
| `changeHistory` | deprecated, rules deny | 운영 기록 저장소로 사용 금지 |
| legacy `parents` | deprecated | `members` + `studentParentLinks`로 대체 |
| `publicInstructorProfiles` | deprecated | `instructors`로 통합 |
| `settings/home` | legacy | 현재 settings 구조로 대체 |
| `settings/instructors` | legacy | `settings/instructorsMenu` 등으로 대체 |
| `settings/dday` | legacy | 현재 D-day/settings 정책에 맞춰 재검토 |
| `settings/courseCatalog.instructorSubjectChips` | legacy/stale | 공개 강사진 필터는 `settings/instructorsMenu.subjects`를 사용 |

## 4-1. 사이트 관리 CMS 구조

### 푸터 정보와 학원정보 이미지

- Footer 사업자·연락처·SNS 정보와 학원정보조회·교습비·환불규정 이미지를 함께 관리합니다.
- 이미지 목록은 `settings/tuitionImages`의 `academy[]`, `fee[]`, `refund[]`에 저장합니다.
- 허용 URL은 `https://assets.gritedu.kr/public/footer/` 아래 PNG/JPG/JPEG/WebP입니다.
- URL 추가·수정·삭제·순서 변경과 미리보기를 제공하며 R2 직접 업로드는 제공하지 않습니다.
- 공개 `tuition.html`은 저장 순서대로 이미지를 표시하고, 미등록과 읽기 오류를 구분해 안내합니다. 기존 PDF iframe/download fallback은 사용하지 않습니다.

### 학원 안내

사용 위치:

- 관리자: `members/admin/site.html` -> 사이트 관리 -> 학원 안내
- 공개 페이지: `story.html`
- Firestore: `pages/story`

`story.html`은 CMS가 직접 수정하는 파일이 아니라 정적 shell/fallback입니다. 공개 렌더링 우선순위는 다음과 같습니다.

1. `pages/story.version === 2`
2. legacy `pages/story.content`
3. `story.html` HTML fallback

현재 CMS 입력 필드와 저장 경로:

| CMS 입력 | Firestore 경로 |
| --- | --- |
| 상단 배너 이미지 URL | `heroImageUrl` |
| 대표 인사말 제목 | `greeting.title` |
| 대표 인사말 부제 | `greeting.subtitle` |
| 대표 인사말 본문 | `greeting.body` |
| 회사명 / 직함 | `greeting.signatureTitle` |
| 대표명 | `greeting.signatureName` |
| 대표 사진 URL | `greeting.ceoImageUrl` |
| G/R/I/T 설명 | `gritValues[0..3].title` |
| 마지막 멘트 1줄 | `closingLine1` |
| 마지막 멘트 2줄 | `closingLine2` |

자동/고정 저장값:

- `slug: "story"`
- `version: 2`
- `pageTitle: "그릿에듀 학원 안내"`
- `heroImageAlt: "그릿에듀 강사진 단체 이미지"`
- `greeting.ceoImageAlt: "그릿에듀 대표이사 유홍석"`
- `gritValues[].letter`
- `gritValues[].word`
- `updatedAt`

저장 시 legacy/중복 필드는 자동 정리됩니다. `closingMessage`, `greeting.signature`, `greeting.ceoTitle`, `greeting.ceoName`, `content`, `structure`, `lead`, `gritValues[].body`는 콘솔에서 수동 삭제할 필요 없이 CMS에서 한 번 저장하면 정리됩니다.

Story 이미지 정책:

- CMS 파일 업로드는 하지 않습니다.
- R2 `https://assets.gritedu.kr/public/story/` 또는 `https://assets.gritedu.kr/public/pages/story/` URL만 공식 지원합니다.
- 허용 확장자는 `.jpg`, `.jpeg`, `.png`, `.webp`입니다.
- 같은 파일명 덮어쓰기보다 `banner_main-20260626.webp`, `ceo-yhs-20260626.webp` 같은 versioned filename을 권장합니다.
- 학생 자료, 리포트, PDF, 과제 같은 private 파일과 Story public 이미지를 섞지 않습니다.

현재 학원 안내 CMS에서 제거된 항목:

- 브라우저 탭 제목 입력
- 이미지 설명 입력
- 실시간 미리보기
- 새 창에서 확인 버튼
- 파일 업로드
- 글꼴/색상/크기 툴바
- 디자인 프리셋
- 말풍선

### 상담 문의

사용 위치:

- 관리자: `members/admin/site.html` -> 사이트 관리 -> 상담 문의
- 공개 페이지: `contact.html`
- Firestore: `pages/contact`

Contact 공개 렌더링 우선순위는 코드 기준으로 다음과 같습니다.

1. `pages/contact.structure.locations[]`
2. legacy `pages/contact.content`
3. `contact.html` HTML fallback

현재 CMS 입력 필드와 저장 경로:

| CMS 입력 | Firestore 경로 |
| --- | --- |
| 페이지 제목 | `structure.pageTitle` |
| 위치 이름 | `structure.locations[].label` |
| 전화번호 | `structure.locations[].phone` |
| 전화 안내 문구 | `structure.locations[].phoneNote` |
| 통화 가능 시간 | `structure.locations[].callableHours` |
| 온라인 상담 예약 URL | `structure.locations[].onlineBookingUrl` |
| 운영 시간 | `structure.locations[].hours` |
| 주소 | `structure.locations[].address` |
| 구글 지도 입력값(URL 또는 검색어) | `structure.locations[].mapIframeSrc` 또는 `structure.locations[].mapEmbedQuery` |
| 교통수단 | `structure.locations[].transportation.walking/subway/bus/car` |
| 지도 앱 링크 | `structure.locations[].mapLinks.naver/kakao/google` |

저장 시 호환 필드로 첫 번째 위치의 `phone`, `phoneNote`, `callableHours`, `hours`, `address`, `mapIframeSrc`, `mapEmbedQuery`, `transportation`, `mapLinks`도 `structure` top-level에 함께 저장됩니다. `content`는 빈 문자열로 저장되어 legacy HTML 본문보다 structured locations 렌더링을 우선합니다.

Contact 이미지 첨부/파일 업로드는 차단되어 있습니다. 현재 Contact CMS는 텍스트, URL, 지도/교통 정보 중심이며 R2 이미지 URL 입력 필드는 없습니다.

### 카카오톡 채널

사용 위치:

- 관리자: `members/admin/site.html` -> 사이트 관리 -> 카카오톡 채널
- 공개 페이지: `/`, `story.html`, `schedule.html`, `contact.html`, `instructors.html`, `courses.html` 중 CMS에서 선택된 페이지
- Firestore: `settings/kakaoChannel`

저장 필드:

| CMS 입력 | Firestore 경로 |
| --- | --- |
| 사용 여부 | `enabled` |
| 카카오톡 채널 URL | `url` |
| 버튼 문구 | `buttonLabel` |
| 노출 페이지 | `visiblePages.home/story/schedule/contact/instructors/courses` |
| 수정자 | `updatedBy` |
| 수정 시각 | `updatedAt` |

운영 기준:

- SDK, Kakao Developers 앱키, `Kakao.init`, `Kakao.Channel`을 사용하지 않습니다.
- `url`은 `https://pf.kakao.com/...` 형식만 허용합니다. `/chat`을 자동으로 붙이지 않고 CMS에 저장된 URL을 그대로 `href`에 사용합니다.
- `buttonLabel`은 선택값입니다. 빈 문자열이나 공백 문자열이면 저장 가능하며 공개 버튼은 텍스트 없이 SVG 아이콘만 표시합니다.
- `enabled`가 false이면 URL이 비어 있어도 저장할 수 있지만, URL이 입력되어 있다면 안전 검증을 통과해야 합니다.
- 공개 렌더링도 저장값을 한 번 더 검증하며, URL이 없거나 invalid이거나 현재 페이지가 `visiblePages`에서 true가 아니면 버튼을 표시하지 않습니다.
- 버튼은 공개 페이지 우측 하단 플로팅 링크이며, 모바일에서는 기존 맨 위로 이동 버튼 위에 배치됩니다.

## 5. 위험 작업 가이드

삭제 전 확인:

- 학생 삭제: `enrollments`, `offlineClassMembers`, `studentParentLinks`, `offlineSessionAccess` 영향 확인
- 회원 삭제: 본인 `enrollments`, 자녀 link, link attempt 영향 확인
- 강사 삭제: `courses`, `offlineClasses`, `publicTimetableEntries`, `instructorAccounts` 연결 확인
- 강의 삭제: `enrollments` cleanup 필요
- 오프라인 반 삭제: `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`, 공개 시간표 반영 상태 확인
- 팝업 삭제: 운영 중인 공개 노출 여부 확인

공개 데이터 주의:

- `courses`는 공개 읽기 가능하므로 비공개 영상 URL, 결제 권한, DRM 토큰을 저장하지 않습니다.
- `publicTimetableEntries`, 공개 settings, `pages`는 공개 페이지에서 읽힐 수 있습니다.
- `settings/kakaoChannel`은 공개 페이지에서 읽히는 문서이므로 카카오톡 채널 URL과 노출 플래그 외 민감 정보를 저장하지 않습니다.
- 이미지 경로는 `/assets/...` 문자열 또는 허용된 R2 public URL이므로 실제 파일/object가 없으면 화면이 깨집니다.

## 6. 운영자 메모

- 관리자 UI에서 파일 자체를 Firebase Storage로 업로드하지 않습니다.
- R2 public URL을 쓰는 팝업/강사/Story 이미지는 배포 없이 CMS 저장으로 반영될 수 있습니다.
- CMS 텍스트/구조 데이터만 바꾸는 경우 Firestore 저장만으로 공개 페이지에 반영되며 코드 배포가 필요 없습니다.
- 카카오톡 채널 URL/노출 페이지 변경도 Firestore 저장만으로 공개 페이지에 반영되며 코드 배포가 필요 없습니다.
- 로컬 `/assets` 이미지 변경은 파일 배치, 경로 입력, `npm run prebuild`, `npm run verify`, `git diff --check`, commit, `git push`, Cloudflare Pages deployment 확인 순서가 필요합니다.
- 공개 시간표는 오프라인 반의 실시간 view가 아니므로 복사/반영 상태를 운영자가 확인해야 합니다.
- 운영 기록 정리 화면은 편리한 UI이지만 삭제성 작업은 되돌리기 어렵습니다. 수동 정리는 30일 쿨다운과 컬렉션당 300건 상한을 유지합니다.
- 대량 변경 전에는 현재 Firestore 데이터 export 또는 최소한 대상 목록 캡처가 필요합니다.
- R2 custom domain은 `https://assets.gritedu.kr`입니다. Story 이미지는 `public/story/` 또는 `public/pages/story/` prefix를 사용합니다.
- 공개 사이트의 공식 도메인/SEO meta/sitemap/robots는 소스 HTML과 build/prebuild 영역에서 관리하며, CMS 문구 변경과 구분합니다.

## 7. QA 체크리스트

1. 관리자 로그인 후 대시보드 진입이 되는지 확인합니다.
2. 학생/회원/강사 각 목록이 canonical collection 기준으로 로드되는지 확인합니다.
3. 강의 목록에서 공개/회원 전용/보관 상태가 의도대로 표시되는지 확인합니다.
4. 오프라인 반 생성 후 학생 배정, 회차 생성, 접근 관리가 가능한지 확인합니다.
5. 공개 시간표에 반영할 항목이 `publicTimetableEntries`에 저장되는지 확인합니다.
6. 사이트 관리 -> 학원 안내 저장 후 `pages/story.version === 2`로 공개 `story.html`이 렌더링되는지 확인합니다.
7. 사이트 관리 -> 상담 문의 저장 후 `pages/contact.structure.locations[]`로 공개 `contact.html`이 렌더링되는지 확인합니다.
8. 사이트 관리 -> 카카오톡 채널에서 `https://pf.kakao.com/...`와 `/chat` URL은 저장되고, http/javascript/data/blob/타 도메인은 차단되는지 확인합니다.
9. 선택한 공개 페이지만 카카오톡 플로팅 버튼이 보이고 `members/**`와 상세/정책 페이지에는 보이지 않는지 확인합니다.
10. 팝업 이미지 경로가 `/assets/...` 또는 허용된 R2 public URL이고 실제 파일/object가 있는지 확인합니다.
11. 운영 기록 정리 화면에서 3개 대상 컬렉션의 확인/삭제가 관리자 권한에서만 가능하고, 월 1회 수동 쿨다운이 동작하는지 확인합니다.
