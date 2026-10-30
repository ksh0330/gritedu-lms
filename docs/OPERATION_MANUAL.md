# Operation Manual

최종 갱신: 2026-09-12

## 1. 목적

이 문서는 학원 운영자가 Grit Edu 관리자 CMS를 사용할 때 참고하는 간단한 운영 매뉴얼입니다.

관리자 CMS는 데이터와 공개 노출을 직접 바꿀 수 있으므로, 삭제나 대량 정리 작업 전에는 대상과 영향을 반드시 확인해야 합니다.

가입 인증 결합과 Phase 2A scheduled cleanup은 production 검증됐습니다. 학생 자동 진급의 연 1회 transaction guard, 학생/일반/학부모 계정 정리 보강, 수동 학년 수정 후 다음 연도 자동 진급 유지까지 Rules와 `66132e67` 정적 client로 배포됐습니다. production 코드 제공은 확인했고 역할 계정 동작 확인은 남아 있습니다. 추가 Rules·Function은 없습니다. 오프라인 session은 현재 UI의 입반일·수동 grant/revoke 필터 운영을 유지하며 Rules 강제는 이번 작업에서 추가하지 않았습니다. 현재 UI는 그대로 사용하며 승인 없이 운영 DB에서 재현·복구하지 않습니다.

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
| 오프라인 반 관리 | 과목, 학년, 학교 | `settings/offlineClassCatalog` |
| 공개 시간표 관리 | 그룹, 학교급, 시간표 이미지 | `settings/timetableCatalog` |
| 강사 관리 | 강사 과목 | `settings/instructorsMenu.subjects` |

운영 절차:

1. 해당 관리 화면 상단의 기준값 관리 패널을 엽니다.
2. 기준값을 추가, 이름 수정, 삭제, 순서 변경합니다.
3. `기준값 저장`을 눌러 Firestore settings 문서에 반영합니다.
4. 등록/수정 모달을 열어 선택 토글과 필터 후보가 의도대로 보이는지 확인합니다.

오프라인 반(`settings/offlineClassCatalog`) 추가 확인:

- 상단 **그룹 탭**(정규/썸머/윈터)을 선택한 뒤 기준값을 편집하고 `기준값 저장`을 눌러야 합니다.
- **정규(`regular`)** 저장: `groupCatalogs.regular`만 갱신됩니다. legacy top-level 필드는 저장 시 제거됩니다.
- **썸머/윈터 등 seasonal** 저장: `groupCatalogs.{그룹ID}`만 갱신됩니다. Firestore 콘솔에서 top-level `subjects`만 보면 변경이 없어 보일 수 있습니다.
- 기준값 저장은 `groupCatalogs` 맵에 반영되며 최상위 `subjects/grades/schools`와 문자 그대로 생성된 `groupCatalogs.*` 필드는 제거됩니다.
- 그룹 이름·노출·순서는 `settings/timetableCatalog.scheduleGroups`를 읽고, 반 기준값은 `offlineClassCatalog`에만 저장합니다.
- 저장 후 화면은 현재 draft를 유지하며 settings cache를 무효화합니다.

주의:

- 등록/수정 모달 내부에서는 기준값 CRUD를 하지 않습니다.
- 모달의 직접 입력값은 해당 강좌/반/강사 문서 또는 선택한 `timetableCatalog` 그룹 이미지 설정에만 저장됩니다.
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
- `LEGAL_POLICY_VERSION`은 Firestore rules의 `legalPolicyVersion()`과 함께 관리해야 합니다. 현재 두 코드 값은 `2026-07-18`입니다. 정책 버전 갱신은 rules 변경, 테스트, 배포 계획과 함께 별도 진행합니다.
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
- 활성 자녀 연결이 있거나 link 상태가 불명확하면 학생 데이터 정리 버튼이 차단됩니다. 회원 관리에서 정상 `연결 해제`를 먼저 실행해 회원의 연결 자녀 수를 함께 갱신한 뒤 미리보기를 다시 엽니다. Firebase Console에서 relation 문서만 직접 삭제하지 않습니다.
- 학생 정리는 실행 직전에 대상을 다시 조회하며 수강, 오프라인 반/회차 접근, 해제된 학부모 link, 해당 학생으로 확정된 자녀 연결 시도, 해당 이메일의 임시 가입·인증 기록을 dependency부터 정리하고 학생 profile을 마지막에 삭제합니다. Auth 계정은 Firebase Console에서 별도 삭제합니다.
- 자동 진급은 marker가 이미 있는 기존 계정의 1~6학년을 연도별 최대 한 번만 올립니다. marker가 없는 기존 학생은 첫 진입 시 저장 학년을 그대로 두고 현재 연도 marker만 생성합니다. 학생 또는 관리자가 학년을 직접 바꾸면 해당 값을 올해 확정값으로 보고 같은 저장에 현재 연도 marker를 기록하며, 다음 연도부터 자동 진급을 다시 적용합니다. 이름·전화번호만 수정하면 marker는 바뀌지 않습니다. 7학년은 자동 변경하지 않고 기존에 잘못 진급한 운영 데이터는 자동 복구하지 않습니다.
- 학생 계정은 `students` 기준입니다. Legacy `users/*`를 사용하지 않습니다.
- `현황 불러오기`를 눌렀을 때만 학생 master 목록을 조회하고, 보이는 UID를 최대 10명씩 묶어 활성 온라인 수강과 오프라인 배정을 chunk당 2개 query로 읽습니다. 기본 10명은 2개, 미조회 20/50명 보기는 최대 4/10개 query입니다.
- 처음 보는 다음 페이지는 그 페이지의 미조회 UID만 읽고, 이미 본 페이지는 메모리 cache를 사용합니다. 검색은 Enter/돋보기에서 로컬 배열에만 적용되며 새 query가 없습니다. 검색 결과의 `미조회`는 0건이 아니라 아직 요약을 조회하지 않은 상태이고, page 이동/page-size/상세에서 필요한 범위를 읽습니다. `조회 실패`도 실제 0건이 아니므로 새로고침 후 재확인합니다.

## 4. 회원/학부모 회원 관리

사용 화면:

- `members/admin/users/members.html`

주요 작업:

- 일반 회원 목록 확인
- 회원 정보 수정
- 자녀 연결 상태 확인
- 자녀 연결 시도/요청 확인
- active 학부모 회원의 자녀 수동 연결/해제
- 가입 발송 시도와 자녀 연동 실패 진단
- 회원 본인 온라인 수강 확인

주의:

- 학부모 전용 legacy collection이 아니라 `members`와 `studentParentLinks`를 사용합니다.
- 회원 삭제 전 자녀 연결과 수강 연결을 확인합니다.
- 일반/학부모 회원 데이터 정리는 확인 문구 입력 후 실행 시점에 수강, 자녀 link, 자녀 연결 시도, 해당 이메일의 임시 가입·인증 기록을 다시 조회합니다. dependency를 먼저 정리하고 회원 profile을 마지막에 삭제하며, 연결된 학생 profile과 Auth 계정은 유지합니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리합니다.
- 자녀 연동은 이름으로 좁힌 학생 후보에 학교·학년·전화번호를 추가 확인합니다. 미일치, 복수 후보, 비활성 회원, 네트워크/서버 오류는 서로 다른 안내로 표시하며, 실패를 빈 수강 목록으로 간주하지 않습니다.
- 연동 시도 제한은 기록된 비성공과 반복 `alreadyLinked`를 기준으로 10분 5회·하루 15회입니다. 최초 `linked` 성공은 count하지 않고, rate-limit/server-error 응답은 새 attempt 문서로 저장하지 않습니다. 제한 응답의 안내된 rolling retry 시간이 지난 뒤 다시 시도합니다.
- 회원 목록의 자녀 이름은 현재 보이는 UID를 10명씩 묶은 `studentParentLinks` query와 link의 `studentSnapshot.name`으로 읽습니다. 새로고침 전까지 page-memory cache를 재사용하며 회원별 query나 학생별 get을 하지 않습니다. `조회 실패`는 `미연결`과 다릅니다.
- 상세의 관리자 수동 연결은 active `parent` 회원만 허용합니다. 학생 이름 2자 이상 또는 정확한 UID로 최대 20명을 검색하고 관계/대상을 확인한 뒤 연결합니다. deterministic `${studentUid}_${memberUid}` link와 member count는 한 transaction으로 갱신됩니다. 해제는 문서를 삭제하지 않고 `revoked`/`revokedAt`을 기록합니다. 정상 production workflow의 create/revoke lifecycle은 owner smoke로 확인됐습니다. stale counter가 감지되면 작업이 계속 차단되며, 과거 mismatch는 legacy/test data 또는 Console 직접 변경으로 분류합니다. production data를 임의 수정하거나 자동 repair/migration하지 않습니다.
- 일반 회원 상세에는 연결된 자녀·관리자 자녀 연결·자녀 연동 기록 DOM이 없습니다. 학부모 상세의 `연동 기록 보기`를 누르기 전에는 filter/meta/result를 숨기고 attempt read를 실행하지 않습니다. 클릭하면 해당 회원 UID 조건으로 최대 30건을 한 번 읽으며, 기본 실패 화면은 최대 3건, 전체 화면은 최대 5건을 같은 메모리 배열에서 표시합니다. `인증 요청 기록 보기`는 일반/학부모 모두 유지하며 정확한 이메일 조건으로 최대 20건을 읽고 10건까지 표시합니다. 이름·학교·학년·전화번호·관계와 한국어 결과를 먼저 확인하고, 문서 ID·UID·IP·cleanup 예정은 `상세 정보`를 펼쳐 확인합니다.
- `signupAttempts`는 인증번호 발송 요청 접수 기록이며 로그인 실패 기록이 아닙니다. `emailVerifications`는 code/hash가 포함된 전체 문서라 관리자 브라우저에서 조회하지 않습니다. 따라서 OTP code/session token/hash는 표시되지 않고 delivery/cooldown/OTP 실패의 완전한 원인도 추정하지 않습니다.
- Firebase Auth 로그인 실패는 현재 Firestore에 저장하지 않습니다. 새 trusted logging backend 없이 관리자 화면에 표시할 데이터가 없으며 client-side 실패 로그를 새로 만들지 않습니다.

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
- 강사·온라인 강좌·오프라인 반의 과목별 색상은 공용 `settings/subjectColors.subjectColorMap`에 저장됩니다. 세 관리 페이지 중 어느 곳에서든 목록을 저장하면 같은 과목명은 같은 색상을 유지하고 신규 과목명에만 기존에 사용하지 않은 색상이 자동 배정됩니다.
- 학원 브랜드 주황색 계열(`#fd7e14`, `#f68b1f`, `#ff7a00`)은 과목 색상에서 제외합니다. `약술형논술`의 기본 색상은 indigo `#6610f2`입니다.
- 공용 색상은 관리자 선택 목록과 카드, 공개 강사진 배지, 온라인 강좌 카드·상세 화면, 학생·강사 대시보드의 강좌/반 배지와 반 보기 화면에 적용됩니다. 직접 입력값은 페이지 기준값으로 저장되지 않는 한 색상 맵을 만들지 않으며, 레거시 `논술` 표기는 `수리논술` 색상을 사용합니다.
- 과목 색상은 Cloud Functions·스케줄러·외부 유료 API 없이 Firestore settings만 사용합니다. 화면은 카드별 조회를 하지 않고 브라우저 세션 동안 공용 색상 설정 1건을 재사용합니다.
- 기준값 저장 시 현재 페이지 settings 문서만 기본 저장하고, 신규 과목으로 공용 맵이 달라질 때만 `settings/subjectColors`를 함께 저장합니다. 다른 페이지 catalog의 교차 read/write나 매번 반복하는 legacy 정리는 하지 않습니다.
- 최초 전환 시 새 코드와 Firestore 규칙을 배포한 뒤 `npm run migrate:subject-colors`로 확인하고 `npm run migrate:subject-colors:write`로 공용 문서를 생성하며 기존 문서의 색상 잔재를 제거합니다.
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
- 온라인 강좌 관리의 모든 모달은 HTML 초기 상태에서 `hidden`이며, 페이지 최초 로드와 뒤로가기 캐시 복원 시 열린 상태와 `modal-open` 잔재를 초기화합니다. 삭제 버튼을 누르기 전에는 영구 삭제 확인창이 표시되지 않아야 합니다.
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

- 오프라인 반 과목·학년·학교 기준값은 `settings/offlineClassCatalog.groupCatalogs[groupId]`에 저장됩니다. 그룹 정의는 `settings/timetableCatalog.scheduleGroups`를 사용합니다.
- 기준값은 선택한 그룹 탭의 `groupCatalogs[groupId]`에만 저장됩니다.
- 각 반의 `groupId`로 그룹 탭 필터가 적용됩니다. `groupId` 없는 기존 반은 `regular`로 표시됩니다.
- 반별로만 필요한 직접 입력값은 해당 `offlineClasses` 문서에만 저장됩니다.
- 직접 입력값은 기준값 목록이나 필터 후보에 자동 추가되지 않습니다.
- 반 삭제 전 학생 배정, 회차, 접근 문서, 공개 시간표 항목을 확인합니다.
- 먼저 보관 상태로 전환한 뒤 삭제 여부를 판단하는 편이 안전합니다.
- 보관/다시 활성화 후 목록의 상태 배지가 바뀌는지 확인합니다.
- 반 학생 관리의 제거/다시 입반과 예외 권한 관리의 차단/다시 허용은 저장 후 목록을 다시 불러옵니다.
- 학생 배정 문서는 `offlineClassMembers/{classId}_{studentUid}` 형식을 사용합니다. 제거 시 배정 문서와 같은 반/학생의 예외 접근 문서를 함께 삭제하므로 학생 화면에서 반 정보가 즉시 제외됩니다.
- 관리자 학생 관리에서 학생의 이름·학교·학년·전화번호를 수정하면 기존 오프라인 반 배정 문서의 표시용 스냅샷도 같은 저장 작업으로 갱신됩니다. 저장 성공 후 반 학생 관리 창을 다시 열거나 목록을 다시 불러오면 수정된 정보가 표시됩니다.
- 오프라인 반과 반 학생 관리 화면의 숫자 학년 코드는 `1`~`7`을 각각 `중1`, `중2`, `중3`, `고1`, `고2`, `고3`, `졸업/N수`로 표시합니다. 학생 추가 검색은 이름·학교·학년·전화번호 뒷자리 4자리와 이들의 공백 조합을 지원합니다. 한 자리 `1`~`3`은 중·고 구분 없는 학년 차수이므로 `문일 2`는 문일중학교 중2와 문일고등학교 고2를 모두 찾습니다. `문일중 2`는 중학교로, `문일고 2`는 고등학교로 좁혀지며 `문일고2`처럼 붙여 쓸 수도 있습니다. 전화번호는 `이다현 7220`처럼 정확한 뒷자리 4자리로 검색합니다.
- 회차 예외 권한은 `offlineSessionAccess/{sessionId}_{studentUid}`에 저장합니다. `manualRevoke`는 해당 학생의 수업별 영상 목록에서 회차를 숨기고, `manualGrant`는 입반일 이전 회차도 표시할 때 사용합니다.
- 예외 권한이 없으면 게시 회차 중 `sessionDate`가 학생의 `joinedAt`과 같거나 이후인 회차를 기본 표시합니다.
- 작업에 실패하면 반 학생 관리 modal에서는 「여러 학생을 한 번에 선택할 수 있습니다.」 아래, 예외 권한 관리 modal에서는 「기본 권한을 바꿀 때만 수동 허용·차단을 사용하세요.」 아래의 원인과 오류 코드를 확인합니다.
- toast/status 알림은 modal을 포함한 관리 화면의 다른 레이어보다 위에 표시됩니다.

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
- 그룹별 기준값·시간표 이미지는 `settings/timetableCatalog.groupCatalogs[groupId]`에만 저장됩니다.
- `regular`/`winter`/`summer` 이미지는 각각 해당 그룹 `groupCatalogs`에만 있어야 합니다. 윈터에 정규 이미지가 섞여 보이면 시간표 이미지 관리에서 윈터 탭을 선택한 뒤 정규 항목을 삭제하고 저장하세요.
- 기준값 저장과 시간표 이미지 저장은 별도입니다. 기준값 저장은 과목/학년/학교/강의실만 바꾸고, 이미지는 ‘시간표 이미지 관리’에서 저장합니다.
- 저장 후 Firestore `updatedAt`/`updatedBy`와 선택 그룹의 `groupCatalogs.{그룹ID}`가 갱신됐는지 확인합니다.
- 수업 일정(`scheduleItems`)은 선택 입력이며 빈 배열 저장을 허용합니다.

주의:

- 시간표 그룹·학교급·이미지는 `settings/timetableCatalog`에 저장됩니다. 오프라인 반의 과목·학년·학교 목록은 `settings/offlineClassCatalog`에서 별도로 관리합니다.
- 기준값·이미지는 선택 그룹의 `groupCatalogs[groupId]`에만 저장됩니다.
- 시간표 그룹·학교급·이미지는 `settings/timetableCatalog`의 `scheduleGroups`, `scheduleDivisions`, `groupCatalogs[groupId].scheduleImages`로 구분합니다.
- 공개 `schedule.html`과 `/schedule-images/?group=`는 active 그룹과 저장된 이미지를 표시합니다.
- `publicTimetableEntries`는 deprecated cleanup-only 데이터이며 신규 생성·수정 또는 공개 source로 사용하지 않습니다.
- 공개 시간표 이미지는 오프라인 반의 실시간 동기화 화면이 아닙니다. 반 정보 변경 후 필요한 이미지를 별도로 갱신·확인합니다.

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

같은 화면의 사업자명·사업자번호·대표자·전화·주소·SNS URL은 `settings/footer`에 저장됩니다. 공개 footer는 비민감 설정을 브라우저 세션에서 최대 5분 재사용하고, 읽기 실패/문서 없음에는 배포된 정적 footer 문구를 유지합니다. 저장 직후 현재 관리자 탭의 cache는 무효화됩니다.

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
- 노출 페이지: 메인 홈, 학원 안내, 시간표, 상담 문의, 강사진, 온라인 강좌

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

- View the last daily cleanup timestamp and count-only summary.
- Confirm that the schedule remains daily at 03:00 Asia/Seoul.
- The page has no manual cleanup, offline-retention form, or offline session/access preview.

운영 방침:

- 기본 정리는 Cloud Functions `scheduledRecordCleanup`이 수행합니다.
- 자동 정리 스케줄은 매일 03:00 Asia/Seoul입니다.
- The scheduled Function performs three `cleanupAt <= now` queries, ordered by `cleanupAt` and limited to 500 documents per collection. It does not scan legacy documents without `cleanupAt`.
- Automatic targets are limited to `emailVerifications`, `signupAttempts`, and `memberChildLinkAttempts`. All prerequisite reads complete before deletion; a query failure aborts the run. Deletes require the scanned snapshot `updateTime`, so a resend/update between scan and commit aborts that batch instead of deleting the newer document.
- `offlineClassSessions` and `offlineSessionAccess` are protected learning and authorization history. Phase 2A removes the server helper and scheduled delete path while keeping the schedule at 03:00 Asia/Seoul.
- Historical offline-retention fields remain compatibility data only. The administrator page does not read, display, write, or activate them.
- Page entry reads only the cleanup summary document after the administrator role guard. It does not scan cleanup targets or offline history and does not write Firestore data.

정리 대상 정책:

| Collection | 수동/자동 정리 기준 |
| --- | --- |
| `emailVerifications` | Current writer sets `cleanupAt` 24 hours after the 5-minute expiry. The document remains the Rules proof for signup completion until that time |
| `signupAttempts` | Current local writer sets `cleanupAt` 1 day after an accepted send attempt and creates no new week-long block; historical documents retain their stored `cleanupAt` |
| `memberChildLinkAttempts` | Current local writer sets 7 days for failed/non-success attempts and 1 day for success/already-linked; preserve the actual `studentParentLinks` relationship |
| `offlineClassSessions` | Protected learning history; never an automatic target |
| `offlineSessionAccess` | Protected authorization history; never an automatic target |
| `operationTasks` | Legacy/unknown; never an automatic target |

오프라인 회차 정리 주의:

- The owner confirmed the Phase 2A Functions-only deployment. Historical offline-retention fields cannot trigger server deletion in that revision.
- Do not use production sessions to test cleanup behavior. The included unit tests use an in-memory Firestore double.
- Documents without `cleanupAt` are preserved. Their retention is unresolved until read-only inventory and dependency review are complete.
- In the three allowlisted transient collections, a stored `cleanupAt <= now` is sufficient for deletion. Do not reintroduce 30/90/180-day age gates that delay an already-due document.
- 반·입반·수강 등록·계정 정보는 삭제하지 않습니다.

주의:

- 삭제성 작업은 되돌리기 어렵습니다.
- 삭제 전 대상 collection, 개수, 조건을 확인합니다.
- `functions/record-cleanup.js` is the only scheduled cleanup policy implementation. The administrator preview is not an authorization to extend automatic deletion targets.
- Cloud Scheduler 비용은 job당 월 $0.10이고 결제 계정당 3 job 무료입니다. 현재 비용 리스크는 주로 Firestore read/delete입니다.
- 저장소 코드는 `scheduledRecordCleanup`의 `us-central1` 구성을 정의합니다. The owner confirmed the Phase 2A deployment and visible Firebase Console timestamp. This documentation task does not change or redeploy the Function.

### Phase 2A production verification

Phase 2A is `Verified`. The owner-reported manual production invocation completed `ok` without Function or missing-index errors, emitted count-only logs, did not target protected offline collections, and showed no unusual Firestore activity. The schedule remains fixed at 03:00 Asia/Seoul. See `docs/MAINTENANCE_LOG.md` for the timestamped verification record.

The removal of the obsolete offline-retention form and preview is `Deployed` as of the 2026-08-24 public static asset check. This proves the current HTML/JavaScript bundle is live, not that an authenticated administrator role flow is production-verified. The remaining smoke test is to sign in as an administrator and confirm the read-only last-run/no-history state, mobile layout, no write, and dashboard return link.

### 2026-08-24 가입·자녀 연동 운영 기준

- 인증번호 발송은 이메일별 rolling 1시간 5회를 primary limit로 사용합니다. 서버가 관찰한 IP는 공용 Wi-Fi/NAT 사용자를 고려해 1시간 30회의 보조 신호로만 사용하며, 일주일 고정 차단은 새로 만들지 않습니다.
- 새 `signupAttempts`는 1일, 새 자녀 연동 실패 기록은 7일, 성공/이미 연결 기록은 1일 후 정리 대상이 됩니다. 기존 문서는 기존 `cleanupAt`을 따르며 운영자가 콘솔에서 임의로 삭제하지 않습니다.
- `signupAttempts` document ID는 Firestore Auto ID를 유지합니다. 회원 상세의 명시적 버튼은 exact email로 최대 20건을 제한 조회한 뒤 `timestamp`로 local 정렬하고 10건까지 표시합니다. document ID와 IP는 각 카드의 `상세 정보`에만 표시합니다. IP 검색/서버 정렬 composite index는 추가하지 않았고 Auto ID lexical order를 시간순으로 간주하지 않습니다.
- `invalidInput`/`notFound`/`ambiguous` 자녀 연동 실패에는 관리자가 실제 입력과 불일치를 확인하도록 normalized 이름·학교·학년·digits-only 전체 전화번호·관계를 7일간 저장합니다. 새 `linked`/`alreadyLinked`도 같은 입력 5개 필드를 mismatch 없이 1일간 저장합니다. 계정/역할 선행 실패는 전체 입력값을 저장하지 않습니다. 이 collection은 admin-only read이며 확정 관계는 계속 `studentParentLinks`에 보존됩니다.
- 인증번호는 5분 동안 유효합니다. 새 발송은 이전 code/session을 교체하고 failed count를 reset합니다. 현재 페이지는 raw verification-session token을 메모리에만 보관하며, Firestore에는 hash만 저장합니다. `verifyEmailCode`는 transaction으로 session/만료/used/오답/성공을 갱신하고 5회 오답은 해당 session만 무효화합니다.
- 학생/회원 self-create Rules는 Auth email과 가입 유형에 맞는 최근 `verifiedAt` server proof를 요구합니다. `emailVerifications.cleanupAt`은 만료 24시간 후를 유지해 가입 완료 시간을 보장합니다.
- 위 signup 1일·session-token·profile proof 정책은 coordinated `4d1a83d1` rollout으로 static/기존 4개 Functions/Rules에 배포됐고 owner가 정상 production signup을 확인했습니다. 이후 `linkMemberChild`만 단독 재배포됐으며 새 성공 attempt의 submitted input/+1일 실문서 확인만 남아 있습니다. 기존 transient 문서는 migration/delete하지 않습니다.
- 향후 배포는 정적 Cloudflare Pages, 개별 Functions, Firestore Rules를 서로 다른 배포물로 취급하고 실제 변경된 대상만 배포합니다. 일반 `main` push는 Firebase를 배포하지 않으며 Function/Rules source가 바뀌지 않았다면 불필요한 Firebase deploy를 하지 않습니다.

### 2026-08-25 UI 배포/검증 상태

- 시간표 default closed, D-Day `D-N`, committed search와 list UI는 Cloudflare Pages production에 배포됐습니다. 관리자 primary table sticky header, 세로/가로 scroll 정렬, 회원 자녀 열과 주요 desktop/mobile table UX는 owner production smoke로 `Verified`입니다.
- 회원가입 인증번호 발송/검증과 profile create 결합은 production 배포 및 정상 signup smoke가 완료됐습니다. 진행 문구·중복 submit guard·20초 timeout·`finally` unlock은 regression test로 유지합니다.
- 관리자/공개 목록은 sparse last page에서 row/card가 늘어나지 않고, item range/total text 없이 공통 pagination 버튼만 사용합니다. 공개 강좌와 6개 관리자 primary list는 mobile에서 검색과 compact 10/20/50 select를 같은 행에 두고 `보기` label을 사용하지 않습니다. 강사 primary list는 검색/page-size만 유지하고 강좌 catalog 과목 add row는 목록 위에 있습니다. 학생/회원 학습 목록은 타이핑만으로 바뀌지 않고 Enter/돋보기로 loaded weeks를 필터링하며 빈 검색 commit은 전체를 복원합니다.

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
- `scheduledRecordCleanup` 실행 로그와 삭제 건수 확인
- 관리자 계정/권한 점검
- 오래된 팝업/강의/반 보관 처리
## 15. 강사 공개 개인정보 분리: 20건 원자적 이관 절차 (2026-10-19, 운영 적용 완료)

**상태:** 분리 JS, 임시·최종 Rules와 20건 이관을 운영에 적용했다. 적용 직후 `instructors` 20, `instructorAccounts` 20, `instructorPrivate` 20, `courses` 16, `offlineClasses` 79건이며 공개 내부 필드 0건이었다. 이후 운영자가 테스트 강좌를 하나 추가하고 기존 강좌 하나에도 강사를 배정해 재검증 시 `courses`는 17건, 강사 연결 강좌는 17건이다. 기존 계정·프로필과 강좌·반 참조는 유지된다. 실제 적용과 역할별 smoke 결과는 `docs/MAINTENANCE_LOG.md`의 2026-10-19 운영 전환 기록을 따른다.

### 실행 도구

`scripts/migrate-instructor-private.js`는 저장소에서 이미 사용하는 Firebase Admin SDK를 재사용하며 실행 시 권한 있는 Application Default Credentials가 필요하다. 서비스 계정 키·Storage·export·Function을 새로 만들지 않는다. `--project gritedu-lms`만 주면 50건 이하 페이지로 다섯 컬렉션을 읽는 **dry-run**이다. 공개 필드의 미분류 key, 원래 승인된 20/20/16/79 건수 변화, 계정 UID·프로필 ID·이메일 불일치, 중복 이메일, private 충돌·고아 문서가 있으면 쓰기 전에 중단한다. **현재 강좌는 17건이므로 이 일회성 도구의 기본 dry-run은 의도적으로 `EXPECTED_COUNT_CHANGED`에서 멈춘다. 추가 이관 필요성을 확인하지 않고 guard를 바꾸거나 재실행하지 않는다.** 출력은 건수·필드 존재 건수·상태 코드뿐이다.

운영 적용 호스트의 기존 Application Default Credentials로 dry-run과 이관을 실행했다. 신규 서비스 계정 키는 만들지 않았다.

승인된 `--project gritedu-lms --apply --confirm-count 20`을 한 차례 실행했다. 공개 강사 한 건씩 Firestore transaction 안에서 원본과 private·계정을 다시 읽고, **원래 값과 타입 그대로** private를 만들면서 같은 transaction에서 공개 문서의 `uid,email,emailLower,phone,note,pending` 중 실제 존재하는 필드만 제거했다. 공개 필드, 프로필 ID, 강좌·반 참조는 건드리지 않았다. Firestore는 20건 전체가 아닌 **강사별 한 건**의 원자성만 보장한다. 적용 뒤 20개 공개 필드 부재, private 20개, 계정 관계와 강좌·반 참조를 재조회했다. 이 절차는 향후 유사 이관의 참고용이며 현재 데이터에 재적용할 필요는 없다.

### 적용 순서와 중단 기준

1. 원본 `main`·분리 worktree diff, 정적 빌드와 Rules 파일을 고정한다. fixture·Secret은 배포/커밋 대상에서 제외한다. 관리자·강사 기능의 로컬 QA 기록은 `docs/ROLE_TEST_PLAN.md` §16–17을 재사용한다.
2. 현재 공개 쓰기 허용을 유지하면서 `instructorPrivate`만 admin-only로 추가한 **임시 Rules**를 먼저 배포한다. 관리자 private 읽기/쓰기 및 비관리자 거부를 확인한다. 실패하면 정적 배포와 이관을 시작하지 않는다.
3. 새 정적 JS를 Cloudflare Pages에 반영하고 관리자 강사 목록·상세·저장, CSV, 연결 상태와 강사 로그인 기준선을 확인한다. 관리자 강사 관리 탭을 모두 새로고침하고 새 버전임을 확인한다. 공개 내부 필드를 쓰는 구버전 탭이 남았다면 이관을 시작하지 않는다.
4. 강사 프로필·계정 관리 쓰기만 짧게 조정한다. `dry-run`에서 정확히 20개, 예상 필드·연결 관계·참조가 확인되어야 한다. 이 시점부터 최종 Rules 적용까지 새 강사 저장과 구버전 탭 사용을 피한다. 전체 CMS 중단은 요구하지 않는다.
5. 승인된 `--apply`를 실행한다. 강사별 transaction과 최종 재조회가 20/20 통과해야 한다. 한 건이라도 충돌·중단하면 완료 수와 남은 수만 기록하고 원인 확인 후 재실행한다. 일부 공개 문서의 노출은 최종 Rules 전까지 지속되므로 실행 창을 길게 열어두지 않는다.
6. 20/20 공개 문서에 내부 필드가 없는 것이 확인되면 최종 `firestore.rules`를 별도 배포한다. 이 Rules는 구버전 JS의 공개 내부 필드 재저장을 차단한다. **최종 Rules를 이관보다 먼저 배포하면 레거시 문서의 정상 관리자 수정이 거부되므로 금지한다.**
7. 비로그인 공개 강사진, 관리자 20건 목록·상세·수정·내부 정보·연결 상태, 기존 강사 로그인·담당 온라인 강좌·오프라인 반, 비관리자 private 읽기 거부를 운영에서 확인한다. 공개 문서 내부 필드 재유입이 0건인지 재조회한다. 강사 계정 생성·삭제를 smoke 목적으로 실행하지 않는다.

구버전 관리자 탭을 통제할 수 없다면 이관을 중단한다. 필요할 경우에만 §17 로컬 QA에서 검증한 bridge Rules를 별도 승인·배포해 재유입을 먼저 차단한다. 공개 개인정보를 다시 허용하는 Rules나 원본 공개 필드 복원으로 롤백하지 않는다. 새 JS 문제가 나면 먼저 강사 관리 쓰기를 멈추고 private/account 정합성을 확인해 해당 코드만 보완한다. Auth 생성 후 Firestore와 Auth 롤백까지 실패한 사례는 자동 재시도하지 않고 exact Auth 사용자와 세 문서의 존재를 관리자가 대조한 뒤 별도 승인 절차로 정리한다. 450건 초과 참조 정리도 기존 안전 제한에 따라 쓰기 전 중단한다.
