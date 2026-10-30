# Grit Edu LMS Firestore Schema

최종 갱신: 2026-10-17

## 1. 원칙

- Firestore rules가 클라이언트 권한의 최종 경계입니다.
- 현재 `courses`는 상태와 관계없이 공개 read입니다. 기존 draft/private/memberOnly/paid 문서·URL 존재는 owner read-only inventory 전까지 `Needs live-data check`입니다. 2026-10-17 배포된 신규 승인형 강좌는 공개 소개와 별도 보호 영상 문서를 사용하며, 기존 문서는 자동 이동하지 않습니다.
- 관리자 CMS는 canonical collection을 직접 관리합니다.
- `scheduledRecordCleanup` runs daily at 03:00 Asia/Seoul and automatically targets only the three transient collections with a due `cleanupAt`. Phase 2A removes offline session/access deletion and legacy full scans. The administrator UI remains Rules-protected and separate.
- Legacy `users/*`와 `changeHistory`는 새 기능에서 사용하지 않습니다. 실제 문서 존재·역할·참조는 owner inventory 전까지 possible orphan/history이며 자동 삭제하지 않습니다.
- 2026-07-06 기준 Story greeting panel overflow containment 보강, Contact 상담 문의는 `pages/contact` canonical 구조(`slug`, `structure.locations[]`, `updatedAt`)로 운영합니다.
- 2026-07-06 기준 Popup은 `settings/popups.popups[].textItems[]` 우선 렌더이며, **이미지만·문구만·혼합** 팝업을 지원합니다(`imageUrl` 없이 `textItems`만 있어도 표시).
- 2026-07-27 기준 시간표/오프라인 반 `groupId` + `settings/timetableCatalog.scheduleGroups[]`(정규/기간 탭, max 3) 지원. 반 선택 목록은 `settings/offlineClassCatalog.groupCatalogs[groupId]`, 시간표 이미지는 `settings/timetableCatalog.groupCatalogs[groupId].scheduleImages`에 분리 저장합니다. legacy top-level 필드는 저장 시 삭제합니다.
- 2026-08-01 기준 온라인 수강 문서는 `{userId}_{courseId}`, 반 배정 문서는 `{classId}_{studentUid}`, 회차 예외 권한 문서는 `{sessionId}_{studentUid}`를 canonical ID로 사용합니다. 학생 반 화면은 `offlineSessionAccess.status`와 `joinedAt`으로 회차 노출을 계산합니다.
- 2026-07-06 기준 카카오톡 채널 플로팅 링크는 `settings/kakaoChannel`에서 관리합니다. SDK나 Kakao Developers 앱키 없이 `https://pf.kakao.com/...` URL 링크만 저장합니다.
- 중앙 운영 기준값 모델(`settings/operationCatalog`, 운영 기준값 탭, `operation-catalog.js`)은 폐기되었습니다. 기준값은 각 관리 페이지 책임에 맞는 settings 문서에서 관리합니다.
- 2026-08-13 Phase 1B의 가입 인증 미결합과 학습 이력 자동 삭제 문제는 이후 coordinated Functions/Rules rollout과 Phase 2A cleanup으로 해결·배포됐습니다. 학생 자동 진급의 연도별 멱등 guard용 Rules, marker 없는 기존 학생의 학년 보존, 수동 학년 수정 후 다음 연도 자동 진급 유지까지 `66132e67` 정적 client로 배포됐고 production 코드 제공을 확인했습니다. 역할 계정 동작 확인은 남아 있습니다. Offline session `joinedAt`/manual revoke Rules 미강제는 owner가 현재 UI 필터 운영을 유지하기로 해 보류했고, limiter threshold race는 `Conditional risk`입니다.
- Current production keeps transient data minimal: signup attempts are email-first with server-observed IP only as a short auxiliary signal, child-link attempts store normalized submitted identity only for short administrator diagnostics, and child candidate lookup is exact-name scoped with a bounded legacy-whitespace fallback instead of a full `students` scan. The export surface remains four Functions and no new index or collection was added.

## 2. Active Collections

| Collection | 목적 | 주요 접근 |
| --- | --- | --- |
| `admins` | 관리자 권한/프로필 | 본인/관리자 read, 관리자 write |
| `students` | 학생 계정 프로필 | 본인/관리자 read, 관리자 중심 write |
| `members` | 일반 회원/학부모 회원 프로필 | 본인/관리자 read, 관리자/가입 flow write |
| `studentParentLinks` | 학생-회원 확정 연결 | 관리자 및 연결 당사자 read, 관리자 delete |
| `memberChildLinkAttempts` | 회원-자녀 연결 시도/요청 | 관리자 read, Functions create; 회원 client read 없음 |
| `instructors` | 강사 공개 프로필 | 공개 read, 관리자 write |
| `instructorPrivate` | 강사 프로필 ID별 내부 메타데이터 | 관리자만 read/write |
| `instructorAccounts` | 강사 로그인 계정 정보 | 본인/관리자 read, 관리자 write |
| `courses` | 온라인 강의 | 공개 read, 관리자 write |
| `coursePrivateContent` | 신규 승인형 강좌의 영상·미리보기 (2026-10-17 운영 배포) | 관리자, 담당 강사 또는 활성 학생·일반회원 수강자 get, 관리자 write |
| `courses/{courseId}/enrollmentRequests` | 승인형 수강 신청·심사 (2026-10-17 운영 배포) | 본인 신청/조회, 관리자 조회·심사 |
| `enrollments` | 온라인 수강 연결 | 본인/관리자/담당 강사 제한 read, 관리자 및 허용된 사용자 write |
| `offlineClasses` | 오프라인 반 | 관리자/담당 강사/배정 학생 제한 read, 관리자 write |
| `offlineClassMembers` | 오프라인 반 학생 배정 | 관리자/담당 강사/해당 학생 제한 read, 관리자 write |
| `offlineClassSessions` | 오프라인 반 회차 | 관리자/담당 강사 read, active 반 학생의 published read. 현재 Rules는 joinedAt/revoke 미강제, 관리자 write |
| `offlineSessionAccess` | 학생별 오프라인 회차 접근 | 관리자/담당 강사/해당 학생 제한 read, 관리자 write |
| `settings/timetableCatalog` | 공개 시간표 그룹·이미지 | 공개 read, 관리자 write |
| `pages` | 공개 페이지 콘텐츠 | 공개 read, 관리자 write |
| `settings` | 사이트/CMS 설정 | 일부 공개 read, 관리자 write |
| `operationTasks` | legacy 운영 문서 | 신규 생성 중단. 자동/수동 cleanup 대상 제외 |
| `emailVerifications` | 이메일 인증 코드/상태 | Functions create/update, 관리자 read/delete |
| `signupAttempts` | 가입/인증 시도 제한 보조 | Functions create, 관리자 read/delete |

## 3. Deprecated, Blocked, Or Legacy Collections

| Collection/doc | 상태 | 대체/비고 |
| --- | --- | --- |
| `users/*` | deprecated, rules deny | `admins`, `students`, `members`, `instructorAccounts`, `instructors`로 분리 |
| legacy `parents` | deprecated | 일반 회원/학부모는 `members`와 `studentParentLinks` 사용 |
| `changeHistory` | deprecated, rules deny | 운영 기록 저장소로 사용하지 않음 |
| `publicInstructorProfiles` | deprecated | `instructors` 사용 |
| `settings/home` | legacy | 현재 settings/pages 구조로 대체 |
| `settings/instructors` | legacy | `settings/instructorsMenu` 등 현재 settings doc 사용 |
| `settings/dday` | legacy | 현재 D-day/settings 정책 기준으로 재검토 |
| `publicTimetableEntries` | deprecated, Rules상 admin read/delete만 | 공개/관리 시간표는 `settings/timetableCatalog` 사용; 신규 create/update 금지 |

Rules에 남아 있는 residual collection이나 admin-only compatibility path는 새 기능의 source-of-truth가 아닙니다. 신규 구현은 Active Collections를 기준으로 해야 합니다.

## 4. Role/Profile Collections

### `admins/{uid}`

관리자 권한 판정과 관리자 프로필에 사용합니다.

권장 필드:

- `uid`
- `email`
- `name`
- `role`
- `createdAt`
- `updatedAt`

### `students/{uid}`

학생 계정의 canonical profile입니다.

권장 필드:

- `uid`
- `email`
- `name`
- `phone`
- `school`
- `grade`
- `gradeManualOverride` (legacy 호환 필드; 자동 진급의 영구 차단 조건으로 사용하지 않으며 다음 marker 초기화/진급 또는 실제 학년 수정 시 `false`로 정규화)
- `lastAutoPromotionYear` (자동 진급을 마지막으로 완료한 연도, integer)
- `status`
- `marketingConsent`
- `createdAt`
- `updatedAt`

`name`은 가입 profile writer, 관리자 계정 생성, 관리자 학생 수정, 공통 `saveStudentProfile`에서 앞뒤 공백을 제거해 저장합니다. 자녀 연동은 canonical `name == 입력값` exact query를 우선하고, 과거 선행/후행/중복 공백 이름의 호환을 위해 exact complete match가 없을 때만 최대 2개의 prefix query(각 limit 50)와 동일 정규화 비교를 사용합니다. 기존 문서를 migration하거나 전체 scan으로 되돌리지 않습니다.

학생 대시보드의 자동 진급은 `createdAt`이 현재 연도보다 이전이고 1~6학년이며 유효한 이전 `lastAutoPromotionYear`가 현재 연도보다 작을 때만 수행합니다. marker가 없는 기존 학생은 첫 진입 transaction에서 현재 저장 학년은 바꾸지 않고 현재 연도 marker만 초기화합니다. 학생 또는 관리자가 실제 학년을 변경하면 기존 profile/list 값을 재사용해 추가 Read 없이 같은 저장에 현재 연도 marker와 `gradeManualOverride: false`를 기록합니다. 이름·전화번호 등만 수정하면 marker는 건드리지 않습니다. 다음 연도에는 `grade`와 marker를 같은 transaction에서 기록하므로 같은 연도의 재접속·동시 실행은 다시 진급시키지 않습니다. 기존 `gradeManualOverride: true`는 영구 차단 조건으로 사용하지 않고, 기존 운영 데이터의 학년을 추정 복구하거나 marker를 일괄 채우는 migration도 하지 않습니다.

### `members/{uid}`

일반 회원과 학부모 회원의 canonical profile입니다.

권장 필드:

- `uid`
- `email`
- `name`
- `phone`
- `memberType`
- `children`
- `marketingConsent`
- `status`
- `createdAt`
- `updatedAt`

### `studentParentLinks/{studentUid}_{memberUid}`

학생과 회원의 확정 연결입니다.

Current canonical fields:

- `studentUid`, `memberUid`
- `status` (`active` | `revoked`)
- `relationLabel` (`father` | `mother` | `guardian`), `relationDisplay`
- `linkedBy` (`autoMatch` | `admin`), `matchMethod` (`name_school_grade_phone` | `admin_manual`)
- `studentSnapshot` (`name`, `school`, `grade`, `phoneLast4`), `memberSnapshot` (`name`, `email`, `phone`)
- `createdAt`, `updatedAt`, `revokedAt`

Document ID는 `${studentUid}_${memberUid}` deterministic key입니다. 회원 self-link와 관리자 수동 link/reactivation은 같은 문서를 재사용합니다. 관리자 direct create/update는 Rules에서만 허용하고, link 상태 전이와 `members.hasLinkedChildren/linkedChildrenCount` delta를 한 transaction으로 쓰며 `getAfter`로 동반 counter write를 검증합니다. 기존 callable도 member-scoped links를 transaction 안에서 읽어 exact active count를 함께 기록합니다. 관리자 해제는 물리 삭제 대신 `status: revoked`와 `revokedAt`을 사용하며, admin delete는 기존 계정 정리 호환을 위해 별도 유지됩니다.

학생 계정 정리는 active 또는 상태가 불명확한 link가 하나라도 있으면 실행하지 않습니다. 먼저 회원 관리의 정상 revoke transaction으로 member counter를 갱신해야 합니다. 그 뒤 명시적 계정 정리에서 revoked link, student-matched transient attempt, 수강/반/회차 접근, 해당 이메일의 임시 가입·인증 기록을 학생 profile과 함께 정리합니다. 일반/학부모 회원 정리는 실행 시점에 member-scoped 관계·수강·attempt와 email-scoped transient 문서를 다시 읽고 dependency를 먼저, member profile을 마지막에 삭제합니다. Auth 계정은 별도 Firebase Console 작업입니다.

### `memberChildLinkAttempts/{attemptId}`

회원이 자녀 연결을 시도한 transient 운영 기록입니다. 확정 관계는 이 collection이 아니라 `studentParentLinks`입니다.

2026-08-24 current writer fields:

- `memberUid`
- `result`
- `matchCount`
- `createdAt`
- `cleanupAt`
- `submittedInput` (입력 의존 실패 및 `linked`/`alreadyLinked`에 선택): normalized `studentName`, `school`, `grade`, digits-only 전체 `studentPhone`, `relationLabel`
- `diagnostics` (실패 시 선택): `providedFields`, `mismatchFields`, member status/purpose 진단
- `matchedStudentUid`, `linkId` (성공 시에만 확정 관계 추적용)

`invalidInput`, `notFound`, `ambiguous`에는 관리자 진단을 위해 실제 제출값을 위 `submittedInput` shape로 저장합니다. 새 `linked`/`alreadyLinked`에도 운영자가 하루 동안 실제 입력을 확인할 수 있도록 같은 shape를 저장하지만 `mismatchFields`는 쓰지 않습니다. 배포 전 생성된 성공 문서는 migration하지 않으며 `submittedInput`이 없을 수 있습니다. `notMember`, `inactiveMember`, `notParent`는 입력 진단이 시작되기 전의 계정/역할 결과이므로 전체 입력값을 저장하지 않고 필요한 status/purpose 진단만 유지합니다. Rate-limit 응답과 server error는 새 attempt 문서로 쓰지 않습니다. 실패·비성공 결과는 7일, 성공/이미 연결됨 결과는 1일 후 `cleanupAt`이 도래하며 확정 `studentParentLinks`는 보존됩니다. 실제 신규 `linked` 성공은 limiter count에서 제외하지만 반복 `alreadyLinked`는 5/10분·15/일 제한에 포함되어 로그/다음 조회가 무제한 증가하지 않습니다. 이 collection은 전체 전화번호와 내부 진단을 포함할 수 있으므로 Rules read는 admin-only입니다. Console logging은 `submittedInput`이나 전체 전화번호를 포함하지 않습니다.

### `instructors/{instructorId}`

공개 강사 프로필입니다. 공개 페이지와 관리자/강사 대시보드에서 사용합니다. **로컬 구현 기준** 신규 관리자 쓰기는 공개 필드만 저장하며 최종 Rules는 허용 목록 밖의 필드를 거부합니다. 운영 기존 문서의 내부 필드는 아직 이전·삭제되지 않았으므로 현재 운영 공개 노출은 별도 승인 작업 전까지 해소되지 않습니다.

문서 ID는 `inst_<timestamp>` 형식을 사용하며, `instructorId` 필드에도 동일 값을 저장합니다.

권장 필드:

- `name`
- `subject`
- `subjects` (`string[]`; 복수 과목. `subject`는 대표 과목 하위호환 필드)
- `category` (레거시 공개 과목 fallback), `order`/`sortOrder` (레거시 공개 순서 fallback; 현재 주 순서는 `settings/instructorsMenu`)
- `bio` (약력)
- `brief` (한줄소개)
- `photo` (프로필 이미지 URL)
- `curriculumImageUrl`, `curriculumImageUrls` — 강사 참고 자료 이미지 (legacy 필드명 유지, 배열 우선, 단일 URL은 첫 항목 fallback). 신규 R2 prefix: `public/instructors/image/`; legacy read-only: `public/instructors/curriculum/`
- `videos` (`{ url, fullUrl, id, title }[]`; 주 영상 데이터)
- `instructorId`
- `createdAt`, `updatedAt`

### `instructorPrivate/{instructorId}`

관리자 전용 강사 메타데이터입니다. 공개 프로필과 **동일한 문서 ID**를 사용하며 미연결 강사에도 문서를 둡니다. `email`, 정규화한 `emailLower`, `phone`, 관리자 `note`, Auth `uid`(미연결은 빈 문자열), `pending`(미연결 여부), `createdAt`/`updatedAt`을 담습니다. Auth UID 기반 `instructorAccounts/{uid}`는 강사 로그인과 담당 강좌·반 조회의 canonical 계정으로 유지합니다. 관리자 화면은 private → 기존 공개 문서 legacy 필드 → account 순으로 호환 읽기를 하며, 공개 화면은 private collection을 읽지 않습니다. 새 쓰기는 공개 프로필·private 메타데이터·필요한 계정을 batch로 저장합니다.

운영 이전 전에는 기존 공개 문서의 내부 필드가 남습니다. 최종 Rules의 공개 필드 allowlist는 이런 문서의 일반 편집을 막으므로, 대상별 private 복사와 공개 필드 제거 및 구버전 브라우저 차단 확인을 거친 뒤 배포해야 합니다. 공개 강좌/반의 `instructorId`는 유지하며 UID만 가진 legacy 참조는 대상별 inventory와 보정이 필요합니다.

노출 순서는 문서 `order`가 아니라 `settings/instructorsMenu`의 `instructorsOrder` / `homeOrder`를 사용합니다.

기준값은 중앙 문서가 아니라 각 관리 페이지가 소유하는 settings 문서에 저장합니다.

- 온라인 강좌 기준값: `settings/courseCatalog`
- 오프라인 반 기준값: `settings/offlineClassCatalog`
- 공개 시간표 그룹·학교급·이미지: `settings/timetableCatalog`
- 강사 과목 기준값과 강사진 노출 설정: `settings/instructorsMenu`

직접 입력값은 개별 `courses`, `offlineClasses`, `instructors` 문서에만 저장되며 settings catalog나 필터 후보에 자동 추가되지 않습니다. `"전체"`, `"all"`, `"선택"`, `"직접 입력"`, `"목록에 없음"` 같은 예약값은 기준값으로 저장하지 않습니다. 삭제된 기준값을 쓰는 기존 문서는 삭제하지 않고 현재 저장값으로 표시합니다.

레거시(삭제 대상, 앱 미사용):

- `intro`, `introDetail`, `intro_detail`, `content_html`
- `poster`, `posters`, `postersEnabled`
- `textbooks`, `classes`, `order`
- `highlights`, `youtube_id` (문서 최상위)
- `profilePhoto`, `video`, `youtube_url` (삭제됨; `photo` / `videos[]` 단일화)
- `imageUrl`, `profileImageUrl` 등 옛 이미지 alias
- `videos[].youtube_url`

### `instructorAccounts/{uid}`

강사 로그인 계정입니다. `instructors`와 분리되어 Auth uid 기준으로 관리합니다.

권장 필드:

- `uid`
- `email`
- `name`
- `instructorId`
- `status`
- `createdAt`
- `updatedAt`

## 5. Online Course Collections

### `courses/{courseId}`

온라인 강의 source-of-truth입니다.

중요:

- 상태·visibility·accessType과 관계없이 공개 get/list가 허용됩니다.
- 공개 페이지, 학생/회원 강의 상세, 강사 대시보드에서 읽습니다.
- 기존 강좌의 주차별 학습 URL은 `weeks[].videos[].url`에 저장되므로 직접 Firestore read에도 공개됩니다. UI의 published/public/memberOnly 필터는 보안 경계가 아닙니다. 신규 승인형 강좌는 공개 문서의 `weeks: []`, `previewVideoUrl: null`을 유지하고 실제 영상을 `coursePrivateContent`로 분리합니다.

권장 필드:

- `title`
- `shortDescription`
- `description`
- `subject` (온라인 과목 내부 value 또는 직접 입력 문자열)
- `grade`
- `year`
- `instructorUid`
- `instructorId`
- `instructorName`
- `instructorUids`
- `instructorIds`
- `instructorNames`
- `status`
- `accessType`
- `visibility`
- `weeks` (`[{ title, description, videos: [{ title?, url }] }]`)
- `previewVideoUrl`
- `courseFormat`
- `detailSections` (기존 상세 섹션이 있는 문서의 읽기/수정 호환)
- `createdAt`
- `updatedAt`

운영 기준:

- 온라인 강좌 과목/학년/연도 기준값은 `settings/courseCatalog.chipGroups.subject`, `chipGroups.grade`, `chipGroups.year`를 사용합니다.
- `courses.subject`는 기준 과목의 내부 `value` 또는 강좌별 직접 입력 문자열일 수 있습니다.
- 직접 입력한 과목/학년/연도는 해당 `courses/{courseId}` 문서에만 저장되고 `settings/courseCatalog`나 공개/관리 필터 후보에 자동 추가되지 않습니다.
- 기존 `courses` 문서는 일괄 마이그레이션하지 않습니다. 삭제된 과목 식별값을 쓰는 기존 강좌는 fallback label로 표시합니다.
- 신규 CMS 저장에서는 `lectureContent`를 쓰지 않습니다. 기존 DB의 `lectureContent`/`learningContent` 필드는 삭제하거나 마이그레이션하지 않고 읽기 호환만 유지합니다.
- `slug`, `teacherName`, `published`, `archived`, `thumbnailUrl`, `curriculumWeeks`, `totalLessons`, `durationMinutes`는 현재 강좌 기본 저장 payload의 canonical 필드가 아닙니다. 기존 문서에 남아 있으면 읽기 호환 여부를 확인한 뒤 정리합니다.

### `coursePrivateContent/{courseId}` (2026-10-17 운영 배포)

신규 `approvalRequired` 강좌의 `weeks` 및 `previewVideoUrl`을 저장합니다. 문서 ID는 공개 `courses/{courseId}`와 같습니다. 관리자, `courses/{courseId}`에 배정된 강사, 또는 게시된 승인형 강좌에 활성 `{uid}_{courseId}` enrollment가 있는 학생·일반회원만 단일 문서를 읽을 수 있습니다. 강사 조회는 `instructorAccounts`와 강좌의 UID/프로필 ID 배정 필드로 확인합니다. 목록 조회는 허용하지 않습니다. 학부모에게는 수강 신청·관리자 직접 활성 등록·보호 영상 읽기를 허용하지 않습니다. 기존 강좌는 일괄 이전하지 않습니다.

2026-10-17 긴급 수정: 저장된 `courses.accessType`은 관리자 수정에도 불변이며 신규 생성에서만 선택합니다. 승인 필요 강좌는 공개 문서와 이 보호 문서를 한 batch로 생성·수정합니다. 영구 삭제 시 같은 ID의 보호 문서, `courses/{courseId}/enrollmentRequests`, `enrollments.courseId == courseId`의 수강·진도 문서와 강좌를 한 batch로 삭제합니다. 450 write 범위를 넘는 경우 삭제를 실행하지 않습니다. 변경 Rules와 정적 사이트(코드 `ca795644`, 빌드 `20261017-092728`)를 배포했습니다. 합성 강좌 `XTPC2FPRQ9HtKIiXE4Ad`의 재생목록 URL은 공개 문서에 없고 보호 문서에만 있었으며, 보관 후 보호 문서 1건·신청 0건·수강/진도 0건을 확인해 UI에서 강좌와 보호 문서를 삭제했습니다. 두 문서의 404를 확인했습니다. 기존 강좌·실수강생 데이터는 변경하지 않았습니다. 마지막 조회와 batch 사이의 동시 쓰기 및 알려지지 않은 외부 참조는 클라이언트 삭제의 남은 한계입니다.

### `courses/{courseId}/enrollmentRequests/{uid}` (2026-10-17 운영 배포)

학생·일반회원의 본인 신청 문서입니다. ID는 신청자 UID입니다. `courseId`, `userId`, `learnerType` (`student`/`member`), `status: pending`, `createdAt`, `updatedAt`으로 생성하고, 관리자가 `approved` 또는 `rejected`와 `reviewedBy`, `reviewedAt`, `updatedAt`을 기록합니다. 거절 후 자동 재신청은 허용하지 않습니다. 관리자의 직접 등록에는 신청 문서가 없어도 됩니다. 승인할 때 신청 상태와 `{uid}_{courseId}` enrollment는 한 transaction에서 갱신합니다. 기존 enrollment의 `progress`와 `watchedVideos`는 병합 저장으로 보존하며, 해제는 `status: revoked`로 기록합니다.

### `enrollments/{enrollmentId}`

학생 또는 일반 회원의 온라인 강의 수강 연결입니다.

문서 ID:

- `{userId}_{courseId}`

권장 필드:

- `userId`
- `courseId`
- `status`
- `progress`
- `watchedVideos`
- `learnerType` (`student` | `member`)
- `learnerSnapshot`
- `studentSnapshot` (학생 수강만 사용)
- `createdAt`
- `updatedAt`

`learnerSnapshot`은 `name`, `email`, `phone`, `type`, `school`, `grade`를 저장합니다. 학생은 `school`, `grade`를 문자열로 저장하고 `studentSnapshot`도 함께 사용합니다. 일반 회원은 `school`, `grade`를 `null`로 저장합니다. 기존 회원전용 신규 수강신청은 `status: "active"`, `progress: 0`으로 생성합니다. 학습 중에는 `progress`, `watchedVideos`, `updatedAt`이 갱신됩니다. 회원 전용 강좌의 수강취소는 enrollment 문서를 삭제합니다. 배포 전 로컬 구현의 승인형 강좌는 관리자 승인·직접 등록으로만 활성화되며, 해제 시 `status: revoked`로 진도를 보존합니다.

2026-10-20 이후 대시보드의 표시 완료율은 저장된 `progress` 대신 현재 `weeks[].videos[]`와 `watchedVideos`의 교집합으로 계산합니다. `progress`는 마지막 완료 저장 시점의 값이며 강좌 편집 후에는 낡을 수 있습니다. 관리자 강좌 저장은 `weeks[].id`, `weeks[].videos[].id`를 유지하고, 기존 영상에는 이전 위치 기반 완료 ID를 `weeks[].videos[].completionId`로 고정합니다. 새로 추가한 영상의 `completionId`는 고유 ID이므로 삭제된 영상의 위치를 재사용해도 이전 완료 기록을 물려받지 않습니다. 기존 문서를 일괄 수정하지 않으며, 편집하지 않은 legacy 영상은 기존 위치 기반 ID를 그대로 읽습니다. 승인형의 `completionId`는 영상과 함께 `coursePrivateContent`에만 저장합니다.

관리자 삭제/강의 삭제 시 관련 enrollment cleanup을 확인해야 합니다.

## 6. Offline Class Collections

### `offlineClasses/{classId}`

오프라인 반 source-of-truth입니다.

권장 필드:

- `className`
- `subject`
- `grade`
- `school`
- `schools`
- `instructorUid`
- `instructorId`
- `instructorName`
- `instructorUids`
- `instructorIds`
- `instructorNames`
- `scheduleItems` (`day`, `startTime`, `endTime`, `room`)
- `clinicScheduleItems` (`day`, `startTime`, `endTime`, `room`)
- `scheduleDays`, `startTime`, `endTime`, `room` (읽기 호환 요약값)
- `scheduleVisible`
- `description`
- `groupId` (`regular` | `winter` | `summer` 등. 없으면 `regular` fallback)
- `status` (`active` | `archived`)
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`

`scheduleVisible`은 반 자체의 일정 표시값입니다. `groupId`는 정규/윈터/썸머 등 그룹 구분용이며 `offlineClassMembers`/`offlineClassSessions`/`offlineSessionAccess`에는 저장하지 않습니다. 공개 시간표는 `settings/timetableCatalog`의 그룹별 이미지이므로 오프라인 반과 live sync가 아닙니다.

### `offlineClassMembers/{classId}_{studentUid}`

오프라인 반과 학생의 연결입니다.

권장 필드:

- `classId`
- `studentUid`
- `studentNameSnapshot`
- `schoolSnapshot`
- `gradeSnapshot`
- `phoneSnapshot`
- `status` (`active`)
- `joinedAt`
- `createdAt`
- `updatedAt`

신규 배정은 `{classId}_{studentUid}` 문서 ID와 `status: "active"`를 사용합니다. 학생을 반에서 제거할 때는 배정 문서를 삭제하며, 같은 `classId`와 `studentUid`를 가진 `offlineSessionAccess` 문서도 함께 삭제합니다. 제거 후 학생 목록과 반 상세 접근에서 제외됩니다.

관리자 학생 관리에서 이름·학교·학년·전화번호를 수정하면 `students/{uid}`와 해당 UID의 기존 `offlineClassMembers` 스냅샷 중 달라진 문서를 하나의 atomic batch로 함께 갱신합니다. 학생 본인의 프로필 수정은 `offlineClassMembers` 관리자 쓰기 권한을 확장하지 않으므로 이 동기화 대상이 아닙니다.

### `offlineClassSessions/{sessionId}`

오프라인 반 회차입니다.

권장 필드:

- `classId`
- `sessionNo`
- `title`
- `sessionDate`
- `description`
- `hasVideo`
- `videos` (`[{ title, url }]`)
- `videoUrl` (첫 영상 URL 읽기 호환)
- `status` (`draft` | `published` | `archived`)
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`

Current writer facts:

- New session documents use Firestore auto-IDs from `addDoc`; `sessionNo` and `sessionDate` are not document IDs.
- The administrator form is the only current session creator. There is no scheduled session generator.
- `sessionDate` is a date string, normally `YYYY-MM-DD`, not a Firestore timestamp.
- The current form writes `published` or `archived`; `draft` remains a legacy/read-compatible value.
- `videos[]` and `videoUrl` store HTTP(S) URL metadata only, not video bytes.

### `offlineSessionAccess/{sessionId}_{studentUid}`

학생별 오프라인 회차 접근 상태입니다.

권장 필드:

- `classId`
- `sessionId`
- `studentUid`
- `status` (`active` | `revoked`)
- `type` (`manualGrant` | `manualRevoke`)
- `source` (`manual`)
- `grantedAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

Current cardinality and absence semantics:

- This collection stores sparse manual exceptions, not one document for every student/session pair. Default `joinedAt` access creates no document.
- The intended maximum is one canonical `{sessionId}_{studentUid}` document per student/session pair. Legacy duplicate IDs can temporarily exceed that until the pair is saved again.
- Deleting a revoke can restore post-join UI visibility; deleting a grant can remove pre-join UI visibility. Either deletion erases explicit authorization evidence, while current Rules ignore access-document presence.
- There is no canonical `archived`, `expired`, or `deleted` access status. Unknown or absent status falls back to the `joinedAt` UI calculation.

학생 반 상세 화면의 회차 노출 우선순위는 다음과 같습니다.

1. `type: "manualRevoke"`와 함께 저장된 `status: "revoked"`이면 숨김
2. `type: "manualGrant"`와 함께 저장된 `status: "active"`이면 표시
3. 예외 문서가 없으면 `sessionDate >= offlineClassMembers.joinedAt`인 게시 회차 표시

관리 UI는 동일 학생/회차의 문서를 `{sessionId}_{studentUid}` 형식으로 정규화하고 기존 중복 예외 문서를 정리합니다.

현재 Rules는 위 UI 노출 우선순위를 강제하지 않습니다. active 반 배정 학생이면 모든 published session을 읽을 수 있으므로 `joinedAt` 이전 및 manual revoke 회차의 영상 URL도 직접 read 가능합니다. 이는 `Confirmed defect`이며, 현재 UI와 grant/revoke UX를 보존하는 접근 projection이 필요합니다.

## 7. Public Site Collections

### `publicTimetableEntries/{entryId}`

deprecated cleanup-only 데이터입니다. 현재 Rules는 admin read/delete만 허용하고 create/update와 public read를 막습니다. 신규 schema나 공개 시간표 CRUD에 사용하지 않습니다. 공개/관리 시간표의 source-of-truth는 `settings/timetableCatalog`입니다.

### `pages/{slug}`

공개 페이지 콘텐츠를 저장합니다. Firestore rules 기준 공개 read, 관리자 write입니다. 공개 페이지에서 직접 읽히므로 민감 정보, private URL, signed URL, 내부 자료 key를 저장하지 않습니다.

주요 문서:

- `pages/story`
- `pages/contact`
- `pages/dday`

#### `pages/story`

학원 안내(`story.html`) CMS 콘텐츠입니다. `story.html`은 CMS가 직접 수정하는 파일이 아니라 정적 shell/fallback이며, 공개 렌더링 우선순위는 `version === 2`, legacy `content`, HTML fallback입니다.

v2 권장 구조:

```js
{
  slug: "story",
  version: 2,
  pageTitle: "그릿에듀 학원 안내",
  heroImageUrl,
  heroImageAlt,
  greeting: {
    title,
    subtitle,
    body,
    signatureTitle,
    signatureName,
    ceoImageUrl,
    ceoImageAlt
  },
  gritValues: [
    { letter: "G", word: "Growth", title },
    { letter: "R", word: "Resilience", title },
    { letter: "I", word: "Integrity", title },
    { letter: "T", word: "Tenacity", title }
  ],
  closingLine1,
  closingLine2,
  updatedAt
}
```

자동/고정값:

- `slug: "story"`
- `version: 2`
- `pageTitle: "그릿에듀 학원 안내"`
- `heroImageAlt: "그릿에듀 강사진 단체 이미지"`
- `greeting.ceoImageAlt: "그릿에듀 대표이사 유홍석"`
- `gritValues[].letter`
- `gritValues[].word`

Story image URL:

- 공식 지원: `https://assets.gritedu.kr/public/story/...`
- 필요 시 허용: `https://assets.gritedu.kr/public/pages/story/...`
- 허용 확장자: `.jpg`, `.jpeg`, `.png`, `.webp`
- 같은 파일명 덮어쓰기보다 versioned filename 사용 권장
- private 자료/리포트/PDF/과제 URL 저장 금지

legacy/중복 필드 정리:

- `closingMessage`
- `greeting.signature`
- `greeting.ceoTitle`
- `greeting.ceoName`
- `content`
- `structure`
- `lead`
- `gritValues[].body`

위 필드는 콘솔에서 수동 삭제할 필요 없이 CMS에서 한 번 저장하면 delete payload로 정리됩니다. 다만 legacy `content` fallback 자체가 코드에서 완전히 제거된 것은 아니므로 과거 문서 호환 정책은 남아 있습니다.

#### `pages/contact`

상담 문의(`contact.html`) CMS 콘텐츠입니다. 공개 페이지 제목은 코드에서 「상담 문의」로 고정합니다. 공개 렌더링은 `structure.locations[]` canonical 구조를 우선하며, pre-migration DB용 legacy `content` fallback만 최소 유지합니다.

저장 구조(canonical):

```js
{
  slug: "contact",
  structure: {
    locations: [
      {
        label,
        phone,
        messageLines: ["문구1", "문구2"], // 최대 3줄, 빈 줄은 저장하지 않음
        onlineBookingUrl,
        hours,
        address,
        mapEmbedQuery,
        mapIframeSrc,
        mapLinks: { naver, google, kakao },
        transportItems: [
          {
            id,
            type, // walking | subway | bus | car | custom
            label, // type에서 자동 생성 (도보/지하철/버스/차량/기타)
            text,
            sortOrder
          }
        ]
      }
    ]
  },
  updatedAt
}
```

저장하지 않는 legacy 필드:

- 문서: `content`
- structure: `pageTitle`, `phone`, `phoneNote`, `callableHours`, `hours`, `address`, `directions`, `extraNotes`, `content`, top-level `mapLinks`, `transportation`
- location: `phoneNote`, `callableHours`, `transportation`
- transportItem: `lines`

관리자 load 시에만 legacy 값(`phoneNote`, `callableHours`, `transportation.*`, `transportItems[].lines`)을 canonical draft로 이관합니다. 저장은 `setDoc` overwrite로 canonical payload만 남깁니다.

Contact CMS는 이미지/R2 입력 필드가 아니라 텍스트, URL, 지도, 교통 정보 중심입니다. story/contact HTML 본문 이미지 첨부와 파일 업로드는 차단되어 있습니다. Firebase Storage와 Contact용 R2 public prefix 추가는 없습니다.

### `settings/{doc}`

사이트/관리자 설정입니다.

주요 doc:

- `signup`
- `coursesMenu`
- `instructorsMenu`
- `subjectColors`
- `courseCatalog`
- `offlineClassCatalog`
- `timetableCatalog`
- `popups`
- `kakaoChannel`
- `footer`
- `tuitionImages`
- `retentionPolicy`

일부 settings는 공개 페이지에서 읽습니다. 공개 settings에는 민감 정보를 저장하지 않습니다.

#### `settings/subjectColors`

강사·온라인 강좌·오프라인 반의 페이지별 과목 기준값과 분리된 공용 색상 source-of-truth입니다.

- `subjectColorMap`: 과목 표시명을 key, CSS hex 색상을 value로 갖는 공용 맵
- `version`: 현재 스키마 버전
- `updatedAt`, `updatedBy`

학원 브랜드 주황색 계열(`#fd7e14`, `#f68b1f`, `#ff7a00`)은 과목 색상으로 저장하지 않습니다. 기존 주황색 값은 읽기/전환 시 제외하며 `약술형논술`은 `#6610f2`를 기본값으로 사용합니다.

최초 전환용 `scripts/migrate-subject-colors.js`가 `settings/instructorsMenu.subjects`, `settings/courseCatalog.chipGroups.subject`, `settings/offlineClassCatalog.groupCatalogs.*.subjects`를 한 번 통합합니다. 이후 각 관리 페이지의 과목 목록 저장은 현재 페이지에서 새로 생긴 이름만 공용 맵에 보충해 같은 이름에는 기존 색상을 유지하고 새 이름에만 미사용 색상을 배정합니다. 직접 입력값은 해당 페이지의 기준값에 추가되지 않는 한 공용 색상 맵을 확장하지 않습니다. 기존 `instructorsMenu`, `courseCatalog`, `offlineClassCatalog`, `timetableCatalog`에 남은 `subjectColorMap`/`subjectMeta`는 해당 문서 저장 또는 migration에서 제거합니다. 스크립트는 dry-run이 기본이며, 새 코드와 규칙을 배포한 뒤 `--write`로 적용합니다.

런타임은 Cloud Functions나 예약 작업을 사용하지 않습니다. 공용 색상 문서는 브라우저 세션 캐시로 재사용하고 카드/배지별 read를 만들지 않습니다. 관리자 목록 저장은 현재 catalog 문서 1 write를 기본으로 하며, 계산된 색상 맵이 저장된 맵과 다를 때만 `settings/subjectColors` 1 write를 같은 batch에 추가합니다. 다른 catalog의 legacy 필드는 매 저장마다 교차 갱신하지 않고 해당 문서 저장 또는 일회성 migration에서 정리합니다.

#### `settings/courseCatalog`

온라인 강좌 기준값입니다.

권장 필드:

- `chipGroups.subject`: 온라인 강좌 과목 내부 `value`와 화면 `label`. 관리자 UI에서는 과목명(label) 중심으로 관리하며, 신규 과목 식별값은 `CUSTOM_001`, `CUSTOM_002` 형식으로 자동 생성합니다.
- `chipGroups.grade`: 온라인 강좌 학년 라벨.
- `chipGroups.year`: 온라인 강좌 연도 라벨.
- `instructorSubjectChips`: legacy/stale. 공개 강사진 필터는 `settings/instructorsMenu.subjects`를 사용합니다.
- `updatedAt`, `updatedBy`

화면은 label 중심으로 표시하고, 저장값은 과목 value 또는 직접 입력 문자열을 사용합니다. 관리자가 과목 식별값을 직접 지정하는 UI는 없습니다. 기본 온라인 과목 value(`KOR`, `ENG`, `MATH`, `SCI`, `ESSAY`, `ETC`)도 기준값 목록에서 삭제할 수 있습니다.

`"전체"`, `"all"`, `"선택"`, `"직접 입력"`, `"목록에 없음"` 같은 예약값은 기준값이 아닙니다. `"전체"`는 공개/관리 필터 렌더링 단계에서만 가상 option으로 추가합니다.

직접 입력한 과목/학년/연도는 `courses/{courseId}` 문서에만 저장되며 `courseCatalog`와 필터 후보에 자동 추가되지 않습니다.

#### `settings/timetableCatalog`

공개 시간표의 그룹·학교급·그룹별 이미지 설정입니다.

권장 필드:

- `scheduleGroups[]` (정규/윈터/썸머 등 시간표·오프라인 반 그룹. 최대 3개, `regular` reserved/삭제 불가)
- `scheduleDivisions[]` (학교급 key/label/노출/순서)
- `groupCatalogs` (그룹별 시간표 이미지 맵. key = `groupId`)
- `updatedAt`, `updatedBy`

미사용 legacy top-level 필드(CMS 저장 시 자동 삭제, 신규 저장 금지):

- `subjects`, `grades`, `schools`, `classrooms`, `scheduleImages`
- `subjectMeta`, `subjectColorMap`, `version`

`groupCatalogs[groupId]` 권장 필드:

```js
{
  scheduleImages: [{ name, url, division }]
}
```

이미지는 `groupCatalogs[groupId].scheduleImages`를 정확히 읽습니다. `regular`에 한해서만 배포 전 기존 문서 호환용 최상위 `scheduleImages` 읽기 fallback이 남아 있지만 신규 저장은 하지 않습니다.

공개 `/schedule-images` 경로: `dist/schedule-images.html` + Cloudflare `_redirects`(` /schedule-images → schedule-images.html 200`). 가능하면 `dist/schedule-images/index.html`도 함께 생성.

`scheduleItems`는 빈 배열 허용(수업 일정 선택 입력).

관리자 CMS 저장 동작 (2026-07-27):

- 그룹/학교급 저장은 `scheduleGroups`, `scheduleDivisions`, 유효한 `groupCatalogs`만 유지합니다.
- 이미지 저장은 `updateDoc`으로 `groupCatalogs.{groupId}.scheduleImages`에 직접 씁니다.
- 저장 후 관리자 화면은 Firestore 서버 최신값(`getDocFromServer`)으로 catalog를 다시 불러옵니다.
- 위 legacy top-level 필드는 `deleteField`로 제거합니다.

`scheduleGroups[]` 항목:

```js
{
  id, // slug. regular reserved
  label,
  type, // regular | seasonal
  active,
  sortOrder,
  startDate, // optional, UI 비노출·내부 저장만
  endDate // optional, UI 비노출·내부 저장만
}
```

관리자 그룹 UI는 이름·노출(노출/숨김)·순서만 편집합니다. ID/시작일/종료일/type은 UI에 노출하지 않습니다.

공개 시간표는 이 문서만 사용하며 deprecated `publicTimetableEntries`를 병합하지 않습니다.

#### `settings/offlineClassCatalog`

오프라인 반 추가·수정 모달의 그룹별 과목·학년·학교 선택 목록입니다. 관리자 전용 읽기/쓰기 문서입니다.

권장 필드:

- `groupCatalogs`
- `updatedAt`, `updatedBy`

```js
{
  groupCatalogs: {
    regular: {
      subjects: [],
      grades: [],
      schools: []
    },
    summer: {
      subjects: [],
      grades: [],
      schools: []
    },
    winter: {
      subjects: [],
      grades: [],
      schools: []
    }
  }
}
```

최상위 `subjects`, `grades`, `schools`와 문자 그대로 된 `groupCatalogs.regular` 같은 필드는 legacy이며 저장 시 제거합니다. 과목·학년·학교 직접 입력값은 catalog에 자동 추가하지 않고 해당 `offlineClasses` 문서에만 저장합니다.

#### `settings/instructorsMenu`

강사진 노출 설정과 강사 과목 기준값입니다.

권장 필드:

- `subjects`: 강사 과목 기준값. 강사 관리, 계정 생성 관리, **공개 강사진 페이지 필터**가 공유합니다.
- `homeOrder`, `instructorsOrder`
- `homeHidden`, `instructorsHidden`
- `detailSections`
- `updatedAt`, `updatedBy`

공개 강사진 페이지의 `"전체"` 필터는 Firestore 기준값이 아니라 렌더링 단계에서 추가되는 가상 필터입니다.

하위호환:

- `subjectOptions`, `order`, `hidden` 읽기 fallback은 남아 있지만 운영 문서에서는 삭제됐으며 관리자 저장 시 재생성하지 않습니다.
- 강사 문서의 `subject` 단일값은 대표 과목으로 유지하고, 복수 과목은 `subjects[]`를 우선합니다.

#### `settings/signup`

회원가입 on/off 정책입니다. 기준값 catalog와 병합하지 않습니다.

권장 필드:

- `enabled`
- `studentEnabled`
- `memberEnabled`
- `updatedAt`

#### `settings/popups`

팝업 설정입니다. 기준값 catalog와 병합하지 않습니다.

권장 필드:

- `popups[]`
- `updatedAt`

각 `popups[]` 항목:

- `id`, `title`, `enabled`, `startAt`, `endAt`, `imageUrl` (선택. 팝업 이미지 1개)
- `textItems[]` (2026-07-06): 문구별 URL/정렬/사용 여부. 공개 렌더링 우선
- legacy fallback: `content`, `contentLinkUrl` (textItems가 없거나 비어 있을 때)

표시 유형:

- 이미지만: `imageUrl`만 있어도 표시
- 문구만: enabled `textItems`(또는 legacy `content`)만 있어도 표시
- 혼합: 이미지 + 문구 동시 표시 가능. 활성 팝업 여러 개는 위치별 스택

`textItems[]` 구조:

```js
{
  id,
  text,
  linkUrl, // 선택. 내부 경로(/) 또는 https://
  align, // left | center | right
  sortOrder,
  enabled // false면 렌더 제외
}
```

공개 렌더링은 enabled `textItems`를 sortOrder 기준으로 우선 표시합니다. 팝업 이미지는 기존 R2 `public/popup/` 정책을 유지합니다. 긴 문구/모바일 overflow 방지 CSS가 적용됩니다.

#### `settings/kakaoChannel`

카카오톡 채널 플로팅 링크 설정입니다. 관리자 CMS `사이트 관리 -> 카카오톡 채널`에서 저장하고, 공개 페이지가 로드 시 1회 읽습니다. localStorage/sessionStorage cache를 새로 만들지 않습니다.

권장 필드:

- `enabled`: true일 때만 공개 렌더링 후보가 됩니다.
- `url`: `https://pf.kakao.com/...` 형식의 URL. `/chat` 자동 추가나 URL 변형 없이 저장값 그대로 링크 `href`에 사용합니다.
- `buttonLabel`: 선택 문구. 빈 문자열이나 공백 문자열이면 공개 버튼은 텍스트 없이 SVG 아이콘만 표시합니다.
- `visiblePages.home`: `/`, `index.html`
- `visiblePages.story`: `story.html`
- `visiblePages.schedule`: `schedule.html`
- `visiblePages.contact`: `contact.html`
- `visiblePages.instructors`: `instructors.html`
- `visiblePages.courses`: `courses.html`
- `updatedAt`, `updatedBy`

검증/보안 기준:

- 허용 도메인은 `https://pf.kakao.com/`뿐입니다.
- `http://`, `javascript:`, `data:`, `blob:`, 타 도메인은 저장과 공개 렌더링에서 차단합니다.
- `enabled === true`인데 URL이 비어 있거나 invalid이면 저장과 렌더링을 차단합니다.
- Firestore rules는 이 문서만 공개 read, 관리자 write로 열고 전체 `settings/{doc}` catch-all은 관리자 read/write를 유지합니다.

#### `settings/footer`

공개 footer 사업자·연락처·SNS 설정입니다.

- `companyName`
- `businessNumber`
- `representative`
- `phone`
- `address`
- `instagramUrl`, `youtubeUrl`, `blogUrl` (입력된 경우 `https://` URL)
- `updatedAt`, `updatedBy`

Rules는 공개 read와 관리자 write를 허용합니다. 공개 클라이언트는 이 비민감 설정 1건만 memory + `sessionStorage`에 최대 5분 보관하며, 관리자 저장은 현재 탭 cache를 무효화합니다. 문서 없음/읽기 오류 시 정적 footer HTML fallback을 유지합니다.

#### `settings/tuitionImages`

학원정보조회·교습비·환불규정 공개 페이지에 표시할 R2 이미지 목록입니다. 관리자 CMS `사이트 관리 -> 푸터 정보`에서 관리하고 공개 `tuition.html`이 읽습니다.

```js
{
  academy: ["https://assets.gritedu.kr/public/footer/aca.png"],
  fee: [
    "https://assets.gritedu.kr/public/footer/fee1.png",
    "https://assets.gritedu.kr/public/footer/fee2.png"
  ],
  refund: ["https://assets.gritedu.kr/public/footer/refund.png"],
  updatedAt,
  updatedBy
}
```

- `academy`, `fee`, `refund`는 저장 순서가 공개 표시 순서인 URL 배열입니다.
- `https://assets.gritedu.kr/public/footer/` 아래의 PNG/JPG/JPEG/WebP만 허용합니다.
- 중복 URL과 다른 도메인·prefix·확장자는 CMS와 공개 렌더러에서 거부합니다.
- 관리자 write, 공개 read만 허용합니다.
- R2 직접 업로드, Secret, S3 SDK, Firebase Storage는 이 흐름에서 사용하지 않습니다.

#### `settings/retentionPolicy`

The administrator operation center reads this document only to display the current scheduled-cleanup summary. Historical offline-retention fields may remain as compatibility data, but the UI no longer reads, displays, or writes them. The scheduler writes only its last-run transient cleanup summary here.

Historical compatibility fields, not active UI or server deletion policy:

- `offlineSessionCleanupEnabled`: false면 오프라인 회차 정리를 건너뜁니다.
- `offlineSessionDryRun`: true면 삭제하지 않고 대상만 기록합니다. false면 실제 삭제. 기본 false(실제 삭제).
- `offlineSessionRetentionDays`: `offlineClassSessions.sessionDate` 기준 보존일. 기본 180(약 6개월).
- `offlineSessionStatuses`: 정리 대상 status 배열. 기본 `["published", "archived"]`.
- `offlineSessionPerRunLimit`: 1회 실행 최대 회차 수. 기본 200.
- `offlineSessionSkipActiveAccess`: true면 `offlineSessionAccess.status == "active"`가 있는 회차는 skip.
- `offlineSessionLastRunAt`, `offlineSessionLastRunSummary`: stale historical fields after Phase 2A unless another approved process updates them.
- `updatedAt`, `updatedBy`
- `recordCleanupLastRunAt`, `recordCleanupLastRunSummary`: current scheduler summary for the three transient collections.

The administrator status page performs no offline session/access query or client write. `offlineClassSessions`, `offlineSessionAccess`, `offlineClasses`, `offlineClassMembers`, `enrollments`, and `studentParentLinks` are outside automatic cleanup. No Firestore TTL policy is used.

## 8. Operation And Signup Support

### `operationTasks/{taskId}`

Legacy 운영 task 문서입니다. 팝업 이미지 정리용 task 생성 로직은 제거되었고, 현재 운영 기록 정리 센터의 정리 대상에도 포함하지 않습니다.

운영 기준:

- 신규 `operationTasks` 생성은 하지 않습니다.
- 자동 `scheduledRecordCleanup`은 `operationTasks`를 삭제하지 않습니다.
- 기존 pending/legacy 문서는 Firebase Console에서 1회 수동 정리 대상으로 봅니다.

권장 필드:

- `type`
- `title`
- `status`
- `targetCollection`
- `targetId`
- `createdAt`
- `updatedAt`
- `resolvedAt`

### `emailVerifications/{verificationId}`

이메일 인증 코드와 검증 상태입니다.

Current writer fields:

- `email`, `signupType`, `code`, `sessionTokenHash`
- `createdAt`, `expiresAt`, `cleanupAt`
- `used`, `failedAttempts`, `lastFailedAt`
- 성공/무효화 시 선택: `verifiedAt`, `invalidatedAt`, `invalidationReason`

주의:

- 클라이언트 직접 create/update는 허용하지 않습니다.
- Functions가 이메일별 canonical document 1개를 생성/검증합니다. 새 발송은 CSPRNG 코드와 새 verification-session token hash를 쓰고 `failedAttempts`를 reset하므로 이전 code/token pair는 재사용할 수 없습니다.
- raw session token은 callable response로만 전달되어 현재 가입 페이지 메모리에 유지되고 Firestore에는 SHA-256 hash만 저장됩니다. `verifyEmailCode`는 transaction 안에서 session, `used`, `expiresAt`, code, failed count를 검사하고 최대 5회 오답에서 해당 세션을 무효화합니다.
- 성공한 검증은 `used: true`, `verifiedAt`을 기록합니다. 학생/회원 self-create Rules는 Auth email, `signupType`, 최근 `verifiedAt`, 아직 도래하지 않은 `cleanupAt`을 이 문서와 결합합니다.
- 코드 유효시간은 5분이고 `cleanupAt`은 만료 24시간 후입니다. 이 완료 window는 Rules가 profile create의 서버 증표로 문서를 소비하므로 유지합니다.
- 관리자 read/delete는 운영 cleanup 목적입니다.
- Current administrator diagnostics does not read this collection. Firestore document reads cannot redact `code` or `sessionTokenHash`, so exposing only verification metadata would require a separately approved trusted projection/backend.

### `signupAttempts/{attemptId}`

가입/인증 시도 제한 보조 데이터입니다.

주의:

- Functions가 생성합니다.
- 관리자 read/delete는 운영 cleanup 목적입니다.
- 문서 ID는 Firestore Auto ID를 유지합니다. 생성 시각이나 정렬 순서를 document ID에서 해석하지 않고 `timestamp`를 source-of-truth로 사용합니다. Sequential/time-based ID로 바꾸지 않습니다.
- 2026-08-24 current writer는 `email`, server-observed `ip`(없으면 `unknown`), `timestamp`, `cleanupAt`만 저장하고 user agent나 client-supplied IP를 받지 않습니다.
- email은 rolling 1시간의 primary key(5회 허용 후 다음 요청 제한), IP는 shared IPv4/NAT를 고려한 auxiliary key(30회/시간)입니다. IPv6 변경으로 IP signal이 약해져도 email 제한이 유지됩니다.
- 새 attempt의 `cleanupAt`은 생성 1일 후입니다. 1시간 rolling window보다 길어 limiter 계산에 충분합니다. 현재 limiter는 legacy `blockedUntil`을 읽어 장기 block을 복원하지 않습니다. 기존 문서는 저장된 `cleanupAt`에 따라 보존되며 자동 backfill하지 않습니다.
- 운영 조회가 필요하면 exact email 또는 server-observed IP와 시간 범위를 사용하고 `timestamp desc`로 확인합니다. Auto ID lexical order를 시간순으로 간주하지 않으며, 별도 관리자 UI/index는 실제 운영 필요가 확인될 때만 승인합니다.
- Current member-admin detail reads `signupAttempts` only after an explicit button, using exact member email with limit 20, local timestamp sort, and a 10-card display cap. Document ID, server-observed IP, and cleanup time stay inside each card's collapsed details; no composite index is added. These records prove an accepted send request, not delivery success, login failure, or a specific OTP verification failure.
- 위 1일/no-user-agent writer와 session-token/Rules 결합은 coordinated `4d1a83d1` rollout으로 production에 배포됐습니다. Owner의 정상 signup smoke가 완료됐고 기존 attempt는 migration/delete하지 않으며 각 문서에 이미 저장된 `cleanupAt`을 따릅니다.

### 운영 기록 정리 정책

정책 기준 파일:

- `functions/record-cleanup.js` — the only scheduled cleanup target policy
- `assets/js/pages/admin-operation-tasks.js`

Current automatic cleanup:

- Function: `scheduledRecordCleanup` (단일 Cloud Scheduler job)
- Schedule: 매일 03:00 Asia/Seoul
- Three collections only: `emailVerifications`, `signupAttempts`, and `memberChildLinkAttempts`.
- Each query is `cleanupAt <= now`, ordered by `cleanupAt`, and limited to 500. All three reads finish before deletion starts.
- Each delete uses the scanned document `updateTime` as `lastUpdateTime`. If resend or another writer changes a canonical document after preflight, the batch aborts fail closed and a later scheduled run retries remaining due records.
- For these allowlisted collections, stored `cleanupAt` is the deletion source-of-truth. Legacy 30/90/180-day age checks do not delay a due document.
- Documents without `cleanupAt`, offline session/access records, business data, relationships, CMS, unknown data, and legacy data are not scanned or deleted automatically.

Current operation page:

- 화면: `members/admin/operation-tasks.html`
- Transient records: read-only display of the scheduler's last-run count summary; no current manual scan/delete handler
- Offline session: no settings form, preview, query, or deletion control; historical fields remain untouched compatibility data

| Collection | 정리 기준 |
| --- | --- |
| `emailVerifications` | Current writer: 5-minute validity, then `cleanupAt` 24 hours after expiry |
| `signupAttempts` | Current writer: 1 day after each accepted send attempt; no new week-long block document. Historical documents keep their stored `cleanupAt` |
| `memberChildLinkAttempts` | Current writer: failed/non-success 7 days, successful/already-linked 1 day; actual `studentParentLinks` are preserved |
| `offlineClassSessions` | 학습 이력. 현재 policy field는 inventory 대상이며 age/status 기반 자동 삭제 금지 |
| `offlineSessionAccess` | 권한 이력. session cascade 자동 삭제 금지 |
| `operationTasks` | legacy/orphan candidate. 자동/수동 cleanup 제외, owner inventory와 dependency proof 전 삭제 금지 |

## 9. Rules Summary

| 영역 | 권한 경계 |
| --- | --- |
| 공개 사이트 | `courses`, `instructors`, 일부 exact `settings`(`settings/timetableCatalog`, `settings/kakaoChannel` 포함), `pages`, legacy `arrangements`/`exam_contents` read |
| 본인 계정 | `students/{uid}`, `members/{uid}`, `instructorAccounts/{uid}` 제한 read/update |
| 관리자 | 관리자 CMS collection write |
| 강사 | 담당 강의/수강/오프라인 반 제한 read |
| 학생/회원 | 본인 수강/반 제한 read. 현재 offline published session은 joinedAt/manual revoke가 미강제 |
| Legacy | `users/*`, `changeHistory` deny |
| fallback | 명시되지 않은 문서 deny |

## 10. Data Governance Checklist

1. 새 기능은 Active Collections 중 하나를 사용합니다.
2. 공개 read collection에 민감 정보를 저장하지 않습니다.
3. 관리자 삭제 기능은 연결 collection cleanup 범위를 함께 확인합니다.
4. 공개 이미지 URL은 Firebase Storage URL이 아니라 `/assets/...` 경로 또는 허용된 R2 public URL을 사용합니다. Story 이미지는 `https://assets.gritedu.kr/public/story/` 또는 허용된 `public/pages/story/` prefix만 사용합니다.
5. private 자료, 리포트, 과제 첨부는 공개 URL이 아니라 향후 `provider`, `r2Key`, 권한 metadata, signed URL Function으로 설계합니다.
6. `scheduledRecordCleanup` manages expiring operational records, while the administrator page displays only its last-run summary. Automatic targets are limited to `emailVerifications`, `signupAttempts`, and `memberChildLinkAttempts`. No offline-session retention period is approved or configurable in the UI.
7. `users/*` 또는 `changeHistory`를 다시 도입하지 않습니다.
8. 공개 `instructors`에 email/phone/note/uid/pending을 신규 저장하지 않고 private account/metadata 분리를 우선합니다.
9. profile self-create는 OTP/UI 상태가 아니라 서버 증표와 Auth email을 Rules에 결합해야 합니다.
