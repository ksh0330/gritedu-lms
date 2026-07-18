# Assets R2 Migration Audit

작성일: 2026-06-17

## 1. 목적

이 문서는 현재 `/assets` 참조를 기준으로 어떤 파일을 계속 Cloudflare Pages 로컬 정적 자산으로 둘지, 어떤 파일을 Cloudflare R2 public/private 계층으로 옮길지 분류한다.

이번 감사는 문서/감사 작업만 수행했다. HTML/CSS/JS, Firestore rules, Functions, asset 파일, build/deploy 산출물은 변경하지 않았다.

2026-06-24 최신화 메모:

- 공식 공개 도메인은 `https://gritedu.kr`입니다.
- 공개 HTML의 canonical, `og:url`, sitemap, JSON-LD는 `gritedu.kr` 기준으로 정리된 상태입니다.
- 문서 최신화 시작 시점의 `git status --short`, `git diff --name-status`, `git diff --cached --name-status`는 출력이 없어 현재 staged/unstaged 이미지 삭제는 확인되지 않았습니다.
- `assets/instructors/profile/profile.png`는 기본 강사 placeholder로 KEEP_LOCAL 대상입니다. 삭제되면 prebuild/verify 경고가 날 수 있으므로 실제 화면 fallback과 함께 확인해야 합니다.
- 이 메모 당시 R2 custom domain 등록은 아직 완료 전이었으며, 이후 운영 기본 URL은 `https://assets.gritedu.kr`로 확정되었습니다.

2026-06-25 최신화 메모:

- 정적 Hosting 운영 기준은 Cloudflare Pages입니다.
- R2 public custom domain은 `https://assets.gritedu.kr`입니다.
- `assets/js/utils/public-image-url.js`는 custom domain과 legacy `r2.dev` URL을 함께 허용합니다.
- 신규 CMS 입력은 `assets.gritedu.kr/public/...` URL을 우선하고, 기존 `r2.dev` URL은 과도기 호환으로 둡니다.
- `dist`에는 Cloudflare Pages용 `_headers`와 `version.json`을 포함하고, `firestore.rules`, `firebase.json`, `.firebaserc`, `storage.rules` 같은 운영 파일은 포함하지 않는 방향으로 prebuild/verify를 조정합니다.

2026-06-26 최신화 메모:

- Firebase Hosting은 disable 완료 상태입니다. `gritedu-lms.web.app`/`gritedu-lms.firebaseapp.com`은 curl 기준 404를 반환하며 fallback/redirect 용도로 사용하지 않습니다.
- Firebase Hosting old URL을 `gritedu.kr`로 301 redirect하지 않습니다. old URL은 Search Console 임시 삭제 요청과 404 유지로 색인 제거를 유도합니다.
- 일반 정적 사이트 배포는 `git push origin main` 후 Cloudflare Pages 자동 빌드/배포로 처리합니다.
- `npm run deploy` 또는 `firebase deploy --only hosting`은 일반 운영에서 사용하지 않습니다.
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 이후 `https://gritedu.kr` 301 redirect 완료 및 path/query 보존 확인 상태로 정리되었습니다. Cloudflare Pages `_headers` live QA는 pending입니다.

2026-06-29 최신화 메모:

- 현재 운영 아키텍처는 Cloudflare Pages 정적 Hosting + Firebase Auth/Firestore/Functions backend + Cloudflare R2 public asset 계층으로 확정합니다.
- Cloudflare Pages는 GitHub `main` push 시 `npm run prebuild`로 빌드하고 `dist`를 배포합니다. `npm run prebuild`는 `dist/_headers`와 `dist/version.json`을 생성하며, `scripts/verify-build.js`는 `_headers`, `version.json`, 금지 파일 노출을 검사합니다.
- Firebase Hosting은 `firebase hosting:disable` 완료 상태입니다. `https://gritedu-lms.web.app/`와 `https://gritedu-lms.firebaseapp.com/`은 curl 기준 404 확인 완료이며 fallback/redirect 용도로 사용하지 않습니다.
- Firebase Hosting redirect-only 전환안은 미채택이며, `npm run deploy` 또는 `firebase deploy --only hosting`은 일반 운영에서 사용하지 않습니다.
- R2 public custom domain은 `https://assets.gritedu.kr`이며, popup/instructor/Story 이미지 로딩 QA는 완료되었습니다.
- Google Search Console에서는 `gritedu.kr` sitemap 제출이 완료되었고 발견 페이지는 6개입니다. old `gritedu-lms.web.app` 속성은 임시 삭제 요청 처리 상태 확인용으로 유지합니다.
- Naver Search Advisor old 도메인 검색 제외 요청은 완료되었습니다. `gritedu.online`은 검색 제외 처리 후 재확인 대상입니다.
- `gritedu.kr` 기준 회원가입 QA 1차는 완료되었습니다.
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 `https://gritedu.kr` 301 redirect 완료 상태이며 path/query 보존도 확인되었습니다.
- 남은 pending은 `gritedu.online` 재확인, Cloudflare Pages `_headers` live QA, forbidden URL live QA, 관리자 CMS QA, 모바일/iPhone/KakaoTalk QA입니다.

2026-07-03 개인정보처리방침 문구 정비 메모:

- 공개 약관과 회원가입 동의 요약에서는 기술스택 노출을 줄였고, 개인정보처리방침 전문에는 R2 public 이미지 계층 관련 위탁, 국외이전, 접속 로그 가능성을 사용자용 표현으로 유지했습니다.
- 정책 문구상 R2 public 사용 범위는 popup main/content image, instructor profile/참고 자료 image, story hero/CEO image로 제한했고, 학생별 자료, 리포트, 성적표, 과제, 내부 운영 파일은 public R2 저장 금지로 명시했습니다.
- 2026-07-06: 강사 참고 자료 신규 prefix `public/instructors/image/`, CMS 파일 선택 UI 제거. legacy `public/instructors/curriculum/` read-only.
- private 자료실/리포트/과제 파일 기능은 아직 미구현이며, R2 private + signed URL + 권한 확인 + 다운로드 로그 설계 후 별도 개인정보처리방침 개정이 필요합니다.
- Cloudflare/Google 국외이전 세부 국가, 연락처, 보유기간은 공식 DPA/개인정보 문서 확인이 필요한 운영자 확인 항목입니다.

## 2. 결론

`docs/ERP_LMS_R2_BLUEPRINT.md`의 최종 방향은 "Firebase는 계속 유지하고 Hosting/파일 저장/다운로드 계층을 Cloudflare Pages/R2로 분리"하는 것이다. 따라서 Firebase Auth, Firestore, Functions, 관리자 CMS는 유지하고, 정적 Hosting은 Cloudflare Pages로 운영한다. Firebase Hosting은 disable 완료 상태이며 `/assets`는 공개 사이트 고정 자산 위주로 축소하는 것이 맞다.

현재 `/assets`에는 코드/스타일/partials와 공개 사이트 고정 이미지가 함께 있고, 팝업/강사/참고 자료처럼 CMS에서 바뀔 수 있는 이미지도 섞여 있다. private 자료실, 학생 리포트, 과제 첨부는 아직 로컬 파일로 구현되어 있지 않지만, 향후에는 반드시 R2 private + signed URL + 다운로드 로그 구조로 설계해야 한다.

## 3. 반영한 문서

| 문서 | 반영 내용 |
| --- | --- |
| `PROJECT_STATE.md` | Firebase 유지, Storage 미사용, 공개 사이트 안정화 우선 원칙 |
| `PROJECT_DOCS_INDEX.md` | R2 청사진과 본 감사 문서 색인 반영 대상 |
| `ADMIN_CMS_STATE.md` | 관리자 CMS의 팝업, 사이트 관리, 강사/강좌 이미지 운영 범위 |
| `md/DATABASE_SCHEMA.md` | 공개 read collection과 private metadata 분리 필요성 |
| `ONLINE_COURSE_SYSTEM_STATE.md` | 강좌 공개/회원 전용 경계, `courses` 공개 read 위험 |
| `OFFLINE_CLASS_SYSTEM_PLAN.md` | 오프라인 반/회차 자료와 출결/과제의 private 가능성 |
| `docs/OPERATION_MANUAL.md` | 운영자가 console이 아니라 CMS로 관리해야 하는 원칙 |
| `docs/IMAGE_ASSET_POLICY.md` | Firebase Storage 미사용, 로컬 `/assets`, WebP/prebuild 정책 |
| `docs/FIREBASE_USAGE_AND_COST_AUDIT.md` | Hosting/Auth/Firestore/Functions 비용 경계 |
| `docs/ERP_LMS_R2_BLUEPRINT.md` | Firebase 유지 + R2 파일 계층 분리, public/private 분류 기준 |

## 4. R2 청사진 기준

청사진상 `/assets`에 남길 대상:

- 로고, favicon, home main image
- 고정 배너, 기본 사이트 이미지
- 장기 유지되는 기본 강사 placeholder
- 공통 아이콘
- 앱 구동에 필요한 CSS/JS/partials

청사진상 R2로 옮길 대상:

- 강의 자료 PDF, 학생 리포트 PDF, 성적표/점수표
- 과제 첨부, 공지 첨부
- 팝업 이미지, 포스터, 강사 참고 자료 이미지
- 자주 바뀌는 강사/강좌 이미지
- 다운로드 가능한 학습 자료

private R2는 Firestore에 공개 URL을 저장하지 않는다. Firestore에는 `provider`, `r2Key`, 권한 metadata, 표시용 metadata만 저장하고, 다운로드는 Functions에서 권한 확인 후 signed URL을 발급해야 한다.

## 5. 현재 `/assets` 인벤토리

`assets/**`의 현재 파일 수는 182개다.

| 확장자 | 파일 수 |
| --- | ---: |
| `.css` | 56 |
| `.csv` | 1 |
| `.html` | 2 |
| `.jpg` | 3 |
| `.js` | 76 |
| `.pdf` | 3 |
| `.png` | 36 |
| `.webp` | 5 |

코드/스타일/partials를 제외한 정적 media/data/document 파일은 48개다. 이 중 정적 검색으로 직접 참조가 확인된 파일은 21개, 직접 참조가 확인되지 않은 파일은 27개다. 직접 참조되지 않은 파일도 Firestore CMS 데이터에서 경로 문자열로 쓰일 수 있으므로 즉시 삭제/이동 대상으로 보지 않는다.

## 6. 현재 참조 흐름

| 참조 영역 | 현재 경로/필드 | 판단 |
| --- | --- | --- |
| HTML 공통 로딩 | `/assets/css/*.css`, `/assets/js/*.js`, `/assets/partials/*.html` | 앱 구동 자산이므로 KEEP_LOCAL |
| 브라우저 아이콘 | `/assets/favicon.png` | 공개 사이트 고정 자산이므로 KEEP_LOCAL |
| Header/Footer 로고 | `/assets/logo.png`, `/assets/logo-dark.png` | 브랜드 고정 자산이므로 KEEP_LOCAL |
| 테마 아이콘 | `/assets/lightmode.png`, `/assets/darkmode.png` | UI 고정 자산이므로 KEEP_LOCAL |
| 홈 대표 / OG·공유 이미지 | `/assets/main.webp`, source `assets/main.png` | 공개 HTML `og:image`·JSON-LD image는 `https://gritedu.kr/assets/main.png` 기준. prebuild가 `main.webp` runtime 생성 |
| 학교 검색 데이터 | `/assets/school.csv` | 가입/대시보드 기능 데이터이므로 KEEP_LOCAL |
| 학원비/환불/등록 PDF | `/assets/footer/*.pdf` | 공개 규정성 문서이므로 현재는 KEEP_LOCAL |
| 팝업 CMS | `settings/popups.imageUrl`, `/assets/popup/*` | CMS 관리 공개 이미지이므로 MOVE_R2_PUBLIC |
| 강사 CMS | `instructors.profileImageUrl`, `curriculumImageUrl(s)` | placeholder는 KEEP_LOCAL, 실제 CMS 이미지는 MOVE_R2_PUBLIC 후보 |
| 사이트 CMS | `/assets/story/*`, `/assets/contact/*`, `/assets/pages/{slug}/files/*` | 공개 이미지는 MOVE_R2_PUBLIC, 파일 첨부는 REVIEW/private 여부 판단 필요 |
| 강좌 CMS | `courses.thumbnailUrl` 등 공개 썸네일/포스터 | public 강좌 이미지는 MOVE_R2_PUBLIC |
| 자료실/리포트/과제 | 향후 `materials`, `studentReports`, `assignments` | MOVE_R2_PRIVATE_LATER |

CSS의 `url(...)` 검색에서는 이미지 background 참조가 확인되지 않았다. 현재 CSS 파일 사이의 import/스타일 로딩이 중심이다.

## 7. 분류 카운트

아래 카운트는 raw 파일 수가 아니라 이관 의사결정에 쓰는 "파일군/참조 패턴" 단위다.

| 분류 | 카운트 |
| --- | ---: |
| KEEP_LOCAL | 14 |
| MOVE_R2_PUBLIC | 8 |
| MOVE_R2_PRIVATE_LATER | 7 |
| DELETE_CANDIDATE_LATER | 1 |
| STILL_REVIEW | 1 |

REVIEW 9개 항목 재검증 결과:

| 재분류 결과 | REVIEW 항목 수 |
| --- | ---: |
| KEEP_LOCAL | 3 |
| MOVE_R2_PUBLIC | 3 |
| MOVE_R2_PRIVATE_LATER | 0 |
| DELETE_CANDIDATE_LATER | 2 |
| STILL_REVIEW | 1 |

## 8. KEEP_LOCAL

| # | 대상 | 근거 | 주의 |
| ---: | --- | --- | --- |
| 1 | `/assets/js/*.js` | 정적 앱 구동 코드 | R2 대상 아님 |
| 2 | `/assets/css/*.css` | 정적 스타일 | R2 대상 아님 |
| 3 | `/assets/partials/header.html`, `/assets/partials/footer.html` | 공통 layout fragment | R2 대상 아님 |
| 4 | `/assets/favicon.png` | favicon/apple icon | 고정 브랜드 자산 |
| 5 | `/assets/logo.png`, `/assets/logo-dark.png` | header/footer 브랜드 | 고정 브랜드 자산 |
| 6 | `/assets/lightmode.png`, `/assets/darkmode.png` | theme toggle icon | 고정 UI 자산 |
| 7 | `/assets/main.png` -> `/assets/main.webp` | home main image + OG/social representative image source/runtime | prebuild 생성 관계 유지 |
| 8 | `/assets/school.csv` | 학교 검색/가입 보조 데이터 | 현재 Hosting cache 1일 정책 |
| 9 | `/assets/instructors/profile/profile.png` | 기본 강사 placeholder | 청사진상 keep 대상 |
| 10 | `/assets/footer/aca.pdf` | 공개 학원 등록/운영 문서 | private 자료 아님 |
| 11 | `/assets/footer/fee.pdf` | 공개 수강료 문서 | public/legal 문서 |
| 12 | `/assets/footer/refund.pdf` | 공개 환불 문서 | public/legal 문서 |

## 9. MOVE_R2_PUBLIC

| # | 대상 | 근거 | 이관 시 조건 |
| ---: | --- | --- | --- |
| 1 | `/assets/popup/*.webp` | 팝업은 CMS에서 바뀌는 공개 이미지 | Firestore `imageUrl`을 R2 public key/url 정책으로 변경 |
| 2 | `/assets/popup/*.png` | 현재 popup 폴더에 큰 PNG source/runtime 혼재 | WebP 변환/버전 key 후 public R2 |
| 3 | `/assets/instructors/curriculum/*` (rollback) / R2 `public/instructors/image/*` (신규) | 강사 참고 자료 이미지 (legacy local path rollback) | instructor 문서에는 public R2 key/url만 저장; legacy read `public/instructors/curriculum/` |
| 4 | `/assets/instructors/profile/*_profile.png` | 실제 강사 프로필은 CMS 관리 공개 이미지 | 기본 placeholder와 구분 |
| 5 | `/assets/story/*` | 사이트 소개/스토리 CMS 이미지 경로 | 현재 실제 파일 없음, 생성 시 R2 public |
| 6 | `/assets/contact/*` | 사이트 문의/지점 CMS 이미지 경로 | 현재 실제 파일 없음, 생성 시 R2 public |
| 7 | `courses.thumbnailUrl`, 강좌 썸네일/포스터 | `courses`는 공개 read 가능하므로 public 자산만 허용 | private URL 저장 금지 |
| 8 | 공지 이미지, 팝업 포스터, 공개 이벤트 이미지 | 청사진상 자주 바뀌는 공개 CMS 이미지 | 첨부 파일과 public 이미지를 분리 |

## 10. MOVE_R2_PRIVATE_LATER

| # | 대상 | 근거 | 필수 선행 조건 |
| ---: | --- | --- | --- |
| 1 | 강의 자료 PDF/다운로드 자료 | 대상 강좌/반/학생 권한 필요 | R2 private bucket, `r2Key`, signed URL Function |
| 2 | 학생별 리포트 PDF | 학생 개인정보/학습정보 | 학생/학부모 권한 재검사, 로그 |
| 3 | 성적표/점수표 파일 | 학습정보 민감도 높음 | metadata rules, 다운로드 감사 |
| 4 | 과제 첨부/제출 파일 | 제출물/메모 포함 가능 | 대상별 권한, 삭제/교체 정책 |
| 5 | `/assets/pages/{slug}/files/*.pdf`류 CMS 파일 | public/legal인지 private인지 파일별 판정 필요 | 공개 문서만 public, 나머지는 private |
| 6 | 오프라인 반/회차 자료 | 반 배정 학생/학부모만 볼 수 있음 | `offlineClassMembers` 기준 권한 |
| 7 | 다운로드 로그가 필요한 파일군 | 파일 접근 이력 필요 | `materialAccessLogs` 또는 동등 collection |

## 11. REVIEW

Review resolution pass 이후 남은 REVIEW는 source placeholder 성격의 1개 항목이다. 실제 asset 파일이 없고 runtime 입력 예시/기본 파일명으로 남아 있으므로 파일 이동이나 삭제 대상이 아니다.

| # | 대상 | 검토 이유 | 다음 확인 |
| ---: | --- | --- | --- |
| 1 | 문서/placeholder 경로 `assets/popup/example.webp`, `/assets/popup/popup-image.webp`, `popup-image.webp` | 실제 asset 파일은 없고, `members/admin/popup.html` placeholder와 `admin-popup.js` 기본 파일명 fallback으로만 확인됨 | R2 전환 시 placeholder 문구와 R2 public URL 입력 UX를 함께 바꿀지 결정 |

## 12. 현재 구현상 주의점

- Firebase Storage SDK 사용은 확인되지 않았다. `assets/js/firebase-init.js`의 `storageBucket`은 주석 처리 상태다.
- `firebase.json`은 `assets/**/*.js`, `assets/**/*.css`를 no-cache/must-revalidate로 두고, 이미지/WebP는 긴 immutable cache로 둔다. CMS 이미지가 같은 파일명으로 교체되면 오래된 이미지가 남을 수 있으므로 R2 public 이관 시 versioned key가 필요하다.
- `scripts/prebuild.js`는 로컬 `/assets` source와 생성 WebP를 검사한다. R2 이관 뒤에는 KEEP_LOCAL 자산만 local missing check 대상으로 남기고, R2 public/private key는 별도 검증해야 한다.
- `admin-popup.js`는 현재 local popup image path를 `/assets/popup/*.webp` 또는 `https`로 제한한다. R2 public 전환 시 허용 prefix와 입력 검증 정책을 바꿔야 한다.
- `admin-instructors.js`는 `/assets/instructors/curriculum/`, `/assets/instructors/profile/` 기반 경로를 사용한다. R2 public 전환 시 기존 Firestore 문서의 local path migration이 필요하다.
- `admin-site.js`는 `/assets/story`, `/assets/contact`, `/assets/pages/{slug}/files/{file}`류 경로를 허용한다. image와 file 첨부를 public/private로 분리해야 한다.
- `courses`는 공개 read 가능 영역이다. private 자료, 학생별 report, DRM token, signed URL을 `courses` 문서에 저장하면 안 된다.

## 13. Recommended Migration Phases

1. KEEP_LOCAL 목록을 확정하고 prebuild 검증 대상에서 계속 보호한다.
2. Firestore 데이터에서 `settings/popups.popups[].imageUrl`만 먼저 export해 실제 popup 이미지 경로를 확인한다.
3. R2 public bucket/key prefix를 popup 전용으로 작게 설계한다. 예: `public/popup/{yyyy}/{popupId}-{hash}.webp`.
4. 첫 실험은 popup image 1개만 대상으로 한다. 기존 `/assets/popup/...` 경로를 즉시 삭제하지 않고, Firestore 값만 R2 public URL 또는 R2 metadata 모델로 전환하는 흐름을 검증한다.
5. popup 실험이 안정화된 뒤 instructor curriculum/profile, story/contact 공개 이미지, course thumbnail 순서로 확장한다.
6. private 자료실/리포트/과제는 별도 단계에서 `r2Key`, owner/target metadata, signed URL Function, download log를 함께 설계한다.
7. local `/assets`는 고정 브랜드/앱 자산, prebuild required originals, public/legal 문서만 남긴다.

## 14. Immediate Next Actions

1. 파일 이동/삭제 없이 `settings/popups`, `instructors`, `pages` Firestore 문서의 `/assets/...` 문자열 export 계획만 세운다.
2. popup R2 public 실험용 key 정책과 rollback 기준을 문서화한다.
3. `admin-popup.js`가 현재 `/assets/popup/*.webp` 또는 `https://`만 허용한다는 점을 R2 URL 정책에 맞춰 나중에 수정 범위로 분리한다.
4. `assets/footer/fee.*`, `assets/footer/refund.*` 이미지 중복 파일은 DELETE_CANDIDATE_LATER로만 두고, 배포 로그/외부 링크 확인 전 삭제하지 않는다.
5. `assets/instructors/profile/profile.png` placeholder는 local fallback으로 유지하고, 삭제가 필요한 경우 먼저 공개 강사 카드/상세 fallback을 확인한다.
6. R2 custom domain `assets.gritedu.kr` 기준으로 public URL whitelist, CORS, 관리자 URL 입력 검증 도메인, 기존 `r2.dev` URL 유지 범위를 별도 작업으로 점검한다.
7. private 자료실/리포트/과제 파일은 이번 public 이미지 실험과 섞지 않는다.

가장 위험한 항목 5개:

1. `courses` 문서에 private file URL, report URL, signed URL, DRM token을 저장하는 것. `courses`는 공개 read 가능하므로 즉시 노출 위험이 있다.
2. 자료실/리포트/과제 첨부를 R2 private signed URL 없이 public URL로 시작하는 것. 학생별 학습정보와 PDF가 공개될 수 있다.
3. popup/강사/참고 자료 이미지를 현재 `/assets` 같은 filename으로 계속 교체하는 것. Hosting immutable cache 때문에 사용자가 오래된 이미지를 볼 수 있다.
4. Firestore CMS 데이터의 `/assets/...` 실제 사용 여부를 확인하지 않고 미참조 파일을 삭제/이동하는 것. 정적 검색에 안 잡히는 경로 문자열이 운영 데이터에 남아 있을 수 있다.
5. R2 전환 후에도 prebuild missing asset 검사와 CMS path 검증을 local `/assets` 기준으로만 유지하는 것. R2 key를 잘못 저장해도 배포 전 발견하지 못할 수 있다.

## 15. 결정

공개 사이트 안정화 전에는 기능 추가보다 `/assets` 기준 확정이 우선이다. 지금 당장 파일을 옮기지 말고, 아래 원칙을 문서화된 기준으로 삼는다.

- `/assets`에는 앱 구동 자산과 고정 공개 자산만 남긴다.
- CMS에서 자주 바뀌는 공개 이미지는 R2 public로 옮긴다.
- 학생/반/강좌/리포트/과제 등 권한이 필요한 파일은 R2 private later로 둔다.
- Firestore에는 private file 공개 URL을 저장하지 않는다.
- R2 private는 Functions signed URL과 download log 없이는 시작하지 않는다.

## 16. Review Resolution Pass

| Existing Review Item | Evidence Checked | Final Classification | Reason | Safe To Move Now? | Safe To Delete Now? | Notes |
| -------------------- | ---------------- | -------------------- | ------ | ----------------- | ------------------- | ----- |
| `/assets/footer/fee.jpg`, `/assets/footer/fee.webp`, `/assets/footer/refund.jpg`, `/assets/footer/refund.webp` | 2026-07-18 삭제. 공개 페이지는 `settings/tuitionImages`의 R2 `public/footer/` 이미지 목록으로 전환됨. 기존 `/assets/footer/*.pdf` iframe/download fallback도 제거됨. | REMOVED | CMS URL 목록과 공개 렌더러가 현재 source-of-truth다. | No | No | historical audit 기록만 유지. |
| `/assets/footer_logo.png` | 실제 파일 존재. 직접 runtime ref는 없지만 `scripts/prebuild.js`의 `PRESERVED_ROOT_ORIGINALS`와 `REQUIRED_SOURCE_ORIGINALS`에 포함됨. | KEEP_LOCAL | prebuild required original이며 삭제 시 image asset policy 검증 실패 대상이다. | No | No | 현재 footer runtime 로고와 별도로 source policy상 유지. |
| `/assets/instructors/curriculum/aaa.png`, `b.png`, `ss.png` | 실제 파일 존재. source/direct refs는 0개. legacy rollback 경로. 신규 R2 prefix는 `public/instructors/image/`; legacy read `public/instructors/curriculum/`. | MOVE_R2_PUBLIC | 강사 참고 자료 이미지(legacy field `curriculumImageUrl(s)`)는 공개 홍보 이미지이고 CMS/Firestore URL로 쓰일 수 있다. | No | No | Firestore `instructors` export로 실제 사용 여부를 확인한 뒤 R2 public migration. |
| `/assets/instructors/profile/*_profile.png` 중 직접 참조 없는 파일 | 실제 named profile PNG 18개 존재. source/direct refs는 0개. `admin-instructors.js`가 `/assets/instructors/profile/` 경로를 만들고 `profilePhoto`/`photo`에 저장하며 공개 페이지가 instructor image fields를 표시함. | MOVE_R2_PUBLIC | 실제 강사 프로필은 공개 CMS 이미지다. 단 기본 `profile.png` placeholder는 KEEP_LOCAL이다. | No | No | profile 폴더는 convert-webp script 대상이 아니므로 원본 보존/변환 정책을 먼저 결정. |
| `/assets/popup/___2_______-__________.webp` | 실제 파일 존재. source/direct refs는 0개. `settings/popups.popups[].imageUrl`에 경로 문자열로 저장될 수 있고, popup path validation은 `/assets/popup/*.webp` 또는 `https://`를 허용함. | MOVE_R2_PUBLIC | popup 이미지는 공개 CMS 이미지이며 R2 public 1차 실험군과 같은 자산군이다. | No | No | `settings/popups` 실제 데이터 확인 전에는 active/unused 판단 금지. |
| `/assets/*.webp` 중 source tree에 없고 prebuild가 생성하는 경로 | `main.webp`는 source tree에 없어도 `main.png`에서 forced runtime output으로 생성된다. 공개 HTML은 `og:image`에 `main.png`, 홈 hero에는 `main.webp`를 사용한다. | KEEP_LOCAL | source original과 generated runtime WebP 관계는 public fixed asset 정책의 일부다. | No | No | `assets/banner_main.webp`는 legacy optional이며 운영 필수가 아니다. `.firebase/hosting.*.cache`는 현 Cloudflare Pages 운영 기준이 아니다. |
| 문서/placeholder 경로 `assets/popup/example.webp`, `/assets/popup/popup-image.webp`, `popup-image.webp` | 실제 파일 없음. `members/admin/popup.html` placeholder와 `admin-popup.js` fallback filename에서만 확인됨. `docs/IMAGE_ASSET_POLICY.md`에도 예시 경로로 언급됨. | STILL_REVIEW | asset 파일이 아니라 현재 CMS 입력 UX/문서 예시다. R2 public 전환 시 placeholder를 R2 URL 예시로 바꿀지 판단 필요. | No | No | 유일한 STILL_REVIEW 항목. |
| 과거 감사의 `assets/story/banner_main.*`, `assets/popup/___1...`, `assets/popup/___3...` | 실제 파일 없음. source/direct refs는 0개. 현재 `assets/story`는 비어 있고 `assets/contact`, `assets/pages`는 없음. 언급은 older audit 문서에 한정됨. | DELETE_CANDIDATE_LATER | 실제 asset이 아니라 stale documentation reference로 보인다. | No | No | 이번 범위에서는 문서 정리/삭제 작업도 하지 않음. |
| 절대 URL `https://gritedu-lms.web.app/assets/...` | 과거 감사 시점의 public fixed asset URL 기록이다. 2026-06-24 기준 공개 HTML의 canonical/OG/JSON-LD는 `https://gritedu.kr` 기준으로 정리되었다. | LEGACY_DOC_REFERENCE | 현재 public fixed asset은 repo `/assets`에 유지하되, 대표 도메인 신호는 `gritedu.kr`을 기준으로 본다. | No | No | docs의 과거 기록은 삭제하지 않는다. web.app old URL은 404 유지와 Search Console 임시 삭제 요청으로 정리한다. |

## 17. Recommended First R2 Public Migration Target

```text
Recommended first R2 public migration target: settings/popups.imageUrl 기반 팝업 이미지
Reason:
- 팝업 이미지는 공개 이미지이며 개인정보, 학생별 학습정보, private signed URL이 필요 없다.
- `settings/popups`는 public read이고 `home-popup.js`는 `imageUrl`을 `<img src>`로 렌더링하므로 영향 경계가 작다.
- `admin-popup.js`가 popup 이미지 경로 검증, preview, cleanup task를 한 파일에 모아 두고 있어 실패 시 기존 `/assets/popup/...` 값으로 되돌리기 쉽다.
Required future code changes:
- `assets/js/pages/admin-popup.js`의 허용 경로와 preview/check logic을 R2 public URL 또는 provider/key metadata에 맞춘다.
- `assets/js/pages/home-popup.js`는 R2 public HTTPS URL 렌더링 가능 여부를 확인하고, 필요 시 URL normalization만 보강한다.
- `assets/js/utils/operation-tasks.js`의 popup cleanup path normalization을 R2 key 또는 URL 기준으로 확장한다.
- `scripts/prebuild.js`는 R2 popup URL을 local missing asset으로 오판하지 않도록 검증 기준을 분리한다.
Risks:
- popup content 내부 `<img>`와 main `imageUrl`의 정책이 갈라질 수 있다.
- 기존 `/assets/popup/*.webp` immutable cache와 R2 public cache 정책이 다르면 교체 직후 표시가 엇갈릴 수 있다.
- Firestore `settings/popups`에 local path와 R2 URL이 섞이는 과도기가 생길 수 있다.
Rollback:
- `settings/popups.popups[].imageUrl`을 기존 `/assets/popup/...` 값으로 되돌린다.
- 기존 local asset 파일은 삭제하지 않고 유지한다.
- R2 public object는 비활성/삭제 후보로만 표시하고, 코드/rules/functions rollback은 필요 없게 설계한다.
```

## 18. Source-level Verification Notes

Firestore/CMS path fields:

| Firestore Area | Field | Current Input Format | Current UI | R2 Public Compatible? | R2 Private Compatible? | Needed Future Change |
| -------------- | ----- | -------------------- | ---------- | --------------------- | ---------------------- | -------------------- |
| `settings/popups` | `popups[].imageUrl` | `/assets/popup/*.webp` 또는 `https://...` | `members/admin/popup.html`, `assets/js/pages/admin-popup.js` | Yes. `https://`는 현재도 허용됨 | No | R2 public URL/key policy, preview/check, cleanup task normalization |
| `settings/popups` | popup `content` 내부 `<img src>` | prepared image path 또는 HTML editor content | `assets/js/pages/admin-popup.js` rich editor | Yes, public image only | No | main image와 content image의 R2 public 정책 통일 |
| `instructors` | `profilePhoto`, `photo`, `profileImageUrl` 계열 | `/assets/instructors/profile/...`, `http(s)`, data/blob preview | `members/admin/users/instructors.html`, `assets/js/pages/admin-instructors.js` | Yes | No | placeholder `profile.png`는 local 유지, 실제 profile은 R2 public key/url로 migration |
| `instructors` | `curriculumImageUrl`, `curriculumImageUrls` | `/assets/instructors/curriculum/...`는 `.webp`로 normalize, `http(s)`도 통과 | `assets/js/pages/admin-instructors.js` | Yes | No | multi-image migration, old local paths export, R2 public gallery policy |
| `pages/{story,contact}` | `content`, `structure` 내 image HTML | `/assets/story/*.webp`, `/assets/contact/*.webp`, 임의 image URL | `members/admin/site.html`, `assets/js/pages/admin-site.js` | Yes | No for public pages | story/contact public images만 R2 public. 파일 첨부는 공개 여부 별도 판단 |
| `pages/{slug}` | content 내 file link | `/assets/pages/{slug}/files/{file}` | `assets/js/pages/admin-site.js` file link helper | Only for public/legal files | Yes for private docs, but not with current field alone | public/private file type 분리, private는 signed URL metadata 필요 |
| `courses` | legacy `thumbnail`, `coverImage`, `image`; schema `thumbnailUrl` | 현재 admin save path는 `thumbnail`, `coverImage`, `image`를 deleteField 처리 | `members/admin/courses.html`, `assets/js/pages/admin-courses.js` | If reintroduced, public only | No | course image UI/model을 다시 열 경우 public R2만 허용. `courses` private URL 저장 금지 |
| future `materials`/`studentReports`/`assignments` | `r2Key`, file metadata | 아직 구현 없음 | future admin/student/parent portal | Public material만 가능 | Yes | Functions signed URL, target metadata, download log, rules 설계 |

Future code impact:

| Future Area | Exact Files | Current Behavior | Required Change For R2 Public | Required Change For R2 Private | Risk |
| ----------- | ----------- | ---------------- | ----------------------------- | ------------------------------ | ---- |
| popup CMS | `members/admin/popup.html`, `assets/js/pages/admin-popup.js` | `/assets/popup/*.webp` 또는 `https://` 입력, `settings/popups` 저장 | R2 public URL/key 허용, preview/check, cleanup task 확장 | Not applicable | local path/R2 URL 혼재 |
| instructor CMS | `members/admin/users/instructors.html`, `assets/js/pages/admin-instructors.js` | profile/curriculum local path 생성, Firestore instructor fields 저장 | profile/curriculum R2 public migration UI와 key policy | Not applicable | 기존 instructor 문서 경로 migration 필요 |
| courses CMS | `members/admin/courses.html`, `assets/js/pages/admin-courses.js`, `assets/js/utils/course-readonly.js` | admin save가 legacy image fields 삭제, readonly는 legacy thumbnail fields를 읽을 수 있음 | course thumbnail을 다시 열 경우 public R2 field만 허용 | Not allowed in `courses` | 공개 read collection에 private URL 저장 위험 |
| site CMS | `members/admin/site.html`, `assets/js/pages/admin-site.js` | story/contact/pages content에 `/assets/...` HTML 삽입 | public page images를 R2 public URL/key로 삽입 | private file links는 별도 metadata/Function 필요 | HTML content에 public/private가 섞일 위험 |
| image upload/path utility | `assets/js/utils/image-upload.js` | local `/assets/...` 경로와 legacy save/download helper | R2 upload 준비 UI 또는 public key 생성 helper로 분리 | signed upload/download helper는 Functions 기반 필요 | 사용자가 업로드 완료로 오해할 위험 |
| prebuild validation | `scripts/prebuild.js` | local `/assets` references, required originals, WebP counterparts 검사 | R2 public URLs/keys는 local missing refs에서 제외 | private R2 key는 source HTML에 직접 나오지 않게 검사 | R2 URL을 local asset 누락으로 오판 |
| convert-webp script | `scripts/convert-webp.js` | `assets/popup`, `assets/story`, `assets/instructors/curriculum` 등 local 변환 | R2 업로드 전 local preparation tool로만 사용하거나 별도 pipeline화 | private files는 이미지 변환과 별도 | 원본/산출물 책임 경계 혼선 |
| Static Hosting cache headers | `dist/_headers` | Cloudflare Pages는 `_headers` 사용. Firebase Hosting은 disable 상태이며 일반 운영 배포 기준이 아님 | local dynamic CMS images 축소, R2 public cache/version key 사용 | private download는 Hosting cache 대상 아님 | `_headers` live response QA 필요 |
| public page rendering | `assets/js/pages/home-popup.js`, `home-instructors.js`, `instructors.js`, `instructor-details.js`, `story.js`, `contact.js`, `course-detail.js` | Firestore URL/path를 그대로 `<img src>`로 사용하거나 local placeholder fallback | public R2 HTTPS URL 렌더링, fallback 유지 | private file은 direct render 금지 | 민감 파일을 public page에 노출 |
| Firestore data migration | no code file yet; export/import script later | `/assets/...` 문자열이 Firestore CMS docs에 남아 있을 수 있음 | popup/instructor/pages/course public image fields를 R2 public URL/key로 변환 | materials/reports/assignments는 metadata + `r2Key` 설계 후 생성 | 실제 운영 데이터 미확인 상태에서 삭제/이동 |

Source verification summary:

- `PROJECT_DOCS_INDEX.md`에는 `docs/ERP_LMS_R2_BLUEPRINT.md`와 `docs/audits/ASSETS_R2_MIGRATION_AUDIT.md`가 이미 반영되어 있어 수정하지 않았다.
- `assets/story`는 현재 0 files이고, `assets/contact`, `assets/pages`, `assets/course`, `assets/class`, `assets/instructors/posters`, `assets/instructors/books`는 현재 source tree에 없다.
- `settings/popups`는 Firestore rules에서 public read/admin write다.
- `pages/{slug}`와 `courses/{courseId}`도 public read/admin write이므로 private file URL 저장 금지 원칙을 유지해야 한다.
- source/direct refs를 셀 때 docs, `.firebase`, `dist`, `node_modules`, `functions/node_modules`, `.git`는 제외했다.

## 19. Commands Used

실제로 사용한 read-only 명령어:

```powershell
Get-Content -LiteralPath 'C:\Users\USEr\.codex\attachments\51b33dad-6649-49e0-a022-fb7f3e9e7efc\pasted-text.txt' -Raw -Encoding UTF8
git status --short
Get-Content -LiteralPath 'docs\audits\ASSETS_R2_MIGRATION_AUDIT.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'PROJECT_STATE.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'PROJECT_DOCS_INDEX.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\IMAGE_ASSET_POLICY.md' -Raw -Encoding UTF8
Get-Content -LiteralPath 'docs\ERP_LMS_R2_BLUEPRINT.md' -Raw -Encoding UTF8
rg -n "/assets/|assets/" . -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!.git/**"
rg -n "thumbnailUrl|profileImageUrl|curriculumImageUrl|curriculumImageUrls|imageUrl|imagePath|fileUrl|pdfUrl|attachment|poster|popup|story|contact" . -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!.git/**"
rg -n "required original|prebuild|webp|convert|missing|assets" scripts assets/js -g "*.js"
Get-ChildItem -LiteralPath 'assets' -Recurse -File | Sort-Object FullName
rg -n "fee\.(jpg|webp)|refund\.(jpg|webp)|footer_logo\.png|footer_logo\.webp" . -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!.git/**"
rg -n "aaa\.(png|webp)|assets/instructors/curriculum/(b|ss|fg|zz)\.(png|jpg|webp)|curriculumImageUrl|curriculumImageUrls|CURRICULUM_IMAGE_BASE_PATH" assets\js members docs md PROJECT_STATE.md -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**"
rg -n "[A-Z]{2,3}_profile\.png|profileImageUrl|PROFILE_IMAGE_BASE_PATH|assets/instructors/profile|profile\.webp" assets\js members docs md PROJECT_STATE.md -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**"
rg -n "___2_______-__________\.webp|___1_______-__________\.webp|___3_______-__________\.webp|1_-\.webp|3_-\.webp|6_21\.png|assets/popup/example\.webp|popup-image\.webp|/assets/popup|settings.*popups|imageUrl" assets\js members docs md PROJECT_STATE.md firestore.rules -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**"
rg -n "/assets/story|/assets/contact|/assets/pages/.*/files|assets/story/banner_main|sourcePath" assets\js\pages\admin-site.js assets\js\pages\story.js assets\js\pages\contact.js docs md PROJECT_STATE.md -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**"
rg -n "thumbnailUrl|thumbnail|imageUrl|poster|courseImage|cover" assets\js\pages\admin-courses.js assets\js\pages\courses.js assets\js\pages\course-detail.js assets\js\utils\course-readonly.js members\admin\courses.html md\DATABASE_SCHEMA.md -g "!dist/**"
Get-Content -LiteralPath 'scripts\prebuild.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\pages\admin-popup.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\pages\home-popup.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\pages\admin-instructors.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\pages\admin-site.js' -Encoding UTF8
Get-Content -LiteralPath 'assets\js\utils\image-upload.js' -Encoding UTF8
Get-Content -LiteralPath 'firestore.rules' -Encoding UTF8
Get-ChildItem -LiteralPath 'assets\instructors\profile' -File
Get-ChildItem -LiteralPath 'assets\popup' -File
```

## 20. Change Confirmation

```text
No source code was modified.
No Firestore rules were modified.
No Functions were modified.
No asset files were moved, deleted, or renamed.
No build/deploy command was run.
Only the asset/R2 audit Markdown document was updated.
```
