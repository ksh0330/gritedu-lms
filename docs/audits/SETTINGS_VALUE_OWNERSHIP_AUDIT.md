# Settings Value Ownership Audit

작성일: 2026-07-02

현재 기준: 이 문서가 CMS 기준값 소유권의 최신 기준 문서입니다. 과거 중앙 `operationCatalog` 설계 감사는 `docs/audits/OPERATION_CATALOG_SYSTEM_AUDIT.md`에 보존되어 있지만, 현재 구현 기준은 이 문서와 active 운영 문서를 따릅니다.

범위: 과목, 학년, 학교, 강의실, 연도, 강좌 형식처럼 CMS/공개/LMS에서 선택값 또는 기준값으로 쓰이는 값의 정의 위치와 반영 경로를 정리합니다.

비범위: 코드 수정, Firebase DB 수정, Firestore rules/Functions 수정, `dist/**`, build/deploy.

## 1. 현재 완료 상태

중앙 운영 기준값 모델은 폐기되었습니다.

- 중앙 운영 기준값 탭 제거 완료
- `assets/js/utils/operation-catalog.js` 삭제 완료
- `assets/js/pages/admin-operation-catalog-ui.js` 삭제 완료
- `settings/operationCatalog` Firestore 문서 수동 삭제 완료
- 런타임 코드에서 `operationCatalog`, `loadOperationCatalog`, `getScopedCatalogList` 참조 없음
- `settings-cache.js` 허용 key에서 `operationCatalog` 제거 완료

현재 기준값은 각 관리 페이지 상단 패널에서 관리합니다.

- 온라인 강의 관리: `settings/courseCatalog`
- 오프라인 반 관리: `settings/timetableCatalog`
- 시간표 관리: `settings/timetableCatalog`
- 강사 관리: `settings/instructorsMenu.subjects`
- 계정 생성/관리: 강사 과목 선택값은 `settings/instructorsMenu.subjects` 공유
- 사이트 관리: 과목/학년/학교/강의실 기준값을 관리하지 않음

## 2. 최종 Settings 구조

| 문서 | 책임 | 주요 필드 | 관리 화면 | 공개/연결 영향 |
| --- | --- | --- | --- | --- |
| `settings/courseCatalog` | 온라인 강좌 기준값 | `chipGroups.subject`, `chipGroups.grade` | 온라인 강의 관리 | 공개 강좌/강좌 상세/dashboard label과 필터 |
| `settings/timetableCatalog` | 오프라인 반 + 공개 시간표 기준값 | `subjects`, `grades`, `schools`, `classrooms`, `gradeTabs` | 오프라인 반 관리, 시간표 관리 | 오프라인 반 입력값, 공개 시간표 필터 |
| `settings/instructorsMenu` | 강사진 노출/정렬/숨김/상세 섹션 + 강사 과목 기준값 | `subjects`, `homeOrder`, `instructorsOrder`, `homeHidden`, `instructorsHidden`, `detailSections` | 강사 관리, 사이트 관리 일부 | 강사 관리/계정 생성 과목, 공개 강사진 노출 |
| `settings/signup` | 회원가입 on/off 정책 | `enabled`, `studentEnabled`, `memberEnabled` | 계정 생성/관리의 가입 설정 | 회원가입 flow/rules 조건 |
| `settings/popups` | 팝업 설정 | `popups` | 팝업 관리 | 홈 팝업 |
| `settings/coursesMenu` | 온라인 강좌 숨김/노출 메뉴성 설정 | `hidden` 등 | 온라인 강의/대시보드 표시 흐름 | 학생/강사 dashboard 강좌 노출 |

폐기된 문서/파일:

- `settings/operationCatalog`
- 중앙 운영 기준값 탭
- `assets/js/utils/operation-catalog.js`
- `assets/js/pages/admin-operation-catalog-ui.js`

## 3. 페이지별 기준값 소유권

| 관리자 화면 | 기준값 관리 패널 | 저장 문서 | 모달 내부 정책 |
| --- | --- | --- | --- |
| 온라인 강의 관리 | 과목, 학년 | `settings/courseCatalog` | 기준값 선택, 직접 입력 |
| 오프라인 반 관리 | 과목, 학년, 학교, 강의실 | `settings/timetableCatalog` | 기준값 선택, 직접 입력 |
| 시간표 관리 | 과목, 학년, 학교, 강의실 | `settings/timetableCatalog` | 기준값 선택, 직접 입력 |
| 강사 관리 | 강사 과목 | `settings/instructorsMenu.subjects` | 복수 선택, 직접 입력 |
| 계정 생성/관리 | 자체 기준값 패널 없음 | `settings/signup`, `settings/instructorsMenu` read | 강사 과목 선택은 강사 관리 기준값 공유 |
| 사이트 관리 | 기준값 패널 없음 | `pages/*`, `settings/instructorsMenu` 일부 | 강사진 노출 순서/숨김/상세 섹션만 관리 |
| 팝업 관리 | 팝업 설정 | `settings/popups` | 기준값 catalog와 무관 |

공통 규칙:

- 기준값 항목은 추가, 이름 변경, 삭제, 순서 변경이 가능합니다.
- 변경 후 반드시 각 패널의 `기준값 저장`을 눌러야 반영됩니다.
- 등록/수정 모달 내부에는 기준값 CRUD가 없습니다.
- 모달에는 기준값 선택 토글과 직접 입력만 남습니다.
- 직접 입력값은 해당 문서에만 저장되고, settings catalog나 필터 후보에 자동 추가되지 않습니다.
- 기준값에서 삭제된 값을 쓰는 기존 항목은 삭제하지 않습니다.
- 기존 문서를 수정할 때 삭제된 기준값 또는 직접 입력값은 현재 값으로 표시하고, 필요할 때 운영자가 새 기준값으로 바꿉니다.

## 4. `settings/courseCatalog`

온라인 강좌 기준값입니다.

주요 구조:

```js
{
  chipGroups: [
    {
      key: "subject",
      label: "과목",
      options: [
        { value: "all", label: "전체" },
        { value: "KOR", label: "국어" },
        { value: "ENG", label: "영어" },
        { value: "MATH", label: "수학" },
        { value: "SCI", label: "과학" },
        { value: "ESSAY", label: "수리논술" },
        { value: "ETC", label: "기타" },
        { value: "CUSTOM_001", label: "신규 과목" }
      ]
    },
    {
      key: "grade",
      label: "학년",
      options: [
        { value: "all", label: "전체" },
        { value: "중1", label: "중1" }
      ]
    }
  ]
}
```

운영 기준:

- 온라인 강좌 subject code `KOR`, `ENG`, `MATH`, `SCI`, `ESSAY`, `ETC`는 유지합니다.
- 신규 과목은 `CUSTOM_001` 같은 custom 식별값을 사용할 수 있습니다.
- 화면에는 label 중심으로 표시합니다.
- 연도(`courses.year`)와 강좌 형식(`single`, `series`)은 settings catalog가 아니라 강좌 문서/코드 enum으로 관리합니다.

## 5. `settings/timetableCatalog`

오프라인 반 관리와 시간표 관리가 공유하는 기준값입니다.

주요 구조:

```js
{
  subjects: ["국어", "영어", "수학", "과학", "수리논술", "컨설팅"],
  grades: ["중1", "중2", "중3", "고1", "고2", "고3", "졸업/N수"],
  schools: ["문일중", "금천고"],
  classrooms: ["101호", "세미나실"],
  gradeTabs: []
}
```

운영 기준:

- 오프라인 반과 공개 시간표가 같은 기준값을 공유합니다.
- `gradeTabs`는 기존 공개 시간표 탭 호환이 필요하면 유지합니다.
- 공개 시간표 `schedule.js`는 `timetableCatalog`가 configured이면 `publicTimetableEntries`에서 유도한 값을 필터 후보에 자동 병합하지 않습니다.
- `school` 단일값과 `schools[]` 배열은 기존 시간표 데이터 하위호환을 위해 유지합니다.
- `assets/school.csv`는 회원가입/자녀 학교 검색용 정적 데이터이며 `timetableCatalog.schools`와 병합하지 않습니다.

## 6. `settings/instructorsMenu`

강사진 노출 정책과 강사 과목 기준값입니다.

주요 구조:

```js
{
  subjects: ["국어", "영어", "수학", "과학", "수리논술", "컨설팅"],
  homeOrder: [],
  instructorsOrder: [],
  homeHidden: [],
  instructorsHidden: [],
  detailSections: {
    video: true,
    curriculum: true,
    courses: true
  }
}
```

운영 기준:

- 강사 관리와 계정 생성 관리가 `subjects`를 공유합니다.
- 공개 강사진 필터도 강사 과목 기준값을 따릅니다.
- 강사별 저장값은 `subjects[]` 배열을 우선하고, 기존 단일 `subject`는 대표 과목으로 유지합니다.
- 기존 데이터에 `subjects[]`가 없으면 `subject` 또는 `category`를 fallback으로 표시합니다.
- `order`, `hidden`은 legacy fallback이고, 현재 노출 순서/숨김은 `homeOrder`, `instructorsOrder`, `homeHidden`, `instructorsHidden`을 사용합니다.

## 7. `settings/signup`, `settings/popups`

`settings/signup`은 회원가입 정책 문서입니다.

- `enabled`
- `studentEnabled`
- `memberEnabled`

`settings/popups`는 팝업 설정 문서입니다.

- `popups[]`

두 문서는 선택값 catalog와 병합하지 않습니다.

## 8. Settings 외 기준값

| 값 | 위치 | 판단 |
| --- | --- | --- |
| 학생 학년 코드 | `grade.js`, 회원가입/학생 관리 form | `1..7` 코드 모델 유지 |
| 학교 검색 | `assets/school.csv`, `school-csv.js` | 회원가입/자녀 학교 검색용. 시간표 학교 기준값과 병합 금지 |
| 온라인 강좌 연도 | `courses.year` | 강좌별 자유 입력. catalog 승격 없음 |
| 강좌 형식 | `courseFormat` (`single`, `series`) | 코드 enum 유지 |
| 공개/회원전용/상태 | `accessType`, `status`, `visibility` | 정책/권한성 enum. settings catalog와 병합 금지 |
| 가입 경로/회원 목적 | signup/member form + rules whitelist | 가입 정책값. catalog와 병합 금지 |
| 과목 색상 | CSS selector/class | 기준값 변경만으로 색상 자동 반영되지 않음 |

## 9. 공개 페이지 연결

| 공개/LMS 화면 | 읽는 settings/데이터 | 현재 동작 |
| --- | --- | --- |
| 공개 강좌 목록/상세 | `settings/courseCatalog`, `courses` | subject code를 label로 표시 |
| 학생/강사 dashboard 강좌 | `settings/courseCatalog`, `settings/coursesMenu`, `courses` | label map과 숨김 목록 적용 |
| 공개 시간표 | `settings/timetableCatalog`, `publicTimetableEntries` | catalog configured 시 entries derive 값을 필터 후보에 자동 병합하지 않음 |
| 공개 강사진 | `settings/instructorsMenu`, `instructors` | 강사 `subjects[]` 우선, `subject/category` fallback |
| 홈 강사진/강사 상세 | `settings/instructorsMenu`, `instructors` | 순서/숨김/상세 섹션 적용 |
| 회원가입 | `settings/signup`, `assets/school.csv` | 가입 on/off와 학교 검색 |
| 홈 팝업 | `settings/popups` | 팝업 목록/노출 조건 적용 |

## 10. 운영 QA 체크

기준값 변경 후 확인:

- 온라인 강의 관리: 과목/학년 기준값 저장, 순서 변경, 강좌 등록/수정 modal 선택/직접 입력, 공개 강좌 label
- 오프라인 반 관리: 과목/학년/학교/강의실 저장, 반 등록/수정 modal 선택/직접 입력, 필터 후보
- 시간표 관리: 기준값 저장, 공개 시간표 필터 후보, configured catalog 시 entries derive 자동 병합 없음
- 강사 관리: 강사 과목 기준값 저장, 복수 과목 저장, 계정 생성 관리 과목 선택, 공개 강사진 필터
- 사이트 관리: 과목/학년/학교 기준값 관리 UI가 없고, 강사진 노출 순서/숨김/상세 섹션만 관리
- 기존 문서: 삭제된 기준값 또는 직접 입력값을 쓰는 항목이 사라지지 않고 현재 값으로 표시되는지 확인

## 11. 삭제/폐기 완료 항목

| 항목 | 현재 상태 |
| --- | --- |
| `settings/operationCatalog` | Firestore 문서 수동 삭제 완료 |
| 중앙 운영 기준값 탭 | 제거 완료 |
| `assets/js/utils/operation-catalog.js` | 삭제 완료 |
| `assets/js/pages/admin-operation-catalog-ui.js` | 삭제 완료 |
| 런타임 `operationCatalog` 참조 | 제거 완료 |

보존 중인 하위호환:

- `courseCatalog.instructorSubjectChips` 기본값은 공개 강사진 fallback 용도로 남아 있을 수 있습니다.
- `instructorsMenu.order`, `hidden` legacy fallback은 기존 데이터 호환을 위해 즉시 삭제하지 않습니다.
- 강사 `subject` 단일 필드는 대표 과목으로 유지합니다.
- 시간표 `school` 단일 필드는 `schools[]` 배열의 대표값으로 유지합니다.
