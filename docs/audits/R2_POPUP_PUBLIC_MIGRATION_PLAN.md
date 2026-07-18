# R2 Popup Public Migration Plan

작성일: 2026-06-17

## 0. 2026-06-29 현재 해석 기준

이 문서는 popup R2 public 전환의 구현 전 설계 기록입니다. 현재 운영 기준은 다음과 같이 정리되었습니다.

- popup main/content image는 R2 public URL 운영 가능 상태입니다.
- 운영 R2 public base URL은 `https://assets.gritedu.kr`입니다.
- `operationTasks` 기반 popup asset cleanup task 생성 로직은 제거되었고, `operationTasks`는 legacy 문서입니다.
- 운영 기록 정리는 `scheduledRecordCleanup` 자동 정리와 관리자 수동 UI가 담당하며, popup image cleanup task와 분리되었습니다.
- Firebase Hosting은 disable 완료 상태이며, 일반 정적 배포는 `git push origin main` 후 Cloudflare Pages 자동 배포입니다.

아래 본문은 과거 구현 전 검토와 rollback 근거로 유지합니다. 현재 source-of-truth는 `docs/IMAGE_ASSET_POLICY.md`, `docs/OPERATION_MANUAL.md`, `md/DATABASE_SCHEMA.md`입니다.

## 1. Executive Summary

이 문서는 `settings/popups.popups[].imageUrl` 기반 팝업 이미지를 현재 `/assets/popup/*.webp` 중심 운영에서 Cloudflare R2 public 이미지 운영으로 전환하기 위한 구현 전 설계다. 이번 범위에서는 구현하지 않고, 실제 소스 기준으로 필요한 변경 범위와 정책만 좁힌다.

추천 방식은 **Option A: Firestore에 R2 public HTTPS URL 직접 저장**이다.

현재 코드가 이미 `https://...` 이미지 URL을 허용하고, 공개 렌더링도 `imageUrl`을 그대로 `<img src>`에 넣는 구조이기 때문이다. 1차 실험에서는 Firestore schema를 바꾸지 않고 기존 `imageUrl` 필드에 R2 public HTTPS URL을 저장하는 편이 가장 작고 되돌리기 쉽다.

Option B인 `imageProvider`/`imageKey` metadata 방식은 장기적으로 더 정돈된 모델이지만, 현재 popup public 이미지 1차 실험에는 코드 변경량이 크고 private R2 자료실 설계와 섞일 가능성이 있다. public popup 실험이 안정화된 뒤, 자료실/리포트 private R2 설계와 함께 다시 판단한다.

## 2. Current Popup Image Flow

현재 팝업 관리 화면은 `members/admin/popup.html`에서 `assets/js/pages/admin-popup.js`를 로드한다. 대표 팝업 이미지는 `popupEditImageUrl` input에 문자열로 입력한다. HTML placeholder는 `/assets/popup/popup-image.webp`이고, 안내 문구는 선택한 파일을 `assets/popup` 폴더에 넣은 뒤 배포하면 CMS에는 `/assets/popup/...` 경로만 저장된다고 설명한다.

이미지 파일 선택 흐름은 실제 업로드가 아니다. `admin-popup.js`의 `handlePopupImageUpload()`는 사용자가 고른 파일명을 안전한 WebP 파일명으로 바꾸고, `defaultPath = /assets/popup/{safeFileName}`을 input에 넣는다. 동시에 object URL로 로컬 미리보기만 제공한다. 실제 파일은 여전히 운영자/개발자가 로컬 `assets/popup`에 배치하고 prebuild/deploy해야 한다.

대표 이미지 경로 정규화는 `normalizePopupImagePath()`에서 수행된다. 이 함수는 `https://`로 시작하면 그대로 반환하고, local 파일/Windows path/dist path 형태는 `/assets/popup/{file}.webp`로 정규화한다.

저장 전 검증은 `isSafePopupImagePath()`에서 이루어진다. 허용값은 비어 있는 값, `/assets/popup/[A-Za-z0-9._-]+.webp`, 또는 `https://...`다. 따라서 R2 public HTTPS URL은 이미 형식상 허용된다.

미리보기와 존재 확인은 두 흐름으로 나뉜다.

| Flow | Current Behavior | R2 Public URL 영향 |
| --- | --- | --- |
| `updateImagePreview()` | normalized `imageUrl`을 `<img>` probe와 preview image src로 사용 | `https://` R2 URL도 브라우저에서 로드 가능 |
| `validatePopupActualImagePath()` | `new Image()`로 이미지 load/error 확인 | R2 public URL의 CORS가 없어도 단순 image load는 가능해야 함 |
| `checkPopupAssetPathAvailable()` | local `/assets/popup/*.webp`만 실제 존재 check, 그 외 값은 `true` 처리 | R2 URL은 local missing warning 없이 저장됨 |
| `getLocalDistPreviewPath()` | local `/assets/popup/*.webp` fallback만 반환 | R2 URL에는 local fallback 없음 |

저장 시 `savePopup()`은 popup object에 `imageUrl`, `imageLinkUrl`, `content`, `contentLinkUrl` 등을 넣고 `settings/popups` 문서에 배열로 저장한다. `settings/popups`는 Firestore rules에서 public read, admin write다. 저장 후 local popup cache를 clear하고, 이전 이미지가 바뀐 경우 cleanup task 생성을 시도한다.

공개 페이지 렌더링은 `assets/js/pages/home-popup.js`가 담당한다. `loadPopupSettings()`가 `settings/popups` 문서를 읽고, `normalizePopup()`이 `popup.imageUrl`을 `normalizeSafeUrl()`로 정리한다. `normalizeSafeUrl()`은 root-relative `/...`와 `https://...`를 허용한다. 이후 `createPopupElement()`가 `imageUrl`을 escape한 뒤 `<img src="${safeImageUrl}" class="popup-main-image">`로 렌더링한다.

대표 `imageUrl`과 popup content 내부 `<img>`는 별도다. 대표 `imageUrl`은 팝업 상단/main image 영역으로 렌더링된다. content 내부 이미지는 rich editor의 HTML 안에 들어가며, 저장 전 `data-image-path` 또는 `data-save-path`가 있으면 `img.src`로 치환된다. 공개 렌더링에서는 `sanitizePopupContent()`가 content 내부 `<img src>`도 `normalizeSafeUrl()`로 검사하므로 `/...`와 `https://...`만 남는다.

운영 정리 task는 local asset 전용이다. `assets/js/utils/operation-tasks.js`의 `normalizePopupAssetPath()`는 `assets/popup/*.webp`만 `/assets/popup/*.webp`로 정규화하고, `isLocalPopupWebpAsset()`가 local popup WebP일 때만 cleanup task 생성을 허용한다. R2 public HTTPS URL은 `not_local_popup_asset`로 skip되어야 한다.

prebuild는 source 안의 `/assets/...` 이미지 참조를 검사한다. `scripts/prebuild.js`의 `assetImageRefPattern`은 선택적 `https://...` prefix 뒤에 `/assets/...`가 있는 이미지를 local asset reference로 해석하고, 누락되면 `missingReferences`에 넣는다. `assets/popup`은 WebP preferred directory라 PNG/JPG source에 WebP counterpart warning도 발생할 수 있다. `https://cdn.example.com/public/popup/...`처럼 path에 `/assets/`가 없는 R2 URL은 local asset missing check 대상이 아니다.

Firebase Hosting cache는 `firebase.json`에서 `assets/**/*.@(png|jpg|jpeg|gif|webp|svg)`와 `assets/**/*.webp`에 `public,max-age=31536000,immutable`을 준다. 현재 `/assets/popup/*.webp`를 같은 파일명으로 교체하면 오래된 cache가 남을 수 있다. R2 public 전환도 같은 filename overwrite를 피하고 versioned key를 써야 한다.

## 3. Option A: Store R2 Public HTTPS URL

예시:

```text
https://cdn.example.com/public/popup/2026/popup-id-hash.webp
```

| 항목 | 검토 |
| --- | --- |
| 장점 | 기존 `imageUrl` 필드 유지. Firestore shape 변경 없음. `home-popup.js`가 이미 `https://`를 허용. 관리자 preview도 브라우저 image load로 확인 가능. rollback은 기존 `/assets/popup/...` 값으로 되돌리면 됨. |
| 단점 | Firestore 값이 특정 public domain에 묶인다. provider/key metadata가 없어 나중에 R2 domain 교체 시 Firestore 값 migration이 필요할 수 있다. private R2와 구조적으로 구분되는 metadata가 없다. |
| 현재 `home-popup.js` 호환성 | 높음. `normalizeSafeUrl()`은 `https://`를 허용하고 `createPopupElement()`는 `<img src>`에 그대로 사용한다. |
| 관리자 preview 호환성 | 높음. `updateImagePreview()`와 `validatePopupActualImagePath()`가 `new Image()` 기반으로 URL을 load한다. 단 원격 이미지 접근이 public이어야 한다. |
| rollback 난이도 | 낮음. `settings/popups.popups[].imageUrl`만 기존 local path로 되돌리면 된다. 기존 local file은 삭제하지 않는다. |
| prebuild 영향 | 작음. R2 URL path가 `/assets/...`를 포함하지 않으면 local missing asset check 대상이 아니다. |
| vendor lock-in | 중간. Firestore에 public URL을 직접 저장하므로 R2 public domain 변경 시 데이터 migration이 필요하다. |
| 캐시 무효화/버전 key 정책 | 필수. 같은 key overwrite 금지, hash/timestamp 포함 key 사용, old object는 비활성/보존 후 정리한다. |

Option A는 1차 실험에 맞다. 현재 코드가 이미 허용하는 `https://` 경로를 이용하므로, 최소 변경으로 실제 공개 이미지 전환을 검증할 수 있다.

## 4. Option B: Store R2 Provider/Key Metadata

예시:

```text
imageProvider: "r2"
imageKey: "public/popup/2026/popup-id-hash.webp"
imageUrl: null
```

| 항목 | 검토 |
| --- | --- |
| 장점 | Firestore가 storage provider와 public URL 생성 방식을 분리한다. R2 domain 교체가 쉬워진다. 나중에 private R2와 public R2의 개념을 명확히 나눌 수 있다. |
| 단점 | 현재 popup renderer와 admin CMS 모두 `imageUrl` 문자열 중심이라 helper와 schema migration이 필요하다. 구현량이 1차 실험치고 크다. |
| 필요한 코드 변경량 | 큼. `admin-popup.js`, `home-popup.js`, cleanup task, validation, migration script가 provider/key를 이해해야 한다. |
| public URL 생성 helper | 필요. 예: `buildPublicAssetUrl(provider, key)` 또는 popup-specific helper. domain config 위치도 정해야 한다. |
| private R2와 분리 장점 | 있음. private object는 `imageUrl` 직접 저장 금지, public object만 URL 생성 가능이라는 규칙을 코드로 강제하기 쉽다. |
| MVP 과함 여부 | 현재 범위에는 과하다. popup public image 하나의 실험보다 schema와 helper 설계가 커진다. |

Option B는 장기적으로 더 깨끗하지만, 지금 적용하면 public popup 실험과 private 자료실/R2 설계가 섞일 수 있다. private signed URL이 필요한 `materials`, `studentReports`, `assignments` 단계에서 provider/key metadata를 표준화하는 편이 낫다.

## 5. Recommended Approach

1차 R2 public popup image migration은 **Option A**로 진행한다.

판단:

| 기준 | 판단 |
| --- | --- |
| 구현 난이도 | 낮음. 기존 `imageUrl` 문자열 흐름을 유지한다. |
| 롤백 용이성 | 높음. Firestore `imageUrl` 값을 기존 `/assets/popup/...`로 되돌리면 된다. |
| 현재 CMS 구조 적합성 | 높음. 현재 admin popup UI도 `https://`를 허용한다. |
| private 자료실/R2와 미래 충돌 | 낮음. 단 문서에 "popup public only"를 명확히 두고, private signed URL 저장 금지를 유지해야 한다. |
| 운영자 이해 | 중간. `/assets` 대신 "R2 public URL"을 입력한다는 설명은 필요하다. |
| prebuild 충돌 | 낮음. R2 URL path에 `/assets/`를 넣지 않으면 local missing check와 충돌하지 않는다. |

권장 저장 형식:

```text
imageUrl: "https://cdn.example.com/public/popup/2026/popup-id-hash.webp"
```

권장 제한:

- popup 대표 이미지와 popup content 내부 image는 public image만 허용한다.
- R2 private signed URL은 `settings/popups`에 저장하지 않는다.
- 1차 실험에서는 기존 local `/assets/popup/...` 값을 일괄 변환하지 않는다.
- 새 popup 또는 테스트 popup 1개만 R2 public URL로 시작한다.
- 기존 `/assets/popup` 파일은 rollback을 위해 유지한다.

## 6. R2 Key And Cache Policy

추천 key prefix:

```text
public/popup/{yyyy}/{popupId}-{hash}.webp
```

예시:

```text
public/popup/2026/popup_winter_lecture-a1b2c3d4.webp
```

정책:

| 항목 | 정책 |
| --- | --- |
| 덮어쓰기 | 금지. 같은 popup 이미지를 교체할 때도 새 key를 만든다. |
| hash/timestamp | hash 권장. 구현이 어렵다면 `popupId-yyyyMMddHHmmss` timestamp를 임시 사용한다. |
| 파일명 | ASCII lowercase, 숫자, hyphen, underscore만 허용한다. 한글/공백/괄호는 금지하고 sanitize한다. |
| 확장자 | 1차는 `.webp`만 허용한다. source가 PNG/JPG여도 업로드 전 WebP 변환 후 R2에 올린다. |
| cache | public object는 긴 cache를 줄 수 있다. 단 immutable에 가깝게 운영하려면 반드시 versioned key를 사용한다. |
| rollback | 기존 local `/assets/popup/...` 파일과 Firestore local path를 유지한다. rollback은 `imageUrl`만 되돌린다. |
| 삭제/비활성화 | 새 object가 안정화될 때까지 old R2 object와 local asset은 즉시 삭제하지 않는다. 삭제는 별도 cleanup task 또는 운영 체크 후 한다. |
| R2 public domain | path에 `/assets/`를 넣지 않는다. prebuild가 local asset으로 오판하지 않게 `https://cdn.example.com/public/popup/...` 형태를 권장한다. |

R2 object metadata 후보:

```text
cache-control: public, max-age=31536000, immutable
content-type: image/webp
x-grit-area: popup
x-grit-public: true
```

## 7. Future Code Impact

| File | Current Behavior | Future Change | Risk | Test |
| ---- | ---------------- | ------------- | ---- | ---- |
| `members/admin/popup.html` | 이미지 input placeholder와 hint가 `/assets/popup/...` local workflow만 안내 | R2 public URL 허용 안내, local path와 R2 URL 차이 설명, 가능하면 label/hint 변경 | 운영자가 R2 URL을 파일 업로드 완료로 오해 | 관리자 화면에서 local path와 R2 URL 입력 문구 확인 |
| `assets/js/pages/admin-popup.js` | `imageUrl`에 `/assets/popup/*.webp` 또는 `https://` 허용. local path만 existence check 및 cleanup task 대상 | R2 public URL domain allowlist, R2 URL preview 상태 메시지, local missing warning 분리, optional R2 URL pattern validation | 임의 외부 이미지 hotlink 허용 또는 깨진 R2 URL 저장 | local path save, R2 URL save, invalid http/non-image URL reject, preview load/error |
| `assets/js/pages/home-popup.js` | `imageUrl`과 content `<img src>`에 `/...` 또는 `https://` 허용 후 `<img src>` 렌더링 | Option A에서는 큰 변경 없음. 필요 시 R2 domain allowlist 또는 public image error logging 추가 | 외부 URL이 너무 넓게 허용됨 | 홈에서 local popup, R2 popup, content image popup 렌더링 확인 |
| `assets/js/utils/operation-tasks.js` | local `/assets/popup/*.webp`만 cleanup task 생성. R2 URL은 skip | R2 object cleanup은 별도 task type으로 분리하거나 1차에서는 생성하지 않음 | R2 object 교체 후 orphan object 누적 | local path 교체 시 기존 cleanup 유지, R2 URL 교체 시 local cleanup이 생기지 않는지 확인 |
| `scripts/prebuild.js` | `/assets/...` 이미지 참조를 local asset으로 검사. `assets/popup` WebP preferred warning 생성 | R2 public URL은 local missing ref에서 제외. R2 path에 `/assets/` 금지 또는 allowlist 처리. 별도 R2 URL 검증 command는 후순위 | CDN URL을 local asset으로 오판하거나 깨진 R2 URL을 build에서 못 잡음 | source scan에 R2 URL 추가 후 prebuild warning 설계 검토 |
| `firebase.json` | Firebase Hosting `/assets/**/*.webp`는 `public,max-age=31536000,immutable` | local popup이 줄어들면 Hosting cache 영향 감소. R2 public cache는 Cloudflare 쪽 설정으로 분리 | local/R2 cache 정책 불일치 | local fallback popup과 R2 popup 교체 후 stale 여부 수동 QA |
| `docs/OPERATION_MANUAL.md` | popup 이미지는 `/assets/popup/*.webp`, local file 배치, prebuild/deploy workflow 안내 | R2 public popup workflow, rollback, 민감 정보 금지, local fallback 유지 절차 추가 | 운영 문서와 실제 CMS 동작 불일치 | 운영자용 절차 리뷰 |
| `docs/IMAGE_ASSET_POLICY.md` | CMS/Firestore에는 `/assets/...`를 저장한다는 현행 정책 | R2 public 예외를 popup부터 명시. `/assets`는 고정/local fallback, popup dynamic image는 R2 public 가능으로 보정 | policy drift | 문서 색인과 감사 문서 간 용어 일치 확인 |

나중에 추가로 영향을 받을 수 있는 파일:

- `docs/audits/ASSETS_R2_MIGRATION_AUDIT.md`: 실제 구현 후 결과 반영
- `assets/js/utils/image-upload.js`: R2 업로드 UI가 들어오면 local save helper와 분리
- future migration script: Firestore `settings/popups` export/import 또는 manual update helper

## 8. Firestore Data Migration Plan

1차 실험은 migration이 아니라 **혼재 허용**으로 시작한다.

현재 데이터:

```text
settings/popups
  popups: [
    {
      imageUrl: "/assets/popup/example.webp"
    }
  ]
```

1차 R2 popup:

```text
settings/popups
  popups: [
    {
      imageUrl: "https://cdn.example.com/public/popup/2026/popup-id-hash.webp"
    }
  ]
```

권장 전략:

| 항목 | 제안 |
| --- | --- |
| 기존 local path | 유지한다. 기존 popup은 건드리지 않는다. |
| 새 popup | R2 public URL을 허용한다. 가능하면 테스트 popup 1개부터 적용한다. |
| 기존 popup 일괄 변환 | 1차에서는 하지 않는다. 실제 운영 데이터와 이미지 파일 사용 여부 확인 후 별도 단계로 진행한다. |
| rollback | 해당 popup의 `imageUrl`을 기존 `/assets/popup/...` 값으로 되돌린다. 기존 local asset 파일은 삭제하지 않는다. |
| 혼재 기간 | 허용한다. local path와 R2 URL이 동시에 존재할 수 있다. |
| 운영자 구분 | CMS에 "로컬 /assets 경로"와 "R2 public URL"의 차이를 표시한다. R2 URL은 공개 이미지에만 사용한다고 안내한다. |
| Firestore export | 변경 전 `settings/popups` 문서 snapshot을 저장한다. Firestore 데이터 변경 자체는 구현 단계에서만 수행한다. |

일괄 변환을 나중에 할 경우 필요한 절차:

1. `settings/popups.popups[].imageUrl`에서 `/assets/popup/*.webp` 목록을 export한다.
2. 실제 `assets/popup` 파일 존재 여부와 active popup 여부를 대조한다.
3. 각 파일을 R2 public key로 업로드한다.
4. Firestore update plan을 JSON diff로 만든다.
5. 1개 popup으로 검증 후 나머지를 변환한다.
6. local asset은 즉시 삭제하지 않고 rollback window 이후 cleanup한다.

## 9. Prebuild Impact

현재 prebuild는 source code와 HTML/Markdown 등에서 `/assets/...` 이미지 참조를 찾아 local 파일 존재 여부를 확인한다. `assets/popup`은 WebP preferred directory이므로 PNG/JPG에 대한 WebP counterpart warning도 낼 수 있다.

R2 public URL이 다음 형태라면 local missing asset으로 오판하지 않는다.

```text
https://cdn.example.com/public/popup/2026/popup-id-hash.webp
```

주의할 형태:

```text
https://cdn.example.com/assets/popup/popup-id-hash.webp
```

`scripts/prebuild.js`의 regex는 `https://.../assets/...`도 잡아 pathname을 local `/assets/...`로 바꾼다. 따라서 R2 public URL path에는 `/assets/` segment를 쓰지 않는 편이 안전하다.

정책:

- KEEP_LOCAL asset만 prebuild local missing check 대상으로 남긴다.
- R2 public URL은 build time에 필수 검증하지 않는다.
- R2 public URL 검증이 필요하면 별도 command로 분리한다. 예: Firestore export를 읽고 HEAD 요청으로 200/content-type/cache-control을 확인하는 read-only audit command.
- private R2 key는 source HTML/JS에 직접 들어오면 안 된다. private 파일은 build가 아니라 Functions signed URL 흐름에서 검증한다.
- popup local fallback을 유지하는 동안 `/assets/popup/*.webp` 검증은 그대로 둔다.

## 10. Security / Cost / Operations Notes

Security:

- R2 public popup 이미지는 누구나 접근 가능하다.
- popup image에는 학생 이름, 리포트, 성적, 출결, 과제, 내부 운영 정보 등 민감 정보를 넣지 않는다.
- `settings/popups`는 public read이므로 private signed URL, private R2 key, 임시 download URL을 저장하지 않는다.
- 자료실, 학생 리포트, 성적표, 과제 첨부는 popup public R2와 절대 섞지 않는다.
- Option A는 외부 HTTPS URL 저장을 유지하므로, 구현 단계에서는 R2 public domain allowlist를 둘지 검토해야 한다.

Cost:

- popup 이미지 트래픽이 Firebase Hosting에서 R2/Cloudflare public delivery로 이동하면 Hosting 다운로드 부담은 줄 수 있다.
- R2 request/download 비용은 별도로 모니터링해야 한다.
- cache hit가 높으면 비용은 작을 가능성이 높지만, popup 이미지가 큰 경우 최적화와 WebP 유지가 중요하다.

Operations:

- 운영자는 Cloudflare Dashboard에서 직접 파일을 바꾸지 않는 것이 원칙이다. 1차 실험 전에는 개발자가 R2 object와 URL을 준비하고 CMS에는 URL만 입력하는 방식이 현실적이다.
- 같은 key overwrite는 금지한다. 교체는 새 key 발급 후 Firestore `imageUrl` 변경으로 처리한다.
- R2 object 삭제는 즉시 하지 않는다. rollback window를 둔 뒤 사용 여부를 확인한다.
- local `/assets/popup` 파일은 1차 전환 중 삭제하지 않는다.

## 11. Implementation Checklist

구현 단계 전 준비:

- [ ] Cloudflare R2 bucket 또는 public custom domain 확정
- [ ] public URL base 확정. 예: `https://cdn.example.com`
- [ ] key prefix 확정. 예: `public/popup/{yyyy}/{popupId}-{hash}.webp`
- [ ] R2 public object cache-control/content-type 정책 확정
- [ ] 테스트 popup 이미지 1개 선정
- [ ] 기존 local rollback path 확인
- [ ] `settings/popups` 변경 전 snapshot/export 확보
- [ ] 운영 문구에서 local path와 R2 public URL 차이 설명 준비

구현 단계 코드 변경 후보:

- [ ] `members/admin/popup.html` 안내 문구 수정
- [ ] `assets/js/pages/admin-popup.js` R2 public URL 허용/검증/상태 메시지 보강
- [ ] `assets/js/pages/home-popup.js` 필요 시 R2 domain allowlist 또는 image error logging 보강
- [ ] `assets/js/utils/operation-tasks.js` local cleanup과 R2 cleanup을 분리
- [ ] `scripts/prebuild.js`가 R2 URL을 local `/assets` missing으로 오판하지 않도록 정책 확정
- [ ] `docs/OPERATION_MANUAL.md`, `docs/IMAGE_ASSET_POLICY.md` 문서 갱신

검증 후보:

- [ ] 기존 `/assets/popup/*.webp` popup 렌더링 유지
- [ ] R2 public HTTPS URL popup 렌더링
- [ ] R2 public URL preview load/error message
- [ ] invalid `http://` 또는 non-image URL reject
- [ ] popup content 내부 `<img src="https://...">` sanitize 후 렌더링
- [ ] popup image 교체 시 local cleanup task가 R2 URL에는 잘못 생성되지 않음
- [ ] rollback 후 기존 local popup 정상 표시

## 12. Rollback Plan

rollback 목표는 코드/rules/functions 배포 없이 Firestore 값만 되돌릴 수 있게 하는 것이다.

절차:

1. 변경 전 `settings/popups` snapshot을 확보한다.
2. R2 URL로 바꾼 popup의 이전 local `imageUrl` 값을 기록한다.
3. 문제가 생기면 해당 popup의 `imageUrl`을 기존 `/assets/popup/...`로 되돌린다.
4. local `/assets/popup` 파일은 전환 중 삭제하지 않았으므로 즉시 복구 가능해야 한다.
5. local cache 문제가 있으면 popup `updatedAt`/version 성격의 값이 있는지 확인하고, 브라우저 cache와 popup localStorage cache를 QA한다.
6. R2 object는 바로 삭제하지 않고, 비활성/cleanup 후보로 남긴다.

rollback 금지:

- R2 문제를 해결하려고 private signed URL을 `settings/popups`에 임시 저장하지 않는다.
- R2 object와 local asset을 동시에 삭제하지 않는다.
- `courses`, `materials`, `studentReports` 같은 다른 collection에 popup URL을 복사하지 않는다.

## 13. Commands Used

실제로 사용한 read-only 명령어:

```powershell
Get-Content -LiteralPath 'C:\Users\USEr\.codex\attachments\9d24b366-f1b3-40f3-b833-92cc8f6d280f\pasted-text.txt' -Raw -Encoding UTF8
git status --short
Get-Content -LiteralPath 'PROJECT_STATE.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'PROJECT_DOCS_INDEX.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\ERP_LMS_R2_BLUEPRINT.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\IMAGE_ASSET_POLICY.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\audits\ASSETS_R2_MIGRATION_AUDIT.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'ADMIN_CMS_STATE.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\OPERATION_MANUAL.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\FIREBASE_USAGE_AND_COST_AUDIT.md' -Raw -Encoding UTF8
Select-String -Path 'members\admin\popup.html' -Pattern 'imageUrl|popupEditImageUrl|assets/popup|popup-image|form-hint|script|stylesheet' -Context 2,3
Select-String -Path 'assets\js\pages\admin-popup.js' -Pattern 'normalizePopupImagePath|isSafePopupImagePath|getLocalDistPreviewPath|checkPopupAssetPathAvailable|updateImagePreview|popupEditImageUrl|setDoc\(doc\(db, "settings", "popups"\)|createPopupCleanupTask|imageUrl|https' -Context 2,4
Select-String -Path 'assets\js\pages\home-popup.js' -Pattern 'normalizeSafeUrl|imageUrl|settings", "popups"|createPopupElement|popup content|img src|sanitizePopupContent' -Context 2,4
Select-String -Path 'assets\js\utils\operation-tasks.js' -Pattern 'normalizePopupAssetPath|popup|imageUrl|candidatePath|settings/popups|operationTasks' -Context 2,4
Select-String -Path 'scripts\prebuild.js' -Pattern 'assetImageRefPattern|collectSourceImageReferences|missingReferences|findSourceOriginalCounterpartForWebp|WEBP_PREFERRED_ASSET_DIRS|popup|missingWebpCounterparts|applyVersionToHTML|/assets/main.png|/assets/banner_main.png' -Context 2,5
Get-Content -LiteralPath 'firebase.json' -Raw -Encoding UTF8
Select-String -Path 'firestore.rules' -Pattern 'settings/popups|settings/\{doc\}|pages/\{slug\}|courses/\{courseId\}' -Context 3,4
Get-Content -LiteralPath 'assets\js\pages\admin-popup.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\pages\home-popup.js' -Encoding UTF8
Get-Content -LiteralPath 'scripts\prebuild.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\utils\operation-tasks.js' -Encoding UTF8
```

## 14. Change Confirmation

```text
No source code was modified.
No Firestore rules were modified.
No Functions were modified.
No asset files were moved, deleted, or renamed.
No build/deploy command was run.
Only the R2 popup public migration plan Markdown document was created.
```

## 15. Implementation Status (2026-06-19)

Option A(Firestore `imageUrl`에 R2 public HTTPS URL 저장)가 `assets/js/utils/public-image-url.js` helper와 함께 popup/instructor에 적용되었습니다. 허용 base URL allowlist, prefix 검증, story/contact 이미지 신규 차단, 로컬 `/assets` fallback이 코드에 반영되었습니다.

## 16. Current Cache Policy Status (2026-06-24)

Popup R2 public URL 운영은 “새 이미지 = 새 R2 key + CMS URL 교체” 원칙으로 유지합니다. 같은 key overwrite와 R2 URL cache-buster query는 금지합니다.

Phase D-3 이후 public instructor/R2/local image URL의 `Date.now()` 또는 render timestamp query cache-buster는 제거되었습니다. Popup R2 URL도 원본 public URL 그대로 저장/렌더링하는 정책을 유지합니다.

운영 배포 및 운영 URL header/Network QA가 확인되지 않은 상태에서는 다음 기준으로 표기합니다.

```text
로컬 소스 및 prebuild/verify 기준 구현 완료. 운영 배포 및 운영 URL header/Network QA는 별도 확인 필요.
```
