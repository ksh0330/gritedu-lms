# Grit Edu LMS Firestore Schema

최종 갱신: 2026-07-06

## 1. 원칙

- Firestore rules가 클라이언트 권한의 최종 경계입니다.
- `courses`는 공개 읽기 가능하므로 민감한 비공개 영상 데이터, 결제 권한, DRM 토큰을 직접 저장하지 않습니다.
- 관리자 CMS는 canonical collection을 직접 관리합니다.
- 운영 기록 정리는 매일 03:00 실행되는 `scheduledRecordCleanup` Cloud Function과 관리자 수동 UI를 병행합니다. 수동 UI는 rules 기반 관리자 권한으로 제한합니다. 오프라인 회차 자동 정리 정책은 `settings/retentionPolicy`에서 CMS로 관리합니다.
- Legacy `users/*`와 `changeHistory`는 폐기되었으며 새 기능에서 사용하지 않습니다.
- 2026-07-06 기준 Story greeting panel overflow containment 보강, Contact 상담 문의는 `pages/contact` canonical 구조(`slug`, `structure.locations[]`, `updatedAt`)로 운영합니다.
- 2026-07-06 기준 Popup은 `settings/popups.popups[].textItems[]` 우선 렌더이며, **이미지만·문구만·혼합** 팝업을 지원합니다(`imageUrl` 없이 `textItems`만 있어도 표시).
- 2026-07-06 기준 시간표/오프라인 반 `groupId` + `settings/timetableCatalog.scheduleGroups[]`(정규/기간 탭, max 3) 지원. 그룹별 기준값은 `groupCatalogs[groupId]`(subjects/grades/schools/classrooms/scheduleImages). `regular`만 legacy top-level sync. `subjectMeta`/`subjectColorMap`/`version`은 미사용·CMS 저장 시 삭제. `gradeTabs`는 학년 필터용으로 별도 유지.
- 2026-07-06 기준 카카오톡 채널 플로팅 링크는 `settings/kakaoChannel`에서 관리합니다. SDK나 Kakao Developers 앱키 없이 `https://pf.kakao.com/...` URL 링크만 저장합니다.
- 중앙 운영 기준값 모델(`settings/operationCatalog`, 운영 기준값 탭, `operation-catalog.js`)은 폐기되었습니다. 기준값은 각 관리 페이지 책임에 맞는 settings 문서에서 관리합니다.

## 2. Active Collections

| Collection | 목적 | 주요 접근 |
| --- | --- | --- |
| `admins` | 관리자 권한/프로필 | 본인/관리자 read, 관리자 write |
| `students` | 학생 계정 프로필 | 본인/관리자 read, 관리자 중심 write |
| `members` | 일반 회원/학부모 회원 프로필 | 본인/관리자 read, 관리자/가입 flow write |
| `studentParentLinks` | 학생-회원 확정 연결 | 관리자 및 연결 당사자 read, 관리자 delete |
| `memberChildLinkAttempts` | 회원-자녀 연결 시도/요청 | 관리자 및 당사자 read, Functions/create flow |
| `instructors` | 강사 공개 프로필 | 공개 read, 관리자 write |
| `instructorAccounts` | 강사 로그인 계정 정보 | 본인/관리자 read, 관리자 write |
| `courses` | 온라인 강의 | 공개 read, 관리자 write |
| `enrollments` | 온라인 수강 연결 | 본인/관리자/담당 강사 제한 read, 관리자 및 허용된 사용자 write |
| `offlineClasses` | 오프라인 반 | 관리자/담당 강사/배정 학생 제한 read, 관리자 write |
| `offlineClassMembers` | 오프라인 반 학생 배정 | 관리자/담당 강사/해당 학생 제한 read, 관리자 write |
| `offlineClassSessions` | 오프라인 반 회차 | 관리자/담당 강사/접근 학생 제한 read, 관리자 write |
| `offlineSessionAccess` | 학생별 오프라인 회차 접근 | 관리자/담당 강사/해당 학생 제한 read, 관리자 write |
| `publicTimetableEntries` | 공개 시간표 | 공개 read, 관리자 write |
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
- `status`
- `marketingConsent`
- `createdAt`
- `updatedAt`

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

권장 필드:

- `studentUid`
- `memberUid`
- `status`
- `relationship`
- `createdAt`
- `updatedAt`

### `memberChildLinkAttempts/{attemptId}`

회원이 자녀 연결을 시도하거나 요청한 기록입니다.

권장 필드:

- `memberUid`
- `studentUid`
- `studentName`
- `status`
- `reason`
- `createdAt`
- `updatedAt`

### `instructors/{instructorId}`

공개 강사 프로필입니다. 공개 페이지와 관리자/강사 대시보드에서 사용합니다.

문서 ID는 `inst_<timestamp>` 형식을 사용하며, `instructorId` 필드에도 동일 값을 저장합니다.

권장 필드:

- `name`
- `subject`
- `subjects` (`string[]`; 복수 과목. `subject`는 대표 과목 하위호환 필드)
- `email`, `emailLower` (계정 연동·관리자 표시용)
- `note` (관리자 비고)
- `bio` (약력)
- `brief` (한줄소개)
- `photo` (프로필 이미지 URL)
- `curriculumImageUrl`, `curriculumImageUrls` — 강사 참고 자료 이미지 (legacy 필드명 유지, 배열 우선, 단일 URL은 첫 항목 fallback). 신규 R2 prefix: `public/instructors/image/`; legacy read-only: `public/instructors/curriculum/`
- `videos` (`{ url, fullUrl, id, title }[]`; 주 영상 데이터)
- `instructorId`
- `uid` (Auth 계정 연결 후)
- `pending` (`true` = 미연결 프로필)
- `createdAt`, `updatedAt`

노출 순서는 문서 `order`가 아니라 `settings/instructorsMenu`의 `instructorsOrder` / `homeOrder`를 사용합니다.

기준값은 중앙 문서가 아니라 각 관리 페이지가 소유하는 settings 문서에 저장합니다.

- 온라인 강좌 기준값: `settings/courseCatalog`
- 오프라인 반/공개 시간표 기준값: `settings/timetableCatalog`
- 강사 과목 기준값과 강사진 노출 설정: `settings/instructorsMenu`

직접 입력값은 개별 `courses`, `offlineClasses`, `publicTimetableEntries`, `instructors` 문서에만 저장되며 settings catalog나 필터 후보에 자동 추가되지 않습니다. `"전체"`, `"all"`, `"선택"`, `"직접 입력"`, `"목록에 없음"` 같은 예약값은 기준값으로 저장하지 않습니다. 삭제된 기준값을 쓰는 기존 문서는 삭제하지 않고 현재 저장값으로 표시합니다.

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

- 공개 read가 허용됩니다.
- 공개 페이지, 학생/회원 강의 상세, 강사 대시보드에서 읽습니다.
- 비공개 영상 원본, 결제 권한, DRM 토큰을 저장하지 않습니다.

권장 필드:

- `title`
- `slug`
- `shortDescription`
- `description`
- `subject` (온라인 과목 내부 value 또는 직접 입력 문자열)
- `grade`
- `year`
- `teacherName`
- `instructorUid`
- `instructorId`
- `instructorName`
- `instructorUids`
- `status`
- `accessType`
- `published`
- `archived`
- `thumbnailUrl`
- `curriculumWeeks`
- `weeks`
- `previewVideoUrl`
- `courseFormat`
- `totalLessons`
- `durationMinutes`
- `createdAt`
- `updatedAt`

운영 기준:

- 온라인 강좌 과목/학년/연도 기준값은 `settings/courseCatalog.chipGroups.subject`, `chipGroups.grade`, `chipGroups.year`를 사용합니다.
- `courses.subject`는 기준 과목의 내부 `value` 또는 강좌별 직접 입력 문자열일 수 있습니다.
- 직접 입력한 과목/학년/연도는 해당 `courses/{courseId}` 문서에만 저장되고 `settings/courseCatalog`나 공개/관리 필터 후보에 자동 추가되지 않습니다.
- 기존 `courses` 문서는 일괄 마이그레이션하지 않습니다. 삭제된 과목 식별값을 쓰는 기존 강좌는 fallback label로 표시합니다.
- 신규 CMS 저장에서는 `lectureContent`를 쓰지 않습니다. 기존 DB의 `lectureContent`/`learningContent` 필드는 삭제하거나 마이그레이션하지 않고 읽기 호환만 유지합니다.

### `enrollments/{enrollmentId}`

학생 또는 일반 회원의 온라인 강의 수강 연결입니다.

권장 필드:

- `userId`
- `courseId`
- `role`
- `status`
- `progress`
- `createdAt`
- `updatedAt`

관리자 삭제/강의 삭제 시 관련 enrollment cleanup을 확인해야 합니다.

## 6. Offline Class Collections

### `offlineClasses/{classId}`

오프라인 반 source-of-truth입니다.

권장 필드:

- `title`
- `subject`
- `grade`
- `instructorUid`
- `instructorId`
- `instructorName`
- `room`
- `dayOfWeek`
- `startTime`
- `endTime`
- `scheduleVisible`
- `groupId` (`regular` | `winter` | `summer` 등. 없으면 `regular` fallback)
- `status`
- `archived`
- `createdAt`
- `updatedAt`

`scheduleVisible`이 공개 시간표 반영 여부를 제어합니다. `groupId`는 정규/윈터/썸머 등 시간표 그룹 구분용이며 `offlineClassMembers`/`offlineClassSessions`/`offlineSessionAccess`에는 저장하지 않습니다. 공개 시간표는 `publicTimetableEntries`에 복사된 항목이므로 오프라인 반과 live sync가 아닙니다.

### `offlineClassMembers/{membershipId}`

오프라인 반과 학생의 연결입니다.

권장 필드:

- `classId`
- `studentUid`
- `studentName`
- `status`
- `joinedAt`
- `createdAt`
- `updatedAt`

### `offlineClassSessions/{sessionId}`

오프라인 반 회차입니다.

권장 필드:

- `classId`
- `title`
- `sessionDate`
- `startTime`
- `endTime`
- `materials`
- `status`
- `createdAt`
- `updatedAt`

### `offlineSessionAccess/{accessId}`

학생별 오프라인 회차 접근 상태입니다.

권장 필드:

- `classId`
- `sessionId`
- `studentUid`
- `status`
- `openedAt`
- `createdAt`
- `updatedAt`

## 7. Public Site Collections

### `publicTimetableEntries/{entryId}`

공개 시간표 전용 데이터입니다.

권장 필드:

- `classId`
- `title`
- `subject`
- `grade`
- `instructorName`
- `room`
- `dayOfWeek`
- `startTime`
- `endTime`
- `visible`
- `groupId` (없으면 `regular` fallback)
- `sortOrder`
- `updatedAt`

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
- `courseCatalog`
- `timetableCatalog`
- `popups`
- `kakaoChannel`

일부 settings는 공개 페이지에서 읽습니다. 공개 settings에는 민감 정보를 저장하지 않습니다.

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

오프라인 반 관리와 시간표 관리가 공유하는 기준값입니다.

권장 필드:

- `subjects`
- `grades`
- `schools`
- `classrooms`
- `scheduleGroups[]` (정규/윈터/썸머 등 시간표·오프라인 반 그룹. 최대 3개, `regular` reserved/삭제 불가)
- `groupCatalogs` (그룹별 기준값 맵. key = `groupId`)
- `gradeTabs` (학년 필터 UI용. `scheduleGroups`와 별개)
- `scheduleImages[]` (legacy top-level. `regular`/`groupCatalogs.regular` fallback)
- `updatedAt`, `updatedBy`

미사용 legacy 필드 (CMS 저장 시 자동 삭제, 신규 저장 금지):

- `subjectMeta`, `subjectColorMap`, `version` — 현재 코드에서 읽지 않음. 과목 색상 catalog는 미구현.

`groupCatalogs[groupId]` 권장 필드:

```js
{
  subjects: [],
  grades: [],
  schools: [],
  classrooms: [],
  scheduleImages: [{ name, url }]
}
```

읽기 fallback: `groupCatalogs[groupId]` → `groupCatalogs.regular` → legacy top-level `subjects/grades/schools/classrooms/scheduleImages`.

`scheduleImages` fallback: 그룹별 배열이 있으면 해당 그룹만 사용. 없으면 `regular` → legacy top-level.

공개 `/schedule-images` 경로: `dist/schedule-images.html` + Cloudflare `_redirects`(` /schedule-images → schedule-images.html 200`). 가능하면 `dist/schedule-images/index.html`도 함께 생성.

`scheduleItems`는 빈 배열 허용(수업 일정 선택 입력).

`regular` 기준값 저장 시 legacy top-level 필드도 함께 sync 가능(하위 호환).

관리자 CMS 저장 동작 (2026-07-06):

- 기준값·이미지·그룹 저장 시 `groupCatalogs`를 merge하고, `regular`일 때만 top-level catalog 필드를 sync합니다.
- 기준값 저장은 이미지 목록을 덮어쓰지 않습니다(이미지는 이미지 관리에서만 저장).
- 저장 후 관리자 화면은 Firestore 서버 최신값(`getDocFromServer`)으로 catalog를 다시 불러옵니다.
- 기준값 저장은 `updateDoc`으로 `groupCatalogs.{groupId}` dot-path에 직접 씁니다(정규는 top-level sync). 저장 직후 UI는 draft를 유지합니다.
- 위 미사용 legacy 필드는 `deleteField`로 제거합니다.

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

공개 시간표는 이 문서가 설정되어 있으면 `publicTimetableEntries`에서 유도한 값을 필터 후보에 자동 병합하지 않습니다.

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

- `order`, `hidden`은 legacy order/hidden fallback입니다.
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

운영 정리 센터(`members/admin/operation-tasks.html`)에서 관리하는 DB 보존/자동 정리 정책입니다. Functions `scheduledRecordCleanup`이 매일 실행 시 읽습니다. rules/hosting 재배포 없이 CMS 설정만으로 운영 조정이 가능합니다(Functions 코드 최초 배포 후).

권장 필드:

- `offlineSessionCleanupEnabled`: false면 오프라인 회차 정리를 건너뜁니다.
- `offlineSessionDryRun`: true면 삭제하지 않고 대상만 기록합니다. false면 실제 삭제. 기본 false(실제 삭제).
- `offlineSessionRetentionDays`: `offlineClassSessions.sessionDate` 기준 보존일. 기본 180(약 6개월).
- `offlineSessionStatuses`: 정리 대상 status 배열. 기본 `["published", "archived"]`.
- `offlineSessionPerRunLimit`: 1회 실행 최대 회차 수. 기본 200.
- `offlineSessionSkipActiveAccess`: true면 `offlineSessionAccess.status == "active"`가 있는 회차는 skip.
- `offlineSessionLastRunAt`, `offlineSessionLastRunSummary`: Functions가 마지막 실행 결과를 merge 저장.
- `updatedAt`, `updatedBy`

자동 정리 read 최적화:

- `sessionDate < cutoffDate` 쿼리 + `orderBy(sessionDate)` + `limit(perRunLimit × 3)` 후 status 메모리 필터.
- 전체 `offlineClassSessions` full scan을 하지 않습니다.
- CMS 미리보기는 버튼 클릭 시 최대 50건만 조회합니다.

오프라인 회차 정리 범위:

- 대상: `offlineClassSessions` (조건 충족 시) + 연결 `offlineSessionAccess` cascade delete
- 제외: `offlineClasses`, `offlineClassMembers`, `enrollments`, `studentParentLinks`
- TTL 필드/ Firestore TTL policy는 사용하지 않습니다.

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

주의:

- 클라이언트 직접 create/update는 허용하지 않습니다.
- Functions가 생성/검증합니다.
- 관리자 read/delete는 운영 cleanup 목적입니다.

### `signupAttempts/{attemptId}`

가입/인증 시도 제한 보조 데이터입니다.

주의:

- Functions가 생성합니다.
- 관리자 read/delete는 운영 cleanup 목적입니다.

### 운영 기록 정리 정책

정책 기준 파일:

- `functions/record-cleanup.js` — 이메일 인증/가입 시도/자녀 연동 시도
- `functions/offline-session-cleanup.js` — 오프라인 회차 (`settings/retentionPolicy` 기준)
- `assets/js/pages/admin-operation-tasks.js`

자동 정리:

- Function: `scheduledRecordCleanup` (단일 Cloud Scheduler job)
- Schedule: 매일 03:00 Asia/Seoul
- 운영 기록 3개 컬렉션: `cleanupAt <= now` 쿼리, 컬렉션당 최대 500건. `cleanupAt` 없는 legacy 문서는 매월 1일 호환 정리
- 오프라인 회차: `settings/retentionPolicy` 읽기 → `sessionDate` 쿼리(limit) 후 `offlineClassSessions` + cascade `offlineSessionAccess` (기본 180일, 게시/보관, 실제 삭제, 1회 200건)

수동 정리 UI:

- 화면: `members/admin/operation-tasks.html`
- 운영 기록: localStorage 30일 쿨다운, 컬렉션 3개 각 1회 조회, 컬렉션당 300건 삭제 상한
- 오프라인 회차: 설정 저장 + **정리 대상 확인(최대 50개)** 만 제공. 실제 삭제는 scheduled function 전담

| Collection | 정리 기준 |
| --- | --- |
| `emailVerifications` | 만료 또는 생성 후 7일 경과 |
| `signupAttempts` | 30일 경과 또는 차단 만료 후 7일. 활성 차단 제외 |
| `memberChildLinkAttempts` | 실패/미완료 90일, 성공 180일 경과 |
| `offlineClassSessions` | `settings/retentionPolicy`: sessionDate 보존일, status, perRunLimit, skipActiveAccess, dryRun |
| `offlineSessionAccess` | 삭제 대상 session cascade |
| `operationTasks` | legacy. 신규 생성 중단, 자동/수동 cleanup 제외 |

## 9. Rules Summary

| 영역 | 권한 경계 |
| --- | --- |
| 공개 사이트 | `courses`, `instructors`, 일부 `settings`(`settings/kakaoChannel` 포함), `pages`, `publicTimetableEntries` read |
| 본인 계정 | `students/{uid}`, `members/{uid}`, `instructorAccounts/{uid}` 제한 read/update |
| 관리자 | 관리자 CMS collection write |
| 강사 | 담당 강의/수강/오프라인 반 제한 read |
| 학생/회원 | 본인 수강/반/세션 제한 read |
| Legacy | `users/*`, `changeHistory` deny |
| fallback | 명시되지 않은 문서 deny |

## 10. Data Governance Checklist

1. 새 기능은 Active Collections 중 하나를 사용합니다.
2. 공개 read collection에 민감 정보를 저장하지 않습니다.
3. 관리자 삭제 기능은 연결 collection cleanup 범위를 함께 확인합니다.
4. 공개 이미지 URL은 Firebase Storage URL이 아니라 `/assets/...` 경로 또는 허용된 R2 public URL을 사용합니다. Story 이미지는 `https://assets.gritedu.kr/public/story/` 또는 허용된 `public/pages/story/` prefix만 사용합니다.
5. private 자료, 리포트, 과제 첨부는 공개 URL이 아니라 향후 `provider`, `r2Key`, 권한 metadata, signed URL Function으로 설계합니다.
6. 운영성/만료성 데이터는 `scheduledRecordCleanup`과 운영 기록 정리 UI에서 관리합니다. 운영 기록 cleanup 대상은 `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts` 3개 컬렉션입니다. 오프라인 회차는 `settings/retentionPolicy`와 동일 UI에서 설정합니다.
7. `users/*` 또는 `changeHistory`를 다시 도입하지 않습니다.
