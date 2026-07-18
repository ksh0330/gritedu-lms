# Hosting Cache and Download Audit

작성일: 2026-06-23

## 1. Executive Summary

### 2026-06-29 Current Status

현재 운영 Hosting은 Cloudflare Pages이며 Firebase Hosting은 `firebase hosting:disable` 완료 상태다. `https://gritedu-lms.web.app/`와 `https://gritedu-lms.firebaseapp.com/`은 curl 기준 404 확인 완료이고 fallback/redirect 용도로 사용하지 않는다.

`npm run prebuild`는 Cloudflare Pages용 `dist/_headers`와 `dist/version.json`을 생성하며, `scripts/verify-build.js`는 `_headers`, `version.json`, 금지 파일 노출을 검사한다. Firebase Hosting download 관찰값은 Cloudflare Pages 전환 전후의 참고 기록으로만 본다.

R2 이미지 로딩 QA와 `gritedu.kr` 회원가입 QA 1차는 완료되었다. 남은 live QA는 Cloudflare Pages `_headers`, forbidden URL, 관리자 CMS, 모바일/iPhone/KakaoTalk 확인이다.

### 2026-06-24 Current Status

로컬 소스 및 prebuild/verify 기준으로 Phase D-1, Phase D-2, Phase D-3 구현은 완료 상태다. 운영 배포 및 운영 URL header/Network QA는 별도 확인이 필요하다.

- Phase D-1: generated `dist/assets/js/**/*.js` local static import/export, side-effect import, dynamic import specifier에 build version query 적용.
- Phase D-2: `/assets/partials/*.html` fetch에 build version query 적용, `/version.json` no-store 유지.
- Phase D-3: `school.csv` fetch/cache 정리, public image `Date.now()`/render timestamp cache-buster 제거, root `/` cache normalization 구현.
- JS/CSS cache header는 아직 `no-cache, must-revalidate`를 유지하며 long cache 또는 짧은 완화는 적용하지 않았다.
- 이전 운영 URL HEAD에서 root `/`가 `max-age=3600`으로 관찰된 기록은 배포 전/이전 배포 상태일 수 있으므로, 배포 후 `/`, `/index.html`, `/version.json`, `/assets/school.csv` header를 다시 확인해야 한다.

남은 gap은 JS/CSS cache header 짧은 완화 검토, 큰 asset/CSS/JS 중복 정리, `main.css` 크기 검토, `school.csv` 운영 Network 중복 요청 확인, 배포 후 version prompt/Hosting download 사용량 관찰이다.

Firebase Hosting 다운로드 증가는 단일 원인보다 여러 요인이 겹친 결과로 보는 것이 안전하다. 현재 설정은 HTML, JS, CSS를 `no-cache` 계열로 두어 새 배포 반영 안정성을 우선하고, 이미지/폰트는 긴 immutable cache를 준다. 이 방향은 stale JS/CSS를 막는 데는 안전하지만, 반복 QA, DevTools Disable cache, version prompt 이후 reload, 관리자 화면 반복 테스트가 많으면 Hosting 다운로드 관찰값을 빠르게 올릴 수 있다.

중요한 확인 결과는 다음과 같다.

- `prebuild.js`는 `dist` HTML에 `grit-build-version` meta와 CSS/JS top-level URL `?v={buildVersion}`를 넣는다.
- CSS/JS 파일명 자체는 hash로 바뀌지 않는다. 예: `assets/css/main.css`, `assets/js/pages/home-popup.js`.
- `dist/version.json`은 생성되며, `assets/js/common.js`가 `/version.json`을 `cache: "no-store"`로 확인한다.
- 새 버전 prompt는 일반 `window.location.reload()`만 호출한다. `location.reload(true)`, service worker, `skipWaiting` 기반 hard refresh 흐름은 없다.
- `firebase.json` 기준 JS/CSS가 `no-cache, must-revalidate`라서 현재 stale JS/CSS 위험은 낮다. 대신 매 방문/재검증 요청이 늘어날 수 있다.
- 실제 HEAD 요청에서 `/index.html`은 `no-cache`, `/version.json`은 `no-store`, JS/CSS는 `no-cache`, 이미지와 `school.csv`는 설정과 일치했다.
- 단, 루트 `/` 응답은 `Cache-Control: max-age=3600`으로 관찰됐다. 홈을 `/`로 방문하는 사용자에게는 HTML 갱신이 최대 1시간 늦어질 수 있는 후보이며, `**/*.html` header가 `/` 경로에는 직접 적용되지 않는 것으로 보인다.
- 일부 강사 이미지 렌더링은 `Date.now()` 기반 `?v=` cache-buster를 붙인다. 로컬 `/assets/instructors/profile/*` 이미지에는 브라우저 cache를 사실상 매 렌더마다 우회시켜 Hosting 다운로드를 늘릴 수 있다. R2 이미지에도 쿼리가 붙으면 R2 cache 효율이 떨어질 수 있다.
- R2 public 전환은 popup, instructor profile, instructor curriculum 같은 mutable public image 트래픽을 Firebase Hosting에서 분리하는 데 효과가 있다. 그러나 HTML, JS, CSS, Firebase SDK module, fonts, school CSV, PDF, fixed static assets는 여전히 Hosting 또는 외부 CDN 로딩 대상이다.

추천은 **Option B. JS/CSS build version query string 자동 부여**를 현재 방향으로 유지하되, 다음 구현에서는 top-level HTML 참조뿐 아니라 ES module 내부 import, dynamic import, partial fetch까지 versioning 범위를 완성한 뒤 cache header를 조정하는 것이다. 단순히 지금 `firebase.json`에서 JS/CSS cache만 늘리면 내부 module import가 stale해질 수 있다.

이 감사의 실행 계획과 운영 gate는 `docs/audits/CACHE_VERSIONING_OPERATIONS_PLAN.md`를 master plan으로 삼는다. 요약 순서는 Phase 1 version coverage audit, Phase 2 coverage fix, Phase 3 root/HTML cache normalization, Phase 4 JS/CSS cache header relaxation, Phase 5 image cache-buster cleanup이다. CMS 데이터 변경은 Hosting 정적 파일 cache 문제가 아니므로 Firestore 저장/읽기/local cache 기준으로 별도 판단한다.

Version coverage 정밀 점검은 `docs/audits/VERSION_COVERAGE_AUDIT.md`에 분리했다. 해당 감사 기준으로 top-level HTML JS/CSS는 versioned 상태지만 ES module import, dynamic import, partial fetch gap이 남아 있으므로 JS/CSS cache header 완화는 아직 진행하지 않는다.

## 2. Current Firebase Usage Snapshot

아래 값은 사용자가 제공한 특정 시점의 Firebase Console 관찰값이며, 청구 확정값이 아니다. Console의 일별 그래프와 무료 한도 표시는 지연/집계 방식에 따라 실제 청구 리포트와 다를 수 있다.

- Hosting storage: 56.5MB / 10GB
- Hosting download: 120.7MB / 360MB per day
- Firestore reads: about 4k / 50k per day
- Firestore writes: about 10 / 20k per day
- Functions calls: 106 / 2M per month

이 감사 작성 당시 가장 민감한 관찰 항목은 Firebase Hosting download였다. 현재 운영 기준에서는 Cloudflare Pages/R2 트래픽, Firebase Hosting old URL 404 유지 여부, Firestore/Functions 사용량을 분리해서 본다.

## 3. Current Hosting Cache Policy

아래는 Firebase Hosting 운영 시점의 `firebase.json` cache header 기록이다. 현재 운영 배포는 Cloudflare Pages가 `dist/_headers`를 사용하므로 live header QA는 Cloudflare Pages 응답 기준으로 수행한다.

| Path Pattern | Cache-Control | Intended Effect | Risk |
| --- | --- | --- | --- |
| `sitemap.xml` | `no-cache` | 검색엔진용 sitemap 갱신 반영 | 다운로드 영향은 작음 |
| `robots.txt` | `no-cache` | 검색엔진 정책 갱신 반영 | 다운로드 영향은 작음 |
| `version.json` | `no-cache, no-store, must-revalidate` | 배포 버전 확인을 항상 최신으로 유지 | `common.js`가 focus/visibility마다 확인하므로 요청 수는 늘 수 있음 |
| `assets/**/*.js` | `no-cache, must-revalidate` | stale JS 방지 | 매 방문/재검증으로 JS 다운로드 또는 304 요청이 늘 수 있음 |
| `assets/**/*.css` | `no-cache, must-revalidate` | stale CSS 방지 | `main.css`가 약 263KB라 반복 QA에서 민감할 수 있음 |
| `assets/**/*.@(png|jpg|jpeg|gif|webp|svg)` | `public,max-age=31536000,immutable` | 이미지 장기 cache | 같은 파일명 교체 시 stale image 위험. `Date.now()` query가 붙으면 browser cache 이점이 줄어듦 |
| `assets/**/*.webp` | `public,max-age=31536000,immutable` | WebP content-type/cache 명시 | 위 이미지 정책과 동일 |
| `assets/**/*.@(csv|pdf)` | `public,max-age=86400` | CSV/PDF 1일 cache | `school.csv`가 약 1MB라 최초/만료 후 다운로드가 큼 |
| `**/*.woff2` | `public,max-age=31536000,immutable` | 폰트 장기 cache | 로컬 폰트가 추가될 경우 versioned filename 필요 |
| `**/*.woff` | `public,max-age=31536000,immutable` | 폰트 장기 cache | 위와 같음 |
| `**/*.html` | `no-cache, must-revalidate` | HTML 재검증으로 새 배포 감지 | `/index.html`에는 적용되지만 `/`에는 적용되지 않는 것으로 HEAD에서 관찰됨 |
| `assets/partials/**/*.html` | `no-cache, must-revalidate` | header/footer partial 갱신 반영 | partial fetch가 많으면 재검증 요청 증가 |

실제 HEAD 확인은 2026-06-23 15:17 KST 전후에 수행했다.

| URL | Observed Status | Observed Cache-Control | Notes |
| --- | --- | --- | --- |
| `https://gritedu-lms.web.app/` | 200 | `max-age=3600` | `/index.html`과 달리 root path는 기본 1시간 cache로 관찰됨 |
| `https://gritedu-lms.web.app/index.html` | 200 | `no-cache, must-revalidate` | `**/*.html` header 적용 |
| `https://gritedu-lms.web.app/assets/css/pages/home.css` | 404 | `no-cache, must-revalidate` | 현재 배포 산출물은 page CSS를 `main.css`로 bundle하므로 요청 대상 파일은 없음 |
| `https://gritedu-lms.web.app/assets/css/main.css` | 200 | `no-cache, must-revalidate` | 실제 배포 CSS |
| `https://gritedu-lms.web.app/assets/js/pages/home-popup.js` | 200 | `no-cache, must-revalidate` | 설정과 일치 |
| `https://gritedu-lms.web.app/assets/main.webp` | 200 | `public,max-age=31536000,immutable` | 설정과 일치 |
| `https://gritedu-lms.web.app/assets/school.csv` | 200 | `public,max-age=86400` | 약 1.0MB |
| `https://gritedu-lms.web.app/version.json` | 200 | `no-cache, no-store, must-revalidate` | 설정과 일치 |

`.firebaserc`는 현재 저장소 루트에서 확인되지 않았다. 이 감사는 `firebase.json`, `dist`, 실제 HEAD 응답을 기준으로 작성했다.

## 4. Current Build / Versioning Flow

현재 build entrypoint는 `package.json`의 `npm run prebuild`, 즉 `node scripts/prebuild.js`다. 이번 감사에서는 build를 실행하지 않고 기존 source와 `dist`만 읽었다.

현재 흐름:

- `scripts/prebuild.js`가 `dist`를 초기화한 뒤 CSS/JS minify, assets copy/image optimization, runtime WebP 보장, HTML 처리, `version.json`, `build-report.json` 생성을 수행한다.
- `dist/assets/css/main.css`가 생성된다. source의 개별 page CSS 링크는 HTML 처리 중 제거되고 main bundle 중심으로 정리된다.
- JS 파일은 파일명 hash 없이 기존 경로 구조로 minify/copy된다. 예: `dist/assets/js/pages/admin-site.js`.
- 이미지 원본 PNG/JPG는 WebP 출력이 우선이며, root logo/favicon/theme asset과 instructor profile image는 정책상 원본 보존 대상이다.
- `assets/main.png`와 `assets/banner_main.png`는 runtime에서 `main.webp`, `banner_main.webp`로 치환된다.
- `dist/version.json`에는 `version`, `timestamp`, `buildDate`가 저장된다. 현재 확인된 dist version은 `20260622-215748`이다.
- `dist/build-report.json`에는 build version, warning, image validation, large image, skipped original 정보가 저장된다. 현재 report에는 fatal warning이 없고, `largeDistImages`도 비어 있다.

`applyVersionToHTML()`의 version 처리:

- 기존 `[?&]v=...`를 제거한다.
- HTML `<head>`에 `<meta name="grit-build-version" content="{version}" />`를 넣는다.
- CSS link `href="/assets/css/...css"`에 `?v={version}`를 붙인다.
- JS script `src="/assets/js/...js"`에 `?v={version}`를 붙인다.
- CSS/JS preload href에도 `?v={version}`를 붙인다.
- 일부 literal partial fetch에는 `?v={version}`를 붙이는 로직이 있다.

현재 한계:

- CSS/JS 파일명 자체는 배포마다 바뀌지 않는다.
- HTML에 직접 있는 top-level `script src`와 `link href`에는 `?v=`가 붙지만, `dist/assets/js/**/*.js` 내부의 ES module import specifier는 여전히 `/assets/js/...` 형태다.
- 예: `dist/assets/js/common.js`는 `import"/assets/js/utils/toast.js"`와 `from"/assets/js/firebase-init.js"`를 사용한다.
- dynamic import도 source 기준 `/assets/js/...` 형태가 남아 있다.
- `common.js`의 template literal partial fetch `fetch(\`/assets/partials/${type}.html\`)`에는 build version query가 붙지 않는다. 현재 partial header가 `no-cache`라 안전하지만, partial을 장기 cache로 바꾸려면 별도 처리해야 한다.

R2 URL 처리:

- `prebuild.js`의 asset reference scan은 `/assets/...`를 포함한 이미지 참조만 local asset으로 검사한다.
- 코드 주석상 R2 public HTTPS URL(`public/popup/`, `public/instructors/...`)은 여기에서 scan하지 않는다.
- 원격 URL path에 `/assets/` segment가 있으면 local asset으로 오판할 수 있으므로, 기존 R2 문서와 동일하게 R2 key에는 `/assets/`를 넣지 않는 정책이 맞다.

결론: 현재 배포 버전 전략은 이미 Option B의 기본 형태를 갖고 있다. 다만 JS/CSS cache header를 길게 늘리려면 내부 module import까지 versioning을 확장하거나, 파일명 hash 방식으로 넘어가야 한다.

## 5. Current Refresh / Update Prompt Flow

새 버전 감지는 `assets/js/common.js`에 있다.

동작 흐름:

- `prebuild.js`가 각 HTML에 `grit-build-version` meta를 주입한다.
- `common.js`는 현재 HTML meta version과 `/version.json`의 server version을 비교한다.
- `/version.json` 요청은 `fetch(VERSION_CHECK_URL, { cache: "no-store" })`로 수행된다.
- 최초 로드 시 `checkForVersionUpdate({ force: true })`가 실행된다.
- 이후 `visibilitychange`에서 문서가 visible이 될 때, 그리고 `window focus` 때 다시 확인한다.
- 반복 확인 간격은 `VERSION_RECHECK_INTERVAL_MS = 60 * 1000`이다.
- mismatch가 있으면 화면 하단에 “새 버전이 적용되었습니다. 새로고침 후 이용해 주세요.” prompt를 띄운다.
- 버튼 텍스트는 “새로고침”이고, 클릭 시 `window.location.reload()`를 호출한다.

확인된 사항:

- `location.reload(true)`는 사용하지 않는다.
- `forceReload`, `hard reload`, service worker, `skipWaiting`, `sw.js` 기반 update flow는 현재 프로젝트 source에 없다.
- 관리자 화면에는 수동 목록/페이지 새로고침 버튼이 여러 개 있다. 대부분 `location.reload()` 또는 화면 데이터 reload 용도다.
- `assets/js/utils/error-handler.js`도 오류 UI에서 일반 `window.location.reload()` 버튼을 만들 수 있다.

다운로드 영향:

- 현재 prompt 자체는 자동 reload가 아니라 사용자가 누르는 일반 reload다.
- 다만 배포 직후 여러 사용자가 prompt를 보고 reload하면 HTML, JS/CSS 재검증과 일부 assets 요청이 동시에 늘 수 있다.
- DevTools Disable cache 또는 hard refresh를 운영 안내로 반복하면 `no-cache` JS/CSS와 이미지 cache-buster 영향이 커진다.
- 일반 사용자에게 “강력 새로고침”을 기본 안내하는 것은 Hosting download 관점에서 피하는 것이 좋다.

축소 가능성:

- 일반 사용자에게는 현재처럼 “새 버전이 있습니다. 새로고침” 정도의 일반 reload만 제공한다.
- 관리자/개발자용 운영 매뉴얼에서만 강력 새로고침을 예외적 문제 해결 절차로 둔다.
- version check 빈도는 현재 60초라 민감하다. 운영 규모가 커지면 5분 이상으로 늘리거나, visibility/focus 시에만 throttled check하는 방식을 검토할 수 있다.

## 6. Largest Local / Dist Assets

`assets` 전체는 약 15.10MB, `dist` 전체는 약 5.84MB로 확인됐다. 아래 표는 source와 dist에서 Hosting download 또는 build size에 의미가 큰 후보를 정리한 것이다.

| Size | File | Type | Current Source | Recommendation |
| --- | --- | --- | --- | --- |
| 1.85MB source / 79KB dist | `assets/main.png` -> `dist/assets/main.webp` | hero image | local fixed asset | 현재 WebP 변환 효과가 좋음. fixed asset으로 local 유지 |
| 1.85MB source / 79KB dist | `assets/popup/main.png` -> `dist/assets/popup/main.webp` | popup fallback image | local mutable/fallback | 새 운영 이미지는 R2 public key 사용, local fallback은 rollback용 |
| 1.51MB source / 91.6KB dist | `assets/banner_main.png` -> `dist/assets/banner_main.webp` | OG/banner image | local fixed asset | local 유지, 같은 파일명 교체 시 배포/cache QA 필요 |
| 1.51MB source / 91.6KB dist | `assets/popup/banner_main.png` -> `dist/assets/popup/banner_main.webp` | popup fallback image | local mutable/fallback | 가능하면 R2 public 전환 |
| 1.0MB | `dist/assets/school.csv` | CSV | local public asset | 1일 cache. 회원가입/학교 검색 로딩 방식이 다운로드 관점의 후보 |
| 262.6KB | `dist/assets/css/main.css` | CSS | bundled local CSS | JS/CSS versioning 완성 후 cache header 완화 후보 |
| 172KB | `dist/assets/footer/fee.pdf` | PDF | 2026-07-18 이전 historical asset | 현재 공개 페이지는 `settings/tuitionImages`의 R2 이미지 사용 |
| 69.7KB | `dist/assets/footer/refund.pdf` | PDF | 2026-07-18 이전 historical asset | 현재 공개 페이지에서 미사용 |
| 47.5KB | `dist/assets/footer/aca.pdf` | PDF | 2026-07-18 이전 historical asset | 현재 공개 페이지에서 미사용 |
| 127.7KB | `dist/assets/instructors/profile/KJY_profile.png` | instructor profile | local public profile image | R2 profile URL로 점진 전환. 현재 profile cache-buster 제거 검토 |
| 124.7KB | `dist/assets/instructors/profile/OJS_profile.png` | instructor profile | local public profile image | 위와 같음 |
| 117.4KB | `dist/assets/instructors/curriculum/fg.webp` | instructor curriculum | local public curriculum image | R2 curriculum URL 전환 후보 |
| 100.6KB | `dist/assets/popup/open.webp` | popup image | local popup fallback | R2 public URL 사용 권장 |
| 94.7KB | `dist/assets/popup/6_21.webp` | popup image | local popup fallback | R2 public URL 사용 권장 |
| 80.9KB | `dist/assets/js/pages/admin-site.js` | admin JS | local app code | admin site page에서만 로드되므로 범위는 적절. no-cache로 반복 QA 시 다운로드 민감 |
| 57.0KB | `dist/assets/js/pages/admin-user-add.js` | admin JS | local app code | admin only. 기능별 split은 별도 성능 감사 대상 |
| 52.5KB | `dist/assets/js/pages/admin-instructors.js` | admin JS | local app code | admin only. 이미지 preview와 R2 검증 흐름 주의 |
| 50.7KB | `dist/assets/js/pages/admin-popup.js` | admin JS | local app code | admin only. 반복 테스트 시 다운로드 후보 |

`dist/build-report.json` 기준으로 fatal missing reference는 없고, `largeDistImages`도 비어 있다. 따라서 가장 큰 원본 PNG 자체가 그대로 배포되는 문제보다는, `school.csv`, `main.css`, admin JS, instructor profile PNG, popup fallback WebP, cache-buster/reload 패턴이 더 실질적인 다운로드 후보다.

## 7. Page-Level Download Risk

정확한 브라우저 waterfall 측정은 이번 범위에서 수행하지 않았고, source/dist 기준 추정이다.

| Page | Likely Heavy Assets | Risk | Notes |
| --- | --- | --- | --- |
| home | `main.css`, `firebase-init.js`, `common.js`, `home-instructors.js`, `home-popup.js`, `page-content.js`, `main.webp`, popup/instructor images | Medium to High | 홈은 진입 빈도가 높다. `/`가 `max-age=3600`으로 관찰됐고, instructor profile image cache-buster가 있으면 반복 다운로드 후보 |
| courses | `main.css`, `courses.js`, Firebase SDK, course catalog/settings reads | Low to Medium | 큰 local image는 적음. JS/CSS no-cache 반복 QA 영향 |
| course detail | `main.css`, `course-detail.js`, Firebase SDK, instructor avatar, video embed/preview | Medium | 영상은 외부 URL 중심이나, 강사 avatar local fallback 가능 |
| instructors | `main.css`, `instructors.js`, Firebase SDK, multiple instructor profile images | High | `Date.now()` query cache-buster가 profile image cache를 약화 |
| instructor detail | `main.css`, `instructor-details.js`, profile image, curriculum images | High | profile image에 매 load `Date.now()` query. curriculum images도 page content에 따라 다운로드 가능 |
| schedule | `main.css`, `schedule.js`, timetable settings/data | Low to Medium | 이미지보다 Firestore read와 CSS/JS가 중심 |
| story | `main.css`, `story.js`, external Google Fonts, legacy content image 가능성 | Medium | 신규 story image attach는 차단 방향. 기존 HTML image가 있으면 별도 확인 |
| contact | `main.css`, `contact.js`, external Google Fonts, map/link content | Low to Medium | 구조화 contact 중심이면 이미지 부담 작음 |
| admin dashboard | `main.css`, `admin-dashboard-index.js`, Firebase SDK | Medium | Hosting보다 Firestore read/관리자 반복 refresh 영향이 클 수 있음 |
| admin popup | `main.css`, `admin-popup.js`, preview image/R2 URL | Medium | 관리자 반복 테스트와 image preview가 다운로드 후보 |
| admin instructors | `main.css`, `admin-instructors.js`, profile/curriculum preview | Medium to High | 이미지 관리 화면이라 local/R2 preview 반복 확인 주의 |
| admin site | `main.css`, `admin-site.js` | Medium | 현재 admin page JS 중 가장 큰 축에 속함 |

관리자 페이지는 일반 사용자 수보다 운영자 QA 빈도에 더 영향을 받는다. DevTools Disable cache를 켠 상태로 여러 관리자 화면을 반복 확인하면 실제 사용자보다 Hosting download가 크게 보일 수 있다.

## 8. Firebase Hosting Download Drivers

가능 원인을 영향도와 현재 근거 기준으로 나누면 다음과 같다.

| Driver | Current Evidence | Download Impact | Notes |
| --- | --- | --- | --- |
| DevTools Disable cache | 운영/QA 중 사용 가능 | High during QA | 모든 cache 이점을 무력화하므로 Console 관찰값을 실제 사용자보다 크게 만들 수 있음 |
| Hard refresh/manual strong refresh 안내 | source에는 hard reload 없음. 운영 안내로 반복할 수 있음 | Medium to High | 일반 사용자에게 반복 안내하지 않는 것이 좋음 |
| JS/CSS no-cache | `firebase.json`에서 JS/CSS no-cache | Medium | stale 방지에는 좋지만 반복 방문/QA에서 재검증 증가 |
| Root `/` 1시간 cache | HEAD에서 `/`는 `max-age=3600` | Update risk, not download driver | 새 배포 반영 지연 후보. `/index.html`은 no-cache |
| Large images still on Hosting | local popup/profile/curriculum fallback 존재 | Medium | R2 전환 범위가 늘수록 감소 |
| Instructor image `Date.now()` cache-buster | `home-instructors.js`, `instructors.js`, `instructor-details.js` | High for profile-heavy pages | local profile image browser cache를 매 렌더 우회 가능 |
| `school.csv` | `dist/assets/school.csv` 약 1MB, 1일 cache | Medium | 학교 검색 사용자가 많으면 최초/만료 다운로드가 큼 |
| Repeated admin testing | admin pages, manual refresh buttons | Medium | 실제 사용자 트래픽과 분리해서 해석 필요 |
| Firebase SDK module imports | many pages import Firebase SDK from gstatic | Medium, but external CDN | Firebase Hosting download는 아니지만 page load 비용 |
| Duplicate CSS/JS loading | common `firebase-init.js`, `common.js`, page JS 구조 | Low to Medium | 큰 중복보다 ESM import cache/header 전략이 더 중요 |
| Fonts | Google Fonts external | External | Firebase Hosting download에는 직접 포함되지 않음 |
| Local `/assets` fallback images | popup/profile/curriculum fallback | Medium | R2 이전이 계속 필요한 영역 |
| Version prompt causing full reload | `common.js` 일반 reload prompt | Medium after deploy | 자동 reload는 아니지만 배포 직후 동시 reload 가능 |

## 9. Recommended Cache Strategy

권장 원칙:

- HTML: `no-cache` 또는 짧은 cache를 유지한다. 특히 `/` root path에도 `/index.html`과 같은 갱신 정책이 적용되는지 확인한다.
- `version.json`: `no-cache, no-store, must-revalidate` 유지가 적절하다.
- JS/CSS: 파일명 hash 또는 query version이 모든 참조에 확실히 적용되면 더 긴 cache가 가능하다.
- 현재는 HTML top-level JS/CSS에만 `?v=`가 확실하고, JS 내부 module import에는 `?v=`가 남아 있지 않다. 그래서 지금 당장 JS를 immutable로 바꾸는 것은 안전하지 않다.
- CSS `main.css`는 HTML에서 `?v=`가 붙으므로 cache 완화 후보지만, HTML root `/` 캐시와 배포 반영 UX를 함께 봐야 한다.
- 이미지/폰트: 긴 cache 가능. 단 같은 filename overwrite 금지.
- R2 public images: 같은 key overwrite 금지. 새 이미지 = 새 key.
- hard refresh는 기본 업데이트 전략으로 사용하지 않는다.
- 사용자에게 강제 전체 refresh를 자주 유도하지 않는다.
- 배포 후 새 버전 반영은 파일 버전/URL 변경으로 처리하는 것이 우선이다.

추천 세부 전략:

1. 먼저 현재 `?v=` 전략을 완성한다.
2. ES module import, dynamic import, partial fetch에도 build version이 붙도록 설계한다.
3. 그 다음 JS/CSS header를 `public,max-age=...`로 완화한다. 첫 단계는 1시간~1일 정도의 보수적 cache가 안전하다.
4. 안정화 후 content hash 또는 완전한 query version 보장을 전제로 immutable cache를 검토한다.
5. instructor image의 `Date.now()` cache-buster는 운영 이미지가 R2 versioned key 또는 timestamped filename을 쓰는 구조로 대체한다.

## 10. Versioned Asset Strategy Options

### Option A. 현재 유지 + hard refresh 최소화

- 장점: 코드 변경 없이 가장 안전하다. JS/CSS가 `no-cache`라 stale 가능성이 낮다.
- 단점: Hosting download와 재검증 요청을 줄이는 효과가 제한적이다. `/` root cache와 image cache-buster 문제는 남는다.
- 적용 난이도: 낮음. 문서/운영 안내 중심.

### Option B. JS/CSS에 build version query string 자동 부여

예:

```text
/assets/js/pages/home.js?v=20260619-1900
```

- 장점: 정적 HTML 구조와 잘 맞고, 이미 `prebuild.js`에 기본 구현이 있다.
- 단점: 현재 구현은 HTML top-level 참조 중심이다. JS 내부 ES module import와 dynamic import, template partial fetch까지 확장해야 JS cache를 길게 둘 수 있다.
- prebuild 변경 필요 여부: 이미 일부 구현되어 있으나, cache header 완화를 목표로 하면 추가 변경이 필요하다.
- firebase.json cache 변경 필요 여부: query version coverage가 완성된 뒤 필요하다. 지금 바로 JS/CSS immutable 전환은 이르다.

### Option C. JS/CSS 파일명을 content hash로 변경

예:

```text
home.abc123.js
```

- 장점: 가장 표준적이고 cache header를 `immutable`로 두기 좋다.
- 단점: 현재 정적 HTML + 다수 ES module import 구조에서는 manifest rewrite, module specifier rewrite, sourcemap/디버깅 정책까지 필요해 복잡도가 크다.
- 정적 HTML 구조에서 구현 난이도: 중상.
- prebuild 복잡도: 큼. manifest와 참조 rewrite가 필요하다.

### Option D. Service Worker/PWA 기반 update

- 장점: 앱 셸 cache, offline, update prompt를 정교하게 제어할 수 있다.
- 단점: 현재 프로젝트는 민감한 role page와 Auth/Firestore가 있고, PWA cache는 stale UI와 보안/로그아웃 cache 리스크를 만든다.
- 현재 프로젝트에는 과한지 여부: 과하다. 지금 문제는 Service Worker 부재가 아니라 HTTP cache/versioning 정합성 문제다.

추천: **Option B**. 단 “이미 있으니 끝”이 아니라, **Option B 보강형**이 맞다. 현재 top-level version query는 좋은 기반이므로, 내부 module import와 dynamic import까지 버전 범위를 넓힌 다음 cache header를 조정하는 순서가 가장 안전하다.

## 11. Hard Refresh Policy

현재 source 기준으로 일반 사용자 대상 hard refresh 기능은 없다. 새 버전 prompt는 일반 reload만 제공한다.

권장 정책:

- 일반 사용자에게 강력 새로고침을 반복 안내하지 않는다.
- 새 배포 반영은 “새 버전이 있습니다. 새로고침” 일반 reload 안내로 충분하게 만든다.
- hard refresh는 관리자/개발자용 문제 해결 절차로만 문서화한다.
- 자동 강제 reload는 사용하지 않는다.
- version mismatch 안내는 유지하되, 트래픽이 늘면 확인 빈도를 60초보다 길게 조정한다.
- 배포 직후 “모든 사용자가 즉시 강력 새로고침” 같은 운영 안내는 Hosting download 관점에서 피한다.

비용/다운로드 관점 판단:

- hard refresh는 브라우저 cache 이점을 없애므로, 사용자 수가 늘수록 Hosting download를 밀어 올릴 수 있다.
- 현재 구조에서는 `?v=`와 `version.json`으로 update prompt를 만들 수 있으므로 hard refresh를 기본 전략으로 쓸 이유가 없다.
- stale 문제가 생긴다면 hard refresh 안내보다 root `/` cache, JS module import versioning, image cache-buster를 먼저 점검하는 편이 맞다.

## 12. R2 Migration Impact

R2 public image 운영은 Firebase Hosting download를 줄이는 데 의미가 있다. 특히 자주 바뀌는 공개 운영 이미지가 Firebase Hosting의 immutable `/assets` 파일명 교체 문제에서 벗어난다.

줄어드는 범위:

- popup main image
- popup content public image
- instructor profile image
- instructor curriculum image
- future public notices/events image

여전히 Firebase Hosting에 남는 범위:

- HTML files
- `version.json`
- JS/CSS
- `assets/partials/**/*.html`
- root fixed assets: logo, favicon, theme icons, `main.webp`, `banner_main.webp`
- local rollback/fallback popup images
- local instructor profile placeholder
- local profile/curriculum images가 아직 CMS에서 참조되는 경우
- `assets/school.csv`
- footer/legal PDFs
- build metadata deployed in `dist` if not ignored by Hosting rules

R2 운영 주의:

- R2 public object도 같은 key overwrite를 금지해야 한다.
- 새 이미지는 새 key로 올리고 CMS URL을 교체한다.
- R2 URL path에 `/assets/` segment를 넣지 않는다.
- R2 public은 공개 자료 전용이다. 학생 자료, 리포트, 성적, 과제, private class materials는 public URL 금지다.
- 현재 instructor image 렌더링의 `Date.now()` query는 R2 cache 효율도 떨어뜨릴 수 있으므로, R2 versioned key 운영이 안정화되면 제거/축소 후보로 봐야 한다.

## 13. Recommended Implementation Phases

### Phase 1. Audit only

이번 작업. 코드, config, deploy, asset, Firestore 데이터 변경 없이 문서로 현황과 전략만 정리했다.

### Phase 2. Safe version query implementation

다음 작업 후보:

- ES module static import specifier에 build version query 적용 검토
- dynamic import specifier versioning 검토
- partial fetch versioning 보강
- `Date.now()` image cache-buster를 versioned filename/R2 key 기반으로 대체하는 설계
- root `/`와 `/index.html` cache 차이 재확인

### Phase 3. Cache header adjustment

필요 시 `firebase.json` 수정 후보:

- root `/` 또는 fallback index 응답도 HTML no-cache 의도에 맞게 조정 가능한지 검토
- versioning coverage가 완성된 뒤 JS/CSS cache를 보수적으로 완화
- 충분히 검증되면 JS/CSS immutable cache 검토

### Phase 4. Hard refresh UX reduction

필요 시 다음 작업:

- 운영 문구에서 강력 새로고침 반복 안내 제거
- version prompt frequency 완화
- 일반 사용자 prompt와 관리자/개발자 troubleshooting 안내 분리

### Phase 5. CSS/JS duplication cleanup

별도 감사 후 진행:

- page별 JS dependency graph 확인
- admin-only code split 확인
- `main.css` size와 실제 사용 CSS 확인
- Firebase SDK import duplication과 ESM cache 전략 확인

## 14. QA Checklist

- normal reload: `/`, `/index.html`, public pages, admin pages에서 일반 reload 후 최신 HTML meta/version 확인
- first visit: cache 없는 상태에서 주요 페이지 로딩 waterfall 확인
- repeat visit: browser cache enabled 상태에서 JS/CSS/image가 cache 또는 304로 처리되는지 확인
- after deploy: `dist/version.json` version과 HTML `grit-build-version` 일치 확인
- admin page: dashboard, popup, site, instructors, courses, offline classes, timetable 로딩 확인
- public page: home, courses, course detail, instructors, instructor detail, schedule, story, contact 확인
- R2 image load: popup, instructor profile, instructor curriculum R2 URL이 정상 표시되는지 확인
- version prompt behavior: 이전 HTML을 연 상태에서 새 배포 후 prompt가 한 번만 뜨고 일반 reload로 해결되는지 확인
- browser DevTools cache enabled/disabled 비교: Console Hosting download 해석 시 QA 조건을 기록
- root path cache: `/`와 `/index.html`의 response header 차이를 재확인
- JS module stale test: 내부 import된 utility 파일 변경 후 version query/header 조합에서 새 코드가 반영되는지 확인
- image cache-buster test: instructor local profile image가 매 렌더마다 새 query로 요청되는지 확인

## 15. Risks / Edge Cases

- 캐시가 너무 길어서 JS/CSS가 안 바뀌는 문제
- query string version이 일부 HTML에만 적용되는 문제
- JS 내부 module import가 versioning되지 않아 stale module이 남는 문제
- Firebase Hosting headers와 prebuild 전략 불일치
- root `/`와 `/index.html` cache header가 달라 홈 배포 반영이 다르게 보이는 문제
- admin JS가 stale이면 Firestore schema/field 기대값과 안 맞는 문제
- 강제 새로고침 또는 DevTools Disable cache가 사용자/QA 다운로드를 증가시키는 문제
- `Date.now()` image cache-buster가 immutable image cache를 우회하는 문제
- R2 public URL에 query cache-buster를 계속 붙여 Cloudflare cache hit를 낮추는 문제
- R2 key overwrite 시 오래된 이미지가 남거나 rollback 판단이 어려워지는 문제
- `/assets/css/pages/home.css`처럼 source 기준 경로와 dist bundle 경로가 달라 감사 URL이 404로 보일 수 있는 문제

## 16. Recommendation

중요 판단 질문에 대한 답은 다음과 같다.

1. 지금 `firebase.json` cache header가 다운로드 증가에 영향을 줄 수 있는가?
   - 그렇다. JS/CSS `no-cache`는 stale 방지에는 안전하지만 반복 방문/QA에서 재검증 요청을 늘린다. 이미지 immutable은 유리하지만 `Date.now()` query가 붙으면 이점이 약해진다.
2. JS/CSS가 매 배포마다 URL이 바뀌는가?
   - 파일명은 바뀌지 않는다. HTML top-level CSS/JS URL에는 `?v={buildVersion}`가 붙는다. 내부 ES module import URL은 아직 version query가 없다.
3. URL이 안 바뀐다면 no-cache를 유지해야 하는가?
   - 그렇다. 내부 module import처럼 URL이 안 바뀌는 JS는 현재처럼 `no-cache`가 안전하다.
4. URL이 바뀌게 만들 수 있다면 JS/CSS cache를 늘릴 수 있는가?
   - 그렇다. 단 모든 JS/CSS 참조, module import, dynamic import, partial fetch까지 versioning coverage가 확보되어야 한다.
5. 현재 hard refresh 기능은 일반 사용자에게 필요한가?
   - 아니다. source에는 hard refresh가 없고 일반 reload prompt만 있다. 일반 사용자에게 hard refresh를 안내할 필요는 낮다.
6. version prompt는 어떤 방식으로 축소하는 것이 좋은가?
   - 일반 reload prompt는 유지하되, 강력 새로고침 안내는 운영자/개발자용으로 제한한다. 트래픽이 늘면 version check interval을 완화한다.
7. R2 이전으로 줄어드는 다운로드 범위와 여전히 Hosting에 남는 범위는 무엇인가?
   - popup/instructor/curriculum 같은 mutable public image는 R2로 줄일 수 있다. HTML/JS/CSS/version.json/partials/fixed assets/school.csv/PDF/local fallback은 Hosting에 남는다.
8. 가장 안전한 다음 구현은 무엇인가?
   - **Option B 보강형**이다. 현재 `prebuild.js`가 이미 top-level `?v=`를 넣으므로, 다음에는 내부 ES module import와 partial fetch까지 versioning을 완성하고, 그 뒤 `firebase.json` JS/CSS cache를 보수적으로 완화한다. 동시에 instructor image `Date.now()` cache-buster 제거/축소와 root `/` cache header 차이를 별도 수정 후보로 둔다.

즉시 구현 추천 여부:

- 이번 작업에서는 구현하지 않는다.
- 다음 구현은 권장한다. 상세 gate와 phased roadmap은 `docs/audits/CACHE_VERSIONING_OPERATIONS_PLAN.md`와 `docs/audits/VERSION_COVERAGE_AUDIT.md`를 따른다. 세부 다음 단계는 ES module/dynamic import versioning 보강 -> QA -> partial fetch/root/HTML cache 정합성 확인 -> `firebase.json` cache header 조정 -> hard refresh/운영 안내 축소가 안전하다.

## 17. Phase D-1 Update

2026-06-23 Phase D-1에서 ES module/dynamic import versioning 보강을 완료했다. `scripts/prebuild.js`가 generated `dist/assets/js/**/*.js`의 local JS import/export/dynamic/side-effect specifier에 build version query를 붙인다. Source JS, `firebase.json`, Hosting cache header는 변경하지 않았다.

검증 결과 `npm run prebuild`, `npm run verify`가 통과했고, generated dist 분류에서 local unversioned JS module specifier는 0개였다. Remaining unversioned `.js` imports는 Firebase/SheetJS CDN 같은 external URL로 분류된다.

따라서 이 문서의 기존 "내부 ES module import URL은 아직 version query가 없다"는 Phase D-1 이전 상태 설명이다. Phase D-1 직후 blocker는 partial fetch versioning, `school.csv` fetch policy, R2/public image cache-buster cleanup, root `/` cache normalization이었다. JS/CSS cache header relaxation은 remaining gate와 browser QA 이후 검토한다.

## 18. Phase D-2 Update

2026-06-23 Phase D-2에서 common partial HTML fetch versioning을 완료했다. `assets/js/common.js`가 HTML `grit-build-version` meta를 읽고, `/assets/partials/*.html` URL에만 build version query를 붙여 header/footer partial stale 위험을 줄인다.

이번 변경은 배포 후 partial HTML 변경이 브라우저 cache나 중간 cache에 묶여 늦게 보이는 문제를 줄이는 선행 작업이다. `/version.json`은 계속 no-store fetch로 유지했고, `school.csv`, Firestore/API 요청, external/R2 URL, image `Date.now()` cache-buster, `firebase.json` cache header는 변경하지 않았다.

검증 결과 `npm run prebuild`, `npm run verify`가 통과했고 generated `dist/assets/js/common.js`에서 `fetch(withBuildVersion(...))` 형태가 확인됐다. `npm run serve`는 Firebase CLI `Error: An unexpected error has occurred.`로 로컬 브라우저/Network 확인 전 실패했다.

현 시점의 remaining blocker는 `school.csv` fetch policy, R2/public image cache-buster cleanup, root `/` cache normalization이다. JS/CSS cache header relaxation은 이 remaining gate와 browser QA 이후 검토한다.

## 19. Phase D-3 Update

2026-06-23 Phase D-3에서 `school.csv` fetch/cache, public image cache-buster, root `/` cache header를 정리했다.

- `school.csv` 반복 다운로드 위험 감소: build version query + `force-cache` + 공통 Promise 캐시
- `Date.now()` image cache-buster 제거로 instructor profile/curriculum/R2 이미지 반복 다운로드 위험 감소
- root `/` cache 정책을 `/index.html` 및 `**/*.html`과 동일한 `no-cache, must-revalidate`로 일관화

이번 변경에서 JS/CSS cache header, `version.json` no-store, image/font immutable header, CSV/PDF 1-day Hosting header는 변경하지 않았다.

현 시점의 remaining blocker는 JS/CSS cache header relaxation이다. browser QA 이후 짧은 cache 완화 여부를 검토한다.

운영 배포 여부가 확정되지 않은 상태에서는 이 문서의 완료 표기를 다음 기준으로 해석한다.

```text
로컬 소스 및 prebuild/verify 기준 구현 완료. 운영 배포 및 운영 URL header/Network QA는 별도 확인 필요.
```
