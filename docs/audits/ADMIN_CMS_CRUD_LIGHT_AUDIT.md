# 관리자 CMS CRUD 경량 점검

점검일: 2026-07-31

UI 보완: 2026-08-01

## 1. 범위와 한계

관리자 화면의 HTML 버튼/폼, 페이지별 JavaScript 이벤트, Firestore 읽기·쓰기 경로, `firestore.rules`, 공통 오류 알림과 toast 레이어를 코드 기준으로 점검했습니다. 운영 데이터 변경을 피하기 위해 production Firestore에 실제 생성·수정·삭제 요청은 보내지 않았으며, 로그인 상태에서의 최종 동작 확인은 운영자 QA 항목으로 남깁니다.

CSS는 공통 component와 페이지별 파일의 역할을 유지했습니다. 이번 수정에서 새 `!important`는 추가하지 않았고, toast 최상단 표시는 공통 component의 높은 `z-index` 한 곳으로 통일했습니다.

## 2. 화면별 CRUD 연결

| 화면 | 코드 기준 동작 | 주요 저장소 | 점검 결과 |
| --- | --- | --- | --- |
| 대시보드 | 현황 읽기 | 여러 운영 collection | 읽기 전용 의도 확인 |
| 온라인 강의 | 강의 생성·조회·수정·삭제, 수강 연결 조회·정리 | `courses`, `enrollments`, `settings/courseCatalog` | 이벤트와 Rules 경로 연결 확인 |
| 오프라인 반 | 반·회차 CRUD, 학생 입반/제거, 접근 허용/차단, 보관/활성화 | `offlineClasses`, `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess` | 식별자·중복 문서·오류 표시 경로 보강 |
| 공개 시간표 | 공개 항목 생성·수정·삭제, 노출·정렬·기준값 관리 | `publicTimetableEntries`, `settings/timetableCatalog` | 이벤트와 Rules 경로 연결 확인 |
| 강사 관리 | 프로필·계정 연결 CRUD, 참조 상태 확인 | `instructors`, `instructorAccounts`, 관련 강의·반 | 삭제 전 참조 확인 경로 확인 |
| 학생 관리 | 학생 조회·수정, 수강·반 연결 조회 | `students`, `enrollments`, `offlineClassMembers` | 이벤트와 Rules 경로 연결 확인 |
| 회원 관리 | 회원·자녀 연결 상세 조회 | `members`, `studentParentLinks`, `memberChildLinkAttempts` | 읽기 전용 의도 확인 |
| 계정 생성/관리 | Auth 계정 생성, canonical profile 생성·정리 | `students`, `members`, `instructors`, `instructorAccounts`, `admins` | Rules에서 차단된 legacy `users/*` 수정 경로 제거 |
| 팝업 관리 | 설정 문서 내부 팝업 생성·조회·수정·삭제 | `settings/popups` | 이벤트와 Rules 경로 연결 확인 |
| 사이트 관리 | 사이트 설정·페이지 콘텐츠 조회·수정 | `settings/*`, `pages/*` | 저장 버튼과 관리자 Rules 연결 확인 |
| 운영 기록 정리 | 정책 조회·수정, 정리 대상 미리보기 | `settings/retentionPolicy`, 정리 대상 collection | 실제 정리는 Functions 정책과 분리됨을 확인 |

## 3. 반영한 수정

- 오프라인 반의 학생 제거가 화면용 학생 UID가 아니라 실제 `offlineClassMembers` 문서 ID를 사용하도록 정리했습니다.
- 같은 학생·회차의 legacy/중복 `offlineSessionAccess` 문서가 있으면 허용·차단 시 함께 갱신하도록 했습니다.
- 예외 권한 및 반 학생 관리 실패 시 안내 문구 아래에 원인과 오류 코드를 표시하도록 했습니다.
- 반 보관/다시 활성화, 학생 입반/제거, 접근 허용/차단 후 목록 상태를 다시 읽도록 했습니다.
- 공통 관리자 확인 대화상자의 확인 결과 처리를 안정화했습니다.
- 통합 CSS에서 뒤에 로드되는 페이지별 `.modal` 규칙이 공통 확인창을 숨기던 충돌을 수정했습니다. 숨은 확인창 Promise가 다음 작업까지 대기하며 잘못된 취소 toast를 발생시키던 원인이었습니다.
- 보관/다시 활성화, 학생 제거, 접근 허용/차단처럼 되돌릴 수 있는 작업은 별도 확인창 없이 즉시 실행하도록 단순화했습니다. 학생 제거는 배정 문서와 해당 반의 접근 예외 문서를 한 batch에서 삭제합니다.
- 접근 예외 저장은 학생·회차별 canonical 문서 하나를 쓰고 같은 batch에서 legacy/중복 문서를 삭제합니다.
- 오프라인 반 modal을 열 때 전역 문서 스크롤을 잠그지 않도록 변경해 현재 페이지 위치를 유지합니다. 반 학생 관리, 수업 관리, 수업 추가·수정, 예외 권한 관리 modal은 동일한 크기를 사용하고 표·입력 내용만 남은 영역에서 스크롤합니다.
- 위 네 modal의 헤더와 닫기(X) 버튼은 내부 스크롤 중에도 상단에 유지됩니다.
- 추가 점검한 반 편집, 강좌, 강사, 학생, 일반/학부모, 계정 데이터 정리, 시간표, 팝업 관리 modal도 스크롤 컨테이너에 맞춰 헤더와 닫기(X) 버튼을 상단에 유지하도록 통일했습니다. X 버튼은 공통 `admin-modal-close` 규칙으로 기본·hover·active·focus 상태를 맞췄고, 짧은 공통 확인창은 불필요한 레이아웃 변경을 피하기 위해 기존 구조를 유지합니다.
- toast/status 영역을 공통 component에서 최상단 레이어로 통일하고 페이지별 중복 `z-index`와 toast용 `!important`를 제거했습니다.
- 관리자 접근 화면의 목록·현황 새로고침 버튼은 `refreshBtn` ID와 `admin-refresh-btn` 공통 UI로 통일했습니다. 버튼별 데이터 조회 handler는 유지하고 공통 `admin-refresh.js` helper가 기본·처리 중 문구, `aria-busy`, 비활성 상태를 관리합니다.
- 관리자·학생·강사 상세 화면의 상단 복귀 링크는 명시적인 `dash-back__link` class와 더 높은 범위 선택자를 사용해 페이지별 `.btn` 규칙과 분리했습니다. 보이는 링크 문구는 제거하고 `aria-label`/`title`을 제공하며, 새로고침 버튼과 비슷한 36px 둥근 사각형 버튼 안에 18px 왼쪽 화살표만 표시합니다.
- 실제 모달을 렌더링하지 않는 강사 대시보드와 강좌 상세 CSS에서 전역 `.modal`, `.modal-content`, `.modal-header`, `.modal-close` 잔여 규칙을 제거해 공통 모달과의 selector 충돌 가능성을 없앴습니다.
- Firestore Rules가 쓰기를 막는 legacy `users/*` mirror 삭제 코드를 제거하고 canonical profile collection만 사용하도록 맞췄습니다.

## 4. 정적 점검 결과

- 관리자 HTML의 정적 중복 `id` 없음.
- form 내부 button의 누락된 `type` 없음.
- HTML inline handler는 해당 페이지가 로드하는 JavaScript에서 확인됨.
- 관리자 페이지가 참조하는 Firestore collection은 `firestore.rules`에 대응 경로가 있음.
- 대시보드와 회원 상세 화면은 의도적으로 읽기 전용이며 CRUD 누락으로 분류하지 않음.
- 운영 기록 정리의 실제 삭제는 브라우저 UI가 아니라 배포된 Functions와 운영 정책의 영향을 받으므로 별도 운영 확인 필요.

## 5. 운영자 확인 항목

1. 오프라인 반에서 보관 → 다시 활성화를 순서대로 실행합니다.
2. 반 학생 관리에서 제거 → 다시 입반을 실행하고 목록과 Firestore 문서가 함께 바뀌는지 확인합니다.
3. 회차 예외 권한에서 차단 → 다시 허용을 실행하고 학생 화면 접근 상태를 확인합니다.
4. 실패를 한 번 유도할 수 있다면 각 모달 안내 문구 아래에 원인과 오류 코드가 표시되는지 확인합니다.
5. 다른 관리 화면은 작은 테스트 데이터로 생성 → 수정 → 삭제 후 목록 새로고침과 Firestore 문서를 함께 확인합니다.
6. modal 위에서도 toast가 가려지지 않고 화면 최상단에 표시되는지 확인합니다.
