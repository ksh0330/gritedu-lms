# Cache Versioning Operations Plan

작성일: 2026-06-23

## 1. Executive Summary

Grit Edu LMS/CMS의 캐시 전략은 두 축으로 나누어 운영해야 한다.

첫째, Cloudflare Pages가 제공하는 HTML/CSS/JS/이미지/CSV/PDF 같은 정적 파일은 배포 산출물과 브라우저 캐시 정책의 영향을 받는다. 현재 구조는 `prebuild.js`가 HTML에 `grit-build-version` meta와 top-level JS/CSS `?v={buildVersion}`를 넣고, `version.json`을 통해 새 배포를 감지한다. JS/CSS는 아직 `no-cache, must-revalidate`라 stale 위험은 낮지만 반복 QA와 재검증 요청이 Pages 트래픽을 늘릴 수 있다.

둘째, 관리자 CMS가 저장하는 Firestore 데이터는 Hosting 정적 파일 캐시와 별개다. 팝업 문구, 강사 정보, 사이트 문구, 시간표 노출 설정 같은 CMS 데이터 변경은 `prebuild`나 정적 사이트 배포가 아니라 Firestore write와 화면 렌더링/cache invalidation 문제로 판단해야 한다.

2026-06-24 현재 로컬 소스 및 prebuild/verify 기준으로 Phase 1 policy alignment, Phase 2 version coverage audit, Phase D-1 module import versioning, Phase D-2 partial fetch versioning, `school.csv` fetch/cache cleanup, image cache-buster cleanup, root cache normalization implementation은 완료 상태다.

2026-06-29 현재 운영 Hosting은 Cloudflare Pages이며 Firebase Hosting은 `firebase hosting:disable` 완료 상태다. `npm run prebuild`는 `dist/_headers`와 `dist/version.json`을 생성하고, `scripts/verify-build.js`는 `_headers`, `version.json`, 금지 파일 노출을 검사한다.

JS/CSS cache header는 아직 `no-cache, must-revalidate`를 유지한다. Cloudflare Pages `_headers` live response와 forbidden URL live response QA가 확인되기 전에는 “운영 반영 완료”로 쓰지 않고, “로컬 소스 및 prebuild/verify 기준 구현 완료. 운영 URL 기준 `_headers`/forbidden URL QA는 별도 확인 필요.”로 표기한다.

남은 단계는 JS/CSS cache header conservative relaxation, large asset/CSS/JS duplication audit, post-deploy usage monitoring이다.

## 2. General Web Cache Strategy

일반 원칙은 다음과 같다.

- URL이 바뀌지 않는데 내용이 바뀌는 파일은 `no-cache` 또는 짧은 cache가 안전하다.
- URL이 배포마다 바뀌는 파일은 긴 cache를 줄 수 있다.
- 이미지/폰트처럼 immutable cache를 주는 파일은 같은 파일명을 덮어쓰지 않고 새 파일명 또는 새 key를 사용한다.
- HTML은 배포 진입점이므로 보수적으로 재검증한다.
- 배포 버전 확인 파일은 항상 최신이어야 하므로 `no-store`에 가깝게 운영한다.
- CMS/API 데이터는 정적 파일 캐시와 분리해서 Firestore read, localStorage/sessionStorage, 화면 상태 cache 기준으로 본다.
- hard refresh는 정상 운영 절차가 아니라 개발자/관리자 troubleshooting 예외다.

## 3. Current Project Cache/Version Architecture

현재 확인된 구조는 다음과 같다.

- 현재 운영 배포는 Cloudflare Pages가 `dist`를 제공하는 구조다. `firebase.json`의 Hosting 설정은 현재 일반 운영 배포 기준이 아니다.
- `version.json`은 `no-cache, no-store, must-revalidate`다.
- `assets/**/*.js`와 `assets/**/*.css`는 `no-cache, must-revalidate`다.
- 이미지/WebP/폰트는 긴 `public,max-age=31536000,immutable` cache다.
- CSV/PDF는 `public,max-age=86400`이다.
- `**/*.html`과 `assets/partials/**/*.html`은 `no-cache, must-revalidate`다.
- 감사 시점의 HEAD 요청에서 `/index.html`은 `no-cache`였지만 root `/`는 `max-age=3600`으로 관찰됐다. 이후 로컬 소스에는 root `/` header normalization이 구현되었으며, 운영 배포 및 운영 URL header 재검증은 별도 확인이 필요하다.
- `scripts/prebuild.js`는 `dist`를 생성하고, HTML에 `grit-build-version` meta를 주입하며, top-level CSS/JS URL에 `?v={version}`을 붙인다.
- `scripts/prebuild.js`는 `dist/version.json`에 `version`, `timestamp`, `buildDate`를 저장한다.
- `assets/js/common.js`는 `/version.json`을 `cache: "no-store"`로 확인하고 새 버전 prompt에서 일반 `window.location.reload()`를 호출한다.
- 현재 source에는 service worker, `skipWaiting`, hard refresh 강제 흐름이 없다.
- Phase D-1 이후 generated `dist/assets/js/**/*.js`의 local ES module import/export/side-effect/dynamic import는 build version query를 갖는다.
- Phase D-2 이후 `assets/js/common.js`의 `/assets/partials/*.html` fetch는 build version query를 사용한다.
- Phase D-3 이후 public instructor/R2/local image URL에는 `Date.now()` 또는 render timestamp query를 붙이지 않는다.

## 4. Static Files vs CMS Data Boundary

| Change Type | Examples | Where It Changes | Cache Concern | Normal Operation |
| --- | --- | --- | --- | --- |
| HTML/CSS/JS code | page HTML, `assets/js/**`, `assets/css/**` | source tree then `dist` | Hosting cache, build version, stale module risk | `prebuild` 후 production branch push, Cloudflare Pages 배포 |
| Fixed local image/brand asset | logo, hero, footer fixed image, local fallback image | `assets/**` | immutable cache; same filename overwrite can stay stale | 새 파일명 사용, `prebuild` 후 Cloudflare Pages 배포 |
| Static data file | `assets/school.csv` | `assets/**` then `dist` | 1-day cache and large download size | 변경 시 `prebuild` 후 Cloudflare Pages 배포; fetch policy 확인 |
| PDF/legal file | footer/legal PDF | `assets/**` then `dist` | 1-day cache; URL identity matters | 중요한 교체는 새 파일명 검토 |
| R2 public CMS image | popup, instructor profile, instructor curriculum | Cloudflare R2 object + Firestore URL | R2/CDN cache; same key overwrite can stay stale | 새 R2 key 업로드 후 CMS URL 교체 |
| CMS text/settings | popup text, site copy, course metadata, timetable visibility | Firestore | Hosting cache 대상 아님; app/local cache 가능 | CMS 저장 후 일반 화면 확인 |
| Auth/account data | students, members, instructors, roles | Firebase Auth + Firestore | Hosting cache 대상 아님 | 관리자 UI 또는 Console 절차 |
| Firestore rules/schema-sensitive behavior | rules, code expecting new fields | repo config/code + deploy | stale JS and rules mismatch risk | 별도 설계, QA, deploy |

핵심 기준은 단순하다. 파일이 `dist`로 배포되어 브라우저가 URL로 받는 자원이면 Hosting cache 문제다. Firestore 문서 값이 바뀌는 문제면 Hosting cache보다 데이터 저장, 읽기, local cache, 화면 렌더링을 먼저 본다.

## 5. Current Gaps

완료된 gap:

- JS 내부 ES module static import/export, side-effect import, dynamic import versioning은 Phase D-1에서 generated dist 기준으로 적용했다.
- `/assets/partials/*.html` fetch versioning은 Phase D-2에서 적용했다.
- `assets/school.csv` fetch는 Phase D-3에서 build version query + `force-cache` + Promise/data 재사용으로 정리했다.
- public instructor/R2/local image URL의 `Date.now()`/render timestamp query cache-buster는 Phase D-3에서 제거했다.
- root `/` cache normalization은 Phase D-3에서 로컬 소스에 구현했다.

남은 gap:

- JS/CSS cache header는 아직 `no-cache, must-revalidate`이며, 짧은 완화 여부는 배포 후 browser QA 이후 검토한다.
- 운영 URL에서 `/`, `/index.html`, `/version.json`, `/assets/school.csv` HEAD와 주요 화면 Network를 재확인해야 한다.
- 큰 asset/CSS/JS 중복, `main.css` 크기, `school.csv` 실제 운영 중복 요청은 별도 감사가 필요하다.
- CMS 데이터 반영 문제를 정적 Hosting cache 문제처럼 hard refresh로 처리하지 않도록 운영 안내를 계속 유지해야 한다.

## 6. Target Policy

| Resource/Data Class | Target Cache/Version Policy | Update Workflow | Gate |
| --- | --- | --- | --- |
| HTML entry pages and root `/` | `no-cache, must-revalidate`; root and `/index.html` behavior aligned | `prebuild` and deploy | HEAD 확인에서 root와 HTML 정책 일치 |
| `version.json` | `no-cache, no-store, must-revalidate` 유지 | `prebuild` and deploy | HTML `grit-build-version`과 값 일치 |
| JS/CSS top-level files | 모든 참조가 versioned URL이면 단계적으로 longer cache 검토 | `prebuild` and deploy | module/import/fetch coverage 통과 전 header 완화 금지 |
| JS module imports and dynamic imports | build output에서 version query 또는 동등한 cache-busting 보장 | `prebuild` rewrite or equivalent | public/admin 주요 페이지 stale module QA 통과 |
| HTML partials | versioned fetch 또는 `no-cache` 유지 중 하나로 명확화 | `prebuild` and deploy | header/footer 변경 후 일반 reload로 반영 |
| Fixed local images/fonts | long immutable cache; same filename overwrite 금지 | 새 filename/path 후 deploy | 기존 URL 재사용 없음 |
| R2 public images | long cache 가능; same key overwrite 금지 | 새 R2 key 업로드 후 CMS URL 변경 | old/new URL 동시 확인, rollback 가능 |
| CSV/PDF | 1-day cache 유지 또는 versioned filename/fetch로 전환 | 변경 시 deploy | 큰 파일 download 영향 확인 |
| Firestore CMS data | Hosting cache와 분리; app cache TTL/invalidation 기준 | CMS 저장 | Firestore 값, local cache, 화면 렌더 확인 |
| External CDN modules/fonts | provider cache에 의존; URL/version pin 유지 | dependency 변경 시 별도 검토 | CDN 장애/버전 변경 리스크 확인 |

## 7. Phased Implementation Roadmap (Phase 0-7)

2026-06-24 기준 완료/잔여 상태:

| Phase | 상태 |
| --- | --- |
| Phase 1 policy alignment | 완료 |
| Phase 2 version coverage audit | 완료 |
| Phase D-1 module import versioning | 완료 |
| Phase D-2 partial fetch versioning | 완료 |
| school.csv fetch/cache cleanup | 완료 |
| image cache-buster cleanup | 완료 |
| root cache normalization implementation | 완료 |
| JS/CSS cache header conservative relaxation | 남음 |
| large asset/CSS/JS duplication audit | 남음 |
| post-deploy usage monitoring | 남음 |

### Phase 0. Baseline and documentation

- 현재 `firebase.json`, `prebuild.js`, `common.js`, 운영 문서, 비용 문서 기준을 고정한다.
- 이 문서를 cache/version/source-of-truth plan으로 둔다.
- 구현 없이 현재 gap과 gate를 합의한다.

### Phase 1. Version coverage audit

- HTML top-level CSS/JS 참조를 재확인한다.
- JS static import, dynamic import, relative import graph를 목록화한다.
- partial fetch, JSON fetch, CSV fetch를 목록화한다.
- build 후 `dist`에서 실제 URL에 version query가 붙는 범위를 확인한다.
- 2026-06-23 기준 `docs/audits/VERSION_COVERAGE_AUDIT.md`로 B-1 audit을 완료했다.

### Phase 2. Version coverage fix

- JS 내부 module import와 dynamic import에 version query를 붙이는 방식을 구현한다.
- partial fetch의 version 정책을 명확히 한다.
- `version.json`과 HTML meta의 build version 일치를 자동 검증한다.
- 이 단계가 끝나도 즉시 long cache로 바꾸지 않고 QA를 먼저 수행한다.

### Phase 3. Root and HTML cache normalization

- root `/`와 `/index.html` cache header 차이를 재확인한다.
- Firebase Hosting header 또는 rewrite 동작을 검토한다.
- 홈 진입 경로별 새 배포 반영 시간을 맞춘다.

### Phase 4. JS/CSS cache header relaxation

- version coverage QA가 통과한 뒤 JS/CSS header를 보수적으로 완화한다.
- 먼저 짧은 `max-age`로 검증하고, 안정화 후 더 긴 cache를 검토한다.
- admin page stale JS 리스크를 public page보다 더 엄격하게 본다.

### Phase 5. Image cache-buster cleanup

- local `/assets` 이미지의 `Date.now()` query가 필요한 지점을 재분류한다.
- fixed asset은 새 filename 원칙으로 정리한다.
- R2 public image는 새 key 원칙으로 정리하고 불필요한 query cache-buster를 줄인다.

### Phase 6. Static data and large asset policy

- `assets/school.csv` fetch cache mode와 파일 크기를 점검한다.
- PDF/legal 문서의 cache와 filename 교체 기준을 문서화한다.
- 더 자주 바뀌는 public file은 R2 또는 versioned filename 후보로 분리한다.

### Phase 7. Operations and monitoring

- 배포 후 version prompt와 일반 reload 절차를 운영 매뉴얼에 반영한다.
- Cloudflare Pages/R2 usage, Firebase Hosting old URL 404 유지 여부, Firestore reads를 월간 체크리스트로 본다.
- hard refresh 요청이 반복되면 cache 정책 문제가 아니라 배포/version coverage 문제로 재점검한다.

## 8. Implementation Gate Criteria

다음 gate를 통과하기 전에는 JS/CSS cache header를 길게 늘리지 않는다.

- `rg` 기준 JS static import, dynamic import, partial fetch 목록이 최신이다.
- build output에서 top-level JS/CSS와 내부 module import의 version 정책이 설명 가능하다.
- `dist/version.json`과 HTML `grit-build-version`이 일치한다.
- `/`, `/index.html`, major public pages, major admin pages의 response header를 확인했다.
- 새 배포 후 version prompt가 한 번 뜨고 일반 reload로 해결된다.
- service worker나 hard refresh 강제 흐름이 새로 추가되지 않았다.
- CMS 데이터 변경은 Firestore 저장/읽기/local cache 기준으로 따로 QA했다.
- R2 public image 교체는 같은 key overwrite 없이 새 key로 검증했다.
- fixed local asset 교체는 같은 filename overwrite 없이 새 filename으로 검증했다.

## 9. QA Plan

- `prebuild` 산출물에서 `version.json`, HTML meta, JS/CSS URL query를 확인한다.
- browser cache enabled 상태로 first visit/repeat visit/after deploy waterfall을 비교한다.
- DevTools Disable cache 상태의 다운로드 관찰값은 일반 사용자 값으로 해석하지 않는다.
- `/`와 `/index.html`의 `Cache-Control` header를 각각 확인한다.
- public pages: home, courses, course detail, instructors, instructor detail, schedule, story, contact를 확인한다.
- admin pages: dashboard, popup, site, instructors, courses, offline classes, timetable을 확인한다.
- JS module stale test는 내부 utility 파일 변경 시 새 코드가 반영되는지로 본다.
- partial fetch test는 header/footer 변경 후 일반 reload에서 최신 partial이 반영되는지로 본다.
- CMS data test는 Firestore 값 변경 후 배포 없이 화면이 바뀌는지로 본다.
- R2 image test는 새 key URL 저장 후 popup/profile/curriculum 이미지가 바뀌는지로 본다.
- fixed local asset test는 새 filename 배포 후 old/new URL cache가 분리되는지로 본다.

## 10. Operator Manual

운영자는 먼저 변경 유형을 구분한다.

- 코드, HTML, CSS, JS, local `/assets` 파일 변경은 개발자 작업이며 `prebuild`와 deploy가 필요하다.
- CMS 문구, 팝업 설정, 강사 소개, 시간표 노출 여부 변경은 Firestore 데이터 변경이며 deploy가 필요하지 않다.
- CMS 변경이 바로 안 보이면 먼저 저장 성공, Firestore 값, 화면의 local cache/session cache, 일반 reload를 확인한다.
- CMS 데이터 반영 문제에 일반 사용자 hard refresh를 반복 안내하지 않는다.
- fixed local image는 같은 파일명을 덮어쓰지 않고 새 파일명을 사용한다.
- R2 public image는 같은 key를 덮어쓰지 않고 새 key를 사용한 뒤 CMS URL을 바꾼다.
- 배포 후 새 버전 안내가 뜨면 일반 새로고침으로 처리한다.
- DevTools Disable cache는 QA 조건으로 기록하고 일반 사용자 운영 안내로 쓰지 않는다.

## 11. Risks

- JS/CSS cache를 너무 빨리 늘리면 내부 module import가 stale해질 수 있다.
- build-time import rewrite가 문자열/주석/외부 URL을 잘못 처리할 수 있다.
- root `/`와 `/index.html` cache 정책이 계속 다르면 홈 반영 시간이 사용자마다 다르게 보일 수 있다.
- admin JS가 stale이면 Firestore schema 또는 UI 검증 기대값과 충돌할 수 있다.
- `Date.now()` cache-buster를 무조건 제거하면 실제로 필요한 image refresh가 늦어질 수 있다.
- R2 public key overwrite는 오래된 이미지 노출과 rollback 혼선을 만든다.
- Hosting download 감소가 Firestore read 또는 R2 request 증가로 이동할 수 있다.
- CMS 데이터 문제를 hard refresh로 처리하면 원인 파악이 늦어지고 사용자 안내가 과해진다.

## 12. Recommended Next Step

다음 구현 후보를 기준으로 보면 선택지는 다음과 같다.

| Option | Candidate | Recommendation |
| --- | --- | --- |
| A | root `/` cache header normalization first | 중요하지만 JS/CSS long cache 전제 조건은 아니다. Phase 3에서 처리한다. |
| B | version coverage audit/fix first | **권장.** ES module import, dynamic import, partial fetch coverage를 먼저 닫아야 한다. |
| C | JS/CSS cache header relaxation first | 비권장. coverage 전에는 stale module 위험이 크다. |
| D | image cache-buster cleanup first | 유효하지만 JS/CSS 정책의 선행 조건은 아니다. Phase 5에서 처리한다. |
| E | defer implementation and only monitor | 현재 gap이 확인되어 있으므로 다음 구현 전 gate 정리가 필요하다. |

따라서 다음 구현은 **B. version coverage audit/fix first**로 진행한다. 구현 순서는 Phase 1 audit, Phase 2 coverage fix, QA gate 통과, Phase 3 root normalization, Phase 4 JS/CSS header relaxation 순서가 가장 안전하다.

Phase 1 audit 완료 후 세부 다음 단계는 `docs/audits/VERSION_COVERAGE_AUDIT.md`의 Recommendation을 따른다. 현재 추천은 **D. ES module import versioning first**이며, partial fetch versioning, R2/Date.now image cache-buster cleanup, root cache normalization, JS/CSS cache header relaxation은 그 뒤 gate 순서로 검토한다.

## 13. Phase D-1 Status

2026-06-23에 Phase D-1로 ES module/dynamic import versioning을 `scripts/prebuild.js`에 구현했다. `npm run prebuild` 후 `dist/assets/js/**/*.js`의 local JS module specifier는 static import/export, side-effect import, dynamic import를 포함해 build version query가 적용된다.

Phase 2 coverage fix에서 남은 항목은 다음 순서로 다룬다.

1. partial fetch versioning: `common.js`의 `/assets/partials/${includeType}.html` runtime fetch에 build version을 전달하거나 prebuild rewrite 범위를 확정한다.
2. `school.csv` fetch policy 정리: default/force-cache/no-store 사용처를 운영 정책에 맞춰 통일한다.
3. R2/public image `Date.now()` cache-buster cleanup: query cache-buster 대신 새 R2 key/filename 정책으로 정리한다.
4. root `/` cache normalization과 JS/CSS cache header relaxation은 coverage QA 이후 별도 Phase에서 진행한다.

## 14. Phase D-2 Status

2026-06-23에 Phase D-2로 partial fetch versioning을 `assets/js/common.js`에 구현했다. `common.js`는 HTML `grit-build-version` meta를 읽는 기존 `getCurrentBuildVersion()`을 재사용하고, `/assets/partials/*.html` URL에만 `?v={buildVersion}`를 붙이는 `withBuildVersion()` helper를 통해 header/footer partial fetch를 처리한다.

이번 단계에서 `/version.json` no-store fetch, `/assets/school.csv`, Firestore/API 요청, external/R2 URL, `firebase.json` cache header는 변경하지 않았다.

Phase 2 coverage fix에서 남은 항목은 다음 순서로 다룬다.

1. `school.csv` fetch policy 정리: default/force-cache/no-store 사용처를 운영 정책에 맞춰 통일한다.
2. R2/public image `Date.now()` cache-buster cleanup: query cache-buster 대신 새 R2 key/filename 정책으로 정리한다.
3. root `/` cache normalization과 JS/CSS cache header relaxation은 coverage QA 이후 별도 Phase에서 진행한다.

## 15. Phase D-3 Status

2026-06-23에 Phase D-3으로 `school.csv` fetch/cache, public image cache-buster, root `/` cache header를 정리했다.

- `assets/js/utils/school-csv.js`: build version query + `force-cache` + 페이지 생명주기 Promise 캐시
- public instructor pages: `Date.now()`/render timestamp image cache-buster 제거
- `firebase.json`: `/` root에 HTML과 동일한 `no-cache, must-revalidate` 적용

이번 단계에서 JS/CSS cache header, `version.json` no-store fetch, Firestore/API 요청, content hash 파일명, Service Worker는 변경하지 않았다.

다음 단계:

1. 운영 배포 후 `/`, `/index.html`, `/version.json`, `/assets/school.csv` HEAD와 browser Network 확인
2. browser QA 후 JS/CSS cache header의 짧은 완화 여부 검토
3. 큰 asset/CSS/JS 중복 정리 검토
4. Cloudflare Pages/R2 usage, Firebase Hosting old URL 404 유지, `school.csv` 중복 요청 관찰
