# Project Documentation Index

최종 갱신: 2026-10-19 (문서 안내 메타데이터)

## 1. 목적

이 문서는 Grit Edu LMS/CMS의 최종 최소 문서 map입니다. 현재 프로젝트 이해, 운영, 개발 인수인계, 발표/PT에 필요한 문서만 유지합니다.

최신 구현·운영 상태는 `docs/MAINTENANCE_LOG.md`의 2026-10-19 강사 개인정보 분리 전환과 `ADMIN_CMS_STATE.md`를 우선 확인합니다. 아래 2026-07-18/08-25 문구는 당시 기록입니다.

관리자 CMS 버튼·입력·모달 및 시각 QA 기준은 `docs/UI_DESIGN_SYSTEM.md`, 화면별 현황은 `ADMIN_CMS_STATE.md`, 실제 QA 결과는 `docs/ROLE_TEST_PLAN.md`를 확인합니다.

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
- Story CMS v2, Contact canonical CMS, Popup `textItems[]`, 카카오톡 채널 플로팅 링크(`settings/kakaoChannel`)는 `ADMIN_CMS_STATE.md`, `md/DATABASE_SCHEMA.md`, `docs/OPERATION_MANUAL.md`를 함께 봅니다.
- 운영 기록 정리 정책은 `docs/OPERATION_MANUAL.md`, `md/DATABASE_SCHEMA.md`, `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`를 기준으로 봅니다. 자동 정리는 검증된 transient 기록 3종에 한정하고, 학습 회차·접근 이력은 age/status만으로 자동 삭제하지 않습니다.
- `scheduledRecordCleanup` remains fixed at 03:00 Asia/Seoul. Phase 2A runs only three bounded transient `cleanupAt` queries, removes legacy full scans, and protects offline session/access records from automatic deletion.
- 2026-08-25 기준 coordinated rollout commit `4d1a83d1`의 static/기존 4개 Functions/Rules가 production에 배포됐고, 이후 sticky UI와 parent-only attempt UI가 Cloudflare Pages에 반영됐습니다. `linkMemberChild`만 후속 단독 재배포됐으며 성공 attempt의 새 `submittedInput` 실문서 확인만 `Deployed` 상태로 남아 있습니다.
- 학원정보조회·교습비·환불규정 이미지는 `settings/tuitionImages`와 R2 `public/footer/` URL을 사용하며, 기존 PDF fallback은 사용하지 않습니다.
- 약관/개인정보처리방침은 2026-07-03에 공개 이용약관과 회원가입 동의 요약의 기술적 표현을 줄이고, 개인정보처리방침 전문의 상세 항목은 유지하는 방향으로 축소 정비했습니다. 국외이전 세부정보, 14세 미만 온라인 가입 운영 정책, 개인정보 보호책임자 표기, `LEGAL_POLICY_VERSION`/Firestore rules 동시 갱신 여부는 운영자 확인 항목입니다.
- 문서 최적화 기준은 active source-of-truth와 core audit만 유지하는 것입니다. 과거 도메인 상태 보고, 기능 로드맵 감사, iOS/KakaoTalk CSS 감사의 핵심 내용은 각각 Cloudflare Pages audit, ERP/R2 blueprint, 운영 QA 체크리스트에 병합했습니다.

## 2. Primary Reading Order

1. `AGENTS.md`
2. `PROJECT_STATE.md`
3. `docs/MAINTENANCE_LOG.md`
4. `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md`
5. `docs/PROJECT_PRESENTATION_OUTLINE.md`
6. `docs/OPERATION_MANUAL.md`
7. `docs/BUILD_AND_DEPLOY.md`
8. `ADMIN_CMS_STATE.md`
9. `md/DATABASE_SCHEMA.md`
10. `ONLINE_COURSE_SYSTEM_STATE.md`
11. `OFFLINE_CLASS_SYSTEM_PLAN.md`
12. `docs/IMAGE_ASSET_POLICY.md`
13. `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`
14. `docs/audits/CLOUDFLARE_PAGES_HOSTING_MIGRATION_STATUS.md`
15. `docs/audits/CACHE_VERSIONING_OPERATIONS_PLAN.md`
16. `docs/audits/VERSION_COVERAGE_AUDIT.md`
17. `docs/audits/HOSTING_CACHE_DOWNLOAD_AUDIT.md`
18. `docs/audits/R2_PUBLIC_IMAGE_OPERATIONS_AUDIT.md`
19. `docs/audits/R2_POPUP_PUBLIC_MIGRATION_PLAN.md`
20. `docs/ERP_LMS_R2_BLUEPRINT.md`
21. `docs/audits/ADMIN_CMS_CRUD_LIGHT_AUDIT.md`

## 3. Active Source-Of-Truth

| 문서 | 목적 |
| --- | --- |
| `AGENTS.md` | 저장소 작업 안전 원칙, source-of-truth 우선순위, 검증·배포 경계 |
| `PROJECT_STATE.md` | 전체 제품 목적, 아키텍처, Cloudflare Pages 배포 기준, Story CMS v2/greeting layout, Contact canonical CMS, Popup textItems, 구현/보류 범위, 주요 리스크 |
| `docs/MAINTENANCE_LOG.md` | Append-only material task/deployment history, status transitions, owner verification, rollback, and unresolved maintenance queue |
| `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md` | Firebase/Rules/Functions/CRUD 권한 지도, 검증 분류, collection 수명주기, 정상 기준선과 수동 성장 검토 기준 |
| `docs/BUILD_AND_DEPLOY.md` | 로컬 빌드와 미리보기, Cloudflare Pages 자동 배포, Firestore Rules와 Functions 개별 배포 명령 |
| `ADMIN_CMS_STATE.md` | 관리자 CMS 화면 map, primary-list UX, 회원 자녀/attempt read·수동 관계 lifecycle 상태 |
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
| `docs/audits/FIRESTORE_SECURITY_CRUD_MASTER_AUDIT.md` | 보안·권한·CRUD·Functions·비용 판단의 현재 master audit |
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
| `docs/audits/ADMIN_CMS_CRUD_LIGHT_AUDIT.md` | 관리자 화면의 버튼·CRUD·Firestore Rules 연결과 2026-08-01 UI 보완 사항을 기록한 경량 점검 |

## 6. Research

| 문서 | 유지 이유 |
| --- | --- |
| `docs/research/KWMATH_TECH_SECURITY_REPORT.md` | 외부 학원 사이트 기술/보안/운영 벤치마크 참고 자료 |

## 7. 문서 유지 규칙

- 새 source-of-truth는 기존 active 문서에 먼저 합칩니다.
- Record material maintenance and deployment status in `docs/MAINTENANCE_LOG.md`; do not create a permanent audit document for every task.
- 새 감사 문서는 정말 장기 참고가 필요할 때만 `docs/audits/`에 둡니다.
- 임시 진행 보고서, 오래된 milestone, 중복 audit 문서는 만들지 않거나 작업 후 삭제합니다.
- 루트에는 현재 운영/개발 기준 문서만 유지합니다.
- `dist/**`, `node_modules/**`, `functions/node_modules/**`의 Markdown은 프로젝트 문서로 보지 않습니다.

## 8. 현재 최종 세트

파일 수보다 위 reading order와 active/reference 역할 구분을 기준으로 유지합니다. 새 문서는 중복 여부를 먼저 확인하고 정말 장기 기준이 필요한 경우에만 추가합니다.
