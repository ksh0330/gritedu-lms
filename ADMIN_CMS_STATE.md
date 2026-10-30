# Admin CMS State

최종 갱신: 2026-10-22

### 2026-10-22 운영 피드백 수정

수정 전 `origin/main`은 `abb4b23e`였고 운영 정적 사이트의 `/version.json`은 `20261022-080637`을 반환했다. 운영 관리자 계정으로 강좌 보기와 XLSX 다운로드를 확인했다는 사용자 피드백을 받았다. 아래 4차 절의 로컬·미배포 문장은 작성 당시 이력이다. 이번 수정은 `f959c791`까지 `main`에 반영됐고 정적 빌드 `20261022-083348`에서 관련 스크립트와 CSS 제공을 확인했다. 관리자 일반 작업 알림은 인증 카드 토스트와 분리해 `#statusMsg` 스타일로 복원했으며 사이트·학원 안내·팝업·시간표를 포함한 관리 화면에서 마지막 알림부터 2.7초 후 내용과 배경이 숨겨진다. 강좌 XLSX의 선택적 미조회 통계 열을 제거하고 오프라인 반 기본 시트에 활성 재원 학생명을 추가했으며 학생·회원·반 다운로드 확인창을 업무 중심 문구로 바꿨다. 새 버전의 로그인 관리자 기능 확인은 아직 남았다. 상세 배포·검증 경계는 `docs/MAINTENANCE_LOG.md` 최신 항목을 따른다.

### 2026-10-22 관리자 CMS 4차 진행 상태

`codex/admin-lms-04`는 `f5974191`에서 시작했다. 1단계로 온라인 강좌 목록에 관리자 `강좌 보기` 읽기 전용 모달을 추가했다. 공개·회원전용은 강좌 문서, 승인형은 관리자 권한으로 `coursePrivateContent/{id}`까지 단건 조회한다. 영상은 기존 URL 정규화 경로로 YouTube Live·재생목록·MP4를 표시한다. 진도·수강 기록 쓰기 경로는 없다. 로컬 구현이며 운영 배포·실계정 영상 재생 검증은 아직 없다. 상세 증거와 후속 상태는 `docs/MAINTENANCE_LOG.md`와 `docs/ROLE_TEST_PLAN.md`를 따른다.

2단계는 기존 XLSX 필드를 조사해 강사 담당 강좌/반 이름과 계정 XLSX의 강사 private 연락처만 보강했다. 3단계는 강사 온라인·오프라인·강좌 상세 수강생 검색을 Enter/검색 버튼 적용으로 통일하고 390px 입력·버튼 배치를 보정했다. 4차 변경은 모두 로컬 구현이며 역할 계정 기능 확인은 남았다. 3차 XLSX는 2026-10-22 운영 HTTP 읽기 전용 확인에서 정적 빌드 `20261020-124621`의 여섯 화면 JS에 포함되어 **Deployed** 근거가 확인됐으나 실제 관리자 파일 다운로드는 미실행이므로 **Verified**가 아니다. 아래 2026-10-20의 “운영 반영은 아직 없다” 문장은 당시 상태의 이력이다.

### 2026-10-22 4차 최종 XLSX 보강 (로컬)

학생·회원 명부의 다중 수강/입반/학부모 연결은 UID가 포함된 별도 시트로 내보낸다. 회원 파일은 연결된 자녀의 강좌·반 시트도 포함한다. 반 파일에는 실제 `offlineClassMembers` 입반 명단을 담는다. 강좌 파일은 이미 로드된 공개 콘텐츠의 주차·영상 수를 즉시 출력하며, 승인형 콘텐츠·활성 수강생·승인 대기 수는 추가 조회를 하지 않아 `미조회`로 표시한다. 학생·회원·반 파일은 선택된 필터 결과 대상과 추가 관계 조회를 확인한 뒤 ID 10개씩 묶어 조회한다. 관계별 최대 5,000건 또는 조회 실패 시 파일을 생성하지 않는다. 관리자 여섯 화면의 XLSX 버튼은 조회 전·진행 중·실패·0건에서 비활성화하고, 일반 결과 알림은 공통 중앙 토스트를 사용한다. 운영 관리자 실파일 검증과 4차 배포는 여전히 미실행이다. 상세 열·조회·검증 경계는 `docs/ROLE_TEST_PLAN.md` §23에 기록한다.

## 1. 목적

관리자 CMS는 학원 운영자가 계정, 학생/회원/강사, 온라인 강의, 오프라인 반, 공개 시간표, 사이트 콘텐츠, 팝업, 운영 기록 정리를 관리하는 내부 운영 도구입니다.

현재 CMS는 Firebase Auth와 Firestore rules의 관리자 권한을 전제로 동작합니다. 위험한 삭제/정리 작업은 운영자 확인을 거쳐야 하며, source-of-truth 컬렉션을 직접 다룹니다.

학생 자동 진급의 연도별 transaction guard와 학생/일반/학부모 계정 정리 보강은 운영 배포 후 확인된 기존 기준선입니다. 오프라인 session 권한은 owner 결정에 따라 기존 입반일·수동 grant/revoke UI 필터를 유지하고 Rules 확장은 보류했습니다. 강사 개인정보 분리는 2026-10-19 운영 적용·범위 한정 검증을 마쳤습니다(`docs/MAINTENANCE_LOG.md`).

## 2. 관리자 화면 Map

| 화면 | 경로 | 목적 | 주요 액션 | 관련 컬렉션 | 위험 작업 | 상태/운영 메모 |
| --- | --- | --- | --- | --- | --- | --- |
| 대시보드 | `members/admin/dashboard.html` | 운영 현황 진입점 | 주요 관리 메뉴 이동, 상태 요약 확인 | 여러 collection read | 없음 | 운영자가 처음 보는 홈 |
| 계정 생성/관리 | `members/admin/users/add.html` | 학생/회원/강사/관리자 계정 생성 | Firebase Auth 계정 생성, canonical profile 생성 | `admins`, `students`, `members`, `instructors`, `instructorAccounts`, `settings/signup`, `settings/instructorsMenu` | 잘못된 역할 생성 | 강사 과목 선택값은 강사 관리의 `settings/instructorsMenu.subjects`를 공유 |
| 학생 관리 | `members/admin/users/students.html` | 학생 프로필/수강/오프라인 연결 관리 | 학생 조회, 정보 수정, 수강/반 연결 확인 | `students`, `enrollments`, `offlineClassMembers`, `studentParentLinks` | 학생 삭제, 연결 정리 | 학생 계정은 `users/*`가 아니라 `students/{uid}` 기준 |
| 회원 관리 | `members/admin/users/members.html` | 일반 회원/학부모 회원 관리 | 회원 조회, 자녀 연결 상태 확인, 연결 요청 확인 | `members`, `studentParentLinks`, `memberChildLinkAttempts`, `enrollments` | 회원 삭제, 자녀 연결 삭제 | 부모 전용 collection 대신 `members` + link 모델 사용 |
| 강사 관리 | `members/admin/users/instructors.html` | 강사 공개 프로필과 로그인 계정 관리 | 프로필 편집, 계정 연결, 담당 강의/반 확인, 강사 과목 기준값 관리, 관리자 CSV 내보내기 | `instructors`, `instructorPrivate`, `instructorAccounts`, `courses`, `offlineClasses`, `settings/instructorsMenu`, `settings/subjectColors`; deprecated timetable 참조 검사 | 강사 삭제, 담당 항목 orphan | 내부 필드 분리와 CSV 연결은 운영 배포 완료. 공개 내부 필드 0건과 private 20건 확인; 운영 CRUD 쓰기 smoke는 미실행 |
| 온라인 강의 관리 | `members/admin/courses.html` | 강의 목록/상세/커리큘럼/노출 관리 | 강의 생성/수정/보관, 강사 연결, 수강생 정리, 과목/학년/연도 기준값 관리 | `courses`, `enrollments`, `settings/courseCatalog`, `settings/coursesMenu`, `settings/subjectColors` | 강의 삭제, 수강 연결 삭제 | Rules는 문서 전체를 공개. 실제 보호 URL/비공개 문서 존재는 read-only inventory 필요; 기존 UI 유지 |
| 오프라인 반 관리 | `members/admin/offline-classes.html` | 오프라인 반, 학생 배정, 회차 관리 | 반 생성/수정, 학생 배정, 세션 생성, 접근 관리, 그룹별 과목/학년/학교 기준값 관리 | `offlineClasses`, `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`, `settings/offlineClassCatalog`, `settings/timetableCatalog`(그룹 정의 fallback), `settings/subjectColors` | 반 삭제, 세션/접근 삭제 | 반 기준값은 `offlineClassCatalog`, 그룹 이름·노출·순서는 `timetableCatalog.scheduleGroups` 사용 |
| 시간표 관리 | `members/admin/timetable.html` | 공개 시간표 노출 관리 | 그룹 이름·노출·순서, 그룹별 이미지 URL·대체 텍스트 관리 | `settings/timetableCatalog` | 공개 노출 오류 | 현재 공개/관리 CMS의 단일 source-of-truth; 반과 live sync 아님 |
| 사이트 관리 | `members/admin/site.html` | 공개 사이트 문구/강사진/카카오톡 채널 노출 설정 | 학원 안내, 상담 문의, 카카오톡 채널 URL/노출 페이지, 강사진 노출 순서/숨김/상세 섹션 관리 | `pages`, `settings/instructorsMenu`, `settings/kakaoChannel` | 잘못된 공개 문구/링크 | 사이트 관리는 과목/학년/학교/강의실 기준값을 관리하지 않음. Story는 `pages/story` v2, Contact는 `pages/contact.structure.locations[]`, 카카오톡 채널은 `settings/kakaoChannel` 기준 |
| 팝업 관리 | `members/admin/popup.html` | 메인 팝업 노출 관리 | 팝업 생성/수정/비활성화, 이미지 경로 관리 | `settings/popups` | 깨진 이미지/과도한 팝업 노출 | 이미지는 R2 public URL 또는 `/assets/popup/*.webp` rollback 경로 사용 |
| 운영 기록 정리 | `members/admin/operation-tasks.html` | Scheduled transient-cleanup status | Read the last cleanup timestamp and count summary | `settings/retentionPolicy` | 없음 | Daily 03:00 status view only; no form, preview, client write, session/access query, or manual-delete handler. |

### 2026-10-19 관리자 CMS UI/UX 1차 화면 비교 (구현 당시 기준)

**현재 상태:** 1차·2차 정적 코드는 운영에 배포됐다. `settings/instructorsMenu`의 강사진 숨김·표시는 선택한 페이지의 hidden 필드만 즉시 저장하며, 순서 정렬·드래그는 `순서 저장` 전까지 화면 초안으로 남는다. 순서 저장은 선택한 페이지의 order 필드만 갱신한다. 이전 `order`·`hidden` 배열은 각 새 필드가 없는 경우 읽기 fallback으로 유지한다. 팝업 헤더와 카드 버튼, 관리자 페이지별 `.btn.sm` CSS 범위를 조정했다. 실제 운영 화면의 읽기·모달·시각 QA와 로컬 저장 테스트의 경계는 `docs/ROLE_TEST_PLAN.md` §20과 `docs/MAINTENANCE_LOG.md`에 기록한다. 운영 설정 쓰기 QA는 실행하지 않았다.

| 화면 | 조회·새로고침 | 생성·저장·삭제·내보내기 | 이번 판정 |
| --- | --- | --- | --- |
| 대시보드 | 수동 첫 조회와 성공 후 새로고침 | 관리 메뉴 이동, Console 링크 | 기존 전환 유지; 일부 지표 실패를 전체 성공으로 바꾸지 않도록 보완 |
| 계정 생성·관리 | 사용자 목록 조회와 별도 설정 탭 | 역할별 계정 생성·정리, XLSX | 유지; XLSX 버튼 색/형식은 후속 비교 |
| 학생 관리 | 수동 첫 조회와 성공 후 새로고침 | 정보 저장·계정 정리, XLSX | 기존 흐름 유지; 비활성·삭제와 부모 관계는 후속 조사 |
| 일반/학부모 회원 관리 | 수동 첫 조회 버튼 하나, 초기 안내는 표 안 한 번 | 관계 관리·계정 정리 | 이미 적합; 목록 메타·검색 없음·실패 문구는 서로 다른 상태 |
| 강사 관리 | 자동 목록과 새로고침 | 프로필·카탈로그 저장·삭제, CSV | 자동 로드 유지; CSV 형식/녹색 규격은 후속 비교 |
| 온라인 강좌 관리 | 자동 목록과 새로고침 | 강좌·카탈로그 저장·보관·삭제 | 자동 로드 유지; XLSX·스켈레톤·회원전용 직접 등록은 후속 |
| 오프라인 반 관리 | 자동 목록과 새로고침 | 반·배정·회차·카탈로그 저장·삭제 | 자동 로드 유지; XLSX는 후속 |
| 시간표 관리 | 설정 자동 로드와 새로고침 | 그룹·이미지 설정 저장 | 공통 버튼·안내 문구는 후속 |
| 사이트 관리 | 설정 자동 로드와 새로고침 | 공개 콘텐츠·설정 저장 | 공통 버튼·안내 문구는 후속 |
| 팝업 관리 | 자동 목록과 새로고침 | 팝업 추가·저장·삭제 | 헤더 버튼 규격, 실패 안내, 추가 모달 접근성·중복 저장을 이번에 수정 |
| 운영 기록 정리 | 최근 실행 상태 자동 조회 | 수동 삭제/저장 없음 | 자동 조회·운영 방침 안내 유지 |

**다음 배치 검색 대상:** (1) 강사 대시보드의 온라인/오프라인 수강생 검색, (2) 강사 온라인 강좌 상세의 수강생 검색을 각각 입력 중 적용에서 Enter 또는 검색 버튼 적용으로 바꾼다. 두 화면은 별도 검색 구현이다.

**그 밖의 다음 배치:** 회원·강좌·반 XLSX, 기존 학생/계정 XLSX와 강사 CSV의 데이터/녹색 버튼 비교, 온라인 상세 스켈레톤의 실제 배지·버튼 노출, 회원전용 강좌 직접 등록 UX, 학생 비활성 상태의 Auth/Firestore 저장 위치와 부모 연결 표시, 학생 삭제 전 관계 revoke·member counter 정합성, 사이트·시간표 버튼/안내, 역할 카드/모바일은 각각 별도 확인한다. 현재 직접 등록은 `approvalRequired` 강좌로 제한된다(`admin-courses.js`); `memberOnly`에 있다고 추정하지 않는다. 학생 비활성/재활성 관리자 버튼은 현재 계정 관리 코드에서 확인되지 않았고, 학생 정리는 active 부모 링크가 있으면 실행을 막는다(`admin-user-add.js`). Auth 비활성 상태와 Firestore 필드 여부는 구현 전 별도 확인한다. 부모 관계 테스트는 합성 데이터·Emulator에서만 진행한다.

### 2026-10-20 관리자 XLSX·버튼 3차 로컬 상태

`codex/admin-exports-03`의 로컬 구현이다. 강사 관리의 CSV/XLSX 이중 클릭 handler를 XLSX 하나로 정리하고, 일반/학부모 회원·온라인 강좌·오프라인 반에 XLSX를 추가했다. 계정·학생·강사 기존 내보내기는 필터된 전체 로드 목록과 공통 파일 생성·수식 문자열 보호를 사용한다. 강사 목록 XLSX의 이메일·연락처·메모는 기존 관리자 조회의 `instructorPrivate` 문서에서 직접 가져오며 private 문서가 없으면 빈 칸으로 둔다. 다운로드 버튼은 6개 관리자 화면에서 녹색이며 1440/768/390px 로컬 정적 브라우저 QA를 마쳤다. 회원·강좌·반은 현재 메모리에 로드된 목록 중 필터 결과 전체를 출력하며 별도 Firestore 전체 조회를 하지 않는다. 학생의 기존 수강 수 보강 조회는 확인 대화상자 뒤 실행된다. 운영 적용·역할 계정 검증은 아직 없다. 구체적 로컬 증거와 제한은 `docs/ROLE_TEST_PLAN.md` §21을 따른다.

이 위의 1·2차 비교표와 당시의 “다음 배치” 문장은 구현 당시 이력이다. 3차 브랜치는 `dc0b921c` 위로 rebase해 최신 진도율·강사 조회 코드를 보존했고, 로컬 통합 검사를 통과했다. 운영 반영은 아직 없다. 다음 별도 작업은 관리자 강좌 읽기 전용 영상, 강사 수강생 검색 통일, 역할별 진도·영상 QA, 모바일 문구·디자인, 역할 QA cycle 2·3 및 Partial 항목 정리다.

온라인 강좌 영상 편집의 2026-10-16 정적 사이트 배포: 기존 공유 URL 검증으로 watch·youtu.be·embed·live·직접 MP4를 확인하며, 저장 요청 중에는 저장 버튼을 비활성화해 중복 제출을 막습니다. 입력란과 안내를 보강했습니다. 카드 미리보기는 영상 재생이나 YouTube 퍼가기 허용을 검사하지 않습니다. 실제 강좌 데이터·순서·영상 URL은 변경하지 않았습니다.

2026-10-17 승인형 강좌 구현(운영 배포 완료): 운영 선택 유형은 공개·회원전용·승인형 세 가지입니다. 이전 4유형 초안은 `docs/ROLE_TEST_PLAN.md` §11의 기획 기록이며 지정학생·비공개 유형은 구현하지 않았습니다. 신규 승인형 강좌 저장은 공개 `courses` 소개와 비공개 `coursePrivateContent` 영상을 batch로 함께 기록합니다. 기존 강좌와 승인형 사이 유형 전환은 공개 URL 필드 점검 전까지 막습니다. 수강생 모달에는 대기 신청의 30건 단위 조회·현재 불러온 목록 검색·승인/거절·조회 실패 재시도와 학생·일반회원의 정확한 이메일 직접 등록을 추가했습니다. 학부모는 신청·직접 등록에서 제외됩니다. 승인/등록은 신청 상태와 deterministic enrollment를 transaction으로 함께 기록하며 기존 진도를 보존합니다. 저장 후 목록 재조회만 실패하면 저장 성공과 재조회 실패를 구분해 다시 불러오기 버튼을 보여 줍니다. 승인형 해제는 `revoked` 상태로 접근만 차단합니다. Rules와 정적 사이트를 분리 배포했습니다. QA 강좌에서 관리자 승인·거절·직접 등록·수강 해제·보관을 확인했고, 두 QA 수강 관계는 `revoked`로 기록을 보존합니다. 기존 운영 강좌나 실제 수강생 데이터는 수정하지 않았습니다.

2026-10-17 긴급 회귀 수정(코드 `Implemented`, 변경 Rules·정적 사이트 `Deployed`, 합성 강좌 범위 운영 `Verified`): 새 강좌에서 세 유형을 선택하고 저장된 강좌에서는 유형 선택을 읽기 전용으로 표시합니다. Rules도 유형 변경을 거부합니다. 관리자 명칭은 `회원 전용(유료) - 즉시 수강` / `회원 전용(유료) - 승인 후 수강`; 학생·회원 기본 명칭은 둘 다 `회원전용 강좌`이며 버튼과 상태로 신청 방식을 구분합니다. YouTube 재생목록 URL과 기존 watch·youtu.be·live·embed·MP4를 받습니다. 저장 오류는 모달 버튼 위에 표시하고 전역 토스트는 모달 위에 올립니다. 영구 삭제는 보관 여부와 무관하게 진입하며 강좌·보호 영상·신청·수강/진도 기록의 건수를 확인하고 원자 batch로 정리합니다. 450 write 초과는 삭제 전에 중단합니다. 운영 빌드 `20261017-092728`(코드 커밋 `ca795644`)에서 합성 강좌 `XTPC2FPRQ9HtKIiXE4Ad`의 생성·수정·보관·삭제를 확인했습니다. 공개 문서에는 재생목록 URL이 없고 보호 문서에만 있습니다. 삭제 전 수강·신청 0건과 보호 문서 1건을 확인했고 삭제 후 강좌·보호 문서는 404입니다. 다른 QA 강좌의 갱신 시각은 삭제 전 시각으로 유지됐습니다. 기존 운영 데이터는 변경하지 않았습니다.

2026-10-17 관리자 강좌 UI 소규모 개선(코드 `92e8547f`, 운영 빌드 `20261017-100300`): 승인형 수강생 모달의 직접 등록은 학생·일반회원 이름 prefix 또는 정확한 이메일로 명시 검색합니다. 각 컬렉션 최대 20건만 조회하며 결과의 이름·이메일·유형·계정 ID를 확인해 한 계정을 선택한 뒤 `등록`을 눌러야 합니다. Enter는 검색만 실행하고 학부모 결과는 선택할 수 없습니다. 기존 deterministic enrollment, 중복 방지, 해제 관계 재등록·진도 보존 transaction은 그대로 사용합니다. 관리자 목록·카드의 명칭은 `공개` / `회원 전용` / `회원 전용(유료)`로 짧게 표시하고 유형별 수강 방식을 폼 아래에 설명합니다. `유료`는 운영 명칭이며 자동 결제는 없습니다. 운영 관리자 QA 계정으로 이름·이메일·결과 없음·학부모 차단·선택/등록 버튼·1440px/390px 레이아웃을 읽기 전용 확인했습니다. 실제 회원 등록은 실행하지 않았습니다.

## 2-1. 기준값 관리 패널

중앙 운영 기준값 탭은 제거되었습니다. 기준값은 각 관리 페이지 상단 패널에서 관리하고, 해당 페이지 책임에 맞는 settings 문서에 저장합니다.

| 관리 화면 | 관리 기준값 | 저장 문서 | 공개/연결 영향 |
| --- | --- | --- | --- |
| 온라인 강의 관리 | 과목, 학년, 연도 | `settings/courseCatalog` | 온라인 강좌 관리/공개 강좌 label과 필터 |
| 오프라인 반 관리 | 과목, 학년, 학교 | `settings/offlineClassCatalog.groupCatalogs[groupId]` | 반 추가/수정 모달 선택값 |
| 시간표 관리 | 그룹, 학교급, 그룹별 시간표 이미지 | `settings/timetableCatalog` | 공개 시간표 그룹·이미지 |
| 강사 관리 | 강사 과목 | `settings/instructorsMenu.subjects` | 강사 관리, 계정 생성 관리, 공개 강사진 필터 (`courseCatalog.instructorSubjectChips`는 legacy/stale) |
| 강사·온라인 강의·오프라인 반 공통 | 과목 표시 색상 | `settings/subjectColors.subjectColorMap` | 같은 과목명의 관리자 선택 목록, 강사 배지, 강좌/반 카드와 상세 화면 |
| 사이트 관리 | 기준값 없음 | `pages/*`, `settings/instructorsMenu` 일부, `settings/kakaoChannel` | 공개 콘텐츠, 강사진 노출 순서/숨김/상세 섹션, 카카오톡 채널 링크 노출 관리 |

공통 운영 원칙:

- 기준값은 추가, 수정, 삭제, 순서 변경 후 각 패널의 `기준값 저장`을 눌러야 반영됩니다.
- 등록/수정 모달 안에는 기준값 CRUD가 없고, 기준값 선택 토글과 직접 입력만 있습니다.
- 직접 입력값은 해당 강좌/반/강사 문서 또는 선택한 `timetableCatalog` 그룹 이미지 설정에만 저장되며 다른 settings catalog나 필터 후보에 자동 추가되지 않습니다.
- 과목 목록은 각 페이지의 settings 문서가 계속 소유하고, 표시 색상만 `settings/subjectColors`에서 공용 관리합니다. 최초 migration에서 세 목록을 한 번 통합한 뒤, 각 페이지 저장은 그 페이지의 신규 과목명만 공용 맵에 보충해 같은 이름에 같은 색상을 유지합니다.
- 신규 과목에는 현재 공용 맵에서 사용하지 않은 Bootstrap 5.3 기본 팔레트 색상을 우선 배정합니다. 직접 입력 과목은 해당 페이지 기준값에 추가되지 않는 한 공용 색상 맵을 확장하지 않습니다.
- 공용 색상은 관리자 목록/선택값뿐 아니라 공개 강사진, 공개 강좌, 학생·일반 회원·강사 대시보드, 강좌/반 상세의 실제 배지와 카드 강조색에 적용됩니다.
- 색상 저장 때문에 다른 관리 페이지의 카탈로그를 반복 읽거나 쓰지 않습니다. 기준값 저장은 현재 페이지 settings 1 write가 기본이고, 공용 색상이 실제로 추가·변경될 때만 `settings/subjectColors` 1 write를 같은 batch에 추가합니다.
- 이 기능은 Cloud Functions, 예약 실행, 외부 유료 API를 사용하지 않습니다. legacy 정리는 최초 전환 스크립트 또는 해당 문서 자체를 저장할 때만 수행합니다.
- `"전체"`, `"all"`, `"선택"`, `"직접 입력"`, `"목록에 없음"` 같은 예약값은 기준값으로 저장하지 않습니다. `"전체"`는 필터 UI에서만 가상으로 추가합니다.
- 공개 강사진 필터 source는 `settings/instructorsMenu.subjects`입니다. `courseCatalog.instructorSubjectChips`는 더 이상 primary source가 아닙니다.
- 온라인 강좌 기준값은 `settings/courseCatalog.chipGroups`의 `subject`, `grade`, `year`를 사용합니다.
- 온라인 강좌 과목은 내부 `value`와 화면 `label` 구조를 유지하지만, 관리자 UI는 과목명 중심입니다. 신규 과목 식별값은 관리자가 직접 지정하지 않고 `CUSTOM_001` 형식으로 자동 생성됩니다.
- 기본 온라인 과목 식별값(`KOR`, `ENG`, `MATH`, `SCI`, `ESSAY`, `ETC`)도 기준값 목록에서 삭제할 수 있습니다. 삭제된 과목 식별값을 쓰는 기존 강좌는 마이그레이션하지 않고 fallback label로 표시합니다.
- 온라인 강좌 추가/수정 모달의 `lectureContent` 입력 UI는 제거되었습니다. 기존 문서의 `lectureContent`/`learningContent` 값은 삭제하거나 마이그레이션하지 않으며 읽기 호환만 유지합니다.
- 기존 문서가 삭제된 기준값을 사용하더라도 기존 항목은 삭제하지 않습니다. 수정 화면에서는 현재 저장값을 표시하고 필요하면 다른 기준값으로 바꿉니다.
- `settings/operationCatalog`, 중앙 운영 기준값 탭, `operation-catalog.js`, `admin-operation-catalog-ui.js`는 폐기되었습니다.

## 3. Canonical 데이터 모델

| 영역 | Canonical collection | 비고 |
| --- | --- | --- |
| 관리자 | `admins` | 관리자 권한 판정 |
| 학생 | `students` | 학생 대시보드와 수강/오프라인 연결 기준 |
| 일반/학부모 회원 | `members` | 일반 회원과 학부모 역할을 함께 수용 |
| 회원-학생 연결 | `studentParentLinks`, `memberChildLinkAttempts` | 확정 링크와 시도/요청 분리 |
| 강사 공개 프로필 | `instructors` | 공개 강사 소개와 담당 연결; 내부 필드 분리 운영 적용 완료 |
| 강사 내부 메타데이터 | `instructorPrivate` | 프로필 ID 기반 이메일·연락처·메모·계정 연결 상태, 관리자 전용 (운영 20건 확인) |
| 강사 로그인 계정 | `instructorAccounts` | Auth uid 기반 계정 데이터 |
| 온라인 강의 | `courses` | 공개 읽기 가능 |
| 온라인 수강 | `enrollments` | 학생/회원 모두 연결 가능 |
| 오프라인 반 | `offlineClasses` | 반 source-of-truth |
| 오프라인 반 학생 | `offlineClassMembers` | 학생 배정 |
| 오프라인 세션 | `offlineClassSessions` | 회차 데이터 |
| 오프라인 세션 접근 | `offlineSessionAccess` | 학생별 접근 |
| 공개 시간표 | `settings/timetableCatalog` | 그룹·이미지 source-of-truth. `publicTimetableEntries`는 deprecated cleanup-only |
| 사이트 설정/콘텐츠 | `settings`, `pages` | 공개/관리자 설정 |
| 운영 기록 정리 | `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts` | Daily bounded `cleanupAt` queries only; no automatic legacy scan. The current page displays the scheduler summary but has no transient manual-delete handler. `operationTasks` is legacy. |
| 가입/인증 보조 | `emailVerifications`, `signupAttempts` | Functions와 rules로 제한 |

## 4. Deprecated/금지 모델

| 항목 | 상태 | 운영 기준 |
| --- | --- | --- |
| `users/*` | deprecated, rules deny | 새 기능에서 사용 금지 |
| `changeHistory` | deprecated, rules deny | 운영 기록 저장소로 사용 금지 |
| legacy `parents` | deprecated | `members` + `studentParentLinks`로 대체 |
| `publicInstructorProfiles` | deprecated | `instructors`로 통합 |
| `settings/home` | legacy | 현재 settings 구조로 대체 |
| `settings/instructors` | legacy | `settings/instructorsMenu` 등으로 대체 |
| `settings/dday` | legacy | 현재 D-day/settings 정책에 맞춰 재검토 |
| `settings/courseCatalog.instructorSubjectChips` | legacy/stale | 공개 강사진 필터는 `settings/instructorsMenu.subjects`를 사용 |
| `publicTimetableEntries` | deprecated, 신규 C/U 금지 | 공개/관리 시간표는 `settings/timetableCatalog` 사용; admin cleanup/read 잔여만 유지 |
| 페이지별 settings의 `subjectColorMap`, `subjectMeta` | legacy/stale | 색상은 `settings/subjectColors.subjectColorMap`으로 통합하고 기준값 저장 또는 전환 스크립트로 제거 |

최초 DB 전환 순서:

1. 공용 settings 읽기 규칙과 새 프론트엔드 코드를 배포합니다.
2. `npm run migrate:subject-colors`로 대상 과목과 legacy 필드를 확인합니다.
3. `npm run migrate:subject-colors:write`로 공용 색상 문서를 생성하고 기존 색상 필드를 제거합니다.

## 4-1. 사이트 관리 CMS 구조

### 푸터 정보와 학원정보 이미지

- Footer 사업자·연락처·SNS 정보와 학원정보조회·교습비·환불규정 이미지를 함께 관리합니다.
- 사업자·연락처·SNS는 `settings/footer`의 `companyName`, `businessNumber`, `representative`, `phone`, `address`, `instagramUrl`, `youtubeUrl`, `blogUrl`에 저장합니다.
- 공개 footer는 `settings/footer`를 최대 5분 동안 브라우저 session cache로 재사용합니다. 문서가 없거나 읽기가 실패하면 기존 정적 footer markup을 그대로 유지합니다. 관리자 저장은 현재 탭의 footer cache를 즉시 무효화합니다.
- 이미지 목록은 `settings/tuitionImages`의 `academy[]`, `fee[]`, `refund[]`에 저장합니다.
- 허용 URL은 `https://assets.gritedu.kr/public/footer/` 아래 PNG/JPG/JPEG/WebP입니다.
- URL 추가·수정·삭제·순서 변경과 미리보기를 제공하며 R2 직접 업로드는 제공하지 않습니다.
- 공개 `tuition.html`은 저장 순서대로 이미지를 표시하고, 미등록과 읽기 오류를 구분해 안내합니다. 기존 PDF iframe/download fallback은 사용하지 않습니다.

### 학원 안내

사용 위치:

- 관리자: `members/admin/site.html` -> 사이트 관리 -> 학원 안내
- 공개 페이지: `story.html`
- Firestore: `pages/story`

`story.html`은 CMS가 직접 수정하는 파일이 아니라 정적 shell/fallback입니다. 공개 렌더링 우선순위는 다음과 같습니다.

1. `pages/story.version === 2`
2. legacy `pages/story.content`
3. `story.html` HTML fallback

현재 CMS 입력 필드와 저장 경로:

| CMS 입력 | Firestore 경로 |
| --- | --- |
| 상단 배너 이미지 URL | `heroImageUrl` |
| 대표 인사말 제목 | `greeting.title` |
| 대표 인사말 부제 | `greeting.subtitle` |
| 대표 인사말 본문 | `greeting.body` |
| 회사명 / 직함 | `greeting.signatureTitle` |
| 대표명 | `greeting.signatureName` |
| 대표 사진 URL | `greeting.ceoImageUrl` |
| G/R/I/T 설명 | `gritValues[0..3].title` |
| 마지막 멘트 1줄 | `closingLine1` |
| 마지막 멘트 2줄 | `closingLine2` |

자동/고정 저장값:

- `slug: "story"`
- `version: 2`
- `pageTitle: "그릿에듀 학원 안내"`
- `heroImageAlt: "그릿에듀 강사진 단체 이미지"`
- `greeting.ceoImageAlt: "그릿에듀 대표이사 유홍석"`
- `gritValues[].letter`
- `gritValues[].word`
- `updatedAt`

저장 시 legacy/중복 필드는 자동 정리됩니다. `closingMessage`, `greeting.signature`, `greeting.ceoTitle`, `greeting.ceoName`, `content`, `structure`, `lead`, `gritValues[].body`는 콘솔에서 수동 삭제할 필요 없이 CMS에서 한 번 저장하면 정리됩니다.

Story 이미지 정책:

- CMS 파일 업로드는 하지 않습니다.
- R2 `https://assets.gritedu.kr/public/story/` 또는 `https://assets.gritedu.kr/public/pages/story/` URL만 공식 지원합니다.
- 허용 확장자는 `.jpg`, `.jpeg`, `.png`, `.webp`입니다.
- 같은 파일명 덮어쓰기보다 `banner_main-20260626.webp`, `ceo-yhs-20260626.webp` 같은 versioned filename을 권장합니다.
- 학생 자료, 리포트, PDF, 과제 같은 private 파일과 Story public 이미지를 섞지 않습니다.

현재 학원 안내 CMS에서 제거된 항목:

- 브라우저 탭 제목 입력
- 이미지 설명 입력
- 실시간 미리보기
- 새 창에서 확인 버튼
- 파일 업로드
- 글꼴/색상/크기 툴바
- 디자인 프리셋
- 말풍선

### 상담 문의

사용 위치:

- 관리자: `members/admin/site.html` -> 사이트 관리 -> 상담 문의
- 공개 페이지: `contact.html`
- Firestore: `pages/contact`

Contact 공개 렌더링 우선순위는 코드 기준으로 다음과 같습니다.

1. `pages/contact.structure.locations[]`
2. legacy `pages/contact.content`
3. `contact.html` HTML fallback

현재 CMS 입력 필드와 저장 경로:

| CMS 입력 | Firestore 경로 |
| --- | --- |
| 위치 이름 | `structure.locations[].label` |
| 전화번호 | `structure.locations[].phone` |
| 상담 안내 문구(최대 3줄) | `structure.locations[].messageLines[]` |
| 온라인 상담 예약 URL | `structure.locations[].onlineBookingUrl` |
| 운영 시간 | `structure.locations[].hours` |
| 주소 | `structure.locations[].address` |
| 구글 지도 입력값(URL 또는 검색어) | `structure.locations[].mapIframeSrc` 또는 `structure.locations[].mapEmbedQuery` |
| 교통수단 | `structure.locations[].transportItems[]` (`id`, `type`, `label`, `text`, `sortOrder`) |
| 지도 앱 링크 | `structure.locations[].mapLinks.naver/kakao/google` |

공개 페이지 제목은 코드에서 「상담 문의」로 고정합니다. 관리자 load 시 legacy `phoneNote`, `callableHours`, `transportation.*`, `transportItems[].lines`를 화면 draft로만 이관할 수 있지만, 저장은 `setDoc` overwrite로 canonical payload만 남기며 `content`와 top-level 호환 필드를 다시 쓰지 않습니다.

Contact 이미지 첨부/파일 업로드는 차단되어 있습니다. 현재 Contact CMS는 텍스트, URL, 지도/교통 정보 중심이며 R2 이미지 URL 입력 필드는 없습니다.

### 카카오톡 채널

사용 위치:

- 관리자: `members/admin/site.html` -> 사이트 관리 -> 카카오톡 채널
- 공개 페이지: `/`, `story.html`, `schedule.html`, `contact.html`, `instructors.html`, `courses.html` 중 CMS에서 선택된 페이지
- Firestore: `settings/kakaoChannel`

저장 필드:

| CMS 입력 | Firestore 경로 |
| --- | --- |
| 사용 여부 | `enabled` |
| 카카오톡 채널 URL | `url` |
| 버튼 문구 | `buttonLabel` |
| 노출 페이지 | `visiblePages.home/story/schedule/contact/instructors/courses` |
| 수정자 | `updatedBy` |
| 수정 시각 | `updatedAt` |

운영 기준:

- SDK, Kakao Developers 앱키, `Kakao.init`, `Kakao.Channel`을 사용하지 않습니다.
- `url`은 `https://pf.kakao.com/...` 형식만 허용합니다. `/chat`을 자동으로 붙이지 않고 CMS에 저장된 URL을 그대로 `href`에 사용합니다.
- `buttonLabel`은 선택값입니다. 빈 문자열이나 공백 문자열이면 저장 가능하며 공개 버튼은 텍스트 없이 SVG 아이콘만 표시합니다.
- `enabled`가 false이면 URL이 비어 있어도 저장할 수 있지만, URL이 입력되어 있다면 안전 검증을 통과해야 합니다.
- 공개 렌더링도 저장값을 한 번 더 검증하며, URL이 없거나 invalid이거나 현재 페이지가 `visiblePages`에서 true가 아니면 버튼을 표시하지 않습니다.
- 버튼은 공개 페이지 우측 하단 플로팅 링크이며, 모바일에서는 기존 맨 위로 이동 버튼 위에 배치됩니다.

## 5. 위험 작업 가이드

삭제 전 확인:

- 학생 삭제: `enrollments`, `offlineClassMembers`, `offlineSessionAccess`, `studentParentLinks`, student-matched attempts, email transient 기록을 미리보기/실행 시 scoped 조회합니다. active 또는 불명확 link가 있으면 실행을 막고 회원 관리 revoke를 먼저 요구하며, profile은 마지막에 삭제합니다.
- 일반/학부모 회원 삭제: 실행 직전에 본인 `enrollments`, 자녀 link, link attempt, email transient 기록을 다시 조회하고 dependency 먼저/member profile 마지막 순서로 정리합니다. 학생 profile과 Auth 계정은 유지합니다.
- 강사 삭제: `courses`, `offlineClasses`, `instructorAccounts` 연결과 deprecated timetable 참조 검사 확인
- 강의 삭제: `enrollments` cleanup 필요
- 오프라인 반 삭제: `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`, 공개 시간표 반영 상태 확인
- 팝업 삭제: 운영 중인 공개 노출 여부 확인

공개 데이터 주의:

- `courses`는 공개 읽기 가능하므로 비공개 영상 URL, 결제 권한, DRM 토큰을 저장하지 않습니다.
- `settings/timetableCatalog`, 공개 settings, `pages`는 공개 페이지에서 읽힐 수 있습니다. `publicTimetableEntries`는 공개 read 대상이 아닙니다.
- `settings/kakaoChannel`은 공개 페이지에서 읽히는 문서이므로 카카오톡 채널 URL과 노출 플래그 외 민감 정보를 저장하지 않습니다.
- 이미지 경로는 `/assets/...` 문자열 또는 허용된 R2 public URL이므로 실제 파일/object가 없으면 화면이 깨집니다.

## 6. 운영자 메모

- 관리자 UI에서 파일 자체를 Firebase Storage로 업로드하지 않습니다.
- R2 public URL을 쓰는 팝업/강사/Story 이미지는 배포 없이 CMS 저장으로 반영될 수 있습니다.
- CMS 텍스트/구조 데이터만 바꾸는 경우 Firestore 저장만으로 공개 페이지에 반영되며 코드 배포가 필요 없습니다.
- 카카오톡 채널 URL/노출 페이지 변경도 Firestore 저장만으로 공개 페이지에 반영되며 코드 배포가 필요 없습니다.
- 로컬 `/assets` 이미지 변경은 파일 배치, 경로 입력, `npm run prebuild`, `npm run verify`, `git diff --check`, commit, `git push`, Cloudflare Pages deployment 확인 순서가 필요합니다.
- 공개 시간표는 오프라인 반의 실시간 view가 아니므로 `settings/timetableCatalog` 그룹·이미지를 운영자가 별도로 확인해야 합니다.
- The operation-tasks page currently has no transient manual-delete action. Its active purpose is the read-only scheduled-cleanup status; the obsolete offline-retention form and preview were removed after Phase 2A.
- 대량 변경 전에는 현재 Firestore 데이터 export 또는 최소한 대상 목록 캡처가 필요합니다.
- R2 custom domain은 `https://assets.gritedu.kr`입니다. Story 이미지는 `public/story/` 또는 `public/pages/story/` prefix를 사용합니다.
- 공개 사이트의 공식 도메인/SEO meta/sitemap/robots는 소스 HTML과 build/prebuild 영역에서 관리하며, CMS 문구 변경과 구분합니다.

## 7. QA 체크리스트

1. 관리자 로그인 후 대시보드 진입이 되는지 확인합니다.
2. 학생/회원/강사 각 목록이 canonical collection 기준으로 로드되는지 확인합니다.
3. 강의 목록에서 공개/회원 전용/보관 상태가 의도대로 표시되는지 확인합니다.
4. 오프라인 반 생성 후 학생 배정, 회차 생성, 접근 관리가 가능한지 확인합니다.
5. 공개 시간표 그룹·이미지가 `settings/timetableCatalog`에 저장되고 공개 schedule 화면에 표시되는지 확인합니다.
6. 사이트 관리 -> 학원 안내 저장 후 `pages/story.version === 2`로 공개 `story.html`이 렌더링되는지 확인합니다.
7. 사이트 관리 -> 상담 문의 저장 후 `pages/contact.structure.locations[]`로 공개 `contact.html`이 렌더링되는지 확인합니다.
8. 사이트 관리 -> 카카오톡 채널에서 `https://pf.kakao.com/...`와 `/chat` URL은 저장되고, http/javascript/data/blob/타 도메인은 차단되는지 확인합니다.
9. 선택한 공개 페이지만 카카오톡 플로팅 버튼이 보이고 `members/**`와 상세/정책 페이지에는 보이지 않는지 확인합니다.
10. 팝업 이미지 경로가 `/assets/...` 또는 허용된 R2 public URL이고 실제 파일/object가 있는지 확인합니다.
11. Confirm that the operation-tasks page is administrator-only, displays the latest count-only summary for the three scheduled transient targets, and has no offline preview or retention form.

## 8. 2026-07-31 CRUD 경량 점검

- 관리자 HTML 버튼과 페이지별 JavaScript handler, Firestore collection과 Rules 대응을 정적으로 확인했습니다.
- 오프라인 반의 보관/활성화, 학생 입반/제거, 회차 예외 권한 허용/차단은 실제 연결 문서 ID를 사용하고 저장 뒤 목록을 다시 읽습니다.
- 보관/활성화, 학생 제거, 회차 예외 권한 허용/차단은 확인창 없이 즉시 실행합니다. 학생 제거와 연결 접근 권한 정리, canonical 접근 예외 저장과 중복 정리는 각각 Firestore batch로 처리합니다.
- 오프라인 반 관련 작업 오류는 해당 modal의 기존 안내 문구 아래에 원인과 오류 코드를 표시합니다.
- 공통 확인창은 `.modal` 통합 CSS의 로드 순서와 무관하게 표시되도록 selector와 활성 class를 보강했습니다.
- 오프라인 반 modal은 문서의 `html`/`body` 스크롤 상태를 바꾸지 않으므로 목록에서 열고 닫아도 사용자가 보던 페이지 위치를 유지합니다.
- 반 학생 관리, 수업 관리, 수업 추가·수정, 예외 권한 관리 modal은 동일한 최대 폭 920px, 높이 720px과 헤더 규칙을 사용합니다. 표나 입력 내용이 남은 공간을 넘으면 modal 내부에서 스크롤하며 작은 화면에서는 viewport 높이에 맞춥니다.
- 네 관리 modal의 헤더와 닫기(X) 버튼은 modal 내부 상단에 고정되어 내용 스크롤 위치와 관계없이 항상 닫을 수 있습니다.
- 같은 고정 헤더 규칙을 반 추가·수정, 강좌 편집·수강 관리, 강사 추가·수정, 학생 상세·수정, 일반/학부모 상세, 계정 데이터 정리, 시간표 이미지 편집, 팝업 편집·이미지 설정 modal에도 적용했습니다. 닫기 버튼은 공통 `admin-modal-close` UI로 크기, hover, active, keyboard focus를 통일했고 긴 내용은 기존처럼 본문 또는 dialog 내부에서 스크롤합니다.
- 전역 toast/status는 공통 component의 최상단 레이어를 사용합니다. 페이지별 toast `z-index` 중복과 toast용 `!important`는 제거했습니다.
- 관리자 대시보드·강좌·오프라인 반·시간표·사이트·팝업·강사·학생·회원·계정 관리의 새로고침 버튼은 `refreshBtn`/`admin-refresh-btn` 구조와 공통 `admin-refresh.js` 상태 helper를 사용합니다. 버튼별 데이터 조회 방식은 유지하되 `새로고침`/`새로고침 중...`, `aria-busy`, 비활성 상태를 같은 규칙으로 관리합니다.
- 관리자 관리 화면의 CMS 복귀 링크는 공통 `dash-back` component와 `dash-back__link` class를 사용합니다. 화면에는 새로고침 버튼과 비슷한 36px 둥근 사각형 버튼과 18px 왼쪽 화살표만 렌더링하며, 목적 문구는 HTML 본문 대신 `aria-label`과 `title`로 제공합니다.
- 계정 정리는 canonical profile collection을 사용하며 Rules에서 차단된 legacy `users/*` mirror에는 쓰지 않습니다.
- production Firestore에 실제 쓰기 검증은 수행하지 않았습니다. 코드 점검 범위와 운영자 확인 순서는 `docs/audits/ADMIN_CMS_CRUD_LIGHT_AUDIT.md`를 참조합니다.

## 9. Phase 2A Offline-Retention Control Correction (2026-08-14)

The operation page remains available because it provides an administrator-only, read-only display of `recordCleanupLastRunAt` and `recordCleanupLastRunSummary`. Page entry performs one `getDoc` for `settings/retentionPolicy`; it does not poll, listen, scan transient records, or query offline learning/access history. The static correction is confirmed deployed on 2026-08-24 from the public HTML/JavaScript assets, while an authenticated administrator smoke test remains required before `Verified`.

The obsolete offline-retention form, preview, historical offline summary, save/click handlers, session/access queries, and panel-specific styles were removed. This also removes the client merge write that could replace live cleanup-summary fields with `null`.

Existing Firestore compatibility data remains untouched. Historical fields such as `offlineSessionCleanupEnabled`, `offlineSessionRetentionDays`, and `offlineSessionLastRunSummary` may still exist in the document, but the administrator UI no longer reads, displays, or writes them. The scheduler continues to merge only its current record-cleanup summary.

The page notice states that daily 03:00 cleanup targets expired temporary authentication and attempt records only. Internal collection names are not shown in the normal administrator UI. Existing class/session archive controls remain in the offline-class CMS; no automatic archive or physical retention policy was added.

## 10. Firestore/CRUD focused corrections (2026-08-24)

- The administrator student page still loads the canonical `students` collection only after the explicit status button. It then reads matching `enrollments` and `offlineClassMembers` for visible UIDs in chunks of at most 10. Default first/unseen 10-row pages use two scoped queries; 20/50 views use up to four/ten for uncached UIDs. Revisiting cached UIDs and committed local search add no query; an unseen local-search result can show `미조회` until page navigation/page-size/detail loads it. A failed summary batch is shown as `조회 실패`, not zero.
- Student page navigation now preserves the requested page. Course/class title documents used in details are promise-cached for the current load and are not fetched repeatedly.
- New child-link attempts query exact-name student candidates instead of scanning the full `students` collection. If the exact query has no complete match, bounded prefix queries (limit 50 each) preserve legacy whitespace names without restoring a full scan. Input-dependent failures store normalized submitted name/school/grade/digits-only full phone/relation plus mismatch diagnostics for 7 days so administrators can diagnose the actual mismatch. New `linked`/`alreadyLinked` records store the same normalized submitted input for 1 day without mismatch diagnostics, so the operator can review the successful entry; legacy success records remain unmigrated and may show `-`. Account/role precondition failures keep only minimal status/purpose diagnostics; rate-limit/server-error responses write no record. The canonical `studentParentLinks` relationship is not cleaned.
- Child-link limits count recorded non-success attempts, including member/status/parent precondition failures and repeated `alreadyLinked` outcomes (5 per 10 minutes, 15 per day). The check runs before the member read and diagnostic writes. A newly `linked` result does not count; rate-limit/server-error responses write no record. Blocked responses include the rolling retry time. Grade `7` (`졸업/N수`) is accepted consistently.
- The member dashboard loads linked children concurrently, shares course/class document promises during one load, and distinguishes a failed relationship/master read from a genuine empty result. No new listener, long-lived browser cache, collection, or index was added.
- Signup send limiting is email-first at 5 accepted sends per rolling hour. Server-observed IP is only an auxiliary shared-network signal at 30 sends per hour; new attempts expire after 1 day, week-long IP blocks were removed, and the client does not send `userAgent`.
- Member attempt detail reads are admin-only and exist only in a parent member detail. Before `연동 기록 보기`, the filter controls/meta/results are hidden and no attempt read runs. The button runs one `memberUid == selectedUid`, limit-30 query, then local filtering shows at most 3 recent failures or 5 total records without another query. `인증 요청 기록 보기` remains available for both general and parent members, runs one exact-email, limit-20 query, and displays at most 10. Submitted student values and Korean failure reasons stay visible, while document IDs, UIDs, IP, and cleanup time stay under `상세 정보`. It never queries `emailVerifications`, so OTP code/session token/hash cannot enter the administrator DOM or browser through this feature. Auth login failures are not persisted or fabricated.
- The member list adds a `자녀` column through visible-page `memberUid in [...]` batches of 10 and `studentSnapshot.name`, with a page-memory cache and no student gets. Only parent detail renders the linked-children, administrator manual-link, and child-attempt sections; general detail renders none of those DOM sections. Active parent detail can search at most 20 students by name prefix or exact UID and perform deterministic manual link/revive or revoke. The canonical link and member counter commit atomically; only a completed transaction can emit success, after which the selected detail is reloaded and the visible-list child cache is invalidated/reloaded. Firestore permission/network failures use Korean operator messages rather than raw SDK text. Owner production smoke verified a normal second-child manual link with `linkedBy: admin`, `matchMethod: admin_manual`, and active status, followed by revoke preserving the document with `status: revoked` and `revokedAt`. The earlier mismatch is classified as legacy/test-data counter inconsistency; no repair or migration is planned.
- Verification resend keeps one canonical document per email, resets attempts, issues a CSPRNG code and a page-memory session token, and stores only the token hash. Transactional verification prevents replay/concurrent update races and binds the five-wrong-code invalidation to the active session. Student/member profile self-create Rules require matching Auth email, signup type, recent `verifiedAt`, and non-due `cleanupAt`.
- Cleanup update-time preconditions, signup/session security, administrator UI, the existing four Functions, and Firestore Rules were deployed in the coordinated `4d1a83d1` rollout. Owner production smoke verified normal signup, child-link failure diagnostics, automatic child linking, parent LMS child/course display, and administrator manual link/revoke. No new index, collection, listener, counter service/Function, export, migration, or production data operation was added.
- The separate 2026-08-25 parent-only attempt UI and successful `submittedInput` addition are `Deployed` from commit `810941f3` with deployment record `38ea7295`: Cloudflare live assets confirm the initial hidden state and 3/5 local filters, and Firebase updated only `linkMemberChild`. One new `linked`/`alreadyLinked` attempt document still needs owner confirmation of the five submitted fields and approximately one-day `cleanupAt`; that narrow behavior remains `Deployed`, not `Verified`.

## 11. Primary list UX and read behavior (2026-08-24)

- 학생, 회원, 강사, 계정, 온라인 강좌, 오프라인 반 관리의 주 목록은 입력값과 적용 검색어를 분리합니다. Enter 또는 돋보기 버튼에서만 로컬 검색을 적용하고 새 검색은 page 1로 이동합니다.
- 주 목록은 기본 10개, 10/20/50 선택, 고정 높이 scroll viewport, sticky table header, viewport 밖 공통 pagination 버튼을 사용합니다. Primary table은 scroll viewport가 실제 sticky 기준이 되도록 table 자체의 overflow를 만들지 않으며, 세로·가로 스크롤 중에도 header와 body column 정렬을 유지합니다. 마지막 페이지의 row/card는 viewport를 채우도록 늘어나지 않으며, item 범위·전체 count 문구와 pagination 자동 scroll은 제거했습니다. 기존 modal/detail 표와 작은 CMS settings 배열은 운영 흐름을 보존하기 위해 일괄 pagination 대상으로 만들지 않았습니다. Sticky header와 가로 scroll 후 header/cell 정렬은 owner production smoke로 `Verified`입니다.
- 학생/회원/강사/계정/온라인 강좌는 주 master collection을 먼저 전체 로드하므로 UI pagination 자체는 document read를 줄이지 않습니다. 검색/필터/page 이동은 메모리 배열만 사용합니다. 학생 관계 요약만 visible UID batch/cache 방식이고, 오프라인 반 count만 visible-page lazy aggregation/cache 방식입니다.
- 오프라인 반은 `offlineClasses`/`instructors` master를 전체 로드하되 회차/학생 count aggregation은 전체 `2 * C`에서 uncached visible `2 * V`로 줄였습니다. 로컬 검색·필터는 새 count query를 실행하지 않습니다. 반/학생 UI는 숫자 학년 `1`~`7`을 공용 학년명으로 표시합니다. 반 학생 추가 modal의 학생 master는 page lifetime에 한 번 로드하고 Enter/버튼으로 검색합니다. 공백 조합은 AND 조건이며 한 자리 `1`~`3`은 중·고 공통 학년 차수, 숫자 4자리는 정확한 전화번호 뒷자리, 그 밖의 토큰은 이름·학교·표시 학년으로 해석합니다. `문일고2`처럼 붙인 학교+학년 차수도 지원합니다.
- 회원 상세의 선택 회원 기본 문서는 이미 로드한 row를 사용해 중복 direct get 1회를 제거했습니다. 관계 조회는 선택 회원·연결 자녀 범위로 유지하며 shared course/class 문서는 메모리 cache를 사용합니다.
- 회원가입 인증 발송과 자녀 연동은 진행 문구, 관련 입력/버튼 잠금, 중복 submit guard, 20초 client timeout, `finally` unlock을 사용합니다. 자녀 목록은 linked/already-linked 성공에서만 다시 읽습니다.
- 강좌 관리의 기본 toolbar는 desktop에서 검색/운영 상태/수강 유형/상세 필터/초기화/보기 선택이 한 행에 배치되고 좁은 화면에서만 wrap합니다. 오프라인 반 table은 desktop에서 container 폭을 사용하며 768px 이하에서만 1040px horizontal-scroll fallback을 유지합니다.
- 공개 강좌와 6개 관리자 primary list는 mobile에서 검색과 10/20/50 select를 같은 행에 두고 별도 `보기` 문구를 사용하지 않습니다. 강사 primary list는 검색/page-size만 유지하고 과목 필터 패널·정렬 select·중복 안내 box를 제거했습니다. 강좌 catalog의 과목 추가 행은 학년/연도처럼 목록 위에 있습니다.
- 학생·강사·일반/학부모 dashboard의 단순 list-count summary는 제거했지만 기존 stat card와 실제 수강/배정 상세는 유지합니다. count summary만을 위한 query는 없었습니다. 학생 profile 이름은 초기 grade-check read를 재사용하고, 강사 settings/welcome은 같은 account document promise를 공유합니다.
- Popup, timetable, site CMS는 bounded settings/page 문서 내부 배열 편집기이고 일반 검색 목록이 아니므로 현재 editor UI를 유지합니다. 새 collection, index, listener, summary counter, Function export는 추가하지 않았습니다.
