# Operation Catalog System Audit

작성일: 2026-06-29

> 현재 상태 안내 (2026-07-02): 이 문서는 중앙 `settings/operationCatalog` 설계 검토 당시의 과거 감사 기록입니다. 현재 구현에서는 중앙 운영 기준값 탭, `settings/operationCatalog`, `assets/js/utils/operation-catalog.js`, `assets/js/pages/admin-operation-catalog-ui.js`가 폐기되었습니다. 최신 기준값 소유권과 운영 방식은 `docs/audits/SETTINGS_VALUE_OWNERSHIP_AUDIT.md`, `ADMIN_CMS_STATE.md`, `md/DATABASE_SCHEMA.md`, `docs/OPERATION_MANUAL.md`를 기준으로 봅니다.

이번 감사는 분석/문서화만 수행했다. 코드, HTML, CSS, Firestore rules, Functions, `dist/**`, Firebase/Cloudflare 설정, DB 데이터는 수정하지 않았다.

## 1. 요약

현재 "운영 기준값"은 완전히 중앙화된 단일 시스템이라기보다, 관리자 전용 원천 문서와 공개 화면용 projection 문서, 코드 fallback, CSS 하드코딩이 함께 있는 하이브리드 구조다.

핵심 구조:

| 영역 | 현재 상태 |
| --- | --- |
| 관리자 원천 후보 | `settings/operationCatalog` |
| 관리자 UI | `members/admin/site.html` -> 운영 기준값 탭, `assets/js/pages/admin-site.js`, `assets/js/pages/admin-operation-catalog-ui.js` |
| 관리자 저장 방식 | `setDoc(doc(db, "settings", "operationCatalog"), payload, { merge: true })` |
| 저장 시 동기화 | `settings/courseCatalog`, `settings/timetableCatalog`도 함께 `setDoc(..., { merge: true })` |
| 공개 강좌/강사진 | 직접 `operationCatalog`를 읽지 않고 `settings/courseCatalog`를 읽음 |
| 공개 시간표 | 직접 `operationCatalog`를 읽지 않고 `settings/timetableCatalog`를 읽음 |
| 캐시 | `settings-cache.js`의 in-memory cache + `sessionStorage`, TTL 5분 |
| 보안 규칙 | `settings/operationCatalog`는 현재 public read가 아니라 admin read/write 영역 |
| 하드코딩 | 과목/학년/과목 코드/색상/학교 CSV/HTML option fallback이 여러 파일에 남아 있음 |

가장 중요한 판단:

- `settings/operationCatalog`를 관리자 전용 canonical source로 유지하고, 공개 화면은 `settings/courseCatalog`, `settings/timetableCatalog` 같은 public projection 문서를 읽는 방식이 현재 rules와 비용 구조에 가장 잘 맞다.
- 사용자가 제안한 `pages/operationCatalog` 방식은 rules상 public read가 이미 가능하다는 장점이 있지만, 페이지 콘텐츠와 운영 설정의 경계가 흐려지고 admin-only 값까지 노출될 위험이 있어 canonical 위치로는 비추천이다.
- 과목 색상은 현재 Firestore 기준값이 아니라 CSS selector와 CSS custom property 조합에 하드코딩되어 있다. 신규 과목 추가와 색상 변경을 CMS만으로 처리하려면 색상도 catalog 데이터로 승격해야 한다.
- 최근 반영된 강사 `subject` + `subjects[]`, 시간표 `school` + `schools[]` 하위호환 구조는 실제 코드에 반영되어 있다. 향후 migration에서도 단일 필드는 대표값, 배열 필드는 실제 다중 선택값으로 유지해야 한다.

## 2. 현재 구조

### 2.1 관리자 운영 기준값 탭

관련 파일:

| 파일 | 역할 |
| --- | --- |
| `members/admin/site.html` | 사이트 관리 화면의 운영 기준값 탭 shell. `#operationCatalogEditorRoot`, `#saveOperationCatalogBtn` 제공 |
| `assets/js/pages/admin-site.js` | 관리자 권한 확인, catalog 로드/저장, projection 동기화 |
| `assets/js/pages/admin-operation-catalog-ui.js` | 태그 입력 UI, 화면별 설정, 저장 전 미리보기 |
| `assets/js/utils/operation-catalog.js` | 기본값, merge, scope resolution, select HTML helper |
| `assets/css/pages/admin-site.css` | 운영 기준값 탭 UI 스타일 |

동작 흐름:

1. 관리자가 `members/admin/site.html`에 진입한다.
2. `admin-site.js`가 `requireRole("admin")`으로 관리자 접근을 확인한다.
3. 운영 기준값 탭을 열면 `loadOperationCatalog(getSettingDoc)`가 `settings/operationCatalog`를 읽는다.
4. 문서가 없거나 읽기 실패 시 `operation-catalog.js`의 기본값을 merge해서 UI를 렌더링한다.
5. 저장 버튼을 누르면 editor state를 payload로 바꾼다.
6. `settings/operationCatalog`에 merge 저장한다.
7. 같은 저장 flow에서 `settings/courseCatalog`, `settings/timetableCatalog`를 함께 갱신한다.
8. `invalidateSetting("operationCatalog" | "courseCatalog" | "timetableCatalog")`로 현재 탭 cache를 비운다.

### 2.2 `settings/operationCatalog`

현재 helper 기준 구조:

```js
{
  subjects: ["국어", "영어", "수학", "과학", "수리논술", "컨설팅"],
  grades: ["중1", "중2", "중3", "고1", "고2", "고3", "졸업"],
  classrooms: [],
  schools: [],
  courseSubjects: [
    { value: "KOR", label: "국어" },
    { value: "MATH", label: "수학" },
    { value: "ENG", label: "영어" },
    { value: "SCI", label: "과학" },
    { value: "ESSAY", label: "수리논술" },
    { value: "ETC", label: "기타" }
  ],
  scopes: {
    instructors: { subjects: [], grades: [] },
    offlineClasses: { subjects: [], grades: [] },
    courses: { subjects: [], grades: [] },
    timetable: { subjects: [], grades: [], schools: [] },
    userAdd: { subjects: [], grades: [] }
  },
  updatedAt
}
```

주의:

- `admin-operation-catalog-ui.js`의 공통 UI는 현재 `subjects`, `grades`, `classrooms`, `schools`를 편집한다.
- `courseSubjects`는 helper/model에는 있지만 운영 기준값 탭에서 별도 편집 UI가 보이지 않는다. 저장 시 로드된 `courseSubjects`를 보존해 `courseCatalog`의 과목 코드 그룹으로 동기화한다.
- `updatedBy`, `version`은 현재 저장 payload에 없다.
- `setDoc(..., { merge: true })`라서 payload에 없는 legacy/unknown 필드는 자동 삭제되지 않는다.

### 2.3 공개 projection 문서

운영 기준값 저장 시 함께 쓰는 공개 projection:

| 문서 | 현재 사용처 | 현재 rules |
| --- | --- | --- |
| `settings/courseCatalog` | `courses.html`, `course-detail.html`, 학생/강사 강좌 화면, 공개 강사진 과목 칩 | public read, admin write |
| `settings/timetableCatalog` | `schedule.html`, 시간표 관리 fallback | public read, admin write |

`settings/courseCatalog`에는 두 계층이 섞여 있다.

- 온라인 강좌 과목 코드 필터: `chipGroups[].key === "subject"` 안의 `KOR`, `MATH`, `ENG`, `SCI`, `ESSAY`, `ETC`
- 공개 강사진 과목 칩: `instructorSubjectChips[]` 안의 한글 과목명

`settings/timetableCatalog`에는 공개 시간표 필터용 `subjects`, `grades`, `schools`, optional `gradeTabs`가 있다.

### 2.4 보안 규칙과 접근 권한

현재 Firestore rules 기준:

| 경로 | read | write |
| --- | --- | --- |
| `settings/courseCatalog` | true | admin |
| `settings/timetableCatalog` | true | admin |
| `settings/popups` | true | admin |
| `settings/{doc}` fallback | admin | admin |
| `pages/{slug}` | true | admin |
| `publicTimetableEntries/{id}` | true | admin |
| `courses/{id}` | true | admin |
| `instructors/{id}` | true | admin |

따라서 `settings/operationCatalog`는 현재 명시 match가 없고 `settings/{doc}`에 걸리므로 관리자만 읽을 수 있다. 공개 페이지가 이 문서를 직접 읽는 구조로 바꾸려면 rules 수정이 필요하다. 이번 작업에서는 rules를 수정하지 않았다.

### 2.5 캐시

`assets/js/utils/settings-cache.js`:

- 허용 key: `coursesMenu`, `instructorsMenu`, `signup`, `popups`, `courseCatalog`, `timetableCatalog`, `operationCatalog`
- `courseCatalog`, `timetableCatalog`, `operationCatalog`는 in-memory cache와 `sessionStorage`에 5분 TTL로 저장한다.
- `invalidateSetting(key)`가 in-memory와 `sessionStorage` cache를 함께 제거한다.

별도 참고:

- `home-popup.js`는 팝업 설정에 localStorage cache를 따로 쓴다.
- 운영 기준값 자체에는 localStorage cache가 아니라 `sessionStorage` cache가 쓰인다.
- `assets/school.csv`는 `school-csv.js`에서 build version query + `fetch(..., { cache: "force-cache" })` + 페이지 생명주기 Promise cache를 사용한다.

## 3. 화면별 사용 현황

| 화면 | 표시되는 값 | 필터 값 | 저장 값 | 기준값 출처 | 단일/배열 | fallback | 복수 선택 | 색상/순서/숨김 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 강사 관리 | 강사명, 과목, 공개 프로필, 이미지, 담당 강의/반 | 과목 필터는 등록된 강사 데이터에서 추출 | `instructors.subject`, `instructors.subjects[]`, 연결 계정 `instructorAccounts.subject`, `subjects[]` | `settings/operationCatalog.scopes.instructors.subjects` | 단일 대표값 + 배열 | 기본 과목 목록 | 과목 복수 선택 가능 | 과목 chip 색상은 CSS hardcode |
| 강사 공개 페이지 | 과목 badge, 강사 카드 | `settings/courseCatalog.instructorSubjectChips` | 없음 | `settings/courseCatalog`, `instructors` | `subjects[]` 우선, `subject/category` fallback | `course-catalog.js` 기본 chip | 필터는 단일 선택, 강사는 복수 과목 표시 | badge 색상은 `data-subject` CSS hardcode |
| 홈 강사진 | 강사 카드 과목 문자열 | 없음 | 없음 | `instructors`, `settings/instructorsMenu` | `subjects[]` 우선 | 필드 fallback | 표시만 복수 | overlay 텍스트 중심, catalog 색상 아님 |
| 강사 상세 | hero subtitle 과목 문자열 | 없음 | 없음 | `instructors`, `settings/instructorsMenu` | `subjects[]` 우선 | 필드 fallback | 표시만 복수 | hero는 `data-subject` 제거. 색상 catalog 미사용 |
| 온라인 강좌 관리 | 강좌 과목 label, 학년, 연도, 강사, 형식 | 과목 코드, 학년, 강사, 형식 | `courses.subject` 코드, `grade`, `year`, `courseFormat` | `operationCatalog.courseSubjects`, `scopes.courses.grades`, fallback `courseCatalog` | 단일 과목 코드 | HTML option, helper fallback | 현재 과목 단일 선택 | 색상 class는 코드/label 하드코딩 |
| 온라인 강좌 공개 목록 | 과목/학년/연도/강사 meta | 연도, 학년, 과목 | 없음 | `settings/courseCatalog` label maps + 실제 `courses` | 단일 `subject` 코드 | `course-readonly.js`, `courses.js` fallback | 단일 필터 | `SUBJECT_FILTER_ORDER`, accent class hardcode |
| 강좌 상세 | 과목 label, 강사 과목 badge, 학년/연도 | 없음 | 없음 | `settings/courseCatalog`, `courses`, `instructors` | course 단일 subject, instructor 복수 subjects 표시 | `course-readonly.js` fallback | 표시만 복수 | `subject-ko/en/ma/sc/etc` hardcode |
| 오프라인 반 관리 | 반 과목, 학년, 학교, 강의실, 일정 | 과목, 학년, 강사, 상태 | `offlineClasses.subject`, `grade`, `school`, `scheduleItems[].room`, legacy `room` | `operationCatalog.scopes.offlineClasses`, `classrooms` | 단일 subject/school | `SUBJECTS_FALLBACK`, `GRADES_FALLBACK` | 과목/학교 단일 | 색상은 상세 화면 CSS hardcode |
| 학생 대시보드 | 내 온라인 강좌 subject/grade/year, 오프라인 반 subject/school/grade | 내 강좌 상태 필터 중심 | 학생 프로필 modal은 `students.grade` 저장. 학교 변경 불가 | 강좌 label은 `courseCatalog`; 학생 grade는 `grade.js`/HTML | grade code `1..7` | HTML select + `grade.js` | 없음 | 색상 대부분 없음. 오프라인 상세 label CSS hardcode |
| 강사 대시보드 | 담당 강좌/반 과목, 학년, 학교, 강의실 | 강좌 year/grade, 오프라인 subject/grade | 없음 | 강좌는 `courseCatalog`, 오프라인 필터는 담당 데이터에서 derive | 단일 | `GRADE_PRESET` | 없음 | CSS hardcode |
| 시간표 관리 | 공개 시간표 과목, 학년, 학교, 강의실 | 과목, 학년 | `publicTimetableEntries.subject`, `grade`, `school`, `schools[]`, `scheduleItems[].room` | `operationCatalog.scopes.timetable`, `classrooms`; 실패 시 `timetableCatalog` | 학교 단일 대표값 + 배열 | HTML subject options, `SUBJECTS` | 학교 복수 선택 가능 | 색상 catalog 미사용 |
| 공개 시간표 | 과목, 학교, 학년 filter/tab, 일정 | 과목, 학교, 학년, 검색 | 없음 | `settings/timetableCatalog`; 없으면 `publicTimetableEntries`에서 derive | `schools[]` 우선, `school` fallback | `DEFAULT_SUBJECTS`, entries derive | 학교 필터 단일 선택, 항목은 복수 학교 | 색상 없음 |
| 회원/학생 추가 또는 수정 모달 | 학교, 학년, 강사 과목 | role별 제한 | `students.school`, `students.grade`, `instructors.subject` 등 | 강사 과목은 `operationCatalog.userAdd.subjects`; 학년은 HTML/`grade.js`; 학교는 text/CSV | 학생 grade code, 강사 subject 단일 | HTML options | 강사 subject 단일 | 색상 없음 |
| 사이트 관리 운영 기준값 탭 | 공통/화면별 subjects, grades, schools, classrooms preview | 없음 | `settings/operationCatalog`; projection으로 `courseCatalog`, `timetableCatalog` | Firestore + helper defaults | 배열 목록 | helper defaults | 화면별 목록은 배열, 강사 과목 scope는 중복 허용 | 색상 편집 없음 |

## 4. Firestore 저장 구조

### 4.1 현재 저장/읽기 경로

| 경로 | 현재 역할 | 읽는 화면 | 쓰는 화면 |
| --- | --- | --- | --- |
| `settings/operationCatalog` | 관리자 운영 기준값 원천 후보 | 관리자 일부 화면, 사이트 관리 운영 기준값 탭 | 사이트 관리 운영 기준값 탭 |
| `settings/courseCatalog` | 온라인 강좌 과목 코드/label, 강사진 과목 chip 공개 projection | 공개 강좌, 강좌 상세, 학생/강사 dashboard, 강사진 공개 페이지 | 사이트 관리 운영 기준값 탭, 기존 course catalog 계열 |
| `settings/timetableCatalog` | 공개 시간표 필터 projection | 공개 시간표, 시간표 관리 fallback | 사이트 관리 운영 기준값 탭 |
| `publicTimetableEntries` | 공개 시간표 데이터 | 공개 시간표, 관리자 시간표, 강사/학생 연결 표시 일부 | 시간표 관리 |
| `instructors` | 공개 강사 프로필 및 과목 | 공개 강사진/홈/상세/강좌 상세/관리자/강사 대시보드 | 강사 관리, 회원 추가 |
| `courses` | 온라인 강좌 source-of-truth | 공개 강좌/상세, 학생/회원/강사 dashboard | 온라인 강좌 관리 |
| `offlineClasses` | 오프라인 반 source-of-truth | 관리자/학생/강사 dashboard, 상세 | 오프라인 반 관리 |
| `students` | 학생 학교/학년 | 학생/회원/관리자 화면 | 가입, 관리자, 학생 프로필 |

현재 쓰지 않는 후보:

- `settings/siteCatalog`: 확인된 사용 없음
- `pages/operationCatalog`: 확인된 사용 없음
- `pages/adminSite`: 확인된 사용 없음

### 4.2 저장 방식

| 작업 | 방식 | 주의 |
| --- | --- | --- |
| 운영 기준값 저장 | `setDoc(..., { merge: true })` | unknown legacy field가 남을 수 있음 |
| course projection 저장 | `setDoc(settings/courseCatalog, ..., { merge: true })` | subject chipGroups만 재구성하고 다른 group은 보존 |
| timetable projection 저장 | `setDoc(settings/timetableCatalog, ..., { merge: true })` | `gradeTabs` 등 기존 필드는 payload에 없으면 merge로 남을 수 있음 |
| 강사 저장 | `setDoc(instructors/{id}, ..., { merge: true })` | `subject`와 `subjects[]` 함께 저장 |
| 시간표 저장 | `setDoc` 또는 `addDoc(publicTimetableEntries)` | `school`과 `schools[]` 함께 저장 |
| 오프라인 반 저장 | `setDoc` 또는 `addDoc(offlineClasses)` | 현재 `school` 단일 문자열 |
| 학생 저장 | `setDoc(students/{uid}, ..., { merge: true })` | `grade`는 코드 `1..7` |

## 5. 하드코딩 목록

### 5.1 과목/과목 코드

| 파일 | 값/역할 |
| --- | --- |
| `assets/js/utils/operation-catalog.js` | 기본 공통 과목 `국어/영어/수학/과학/수리논술/컨설팅`, 기본 온라인 과목 코드 `KOR/MATH/ENG/SCI/ESSAY/ETC` |
| `assets/js/utils/course-catalog.js` | `courseCatalog` 기본 chipGroups와 `instructorSubjectChips` |
| `assets/js/utils/course-readonly.js` | 온라인 강좌 subject code label fallback, accent class mapping |
| `assets/js/pages/courses.js` | `SUBJECT_FILTER_ORDER`, accent class mapping |
| `assets/js/pages/course-detail.js` | accent class mapping |
| `assets/js/pages/admin-offline-classes.js` | `SUBJECTS_FALLBACK` |
| `assets/js/pages/admin-timetable.js` | `SUBJECTS` |
| `assets/js/pages/schedule.js` | `DEFAULT_SUBJECTS` |
| `members/admin/courses.html` | 과목 코드 option fallback |
| `members/admin/timetable.html` | 과목 option fallback |

### 5.2 학년

| 파일 | 값/역할 |
| --- | --- |
| `assets/js/utils/grade.js` | 학생/회원가입용 grade code `1..7` -> `중1..졸업/N수` |
| `firestore.rules` | 학생 가입/업데이트 validation에 grade `1..7` 고정 |
| `members/signup.html` | 학생 가입 학년 option |
| `members/member/dashboard.html` | 자녀 연결 학년 option |
| `members/students/dashboard.html` | 학생 프로필 수정 학년 option |
| `members/admin/users/add.html` | 학생 생성 학년 option |
| `members/admin/users/students.html` | 학생 수정 학년 option |
| `assets/js/pages/admin-courses.js` | 온라인 강좌 grade fallback `중1..고3` |
| `assets/js/pages/admin-offline-classes.js` | 오프라인 반 grade fallback `중3..졸업` |
| `assets/js/pages/schedule.js` | 공개 시간표 grade sort order |
| `assets/js/pages/instructor-dashboard/courses.js` | dashboard grade preset |

### 5.3 학교

| 파일/자산 | 값/역할 |
| --- | --- |
| `assets/school.csv` | 회원가입, 회원 dashboard 자녀 학교 검색용 정적 학교 데이터 |
| `assets/js/utils/school-csv.js` | CSV fetch/cache helper |
| `assets/js/pages/signup-step2.js` | 회원가입 학교 검색 modal |
| `assets/js/pages/member-dashboard.js` | 학부모 자녀 학교 검색 |
| `members/admin/users/add.html` | 관리자 학생 생성 학교 text input placeholder |
| `assets/js/utils/timetable-schools.js` | 시간표 `school`/`schools[]` normalize/save/filter helper |
| `assets/js/pages/admin-timetable.js` | 시간표 학교 복수 선택 UI |
| `assets/js/pages/schedule.js` | 공개 시간표 학교 filter |

### 5.4 색상

과목 색상은 현재 Firestore 기준값이 아니다. 주요 하드코딩 위치:

| 파일 | 현재 방식 |
| --- | --- |
| `assets/css/base/variables.css` | `--sub-ko`, `--sub-en`, `--sub-ma`, `--sub-sc`, `--sub-consult` |
| `assets/css/pages/instructors.css` | `data-subject="국어"` 등 강사진 badge 색상. `수리논술` selector 있음 |
| `assets/css/pages/instructor.css` | legacy/public instructor badge 색상. `수리논술` selector 있음 |
| `assets/css/pages/admin-instructors.css` | 관리자 과목 chip 색상. `수리논술`은 literal `#0e7490` |
| `assets/css/pages/courses-all.css` | 온라인 강좌 card accent class |
| `assets/css/pages/course-detail.css` | 강좌 상세 subject class, 강사 과목 badge color |
| `assets/css/pages/course.css` | course label/data-subject 색상 |
| `assets/css/pages/student-offline-class.css` | 학생 오프라인 상세 subject label 색상 |
| `assets/css/main.legacy.css` | legacy 통합 CSS에도 동일/유사 selector 존재 |

현재 구조에서는 catalog에 새 과목을 추가해도 색상은 자동 반영되지 않는다. CSS selector가 없는 과목은 기본 색상이나 `subject-etc` 계열로 보일 수 있다.

## 6. 현재 문제점

1. `settings/operationCatalog`와 public projection이 분리되어 있어 저장 동기화 실패 시 관리자 기준값과 공개 필터가 달라질 수 있다.
2. `settings/operationCatalog`는 public read가 아니므로 공개 화면이 직접 읽는 설계로 바꾸면 rules 수정이 필요하다.
3. 과목/학년/과목 코드 기본값이 helper, HTML fallback, CSS, 화면 JS에 중복되어 있다.
4. `setDoc(..., { merge: true })` 저장은 안전하지만, 삭제된 legacy field나 unknown field를 자동으로 정리하지 않는다.
5. 과목 색상이 CSS 하드코딩이라 운영자가 기준값 탭에서 색상을 바꿀 수 없다.
6. `수리논술` 색상은 일부 CSS에 추가되어 있지만 온라인 강좌 accent class는 여전히 `subject-etc`로 묶이는 경로가 있다.
7. 학생/회원가입 grade는 코드 `1..7`, 운영 기준값 grade는 표시 문자열 `중1..졸업`이라 데이터 모델이 다르다.
8. 온라인 강좌 subject는 `KOR/MATH/...` 코드이고, 강사/오프라인/시간표 subject는 한글 문자열이다. 같은 "과목"으로 보이지만 저장 단위가 다르다.
9. 학교 목록은 `school.csv`와 운영 기준값 `schools`가 서로 다른 목적을 가진다. 무리하게 합치면 회원가입 검색과 시간표 필터가 충돌할 수 있다.
10. 기존 문서 데이터에 저장된 과목/학교/학년을 catalog에서 삭제해도 기존 데이터가 자동 변경되지는 않는다.
11. 과목명 변경은 `instructors`, `courses`, `offlineClasses`, `publicTimetableEntries`에 저장된 문자열/코드와 표시 label mapping을 모두 고려해야 한다.
12. 시간표는 `school` + `schools[]` 하위호환이 있으나, 오프라인 반은 아직 `school` 단일 문자열이다.
13. 강사 관리의 복수 과목은 구현되어 있지만 회원 추가 화면의 강사 과목은 아직 단일 선택이다.
14. `courseSubjects`는 기존 정책상 함부로 바꾸면 온라인 강좌 코드와 공개 URL/필터/기존 강좌 데이터에 영향을 줄 수 있다.
15. `updatedBy`, `version`, migration metadata가 없어 운영 변경 이력과 schema 전환 판단이 약하다.

## 7. 권장 데이터 모델

### 7.1 후보 비교

| 후보 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| `settings/operationCatalog` | 이미 구현되어 있음. 관리자 settings 성격과 맞음. 현재 rules에서 admin-only canonical로 안전 | 공개 페이지 직접 read 불가. public projection 필요 | canonical source로 추천 |
| `settings/siteCatalog` | settings 계층에 맞음 | 현재 사용 흔적 없음. operation/site 의미가 애매함 | 비추천 |
| `pages/operationCatalog` | rules상 public read가 이미 가능. 공개 페이지가 쉽게 읽음 | 페이지 콘텐츠와 운영 설정이 섞임. admin-only 값까지 public 노출될 위험. 기존 settings 관례와 다름 | public projection으로도 신중 |
| `pages/adminSite` | site admin과 이름상 연결 | public read rules에 걸릴 가능성, 의미 불명확 | 비추천 |
| `settings/publicOperationCatalog` 신규 | public read projection을 명확히 분리 가능 | rules 추가 필요 | 향후 검토 가능 |

권장안:

- canonical: `settings/operationCatalog`
- public projection: 현재처럼 `settings/courseCatalog`, `settings/timetableCatalog` 유지
- 향후 공개 공통 projection이 필요하면 `settings/publicOperationCatalog` 같은 명시 문서를 새로 두고, rules에서 해당 doc만 public read 허용
- `pages/*`는 Story/Contact/DDay 같은 공개 페이지 콘텐츠에 계속 사용하고, 운영 기준값 canonical로는 쓰지 않음

### 7.2 v2 모델 초안

현재 v1 배열을 바로 없애지 말고, v2 structured list를 추가한 뒤 projection과 legacy mapping을 병행한다.

```js
{
  version: 2,
  updatedAt,
  updatedBy,

  subjects: [
    {
      key: "math",
      label: "수학",
      legacyValues: ["수학", "MATH"],
      color: "#34a853",
      enabled: true,
      order: 30,
      aliases: ["수학과"]
    }
  ],

  schools: [
    {
      key: "munil-high",
      label: "문일고",
      aliases: ["문일고등학교"],
      enabled: true,
      order: 10
    }
  ],

  grades: [
    {
      key: "G1",
      label: "중1",
      legacyValues: ["1", "중1"],
      enabled: true,
      order: 10
    }
  ],

  years: [
    { key: "2026", label: "2026", enabled: true, order: 2026 }
  ],

  classrooms: [
    { key: "room-a", label: "A강의실", enabled: true, order: 10 }
  ],

  courseSubjects: [
    { value: "KOR", label: "국어", subjectKey: "korean", enabled: true, order: 10 }
  ],

  formats: [
    { key: "single", label: "특강", enabled: true, order: 10 },
    { key: "series", label: "시리즈", enabled: true, order: 20 }
  ],

  screenOverrides: {
    instructors: {
      allowedSubjectKeys: ["korean", "english", "math", "science", "essay", "consulting"],
      allowMultipleSubjects: true
    },
    timetable: {
      allowedSubjectKeys: ["korean", "english", "math", "science", "essay", "consulting"],
      allowedSchoolKeys: ["munil-high", "doksan-high"],
      allowMultipleSchools: true
    },
    courses: {
      allowedCourseSubjectValues: ["KOR", "MATH", "ENG", "SCI", "ESSAY", "ETC"],
      preserveCourseSubjectCodes: true
    }
  },

  legacyMapping: {
    subjectValueToKey: {
      "수학": "math",
      "MATH": "math"
    },
    schoolValueToKey: {
      "문일고": "munil-high",
      "문일고등학교": "munil-high"
    },
    gradeValueToKey: {
      "1": "G1",
      "중1": "G1"
    }
  }
}
```

원칙:

- 기존 저장 문서는 당분간 문자열/코드를 유지한다.
- helper가 key 기반 모델을 읽고 화면이 필요한 legacy value/label로 변환한다.
- projection 문서는 공개 화면이 읽기 쉬운 형태로 계속 생성한다.
- `subjects`, `schools`, `grades`에는 `enabled`와 `order`를 두되, 기존 데이터에 남아 있는 legacy value는 표시 fallback으로 계속 살린다.

## 8. 화면별 override 정책

권장 정책: "공통 catalog + 화면별 allowed keys"

| 정책 | 평가 |
| --- | --- |
| 모든 화면이 공통 catalog만 사용 | 단순하지만 강사/시간표/온라인 강좌 요구 차이를 수용하기 어렵다 |
| 공통 catalog + 화면별 override | 현재 구조와 유사하지만 override가 완전 대체 목록이면 drift가 생기기 쉽다 |
| 공통 catalog + 화면별 allowed keys | 추천. label/color/source는 공통이고 화면은 노출 허용 목록과 순서만 조절 |
| 화면별 독립 catalog | 중복과 불일치가 커져 비추천 |
| 과목 색상 화면별 허용 | 초기에는 비추천. 색상은 공통만 허용하고, 화면별 스타일은 CSS density 정도로 제한 |

화면별 권장:

| 화면 | 권장 |
| --- | --- |
| 강사 관리 | `allowedSubjectKeys`, `allowMultipleSubjects: true` |
| 시간표 | `allowedSubjectKeys`, `allowedSchoolKeys`, `allowMultipleSchools: true` |
| 온라인 강좌 | 기존 `courseSubjects.value` 코드는 유지. label/color는 subjectKey와 연결 |
| 오프라인 반 | subject/grade/classroom allowed keys. school은 당분간 free text 유지 후 필요 시 schools[] 검토 |
| 공개 시간표 | `timetableCatalog` projection으로 subjects/schools/grades 제공 |
| 강사진/강사 상세/홈/강좌 상세 | display label과 color는 공통 subject model에서 유도 |
| 학생/회원/강사 CMS 모달 | student grade code와 school.csv 흐름을 보존하면서 helper를 통해 label만 일관화 |

## 9. 색상 관리 정책

### 9.1 현재 평가

과목별 색상을 운영 기준값에서 관리하는 것은 가능하지만, 현재 CSS selector 구조를 그대로 두고는 불완전하다. `data-subject="과목명"` selector는 알려진 과목에만 색이 적용되고, 신규 과목은 CSS 배포 없이는 색을 얻지 못한다.

### 9.2 권장 구조

초기에는 CSS fallback을 유지하면서 data-driven 색상을 덧붙인다.

권장 방식:

1. catalog `subjects[].color`에 hex 색상을 저장한다.
2. helper가 subject label/value를 key로 normalize한다.
3. 렌더링 시 badge/card에 CSS custom property를 넣는다.

예시:

```html
<span class="subject-badge" data-subject="수리논술" style="--subject-color:#0e7490">수리논술</span>
```

CSS는 공통 형태로 단순화한다.

```css
.subject-badge {
  background: var(--subject-color, var(--brand));
}
```

주의:

- CSS selector fallback은 당분간 유지한다.
- 온라인 강좌의 `subject-etc` fallback은 `ESSAY`를 별도 key/color로 분리하는지 검토한다.
- `수리논술` 신규 색상은 catalog에 `color: "#0e7490"` 같은 값으로 넣고, 기존 CSS fallback과 비교 QA한다.

### 9.3 색상 검증

저장 전 검증:

- `#RRGGBB` hex만 1차 허용
- 빈 값은 기본 색상 fallback
- `color-mix`나 CSS 함수는 운영자 입력으로 허용하지 않음
- 흰 글자/검은 글자 대비를 계산해 WCAG AA에 못 미치면 경고
- 너무 밝은 색은 text color 자동 선택 또는 저장 차단

## 10. 마이그레이션 전략

| Phase | 목표 | 수정 파일 | Firestore 영향 | QA | rollback | 위험도 |
| --- | --- | --- | --- | --- | --- | --- |
| Phase 0 | 현황 감사 및 문서화 | 문서만 | 없음 | `git diff --check`, 문서 검토 | 문서 revert | 낮음 |
| Phase 1 | 중앙 catalog read helper v2 추가 | `operation-catalog.js`, 신규 helper, 관련 테스트/문서 | read only. 기존 문서 유지 | 기본값, v1/v2 merge, cache, legacy mapping | helper fallback을 v1로 되돌림 | 중간 |
| Phase 2 | 관리자 운영 기준값 UI 저장 구조 정비 | `admin-operation-catalog-ui.js`, `admin-site.js`, `admin-site.css` | `settings/operationCatalog.version=2`, projection 동기화 | 저장/재로드, unknown field, updatedBy/version, 색상 검증 | v1 payload 저장 flow로 되돌림 | 중간 |
| Phase 3 | 공개/관리자 화면을 catalog read로 전환 | 강사/강좌/오프라인/시간표/대시보드 JS, CSS 일부 | 공개 projection read 유지. 필요 시 `settings/publicOperationCatalog` 추가 | 공개 강좌/강사진/시간표, 관리자 4대 화면, multi subject/school | projection fallback 유지로 rollback | 높음 |
| Phase 4 | 하드코딩 fallback 제거 여부 검토 | HTML option fallback, JS constants, CSS selector | 없음 또는 projection 의존 증가 | Firestore 장애/권한 실패 시 화면 fallback 확인 | fallback constants 복구 | 중간 |
| Phase 5 | 기존 데이터 미러링/일괄 수정 도구 검토 | scripts/tools 별도, 관리자 bulk UI optional | `courses`, `instructors`, `offlineClasses`, `publicTimetableEntries`, `students` 영향 가능 | dry-run export, sample write, rollback export | Firestore export/import 또는 역방향 mapping | 높음 |

Phase 1에서 반드시 지켜야 할 점:

- 온라인 강좌 `subject` 코드는 바꾸지 않는다.
- 강사 `subject` + `subjects[]`를 둘 다 유지한다.
- 시간표 `school` + `schools[]`를 둘 다 유지한다.
- `operationCatalog` public read를 바로 열지 않고 projection을 먼저 유지한다.

## 11. 비용/성능 고려

현재 읽기 구조:

| 화면 | catalog read |
| --- | --- |
| 공개 강좌/강좌 상세/학생/강사 강좌 화면 | `settings/courseCatalog` 1 read, session cache 5분 |
| 공개 강사진 | `settings/courseCatalog` 1 read + `settings/instructorsMenu` + `instructors` |
| 공개 시간표 | `settings/timetableCatalog` 1 read + `publicTimetableEntries` |
| 관리자 운영 기준값 | `settings/operationCatalog` 1 read |
| 관리자 강좌/오프라인/시간표/강사 | `settings/operationCatalog` 또는 projection 1 read |

판단:

- 작은 학원 규모에서는 catalog 문서 1 read 자체는 큰 비용 리스크가 아니다.
- 공개 페이지마다 `settings/operationCatalog`를 추가로 읽게 만들면 page/session당 read가 늘고, 현재 rules도 맞지 않는다.
- projection 문서를 계속 쓰면 공개 화면은 필요한 최소 데이터만 읽는다.
- `settings-cache.js`의 sessionStorage 5분 TTL은 같은 탭 내 반복 이동 read를 줄인다.
- Cloudflare Pages 정적 배포는 Firestore read를 CDN cache하지 못한다. JS가 Firestore SDK로 읽는 데이터는 Firestore 비용으로 계산된다.
- catalog를 Firestore-only로 만들면 read 실패 시 필터가 사라질 수 있으므로 helper fallback은 유지해야 한다.

권장:

1. canonical `operationCatalog`는 관리자 화면과 관리자 기능에서만 읽는다.
2. 공개 화면은 public projection 문서를 읽는다.
3. projection은 작고 민감 정보가 없는 형태로 유지한다.
4. `settings-cache.js` TTL과 invalidation을 유지한다.
5. 운영자가 저장했는데 공개 화면이 즉시 안 바뀌는 경우에는 hard refresh보다 sessionStorage cache 만료/무효화 정책을 먼저 확인한다.

## 12. 보안 규칙 고려

현재는 `settings/operationCatalog`를 공개 read할 수 없다. 이 상태는 admin canonical로는 안전하다.

권장 rules 방향:

- canonical: `settings/operationCatalog` read/write admin-only 유지
- projection: `settings/courseCatalog`, `settings/timetableCatalog` public read/admin write 유지
- 새 public projection이 필요하면 `settings/publicOperationCatalog`처럼 정확한 doc match를 추가하고 public read/admin write만 허용
- `pages/*`는 공개 콘텐츠용으로 유지하고, 운영 기준값 canonical이나 admin-only 값을 저장하지 않음

주의:

- public read 문서에는 내부 운영 메모, 관리자 uid/email, private R2 key, signed URL, 비공개 강의/학생 정보가 들어가면 안 된다.
- `updatedBy`를 public projection에도 넣을지 여부는 신중해야 한다. 공개 projection에는 `updatedAt`과 `version` 정도만 권장한다.
- rules 수정이 필요하다면 별도 작업으로 진행하고, 이번 감사에서는 수정하지 않는다.

## 13. QA 체크리스트

구현 전/후 공통 QA:

- [ ] 관리자 `members/admin/site.html` 운영 기준값 탭 로드
- [ ] `settings/operationCatalog`가 없을 때 기본값 렌더링
- [ ] 운영 기준값 저장 후 `settings/operationCatalog` 갱신
- [ ] 저장 후 `settings/courseCatalog.instructorSubjectChips` 갱신
- [ ] 저장 후 `settings/courseCatalog.chipGroups.subject` 갱신
- [ ] 저장 후 `settings/timetableCatalog.subjects/grades/schools` 갱신
- [ ] 공개 강사진 과목 chip과 강사 복수 과목 표시
- [ ] 강사 관리에서 복수 과목 저장 시 `subject`와 `subjects[]` 모두 저장
- [ ] 시간표 관리에서 복수 학교 저장 시 `school`과 `schools[]` 모두 저장
- [ ] 공개 시간표 학교 필터가 `schools[]`를 인식
- [ ] 온라인 강좌 subject code `KOR/MATH/...` 기존 데이터 유지
- [ ] 오프라인 반 생성/수정 과목/학년/강의실 목록
- [ ] 학생/회원가입 grade code `1..7` 저장과 표시 label
- [ ] `school.csv` 학교 검색과 운영 기준값 `schools`의 역할 충돌 없음
- [ ] catalog read 실패 시 fallback 동작
- [ ] sessionStorage cache TTL과 저장 후 invalidation
- [ ] public read 문서에 민감 정보 없음
- [ ] 신규 과목 색상 contrast 검증
- [ ] catalog에서 항목 삭제/비활성화 시 기존 문서 표시 fallback

## 14. 구현 전 반드시 확인해야 할 질문

1. `settings/operationCatalog`를 admin-only canonical로 확정하고, 공개 화면은 projection만 읽는 방향으로 갈 것인가?
2. 공개 공통 projection이 필요하면 기존 `courseCatalog`/`timetableCatalog`를 확장할 것인가, `settings/publicOperationCatalog`를 새로 둘 것인가?
3. 과목 색상을 운영자가 직접 바꾸게 할 것인가? 허용한다면 hex 색상만 허용할 것인가?
4. 온라인 강좌 subject code `KOR/MATH/ENG/SCI/ESSAY/ETC`는 계속 고정으로 유지할 것인가?
5. `ESSAY`/`수리논술`은 온라인 강좌 색상에서 `subject-etc`가 아니라 별도 색상 key를 줄 것인가?
6. 학년은 학생용 코드 `1..7`과 운영 표시값 `중1..졸업`을 어떻게 매핑할 것인가?
7. `schools` 운영 기준값은 시간표 전용인가, 회원가입/학부모 자녀 검색에도 일부 적용할 것인가?
8. `school.csv`는 계속 전국 학교 검색 source로 유지하고, 운영 기준값 `schools`는 자주 쓰는 학교/시간표 필터로만 둘 것인가?
9. 오프라인 반에도 `school` + `schools[]` 복수 학교 구조가 필요한가?
10. 기준값에서 삭제된 과목/학교/학년을 기존 문서에서는 어떻게 표시할 것인가? 비활성 처리인가, 완전 삭제인가?
11. 과목명/학교명 변경 시 기존 `courses`, `instructors`, `offlineClasses`, `publicTimetableEntries`를 일괄 수정할 것인가, legacy mapping으로 흡수할 것인가?
12. `updatedBy`를 canonical에만 저장할 것인가, public projection에도 저장할 것인가?

## 15. 다음 구현 프롬프트 초안

```text
현재 프로젝트의 운영 기준값 시스템을 Phase 1로만 구현해줘.

범위:
- 코드 변경은 중앙 catalog read helper와 v1/v2 merge helper까지만 한다.
- 관리자 UI, Firestore rules, Functions, dist, build/deploy, DB 데이터는 건드리지 않는다.
- 기존 `settings/operationCatalog` v1 배열 구조를 계속 지원한다.
- v2 structured catalog 초안을 읽을 수 있게 하되, 저장은 아직 하지 않는다.
- 공개 화면은 여전히 `settings/courseCatalog`, `settings/timetableCatalog`를 읽게 둔다.
- 강사 `subject` + `subjects[]`, 시간표 `school` + `schools[]` 하위호환을 깨지 않는다.
- 온라인 강좌 `subject` 코드는 변경하지 않는다.

반드시 확인할 파일:
- `docs/audits/OPERATION_CATALOG_SYSTEM_AUDIT.md`
- `assets/js/utils/operation-catalog.js`
- `assets/js/utils/course-catalog.js`
- `assets/js/utils/course-readonly.js`
- `assets/js/utils/instructor-subjects.js`
- `assets/js/utils/timetable-schools.js`
- `assets/js/utils/settings-cache.js`

산출:
- helper 변경
- 필요한 최소 테스트 또는 read-only 검증
- `git diff --check`
- 다음 Phase 2 관리자 UI 구현 전 확인 질문
```

## 16. 이번 감사에서 확인한 변경 금지 준수

- 코드 수정 없음
- CSS 수정 없음
- HTML 수정 없음
- Firestore rules 수정 없음
- Functions 수정 없음
- Firebase/Cloudflare 설정 수정 없음
- `dist/**` 수정 없음
- build/deploy 실행 없음
- DB 데이터 변경 없음
