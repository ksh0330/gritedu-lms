# 기능별 현재 상태 (System State)

최종 갱신: 2026-11-03 (운영 main 9f9fcd5 기준)

이 문서는 기능이 **지금 어떻게 동작하는지**만 적는다. 변경 경과·배포 증거는 `docs/MAINTENANCE_LOG.md`, 데이터 필드는 `docs/DATABASE_SCHEMA.md`, 운영자 사용법은 `docs/OPERATION_MANUAL.md`를 본다. 2026-11-03에 `ADMIN_CMS_STATE.md`, `ONLINE_COURSE_SYSTEM_STATE.md`, `OFFLINE_CLASS_SYSTEM_PLAN.md`를 이 문서로 합쳤다.

## 1. 역할과 화면

| 역할 | 판정 문서 | 주요 화면 |
| --- | --- | --- |
| 비로그인 | - | `/`, `courses.html`, `course-detail.html`, `instructors.html`, `schedule.html`, `story.html`, `contact.html`, `tuition.html`, 로그인·회원가입 |
| 학생 | `students/{uid}` | `members/students/dashboard.html`(내 강의실), `course.html`(온라인 학습), `offline-class.html`(반 상세) |
| 일반 회원 | `members/{uid}`, `memberPurpose=general` | `members/member/dashboard.html`(회원 LMS), `course.html` |
| 학부모 회원 | `members/{uid}`, `memberPurpose=parent` | 회원 LMS의 자녀 연동·자녀 학습 요약 |
| 강사 | `instructorAccounts/{uid}` + 공개 `instructors/{id}` | `members/instructors/dashboard.html`(강사 LMS), `course-detail.html`, `offline-class.html` |
| 관리자 | `admins/{uid}` | `members/admin/**` |

- 로그인 상태에서 로그인·회원가입 화면에 들어가거나 뒤로 가면 역할별 첫 화면으로 `location.replace` 이동한다(`utils/guest-only-page.js`).
- 학생·회원·강사 대시보드 상단: 제목(아이콘 포함, 강사는 가운데 정렬), `이름님, 환영합니다.`, 수능 D-Day(사이트 관리 '대시보드' 체크박스 하나로 세 화면 공통 제어), `기본 정보 수정` 버튼.
- `users/*`, `changeHistory`, legacy `parents`, `publicInstructorProfiles`는 폐기됐고 Rules가 차단한다.

## 2. 온라인 강좌

### 2.1 유형과 저장 위치

| 운영 명칭(관리자) | `accessType` | 학습 영상 위치 | 수강 시작 |
| --- | --- | --- | --- |
| 공개 | `public` | `courses/{id}.weeks[]` | 로그인 불필요(보기) |
| 회원 전용 | `memberOnly` | `courses/{id}.weeks[]` | 학생·일반 회원 본인 신청 즉시 |
| 회원 전용(유료) | `approvalRequired` | `coursePrivateContent/{id}` (공개 문서는 `weeks: []`, `completionVideoIds`만) | 본인 신청 → 관리자 승인, 또는 관리자 직접 등록 |

- 학생·회원 화면 배지는 두 회원 전용 유형 모두 `회원전용 강좌`다. 결제·DRM은 없다. legacy `paid` 값은 읽기 호환만 한다.
- 저장된 강좌의 유형 전환은 CMS와 Rules가 모두 막는다(상태 `published/draft/archived` 변경은 허용).
- `courses`는 Rules상 공개 읽기다. 그래서 보호 영상 URL은 승인형에만 있고 `coursePrivateContent`는 관리자·담당 강사·활성 수강자만 단건 `get`(list 금지)한다.
- 승인형 저장 시 공개 문서에 영상 ID 목록 `completionVideoIds`(URL 없음, 최대 2000)를 함께 쓴다. 학부모는 이것으로 자녀 완료율을 본다.
- 영상 URL은 YouTube watch·youtu.be·live·embed·재생목록, 직접 MP4를 받는다. 재생목록은 한 콘텐츠로 센다.

### 2.2 수강·신청

- 수강 문서 `enrollments/{uid}_{courseId}`. 회원 전용은 신청 시 `active` 생성, 수강 취소는 문서 삭제. 승인형 해제는 `status: revoked`로 기록을 남기고 재등록 시 진도를 보존한다.
- 승인형 신청 `courses/{id}/enrollmentRequests/{uid}`: `pending/approved/rejected`. 학생·일반 회원만 신청할 수 있고 학부모는 신청·직접 등록 대상이 아니다. 거절 후 자동 재신청은 없지만 관리자가 직접 등록할 수 있다.
- 관리자 직접 등록: 이름 2자 이상 prefix 또는 정확한 이메일로 학생·회원 컬렉션별 최대 20건 검색 → 한 계정 선택 → 등록. 승인·등록은 신청 상태와 enrollment를 한 transaction으로 저장한다.

### 2.3 완료율

- 영상 열기·재생·새 탭은 완료로 기록하지 않는다. `학습 완료` 버튼만 `watchedVideos`를 transaction으로 합쳐 저장한다.
- 표시 완료율은 현재 강좌 영상 ID와 `watchedVideos`를 매번 대조해 계산한다(`utils/course-completion.js`). 모든 영상을 완료하기 전에는 99%를 넘지 않는다. `enrollment.progress`는 마지막 저장 시점 값이라 표시·분류에 쓰지 않는다.
- 관리자 편집은 기존 영상 ID를 보존하고 새 영상에 고유 `completionId`를 준다.

### 2.4 삭제

- 영구 삭제는 강좌·보호 문서·신청·수강/진도 기록을 한 batch로 지운다. 450 write를 넘으면 삭제 전에 멈추고 보관을 안내한다. 운영에서는 보관(`archived`)을 먼저 쓴다.

## 3. 오프라인 반

### 3.1 데이터

| 컬렉션 | 역할 |
| --- | --- |
| `offlineClasses/{classId}` | 반 원본(과목·학년·학교·강사 배열·수업/클리닉 일정·`groupId`·상태) |
| `offlineClassMembers/{classId}_{studentUid}` | 입반(`joinedAt`, 표시용 스냅샷). 제거 시 같은 반의 접근 예외도 함께 삭제 |
| `offlineClassSessions/{sessionId}` | 회차 메타(날짜 `YYYY-MM-DD`, 제목, 설명, `hasVideo`) |
| `offlineSessionPrivate/{sessionId}` | 회차 영상 URL (2026-11-03 기존 548건 이전 완료) |
| `offlineSessionAccess/{sessionId}_{studentUid}` | 학생별 예외: `manualGrant`(입반 전 허용) / `manualRevoke`(차단) |

### 3.2 접근 규칙 (Rules가 강제)

- 학생 회차 목록: 활성 입반 + 공개 회차 + `sessionDate >= 입반일(KST 날짜)`를 쿼리에 넣어야 허용된다. 입반 전 회차는 활성 `manualGrant`가 있는 것만 단건 `get`으로 읽는다. 차단된 회차·영상은 거부된다.
- 회차 영상은 `offlineSessionPrivate` 단건 `get`으로만 읽고 같은 입반일·허용·차단 판정을 따른다.
- 학부모: `members.linkedStudentUids`의 앞 5명 중 그 반에 활성 입반한 자녀가 있을 때만 반 문서를 읽는다(목록 조회 불가).
- 반 문서 판정 순서는 관리자 → 학생 → 학부모 → 강사(10문서 제한과 billed read를 줄이기 위한 순서). 회차 단건은 관리자 → 학생 → 강사.
- 담당 강사는 담당 반의 학생·회차·영상을 읽는다. 보관된 회차는 관리자·담당 강사만 본다.

### 3.3 운영 정책

- 회차·접근 기록은 자동 삭제하지 않는다. 끝난 반은 보관한다. 물리 삭제는 owner 승인·백업·dry-run이 있을 때만 한다.
- 검토 시작 기준(자동 삭제 아님): 회차 10,000건, 접근 예외 50,000건, 한 반 회차 100건, 관리자 반 목록 100개, 오프라인 화면 P95 2초, 오프라인 관련 하루 10,000 read 중 하나.
- 공개 시간표는 반의 실시간 보기가 아니라 `settings/timetableCatalog` 그룹별 이미지다. 반을 바꿔도 시간표 이미지는 자동으로 바뀌지 않는다.

## 4. 학부모-자녀 연결

- 확정 관계 `studentParentLinks/{studentUid}_{memberUid}`(`active/revoked`), 시도 기록 `memberChildLinkAttempts`(실패 7일·성공 1일 보관, 자동 정리).
- 학부모 본인 연동은 `linkMemberChild` Function(이름·학교·학년·전화·관계 일치, 10분 5회·하루 15회 제한)이 링크·`linkedChildrenCount`·`hasLinkedChildren`·`linkedStudentUids`를 한 transaction으로 쓴다.
- 관리자 수동 연결·해제도 같은 필드를 transaction으로 바꾼다. Console에서 링크만 직접 지우지 않는다(카운터 불일치 원인).
- 학부모 화면: 자녀별 온라인(공개 주차 또는 `completionVideoIds`로 완료율)·오프라인 반 요약. 보호 영상 URL은 읽지 못한다.

## 5. 관리자 CMS

### 5.1 화면

| 화면 | 경로 | 주요 기능 |
| --- | --- | --- |
| 대시보드 | `admin/dashboard.html` | 메뉴 진입, 현황 불러오기 |
| 계정 생성·관리 | `admin/users/add.html` | 역할별 계정 생성, 계정 데이터 정리, XLSX |
| 학생 | `admin/users/students.html` | 조회·수정·XLSX, 수강/반 요약은 보이는 행만 10명씩 조회 |
| 일반/학부모 회원 | `admin/users/members.html` | 조회, 자녀 열, 학부모 상세의 자녀 연결·해제·연동 기록 |
| 강사 | `admin/users/instructors.html` | 공개 프로필 + `instructorPrivate`(연락처·메모), 계정 연결, 과목 기준값 |
| 온라인 강좌 | `admin/courses.html` | 생성·수정·보관·삭제, 강좌 보기, 승인형 신청·직접 등록·해제 |
| 오프라인 반 | `admin/offline-classes.html` | 반·입반·회차·접근 예외, 그룹별 기준값, 반 수 많을 때는 보이는 행만 count |
| 시간표 | `admin/timetable.html` | 그룹 이름·노출·순서, 그룹별 이미지(이미지는 즉시 저장) |
| 사이트 | `admin/site.html` | 푸터·학원정보 이미지, 학원 안내, 상담 문의, 카카오톡 채널, 강사진 노출, D-Day |
| 팝업 | `admin/popup.html` | `settings/popups` 이미지·문구 팝업 |
| 운영 기록 정리 | `admin/operation-tasks.html` | 매일 03:00 자동 정리 결과 읽기 전용 표시 |

공통 규칙: 주 목록은 검색어를 Enter/돋보기에서만 적용, 10/20/50개 보기, 고정 헤더. 학생·회원·강사·계정·강좌 목록은 master 컬렉션을 한 번 읽고 메모리에서 검색·페이지 이동한다. XLSX는 필터 결과만, 관계 조회는 ID 10개 단위, 관계별 5,000건 초과 시 생성하지 않는다. 위험 작업은 공통 확인창, 영구 삭제는 확인 문구 입력.

### 5.2 기준값 소유권

| 기준값 | 저장 문서 | 관리 화면 |
| --- | --- | --- |
| 온라인 과목·학년·연도 | `settings/courseCatalog.chipGroups` | 온라인 강좌 |
| 반 과목·학년·학교 | `settings/offlineClassCatalog.groupCatalogs[groupId]` | 오프라인 반 |
| 시간표 그룹·이미지 | `settings/timetableCatalog` | 시간표 |
| 강사 과목·강사진 노출 | `settings/instructorsMenu` | 강사 / 사이트 |
| 과목 색상(공용) | `settings/subjectColors.subjectColorMap` | 각 기준값 저장 시 신규 과목만 보충 |

- 중앙 `settings/operationCatalog`, `courseCatalog.instructorSubjectChips`, 페이지별 `subjectColorMap/subjectMeta`, `publicTimetableEntries`는 폐기(읽기 호환·정리 대상)다.
- 직접 입력값은 해당 문서에만 저장되고 기준값·색상 맵을 늘리지 않는다. `전체`·`직접 입력` 같은 예약값은 저장하지 않는다.

## 6. 공개 사이트 CMS

| 영역 | 문서 | 메모 |
| --- | --- | --- |
| 푸터 사업자·연락처·SNS | `settings/footer` | 공개 화면은 5분 세션 캐시, 저장 시 같은 탭 캐시 무효화 |
| 학원정보·교습비·환불규정 이미지 | `settings/tuitionImages` | `assets.gritedu.kr/public/footer/` 이미지만, PDF 미사용 |
| 학원 안내 | `pages/story` (`version: 2`) | 배너 2:1·대표 사진 2:3 비율 자리 예약, 이미지 `public/story/` |
| 상담 문의 | `pages/contact.structure.locations[]` | 이미지 첨부 금지, 저장은 canonical 덮어쓰기 |
| 카카오톡 채널 | `settings/kakaoChannel` | SDK 없이 `https://pf.kakao.com/...` 링크, 선택 페이지 6곳만 |
| 팝업 | `settings/popups` | 이미지만·문구만·혼합, R2 또는 `/assets/popup` |
| 수능 D-Day | `pages/dday` | 표시 위치 '메인홈' / '대시보드(학생·회원·강사)'. 같은 탭 5분 캐시 |
| 강사진 | `instructors`, `settings/instructorsMenu` | 숨김은 즉시 저장, 순서는 `순서 저장` 시 |

CMS 문구·URL 변경은 Firestore 저장만으로 반영되고 코드 배포가 필요 없다. 로컬 `/assets` 파일 변경만 배포가 필요하다.

## 7. 가입·인증·자동 정리 (Functions 4개)

- `sendVerificationCode` / `verifyEmailCode`: 이메일 OTP(CSPRNG, 토큰은 해시만 저장, 재전송·검증 transaction). 발송 제한은 이메일 1시간 5회, IP 1시간 30회. 프로필 자가 생성은 Auth 이메일·가입 유형·최근 인증을 Rules가 확인한다.
- `linkMemberChild`: §4.
- `scheduledRecordCleanup`: 매일 03:00(KST) `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts`의 `cleanupAt <= now`만 500건씩 삭제. 학습·관계·CMS 데이터는 자동 삭제하지 않는다.
- 입력 길이: 이름 100, 이메일 254, 학교 100, 전화 30, 자녀 이름 50 — 화면 `maxlength`와 Rules/Functions 한도가 같다.

## 8. 로딩 화면 원칙

- 데이터가 오기 전 skeleton은 로딩 완료 화면과 같은 크기로 둔다(`assets/css/components/dashboard-skeleton.css` 실측값, `utils/dashboard-skeleton.js`). 목록을 다시 불러올 때도 글자 안내 대신 같은 skeleton을 그린다.
- 2026-11-03 전체 점검 결과 주요 화면의 로딩 중 화면 이동(CLS)은 0~0.05. 남은 차이는 반·강좌 개수 같은 데이터 차이다.

## 9. 위험 작업

- 학생 삭제: 활성·불명확 학부모 링크가 있으면 막고 관리자 해제를 먼저 요구. 수강·입반·접근·시도 기록을 정리하고 프로필을 마지막에 지운다.
- 회원 삭제: 직전 재조회 후 의존 기록 → 프로필 순서. 학생 프로필·Auth는 유지.
- 강사 삭제: 담당 강좌·반·계정 연결 확인.
- 강좌·반 삭제: 보관 먼저. 반 삭제 전 입반·회차·접근 예외·시간표 영향 확인.
- 공개 읽기 문서(`courses`, `pages`, 공개 settings)에 비공개 URL·결제 정보·토큰·내부 메모를 저장하지 않는다.

## 10. 의도적으로 하지 않은 것

결제·DRM, 네이티브 앱·푸시, Firebase Storage 업로드(이미지는 로컬 `/assets` 또는 R2 공개 URL), 출결·성적·과제, 공개 시간표 자동 동기화, 회차·접근 기록 자동 삭제. PWA는 홈 화면 추가와 오프라인 안내 화면만 제공한다.
