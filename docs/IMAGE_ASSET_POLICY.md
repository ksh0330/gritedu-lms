# Image Asset Policy

최종 갱신: 2026-07-06

## 1. 핵심 원칙

- Firebase Storage는 현재 사용하지 않습니다.
- 고정 브랜드/앱 자산은 로컬 `/assets`를 유지합니다.
- 자주 바뀌는 공개 운영 이미지는 Cloudflare R2 public HTTPS URL을 사용할 수 있습니다.
- CMS와 Firestore에는 Firebase Storage URL이 아니라 `/assets/...` 경로 또는 허용된 R2 public URL을 저장합니다.
- `data:image`, base64 image, `blob:`, `javascript:` URL은 Firestore/CMS 저장값으로 허용하지 않습니다.
- 실제 로컬 파일은 저장소의 `assets/**` 폴더에 배치합니다.
- `npm run prebuild`가 `dist/`를 만들면서 **로컬** 이미지 참조, WebP 변환, 누락 위험을 점검합니다. R2 public URL은 prebuild missing check 대상이 아닙니다.
- `dist/**`는 빌드 산출물이므로 Git에 추적하지 않습니다.

이 정책은 비용과 운영 복잡도를 낮추기 위한 현재 운영 모델입니다. Firebase Storage 업로드 CMS와 CMS 직접 R2 업로드는 보류 기능입니다. 관리자 CMS는 파일을 직접 업로드하지 않고, R2에 먼저 업로드된 public URL을 입력합니다.

2026-07-03 개인정보처리방침 문구 정비 후에도 R2 public 사용 범위는 popup main/content image, instructor profile image, instructor 참고 자료 image, story hero/CEO image입니다. 학생별 자료, 리포트, 성적표, 과제, 내부 운영 파일은 public R2 저장 금지이며, private 파일 기능은 R2 private + signed URL + 권한 확인 + 다운로드 로그 설계 후 별도 정책 개정이 필요합니다.

## 2. 경로 정책

| 사용 위치 | 저장 값 | 비고 |
| --- | --- | --- |
| CMS/Firestore (로컬) | `/assets/...` | 공개 런타임 경로, prebuild 후 Cloudflare Pages 배포 필요 |
| CMS/Firestore (R2 public) | `https://assets.gritedu.kr/public/...` | popup/instructor/story 공식 지원, 즉시 반영 |
| 소스 파일 | `assets/...` | 저장소 내부 실제 파일 |
| 빌드 산출물 | `dist/assets/...` | prebuild 결과, 직접 CMS에 저장 금지 |

CMS 필드에 `/dist/assets/...`를 저장하지 않습니다. 공개 페이지는 배포된 Hosting root 기준의 `/assets/...`를 사용합니다.

## 3. WebP/Prebuild Workflow

1. 운영자 또는 개발자가 이미지 원본을 준비합니다.
2. 파일을 적절한 `assets/**` 폴더에 둡니다.
3. CMS에는 해당 파일의 `/assets/...` 경로를 입력합니다.
4. 배포 전 `npm run prebuild`가 참조와 WebP 출력을 점검합니다.
5. Cloudflare Pages는 `dist/` 산출물을 운영 배포합니다. Firebase Hosting은 disable 완료 상태이며 같은 산출물을 fallback/redirect 용도로 배포하지 않습니다.

WebP 정책:

- 팝업, story, curriculum/display 이미지는 WebP 지향입니다.
- PNG/JPG 원본이 필요한 경우 source original로 보존할 수 있습니다.
- prebuild는 PNG/JPG 원본에서 runtime WebP를 만들 수 있습니다.
- WebP가 이미 준비된 경우 해당 WebP를 우선 사용합니다.

## 4. R2 Public Image Policy (2026-06-24)

Bucket: `gritedu-public-assets`

Public base URL (custom domain):

`https://assets.gritedu.kr`

Legacy development URL (호환 유지):

`https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev`

Custom domain status:

- 운영 기본 URL은 `https://assets.gritedu.kr` 입니다.
- 검증 helper `assets/js/utils/public-image-url.js`의 `R2_PUBLIC_BASE_URLS`에 custom domain과 legacy dev URL이 모두 등록되어 있습니다.
- 2026-06-29 기준 `assets.gritedu.kr` 기반 R2 이미지 로딩 QA는 완료되었습니다.

허용 prefix (연도 폴더 없음):

```text
public/popup/
public/instructors/profile/
public/instructors/image/
public/story/
public/pages/story/
```

legacy read-only (신규 입력/placeholder 금지):

```text
public/instructors/curriculum/
```

공식 지원 영역:

```text
popup main image
popup content public image
instructor profile image
instructor 참고 자료 image (Firestore 필드명: curriculumImageUrl(s))
story hero image
story CEO image
```

후보 prefix:

```text
public/notices/
public/events/
```

금지 prefix (이번 구현에서 UI 없음 또는 차단):

```text
public/contact/
public/timetable/
public/courses/
public/materials/
public/reports/
public/assignments/
```

정책:

- `https://`만 허용 (`http://`, `data:`, `blob:`, `javascript:` 금지)
- R2 key는 lowercase ASCII, 숫자, hyphen, underscore, slash만 허용
- URL path에 `/assets/` segment 금지
- 같은 R2 key 덮어쓰기 금지. 새 이미지는 새 key를 만들고 CMS URL을 교체합니다.
- R2 public URL에는 `Date.now()` 또는 render timestamp 기반 cache-buster query를 붙이지 않습니다.
- popup R2 신규 URL은 `.webp` 권장이며 `.png`/`.jpg`/`.jpeg`도 허용
- instructor profile/참고 자료 R2 신규 URL은 `.webp` 권장; `.png`/`.jpg`도 허용. 참고 자료 신규 prefix는 `public/instructors/image/`만 안내합니다.
- story R2 신규 URL은 `.jpg`, `.jpeg`, `.png`, `.webp`를 허용하며, `public/story/` 또는 `public/pages/story/` prefix만 사용
- private 학습 자료는 R2 public bucket 금지

검증 helper: `assets/js/utils/public-image-url.js`

## 5. 주요 Asset 영역

| 영역 | 권장 위치 | 정책 |
| --- | --- | --- |
| 홈 메인 / OG·공유 대표 이미지 | `assets/main.png`, `assets/main.webp` | source original `main.png`, runtime WebP `main.webp`. 공개 HTML `og:image`는 `https://gritedu.kr/assets/main.png` 기준 |
| 팝업 | `assets/popup/*` 또는 R2 `public/popup/*` | PNG/JPG/WEBP; R2는 deploy 없이 반영 |
| Story | R2 `public/story/*` 또는 `public/pages/story/*` | hero/CEO 이미지만 공식 지원. CMS 파일 업로드 없음. 본문 이미지 첨부는 차단 |
| 강사 프로필 | `assets/instructors/profile/*` 또는 R2 `public/instructors/profile/*` | WebP/PNG/JPG; 로컬 `profile.png` placeholder 유지 |
| 강사 참고 자료 | rollback: `assets/instructors/curriculum/*` 또는 R2 `public/instructors/image/*` (legacy read: `public/instructors/curriculum/*`) | WebP/PNG/JPG; Firestore 필드명 `curriculumImageUrl(s)` 유지 |
| 공통 로고/아이콘 | `assets/logo*`, `assets/favicon*`, theme icons | 실제 참조와 파일 존재 확인 |
| 학교 CSV | `assets/school.csv` | 회원가입 학교 검색에 필요 |

2026-06-24 확인 메모:

- 문서 최신화 시작 시점의 `git status --short`, `git diff --name-status`, `git diff --cached --name-status`는 출력이 없어 현재 staged/unstaged 이미지 삭제는 확인되지 않았습니다.
- `assets/instructors/profile/profile.png`는 기본 강사 placeholder 정책상 KEEP_LOCAL입니다. 삭제되면 `npm run prebuild` 또는 `npm run verify`에서 누락 경고가 발생할 수 있으므로, R2 이전 후에도 fallback 화면 깨짐 여부를 확인해야 합니다.
- 공개 사이트 고정 자산인 `assets/main.png`, `assets/logo.png`, favicon/theme icon은 repo `/assets`에 유지합니다.
- `assets/banner_main.png`, `assets/banner_main.webp`는 legacy optional 파일입니다. 운영 OG/대표 이미지 기준은 `main.png` / `main.webp`이며 prebuild required original이 아닙니다.

## 6. Admin/CMS 운영 규칙

- 관리자 CMS는 파일을 직접 업로드하지 않습니다. R2에 먼저 업로드한 public URL을 입력합니다.
- R2 public URL은 Cloudflare Dashboard에서 업로드 후 URL을 CMS에 붙여넣습니다.
- Story 학원 안내 이미지는 R2 `public/story/` 또는 `public/pages/story/` URL을 입력합니다.
- story/contact/page content 본문 이미지 첨부는 신규 저장을 차단합니다.
- CMS에는 허용된 `/assets/...` 또는 R2 public URL만 저장합니다.
- 강사 프로필 사진이 없으면 Firestore에는 빈 값으로 두고, 화면 렌더링 시에만 `/assets/instructors/profile/profile.png` placeholder를 사용합니다. `data:image` base64는 저장하지 않습니다.
- 로컬 고정 asset은 같은 파일명을 덮어쓰지 않고 새 파일명을 사용한 뒤 `prebuild`와 Cloudflare Pages 배포로 반영합니다.
- `localhost:5000`은 개발/화면 테스트용입니다. 실제 운영 저장은 배포된 관리자 CMS에서 수행합니다.

## 7. Operator Workflow

### R2 object 파일명 (운영자용)

- 영문 소문자, 숫자, 하이픈(-), `.webp`/`.png`/`.jpg` 사용합니다.
- 한글, 공백, 괄호는 사용하지 않습니다.
- 이미지를 바꿀 때 같은 이름 덮어쓰기보다 새 이름을 사용합니다.
- 예: `popup-open-01.webp`, `kim-profile-01.webp`, `kim-reference-01.webp`, `banner_main-20260626.webp`, `ceo-yhs-20260626.webp`

PNG/JPG를 WebP로 변환할 때는 `tools/image-to-webp/` 폴더의 `run.bat` 또는 `npm run convert-images`를 사용합니다.

### R2 public 이미지 (popup / instructor / story)

1. 이미지를 준비합니다. Story는 `.jpg`, `.jpeg`, `.png`, `.webp`를 허용하고, popup은 WebP를 우선합니다.
2. R2 Dashboard에서 적절한 prefix에 업로드합니다.
3. public URL을 복사합니다.
4. CMS 이미지 URL 입력란에 붙여넣고 저장합니다.
5. 배포 없이 공개 사이트에서 확인합니다.
6. 문제 시 기존 local `/assets/...` fallback 경로로 되돌립니다.

### 팝업 이미지 변경 (로컬 fallback)

1. 이미지를 WebP로 준비합니다.
2. `assets/popup/`에 파일을 둡니다.
3. 팝업 CMS에서 `/assets/popup/파일명.webp`를 입력합니다.
4. 로컬에서 prebuild를 실행해 누락 참조가 없는지 확인합니다.
5. 배포 후 공개 페이지에서 이미지를 확인합니다.

### Story/사이트 이미지

- Story 학원 안내의 상단 배너와 대표 사진은 `https://assets.gritedu.kr/public/story/` 또는 `https://assets.gritedu.kr/public/pages/story/` URL만 공식 지원합니다.
- Story CMS는 파일 업로드를 하지 않습니다. R2에 먼저 업로드한 뒤 URL을 입력합니다.
- 같은 파일명 덮어쓰기보다 versioned filename을 사용합니다. 예: `story-hero-20260626.webp`, `ceo-yhs-20260626.webp`.
- story/contact 본문 이미지 신규 첨부는 차단됩니다.
- 기존 Firestore legacy HTML에 남아 있는 이미지는 별도 수동 정리 대상입니다.
- Contact CMS는 현재 이미지/R2 입력 필드가 아니라 텍스트/URL/지도/교통 정보 중심입니다. Contact용 R2 public prefix 추가와 Firebase Storage 업로드는 없습니다.
- Popup 이미지는 기존 R2 `public/popup/` 정책을 유지합니다. Popup `textItems[]`는 텍스트/URL만 저장하며 별도 이미지 필드를 추가하지 않습니다.
- Story public 이미지는 학생 리포트, 자료실 PDF, 과제 첨부 같은 private 파일과 섞지 않습니다.

### 강사 프로필/참고 자료 이미지 변경

1. 프로필 원본은 `assets/instructors/profile/`에 보존할 수 있습니다 (rollback).
2. 참고 자료(display) 이미지는 WebP를 우선하며, R2 신규 prefix `public/instructors/image/`를 사용합니다.
3. 기존 `public/instructors/curriculum/` URL은 과거 데이터 호환용으로만 읽을 수 있으며, 신규 업로드/입력 안내에는 사용하지 않습니다.
4. 강사 CMS의 이미지 URL이 validator를 통과하는지 확인합니다.

## 8. 개발자 체크리스트

- `assets/**` 원본 파일이 존재하는지 확인합니다.
- `/assets/...` 참조가 실제 파일 또는 prebuild 생성 대상과 일치하는지 확인합니다.
- `dist/assets/**`를 Git에 추가하지 않습니다.
- Firebase Storage SDK 또는 Storage URL을 새로 도입하지 않습니다.
- `firebase-init.js`의 `storageBucket` 주석을 활성화하지 않습니다.
- 공개 read 가능한 문서에 민감 이미지/영상 URL을 넣지 않습니다.

## 9. 깨질 수 있는 경우

- Firestore/CMS에는 경로가 있는데 파일이 `assets/**`에 없는 경우
- PNG/JPG를 삭제했는데 prebuild가 WebP를 생성할 source original로 기대하는 경우
- 파일명을 바꾸고 CMS 경로를 갱신하지 않은 경우
- `/dist/assets/...`를 CMS에 저장한 경우
- Firebase Storage URL을 혼용한 경우

## 10. 보류 기능

Firebase Storage 기반 업로드 CMS는 현재 보류입니다. 도입하려면 다음 설계가 먼저 필요합니다.

- Storage rules
- 업로드 권한
- 파일 삭제/교체 정책
- 비용 모니터링
- 이미지 최적화 파이프라인
- 기존 `/assets/...` 경로 migration 정책

## 11. R2 Custom Domain 운영 체크

1. `https://assets.gritedu.kr`을 공식 R2 public base URL로 유지합니다.
2. `assets/js/utils/public-image-url.js`의 allowed base URL 목록에 custom domain과 legacy `r2.dev`가 모두 남아 있는지 확인합니다.
3. Cloudflare R2 CORS는 대표 운영 도메인 `https://gritedu.kr`와 필요한 로컬 테스트 도메인을 기준으로 확인합니다. `gritedu.pages.dev`는 `https://gritedu.kr` 301 redirect 완료 상태입니다.
4. 관리자 CMS의 R2 URL 입력 placeholder/help text가 custom domain 기준인지 확인합니다.
5. 기존 `r2.dev` URL은 과도기 호환으로 허용하되, 신규 운영 입력은 custom domain을 우선합니다.
6. popup, instructor profile, instructor 참고 자료, story hero/CEO 화면의 R2 이미지 로딩 QA는 2026-06-29 기준 완료 상태로 기록합니다. 새 URL을 추가할 때는 화면별 표시를 다시 확인합니다.
