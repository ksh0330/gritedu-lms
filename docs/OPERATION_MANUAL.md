# Operation Manual

최종 갱신: 2026-07-06

## 1. 목적

이 문서는 학원 운영자가 Grit Edu 관리자 CMS를 사용할 때 참고하는 간단한 운영 매뉴얼입니다.

관리자 CMS는 데이터와 공개 노출을 직접 바꿀 수 있으므로, 삭제나 대량 정리 작업 전에는 대상과 영향을 반드시 확인해야 합니다.

## 2. 관리자 로그인

1. 관리자 계정으로 로그인합니다.
2. 관리자 대시보드로 이동합니다.
3. 메뉴에서 필요한 관리 화면을 선택합니다.

로그인이 되지 않거나 관리자 화면에 접근할 수 없으면 개발자 또는 Firebase Console 접근 권한이 있는 담당자에게 계정 권한을 확인해야 합니다.

## 2-1. 로컬 개발 환경 (`localhost:5000`)

`localhost:5000`은 개발/화면 테스트용입니다. 실제 팝업/강사 이미지 운영 작업은 배포된 관리자 CMS에서 수행합니다.

로컬 serve 환경은 production Firestore에 연결될 수 있어, 로컬에서 저장한 데이터가 실제 사이트에 반영될 수 있습니다. 따라서 운영자는 로컬 관리자 화면에서 실데이터를 수정하지 않습니다. 로컬에서는 UI, 콘솔 오류, 검증 로직만 확인합니다.

로컬 또는 브라우저 개발자도구에서 DevTools Disable cache를 켠 상태로 테스트하면 정적 파일 재요청이 실제 일반 사용자보다 크게 보일 수 있습니다. 현재 운영 Hosting은 Cloudflare Pages이며, Firebase Hosting은 disable 완료 상태입니다. 사용량을 해석할 때는 테스트 조건과 대상 도메인을 함께 기록합니다.

## 2-2. 배포 후 새 버전 반영

새 배포 후 일반 사용자는 보통 페이지 새로고침 또는 화면 하단의 새 버전 안내를 통해 최신 버전을 받습니다.

운영 기준:

- 실운영자는 일반 사용자에게 강력 새로고침을 반복 안내하지 않습니다.
- 새 버전 반영은 일반 새로고침/버전 안내로 처리합니다.
- 화면이 계속 이상한 경우에만 관리자/개발자 판단으로 강력 새로고침을 예외적으로 안내합니다.
- 배포 직후 QA를 할 때 DevTools Disable cache를 켰는지 기록합니다.
- 배포 후 문제가 있으면 먼저 `version.json`, HTML build version, JS/CSS URL version query, Cloudflare Pages `_headers`/cache header를 확인합니다.
- 배포 후 HEAD 확인 대상은 `/`, `/index.html`, `/version.json`, `/assets/school.csv`입니다. 운영 URL에서 root `/`가 과거 `max-age=3600`으로 관찰된 적이 있으므로 별도로 재확인합니다.

## 2-3. 변경 유형별 반영 기준

운영자는 문제가 생겼을 때 먼저 변경 유형을 구분합니다.

| 변경 유형 | 배포 필요 여부 | 확인 기준 |
| --- | --- | --- |
| HTML/CSS/JS 코드 변경 | 필요 | 개발자가 `prebuild` 후 연결된 production branch에 push하면 Cloudflare Pages가 자동 배포합니다. `version.json`과 화면 버전을 확인합니다. |
| local `/assets` 파일 변경 | 필요 | 새 파일명으로 추가한 뒤 `prebuild` 후 GitHub `main`에 push합니다. 같은 파일명 덮어쓰기는 피합니다. |
| `assets/school.csv` 변경 | 필요 | 정적 학교 검색 데이터 파일입니다. `prebuild` 후 Cloudflare Pages로 배포하고, fetch URL의 build version query로 새 파일을 받게 합니다. |
| CMS 문구/팝업/강사/시간표/카카오톡 채널 설정 변경 | 불필요 | CMS 저장, Firestore 값, 화면 렌더링, local cache를 확인합니다. 배포나 강력 새로고침은 기본 절차가 아닙니다. |
| R2 public 이미지 변경 | 불필요 | 새 R2 key로 업로드하고 CMS URL을 새 URL로 교체합니다. 같은 key 덮어쓰기는 피합니다. |

CMS 데이터가 바뀌지 않아 보일 때는 일반 사용자에게 강력 새로고침을 반복 안내하지 않습니다. 먼저 CMS 저장 성공 여부, Firestore 데이터, 화면의 localStorage/sessionStorage cache, 일반 새로고침 결과를 확인합니다.

### CMS 기준값 관리 공통 원칙

과목, 학년, 학교, 강의실 같은 기준값은 중앙 운영 기준값 탭이 아니라 각 관리 화면 상단의 기준값 관리 패널에서 관리합니다.

| 관리 화면 | 기준값 | 저장 문서 |
| --- | --- | --- |
| 온라인 강의 관리 | 과목, 학년, 연도 | `settings/courseCatalog` |
| 오프라인 반 관리 | 과목, 학년, 학교, 강의실 | `settings/timetableCatalog` |
| 공개 시간표 관리 | 과목, 학년, 학교, 강의실 | `settings/timetableCatalog` |
| 강사 관리 | 강사 과목 | `settings/instructorsMenu.subjects` |

운영 절차:

1. 해당 관리 화면 상단의 기준값 관리 패널을 엽니다.
2. 기준값을 추가, 이름 수정, 삭제, 순서 변경합니다.
3. `기준값 저장`을 눌러 Firestore settings 문서에 반영합니다.
4. 등록/수정 모달을 열어 선택 토글과 필터 후보가 의도대로 보이는지 확인합니다.

시간표/오프라인 반(`settings/timetableCatalog`) 추가 확인:

- 상단 **그룹 탭**(정규/썸머/윈터)을 선택한 뒤 기준값을 편집하고 `기준값 저장`을 눌러야 합니다.
- **정규(`regular`)** 저장: `groupCatalogs.regular`와 legacy top-level(`subjects`, `grades`, `schools`, `classrooms`, `scheduleImages`)이 함께 갱신됩니다.
- **썸머/윈터 등 seasonal** 저장: `groupCatalogs.{그룹ID}`만 갱신됩니다. Firestore 콘솔에서 top-level `subjects`만 보면 변경이 없어 보일 수 있습니다.
- 저장 후 관리자 CMS는 Firestore **서버 최신값**으로 다시 불러옵니다. 목록이 바로 안 바뀌면 페이지를 한 번 새로고침합니다.
- `기준값 저장`과 `시간표 이미지 관리` 저장은 별도입니다. 이미지는 이미지 모달에서만 저장됩니다.
- CMS 저장 시 미사용 legacy 필드(`subjectMeta`, `subjectColorMap`, `version`)는 자동 삭제됩니다.
- 기준값 저장은 Firestore `updateDoc`으로 `groupCatalogs.{그룹ID}`(정규는 top-level도)에 직접 반영됩니다. 저장 후 화면은 서버 재조회 없이 현재 draft를 유지합니다.

주의:

- 등록/수정 모달 내부에서는 기준값 CRUD를 하지 않습니다.
- 모달의 직접 입력값은 해당 강좌/반/시간표/강사 문서에만 저장됩니다.
- 직접 입력값은 settings catalog나 공개/관리자 필터 후보에 자동 추가되지 않습니다.
- `"전체"`, `"all"`, `"선택"`, `"직접 입력"`, `"목록에 없음"` 같은 예약값은 기준값으로 저장하지 않습니다.
- `"전체"`는 기준값이 아니라 필터 UI에서만 가상으로 표시합니다.
- 삭제된 기준값을 쓰는 기존 항목은 자동 삭제하거나 일괄 마이그레이션하지 않습니다. 수정 화면에서는 현재 값 또는 직접 입력 fallback으로 표시한 뒤 필요할 때 새 기준값으로 바꿉니다.
- 사이트 관리는 학원 안내, 상담 문의, 강사진 노출 순서/숨김/상세 섹션을 담당하며 과목/학년/학교/강의실 기준값을 관리하지 않습니다.

## 2-4. 배포 전후 SEO/도메인 체크리스트

공식 공개 도메인은 `https://gritedu.kr`입니다. 현재 정적 Hosting 운영 경로는 Cloudflare Pages입니다. 배포 전후 SEO 확인은 공개 사이트 파일과 빌드 산출물 기준으로만 수행하고, 관리자/회원 기능과 Firebase 설정은 별도 지시 없이 바꾸지 않습니다.

배포 전 확인:

- `npm run prebuild`
- `npm run verify`
- `git diff --check`
- `dist/_headers`, `dist/version.json`, `dist/sitemap.xml`, `dist/robots.txt` 생성 확인
- `dist/firestore.rules`, `dist/firebase.json`, `dist/.firebaserc`, `dist/storage.rules`가 없는지 확인
- `dist/**`가 Git 추적 대상에 포함되지 않았는지 확인
- sitemap 생성 결과가 핵심 공개 페이지 6개(`/`, `/courses.html`, `/instructors.html`, `/contact.html`, `/schedule.html`, `/story.html`)만 포함하는지 확인
- `robots.txt`가 `Sitemap: https://gritedu.kr/sitemap.xml`을 안내하는지 확인
- 공개 HTML의 canonical, `og:url`, JSON-LD URL이 `https://gritedu.kr` 기준인지 확인
- `/assets/instructors/profile/profile.png` placeholder와 R2/local image fallback이 깨지지 않는지 확인

Search Console/검색엔진 상태:

- Google Search Console의 `gritedu.kr` 속성에는 `https://gritedu.kr/sitemap.xml` 제출이 완료되었습니다.
- sitemap에서 발견된 페이지는 6개이며, 주요 URL은 페이지 색인 생성됨 상태로 확인했습니다.
- `www.gritedu.kr`은 `https://gritedu.kr`로 301 redirect 완료 상태입니다.
- `gritedu.pages.dev`는 `https://gritedu.kr`로 301 redirect 완료 상태입니다.
- Cloudflare Pages deployment alias도 하위 도메인 포함 설정으로 `https://gritedu.kr` 301 redirect가 확인되었습니다.
- 위 Cloudflare redirect는 path/query 보존 확인까지 완료되었습니다.
- old `gritedu-lms.web.app` Search Console 속성은 임시 삭제 요청 처리 상태 확인용으로 당분간 유지합니다.
- old Firebase Hosting URL은 임시 삭제 요청 처리 중이며, 404 유지로 색인 제거를 유도합니다.
- Firebase Hosting old URL을 `gritedu.kr`로 301 redirect하는 작업은 하지 않습니다.
- Firebase Hosting redirect-only 전환안은 미채택 상태입니다.
- 네이버 서치어드바이저 old 도메인 검색 제외 요청은 완료되었습니다.
- `gritedu.online`은 코드 수정 대상이 아니라 검색 제외 처리 후 재확인 대상으로 관리합니다.

## 2-5. Cloudflare Pages 배포와 Firebase Hosting disable 상태

현재 운영 배포 기준:

- Cloudflare Pages project: `gritedu`
- Production branch: `main`
- Build command: `npm run prebuild`
- Build output directory: `dist`
- 대표 운영 domain: `https://gritedu.kr`
- `www.gritedu.kr`: `https://gritedu.kr` 301 redirect 완료
- 기본 Pages domain `https://gritedu.pages.dev`: `https://gritedu.kr` 301 redirect 완료
- Cloudflare Pages deployment alias: 하위 도메인 포함 설정으로 `https://gritedu.kr` 301 redirect 확인 완료
- Firebase Auth/Firestore/Functions: 계속 Firebase project `gritedu-lms` 사용
- Firebase Hosting: `firebase hosting:disable` 완료. `gritedu-lms.web.app`, `gritedu-lms.firebaseapp.com`은 curl 기준 404 확인 완료이며 fallback/redirect 용도로 사용하지 않음

일반 운영 배포 흐름:

1. 로컬에서 `npm run prebuild`를 실행합니다.
2. 로컬에서 `npm run verify`를 실행합니다.
3. `git diff --check`로 공백/마커 문제를 확인합니다.
4. 변경 사항을 commit합니다.
5. 연결된 production branch에 `git push`합니다. 현재 GitHub `main` 기준이면 `git push origin main`입니다.
6. Cloudflare Pages가 Git push를 감지해 자동 빌드/배포합니다.
7. Cloudflare Pages 배포가 끝나면 `gritedu.kr`에서 QA합니다.

기존 Firebase Hosting deploy와의 차이:

- `npm run deploy` 또는 `firebase deploy --only hosting`은 일반 운영에서 사용하지 않습니다.
- Firebase Hosting은 disable 완료 상태이며, 같은 `dist/`를 fallback/redirect 목적으로 배포하지 않습니다.
- `firebase.json`에 Hosting 설정이 남아 있어도 현재 운영 배포 기준은 아닙니다. redirect-only 변경도 하지 않습니다.
- Cloudflare Pages cache/header 정책은 `dist/_headers`가 담당합니다.
- Firebase Auth/Firestore/Functions 배포나 설정 변경은 Cloudflare Pages 배포와 별개입니다.
- Functions 배포 또는 Firestore rules 배포가 필요한 경우 Firebase CLI를 계속 사용할 수 있지만, Hosting deploy와 명령/목적을 명확히 분리합니다.

Pages 배포 후 필수 QA:

- `/`, `/index.html`, `/version.json`, `/robots.txt`, `/sitemap.xml` 접근 확인
- 주요 공개 페이지 6개: `/`, `/courses.html`, `/instructors.html`, `/contact.html`, `/schedule.html`, `/story.html`
- 로그인/로그아웃, 회원가입 진입, 이메일 인증번호 발송/검증. 2026-06-29 기준 `gritedu.kr` 회원가입 QA 1차는 완료
- callable Functions: `sendVerificationCode`, `verifyEmailCode`, `linkMemberChild`
- Firestore 공개 읽기와 관리자/학생/회원 대시보드 읽기
- R2 이미지: `assets.gritedu.kr` 기반 팝업/강사/Story 이미지 표시. 2026-06-29 기준 R2 이미지 로딩 QA 완료
- public 노출 금지 파일: `/firestore.rules`, `/firebase.json`, `/.firebaserc`, `/storage.rules`
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias의 `https://gritedu.kr` 301 redirect 확인. path/query 보존 확인 완료
- Cloudflare Pages `_headers` live response, forbidden URL live response, 관리자 CMS, 모바일/iPhone/KakaoTalk 확인은 남은 QA 항목입니다.

Firebase Hosting old URL 운영 기준:

- `https://gritedu-lms.web.app/`와 `https://gritedu-lms.firebaseapp.com/`은 404 상태를 유지합니다.
- old URL을 `https://gritedu.kr`로 301 redirect하지 않습니다.
- Search Console 임시 삭제 요청과 404 유지로 색인 제거를 유도합니다.
- Firebase Hosting redirect 설정 추가, `firebase.json` redirect-only 변경, Hosting deploy 실행은 금지합니다.
- Firebase Auth/Firestore/Functions는 계속 Firebase에서 사용하므로 Hosting disable과 구분합니다.

## 2-6. 약관/개인정보처리방침 운영 기준

2026-07-03 기준 `terms.html`의 이용약관 및 개인정보처리방침 탭과 회원가입/마케팅 동의 문구를 점검했습니다. 공개 이용약관과 회원가입 동의 요약은 짧게 줄이고, 개인정보처리방침 전문은 필요한 상세 항목을 유지했습니다.

운영자가 배포 전 확인할 항목:

- `terms.html`, `/privacy.html` redirect, 회원가입 약관 보기, 학생/회원 대시보드의 광고성 정보 수신 설정 문구가 같은 내용을 안내하는지 확인합니다.
- 개인정보처리방침에는 클라우드 인프라와 공개 이미지 계층의 접속 로그 가능성, Google/Firebase/Gmail SMTP/Cloudflare 위탁, 운영 기록 정리 기간이 반영되어 있습니다.
- `LEGAL_POLICY_VERSION`은 Firestore rules의 `legalPolicyVersion()`과 함께 관리해야 합니다. 이번 정책 문구 수정에서는 rules 변경이 금지되어 동의 저장 버전 `2026-06-12`를 유지했습니다. 정책 버전 갱신은 rules 변경, 테스트, 배포 계획과 함께 별도 진행합니다.
- Cloudflare/Google의 국외이전 세부 국가, 연락처, 보유기간, 14세 미만 온라인 가입 운영 정책, 개인정보 보호책임자 성명/연락처, 기존 가입자 재동의 필요 여부는 운영자가 확인해야 합니다.

## 3. 학생 관리

사용 화면:

- `members/admin/users/students.html`

주요 작업:

- 학생 목록 확인
- 학생 프로필 수정
- 온라인 수강 상태 확인
- 오프라인 반 배정 상태 확인
- 학부모/회원 연결 상태 확인

주의:

- 학생 삭제 전 수강, 반 배정, 자녀 연결을 확인합니다.
- 학생 계정은 `students` 기준입니다. Legacy `users/*`를 사용하지 않습니다.

## 4. 회원/학부모 회원 관리

사용 화면:

- `members/admin/users/members.html`

주요 작업:

- 일반 회원 목록 확인
- 회원 정보 수정
- 자녀 연결 상태 확인
- 자녀 연결 시도/요청 확인
- 회원 본인 온라인 수강 확인

주의:

- 학부모 전용 legacy collection이 아니라 `members`와 `studentParentLinks`를 사용합니다.
- 회원 삭제 전 자녀 연결과 수강 연결을 확인합니다.

## 5. 강사 관리

사용 화면:

- `members/admin/users/instructors.html`

주요 작업:

- 강사 공개 프로필 관리
- 강사 로그인 계정 연결
- 담당 온라인 강의 확인
- 담당 오프라인 반 확인
- 강사 프로필/참고 자료 이미지 URL 관리
- 강사 과목 기준값 추가/수정/삭제/순서 변경

주의:

- 강사 프로필(`instructors`)과 로그인 계정(`instructorAccounts`)은 분리되어 있습니다.
- 강사 과목 기준값은 `settings/instructorsMenu.subjects`에 저장되며 계정 생성 관리의 강사 과목 선택과 공유됩니다.
- 공개 강사진 페이지 필터도 `settings/instructorsMenu.subjects`를 읽습니다. `courseCatalog.instructorSubjectChips`는 legacy입니다.
- 강사진 페이지의 `전체` 필터는 Firestore 기준값이 아니라 렌더링 단계에서만 추가되는 가상 필터입니다.
- 강사별 복수 과목은 `subjects[]`에 저장하고, 대표 과목은 기존 `subject` 필드에 유지합니다.
- 직접 입력한 과목은 해당 강사 문서에만 저장되며 강사 과목 기준값 목록이나 필터 후보에 자동 추가되지 않습니다.
- 강사 삭제 전 담당 강의, 담당 반, 공개 시간표 연결을 확인합니다.
- 강사 수정 modal이 열려 있는 동안 URL 검증/저장 오류는 화면 상단 toast가 아니라 modal 내부 alert(프로필 이미지 URL은 해당 입력칸 바로 아래)에 표시됩니다.
- 프로필/참고 자료 R2 URL은 `assets.gritedu.kr/public/instructors/profile/` 또는 `public/instructors/image/` prefix와 PNG/JPG/WEBP 확장자만 허용됩니다.

## 6. 온라인 강의 관리

사용 화면:

- `members/admin/courses.html`

주요 작업:

- 강의 생성/수정
- 공개/회원 전용/보관 상태 관리
- 강사 연결
- 커리큘럼/주차 정보 관리
- 썸네일 이미지 경로 관리
- 수강 연결 확인/정리
- 온라인 강좌 과목/학년/연도 기준값 추가/수정/삭제/순서 변경

주의:

- `courses`는 공개 읽기 가능합니다.
- 온라인 강좌 기준값은 `settings/courseCatalog.chipGroups`의 `subject`, `grade`, `year`에 저장됩니다.
- 과목은 내부 `value`와 화면 `label` 구조를 유지하지만, 관리자 UI는 과목명 중심입니다. 관리자가 과목 식별값을 직접 지정하는 UI는 없으며, 신규 과목은 `CUSTOM_001`, `CUSTOM_002` 형식으로 자동 생성됩니다.
- 기본 과목 value(`KOR`, `ENG`, `MATH`, `SCI`, `ESSAY`, `ETC`)도 기준값 목록에서 삭제할 수 있습니다. 삭제된 과목 식별값을 쓰는 기존 강좌는 마이그레이션하지 않고 fallback label로 표시합니다.
- 화면과 공개 페이지는 과목 label 중심으로 표시합니다. 내부 value는 공개 UI에 직접 노출하지 않습니다.
- 직접 입력한 과목/학년/연도는 해당 강좌 문서(`courses.subject` / `grade` / `year`)에만 저장되며 기준값 목록이나 필터 후보에 자동 추가되지 않습니다.
- 강좌 추가/수정 모달에서는 과목도 직접 입력할 수 있습니다. 직접 입력한 과목은 해당 강좌에만 저장됩니다.
- 강좌 추가/수정 모달에는 `lectureContent`(학습 내용 소개) 입력칸이 없습니다. 기존 문서의 `lectureContent`/`learningContent`는 삭제하거나 마이그레이션하지 않고 읽기 호환만 유지합니다.
- 학습 콘텐츠 입력은 미리보기 영상 URL, 강좌 형식, 커리큘럼/주차 정보 중심으로 유지합니다.
- 민감한 비공개 영상 URL, 결제 권한, DRM 토큰을 강의 문서에 넣지 않습니다.
- 강의 삭제 전 관련 `enrollments`를 확인합니다.

## 7. 오프라인 반 관리

사용 화면:

- `members/admin/offline-classes.html`

주요 작업:

- 오프라인 반 생성/수정
- 강사 연결
- 학생 배정/해제
- 회차 생성/수정/삭제
- 학생별 회차 접근 관리
- 과목/학년/학교/강의실 기준값 추가/수정/삭제/순서 변경
- 시간표 그룹(정규/윈터/썸머 등) 추가/수정/비활성/삭제 — 최대 3개, `regular` 삭제 불가
- 그룹 탭별 과목/학년/학교/강의실 기준값 관리 (`groupCatalogs[groupId]`)

주의:

- 오프라인 반 기준값과 시간표 그룹은 `settings/timetableCatalog`에 저장되며 공개 시간표 관리와 공유됩니다.
- 기준값은 선택한 그룹 탭의 `groupCatalogs[groupId]`에 저장됩니다. `regular`는 legacy top-level 필드도 sync합니다.
- 각 반의 `groupId`로 그룹 탭 필터가 적용됩니다. `groupId` 없는 기존 반은 `regular`로 표시됩니다.
- 반별로만 필요한 직접 입력값은 해당 `offlineClasses` 문서에만 저장됩니다.
- 직접 입력값은 기준값 목록이나 필터 후보에 자동 추가되지 않습니다.
- 반 삭제 전 학생 배정, 회차, 접근 문서, 공개 시간표 항목을 확인합니다.
- 먼저 보관 상태로 전환한 뒤 삭제 여부를 판단하는 편이 안전합니다.

## 8. 공개 시간표 관리

사용 화면:

- `members/admin/timetable.html`

주요 작업:

- 공개 시간표 항목 확인
- 오프라인 반 정보를 바탕으로 공개 항목 반영
- 노출 여부와 정렬 관리
- 과목/학년/학교/강의실 기준값 추가/수정/삭제/순서 변경
- 시간표 그룹(정규/윈터/썸머 등) 관리 — 최대 3개, `regular` 삭제 불가. UI에서는 이름·노출·순서만 편집
- 그룹 탭별 공개 시간표 항목 관리
- 그룹별 시간표 이미지 URL 관리 (`groupCatalogs[groupId].scheduleImages`)
- 공개 `schedule.html`의 「시간표 이미지 보기」는 선택 그룹의 `/schedule-images/?group={groupId}`로 이동합니다(Cloudflare `_redirects` 또는 `dist/schedule-images/index.html`).
- 시간표 추가 modal의 오프라인 반 불러오기는 현재 modal `groupId` 기준으로 필터·검색합니다.
- 그룹별 기준값·시간표 이미지는 `settings/timetableCatalog.groupCatalogs[groupId]`에 저장됩니다. `regular`만 legacy top-level(`subjects`, `grades`, `schools`, `classrooms`, `scheduleImages`)과 동기화됩니다.
- `winter`/`summer` 등 seasonal 그룹 이미지는 해당 그룹 `groupCatalogs`에만 있어야 하며, top-level `scheduleImages`와 자동 연동되지 않습니다. 윈터에 정규 이미지가 섞여 보이면 시간표 이미지 관리에서 윈터 탭을 선택한 뒤 정규 항목을 삭제하고 저장하세요.
- 기준값 저장과 시간표 이미지 저장은 별도입니다. 기준값 저장은 과목/학년/학교/강의실만 바꾸고, 이미지는 ‘시간표 이미지 관리’에서 저장합니다.
- `기준값 저장` 후 Firestore `updatedAt`/`updatedBy`와 선택 그룹의 `groupCatalogs.{그룹ID}`(정규는 top-level 필드도)가 갱신됐는지 확인합니다.
- seasonal 그룹만 편집했는데 top-level `subjects`가 안 바뀌는 것은 정상입니다.
- 수업 일정(`scheduleItems`)은 선택 입력이며 빈 배열 저장을 허용합니다.

주의:

- 시간표 기준값·그룹은 `settings/timetableCatalog`에 저장되며 오프라인 반 관리와 공유됩니다.
- 기준값·이미지는 선택 그룹의 `groupCatalogs[groupId]`에 저장됩니다. `regular` 저장 시 legacy top-level도 sync합니다.
- `publicTimetableEntries.groupId`와 `offlineClasses.groupId`로 그룹을 구분합니다. 없으면 `regular`.
- 공개 `schedule.html`은 active 그룹 탭 + 학년/과목/학교/검색 필터를 함께 적용합니다.
- 공개 시간표 필터는 `timetableCatalog`가 설정되어 있으면 저장된 기준값을 후보로 사용합니다.
- 특정 시간표에만 필요한 직접 입력값은 해당 `publicTimetableEntries` 문서에만 저장되며 기준값 목록이나 필터 후보에 자동 추가되지 않습니다.
- 공개 시간표는 오프라인 반의 실시간 동기화 화면이 아닙니다.
- 반 정보 변경 후 공개 시간표가 의도대로 반영되어 있는지 직접 확인합니다.

## 9. 팝업 관리

사용 화면:

- `members/admin/popup.html`

주요 작업:

- 팝업 생성/수정
- 노출 기간/상태 관리
- 팝업 이미지 경로 입력 (선택, 1개)
- 문구 항목(`textItems[]`) 추가/수정/삭제 — 문구별 URL, 정렬(left/center/right), 사용 여부

팝업 유형 (이미지·문구 독립):

- **이미지만**: `imageUrl`만 등록. 이미지 클릭 URL은 `imageLinkUrl`(또는 이미지 단독일 때 `contentLinkUrl` fallback)을 사용합니다.
- **문구만**: `textItems[]`에 문구(및 선택 URL)만 등록. `imageUrl` 없이도 활성화 시 홈에 표시됩니다.
- **이미지 + 문구**: 둘 다 등록 가능하며, 여러 활성 팝업은 위치별로 함께 쌓입니다.
- 저장 검증: 이미지 또는 문구(`textItems` / legacy `content`) 중 **하나 이상** 필요합니다.

`textItems[]` 운영:

- 공개 홈 팝업은 enabled `textItems`를 sortOrder 순으로 우선 렌더합니다.
- `textItems`가 없거나 모두 비활성/빈 문구이면 legacy `content`/`contentLinkUrl` fallback을 사용합니다.
- 긴 문구는 모바일에서 overflow 방지 처리됩니다.

이미지 기준:

- 팝업 이미지는 `/assets/popup/*.webp` 로컬 fallback 또는 허용된 R2 `public/popup/*.webp` URL을 사용합니다.
- R2 public URL은 저장 후 배포 없이 공개 사이트에 반영됩니다.
- 파일 선택 버튼은 실제 업로드가 아니라 로컬 경로 입력 보조입니다.
- 로컬 경로는 `assets/popup` 배치 후 `npm run prebuild`, `npm run verify`, Git push, Cloudflare Pages 배포 확인이 필요합니다.

## 10. 사이트 관리

학원정보조회·교습비·환불규정 이미지는 `사이트 관리 -> 푸터 정보`에서 관리합니다.

1. R2 `public/footer/`에 PNG/JPG/JPEG/WebP 이미지를 업로드합니다.
2. `https://assets.gritedu.kr/public/footer/...` URL을 해당 영역에 추가합니다.
3. 미리보기와 표시 순서를 확인하고 저장합니다.
4. `tuition.html`, `tuition.html#fee`, `tuition.html#refund`에서 공개 결과를 확인합니다.

CMS는 R2에 직접 업로드하지 않습니다. 등록 이미지가 없으면 미등록 안내가 표시되며, 과거 PDF로 자동 전환되지 않습니다.

사용 화면:

- `members/admin/site.html`

주요 작업:

- 학원 안내(`story.html`) 콘텐츠 관리
- 상담 문의(`contact.html`) 위치/전화/지도/교통 정보 관리
- 카카오톡 채널 플로팅 링크 URL/노출 페이지 관리
- 강사진 노출 순서/숨김/상세 섹션 설정 확인

주의:

- 공개 페이지에 바로 영향을 줄 수 있습니다.
- 외부 공개 문구, 링크를 저장하기 전 확인합니다.
- 사이트 관리는 과목/학년/학교/강의실 기준값을 관리하지 않습니다. 해당 기준값은 온라인 강의, 오프라인 반, 시간표, 강사 관리 화면 상단 패널에서 관리합니다.
- Story 이미지 외 story/contact 본문 이미지 신규 첨부는 차단됩니다.
- CMS 텍스트/구조 데이터만 바꾸는 경우 Firestore 저장만으로 공개 페이지에 반영되며 코드 배포가 필요 없습니다.
- 카카오톡 채널 URL과 노출 페이지 변경도 Firestore 저장만으로 반영되며 코드 배포가 필요 없습니다.
- `story.html`, `contact.html`, CSS, JS 코드 변경이 있는 경우에만 코드 배포 절차를 따릅니다.

### 학원 안내 수정 절차

공개 페이지 `story.html`은 정적 shell/fallback입니다. 운영 콘텐츠는 Firestore `pages/story` v2 문서를 읽어 표시합니다.

공개 렌더링 우선순위:

1. `pages/story.version === 2`
2. legacy `pages/story.content`
3. `story.html` HTML fallback

운영자가 바꿀 수 있는 필드:

- 상단 배너 이미지 URL
- 대표 인사말 제목
- 대표 인사말 부제
- 대표 인사말 본문
- 회사명/직함
- 대표명
- 대표 사진 URL
- G/R/I/T 설명
- 마지막 멘트 1줄
- 마지막 멘트 2줄

운영자가 CMS에서 바꾸지 않는 값:

- 브라우저 탭 제목/SEO meta
- 이미지 alt 기본값
- `pageTitle`
- `gritValues[].letter`
- `gritValues[].word`
- 레이아웃/CSS/디자인 프리셋

학원 안내 이미지 변경:

1. `.jpg`, `.jpeg`, `.png`, `.webp` 이미지를 준비합니다.
2. R2 `public/story/`에 업로드합니다.
3. 가능하면 같은 파일명 덮어쓰기보다 `story-hero-20260626.webp`, `ceo-yhs-20260626.webp`처럼 versioned filename을 사용합니다.
4. 관리자 -> 사이트 관리 -> 학원 안내로 이동합니다.
5. 상단 배너 이미지 URL 또는 대표 사진 URL에 `https://assets.gritedu.kr/public/story/...` URL을 입력합니다.
6. 본문/서명/GRIT/마지막 멘트를 확인하고 저장합니다.
7. `/story.html`에서 반영 상태를 확인합니다.

학원 안내 저장 시 legacy/중복 필드는 자동 정리됩니다. `closingMessage`, `greeting.signature`, `greeting.ceoTitle`, `greeting.ceoName`, `content`, `structure`, `lead`, `gritValues[].body`는 콘솔에서 수동 삭제할 필요 없이 CMS에서 한 번 저장하면 정리됩니다. 다만 legacy `content` fallback 경로는 과거 문서 호환을 위해 코드에 남아 있습니다.

현재 학원 안내 CMS에는 브라우저 탭 제목 입력, 이미지 설명 입력, 실시간 미리보기, 새 창에서 확인 버튼, 파일 업로드, 글꼴/색상/크기 툴바, 디자인 프리셋, 말풍선이 없습니다.

2026-07-06 기준 Story greeting panel overflow containment가 보강되어 desktop에서 대표 사진, GRIT 문구, 마지막 멘트가 panel 내부에서 wrap/contain됩니다.

### 상담 문의 수정 절차

공개 페이지 `contact.html`은 Firestore `pages/contact` canonical 구조를 우선 읽습니다.

저장 기준 필드:

- `slug`, `structure.locations[]`, `updatedAt`

공개 렌더링 우선순위:

1. `pages/contact.structure.locations[]` (canonical)
2. legacy `pages/contact.content` (pre-migration DB용 최소 fallback)
3. `contact.html` HTML fallback

운영자가 바꿀 수 있는 필드(위치별):

- 위치 이름
- 전화번호
- 문구 `messageLines[]` (최대 3줄, 줄 추가/삭제/수정)
- 온라인 상담 예약 URL
- 운영 시간
- 주소
- 구글 지도 입력값(URL 또는 검색어)
- 교통수단 `transportItems[]` (유형 + 안내문구 textarea)
- 네이버/카카오/구글 지도 링크

저장하지 않는 항목:

- 페이지 제목 입력 (공개 제목은 「상담 문의」 고정)
- `phoneNote`, `callableHours`, `transportation`, `transportItems[].lines`
- Contact 이미지 업로드/R2 prefix

상담 문의 수정:

1. 관리자 -> 사이트 관리 -> 상담 문의로 이동합니다.
2. 위치별 전화, `messageLines`, 주소, 지도 입력값, 교통수단, 지도 앱 링크를 수정합니다.
3. 위치가 여러 개이면 표시 순서를 조정합니다.
4. 저장합니다. 저장 후 Firestore 문서에 legacy 필드가 다시 생기지 않는지 확인합니다.
5. `/contact.html`에서 위치 탭, 전화/문구/예약 버튼, 지도, 교통 안내가 의도대로 표시되는지 확인합니다.

Contact CMS는 현재 이미지/R2 입력 필드가 아닙니다. 이미지 첨부와 파일 업로드는 차단되어 있으며, 텍스트/URL/지도/교통 정보 중심으로 운영합니다. Firebase Storage는 사용하지 않습니다.

### 카카오톡 채널 설정 절차

카카오톡 채널 버튼은 SDK 기능이 아니라 `https://pf.kakao.com/...` URL을 여는 단순 링크입니다. 사업자 인증, 월렛, 매장 연결, 채널 검색용 아이디 설정과는 별개로 동작합니다.

운영자가 바꿀 수 있는 필드:

- 사용 여부
- 카카오톡 채널 URL
- 버튼 문구
- 노출 페이지: 메인 홈, 학원 안내, 시간표, 상담 문의, 강사진, 모든 강좌

수정 절차:

1. 관리자 -> 사이트 관리 -> 카카오톡 채널로 이동합니다.
2. 채널 홈으로 연결하려면 `https://pf.kakao.com/...` URL을 입력합니다.
3. 채팅으로 바로 연결하려면 카카오에서 제공하는 `/chat` 포함 URL을 그대로 입력합니다.
4. 버튼 문구와 노출할 공개 페이지를 선택합니다. 버튼 문구를 비워두면 공개 버튼은 아이콘만 표시됩니다.
5. 저장합니다.
6. 선택한 공개 페이지에서 우측 하단 카카오톡 플로팅 버튼이 보이는지 확인합니다.
7. 선택하지 않은 공개 페이지, 상세 페이지, 정책 페이지, `members/**` 영역에서는 버튼이 보이지 않는지 확인합니다.

주의:

- URL은 `https://pf.kakao.com/`로 시작해야 합니다.
- 코드는 `/chat`을 자동으로 붙이지 않습니다. 저장한 URL을 그대로 사용합니다.
- `http://`, `javascript:`, `data:`, `blob:`, 타 도메인 URL은 저장하지 않습니다.
- 카카오톡 SDK, Kakao Developers 앱키, `Kakao.init`, `Kakao.Channel`은 사용하지 않습니다.
- 모바일에서는 기존 맨 위로 이동 버튼 위쪽에 표시됩니다.

### 코드 변경 배포 절차

CMS 텍스트/구조 변경이 아니라 HTML/CSS/JS 코드 변경이 있는 경우:

```bash
npm run prebuild
npm run verify
git diff --check
git status
git commit
git push
```

Cloudflare Pages deployment가 성공한 뒤 `gritedu.kr` 운영 URL에서 확인합니다. `firebase deploy --only hosting`은 현재 운영 배포 절차가 아닙니다.

## 11. 운영 정리 센터

사용 화면:

- `members/admin/operation-tasks.html`

주요 작업:

- 만료된 이메일 인증 기록 정리
- 오래된 회원가입 인증 시도 기록 정리
- 오래된 자녀 연동 시도 기록 정리
- 정리 대상 개수 확인 후 제한된 수동 삭제 실행
- **오프라인 회차 자동 정리 정책(`settings/retentionPolicy`) 설정 및 미리보기**

운영 방침:

- 기본 정리는 Cloud Functions `scheduledRecordCleanup`이 수행합니다.
- 자동 정리 스케줄은 매월 1일 03:00 Asia/Seoul입니다.
- 운영 기록 3개 컬렉션은 `functions/record-cleanup.js` 정책 기준 full scan·삭제입니다.
- 오프라인 회차는 `functions/offline-session-cleanup.js`가 `settings/retentionPolicy`를 읽어 처리합니다. **Functions 배포 후에는 CMS 설정만 변경**하면 보존 기간·실제 삭제 여부·상태·limit을 조정할 수 있습니다. rules/hosting 재배포는 필요 없습니다.
- 오프라인 회차 기본값: 보존 180일(6개월), `published`/`archived`, 실제 삭제 실행, 1회 200건, active 수동 권한 회차 제외.
- CMS **정리 대상 확인**은 버튼 클릭 시 최대 50건만 조회합니다. 페이지 로드 시 자동 scan 없음.
- 수동 확인/정리(운영 기록)는 Firestore read 비용 절감을 위해 localStorage 기준 30일 쿨다운을 둡니다.
- 오프라인 회차는 **수동 삭제 버튼 없음**. 미리보기만 제공하고 실제 삭제는 월 1회 스케줄에서만 실행합니다.

정리 대상 정책:

| Collection | 수동/자동 정리 기준 |
| --- | --- |
| `emailVerifications` | 만료 또는 생성 후 7일 경과 |
| `signupAttempts` | 30일 경과 또는 차단 만료 후 7일. 활성 차단은 제외 |
| `memberChildLinkAttempts` | 실패/미완료 90일, 성공 180일 경과 |
| `offlineClassSessions` | CMS `settings/retentionPolicy`: sessionDate, status, 실제 삭제 여부, perRunLimit |
| `offlineSessionAccess` | 대상 session cascade (자동만) |
| `operationTasks` | 신규 생성 중단. 정리 대상 제외. legacy 문서는 Firebase Console에서 1회 수동 정리 |

오프라인 회차 정리 주의:

- **실제 삭제 실행**을 켜면 오래된 회차와 연결된 예외 권한(`offlineSessionAccess`) 기록이 삭제됩니다.
- 영상이 있는 회차도 정리 대상이면 학생/강사 화면에서 사라질 수 있습니다(크래시는 없음).
- 한 번에 최대 처리 개수(`perRunLimit`)로 Firestore read/delete 급증을 방지합니다.
- 반·입반·수강 등록·계정 정보는 삭제하지 않습니다.

주의:

- 삭제성 작업은 되돌리기 어렵습니다.
- 삭제 전 대상 collection, 개수, 조건을 확인합니다.
- `functions/record-cleanup.js`, `functions/offline-session-cleanup.js`, `assets/js/pages/admin-operation-tasks.js` 정책/기본값을 함께 맞춰야 합니다.
- Cloud Scheduler 비용은 job당 월 $0.10이고 결제 계정당 3 job 무료입니다. 현재 비용 리스크는 주로 Firestore read/delete입니다.
- Functions `scheduledRecordCleanup`는 이미 `gritedu-lms` project의 `us-central1`에 배포 완료된 상태로 봅니다. 이번 변경 후 **Functions 재배포**가 필요합니다.

## 12. 이미지 Asset Workflow

현재 Firebase Storage를 사용하지 않습니다. 자주 바뀌는 공개 운영 이미지(popup, instructor profile/참고 자료, story hero/CEO)는 R2 public URL을 공식 지원합니다.

### R2 public 운영 절차

1. WebP 이미지를 준비합니다.
2. R2 Dashboard에서 `public/popup/`, `public/instructors/profile/`, `public/instructors/image/`, `public/story/` prefix에 업로드합니다. (legacy read: `public/instructors/curriculum/`)
3. public URL을 복사합니다.
4. CMS 이미지 URL 입력란에 붙여넣고 저장합니다.
5. 배포 없이 공개 사이트에서 확인합니다.
6. 문제 시 기존 local `/assets/...` fallback으로 되돌립니다.

R2 이미지 교체 원칙:

- 같은 R2 key를 덮어쓰지 않습니다.
- 이미지를 바꿀 때는 새 R2 key를 만들고 CMS URL을 새 URL로 교체합니다.
- R2 URL에 `Date.now()` 같은 query cache-buster를 붙이지 않습니다.
- Story 이미지는 `https://assets.gritedu.kr/public/story/` 또는 허용된 `https://assets.gritedu.kr/public/pages/story/` URL만 사용합니다.
- public bucket에는 학생 자료, 성적, 리포트, 과제, 내부 운영 자료를 올리지 않습니다.

local 고정 이미지 교체 원칙:

- 같은 파일명을 덮어쓰지 않고 새 파일명을 사용한 뒤 `prebuild`/배포합니다.
- local `/assets` 이미지 URL에 query cache-buster를 붙이지 않습니다.
- 기존 object는 rollback window가 지난 뒤 사용 여부를 확인하고 정리합니다.

### 로컬 `/assets` fallback 절차

1. 사용할 이미지를 준비합니다.
2. 개발자 또는 로컬 PC 담당자가 저장소의 `assets/**` 폴더에 파일을 둡니다.
3. CMS에는 `/assets/...` 경로를 입력합니다.
4. 배포 전 prebuild로 누락 이미지와 WebP 산출을 확인합니다.
5. 배포 후 공개 페이지에서 이미지를 확인합니다.

### 월간 체크리스트

- R2 storage/request 사용량 확인
- Cloudflare Pages/R2 트래픽과 Firebase Auth/Firestore/Functions 사용량 확인
- Firebase Hosting old URL이 404를 유지하는지, 의도치 않은 Hosting deploy가 없었는지 확인
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias가 `https://gritedu.kr` 301 redirect와 path/query 보존을 유지하는지 확인
- Google Search Console old `gritedu-lms.web.app` 임시 삭제 요청 상태 확인
- Naver Search Advisor old 도메인 검색 제외 상태와 `gritedu.online` 검색 제외 후 재확인 상태 확인
- 사용 중인 R2 URL 목록 점검
- 더 이상 쓰지 않는 테스트 object 확인
- public bucket에 private 자료가 없는지 확인
- `r2.dev`에서 custom domain 전환 필요 여부 확인
- 큰 local asset과 `dist` 상위 파일 크기 확인
- 배포 후 version prompt가 일반 새로고침으로 해결되는지 확인
- 배포 후 `/`, `/index.html`, `/version.json`, `/assets/school.csv` HEAD와 주요 화면 Network 중복 요청 확인
- R2 이미지가 같은 key overwrite 없이 새 key + CMS URL 교체 방식으로 운영되는지 확인
- Cloudflare Pages `_headers`, forbidden URL, 관리자 CMS, 모바일/iPhone/KakaoTalk QA 상태 확인

### R2 설정 상태

- Public custom domain: `https://assets.gritedu.kr`
- Legacy public URL: `https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev` (과도기 호환)
- CORS: 운영 대표 도메인 `https://gritedu.kr`와 필요한 로컬 테스트 도메인 (`GET`, `HEAD`) 확인 필요. `gritedu.pages.dev`는 `gritedu.kr` 301 redirect 완료 상태
- Storage class: Standard
- Lifecycle: incomplete multipart upload cleanup만 허용 (object delete/expire/transition rule 금지)
- Custom domain: 운영 기준 도메인으로 사용 중. 신규 CMS 입력은 `assets.gritedu.kr` URL을 우선합니다.
- QA 상태: 2026-06-29 기준 R2 이미지 로딩 QA 완료. 새 R2 URL을 추가할 때는 해당 공개 화면에서 다시 확인합니다.

운영자가 CMS만으로 할 수 있는 일:

- 이미지 경로 입력
- 팝업/사이트/강사 콘텐츠 설정
- 노출 여부 변경

로컬 PC/개발자가 필요한 일:

- 실제 이미지 파일 추가/교체
- WebP 변환 확인
- prebuild 실행
- 배포

## 13. Firebase Console이 필요한 일

- Auth 계정 직접 확인/비상 조치
- Firestore 데이터 직접 점검
- 예산/사용량 확인
- Functions secret 확인
- 배포/Functions 오류 로그 확인

Console 작업은 실수 영향이 크므로 권한 있는 담당자만 수행합니다.

## 14. 일일/주간 운영 체크

일일:

- 관리자 대시보드 접속 확인
- 공개 팝업/시간표 노출 확인
- 가입/로그인 문의 확인

주간:

- 운영 기록 정리 자동 함수 오류 여부 확인
- 가입/인증/자녀 연동 문의에서 비정상 반복 시도 징후 확인
- 강의/반/시간표 변경 사항 검토
- 이미지 깨짐 여부 확인

월간:

- Firebase 사용량 확인
- Cloudflare R2 사용량 확인
- Hosting download/cache 감사 항목 확인
- 운영 기록 정리 수동 확인/정리 1회. 대상은 `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts`
- `scheduledRecordCleanup` 실행 로그와 삭제 건수 확인
- 관리자 계정/권한 점검
- 오래된 팝업/강의/반 보관 처리
