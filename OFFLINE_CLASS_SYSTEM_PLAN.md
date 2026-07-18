# Offline Class System Plan

최종 갱신: 2026-06-24

## 1. 목적

오프라인 수업 시스템은 학원의 현장 반, 학생 배정, 회차/세션, 세션 접근, 공개 시간표를 관리하는 영역입니다.

온라인 강의와 달리 오프라인 수업은 반/회차/학생 배정 중심으로 운영됩니다. 공개 시간표는 오프라인 반의 live view가 아니라 별도 공개용 복사 데이터입니다.

## 2. 핵심 컬렉션

| Collection | 목적 |
| --- | --- |
| `offlineClasses` | 오프라인 반 원천 데이터 |
| `offlineClassMembers` | 반-학생 배정 |
| `offlineClassSessions` | 오프라인 반 회차 |
| `offlineSessionAccess` | 학생별 회차 접근 |
| `publicTimetableEntries` | 공개 시간표 |
| `instructors` | 강사 공개 프로필 |
| `instructorAccounts` | 강사 로그인 계정 |
| `students` | 학생 프로필 |

## 3. Offline Classes

`offlineClasses/{classId}`는 반의 source-of-truth입니다.

주요 필드:

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
- `groupId` (없으면 `regular`)
- `status`
- `archived`
- `createdAt`
- `updatedAt`

운영 기준:

- `scheduleVisible`은 공개 시간표 반영 여부를 판단하는 주요 값입니다.
- 반을 보관/삭제하기 전 학생 배정과 세션을 확인합니다.
- 강사 연결이 바뀌면 강사 대시보드와 공개 시간표 영향도 확인합니다.

## 4. Members / Student Assignment

`offlineClassMembers/{membershipId}`는 반과 학생의 연결입니다.

주요 필드:

- `classId`
- `studentUid`
- `studentName`
- `status`
- `joinedAt`
- `createdAt`
- `updatedAt`

주의:

- 여기서의 members는 일반 회원 collection이 아니라 오프라인 반 학생 배정 의미입니다.
- 학생 삭제 또는 반 삭제 시 연결 cleanup이 필요합니다.
- 학부모/일반 회원이 자녀 정보를 보는 경우 `studentParentLinks`와 함께 권한을 판단해야 합니다.

## 5. Sessions

`offlineClassSessions/{sessionId}`는 반의 회차입니다.

주요 필드:

- `classId`
- `title`
- `sessionDate`
- `startTime`
- `endTime`
- `materials`
- `status`
- `createdAt`
- `updatedAt`

운영 기준:

- 세션은 반에 종속됩니다.
- 반 삭제 전 세션 수와 접근 상태를 확인합니다.
- 학생/강사 대시보드에서 필요한 범위만 읽어야 합니다.

## 6. Access

`offlineSessionAccess/{accessId}`는 학생별 회차 접근 상태입니다.

주요 필드:

- `classId`
- `sessionId`
- `studentUid`
- `status`
- `openedAt`
- `createdAt`
- `updatedAt`

권한 기준:

- 관리자는 생성/수정/삭제할 수 있습니다.
- 강사는 담당 반/회차 범위에서 조회합니다.
- 학생은 본인 접근 범위에서 조회합니다.

## 7. Public Timetable

`publicTimetableEntries/{entryId}`는 공개 시간표 전용 collection입니다.

중요:

- 공개 시간표는 `offlineClasses`에서 복사된 공개용 데이터입니다.
- 오프라인 반과 실시간 동기화되는 live view가 아닙니다.
- 반 정보 수정 후 공개 시간표 반영 여부를 운영자가 확인해야 합니다.
- `scheduleVisible`은 공개 반영 판단에 사용됩니다.
- 공개 시간표 페이지는 `https://gritedu.kr/schedule.html` canonical/OG 기준이며 sitemap 핵심 6개 URL에 포함됩니다.
- `settings/timetableCatalog.scheduleGroups[]`로 정규/기간 그룹 탭을 관리합니다(최대 3, `regular` reserved). 관리 UI는 이름·노출·순서만 편집합니다.
- 과목/학년/학교/강의실/시간표 이미지 기준값은 `settings/timetableCatalog.groupCatalogs[groupId]`에 그룹별 저장합니다. 추가/수정 modal은 선택 `groupId` 기준값을 사용합니다.
- `기준값 저장`과 이미지 저장은 분리됩니다. 기준값 저장은 catalog 필드만, 이미지는 시간표 이미지 관리 모달에서 저장합니다. `regular`만 legacy top-level과 sync합니다.
- CMS 저장 시 미사용 `subjectMeta`/`subjectColorMap`/`version`은 자동 삭제됩니다.
- 공개 `/schedule-images/?group=`는 Cloudflare `_redirects` 또는 `dist/schedule-images/index.html`로 제공됩니다.
- `scheduleItems` 빈 배열 저장을 허용합니다.

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
- `groupId` (없으면 `regular`)
- `sortOrder`
- `updatedAt`

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

시간표 관리 주요 작업:

- 공개 시간표 항목 확인
- 오프라인 반에서 공개용 항목 복사/수정 (같은 `groupId` 유지)
- 시간표 그룹 탭별 항목 관리
- 노출 여부/정렬 관리

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
4. `publicTimetableEntries` 공개 항목 존재 여부
5. 담당 강사 대시보드 영향

권장 순서:

1. 반을 먼저 보관 상태로 전환합니다.
2. 공개 시간표 노출을 제거합니다.
3. 학생/세션/access cleanup 범위를 확인합니다.
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
6. 공개 시간표 항목이 의도대로 표시되는지 확인합니다.
7. 반 정보 수정 후 공개 시간표가 자동 live sync가 아님을 운영자가 확인합니다.
