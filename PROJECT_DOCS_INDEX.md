# Project Documentation Index

최종 갱신: 2026-07-18

## 1. 목적

이 문서는 Grit Edu LMS/CMS의 최종 최소 문서 map입니다. 현재 프로젝트 이해, 운영, 개발 인수인계, 발표/PT에 필요한 문서만 유지합니다.

삭제된 과거 archive/non-core audit 문서는 현재 active 문서와 core audit에 요약된 것으로 봅니다.

2026-07-18 현재 문서화 기준:

- 공식 도메인/SEO 기준은 `https://gritedu.kr`이며, 현재 Hosting 계층은 Cloudflare Pages입니다.
- 공개 정적 사이트 배포는 Cloudflare Pages Git integration 기준입니다. `git push origin main`을 하면 Cloudflare Pages가 `npm run prebuild`로 빌드하고 `dist`를 배포합니다.
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 `https://gritedu.kr` 301 redirect 완료 상태이며 path/query 보존 확인도 완료되었습니다.
- Firebase Auth/Firestore/Functions는 유지하며, Firebase Hosting은 disable 완료 상태입니다. `gritedu-lms.web.app`/`gritedu-lms.firebaseapp.com`은 404 유지 및 Search Console 정리 대상으로 봅니다.
- Cloudflare Pages/DNS/Auth authorized domains/Firebase Hosting disable/Search Console 기준은 `docs/audits/CLOUDFLARE_PAGES_HOSTING_MIGRATION_STATUS.md`를 우선 확인합니다.
- R2 public 이미지 운영 기준과 `assets.gritedu.kr` custom domain 상태, Story `public/story/` 이미지 정책은 `docs/IMAGE_ASSET_POLICY.md`와 `docs/audits/ASSETS_R2_MIGRATION_AUDIT.md`를 우선 확인합니다.
- 2026-06-29 기준 R2 이미지 로딩 QA와 `gritedu.kr` 회원가입 QA 1차는 완료 상태입니다.
- Google Search Console에서는 `gritedu.kr` sitemap 제출이 완료되었고 발견 페이지는 6개입니다. old `gritedu-lms.web.app` 속성은 임시 삭제 요청 처리 상태 확인용으로 유지합니다.
- Naver Search Advisor old 도메인 검색 제외 요청은 완료되었습니다. `gritedu.online`은 검색 제외 처리 후 재확인 대상입니다.
- 남은 운영 QA는 Cloudflare Pages `_headers` live response, forbidden URL live response, 관리자 CMS, 모바일/iPhone/KakaoTalk 확인입니다.
- Firebase 비용 판단은 Hosting 트래픽 완화 이후에도 Auth/Firestore/Functions 중심으로 `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`를 기준으로 봅니다.
- Story CMS v2, Contact canonical CMS, Popup `textItems[]`, 카카오톡 채널 플로팅 링크(`settings/kakaoChannel`)는 `md/DATABASE_SCHEMA.md`, `docs/OPERATION_MANUAL.md`를 함께 봅니다. (`ADMIN_CMS_STATE.md`는 index 참조용이며 별도 파일이 없으면 schema/manual을 우선합니다.)
- 운영 기록 정리 정책은 `docs/OPERATION_MANUAL.md`, `md/DATABASE_SCHEMA.md`, `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`를 기준으로 봅니다. `scheduledRecordCleanup` 자동 정리와 월 1회 관리자 수동 정리를 병행합니다. 오프라인 회차는 `settings/retentionPolicy` CMS 설정으로 운영합니다.
- `scheduledRecordCleanup`은 매일 03:00에 `cleanupAt` 만료 쿼리로 컬렉션당 최대 500건을 정리합니다. `cleanupAt` 없는 legacy 문서만 매월 1일 호환 정리합니다.
- 학원정보조회·교습비·환불규정 이미지는 `settings/tuitionImages`와 R2 `public/footer/` URL을 사용하며, 기존 PDF fallback은 사용하지 않습니다.
- 약관/개인정보처리방침은 2026-07-03에 공개 이용약관과 회원가입 동의 요약의 기술적 표현을 줄이고, 개인정보처리방침 전문의 상세 항목은 유지하는 방향으로 축소 정비했습니다. 국외이전 세부정보, 14세 미만 온라인 가입 운영 정책, 개인정보 보호책임자 표기, `LEGAL_POLICY_VERSION`/Firestore rules 동시 갱신 여부는 운영자 확인 항목입니다.
- 문서 최적화 기준은 active source-of-truth와 core audit만 유지하는 것입니다. 과거 도메인 상태 보고, 기능 로드맵 감사, iOS/KakaoTalk CSS 감사의 핵심 내용은 각각 Cloudflare Pages audit, ERP/R2 blueprint, 운영 QA 체크리스트에 병합했습니다.

## 2. Primary Reading Order

1. `PROJECT_STATE.md`
2. `docs/PROJECT_PRESENTATION_OUTLINE.md`
3. `docs/OPERATION_MANUAL.md`
4. `ADMIN_CMS_STATE.md`
5. `md/DATABASE_SCHEMA.md`
6. `ONLINE_COURSE_SYSTEM_STATE.md`
7. `OFFLINE_CLASS_SYSTEM_PLAN.md`
8. `docs/IMAGE_ASSET_POLICY.md`
9. `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`
10. `docs/audits/CLOUDFLARE_PAGES_HOSTING_MIGRATION_STATUS.md`
11. `docs/audits/CACHE_VERSIONING_OPERATIONS_PLAN.md`
12. `docs/audits/VERSION_COVERAGE_AUDIT.md`
13. `docs/audits/HOSTING_CACHE_DOWNLOAD_AUDIT.md`
14. `docs/audits/R2_PUBLIC_IMAGE_OPERATIONS_AUDIT.md`
15. `docs/audits/R2_POPUP_PUBLIC_MIGRATION_PLAN.md`
16. `docs/ERP_LMS_R2_BLUEPRINT.md`

## 3. Active Source-Of-Truth

| 문서 | 목적 |
| --- | --- |
| `PROJECT_STATE.md` | 전체 제품 목적, 아키텍처, Cloudflare Pages 배포 기준, Story CMS v2/greeting layout, Contact canonical CMS, Popup textItems, 구현/보류 범위, 주요 리스크 |
| `ADMIN_CMS_STATE.md` | (선택) 관리자 CMS 화면 map. 파일이 없으면 `md/DATABASE_SCHEMA.md`, `docs/OPERATION_MANUAL.md`를 우선 |
| `ONLINE_COURSE_SYSTEM_STATE.md` | 온라인 강의, 공개/회원 전용 접근, 수강 연결, deferred 결제/DRM 모델 |
| `OFFLINE_CLASS_SYSTEM_PLAN.md` | 오프라인 반, 학생 배정, 세션, 접근, 공개 시간표 복사 모델 |
| `md/DATABASE_SCHEMA.md` | Firestore active/deprecated collection, `pages/story` v2, `pages/contact` canonical `structure.locations[]`, `settings/popups.textItems[]`, `settings/kakaoChannel`, rules 경계, 데이터 거버넌스 |
| `docs/IMAGE_ASSET_POLICY.md` | Firebase Storage 미사용, 로컬 `/assets`, R2 `assets.gritedu.kr`, Story `public/story/`, WebP/prebuild 정책 |
| `docs/FIREBASE_USAGE_AND_COST_AUDIT.md` | Cloudflare Pages 전환 후 Firebase Auth/Firestore/Functions 비용 리스크와 Firebase Hosting disable 이후 비용/운영 판단 |
| `docs/ERP_LMS_R2_BLUEPRINT.md` | Firebase 유지 + Cloudflare R2 파일 계층 분리, `/assets` 축소, ERP/LMS 기능 우선순위 |

## 4. Operator / Presentation

| 문서 | 목적 |
| --- | --- |
| `docs/OPERATION_MANUAL.md` | 학원 운영자용 CMS 사용 절차 |
| `docs/PROJECT_PRESENTATION_OUTLINE.md` | PM/발표자용 서비스 개요, 12장 슬라이드 구성, 발표 스크립트 |

## 5. Reference Audits

| 문서 | 유지 이유 |
| --- | --- |
| `docs/audits/PROJECT_FULL_OVERVIEW_AUDIT.md` | 전체 구조와 주요 리스크를 추적하기 위한 core audit |
| `docs/audits/REPO_HYGIENE_AUDIT.md` | tracked dependency/generated noise 정리 근거와 repo hygiene 기준 |
| `docs/audits/CLOUDFLARE_PAGES_HOSTING_MIGRATION_STATUS.md` | Cloudflare Pages Hosting 운영, DNS/custom domain, Firebase Authorized domains, Firebase Hosting disable, Search Console, `_headers` QA 기준 |
| `docs/audits/ASSETS_R2_MIGRATION_AUDIT.md` | `/assets` 유지/R2 public/R2 private later/검토 대상 분류 근거 |
| `docs/audits/R2_PUBLIC_IMAGE_OPERATIONS_AUDIT.md` | R2 public image 1차 운영 영역, 금지 영역, story/contact/base64 차단, public/private 경계 |
| `docs/audits/R2_POPUP_PUBLIC_MIGRATION_PLAN.md` | popup `imageUrl`의 R2 public URL 저장 방식, 새 key/cache 정책, rollback 근거 |
| `docs/audits/OPERATION_CATALOG_SYSTEM_AUDIT.md` | 과거 중앙 `operationCatalog` 설계 감사 기록. 현재 구현 기준은 active 운영 문서를 우선 |
| `docs/audits/SETTINGS_VALUE_OWNERSHIP_AUDIT.md` | CMS 기준값 소유권 감사 기록. 최신 운영 기준은 `ADMIN_CMS_STATE.md`, `md/DATABASE_SCHEMA.md`, `docs/OPERATION_MANUAL.md`를 우선 |
| `docs/audits/CACHE_VERSIONING_OPERATIONS_PLAN.md` | Hosting cache, build versioning, CMS data boundary, phased implementation gate의 master plan |
| `docs/audits/VERSION_COVERAGE_AUDIT.md` | HTML top-level JS/CSS, ES module/dynamic import, partial fetch, school.csv, R2 cache-buster coverage 정밀 점검 |
| `docs/audits/HOSTING_CACHE_DOWNLOAD_AUDIT.md` | 과거 Firebase Hosting cache/download 감사, build versioning, 새 버전 prompt, Cloudflare Pages 전환 전후 cache 전략 근거 |

## 6. Research

| 문서 | 유지 이유 |
| --- | --- |
| `docs/research/KWMATH_TECH_SECURITY_REPORT.md` | 외부 학원 사이트 기술/보안/운영 벤치마크 참고 자료 |

## 7. 문서 유지 규칙

- 새 source-of-truth는 기존 active 문서에 먼저 합칩니다.
- 새 감사 문서는 정말 장기 참고가 필요할 때만 `docs/audits/`에 둡니다.
- 임시 진행 보고서, 오래된 milestone, 중복 audit 문서는 만들지 않거나 작업 후 삭제합니다.
- 루트에는 현재 운영/개발 기준 문서만 유지합니다.
- `dist/**`, `node_modules/**`, `functions/node_modules/**`의 Markdown은 프로젝트 문서로 보지 않습니다.

## 8. 현재 최종 세트

최종 의도 문서 수는 23개입니다.

- 루트 active docs: 5개
- `md/`: 1개
- `docs/`: 5개
- `docs/audits/`: 11개
- `docs/research/`: 1개
