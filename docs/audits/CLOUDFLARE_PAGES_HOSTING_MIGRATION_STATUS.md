# Cloudflare Pages Hosting Migration Status

작성일: 2026-06-25
최종 갱신: 2026-07-03

## 1. 결론

현재 프로젝트는 Firebase 전체 이전이 아니라 **Cloudflare Pages 정적 Hosting + Firebase backend + Cloudflare R2 public asset 계층**으로 분리하는 구조다.

2026-07-03에 `terms.html`의 이용약관 및 회원가입 동의 요약은 사용자용으로 간결화하고, 개인정보처리방침 전문에는 이 구조에서 발생할 수 있는 위탁/국외이전/자동수집 항목을 사용자용 표현으로 유지했다.

| 영역 | 운영 기준 |
| --- | --- |
| 정적 Hosting | Cloudflare Pages |
| 대표 운영 도메인 | `https://gritedu.kr` |
| Pages 기본 도메인 | `https://gritedu.pages.dev` -> `https://gritedu.kr` 301 redirect 완료 |
| Firebase Auth | 유지 |
| Firestore | 유지 |
| Firebase Functions | 유지 |
| Firebase Hosting | disable 완료; old URL 404 유지 |
| 공개 이미지 계층 | Cloudflare R2 `https://assets.gritedu.kr` |

Cloudflare Pages로 Hosting을 옮겨도 Firebase Auth/Firestore/Functions는 기존 Firebase project `gritedu-lms`를 계속 사용한다. Firestore rules와 Functions 코드는 이번 Hosting 이전의 변경 대상이 아니다. Firebase Hosting은 disable 완료 상태이며 fallback/redirect 용도로도 사용하지 않는다.

운영자 확인 필요: Cloudflare/Google 공식 DPA와 개인정보 문서를 기준으로 국외이전 세부 국가, 연락처, 보유기간을 확정해야 한다. `LEGAL_POLICY_VERSION`은 Firestore rules와 함께 관리해야 하며, 이번 정책 문구 수정에서는 rules 변경 금지로 기존 `2026-06-12` 값을 유지했다.

## 2. Cloudflare Pages 설정

| 항목 | 값 |
| --- | --- |
| Pages project | `gritedu` |
| GitHub repository | `gritedu/gritedu.github.io` |
| Production branch | `main` |
| Build command | `npm run prebuild` |
| Build output directory | `dist` |
| Root directory | repo root |
| Environment | `NODE_VERSION=22` |
| Auto deploy | enabled |

현재 사이트는 `dist` 기반 multi-page HTML 구조다. SPA fallback rewrite는 필요하지 않다. `/members/...`, `/courses.html`, `/course-detail.html`처럼 실제 HTML 파일을 직접 제공하는 방식이다.

GitHub `main` push가 발생하면 Cloudflare Pages가 자동으로 `npm run prebuild`를 실행하고 `dist`를 배포한다. 일반 운영 배포에서 `npm run deploy` 또는 `firebase deploy --only hosting`은 사용하지 않는다.

## 3. DNS/custom domain 상태

| 이름 | 상태 | 판단 |
| --- | --- | --- |
| `gritedu.kr` | Cloudflare Pages custom domain | 대표 운영 도메인 |
| `gritedu.pages.dev` | `https://gritedu.kr` 301 redirect 완료 | path/query 보존 확인 완료 |
| `assets.gritedu.kr` | R2 public bucket custom domain | 공개 이미지 운영 도메인 |
| `www.gritedu.kr` | `https://gritedu.kr` 301 redirect 완료 | path/query 보존 확인 완료 |
| Cloudflare Pages deployment alias | 하위 도메인 포함 `https://gritedu.kr` 301 redirect 완료 | path/query 보존 확인 완료 |
| Firebase TXT records | 일부 유지 가능 | 과거 Firebase Hosting 검증 흔적 |

Cloudflare Pages 대표 도메인은 `gritedu.kr` 하나로 확정한다. `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 모두 `https://gritedu.kr`로 301 redirect되며 path/query 보존 확인이 완료되었다.

## 4. Firebase 연동 상태

Firebase config:

- `projectId`: `gritedu-lms`
- `authDomain`: `gritedu-lms.firebaseapp.com`

Auth Authorized domains에 필요한 도메인:

- `localhost`
- `gritedu-lms.firebaseapp.com`
- `gritedu-lms.web.app`
- `gritedu.pages.dev`
- `gritedu.kr`
- `www.gritedu.kr` (301 redirect 완료 상태. 기존 등록은 호환성 차원에서 유지 가능)

Functions 호출 방식:

- `getFunctions(app, "us-central1")`
- `httpsCallable`
- 확인 대상: `sendVerificationCode`, `verifyEmailCode`, `linkMemberChild`

Firestore rules는 `request.auth`와 문서 권한 기준이다. host/domain 의존 rules는 확인되지 않았다.

## 5. Cloudflare Pages 산출물 정책

Cloudflare Pages는 `firebase.json`의 Hosting headers를 읽지 않는다. 따라서 `dist/_headers`를 생성해 Pages cache/header 정책을 적용한다.

`prebuild` 산출물에 포함해야 하는 공개 파일:

- HTML/CSS/JS
- `assets/**`
- `assets/school.csv`
- `version.json`
- `_headers`
- `robots.txt`
- `sitemap.xml`
- Google/Naver 소유 확인 HTML

`dist`에 포함하지 않을 운영 파일:

- `firestore.rules`
- `firebase.json`
- `.firebaserc`
- `storage.rules`
- `serviceAccountKey.json`
- `scripts/**`
- `functions/**`
- `node_modules/**`

2026-06-25/2026-06-29 조정:

- `scripts/prebuild.js`는 `version.json`과 Cloudflare Pages `_headers`를 생성한다.
- `scripts/prebuild.js`는 `dist` 안의 운영 파일 노출 후보를 제거한다.
- `scripts/verify-build.js`는 `_headers`, `version.json`을 필수 산출물로 검사한다.
- `scripts/verify-build.js`는 `firestore.rules`, `firebase.json`, `.firebaserc`, `storage.rules` 등이 `dist`에 있으면 실패 처리한다.

## 6. Firebase Hosting disable 상태

Firebase Hosting은 `firebase hosting:disable` 완료 상태다.

확정 상태:

- `https://gritedu-lms.web.app/`는 curl 기준 404 확인 완료 상태다.
- `https://gritedu-lms.firebaseapp.com/`는 curl 기준 404 확인 완료 상태다.
- Firebase Hosting은 더 이상 fallback/redirect 용도로도 사용하지 않는다.
- Firebase Hosting old URL을 `https://gritedu.kr`로 301 redirect하는 작업은 하지 않는다.
- Firebase Hosting redirect-only 전환안은 미채택/폐기 상태다.

주의:

- `npm run deploy` 또는 `firebase deploy --only hosting`은 일반 운영에서 사용하지 않는다.
- `firebase.json`을 redirect-only Hosting 설정으로 변경하지 않는다.
- Functions 배포와 Firestore rules 배포는 Firebase CLI를 계속 사용할 수 있지만 Hosting deploy와 구분한다.
- Firebase Auth/Firestore/Functions 코드는 Hosting disable과 무관하게 계속 Firebase에서 운영한다.

검색엔진 처리:

- old `gritedu-lms.web.app` Search Console 속성은 임시 삭제 요청 처리 상태 확인용으로 유지한다.
- old URL은 임시 삭제 요청 처리 중이다.
- old URL은 404를 유지해 색인 제거를 유도한다.
- `gritedu.kr` 속성에는 `https://gritedu.kr/sitemap.xml` 제출이 완료되었다.
- sitemap에서 발견된 페이지는 6개이며, 주요 URL은 페이지 색인 생성됨 상태로 확인했다.
- Naver Search Advisor old 도메인 검색 제외 요청은 완료되었다.
- `gritedu.online`은 검색 제외 처리 후 재확인 대상이다.

## 7. R2 public asset 상태

운영 기준:

- Bucket: `gritedu-public-assets`
- Public custom domain: `https://assets.gritedu.kr`
- Legacy public URL: `https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev`

현재 신규 R2 public prefix:

- `public/popup/`
- `public/instructors/profile/`
- `public/instructors/image/`
- `public/story/`
- `public/pages/story/`

legacy read-only (과거 데이터 호환, 신규 CMS 입력/placeholder 금지):

- `public/instructors/curriculum/`

원칙:

- 신규 CMS 입력은 `assets.gritedu.kr` URL을 우선한다.
- 기존 `r2.dev` URL은 과도기 호환으로 유지할 수 있다.
- R2 이미지 로딩 QA는 2026-06-29 기준 완료되었다.
- 학생별 자료, 리포트, 성적표, 과제, 내부 운영 파일은 public R2 금지다.
- private 파일은 별도 R2 private + signed URL + 권한 확인 + 다운로드 로그 설계 후 진행한다.

## 8. QA 상태

완료:

- Firebase Hosting old URL curl 404 확인: `https://gritedu-lms.web.app/`, `https://gritedu-lms.firebaseapp.com/`
- `www.gritedu.kr` -> `https://gritedu.kr` 301 redirect 확인
- `gritedu.pages.dev` -> `https://gritedu.kr` 301 redirect 확인
- Cloudflare Pages deployment alias 하위 도메인 포함 `https://gritedu.kr` 301 redirect 확인
- Cloudflare redirect path/query 보존 확인
- R2 image loading QA: `assets.gritedu.kr` 기반 popup/instructor/Story 이미지 표시
- `gritedu.kr` 기준 회원가입 QA 1차
- Google Search Console `gritedu.kr` sitemap 제출 및 발견 페이지 6개 확인
- Naver Search Advisor old 도메인 검색 제외 요청

남은 QA:

- Cloudflare Pages `_headers` live response 확인
- forbidden URL live response 확인: `/firestore.rules`, `/firebase.json`, `/.firebaserc`, `/storage.rules`
- 관리자 CMS 주요 화면 QA
- 모바일/iPhone/KakaoTalk 환경 QA
- `gritedu.online` 검색 제외 처리 후 재확인

## 9. 배포 운영 기준

일반 배포:

1. `npm run prebuild`
2. `npm run verify`
3. `git diff --check`
4. `git status`
5. commit
6. `git push origin main`
7. Cloudflare Pages 자동 배포 확인
8. `gritedu.kr` QA

금지/분리:

- Firebase Auth/Firestore/Functions 기능 코드 임의 변경 금지
- Firestore rules 정책 변경 금지
- `npm run deploy` 또는 `firebase deploy --only hosting` 일반 운영 금지
- Firebase Hosting redirect 설정 추가 금지
- `firebase.json` redirect-only 변경 금지
- Cloudflare deploy/DNS 직접 변경 금지
- PWA/service worker 추가 금지
- 대규모 CSS 리팩토링 금지

## 10. 현재 리스크

- Cloudflare Pages `_headers`가 운영 배포에서 의도대로 적용되는지 실제 response header QA가 필요하다.
- forbidden URL이 live에서 노출되지 않는지 실제 response QA가 필요하다.
- `gritedu.online`은 검색 제외 처리 후 재확인 대상이다.
- Cloudflare redirect rule이 `www.gritedu.kr`, `gritedu.pages.dev`, deployment alias에서 path/query 보존을 계속 유지하는지 정기 확인이 필요하다.
- R2 CORS/URL whitelist는 대표 운영 도메인 `gritedu.kr`와 로컬 테스트 도메인을 기준으로 재확인해야 한다.
- `assets.gritedu.kr`와 legacy `r2.dev` URL이 과도기적으로 섞일 수 있다.
- Cloudflare Pages 자동 배포는 GitHub `main` 기준이므로 로컬 미커밋 변경은 운영에 반영되지 않는다.
