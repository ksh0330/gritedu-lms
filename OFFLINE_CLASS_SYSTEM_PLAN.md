# Offline Class System Plan

최종 갱신: 2026-08-13

## 1. 목적

오프라인 수업 시스템은 학원의 현장 반, 학생 배정, 회차/세션, 세션 접근, 공개 시간표를 관리하는 영역입니다.

온라인 강의와 달리 오프라인 수업은 반/회차/학생 배정 중심으로 운영됩니다. 공개 시간표는 오프라인 반의 live view가 아니라 `settings/timetableCatalog`의 그룹별 이미지입니다.

## 2. 핵심 컬렉션

| Collection | 목적 |
| --- | --- |
| `offlineClasses` | 오프라인 반 원천 데이터 |
| `offlineClassMembers` | 반-학생 배정 |
| `offlineClassSessions` | 오프라인 반 회차 |
| `offlineSessionAccess` | 학생별 회차 접근 |
| `settings/timetableCatalog` | 공개 시간표 그룹·이미지 source-of-truth |
| `publicTimetableEntries` | deprecated cleanup-only 데이터, 신규 CRUD 금지 |
| `instructors` | 강사 공개 프로필 |
| `instructorAccounts` | 강사 로그인 계정 |
| `students` | 학생 프로필 |
| `settings/offlineClassCatalog` | 그룹별 반 과목/학년/학교 기준값 |
| `settings/subjectColors` | 강사·온라인 강좌·오프라인 반이 공유하는 과목 표시 색상 |

## 3. Offline Classes

`offlineClasses/{classId}`는 반의 source-of-truth입니다.

주요 필드:

- `className`
- `subject`
- `grade`
- `school`, `schools[]`
- `instructorUid`
- `instructorId`
- `instructorName`
- `instructorUids[]`, `instructorIds[]`, `instructorNames[]`
- `scheduleItems[]` (`day`, `startTime`, `endTime`, `room`)
- `clinicScheduleItems[]` (`day`, `startTime`, `endTime`, `room`)
- `scheduleDays`, `startTime`, `endTime`, `room` (기존 화면/데이터 읽기 호환 요약값)
- `scheduleVisible`
- `description`
- `groupId` (없으면 `regular`)
- `status`
- `createdAt`
- `updatedAt`
- `createdBy`, `updatedBy`

운영 기준:

- `scheduleVisible`은 공개 시간표 반영 여부를 판단하는 주요 값입니다.
- 반을 보관/삭제하기 전 학생 배정과 세션을 확인합니다.
- 강사 연결이 바뀌면 강사 대시보드와 공개 시간표 영향도 확인합니다.

## 4. Members / Student Assignment

`offlineClassMembers/{classId}_{studentUid}`는 반과 학생의 연결입니다. 문서 ID는 반드시 `{classId}_{studentUid}` 형식을 사용합니다.

주요 필드:

- `classId`
- `studentUid`
- `studentNameSnapshot`
- `schoolSnapshot`
- `gradeSnapshot`
- `phoneSnapshot`
- `status`
- `joinedAt`
- `createdAt`
- `updatedAt`

주의:

- 여기서의 members는 일반 회원 collection이 아니라 오프라인 반 학생 배정 의미입니다.
- 신규 입반은 `status: "active"`로 저장합니다.
- 학생을 반에서 제거하면 배정 문서를 삭제하고 같은 반/학생의 `offlineSessionAccess` 문서도 함께 삭제합니다.
- 제거 후 학생 대시보드에서 반이 사라지고 반 상세 페이지도 이용할 수 없습니다.
- 다시 입반하면 새 `joinedAt`을 기준으로 기본 회차 노출을 계산합니다.
- 학부모/일반 회원이 자녀 정보를 보는 경우 `studentParentLinks`와 함께 권한을 판단해야 합니다.

## 5. Sessions

`offlineClassSessions/{sessionId}`는 반의 회차입니다.

주요 필드:

- `classId`
- `sessionNo`
- `title`
- `sessionDate`
- `description`
- `hasVideo`
- `videos[]` (`title`, `url`)
- `videoUrl` (첫 영상 URL을 담는 읽기 호환 필드)
- `status`
- `createdAt`
- `updatedAt`
- `createdBy`, `updatedBy`

운영 기준:

- 세션은 반에 종속됩니다.
- 반 삭제 전 세션 수와 접근 상태를 확인합니다.
- 학생/강사 대시보드에서 필요한 범위만 읽어야 합니다.

## 6. Access

`offlineSessionAccess/{sessionId}_{studentUid}`는 학생별 회차 예외 접근 상태입니다. 문서 ID는 `{sessionId}_{studentUid}`를 사용합니다.

주요 필드:

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

권한 기준:

- 관리자는 생성/수정/삭제할 수 있습니다.
- 강사는 담당 반/회차 범위에서 조회합니다.
- 학생은 본인 접근 범위에서 조회합니다.

학생 화면 노출 기준:

1. 반 배정이 `active`이고 회차가 `published`여야 합니다.
2. 관리자가 `manualRevoke`를 저장하면 함께 기록되는 `status: "revoked"`를 학생 화면이 확인해 해당 학생의 수업별 영상 목록에서 숨깁니다.
3. 관리자가 `manualGrant`를 저장하면 함께 기록되는 `status: "active"`를 학생 화면이 확인해 입반일 이전 회차도 표시할 수 있습니다.
4. 별도 예외 문서가 없으면 `sessionDate >= joinedAt`인 회차를 기본 표시합니다.

2026-08-13 Phase 1B `Confirmed defect`:

- 위 `joinedAt`, `manualRevoke`, `manualGrant` 판단은 현재 학생 UI에서 read 후 적용되는 표시 필터입니다.
- Rules는 active 반 배정 학생에게 그 반의 모든 published session read를 허용하고 `joinedAt` 또는 `offlineSessionAccess`를 확인하지 않습니다.
- session 문서에 영상 URL이 있으므로 직접 Firestore read로 입반 전 또는 수동 차단 회차에 접근할 수 있습니다.
- 실제 영향 회차 수는 운영 조회 없이 미확인이며, 후속 수정은 현재 반 상세·grant/revoke UX를 유지하면서 Rules가 확인할 접근 projection을 설계해야 합니다.

## 7. Public Timetable

현재 공개 시간표와 관리자 CMS의 source-of-truth는 `settings/timetableCatalog.groupCatalogs.{groupId}.scheduleImages`입니다. `publicTimetableEntries/{entryId}`는 deprecated cleanup-only collection이며 공개 read/write 또는 신규 CRUD 대상으로 사용하지 않습니다.

중요:

- 공개 시간표는 오프라인 반의 live view가 아니라 그룹별 CMS 이미지입니다.
- 반 정보 수정이 공개 시간표 이미지에 자동 반영되지 않으므로 운영자가 별도로 갱신·확인합니다.
- 공개 시간표 페이지는 `https://gritedu.kr/schedule.html` canonical/OG 기준이며 sitemap 핵심 6개 URL에 포함됩니다.
- `settings/timetableCatalog.scheduleGroups[]`로 정규/기간 그룹 탭을 관리합니다(최대 3, `regular` reserved). 관리 UI는 이름·노출·순서만 편집합니다.
- 오프라인 반 과목/학년/학교 기준값은 `settings/offlineClassCatalog.groupCatalogs[groupId]`에 그룹별 저장합니다. 추가/수정 modal은 선택 `groupId` 기준값을 사용하고 학교도 직접 입력할 수 있습니다.
- 시간표 이미지는 별도로 `settings/timetableCatalog.groupCatalogs[groupId].scheduleImages`에 저장합니다.
- CMS 저장 시 미사용 `subjectMeta`/`subjectColorMap`/`version`은 자동 삭제됩니다. 과목 색상은 공용 `settings/subjectColors.subjectColorMap`을 사용합니다.
- 공개 `/schedule-images/?group=`는 Cloudflare `_redirects` 또는 `dist/schedule-images/index.html`로 제공됩니다.
- `scheduleItems` 빈 배열 저장을 허용합니다.

현재 신규 `publicTimetableEntries` 권장 필드는 없습니다. 그룹 이름·노출·순서와 이미지는 `settings/timetableCatalog` 스키마를 따릅니다.

## 8. Admin CMS 기준

관리 화면:

- 오프라인 반 관리: `members/admin/offline-classes.html`
- 공개 시간표 관리: `members/admin/timetable.html`

오프라인 반 관리 주요 작업:

- 반 생성/수정/보관
- 강사 연결
- 학생 배정/해제
- 회차 생성/수정/삭제
- 학생별 회차 접근 관리
- 그룹별 과목/학년/학교 기준값 관리
- 공용 과목 색상을 반 선택 목록, 관리자 테이블/미리보기와 실제 반 카드·배지에 적용

시간표 관리 주요 작업:

- 공개 시간표 그룹 확인
- 그룹 이름·노출·순서 관리
- 그룹별 시간표 이미지 URL·대체 텍스트 관리

## 9. 사용자별 흐름

| 사용자 | 가능 작업 |
| --- | --- |
| 학생 | 본인 배정 반, 회차, 접근 상태 확인 |
| 일반/학부모 회원 | 연결된 학생 정보 범위에서 확인 |
| 강사 | 담당 오프라인 반과 수강생/회차 확인 |
| 관리자 | 전체 반/배정/회차/시간표 관리 |
| 공개 방문자 | 공개 시간표 조회 |

## 10. 삭제/정리 가이드

반 삭제 전 확인:

1. `offlineClassMembers` 연결 수
2. `offlineClassSessions` 회차 수
3. `offlineSessionAccess` 접근 문서 수
4. `settings/timetableCatalog`의 관련 그룹·이미지 영향
5. 담당 강사 대시보드 영향

권장 순서:

1. 반을 먼저 보관 상태로 전환합니다.
2. 공개 시간표 노출을 제거합니다.
3. 학생/세션/access cleanup 범위를 확인합니다. 학생 제거 시 해당 학생의 배정 문서와 같은 반의 예외 접근 문서는 함께 삭제됩니다.
4. 필요 시 삭제합니다.

## 11. Deferred Work

- 출결/성적/과제 같은 세부 학습 기록
- 학부모용 상세 리포트
- 자동 시간표 동기화
- 결제/수강료 관리
- 알림/푸시
- 오프라인 반/회차 자료 파일은 R2 private + signed URL 설계 전까지 public URL로 시작하지 않습니다.

현재 범위는 반/학생/회차/접근/공개 시간표의 기본 운영 안정화입니다.

## 12. QA Checklist

1. 관리자에서 반을 만들고 강사를 연결합니다.
2. 학생을 반에 배정합니다.
3. 회차를 만들고 학생 접근을 설정합니다.
4. 학생 대시보드에서 배정 반과 회차가 보이는지 확인합니다.
5. 강사 대시보드에서 담당 반과 학생이 보이는지 확인합니다.
6. 공개 시간표 그룹과 이미지가 의도대로 표시되는지 확인합니다.
7. 반 정보 수정 후 공개 시간표 이미지가 자동 live sync가 아님을 운영자가 확인합니다.
8. 강사·온라인 강좌와 같은 이름의 과목이 반 선택 목록, 학생·강사 대시보드와 반 보기에서 같은 색상으로 표시되는지 확인합니다.
9. 신규 기준 과목 저장 시 `settings/subjectColors`에 색상이 생성되고 직접 입력만 한 값은 공용 맵에 추가되지 않는지 확인합니다.

2026-08-01 로컬 운영 확인:

- 학생 입반 후 대시보드의 `반 보기` 및 반 상세 정보 표시 정상
- `manualRevoke` 적용 회차가 해당 학생의 수업별 영상 목록에서 숨김 처리됨
- 학생을 반에서 제거한 뒤 반 목록과 반 상세 정보 접근이 차단됨

## 13. Offline Session and Access Lifecycle Audit (2026-08-13)

### 13.1 Runtime relationship

- Sessions are administrator-created records with Firestore auto-IDs. There is no weekly schedule writer or automatic session generator.
- `sessionDate` is stored as a date string, normally `YYYY-MM-DD`; it is not a reliable class-end or retention-start timestamp.
- Firestore stores video URL metadata only. A session stores `videos[{title,url}]` plus the first URL in compatibility field `videoUrl`; it does not store video bytes.
- Access records are sparse manual exceptions. The canonical ID is `{sessionId}_{studentUid}` and the current writer merges repeated actions into that ID. Default access based on `joinedAt` creates no document.
- One session therefore has zero to one canonical access exception per student, although legacy duplicate IDs can make physical cardinality temporarily higher.

### 13.2 Growth formulas

Let:

- `C` = class count;
- `F` = sessions created per class per week;
- `W` = active weeks;
- `M` = students per class;
- `E` = fraction of session-student pairs with a retained manual grant/revoke exception, from `0` to `1`;
- `V` = average video URL entries per session.

Then:

```text
session documents S = C * F * W
access documents A = E * S * M
default-policy access documents = 0
maximum canonical access documents Amax = S * M
video metadata entries = S * V
```

This is linear/multiplicative growth, not exponential growth. Production `E`, legacy duplicate count, and actual document sizes are unknown until an owner-approved inventory.

Using 13 weeks for three months and 26 weeks for six months:

| Classes | Sessions/class/week | Months | Students/class | Session docs | Default access docs | Maximum access docs | Maximum combined docs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 3 | 3 | 10 | 1,950 | 0 | 19,500 | 21,450 |
| 50 | 3 | 3 | 20 | 1,950 | 0 | 39,000 | 40,950 |
| 50 | 3 | 6 | 10 | 3,900 | 0 | 39,000 | 42,900 |
| 50 | 3 | 6 | 20 | 3,900 | 0 | 78,000 | 81,900 |
| 50 | 4 | 3 | 10 | 2,600 | 0 | 26,000 | 28,600 |
| 50 | 4 | 3 | 20 | 2,600 | 0 | 52,000 | 54,600 |
| 50 | 4 | 6 | 10 | 5,200 | 0 | 52,000 | 57,200 |
| 50 | 4 | 6 | 20 | 5,200 | 0 | 104,000 | 109,200 |
| 100 | 3 | 3 | 10 | 3,900 | 0 | 39,000 | 42,900 |
| 100 | 3 | 3 | 20 | 3,900 | 0 | 78,000 | 81,900 |
| 100 | 3 | 6 | 10 | 7,800 | 0 | 78,000 | 85,800 |
| 100 | 3 | 6 | 20 | 7,800 | 0 | 156,000 | 163,800 |
| 100 | 4 | 3 | 10 | 5,200 | 0 | 52,000 | 57,200 |
| 100 | 4 | 3 | 20 | 5,200 | 0 | 104,000 | 109,200 |
| 100 | 4 | 6 | 10 | 10,400 | 0 | 104,000 | 114,400 |
| 100 | 4 | 6 | 20 | 10,400 | 0 | 208,000 | 218,400 |

For a measured exception rate, multiply the maximum access column by `E`. At 5%, for example, only `0.05 * Amax` canonical access records are expected.

Annual projections use 52 weeks:

| Classes | Sessions/class/week | Students/class | Annual session docs | Maximum annual access docs | Maximum combined docs |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 3 | 10 | 7,800 | 78,000 | 85,800 |
| 50 | 3 | 20 | 7,800 | 156,000 | 163,800 |
| 50 | 4 | 10 | 10,400 | 104,000 | 114,400 |
| 50 | 4 | 20 | 10,400 | 208,000 | 218,400 |
| 100 | 3 | 10 | 15,600 | 156,000 | 171,600 |
| 100 | 3 | 20 | 15,600 | 312,000 | 327,600 |
| 100 | 4 | 10 | 20,800 | 208,000 | 228,800 |
| 100 | 4 | 20 | 20,800 | 416,000 | 436,800 |

Storage must be measured rather than inferred from document count. As a deliberately illustrative, unverified size model only, 2 KiB per session and 1 KiB per access record would make the largest six-month scenario about 223 MiB of document payload at 100% exceptions, or about 30 MiB at 5%, before metadata and index overhead. The largest annual scenario would be about 447 MiB at 100%, or 61 MiB at 5%. Video URL length, field names, legacy duplicates, and automatic indexes can materially change these estimates.

### 13.3 Current query and read behavior

- Administrator class entry loads all classes and performs one session-count aggregation plus one member-count aggregation per class: `2 * C` count queries.
- Administrator session management loads all sessions for one class without a server limit. Saving a session reloads that complete class history.
- Administrator access management loads all access records for one session without a server limit. Its natural bound is roster size, but legacy duplicates can increase it.
- Student class entry loads all access exceptions for that student across every class, filters them in memory, then loads all published sessions for the selected class. Five-row pagination is client-only.
- Instructor class entry loads all members and all sessions for one class, all statuses, before client-only pagination.
- No normal page or Function performs a full scan of either collection, and there are no realtime listeners. The explicit audit script is the only full census and requires operator confirmation.
- The repository tracks no `firestore.indexes.json`. Current equality, `in`, and same-field date range/order queries depend on automatic single-field indexes, index merging, and any console-managed configuration.

Indexed query performance is driven primarily by the returned result and index work, not total collection size alone. The current risk is unbounded history within a class or student plus the administrator N+1 count pattern, not a proven storage emergency.

### 13.4 Authorization and deletion effects

- Student UI applies access status first: `revoked` hides, `active` shows, and absence/unknown status falls back to `sessionDate >= joinedAt`.
- Deleting a revoke can grant normal UI visibility to a post-join session; deleting a grant can deny pre-join UI visibility. Either deletion removes the explicit decision record.
- Current Rules do not enforce `joinedAt` or access exceptions. An active member can directly read any published session, including a UI-revoked or pre-join session. This remains a separate confirmed authorization defect.
- Class archive blocks normal student UI, but student session Rules do not check class status. Session archive is required to deny student Rules reads while retaining the record.
- Archived sessions remain readable to administrators and assigned instructors. They can be republished with the same ID, so retained access exceptions become relevant again.
- Existing permanent delete paths use separate phases. Deleting access first and then failing to delete the session can erase policy while leaving content; deleting a session first elsewhere can leave orphan access. Physical deletion is not currently a safe retention mechanism.

### 13.5 Policy decision

| Option | Result | Decision |
| --- | --- | --- |
| A — retain indefinitely | Maximum history preservation; read shapes still need monitoring and later bounding. | Safe fallback. |
| B — archive without physical deletion | Reversible visibility control with history preserved. | **Recommended current policy.** Archive ended-class sessions and retain access records. |
| C — per-class keep/3/6/12 months | Requires a reliable class-end/retention-start date and reopen-safe semantics that do not exist today. | **Not approved.** |
| D — approved physical purge | Requires owner approval, dependency proof, backup/export decision, dry run, resumable small batches, stop conditions, and explicit rollback limits. | **Deferred.** |

Sessions and access records may have different lifecycles. Archive sessions; keep access records at least as long as the session and potentially longer as authorization evidence. Default legacy, duplicate, orphan, and unknown records to `keep`. Do not use age, missing access documents, or the historical retention form as an expiration decision. Do not add TTL, a Function, or a scheduled purge.

### 13.6 Exact manual reconsideration thresholds

Start a read-only review, not automatic deletion, when any one condition is met:

- 10,000 total session documents;
- 50,000 total access documents;
- 100 sessions returned for one class;
- 100 access exceptions returned for one student on page entry;
- 50 access documents for one session, including duplicates;
- 100 classes on the administrator list, which causes at least 200 count queries per full load;
- 2 seconds P95 load time on an offline page;
- 10,000 offline-related Firestore reads per day;
- 0.5 GiB measured combined document-and-index storage;
- any orphan reference, conflicting duplicate, or missing required ID, which triggers immediate correctness review.

These thresholds are early warning points below platform limits. They do not prove cost, require deletion, or authorize an architecture change.

### 13.7 Owner read-only inventory checklist

Use Firebase Console or another owner-approved bounded read-only method. Record counts and distributions only; do not copy names, emails, video URLs, student IDs, or document values.

1. Document count for `offlineClassSessions` and `offlineSessionAccess`.
2. Oldest and newest valid `sessionDate` values.
3. Session status distribution and archived-session count.
4. Average and maximum access-document count per session, including a duplicate count.
5. Counts of `status: active`, `status: revoked`, `type: manualGrant`, and `type: manualRevoke`.
6. Count of records missing `classId`, `sessionId`, or a referenced class/session; report only aggregate orphan counts.
7. Approximate average document size only if an approved aggregate/export tool can produce it without exposing values; otherwise record it as unknown.
8. Whether archived/old sessions are still opened, using aggregate operational evidence only and no user or URL details.

No production inventory was performed in this audit.
