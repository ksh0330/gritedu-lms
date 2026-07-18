# R2 Public Image Operations Audit

## 0. 2026-06-29 현재 해석 기준

이 문서는 R2 public image 1차 도입 전후의 감사 기록입니다. 현재 운영 source-of-truth는 `docs/IMAGE_ASSET_POLICY.md`, `docs/audits/ASSETS_R2_MIGRATION_AUDIT.md`, `docs/OPERATION_MANUAL.md`입니다.

현재 확정 상태:

- 운영 R2 public base URL은 `https://assets.gritedu.kr`입니다.
- 신규 운영 입력은 custom domain을 우선하고, legacy `r2.dev` URL은 과도기 호환으로만 둡니다.
- popup main/content image, instructor profile/참고 자료 image, Story hero/CEO image는 R2 public URL 운영이 가능합니다.
- 2026-07-06: 강사 참고 자료 신규 R2 prefix는 `public/instructors/image/`이며, CMS 로컬 파일 선택 UI는 제거되었습니다. legacy `public/instructors/curriculum/` URL은 읽기 호환만 유지합니다.
- Story v2는 rich editor 이미지 첨부가 아니라 CMS의 banner/CEO image URL 필드만 사용합니다.
- Contact/page content image attach, arbitrary file attach, `data:image`/base64/blob 저장은 계속 차단 대상입니다.
- R2 이미지 로딩 QA는 2026-06-29 기준 완료되었습니다.

아래 본문에서 "story image attach 차단"이라고 표현된 부분은 legacy rich editor/content HTML 이미지 첨부 차단을 뜻합니다. 현재 Story v2의 `heroImageUrl`/`greeting.ceoImageUrl` R2 URL 입력 허용 정책과 충돌하지 않습니다.

## 1. Executive Summary

Cloudflare R2 bucket `gritedu-public-assets` and the public development URL are already usable for public images. The popup proof of concept confirmed that a public R2 HTTPS URL saved in the CMS `imageUrl` field can render on the public site immediately, without `prebuild`, asset copy, Hosting deploy, or Firebase Storage.

This audit separates the image/file flows into public image operations, local static assets, flows that should be removed or blocked, and future private file operations. The important boundary is simple: public read Firestore collections may reference public images only; student, class, report, score, assignment, and private learning files must never be stored under an R2 `public/` prefix.

Recommended immediate direction: **C. Shared image validator/helper를 만들고, popup/instructor에만 적용**. Shared validation applies to popup, instructor profile, and instructor reference images (legacy field `curriculumImageUrl(s)`).

Story/contact/page-content image attachment flows should not be migrated to R2 public. They should be treated as **REMOVE_OR_BLOCK_NOW**, with care for existing Firestore HTML content. In particular, `data:image/*`, base64 image content, rich editor base64 image storage, and `/assets/pages/{slug}/files/*` arbitrary attachment flows should be blocked.

No source code, rules, functions, scripts, assets, `dist`, or Firestore data were changed for this audit. Only this Markdown document was created.

## 2. Confirmed R2 Popup PoC

| Item | Confirmed Value |
| --- | --- |
| R2 bucket | `gritedu-public-assets` |
| Public development URL | `https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev` |
| Test object key | `public/popup/open.webp` |
| Test object URL | `https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev/public/popup/open.webp` |
| HEAD status | `HTTP/1.1 200 OK` |
| Content-Type | `image/webp` |
| Content-Length | `103032` |
| Public CMS result | Popup `imageUrl` with the R2 public URL rendered on the public site without build/deploy |

Current popup source observations:

- `members/admin/popup.html` exposes `#popupEditImageUrl` and a file selector `#popupImageFileInput`.
- `assets/js/pages/admin-popup.js` accepts `/assets/popup/*.webp` and generic `https://` for `imageUrl`.
- The file selector is not an upload. It creates a local object URL preview and writes a prepared `/assets/popup/{safeName}.webp` path.
- `assets/js/pages/home-popup.js` renders popup `imageUrl` into `<img src="...">` after allowing root-relative or HTTPS URLs.
- R2 URL works because it avoids the local `/assets` build pipeline entirely.

## 3. Revised R2 Public Object Key Policy

Use no year folders.

Recommended public key structure:

```text
public/popup/{slug}-{hash}.webp
public/instructors/profile/{instructorId}-{hash}.webp
public/instructors/image/{instructorId}-{hash}.webp
public/notices/{noticeId}-{hash}.webp
public/events/{slug}-{hash}.webp
```

Do not use these key structures:

```text
public/popup/2026/...
public/instructors/profile/2026/...
public/pages/story/...
public/pages/contact/...
public/timetable/...
```

Policy:

- Key names should use lowercase ASCII letters, numbers, hyphen, and underscore only.
- Korean characters, spaces, parentheses, and ambiguous punctuation should be disallowed.
- Existing keys should not be overwritten. A new image means a new key.
- `.webp` should be the default public image format.
- URL paths must not contain an `/assets/` segment, because build/prebuild validation scans local asset references.
- Private files must never use the `public/` prefix.
- `r2.dev` is acceptable for the current proof-of-concept and early operations, but the validator should be designed so a custom domain can be added later.

## 4. Full Image Flow Inventory

| Area | Admin Input | Firestore Field | Current Input Format | Public Renderer | Current Build Dependency | Recommended Classification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Popup main image | `members/admin/popup.html` `#popupEditImageUrl`, `#popupImageFileInput`; `assets/js/pages/admin-popup.js` | `settings/popups.popups[].imageUrl` | `/assets/popup/*.webp` or `https://...`; file selector generates local prepared path | `assets/js/pages/home-popup.js` renders `<img class="popup-main-image">` | Local `/assets` path needs source asset, WebP/prebuild, deploy. R2 URL does not. | `R2_PUBLIC_NOW` | PoC succeeded. Needs domain/key validator and UX wording update. |
| Popup content images | Popup rich editor image button in `admin-popup.js` | `settings/popups.popups[].content` HTML `<img src>` | Prepared `/assets/popup/*.webp`; object URL preview; `data-save-path`/`data-image-path` replaced on save | `home-popup.js` sanitizes content image `src` to root-relative or HTTPS | Local path depends on asset/deploy. R2 URL can work if saved as HTTPS and allowed. | `R2_PUBLIC_NOW` | Public popup content images are acceptable, but `data:`/`blob:`/base64 must be blocked before formal operation. |
| Instructor profile image | `members/admin/users/instructors.html` `#editInstructorPhoto`, `#instructorPhotoFileInput`; `admin-instructors.js` | `instructors.profilePhoto`, `instructors.photo`; public readers also check `imageUrl`/profile image variants | `/assets/instructors/profile/*`, `http(s)`, legacy `data:`/`blob:` handling in admin code | `home-instructors.js`, `instructors.js`, `instructor-details.js`, `course-detail.js` | Local file needs asset path and deploy. R2 URL should render as normal image URL. | `R2_PUBLIC_NOW` | Actual public instructor profile photos can move to R2 public. Keep `/assets/instructors/profile/profile.png` local as placeholder. |
| Instructor reference images (legacy field: `curriculumImageUrl(s)`) | `members/admin/users/instructors.html` `.curriculum-image-input` (R2 URL only; file input removed 2026-07-06); `admin-instructors.js` | `instructors.curriculumImageUrl`, `instructors.curriculumImageUrls` | R2 `public/instructors/image/*` (신규), legacy read `public/instructors/curriculum/*`, rollback `/assets/instructors/curriculum/*` | `instructor-details.js` renders reference image buttons/lightbox | R2 URL renders without deploy. Legacy local/R2 paths remain readable. | `R2_PUBLIC_NOW` | Shared validator applied. Local file selection removed. |
| Course thumbnail/poster legacy fields | No active image upload/input in `members/admin/courses.html`; `admin-courses.js` removes legacy fields on save | Legacy `courses.thumbnail`, `courses.coverImage`, `courses.image`; schema/doc references `thumbnailUrl` possibilities | Existing legacy data only, if any | `courses.js` is text/card based; `course-detail.js` uses video/media and instructor avatar, not course thumbnail | Local path would need assets if reintroduced | `R2_PUBLIC_FUTURE` | Do not create now. If course thumbnail/poster becomes an explicit future feature, use R2 public only and avoid resurrecting legacy fields silently. |
| Public notice image | No active audited UI in current required files | Future notice/event docs | Not implemented in current audited flow | Future public renderer | Not implemented | `R2_PUBLIC_FUTURE` | Allowed by policy only for public notices. Key pattern: `public/notices/{noticeId}-{hash}.webp`. |
| Public event poster | No active audited UI in current required files | Future event docs | Not implemented in current audited flow | Future public renderer | Not implemented | `R2_PUBLIC_FUTURE` | Allowed by policy only for public events. Key pattern: `public/events/{slug}-{hash}.webp`. |
| Story images | `members/admin/site.html` story rich editor/image button; `admin-site.js` `uploadStoryImageModal()` and `uploadStoryImage()` | `pages/story.structure.sections[].content`; generated/legacy `pages/story.content` | `/assets/story/*.webp`; object URL preview; `data-save-path`/`data-image-path` | `story.js` assigns stored `content` via `innerHTML` | Local path depends on `assets/story`, prebuild, deploy | `REMOVE_OR_BLOCK_NOW` | Do not migrate to R2. Remove/block image attach and block `data:image`. Existing Firestore content should be exported/checked before hard removal. |
| Contact images | `admin-site.js` `uploadContactDirectionsImage()` and `uploadContactImage()`; legacy contact content editors in code | `pages/contact.content`; `pages/contact.structure` is now mostly structured locations | `/assets/contact/*.webp`; object URL preview; `data-save-path`/`data-image-path` | `contact.js` renders structured locations, but falls back to stored `content` via `innerHTML` | Local path depends on `assets/contact`, prebuild, deploy | `REMOVE_OR_BLOCK_NOW` | Do not migrate to R2. Keep structured contact fields; block image attach/base64 in legacy HTML content. |
| Page arbitrary files | `admin-site.js` has `/assets/pages/${slug}/files/${safeFileName}` local path behavior | Page content/HTML links, depending on editor flow | `/assets/pages/{slug}/files/*` | Public page content/link rendering if stored | Would require manual asset placement/deploy | `REMOVE_OR_BLOCK_NOW` | Arbitrary page files mix public/private risk and should not be supported through public HTML content. |
| Page/rich editor base64 images | Contenteditable/rich editor and utility code paths; `image-upload.js` uses `FileReader.readAsDataURL()` for helper flows | HTML content fields if pasted/saved or helper callback persists data URL | `data:image/*;base64,...`, `blob:`, or local prepared path | Public renderers using `innerHTML` can render whatever was stored | No build dependency for base64, but Firestore payload and security risk are high | `REMOVE_OR_BLOCK_NOW` | Block `data:image`, `blob:`, and base64 image persistence. Existing data requires export/search to confirm cleanup scope. |
| Timetable detail image | No active input in `members/admin/timetable.html`; `admin-timetable.js` saves text/link, not image | `publicTimetableEntries.timetableImageUrl` is read by public code | Renderer-supported field, but no current CMS operation | `schedule.js` renders detail `<img>` if field exists | Unknown/local if legacy value exists | `REMOVE_OR_BLOCK_NOW` for new CMS feature | Do not create now. Requested key policy explicitly disallows `public/timetable/...`. Existing renderer support should not be expanded into upload/UI work in this phase. |
| Offline/private class files | No current image/file upload in `members/admin/offline-classes.html` or `admin-offline-classes.js` | Future `offlineClassSessions.materials`, assignments, reports, etc. | Not implemented | Restricted/private views only | Not applicable | `R2_PRIVATE_LATER` | Requires signed/private access design, download logging if needed, and no public URL storage. |
| Fixed app/static assets | Existing `assets/**` root images, logos, icons, JS/CSS/partials, `school.csv`, footer PDFs | Static Hosting files, not Firestore image fields | Local repo files | Static site | Required by prebuild/Hosting | `KEEP_LOCAL` | Keep logos, favicon, theme icons, root main/banner originals, default OG/basic assets, placeholder profile image, public footer PDFs, JS/CSS/partials local. |

## 5. Story / Contact / Page Content Image Attachment Audit

Overall conclusion: **REMOVE_WITH_CARE** for story/contact image attachment flows, implemented as **REMOVE_OR_BLOCK_NOW** in the R2 classification. The functions exist and public renderers still support legacy HTML content, so the code path should be blocked/removed carefully after exporting and inspecting current Firestore content for `<img>`, `data:image`, `/assets/story`, `/assets/contact`, and `/assets/pages/{slug}/files/*`.

| Area | Image Attach Exists? | Base64/Data URL Risk | Current Storage Behavior | Recommended Action | Data Cleanup Needed |
| --- | --- | --- | --- | --- | --- |
| Story section rich editor | Yes. `uploadStoryImageModal()` and `uploadStoryImage(sectionId)` insert prepared images into story editors. | Medium to high. Source helper uses object URL plus `data-save-path`, but contenteditable paste/import can still carry `data:image`; public renderer uses `innerHTML`. | Saves normalized section HTML into `pages/story.structure.sections[].content`; generated/legacy `pages/story.content` can also be rendered. | `REMOVE_WITH_CARE`; block image attach and block `data:image`/`blob:` persistence. | Yes. Export `pages/story` and search HTML before removal. |
| Contact content/directions rich editor | Yes in source. `uploadContactDirectionsImage()` and `uploadContactImage()` insert prepared `/assets/contact/*.webp` images. | Medium to high for legacy content. Current structured contact model reduces need, but fallback HTML still renders. | Current save path favors `pages/contact.structure` and clears `content`, but existing/legacy `content` can still render via `innerHTML`. | `REMOVE_WITH_CARE`; keep structured contact fields and block image attach/base64. | Yes. Export `pages/contact` and search old `content`. |
| Generic page file attachment | Yes in `admin-site.js` path generation for `/assets/pages/${slug}/files/${safeFileName}`. | File type and privacy risk, not only image risk. | Stores local public asset path references in page/editor content if used. | `REMOVE_OR_BLOCK_NOW`. | Yes if any existing content references `/assets/pages/`. |
| Rich editor base64 image content | Possible through contenteditable paste/import and utility code paths using `FileReader.readAsDataURL()`. | High. Firestore can bloat, cache poorly, and bypass public/private asset policy. | If persisted, stored directly inside Firestore HTML content. | `REMOVE_OR_BLOCK_NOW`; reject `data:image/*`, `blob:`, and base64 image strings on save. | Unknown until Firestore export. Treat as `NEEDS_MANUAL_DATA_CLEANUP` check. |
| Public story/contact rendering after removal | Not an attach flow. | Existing HTML with images may break if references are removed without cleanup. | `story.js` and contact fallback render stored HTML. Structured contact still works without image attachment. | Keep text/structured HTML rendering, but sanitize/block image/file sources. | Yes, because existing HTML may contain old image/file paths. |

Removal impact:

- Story page text, title, lead, and structured section content can remain.
- Contact page structured location cards, phone, address, hours, map links, and map iframe flow can remain.
- Image/file attachment buttons and arbitrary file insertion should not be offered for story/contact/page content.
- Existing Firestore content should be audited before deleting old render support for images, because public pages may currently rely on stored HTML.

## 6. Admin File Selection UX Audit

| Area | File Input Exists? | Actual Upload? | Current Behavior | Risk | Needed UX Change |
| --- | --- | --- | --- | --- | --- |
| Popup main image | Yes: `#popupImageFileInput` | No | Creates object URL preview and writes `/assets/popup/{safeName}.webp` into `imageUrl`. | Operator may think the file was uploaded. | Rename/help text to R2 URL operation, or keep as local fallback helper only. |
| Popup content images | Yes, dynamically created by `uploadPopupEditorImage()` | No | Creates object URL preview, inserts images with `data-save-path`/`data-image-path`, then saves local path into content. | Can preserve local path assumptions and blob/data fallback complexity. | Apply shared validator; allow R2 public HTTPS only for official public content images; block data/blob on save. |
| Instructor profile image | Yes: `#instructorPhotoFileInput` | No | Creates local object URL preview and writes `/assets/instructors/profile/{safeFileName}`. | Misleading upload UX; `data:` fallback exists when no photo. | Prefer URL input with R2 public validator. Keep file selector only if labeled as local path helper or removed. |
| Instructor reference image (removed 2026-07-06) | ~~Yes: `.curriculum-image-file`~~ Removed | No | ~~Creates local object URL preview~~ CMS is R2 URL input only. | N/A | R2 URL input plus preview validation only. |
| Story image modal/section | Yes, dynamic file input | No | Inserts `/assets/story/{safeName}.webp` images into rich editor content. | Disallowed flow; public HTML image/content coupling. | Remove/block image attachment for story. |
| Contact content/directions image | Yes, dynamic file input | No | Inserts `/assets/contact/{safeName}.webp` into content/directions editors. | Disallowed flow; legacy content may expose arbitrary images. | Remove/block image attachment for contact. |
| Generic page file helper | Yes, source path helper flow in `admin-site.js` | No | Creates `/assets/pages/{slug}/files/{safeFileName}` references. | Arbitrary public file attachment and privacy confusion. | Remove/block arbitrary page file attachment. |
| Course thumbnail/poster | No active image file input in required course admin files | No | `admin-courses.js` deletes legacy image fields on save. | Reintroducing this now would create scope creep. | Do not build now. Future explicit feature should use R2 public policy. |
| Timetable detail image | No active input in required timetable admin files | No | Public renderer can read `timetableImageUrl`, but admin save does not expose it. | Hidden/legacy field could exist; new UI is not requested and key policy disallows timetable public keys. | Do not build now. Consider blocking new CMS image UI. |
| Offline class/session materials | No current image/file input in required offline admin files | No | Session payload covers schedule/text/video/status, not materials/files. | Future private files must not become public URLs. | Design separately as R2 private signed URL flow later. |
| `assets/js/utils/image-upload.js` helper | Utility file contains FileReader/object URL/download-helper behavior | No server upload | Can generate data URLs, compressed files, object URLs, or local download helpers depending on caller. | If reused in CMS saves, base64/data URL can enter Firestore. | Do not use for Firestore image persistence unless output is validated and data/blob are blocked. |

## 7. Firestore Image Field Inventory

| Collection/Doc | Field | Public Read? | Current Value Type | R2 Public Safe? | Private Risk | Future Policy |
| --- | --- | --- | --- | --- | --- | --- |
| `settings/popups` | `popups[].imageUrl` | Yes | `/assets/popup/*.webp` or `https://...` | Yes, for public popup images | Low if content is intentionally public | Store R2 public URL or local fallback only through shared validator. |
| `settings/popups` | `popups[].content` HTML `<img src>` | Yes | HTML with root-relative/HTTPS images after sanitizer | Yes, only for public popup images | Medium if rich editor accepts data/blob | Allow public image URLs; block `data:image`, `blob:`, `javascript:`, and arbitrary files. |
| `instructors` | `profilePhoto`, `photo` | Yes | `/assets/instructors/profile/*`, `http(s)`, legacy data/blob fallback in admin | Yes, for public instructor profile photos | Low for public profile photos | Store R2 public URL for real photos; keep placeholder local. |
| `instructors` | `curriculumImageUrl`, `curriculumImageUrls` | Yes | R2 `public/instructors/image/*` (신규), legacy read `public/instructors/curriculum/*`, rollback `/assets/instructors/curriculum/*` | Yes, for public reference images | Low | Store R2 public URL after validator. |
| `instructors` | `imageUrl`, `profileImage`, `profileImageUrl` variants | Yes if present | Legacy/reader fallback fields | Maybe, but avoid expanding variants | Medium due field drift | Prefer canonical `profilePhoto`/`photo`; avoid adding new aliases. |
| `courses` | `thumbnail`, `coverImage`, `image` | Yes | Legacy fields; `admin-courses.js` removes on save | Future only | Medium if course media becomes private/member-only | Do not build now; if reintroduced, define canonical `thumbnailUrl` and R2 public-only semantics. |
| `courses` | `thumbnailUrl` future/canonical possibility | Yes | Not active in audited UI | Future only | Medium | Future explicit feature only. Do not use for private or member-only material. |
| `pages/story` | `structure.sections[].content`, `content` | Yes | HTML; may contain local images/files from editor | No | Medium to high if arbitrary HTML/file/image content persists | Remove/block image attachment; sanitize image/file sources; export and clean existing content. |
| `pages/contact` | `content`, `structure` | Yes | Structured location data plus legacy HTML fallback | No for image attachment | Medium to high for legacy HTML | Keep structured fields; remove/block image attachment and base64. |
| `publicTimetableEntries` | `timetableImageUrl` | Yes | Renderer-supported string, no active admin input | Not now | Medium, and key policy disallows timetable public keys | Do not create new image UI in this phase. |
| `offlineClasses` | Future image/file/material fields | Restricted/private by rules pattern | Not active | No | High | Use R2 private later, signed URL/access check only. |
| `offlineClassSessions` | Future `materials`, `pdfUrl`, `attachment` style fields | Restricted/private by rules pattern | Not active | No | High | R2 private later with key metadata, not public URL. |
| Future student/report/assignment docs | Reports, score PDFs, assignment attachments, individual learning files | Private | Not active in audited public image flow | No | Very high | R2 private later, signed URLs, access checks, optional download logging. |
| Static footer PDFs | Static paths under `assets/footer` | Public Hosting | Public PDF assets | Keep local | Low if intentionally public legal/footer docs | `KEEP_LOCAL`; do not mix with private PDFs. |

## 8. Build / WebP / Prebuild Impact

- `assets/popup`: Current local popup image flow depends on files existing under `assets/popup`, WebP conversion/prebuild, copy to `dist`, and Hosting deploy. R2 public URLs bypass this local build dependency. Popup local fallback can remain for rollback, but R2 URLs should not include `/assets/`.
- `assets/instructors/profile`: Profile photos are currently local PNG/JPG-style assets and are allowlisted in prebuild behavior. The default placeholder `/assets/instructors/profile/profile.png` should remain local. Real public instructor photos can move to R2 public after validation.
- `assets/instructors/curriculum`: legacy rollback local path. 신규 R2 prefix는 `public/instructors/image/`; legacy read `public/instructors/curriculum/`.
- `assets/story`: Current story image helper uses `/assets/story/*.webp`, and the build scripts know about story images. This path should not be migrated to R2 public; the attach flow should be removed/blocked.
- `assets/contact`: `prebuild.js` treats contact as a WebP-preferred asset directory, while `convert-webp.js` does not appear to include `assets/contact` in the same always-convert list. Since contact image attach should be removed/blocked, do not extend this path for R2 public.
- `assets/pages`: Arbitrary `/assets/pages/{slug}/files/*` attachments should be removed/blocked. They mix public HTML content with arbitrary files and create privacy/type ambiguity.
- `assets/main.png/main.webp`: `main.png` is the required source original for the home hero and OG/social representative image. `main.webp` is the forced runtime WebP output. Keep local.
- `assets/banner_main.png/banner_main.webp`: legacy optional files. Not required by prebuild. Operational OG/representative image policy uses `main.png` / `main.webp`.
- Required originals: favicon/logo/theme/root originals such as `favicon.png`, `logo.png`, `logo-dark.png`, `footer_logo.png`, `darkmode.png`, and `lightmode.png` are part of the static site asset policy. Keep local.
- Dist copy behavior: local image assets are copied/optimized into `dist` during the build pipeline. No `dist` file should be edited for this R2 public URL audit.
- Missing asset validation: prebuild validates local `/assets/...` references and missing/duplicate WebP relationships. R2 URLs should avoid `/assets/` in their URL path so they do not collide with local asset reference parsing.
- R2 URL conflict risk: a remote URL containing a path segment like `/assets/popup/...` could be misinterpreted by asset reference scanning. The key policy therefore bans `/assets/` in R2 URL paths.

## 9. Recommended CMS Operation Model

Current Phase 1 operation:

1. 운영자/개발자가 WebP 준비
2. Cloudflare R2 Dashboard에 업로드
3. public URL 복사
4. CMS 이미지 URL 입력란에 붙여넣기
5. 저장하면 즉시 반영
6. 문제 시 기존 `/assets/...` path로 rollback

Allowed in this operation:

- Popup main image and public popup content images
- Instructor profile images
- Instructor reference images (legacy field `curriculumImageUrl(s)`)
- Future public notice/event images, only after explicit feature design

Not allowed in this operation:

- Story image inputs
- Contact image inputs
- Generic page content file attachments
- `data:image/*` or base64 image content
- Private files, student files, report PDFs, score files, assignment attachments, private class materials

Story/contact should not have image input fields in the target operating model. They should keep text, structured content, and safe links/maps only.

## 10. Recommended Code Changes By Phase

### Phase 1. Shared public image URL validator/helper

- Allow `/assets/...` local fallback only for explicitly supported legacy/local public asset fields.
- Allow R2 public URL prefix for configured public domains.
- Require HTTPS for remote images.
- Block `http:`, `data:`, `javascript:`, and `blob:` for persisted Firestore image values.
- Block `data:image`.
- Distinguish `.webp` enforced areas from `.webp` recommended areas. Popup and instructor reference images should prefer/enforce `.webp`; instructor profile may need migration handling because current profile assets include PNG/JPG.
- Reject R2 URL paths containing `/assets/`.
- Validate public keys against the approved prefixes: `public/popup/`, `public/instructors/profile/`, `public/instructors/image/`, `public/story/`, `public/pages/story/`, future `public/notices/`, future `public/events/`. Legacy read-only: `public/instructors/curriculum/` (과거 데이터 호환).
- Keep the R2 development URL prefix configurable so a custom domain can be added later.

### Phase 2. Apply to allowed public image areas only

- popup
- instructor profile
- instructor reference images (Firestore field: `curriculumImageUrl(s)`)

Do not apply this helper to story/contact/page content attachment flows.

### Phase 3. Remove/block disallowed content image flows

- story image attach
- contact image attach
- page content base64 image
- rich editor base64 image persistence
- `/assets/pages/{slug}/files/*` arbitrary files

Before hard removal, export and search existing Firestore page content for:

```text
<img
data:image
base64
/assets/story
/assets/contact
/assets/pages/
blob:
```

### Phase 4. Update docs and operation checklist

- operation manual
- image asset policy
- cost audit monthly checklist
- R2 popup plan

### Phase 5. Future direct R2 upload

- separate design
- API token/Function/Worker required
- not now

Direct browser-to-R2 upload, signed upload URLs, Workers, and API token handling are out of scope for this audit.

## 11. R2 Settings Checklist

Current Cloudflare setting guidance:

- Public development URL is temporary. `r2.dev` is acceptable for the current PoC and controlled operation, but a custom domain should be planned before treating URLs as long-term public URLs.
- Custom domain later: the validator/helper should accept an allowlist, not a hard-coded single host.
- CORS policy should include `https://gritedu-lms.web.app` for browser-side image validation or `fetch`/`HEAD` checks. Plain `<img>` rendering may work without CORS, but admin validation and future tooling can need CORS.
- Storage class should remain Standard for public site images.
- No lifecycle auto-delete for public images, because Firestore may reference old keys and rollback may need old objects.
- No bucket lock now.
- No event notifications now.
- No migration/local upload beta now.
- No R2 API token creation in this phase.
- Private files must not be uploaded to the public bucket under the `public/` prefix.
- Object metadata should preserve correct `Content-Type`, especially `image/webp`.
- Same key overwrite should be operationally forbidden.

## 12. Security / Privacy / Cost Notes

- A public R2 bucket/object URL is accessible by anyone with the URL.
- Student reports, grades, class materials, private PDFs, assignment attachments, private offline class/session materials, and individual learning files must not use public URLs.
- Firestore public read collections must not contain private URLs, private R2 keys, signed URLs intended for one user, or private file metadata that reveals sensitive information.
- Base64 image in Firestore content is forbidden for future operations. It increases Firestore document size, bypasses asset policy, and makes cleanup/auditing harder.
- R2 public URL images can reduce Firebase Hosting image download load for mutable CMS-driven public images.
- R2 storage and request usage should be reviewed monthly.
- `r2.dev` is temporary before custom domain adoption.
- Public read collections in this audit include popup settings, instructors, public pages, courses, and public timetable entries. Treat all image fields in those collections as public.
- Restricted/private collections such as offline classes/sessions, members, students, enrollments, reports, and assignments require a separate R2 private design.

## 13. Immediate Implementation Recommendation

Recommendation: **C. Shared image validator/helper를 만들고, popup/instructor에만 적용**.

Reason:

- Popup R2 public URL already works, but the current validator accepts any generic `https://` URL. It needs a public image/domain/key policy, not just a protocol check.
- Instructor profile and reference images are active public image flows. They are included in the formal R2 public support pass.
- A shared helper prevents slightly different rules between popup, instructor profile, and instructor reference images.
- Story/contact/page content image flows are riskier because they store mixed HTML and are rendered with `innerHTML`. They should be blocked/removed in Phase 3, after current Firestore content is exported and checked.
- Course thumbnail/poster and timetable image features should not be created now because the audited admin UI does not actively support them and the request explicitly says not to open those areas if they are not current features.

Rejected immediate options:

- A is too narrow because instructor images are active and public, so they should be covered by the same R2 public policy soon.
- B reaches the right areas but risks duplicating validation rules unless the shared helper is created first.
- D is important, but removing story/contact/base64 first without the shared validator would leave popup/instructor R2 support unofficial and inconsistent.
- E is useful before destructive cleanup, but no Firestore data change is being made in this audit. It should be a prerequisite for Phase 3 cleanup, not for documenting the immediate implementation design.

## 14. Commands Used

Read-only commands used during this audit included:

```powershell
Get-Content -Raw -Encoding UTF8 'C:\Users\USEr\.codex\attachments\d0d58802-db03-4243-9965-ae19e1b3283c\pasted-text.txt'
Get-Content -Raw -Encoding UTF8 'C:\Users\USEr\.codex\attachments\064ca445-dd82-48ed-93de-47d9fcb36cdd\pasted-text.txt'
git status --short
Test-Path 'docs\audits\R2_PUBLIC_IMAGE_OPERATIONS_AUDIT.md'
Get-Content -Raw -Encoding UTF8 'PROJECT_STATE.md'
Get-Content -Raw -Encoding UTF8 'PROJECT_DOCS_INDEX.md'
Get-Content -Raw -Encoding UTF8 'ADMIN_CMS_STATE.md'
Get-Content -Raw -Encoding UTF8 'md\DATABASE_SCHEMA.md'
Get-Content -Raw -Encoding UTF8 'ONLINE_COURSE_SYSTEM_STATE.md'
Get-Content -Raw -Encoding UTF8 'OFFLINE_CLASS_SYSTEM_PLAN.md'
Get-Content -Raw -Encoding UTF8 'docs\OPERATION_MANUAL.md'
Get-Content -Raw -Encoding UTF8 'docs\IMAGE_ASSET_POLICY.md'
Get-Content -Raw -Encoding UTF8 'docs\FIREBASE_USAGE_AND_COST_AUDIT.md'
Get-Content -Raw -Encoding UTF8 'docs\ERP_LMS_R2_BLUEPRINT.md'
Get-Content -Raw -Encoding UTF8 'docs\audits\ASSETS_R2_MIGRATION_AUDIT.md'
Get-Content -Raw -Encoding UTF8 'docs\audits\R2_POPUP_PUBLIC_MIGRATION_PLAN.md'
rg -n '/assets/|assets/' . -g '!dist/**' -g '!node_modules/**' -g '!functions/node_modules/**' -g '!.git/**'
rg -n 'data:image|base64|contenteditable|rich|editor|insertImage|data-save-path|data-image-path|FileReader|readAsDataURL|URL\.createObjectURL|type="file"|accept="image|handle.*Upload|preview|new Image' members assets/js -g '!dist/**' -g '!node_modules/**' -g '!functions/node_modules/**'
rg -n 'type="file"|accept="image|accept="\.png|uploadPopup|uploadStoryImage|uploadContact|instructorPhotoFileInput|curriculum-image-file|timetableImageUrl|thumbnail|coverImage|imageUrl' members/admin assets/js/pages assets/js/utils -g '!dist/**' -g '!node_modules/**' -g '!functions/node_modules/**'
rg -n 'imageUrl|imagePath|imageFile|thumbnail|thumbnailUrl|coverImage|profileImage|profilePhoto|photo|curriculumImage|curriculumImageUrl|curriculumImageUrls|poster|popup|story|contact|timetable|detailImage|fileUrl|pdfUrl|attachment' members assets/js scripts firestore.rules firebase.json -g '!dist/**' -g '!node_modules/**' -g '!functions/node_modules/**'
rg -n 'webp|convert|sharp|missing|assetImageRefPattern|PRESERVED|REQUIRED|WEBP|assets/popup|assets/instructors|assets/story|assets/contact|assets/pages' scripts assets/js -g '*.js'
Get-ChildItem -Path 'assets' -File -Recurse | Sort-Object FullName | ForEach-Object { $_.FullName.Substring((Resolve-Path '.').Path.Length + 1).Replace('\','/') }
Get-ChildItem -Path 'assets\popup' -File
Get-ChildItem -Path 'assets\instructors\profile' -File
Get-ChildItem -Path 'assets\instructors\curriculum' -File
Get-ChildItem -Path 'assets\story' -File
curl.exe -I 'https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev/public/popup/open.webp'
```

No build, deploy, install, format, conversion, Firestore write, R2 token generation, or asset mutation command was run.

## 15. Change Confirmation

```text
No source code was modified.
No Firestore rules were modified.
No Functions were modified.
No asset files were moved, deleted, or renamed.
No build/deploy command was run.
Only the R2 public image operations audit Markdown document was created.
```

## 16. Implementation Status (2026-06-19)

감사 권고안 **C. Shared image validator/helper + popup/instructor 적용**이 반영되었습니다.

- Helper: `assets/js/utils/public-image-url.js`
- 공식 R2 public 지원: popup main/content image, instructor profile, instructor 참고 자료 (legacy field `curriculumImageUrl(s)`)
- 로컬 `/assets` fallback 유지
- story/contact/page content 이미지 신규 첨부 차단
- Firestore rules/Functions/실제 Firestore 데이터/asset 파일 이동은 변경 없음

### Follow-up cleanup (2026-06-19)

- 강사 프로필 base64 data URI Firestore 저장/표시 제거, 렌더링 placeholder만 사용
- `localhost:5000` 운영 기준 문서화
- 관리자 `#statusMsg` / `#toast-container` z-index를 modal 위로 조정
- popup/instructor R2 안내 문구 단순화

## 17. Current Operation Status (2026-06-24)

R2 public image 1차 운영은 로컬 소스 기준 완료 상태입니다.

- Bucket: `gritedu-public-assets`
- Public development URL: `https://pub-da6a2b2ce44042838244ab921f3eb694.r2.dev`
- 공식 지원 영역: popup main image, popup content public image, instructor profile image, instructor 참고 자료 image (legacy field: `curriculumImageUrl(s)`)
- 현재 신규 R2 public prefix: `public/popup/`, `public/instructors/profile/`, `public/instructors/image/`, `public/story/`, `public/pages/story/`
- legacy read-only: `public/instructors/curriculum/` (과거 데이터 호환)
- 후보 prefix: `public/notices/`, `public/events/`
- 운영 원칙: 같은 key 덮어쓰기 금지, 새 이미지 = 새 key, CMS imageUrl을 새 URL로 교체, R2 URL path에 `/assets/` segment 금지
- R2 public URL에는 `Date.now()` 또는 render timestamp 기반 cache-buster query를 붙이지 않습니다.

아직 하지 않은 것:

- CMS 직접 R2 업로드
- R2 custom domain
- R2 private/signed URL
- 수업자료/PDF/성적표/리포트 업로드
