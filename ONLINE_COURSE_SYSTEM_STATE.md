# Online Course System State

최종 갱신: 2026-06-24

## 1. 목적

온라인 강의 시스템은 공개 강의 목록, 회원 전용 강의, 학생/회원 수강 연결, 강사 담당 강의 조회를 제공하는 LMS 영역입니다.

현재 모델은 결제/DRM을 포함하지 않습니다. `courses`는 공개 읽기 가능하므로 민감한 영상 보호 정보는 저장하지 않습니다.

## 2. 핵심 컬렉션

| Collection | 목적 |
| --- | --- |
| `courses` | 온라인 강의 원천 데이터 |
| `enrollments` | 학생/회원의 수강 연결 |
| `instructors` | 공개 강사 프로필 |
| `instructorAccounts` | 강사 로그인 계정 |
| `settings/courseCatalog` | 강의 카탈로그 라벨/필터 설정 |
| `settings/coursesMenu` | 공개 강의 메뉴/노출 설정 |

## 3. Course 공개/접근 모델

`courses`는 Firestore rules에서 공개 read가 허용됩니다.

주요 상태 필드:

- `status`: `published`, `draft`, `archived` 등 강의 상태
- `accessType`: `public`, `memberOnly` 등 접근 유형
- `published`: 공개 노출 보조 플래그
- `archived`: 보관/목록 제외 보조 플래그

운영 기준:

- 공개 강의: 공개 목록과 상세에서 접근 가능합니다.
- 회원 전용 강의: 로그인/수강 연결이 필요한 흐름으로 다룹니다.
- 보관 강의: 목록 노출과 신규 수강 연결을 제한해야 합니다.
- draft/비공개 강의: 운영자/관리자 검토 전 공개 노출하지 않습니다.

## 4. 공개 읽기 주의사항

`courses`는 공개 read이므로 다음 정보를 직접 저장하지 않습니다.

- 원본 비공개 영상 URL
- DRM 토큰
- 결제 완료 여부
- 개인별 접근 권한
- 내부 운영 메모
- Secret 또는 API key

현재 강의 데이터는 마케팅/목록/학습 UI에 필요한 공개 가능한 정보 중심으로 유지합니다.

2026-06-24 SEO/R2 운영 메모:

- 공개 강좌 페이지와 강좌 상세 fallback HTML은 `https://gritedu.kr` canonical/OG 기준으로 정리되었습니다.
- sitemap에는 `/courses.html`만 포함하고, query 없는 `course-detail.html`은 핵심 sitemap에서 제외합니다.
- 강좌 썸네일/포스터 기능을 다시 열 경우 공개 가능한 이미지만 R2 public 또는 local `/assets`로 다루고, private 자료 URL은 `courses` 문서에 저장하지 않습니다.

## 5. Enrollment 모델

`enrollments`는 사용자와 강의의 연결입니다.

권장 필드:

- `userId`
- `courseId`
- `role`
- `status`
- `progress`
- `createdAt`
- `updatedAt`

지원 대상:

- 학생 계정: `students/{uid}`와 연결
- 일반 회원 계정: `members/{uid}`와 연결

학부모 회원이 자녀 수강을 보는 흐름은 `studentParentLinks`를 통해 학생 데이터 일부를 확인하는 모델로 분리합니다.

## 6. 사용자별 흐름

| 사용자 | 흐름 |
| --- | --- |
| 공개 방문자 | 공개 강의 목록/상세 조회, 회원 전용 강의 안내 |
| 학생 | 본인 `enrollments` 기준 내 강의와 학습 페이지 확인 |
| 일반 회원 | 본인 `enrollments` 기준 내 강의 확인 |
| 학부모 회원 | 연결된 학생 정보 일부 확인 |
| 강사 | 담당 `courses`와 수강생 정보 제한 조회 |
| 관리자 | 강의 생성/수정/보관/삭제, 수강 연결 정리 |

## 7. Course Delete / Cleanup Behavior

강의 삭제 또는 보관 시 확인할 항목:

1. 해당 강의의 `enrollments` 수
2. 학생/회원 대시보드 노출 영향
3. 강사 담당 강의 목록 영향
4. 공개 목록/상세 링크 영향
5. 관련 이미지 `/assets/...` 경로 존재 여부

삭제 전에는 보관(`archived`)으로 먼저 전환하는 방식이 더 안전합니다.

## 8. Admin CMS 기준

온라인 강의 관리 화면: `members/admin/courses.html`

주요 작업:

- 강의 목록 조회
- 강의 생성/수정
- 공개/회원전용/보관 상태 관리
- 강사 연결
- 커리큘럼/주차 정보 관리
- 썸네일/이미지 경로 관리
- 수강 연결 정리

주의:

- 강의 문서는 공개 read 대상입니다.
- 영상 보안이 필요한 경우 현재 모델에 직접 넣지 말고 별도 설계가 필요합니다.

## 9. Deferred Private Projection Model

결제/DRM/비공개 영상 보호가 필요해지면 다음 구조가 필요합니다.

- 공개 목록용 `courses`와 개인별 접근용 비공개 projection 분리
- 결제 상태 collection
- 서버 검증 또는 callable Function
- DRM/서명 URL/만료 URL 정책
- 강의 접근 로그와 환불/취소 정책

현재 이 모델은 구현되지 않았습니다.

## 10. QA Checklist

1. 공개 강의 목록이 비로그인 상태에서 로드되는지 확인합니다.
2. 회원 전용 강의가 의도대로 안내/제한되는지 확인합니다.
3. 학생 대시보드가 본인 `enrollments`만 표시하는지 확인합니다.
4. 일반 회원 대시보드가 본인 수강과 자녀 연결 정보를 구분하는지 확인합니다.
5. 강사 대시보드가 담당 강의만 보여주는지 확인합니다.
6. 관리자 강의 삭제/보관 시 enrollment 영향이 확인되는지 점검합니다.
7. 공개 강좌 페이지의 title/description/H1과 sitemap 포함 범위가 공식 도메인 기준으로 유지되는지 확인합니다.
