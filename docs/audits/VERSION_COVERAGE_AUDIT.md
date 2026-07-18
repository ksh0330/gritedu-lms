# Version Coverage Audit

작성일: 2026-06-23

## 1. Executive Summary

2026-06-24 현재 최신 상태는 다음과 같다.

- HTML top-level CSS/JS version coverage는 충분하다.
- Phase D-1 이후 generated `dist/assets/js/**/*.js`의 local import/export/side-effect/dynamic import specifier에는 build version query가 적용된다.
- Phase D-2 이후 `/assets/partials/*.html` fetch에는 build version query가 적용된다.
- Phase D-3 이후 `school.csv`는 build version query + `force-cache` + Promise/data 재사용을 사용한다.
- Phase D-3 이후 public instructor/R2/local image URL의 `Date.now()`/render timestamp cache-buster는 제거됐다.
- JS/CSS cache header relaxation은 아직 적용하지 않았다.
- 운영 배포 및 운영 URL header/browser QA는 확인 전이면 pending으로 둔다.

아래 2-12장은 Phase D-1 이전 정밀 감사의 원문 맥락이고, 13-15장은 이후 구현 결과다. 현재 운영 판단은 이 Executive Summary와 13-15장을 우선한다.

초기 감사 당시 build version coverage는 **HTML top-level CSS/JS 참조에는 적용되어 있으나, JS 내부 module graph에는 적용되어 있지 않았다**.

`scripts/prebuild.js`는 root HTML과 `members/**/*.html`을 처리하면서 `grit-build-version` meta를 삽입하고, `/assets/js/**/*.js`, `/assets/css/**/*.css`, modulepreload href에 `?v={buildVersion}`를 붙인다. 현재 존재하는 `dist`를 read-only로 확인해도 `dist/index.html`, `dist/members/admin/dashboard.html`, `dist/members/signup.html`, `dist/members/students/dashboard.html` 등에서 top-level JS/CSS URL에 `?v=20260623-171922`가 붙어 있었다.

반면 `dist/assets/js/**/*.js` 내부의 `import ... from "/assets/js/..."`, side-effect import, relative import, dynamic import는 version query 없이 남는다. `common.js`의 partial fetch도 `fetch(`/assets/partials/${includeType}.html`)` 형태라 version query가 없다. `version.json`은 `no-store`로 안전하게 최신 확인 대상이며, `school.csv`는 페이지별 fetch cache mode가 섞여 있다.

따라서 현재 상태에서 JS/CSS cache header를 길게 완화하면 안 된다. 다음 구현 단계는 **D. ES module import versioning first**가 가장 적절하다.

참고: 이번 감사에서는 `npm run prebuild`를 실행하지 않았다. 이 명령은 `dist`를 초기화/갱신하므로, 이번 작업의 `dist/** 수정 금지` 조건을 우선했다. 대신 기존 `dist` 산출물을 read-only로 확인했다.

## 2. Current Build Version Flow

- build version 생성 위치: `scripts/prebuild.js`의 `generateVersion()`이 `Date.now()` 기반 `YYYYMMDD-HHMMSS` 값을 만든다.
- HTML meta 삽입 방식: `injectBuildVersionMeta()`가 `<meta name="grit-build-version" content="{version}" />`를 `<head>` 안에 삽입한다.
- JS/CSS `?v=` 삽입 방식: `applyVersionToHTML()`이 HTML의 CSS `href`, JS `src`, CSS/JS preload `href`에 `?v={version}`를 붙인다.
- version.json 생성 방식: `saveVersionInfo()`가 `dist/version.json`에 `version`, `timestamp`, `buildDate`를 쓴다.
- common.js runtime check 방식: `assets/js/common.js`가 HTML meta version과 `/version.json` 응답의 `version`을 비교하고, mismatch 시 일반 `window.location.reload()` prompt를 띄운다.
- `/version.json` fetch 방식: `fetch(VERSION_CHECK_URL, { cache: "no-store" })`.
- hard refresh 상태: `location.reload(true)`, service worker, `skipWaiting` 기반 강제 갱신 흐름은 없다.

## 3. HTML JS/CSS Coverage

| HTML File/Pattern | CSS Versioned? | JS Versioned? | Notes |
| --- | --- | --- | --- |
| root public HTML (`index.html`, `courses.html`, `instructors.html`, `story.html`, etc.) | Yes | Yes | `processHTMLFiles()`의 root HTML list에 포함된다. 기존 `dist`에서도 `main.css?v=20260623-171922`, JS `src ?v=` 확인. |
| root `index.html` modulepreload | N/A | Yes | `/assets/js/firebase-init.js`, `/assets/js/common.js` modulepreload도 `?v=` 확인. |
| `members/*.html` | Yes | Yes | `processHTMLFiles()`가 `members` 폴더 HTML을 재귀 수집한다. |
| `members/admin/*.html` | Yes | Yes | `main.css`와 page JS는 versioned. 일부 page CSS도 `applyVersionToHTML()` 대상이다. |
| `members/admin/users/*.html` | Yes | Yes | `admin-instructors.css`, `admin-students.css` 같은 page CSS도 pattern상 version 대상이다. |
| `members/students/*.html`, `members/member/*.html`, `members/instructors/*.html` | Yes | Yes | 기존 `dist`에서 dashboard/course/offline-class 계열 top-level JS/CSS version query 확인. |
| `assets/partials/*.html` | N/A | N/A | HTML partial 자체는 `processHTMLFiles()` 대상이 아니라 assets copy 대상이다. fetch URL은 `common.js` template literal이라 version query가 없다. |
| root `/` request | HTML file is versioned | HTML file is versioned | `index.html` 자체는 versioned지만 이전 HEAD 감사에서 root `/` cache header는 `max-age=3600`으로 관찰됐다. URL coverage와 response header 문제를 분리해야 한다. |

## 4. ES Module Import Coverage

| File | Import Target | Current Versioned? | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `assets/js/common.js` | `/assets/js/utils/toast.js`, `/assets/js/firebase-init.js` | No | `common.js?v=...`가 최신이어도 내부 module URL은 stable path다. | JS cache relaxation 전 versioning 필요. |
| `assets/js/firebase-init.js` | `/assets/js/utils/auth.js` | No | auth utility 변경 시 stale module 가능. | high priority import rewrite 대상. |
| `assets/js/utils/*.js` | `/assets/js/config/constants.js`, `/assets/js/utils/*.js` | No | shared utility는 여러 page에서 재사용되어 영향 범위가 넓다. | shared module부터 coverage 확인. |
| `assets/js/pages/admin-*.js` | `/assets/js/firebase-init.js`, `/assets/js/utils/*.js` | No | admin JS stale은 Firestore schema/UI validation mismatch로 이어질 수 있다. | admin page는 public page보다 더 엄격히 QA. |
| `assets/js/pages/instructor-dashboard*.js` | `/assets/js/pages/instructor-dashboard/*.js`, `/assets/js/utils/*.js` | No | dashboard 하위 module 변경이 top-level page JS version만으로 무효화되지 않는다. | directory module graph rewrite 필요. |
| `assets/js/pages/student-dashboard*.js` | `/assets/js/pages/student-dashboard/*.js`, `/assets/js/utils/*.js` | No | 학생 대시보드 분할 module stale 위험. | cache relaxation 전 필수 gate. |
| `assets/js/features/signup/*.js` | relative `./*.js`, `/assets/js/utils/*.js` | No | signup flow는 여러 단계 module로 나뉘어 있어 stale 조합 위험이 크다. | relative import까지 포함해 처리. |
| root inline module in `index.html` | `/assets/js/utils/dday.js` | Source No, dist likely Yes only if top-level pattern catches inline href/src no | inline static import는 `src/href` rewrite 대상이 아니다. | inline module import rewrite 별도 확인 필요. |
| External Firebase/CDN imports | `https://www.gstatic.com/...`, `https://cdn.sheetjs.com/...` | Provider URL pinned | local build version 대상 아님 | 별도 CDN version/pin 정책으로 관리. |

## 5. Dynamic Import Coverage

| File | Dynamic Import Target | Current Versioned? | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `assets/js/pages/admin-popup.js` | `/assets/js/utils/image-upload.js` | No | popup image path helper 변경 시 admin popup flow가 stale helper를 쓸 수 있다. | dynamic import rewrite 대상. |
| `assets/js/pages/admin-popup.js` | `/assets/js/utils/image-upload.js` second call site | No | 위와 동일. | 중복 call site 함께 처리. |
| `assets/js/pages/signup.js` | `./signup-common.js` | No | signup entry는 versioned여도 step module은 stable relative URL이다. | relative dynamic import versioning 필요. |
| `assets/js/pages/signup.js` | `./signup-step1.js` | No | 단계별 UI 변경 stale 위험. | signup flow 통합 QA. |
| `assets/js/pages/signup.js` | `./signup-step2.js` | No | email verification/school CSV flow stale 위험. | signup flow 통합 QA. |
| `assets/js/pages/signup.js` | `./signup-step3.js`, `./signup-step4.js` | No | 저장 payload/validation 변경 stale 위험. | signup flow 통합 QA. |

## 6. Partial / JSON / CSV Fetch Coverage

| File | Fetch Target | Current Cache/Version Behavior | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `assets/js/common.js` | `/version.json` | `cache: "no-store"`; Hosting header `no-cache, no-store, must-revalidate` | 요청 수는 늘 수 있지만 배포 감지에는 적절. | 유지. interval 조정은 사용량 관찰 후 별도 검토. |
| `assets/js/common.js` | ``/assets/partials/${includeType}.html`` | No version query; Hosting header `no-cache, must-revalidate` | partial을 long cache로 바꾸면 stale 위험. 현재 header에서는 안전하지만 재검증 요청 발생. | partial fetch versioning 또는 no-cache 유지 중 하나로 정책 확정. |
| `assets/js/features/signup/children-form.js` | `/assets/school.csv` | default fetch cache; Hosting header 1-day cache | CSV 변경 후 최대 TTL/브라우저 정책 영향 가능. | canonical fetch 정책 정리 필요. |
| `assets/js/pages/member-dashboard.js` | `/assets/school.csv` | `{ cache: "force-cache" }`; Hosting header 1-day cache | download 절감에는 유리하지만 CSV 긴 stale 가능. | school.csv가 자주 바뀌지 않으면 유지 가능. 변경 빈도 문서화. |
| `assets/js/pages/signup-step2.js` | `SCHOOL_CSV_URL = "/assets/school.csv"` | `{ cache: "no-store" }`; 매번 재요청 가능 | 약 1MB CSV 다운로드가 회원가입 QA/사용량에 민감할 수 있다. | no-store 필요성 재검토. versioned URL + normal cache 후보. |
| `scripts/prebuild.js` | literal partial fetch rewrite | only `fetch('.../assets/partials/*.html')` literal pattern | `common.js` template literal은 rewrite되지 않는다. | build rewrite 범위 확장 또는 runtime version helper 필요. |

반드시 분리해서 판단해야 할 항목:

- `/version.json`: 최신성 우선, no-store 유지.
- partial HTML: 현재는 no-cache header로 안전하지만 version coverage gap 존재.
- `school.csv`: 정적 대용량 데이터 파일이며 fetch mode가 default/force-cache/no-store로 섞여 있다.

## 7. Cache-Buster Audit

| File | Pattern | Purpose | Download Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `assets/js/pages/home-instructors.js` | `?v=${renderTimestamp}` | 강사 카드 이미지 즉시 반영 | R2 URL에도 붙을 수 있어 R2 cache hit 저하. | R2 URL은 제외, local dev 또는 local `/assets`에만 제한. |
| `assets/js/pages/instructors.js` | `?v=${renderTimestamp}` | 강사 목록 이미지 즉시 반영 | R2 profile URL에도 query가 붙을 수 있다. | 새 R2 key 원칙과 충돌하므로 R2 제외. |
| `assets/js/pages/instructor-details.js` | `withCacheBuster(url)` and hero `?v=${Date.now()}` | 상세 profile/curriculum 이미지 즉시 반영 | profile/curriculum R2 URL에 query가 붙을 수 있다. | public page R2 cache-buster 제거 우선 후보. |
| `assets/js/pages/admin-instructors.js` | `addImageCacheBuster(url)` | admin preview/probe refresh | `.web.app` hostname도 dev로 취급되어 preview/probe에 query가 붙는다. | admin preview는 허용 가능하나 R2 HEAD/image probe에는 새 key 정책 우선. |
| `assets/js/pages/admin-site.js` | `addImageCacheBuster(url)` | admin preview refresh | instructor preview에 R2 URL이 들어오면 query 가능. | R2 제외 조건 추가 후보. |
| `assets/js/common.js` | `Date.now()` for version check throttle | URL cache-buster 아님 | download risk 직접 없음. | 유지. |
| `scripts/prebuild.js` | `Date.now()` for build version/timestamp | build metadata | runtime download risk 없음. | 유지. |
| various admin files | IDs/tokens using `Date.now()` or `Math.random()` | document IDs, validation tokens | URL cache-buster 아님 | cache 감사 대상에서 제외. |

## 8. R2 URL Cache Behavior

- 코드에 `r2.dev?...` 같은 literal query cache-buster는 발견되지 않았다.
- 그러나 `resolveInstructorProfileImageUrl()`로 R2 URL을 normalize한 뒤 `addImageCacheBuster()` 또는 `withCacheBuster()`를 적용하는 public rendering path가 있다.
- 특히 `home-instructors.js`, `instructors.js`, `instructor-details.js`는 R2 profile/curriculum URL에도 `?v=Date.now()` 또는 `?v=renderTimestamp`를 붙일 수 있다.
- `public-image-url.js`는 R2 URL을 normalize할 때 query를 제거하고, R2 key path에 `/assets/` segment가 있으면 거부한다. 이 정책은 `/assets/` segment 금지 원칙과 일치한다.
- 새 key 방식과 충돌하는 코드: public page image cache-buster는 새 key 정책의 이점을 약화한다. 이미지를 바꿀 때 query가 아니라 새 R2 key를 쓰는 방향으로 정리해야 한다.
- admin popup path는 R2 URL을 저장/미리보기할 때 일반적으로 raw URL을 사용하고, popup save path normalize도 R2 query를 제거한다. public instructor 계열보다 위험도가 낮다.

## 9. Can JS/CSS Cache Be Relaxed Now?

최신 판단: **Not yet**. Phase D-1/D-2/D-3로 module/partial/school.csv/image cache-buster/root normalization gap은 로컬 소스 기준 정리됐지만, JS/CSS cache header relaxation은 아직 적용하지 않았다. 운영 배포 및 browser Network QA 이후 짧은 완화부터 검토한다.

초기 감사 판단: **Not yet, partial/module coverage gap exists**.

보조 판단:

- **Not yet, Date.now/cache-buster cleanup needed first**는 이미지/R2 다운로드 관점에서 맞지만, JS/CSS header 완화의 직접 선행 조건은 module coverage다.
- **Not yet, root HTML cache mismatch should be fixed first**도 배포 반영 UX에는 중요하지만, JS 내부 stale module 위험을 대신 해결하지는 않는다.

현재 완화 불가 이유:

- top-level JS/CSS URL은 versioned다.
- 내부 ES module static import는 versioned가 아니다.
- dynamic import도 versioned가 아니다.
- partial fetch는 versioned가 아니다.
- 기존 `dist`에서도 JS 내부 import/fetch gap이 그대로 확인된다.

## 10. Recommended Fix Plan

### Fix 1. Root HTML cache normalization

- 수정 대상 파일: `firebase.json` 또는 Hosting rewrite/header 정책.
- 위험도: Medium.
- 검증 방법: `/`, `/index.html`, 주요 public/admin HTML의 `Cache-Control` HEAD 비교.
- 먼저 할지 나중에 할지: 나중. 배포 반영 UX에는 중요하지만 JS module stale 해결이 먼저다.

### Fix 2. Partial fetch versioning

- 수정 대상 파일: `assets/js/common.js` 또는 `scripts/prebuild.js`.
- 위험도: Low to Medium.
- 검증 방법: header/footer partial 변경 후 일반 reload와 version prompt 흐름 확인.
- 먼저 할지 나중에 할지: ES module fix 직후 또는 함께. 현재 partial header가 no-cache라 즉시 long cache blocker는 낮다.

### Fix 3. ES module/dynamic import versioning

- 수정 대상 파일: `scripts/prebuild.js` 중심. 필요 시 runtime version helper 또는 manifest 방식 검토.
- 위험도: High.
- 검증 방법: build 후 `dist/assets/js/**/*.js`에서 local `/assets/js/**/*.js` import와 relative dynamic import에 version query가 붙는지 확인. signup, admin, student/instructor dashboard QA.
- 먼저 할지 나중에 할지: **먼저.** JS/CSS cache relaxation의 핵심 선행 조건이다.

### Fix 4. Date.now cache-buster cleanup

- 수정 대상 파일: `assets/js/pages/home-instructors.js`, `assets/js/pages/instructors.js`, `assets/js/pages/instructor-details.js`, 필요 시 `assets/js/pages/admin-instructors.js`, `assets/js/pages/admin-site.js`.
- 위험도: Medium.
- 검증 방법: R2 public URL에 query가 붙지 않는지 Network tab에서 확인. local `/assets` fallback 이미지 변경은 새 filename으로 검증.
- 먼저 할지 나중에 할지: module fix 다음. R2 download/cache hit 개선에는 중요하다.

### Fix 5. Conservative JS/CSS cache relaxation

- 수정 대상 파일: `firebase.json`.
- 위험도: High.
- 검증 방법: first visit/repeat visit/after deploy waterfall, stale module test, admin page smoke QA.
- 먼저 할지 나중에 할지: 마지막. module/dynamic import/partial/root gate 통과 전에는 진행하지 않는다.

## 11. QA Plan

- first visit: cache 없는 상태에서 `index.html`, public pages, admin pages의 HTML/CSS/JS 로딩을 확인한다.
- repeat visit: browser cache enabled 상태에서 top-level JS/CSS와 internal module 요청이 의도대로 cache/304/versioned URL 처리되는지 확인한다.
- after deploy: `dist/version.json`과 HTML `grit-build-version`이 일치하고, version prompt가 한 번만 뜨는지 확인한다.
- normal reload: prompt 버튼의 일반 `window.location.reload()`로 최신 HTML/JS/CSS가 반영되는지 확인한다.
- version prompt: `/version.json` no-store 요청이 정상 동작하고, hard refresh 안내 없이 해결되는지 확인한다.
- CMS data change without deploy: popup/site/instructor/timetable CMS 변경이 Firestore 저장/읽기/local cache 기준으로 반영되는지 확인한다.
- R2 image change without deploy: 새 R2 key URL을 CMS에 저장한 뒤 query cache-buster 없이 이미지가 바뀌는지 확인한다.
- DevTools cache enabled vs disabled: Hosting download 해석 시 QA 조건을 분리 기록한다.
- signup flow: dynamic import된 signup step module 전체를 새 배포 후 순차 확인한다.
- admin flow: popup, instructors, courses, dashboard에서 stale admin module이 없는지 확인한다.
- school.csv: 회원가입 step2와 children-form/member-dashboard에서 CSV 다운로드/cache mode를 비교한다.

## 12. Recommendation

다음 구현 단계는 **D. ES module import versioning first**를 추천한다.

선택지별 판단:

- A. root cache normalization first: 필요하지만 JS/CSS relaxation의 직접 blocker는 아니다.
- B. partial fetch versioning first: 작고 안전한 fix지만 현재 header가 no-cache라 긴급도는 module보다 낮다.
- C. Date.now cache-buster cleanup first: R2 download에는 중요하지만 JS/CSS stale 위험을 해결하지 않는다.
- D. ES module import versioning first: **추천.** 현재 source와 `dist` 모두에서 static/dynamic import version gap이 확인된다.
- E. no code change yet, observe usage one more day: gap이 명확하므로 관찰만으로는 다음 gate를 통과할 수 없다.

## 13. Phase D-1 Implementation Result

2026-06-23 Phase D-1에서 `scripts/prebuild.js`의 JS dist 생성 단계에 local JS module specifier versioning을 추가했다. Source `assets/js/**/*.js`는 변경하지 않았고, `dist/assets/js/**/*.js` 산출물에만 build version query를 적용한다.

적용 범위:

- static `import ... from "/assets/js/*.js"` 및 relative `from "./*.js"`
- `export ... from "/assets/js/*.js"`
- side-effect `import "/assets/js/*.js"`
- dynamic `import("/assets/js/*.js")` 및 `import("./*.js")`

제외 범위:

- Firebase CDN, SheetJS CDN 등 external URL import
- bare specifier
- existing query/hash가 있는 specifier
- `version.json`, partial HTML, `school.csv` 같은 non-JS fetch target
- R2/public image URL cache-buster

검증 결과:

- `npm run prebuild` 통과, build version `20260623-180246`
- `npm run verify` 통과
- generated dist scan 결과 local JS import/export/dynamic/side-effect specifier 206개가 `?v=20260623-180246`로 versioned
- local unversioned JS module specifier, bare specifier, existing non-version query specifier는 0개
- remaining unversioned `.js` imports는 Firebase/SheetJS 같은 external CDN URL로 분류

남은 coverage gap:

- `common.js` partial fetch는 아직 template literal `/assets/partials/${includeType}.html`라서 build version query가 보장되지 않는다.
- `school.csv` fetch policy는 page별로 default/force-cache/no-store가 섞여 있다.
- instructor/public image `Date.now()`/render timestamp cache-buster 정리는 별도 Phase로 남아 있다.
- root `/` cache header normalization과 JS/CSS cache header relaxation은 아직 진행하지 않았다.

## 14. Phase D-2 Partial Fetch Versioning Result

2026-06-23 Phase D-2에서 `assets/js/common.js`의 공통 partial HTML fetch에 build version query를 적용했다. Build version은 기존 HTML meta helper인 `getCurrentBuildVersion()`이 읽는 `<meta name="grit-build-version" content="...">` 값을 재사용한다.

대상 fetch:

- `fetch(withBuildVersion(...))` for `/assets/partials/${includeType}.html`

적용 조건:

- URL이 string이어야 한다.
- `/assets/partials/`로 시작해야 한다.
- `.html`로 끝나야 한다.
- 이미 query가 있으면 원본 URL을 유지한다.
- build version이 없으면 원본 URL을 유지한다.

제외한 fetch:

- `/version.json`: 계속 `fetch(VERSION_CHECK_URL, { cache: "no-store" })` 유지
- `/assets/school.csv`: 이번 단계에서 수정하지 않음
- Firestore/API 요청: 수정하지 않음
- external/R2 URL: helper 조건에 맞지 않아 수정하지 않음

검증 결과:

- `git diff --check` 통과
- `npm run prebuild` 통과, build version `20260623-181422`
- `npm run verify` 통과
- generated `dist/assets/js/common.js`에서 `withBuildVersion()`과 partial fetch 적용 확인
- `npm run serve`는 Firebase CLI `Error: An unexpected error has occurred.`로 로컬 HTTP 확인 전 실패

남은 coverage gap:

- JS/CSS cache header relaxation
- 큰 asset/CSS 중복 정리

## 15. Phase D-3 School CSV, Image Cache-Buster, Root Cache Result

2026-06-23 Phase D-3에서 `school.csv` fetch/cache, public image cache-buster, root `/` cache header를 정리했다.

### school.csv

- 공통 helper: `assets/js/utils/school-csv.js`
- 사용처: `signup-step2.js`, `children-form.js`, `member-dashboard.js`
- fetch URL: `/assets/school.csv?v={buildVersion}` (`grit-build-version` meta 기준)
- cache mode: `force-cache` (기존 `no-store`/`default`/`force-cache` 혼재 제거)
- 페이지 생명주기 메모리 캐시: `loadSchoolCsvArrayBuffer()` Promise 재사용
- lazy load: 회원가입 step2/children-form은 학교 검색 초기화 시, member-dashboard는 parent purpose 대시보드 초기화 시 로드

### Date.now image cache-buster

- 제거 대상: `home-instructors.js`, `instructors.js`, `instructor-details.js`
- admin preview helper: `admin-instructors.js`, `admin-site.js`는 URL 그대로 반환 (로컬 파일 선택 preview는 기존 `blob:` URL 유지)
- R2 URL: query cache-buster 제거, 새 key 원칙 유지

### root `/` cache normalization

- `firebase.json`에 `"source": "/"` header 추가
- `/`, `/index.html`, `**/*.html` → `no-cache, must-revalidate`
- `version.json` → `no-cache, no-store, must-revalidate` 유지
- JS/CSS cache header는 변경하지 않음

검증:

- `git diff --check` 통과
- `npm run prebuild` 통과, build version `20260623-182909`
- `npm run verify` 통과
- generated `dist/assets/js/utils/school-csv.js`에서 `getSchoolCsvUrl()`, `cache:"force-cache"` 확인
- generated dist JS에서 image `Date.now()`/`renderTimestamp` cache-buster 0건
- `npm run serve`는 Firebase CLI `Error: An unexpected error has occurred.`로 로컬 HTTP 확인 전 실패

남은 gap:

- JS/CSS cache header 완화
- 큰 asset/CSS 중복 정리
- 운영 배포 후 header/browser Network QA
