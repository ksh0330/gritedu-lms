# CSS Responsive iOS/KakaoTalk Audit

작성일: 2026-06-19  
목적: iPhone Safari, iPhone KakaoTalk 인앱 브라우저, Android Chrome, desktop Chrome에서 주요 화면이 안정적으로 보이도록 현재 HTML/CSS 구조의 원인 후보와 수정 우선순위를 문서화한다.

## 감사 원칙

- source code는 수정하지 않았다.
- `dist/`는 직접 수정하지 않았다.
- build/deploy는 실행하지 않았다.
- 이번 작업의 산출물은 이 감사 문서뿐이다.

## 확인한 파일 목록

### HTML

`dist/`와 `node_modules/`를 제외한 HTML을 확인했다.

- Root/public: `index.html`, `courses.html`, `course-detail.html`, `instructors.html`, `instructor-details.html`, `schedule.html`, `contact.html`, `tuition.html`, `story.html`, `privacy.html`, `terms.html`, `404.html`
- Auth/member: `members/login.html`, `members/signup.html`, `members/dashboard.html`
- Student/member/instructor: `members/students/dashboard.html`, `members/students/course.html`, `members/students/offline-class.html`, `members/member/dashboard.html`, `members/member/course.html`, `members/instructors/dashboard.html`, `members/instructors/course-detail.html`, `members/instructors/offline-class.html`
- Admin: `members/admin/dashboard.html`, `members/admin/courses.html`, `members/admin/timetable.html`, `members/admin/site.html`, `members/admin/popup.html`, `members/admin/offline-classes.html`, `members/admin/operation-tasks.html`, `members/admin/users/students.html`, `members/admin/users/members.html`, `members/admin/users/instructors.html`, `members/admin/users/add.html`
- Partials/verification: `assets/partials/header.html`, `assets/partials/footer.html`, `google09c11c6347d670a8.html`, `google67d163d457e89d11.html`, `naverc1fa48c664fbaa63b9a62324ef2723cf.html`

### CSS

- Entry: `assets/css/main.css`, `assets/css/main.legacy.css`
- Base: `assets/css/base/variables.css`, `assets/css/base/reset.css`, `assets/css/base/typography.css`, `assets/css/base/utilities.css`, `assets/css/base/layout.css`
- Components: `assets/css/components/button.css`, `assets/css/components/card.css`, `assets/css/components/header.css`, `assets/css/components/footer.css`, `assets/css/components/skeleton.css`, `assets/css/components/dashboard-skeleton.css`, `assets/css/components/status.css`, `assets/css/components/modal.css`, `assets/css/components/dashboard-modal.css`, `assets/css/components/toast.css`, `assets/css/components/pagination.css`, `assets/css/components/filter.css`, `assets/css/components/dash-back.css`, `assets/css/components/form.css`
- Pages: `assets/css/pages/*.css` 전체

## Viewport Meta 감사

### 결과 요약

- 중복 viewport meta는 발견하지 못했다. 각 일반 HTML은 0개 또는 1개다.
- `user-scalable=no`는 발견하지 못했다.
- `maximum-scale=1`은 발견하지 못했다.
- 단, 페이지별 viewport 값이 3계열로 불일치한다.

### 계열별 분류

| 계열 | 파일 | 현재 값 | 리스크 | 우선순위 |
|---|---|---|---|---|
| Public | `index.html`, `courses.html`, `course-detail.html`, `instructors.html`, `instructor-details.html`, `schedule.html`, `contact.html`, `tuition.html`, `story.html`, `privacy.html`, `terms.html`, `404.html`, `members/login.html`, `members/signup.html` | `width=device-width, initial-scale=1, viewport-fit=cover` | iPhone safe-area 대응은 좋음. | 유지 |
| Member/dashboard | `members/member/dashboard.html`, `members/students/dashboard.html`, `members/students/course.html`, `members/students/offline-class.html`, `members/member/course.html`, `members/instructors/dashboard.html`, `members/instructors/course-detail.html`, `members/instructors/offline-class.html` | `width=device-width,initial-scale=1,maximum-scale=5.0,user-scalable=yes` | 접근성에는 유리하지만 public과 `viewport-fit=cover`가 다름. safe-area가 필요한 iPhone/KakaoTalk에서 헤더/상단 여백 판단이 페이지별로 달라질 수 있음. | P1 |
| Admin mixed | `members/admin/dashboard.html`, `members/admin/courses.html`, `members/admin/timetable.html`, `members/admin/offline-classes.html`, `members/admin/operation-tasks.html`, `members/admin/users/members.html` | `width=device-width,initial-scale=1,maximum-scale=5.0,user-scalable=yes` | 위와 동일. | P1 |
| Admin simple | `members/admin/site.html`, `members/admin/popup.html`, `members/admin/users/students.html`, `members/admin/users/instructors.html`, `members/admin/users/add.html`, `members/dashboard.html` | `width=device-width,initial-scale=1` | 같은 관리자 계열 안에서도 확대/viewport-fit 정책이 다름. | P1 |
| Verification/partials | Google/Naver verification HTML, `assets/partials/*.html` | 없음 | 단독 UI 화면이 아니면 영향 작음. "모든 HTML" 기준으로는 예외 문서화 필요. | P2 |

## 전역 CSS 구조 감사

### Import 구조

`assets/css/main.css`는 다음 순서로 모든 CSS를 import한다.

1. base: variables -> reset -> typography -> utilities -> layout
2. components: button/card/header/footer/skeleton/dashboard/status/modal/toast/pagination/filter/form
3. pages: public/course/admin/student/home/dashboard 등 page CSS 전체

핵심 리스크는 page CSS가 실제 페이지에서만 로드되는 구조가 아니라 `main.css`를 통해 전체 페이지에 전역으로 들어온다는 점이다. 따라서 selector가 page scope 없이 작성된 경우, 다른 화면에도 override가 번진다.

### Override 관계

| 계층 | 확인 내용 | 리스크 | 우선순위 |
|---|---|---|---|
| `reset.css` | reset은 최소화되어 있고 `.visually-hidden` 정도만 `nowrap`을 가진다. | 낮음 | P2 |
| `typography.css` | `html`에 `-webkit-text-size-adjust:100%`, `text-size-adjust:100%`가 있다. `body`에 `overflow-x:hidden`이 있다. 입력 요소 기본은 16px이다. | iOS text autosizing 대응은 있음. 다만 `overflow-x:hidden`이 원인 해결 대신 가로 넘침을 숨길 수 있다. | P1 |
| `layout.css` | `.grit-page-container`, `.container`, `.grit-section` 기준 폭을 제공한다. | 대체로 안정적. | P2 |
| `components/header.css` | 모바일 헤더가 `max-width:min(... calc(100vw - ...))`, `100svh` 등을 사용한다. | 방향은 좋음. | P2 |
| `pages/public.css` | header 관련 selector를 다시 포함하며 다수 `!important`로 `components/header.css`를 덮는다. | header source of truth가 둘로 나뉜다. iPhone/KakaoTalk 헤더 문제 수정 시 한쪽만 수정하면 회귀 가능. | P1 |
| `pages/admin.css` | `.admin-table`, `.admin-toolbar`, `.form-group` 등 전역 selector가 많다. | 모든 페이지에 import되며, 폼 입력 font-size 14px override가 iOS zoom 리스크를 만든다. | P0 |
| `pages/admin-students.css`, `admin-instructors.css`, `admin-user-add.css` | `.admin-table`, `.modal`, `.form-group` 등 page scope 없는 selector가 있다. | main.css에서 전역 로드되고, 일부 HTML에서는 같은 CSS를 다시 link해 우선순위가 달라진다. | P1 |
| `pages/admin-dashboard.css` | `.admin-dashboard-page` 중심으로 비교적 잘 scoped. | `members/admin/dashboard.html`에서 main.css에 포함된 뒤 같은 CSS를 별도 link해 중복 로드된다. | P2 |
| `pages/home.css` | `.home` scope가 대부분 적용되어 public override 리스크가 낮다. | hero typography가 큰 `vw` clamp를 사용한다. | P2 |
| `pages/student-dashboard.css`, `instructor-dashboard.css` | 일부는 page class scoped, 일부 `.modal`, `.form-group`, `.stat-card`는 넓다. | 대시보드/모달/폼 간 override 가능. | P1 |

### 중복 CSS link

`main.css`가 이미 page CSS를 import하는데, 다음 HTML은 같은 page CSS를 다시 link한다.

- `members/admin/dashboard.html`: `/assets/css/pages/admin-dashboard.css`
- `members/admin/users/students.html`: `/assets/css/pages/admin-students.css`
- `members/admin/users/members.html`: `/assets/css/pages/admin-members.css`
- `members/admin/users/instructors.html`: `/assets/css/pages/admin-instructors.css`
- `members/admin/users/add.html`: `/assets/css/pages/admin-user-add.css`

이 구조는 의도적으로 "해당 페이지 CSS를 마지막에 다시 적용"하는 효과를 만들지만, import order 의존성이 커지고 디버깅이 어려워진다.

## iOS Text Autosizing 감사

### 양호한 점

- `assets/css/base/typography.css`:
  - `html { -webkit-text-size-adjust:100%; text-size-adjust:100%; }`
  - `input, select, textarea, button { font:inherit; font-size:16px; }`
- `assets/css/components/form.css`:
  - `@media (max-width:768px)`에서 `input/select/textarea`를 16px로 지정한다.
- `assets/css/pages/signup.css`:
  - `@media (max-width:640px)`와 `@media (max-width:768px)`에서 signup 입력을 16px로 되돌리는 규칙이 있다.

### 문제 후보

뒤에 import되는 page CSS가 더 높은 specificity로 14~15px를 다시 지정한다. iOS Safari/KakaoTalk에서 텍스트 입력 focus 시 자동 확대가 발생할 수 있다.

| selector | 파일 | 현재 font-size | 영향 | 수정 필요 | 우선순위 |
|---|---|---:|---|---|---|
| `.admin-toolbar__search-input` | `assets/css/pages/admin.css:130` | 14px | 관리자 검색 입력, public courses/schedule에서 admin toolbar class를 재사용하는 경우 | 필요 | P0 |
| `.admin-toolbar__select` | `assets/css/pages/admin.css:152` | 14px | 관리자 select, courses/schedule toolbar select | 필요 | P0 |
| `.form-group input[type=...], .form-group select` | `assets/css/pages/admin.css:186` | 14px | admin 전역 폼 | 필요 | P0 |
| `.form-group textarea` | `assets/css/pages/admin.css:492` | 14px | admin 전역 textarea | 필요 | P0 |
| `.form-group input/select/textarea` | `assets/css/pages/admin-students.css:160`, `admin-instructors.css:168`, `admin-user-add.css:49` | 15px | 학생/강사/계정관리 모달 | 필요 | P0 |
| `#contentEditModal .form-group input/textarea/select` | `assets/css/pages/admin-courses.css:526` | 15px | 강의 편집 모달 | 필요 | P0 |
| `.form-group input/select/textarea` | `assets/css/pages/instructor-dashboard.css:342` | 14px | 강사 대시보드 모달/폼 | 필요 | P0 |
| `.instructor-search-input, .instructor-select` | `assets/css/pages/instructor-dashboard.css:489` | 14px | 강사 대시보드 검색/필터 | 필요 | P0 |
| `.modal-overlay .modal-content.auth-card input/select` | `assets/css/pages/student-dashboard.css:81` | 15px | 학생 대시보드 프로필/수강 취소 모달 | 필요 | P0 |
| `.school-search-input-wrapper input` | `assets/css/pages/public.css:154` | 15px | 학교 검색 모달. 모바일 media에서 16px 보정됨 | 조건부 | P2 |
| `.email-verify-group input`, `.verify-group input` | `assets/css/pages/signup.css:418`, `signup.css:465` | 15px | 회원가입 인증 입력. 모바일 media에서 16px 보정됨 | 조건부 | P2 |

## 모바일 레이아웃 위험 Selector 목록

| 우선순위 | selector | 파일 | 문제 유형 | 영향 화면 | 수정 필요 여부 |
|---|---|---|---|---|---|
| P0 | `.admin-toolbar__search-input`, `.admin-toolbar__select`, `.form-group input/select/textarea` | `assets/css/pages/admin.css` | 16px 미만 입력 요소, 전역 override | admin 전체, courses/schedule 일부 toolbar, instructor dashboard 일부 | 필요 |
| P0 | `.form-group input/select/textarea` | `assets/css/pages/admin-students.css`, `admin-instructors.css`, `admin-user-add.css` | 15px 입력 요소, page scope 없음 | 관리자 학생/강사/계정관리 모달 | 필요 |
| P0 | `.form-group input/select/textarea`, `.instructor-search-input`, `.instructor-select` | `assets/css/pages/instructor-dashboard.css` | 14px 입력 요소 | `members/instructors/dashboard.html` | 필요 |
| P0 | `.modal-overlay .modal-content.auth-card input/select` | `assets/css/pages/student-dashboard.css` | 15px 입력 요소 | `members/students/dashboard.html` | 필요 |
| P1 | `body` | `assets/css/base/typography.css:8` | `overflow-x:hidden`으로 가로 넘침을 숨김 | 전체 | 조건부 필요 |
| P1 | `.grit-header`, `.grit-header__wrap`, `.grit-nav...` | `components/header.css`, `pages/public.css` | header 정의 중복, `!important` override | 전체 public/member/admin | 필요 |
| P1 | `.admin-table` | `assets/css/pages/admin.css`, `admin-students.css`, `admin-instructors.css`, `admin-user-add.css` | `min-width:900~1080px`, `white-space:nowrap`, page scope 없음 | 관리자 표 화면 | 필요 |
| P1 | `.admin-table` in students/instructors/add | `admin-students.css`, `admin-instructors.css`, `admin-user-add.css` | table 자체에 `display:block; min-width; overflow-x:auto` 적용 | 관리자 학생/강사/계정관리 | 필요 |
| P1 | `.admin-courses-page .admin-toolbar` | `assets/css/pages/admin-courses.css:28` | desktop grid 고정 열 조합. media 보정은 있음 | `members/admin/courses.html` | 확인 필요 |
| P1 | `.admin-courses-enrollment-table` | `assets/css/pages/admin-courses.css:391` | `min-width:760px`; wrapper scroll은 있음 | 강의 수강자 모달 | 유지/검증 |
| P1 | `.admin-members-table` | `assets/css/pages/admin-members.css:72` | `min-width:840px`; wrapper scroll은 있음 | `members/admin/users/members.html` | 유지/검증 |
| P1 | `.instructor-data-table` | `assets/css/pages/instructor-dashboard.css:665` | 모바일 `min-width:640px`; wrapper scroll은 있음 | `members/instructors/dashboard.html` | 유지/검증 |
| P1 | `.progress-table` | `assets/css/pages/instructor-course-detail.css:774` | 모바일 `min-width:560px` | `members/instructors/course-detail.html` | 유지/검증 |
| P1 | `.course-card__meta-band` | `assets/css/pages/courses-all.css:131` | `white-space:nowrap; overflow-x:auto` | `courses.html` | 검증 |
| P1 | `.course-detail-page .course-tab-btn` | `assets/css/pages/course-detail.css:177` | 3-tab `nowrap`; 430px 이하 보정 있음 | `course-detail.html` | 검증 |
| P1 | `main.instructors .inst-card-subject` | `assets/css/pages/instructors.css:106` | 카드 안 `white-space:nowrap` | `instructors.html` | 검증 |
| P1 | `body[data-page="instructor-details"] .assigned-course-meta-item` | `assets/css/pages/instructor-details.css:403` | 태그 `nowrap` | `instructor-details.html` | 검증 |
| P1 | `.member-parent-grid` | `assets/css/pages/member-dashboard.css:85` | `minmax(280px, ...)` 2열. 768px 이하 1열 보정 있음 | `members/member/dashboard.html` | 검증 |
| P2 | `.home-title` | `assets/css/pages/home.css:116`, `home.css:660` | `clamp(..., 7vw/8vw, ...)` | `index.html` | 검증 |
| P2 | `.course-detail-page .hero-title` | `assets/css/pages/course-detail.css:495` | 모바일 `clamp(1.8rem, 9vw, 2.4rem)` | `course-detail.html` | 검증 |
| P2 | `.signup-card` | `assets/css/pages/signup.css:5` | `width:600px`, `max-width:95vw` 있음 | `members/signup.html` | 유지 |
| P2 | `.auth-card` | `assets/css/pages/public.css:289` | `width:420px`, `max-width:92vw` 있음 | login/signup | 유지 |
| P2 | `.modal-overlay .modal-content.auth-card` | `assets/css/pages/student-dashboard.css:50` | `width:500px`, `max-width:92vw` 있음 | 학생 대시보드 모달 | font-size만 수정 |

## 주요 페이지별 리스크 분류

| 화면 | 리스크 | 우선순위 | 근거/원인 후보 |
|---|---|---|---|
| `index.html` | 낮음~중간 | P2 | `.home` scope가 잘 되어 있음. 다만 hero title이 `7vw/8vw` clamp를 사용하고 header는 public/header 중복 override 영향을 받음. |
| `courses.html` | 중간 | P1 | courses toolbar가 admin toolbar class를 재사용한다. iPhone 폭에서는 일부 16px 보정이 있으나, `admin.css`의 14px input/select와 충돌 가능. meta band는 내부 horizontal scroll 구조. |
| `course-detail.html` | 중간 | P1 | 탭 버튼 `nowrap`, 모바일 hero title `9vw` clamp. 430px 이하 보정은 있으나 KakaoTalk viewport 변동에서 실제 렌더 검증 필요. |
| `instructors.html` | 중간 | P1 | mobile grid는 대체로 안전하나 카드 내부 subject/name row가 `nowrap`/absolute overlay 조합이다. 긴 과목명/이름에서 겹침 가능. |
| `instructor-details.html` | 중간 | P1 | page scope는 좋지만 hero desktop 400px grid, assigned course meta `nowrap`, lightbox fixed UI가 있다. 980/768/480 breakpoint 실측 필요. |
| `schedule.html` | 중간~높음 | P0/P1 | 검색 input이 admin toolbar class를 재사용해 14px override를 받을 수 있다. 필터는 wrap되지만 400px 이하 별도 규칙이 있어 실측 필요. |
| `members/login.html` | 낮음 | P2 | auth input은 16px. viewport도 public 계열. |
| `members/signup.html` | 낮음~중간 | P2 | 기본 verify input은 15px이나 mobile media에서 16px로 보정된다. 약관 버튼/스텝 라벨은 작은 font-size라 텍스트 겹침 검증 필요. |
| `members/students/dashboard.html` | 높음 | P0/P1 | 모달 input/select 15px. body modal-open fixed 처리와 iOS/KakaoTalk 주소창 변동 조합 검증 필요. 오프라인 목록 action button nowrap. |
| `members/member/dashboard.html` | 중간 | P1 | parent grid는 768px 이하 1열 보정됨. 연결 자녀 날짜 `nowrap`, 일부 폼은 `font:inherit`으로 16px 가능성이 높음. |
| `members/instructors/dashboard.html` | 높음 | P0/P1 | search/select/form controls 14px, table min-width 640px, broad `.modal`/`.form-group` selector. |
| `members/admin/dashboard.html` | 낮음~중간 | P2 | grid는 640px 이하 1열. page CSS 중복 link 존재. |
| `members/admin/courses.html` | 높음 | P0/P1 | admin toolbar/form controls 14~15px, modal uses `100vh` in places, enrollment table 760px internal scroll. |
| `members/admin/users/students.html` | 높음 | P0/P1 | viewport simple 계열, CSS 중복 link, `.admin-table` 1040px, form controls 15px. table 자체 scroll 패턴은 body `overflow-x:hidden`과 충돌 가능. |
| `members/admin/users/members.html` | 중간~높음 | P1 | viewport max-scale 계열, CSS 중복 link, table wrapper scroll 840px는 비교적 안정적. toolbar select/search는 14px admin override 영향. |
| `members/admin/users/instructors.html` | 높음 | P0/P1 | viewport simple 계열, CSS 중복 link, `.admin-table` 1080px, form controls 15px. |
| `members/admin/timetable.html` | 중간~높음 | P1 | viewport max-scale 계열. schedule item row는 모바일 2열 보정 있음. admin table/toolbar 전역 영향과 cell nowrap 검증 필요. |

## 수정 우선순위

### P0: iOS 입력 자동 확대 방지

목표: iPhone Safari/KakaoTalk에서 input/select/textarea focus 시 자동 zoom을 막는다.

- page CSS 뒤쪽에서 14~15px로 내려간 `input/select/textarea`를 모바일에서는 최소 16px로 통일한다.
- 특히 `admin.css`, `admin-students.css`, `admin-instructors.css`, `admin-user-add.css`, `admin-courses.css`, `instructor-dashboard.css`, `student-dashboard.css`를 확인한다.
- 버튼 font-size는 자동 zoom의 직접 원인은 아니지만, 44px touch target 유지 여부를 함께 확인한다.

### P1: CSS scope와 horizontal overflow 안정화

목표: 전역 page CSS가 다른 페이지를 덮지 않도록 범위를 좁히고, 가로 스크롤은 의도된 wrapper 안에서만 발생하게 한다.

- `pages/public.css`에 중복된 header 정의를 `components/header.css`와 통합하거나 source of truth를 명확히 한다.
- `.admin-table`, `.modal`, `.form-group`, `.toolbar`, `.page-header-row` 같은 broad selector를 page class/body class 아래로 scope한다.
- table 자체에 `display:block; min-width; overflow-x:auto`를 주는 패턴은 wrapper scroll 패턴으로 바꿀 후보로 둔다.
- `body { overflow-x:hidden; }`는 최종적으로 유지하더라도 원인 selector를 먼저 줄인 뒤 재평가한다.

### P1: viewport 정책 통일

목표: public/member/admin 간 iPhone safe-area와 확대 정책을 일관화한다.

- 기본 후보: `width=device-width, initial-scale=1, viewport-fit=cover`
- 접근성 확대를 막지 않으려면 `maximum-scale`은 제거하거나 `maximum-scale=5.0,user-scalable=yes`를 일관 적용한다.
- admin simple 계열과 max-scale 계열의 혼재를 없앤다.

### P2: typography clamp/nowrap 검증

목표: 매우 작은 viewport, KakaoTalk toolbar, landscape에서 텍스트가 겹치지 않게 한다.

- `home-title`, `course-detail hero-title`의 큰 `vw` clamp를 실제 iPhone 폭에서 확인한다.
- 카드/태그/필터의 `white-space:nowrap`은 필요한 곳만 유지하고, 줄바꿈 가능한 텍스트에는 `min-width:0`, `overflow-wrap:anywhere`, `word-break:keep-all/break-word` 조합을 검토한다.

## 실제 수정 프롬프트 초안

아래 프롬프트는 다음 구현 단계에서 그대로 사용할 수 있다.

```text
현재 프로젝트에서 iPhone Safari, iPhone KakaoTalk 인앱 브라우저, Android Chrome, desktop Chrome 모바일/반응형 문제를 실제 수정해줘.

중요:
- dist는 직접 수정하지 마.
- 먼저 docs/audits/CSS_RESPONSIVE_IOS_KAKAOTALK_AUDIT.md를 읽고 P0 -> P1 -> P2 순서로 반영해.
- source CSS/HTML만 수정하고, build/deploy는 내가 별도로 요청하기 전까지 실행하지 마.
- 기존 사용자 변경은 되돌리지 마.

수정 우선순위:
1. P0: iOS 자동 확대 방지
   - 모든 모바일 input/select/textarea가 최종 cascade 기준 최소 16px가 되도록 수정.
   - 특히 admin.css, admin-students.css, admin-instructors.css, admin-user-add.css, admin-courses.css, instructor-dashboard.css, student-dashboard.css 확인.
   - public schedule/courses에서 admin toolbar class를 재사용하는 입력도 16px 보장.

2. P1: viewport meta 통일
   - 모든 실제 화면 HTML의 viewport 정책을 일관화.
   - user-scalable=no 또는 maximum-scale=1은 넣지 말 것.
   - iPhone safe-area를 위해 viewport-fit=cover 포함 여부를 통일.

3. P1: CSS scope/overflow 구조 안정화
   - main.css가 모든 page CSS를 import하는 구조를 고려해 broad selector를 page class/body class로 scope.
   - header 스타일 source of truth를 components/header.css 중심으로 정리하거나 public.css 중복 override를 제거/축소.
   - admin table은 wrapper overflow-x:auto + inner min-width 패턴으로 정리하고, body overflow-x hidden에 의해 내용이 잘리지 않게 검증.

4. P2: nowrap/clamp/작은 화면 텍스트 검증
   - course-detail tabs, instructors card overlay, instructor-details tags, schedule filters, signup step/terms, dashboard action buttons를 iPhone 320/375/390 폭에서 확인.
   - 필요한 곳에 min-width:0, flex-wrap, overflow-wrap, line-height 보정.

검증:
- source 수정 후 git diff를 보여줘.
- dist 수정 없음.
- build/deploy 실행 없음.
- 가능하면 Playwright 또는 브라우저 스크린샷으로 390x844, 375x812, 360x800, desktop 폭에서 주요 화면을 확인해.
```

## 이번 감사에서 수정하지 않은 것

- HTML/CSS/JS source 수정 없음.
- `dist/` 수정 없음.
- build/deploy 실행 없음.
- 실제 브라우저 스크린샷 검증 없음. 이번 단계는 정적 CSS/HTML 구조 감사다.
