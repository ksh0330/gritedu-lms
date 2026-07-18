# PROJECT_FULL_OVERVIEW_AUDIT.md

작성일: 2026-06-15  
범위: 저장소 실제 코드/설정/문서 기반 전체 프로젝트 읽기 전용 발견 감사  
수정 범위: 이 보고서 파일 1개만 신규 생성

## 1. Executive Summary

### 확인된 사실

이 프로젝트는 그릿에듀 학원/교육 서비스를 위한 정적 웹사이트 겸 LMS입니다. 공개 사이트, 강의 목록/상세, 강사진, 시간표, 상담/소개 페이지를 제공하고, Firebase Auth와 Firestore를 이용해 학생, 일반 회원, 학부모 회원, 강사, 관리자용 화면을 분리합니다.

핵심 운영은 Cloudflare Pages 정적 Hosting, Firebase Auth, Firestore, Cloud Functions 조합으로 구성되어 있습니다. 프론트엔드는 별도 SPA 프레임워크 없이 HTML, CSS, ES module JavaScript로 구성되어 있고, 배포 전 `scripts/prebuild.js`가 `dist` 산출물을 생성합니다.

관리자는 웹 CMS에서 온라인 강좌, 오프라인 반/회차, 공개 시간표, 강사 프로필, 회원/학생/강사 계정 데이터, 사이트 문구, 팝업, 운영 기록 정리를 관리할 수 있습니다. CMS는 파일을 직접 업로드하지 않으며, 자주 바뀌는 공개 이미지는 R2 public URL을 우선하고 로컬 `/assets` 파일은 prebuild와 Cloudflare Pages 배포가 필요합니다.

### 추론/불확실

실제 Firebase Console 상태, 운영 DB 문서 수, 배포된 Hosting/Functions 버전, Firestore 인덱스 적용 상태, 실기기 QA 결과는 이 감사에서 확인하지 않았습니다. 저장소에는 `dist/build-report.json`이 존재하지만, 이번 감사에서 새 빌드나 배포를 실행하지 않았으므로 현재 배포본과의 일치 여부는 불확실합니다.

## 2. Project Purpose

### 확인된 사실

이 사이트는 다음 목적을 가집니다.

- 그릿에듀 공개 홍보/안내 사이트 운영
- 온라인 강좌 목록, 상세, 수강 신청, 학습 페이지 제공
- 오프라인 반, 회차, 영상 접근 현황 관리
- 학생/일반 회원/학부모 회원/강사별 대시보드 제공
- 관리자 CMS로 사이트와 LMS 데이터를 운영
- Cloudflare Pages와 Firebase backend 기반의 저비용 정적/서버리스 운영

이 프로젝트가 현재 의도적으로 포함하지 않는 범위도 코드와 문서에서 확인됩니다.

- 결제/PG
- DRM 또는 강력한 영상 비공개 보호
- 네이티브 앱
- 푸시 알림/PWA 완성 기능
- Firebase Storage 이미지 업로드
- 자동 파일 업로드형 CMS

### 추론/불확실

현재 `courses` 컬렉션은 공개 읽기입니다. 따라서 회원전용 강의라도 강좌 문서 안에 민감한 영상 URL이 직접 들어가면 데이터 레벨 비공개로 볼 수 없습니다. 코드상 UI는 접근을 제한하지만, 유료/비공개 콘텐츠 사업으로 확장하려면 별도 공개 projection 또는 비공개 커리큘럼 모델이 필요합니다.

## 3. Technology Stack

### 확인된 사실

- 프론트엔드: 정적 HTML, CSS, Vanilla JavaScript ES modules
- Firebase Web SDK: CDN `https://www.gstatic.com/firebasejs/10.14.0/...`
- Firebase Auth: 이메일/비밀번호 로그인, 회원가입 Auth 계정 생성, 관리자 보조 Auth 앱
- Cloud Firestore: 역할/콘텐츠/LMS/CMS 데이터 저장
- Cloud Functions for Firebase: callable Functions와 월간 운영 기록 자동 정리
- 이메일 발송: `nodemailer`, Gmail service, `EMAIL_USER`, `EMAIL_PASS` Secret Manager
- Hosting: Cloudflare Pages가 `dist` 산출물을 배포
- 빌드/검증: Node scripts, `terser`, `postcss`, `cssnano`, `sharp`
- 루트 Node 조건: `package.json`의 `engines.node >=18.17.0`
- Functions Node 조건: `functions/package.json`의 `engines.node = 22`

주요 npm scripts:

- `prebuild`: `node scripts/prebuild.js`
- `prebuild:strict`: strict prebuild
- `verify`, `verify:strict`: `dist` 산출물 검증
- `check:rules`, `check:functions`: rules/functions readiness 확인
- `ready:deploy`: strict prebuild, verify, rules, functions 체크 묶음
- `deploy`: legacy Firebase Hosting deploy script. 현재 일반 운영에서는 사용 금지
- `deploy:phase1-member`: Functions 2개와 Firestore rules 배포
- `deploy:all`: legacy Hosting 포함 배포 script. 현재 일반 운영에서는 사용 금지
- `convert-webp`: 일부 `/assets` 이미지 WebP 생성
- `audit:firestore-fields`: 명시 확인 플래그가 필요한 Firestore 필드 센서스

### 추론/불확실

`firebase.json`에는 `.firebaserc`가 없고 프로젝트 ID는 클라이언트 설정에서 `gritedu-lms`로 보입니다. 실제 CLI active project 또는 배포 대상은 Firebase CLI 설정/환경에 따라 달라질 수 있습니다.

## 4. Architecture Overview

### 확인된 사실

```text
사용자 브라우저
  |
  | Cloudflare Pages: dist/*
  v
정적 HTML/CSS/JS
  |-- Firebase Auth: 로그인/회원가입/역할 세션
  |-- Firestore Client SDK: 공개 데이터, 본인 데이터, 관리자 CMS 데이터
  |-- Callable Functions:
        - sendVerificationCode
        - verifyEmailCode
        - linkMemberChild

개발/운영 PC
  |
  | npm run prebuild
  v
원본 HTML/CSS/JS/assets -> dist 산출물
  |
  | git push origin main -> Cloudflare Pages 자동 build/deploy
  | Firebase CLI는 Firestore rules / Functions 배포가 필요할 때만 Hosting deploy와 분리해 사용
  v
Cloudflare Pages + Firestore Rules + Cloud Functions
```

`assets/js/firebase-init.js`가 Firebase app/auth/db를 초기화하고 `assets/js/utils/auth.js`의 역할 확인 함수를 재export합니다. 대부분의 HTML 페이지는 `firebase-init.js`, `common.js`, 페이지별 JS, `assets/css/main.css`를 로드합니다.

### 추론/불확실

실제 배포는 `dist`를 기준으로 하지만, 저장소 루트의 원본 HTML/CSS/JS와 현재 `dist`가 언제나 동기화되어 있다고 단정할 수 없습니다. 이번 감사에서는 기존 `dist/build-report.json`만 읽었고 새 prebuild는 실행하지 않았습니다.

## 5. User Roles

### 확인된 사실

- Public visitor: 공개 페이지, 강좌/강사/시간표/사이트 문구/일부 설정 읽기
- Student: `students/{uid}` 존재로 판별, 학생 대시보드/학습/오프라인 반 접근
- General member: `members/{uid}.memberPurpose == "general"`, 회원전용 강좌 직접 수강 가능
- Parent member: `members/{uid}.memberPurpose == "parent"`, 자녀 연동과 자녀 학습 현황 확인
- Instructor: `instructorAccounts/{uid}` 또는 `instructors/{uid}`/`instructors.uid` 기반 판별, 배정 강좌/반 읽기
- Admin: `admins/{uid}` 존재로 판별, CMS 쓰기/삭제 권한

역할 확인은 클라이언트에서는 `assets/js/utils/auth.js`, 보안 집행은 `firestore.rules`에서 수행합니다.

### 추론/불확실

관리자 계정 생성/권한 관리는 UI에서 자동화되어 있지 않고 Firebase Console/Firestore 문서 수동 작업이 남아 있습니다. 마지막 관리자 보호 같은 고급 관리자 권한 가드레일은 코드상 명확한 완성 기능으로 보이지 않습니다.

## 6. Feature Map

### 확인된 사실

#### 공개 사이트

- `index.html`: 메인 홈, 강사진 노출, 팝업, D-DAY, CMS 페이지 콘텐츠 일부
- `courses.html`: 공개 강좌 목록, 검색/필터/페이지네이션
- `course-detail.html`: 강좌 상세, 공개 강좌 영상 보기, 회원전용 수강 신청
- `instructors.html`: 강사진 목록과 필터
- `instructor-details.html`: 강사 상세, 영상/커리큘럼/담당 강좌 표시
- `schedule.html`: 공개 시간표
- `story.html`: CMS 기반 소개/이야기 페이지
- `contact.html`: CMS 기반 상담/오시는 길
- `tuition.html`, `terms.html`, `privacy.html`, `404.html`: 안내/정책/오류 페이지

#### 로그인/회원가입

- `members/login.html`: Firebase Auth email/password 로그인
- `members/signup.html`: 단계형 회원가입
- `sendVerificationCode`, `verifyEmailCode`: 이메일 인증번호 발송/검증
- 회원가입 설정: `settings/signup`
- 학교 검색: `/assets/school.csv`
- 필수 약관/개인정보 동의와 선택 마케팅 동의 저장

#### 학생/일반 회원/학부모 회원

- 학생 대시보드: 온라인 강좌, 오프라인 반, 프로필/마케팅 수신 설정
- 학생 학습 페이지: 강좌 주차/영상, 진도, 시청 체크
- 학생 오프라인 반 페이지: 배정된 반/회차/영상 접근
- 일반 회원 대시보드: 본인 회원전용 강좌 수강/학습
- 학부모 회원 대시보드: 자녀 자동 매칭 연동, 자녀 온라인/오프라인 현황 표시
- 자녀 연동: `linkMemberChild` Function, `studentParentLinks`, `memberChildLinkAttempts`

#### 강사

- 강사 대시보드: 배정 온라인 강좌, 오프라인 반, 로스터 요약
- 강사 강좌 상세: 담당 강좌 콘텐츠와 수강생 목록
- 강사 오프라인 반 상세: 담당 반 학생/회차 읽기
- 강사 쓰기는 제한적이며, 주요 운영 데이터 쓰기는 관리자 중심입니다.

#### 관리자 CMS

- 온라인 강좌 관리
- 오프라인 반/학생/회차/영상/접근 관리
- 학생/회원/강사/계정 관리
- 강사 프로필/상세 표시 설정
- 공개 시간표 관리
- 사이트 문구/이야기/문의/강사진 노출 관리
- 홈 팝업 관리
- 운영 기록 정리

#### 이미지/자산 워크플로

- 고정 이미지는 로컬 `/assets` 아래 관리하고, 자주 바뀌는 공개 이미지는 R2 public URL 사용
- Firebase Storage 미사용
- `prebuild`가 WebP 출력, 이미지 참조 검증, `dist` 복사를 수행
- CMS는 `/assets/...` 경로 또는 허용된 R2 public URL을 저장합니다. 로컬 파일 배치는 운영 PC/개발자 작업이고, R2 public URL은 배포 없이 반영될 수 있습니다.

### 추론/불확실

브라우저/실기기 QA를 이번에 실행하지 않았습니다. 따라서 각 기능의 현재 화면 상태와 배포본 동작은 코드상 구현 여부와 기존 문서/빌드 산출물 기준으로만 판단했습니다.

## 7. Admin CMS Map

### 확인된 사실

| 페이지 | 목적 | 주요 작업 | 주요 컬렉션 | 위험/주의 |
|---|---|---|---|---|
| `members/admin/dashboard.html` | 관리자 메뉴와 운영 현황 | 학생/강사/강좌/반/시간표 count 로드 | `students`, `instructors`, `courses`, `offlineClasses`, `offlineClassMembers`, `publicTimetableEntries` | 현황 로드는 비용 절감을 위해 수동 버튼 중심 |
| `members/admin/courses.html` | 온라인 강좌 관리 | 강좌 추가/수정, 공개/회원전용, published/draft/archived, 주차/영상, 수강생 확인/삭제, 강좌 영구 삭제 | `courses`, `enrollments`, `instructors` | 수강 기록이 있으면 삭제 차단 모달, 강제 삭제는 enrollments까지 삭제 |
| `members/admin/offline-classes.html` | 오프라인 반 관리 | 반 생성/수정/보관/삭제, 학생 입반/제거, 회차/영상, 수동 허용/차단 | `offlineClasses`, `offlineClassMembers`, `offlineClassSessions`, `offlineSessionAccess`, `students`, `instructors` | 반 삭제는 멤버/회차/접근 문서 cascade 삭제 |
| `members/admin/timetable.html` | 공개 시간표 관리 | 시간표 항목 추가/수정/보관/삭제, 오프라인 반 정보 복사, 필터 카탈로그 저장 | `publicTimetableEntries`, `settings/timetableCatalog`, `offlineClasses`, `instructors` | 오프라인 반과 자동 동기화되지 않음 |
| `members/admin/site.html` | 사이트 CMS | Story v2, 상담 문의, D-DAY, 강사진 노출 순서/숨김 | `pages`, `settings/instructorsMenu`, `instructors` | Story 이미지는 R2 public URL 기준 |
| `members/admin/popup.html` | 홈 팝업 관리 | 팝업 추가/수정/삭제, 위치/크기/이미지/문구/링크 설정 | `settings/popups` | 이미지는 R2 public URL 또는 `/assets/popup/*.webp` rollback 경로 |
| `members/admin/operation-tasks.html` | 운영 기록 정리 | 정리 대상 확인, 월 1회 수동 정리, 자동 정리 상태 확인 | `emailVerifications`, `signupAttempts`, `memberChildLinkAttempts`; legacy `operationTasks` | `scheduledRecordCleanup` 월간 자동 정리와 정책 동기화 필요 |
| `members/admin/users/students.html` | 학생 관리 | 학생 목록, 상세, 기본정보 수정, 온라인/오프라인 연결 현황 | `students`, `enrollments`, `offlineClassMembers`, `courses`, `offlineClasses` | 삭제는 별도 계정 관리 페이지 중심 |
| `members/admin/users/members.html` | 일반/학부모 회원 관리 | 회원 목록, 회원 상세, 수강/자녀 연동/시도 기록 조회 | `members`, `enrollments`, `studentParentLinks`, `memberChildLinkAttempts`, `students` | Auth 삭제는 자동화되지 않음 |
| `members/admin/users/instructors.html` | 강사 관리 | 강사 프로필/계정 연결 상태, 공개 표시 섹션, 이미지/영상/커리큘럼 | `instructors`, `instructorAccounts`, `courses`, `offlineClasses`, `publicTimetableEntries`, `settings/instructorsMenu` | 이미지 파일 준비와 계정 unlink/delete preview 주의 |
| `members/admin/users/add.html` | 계정 생성/데이터 정리/회원가입 설정 | 학생/강사/회원 Auth 생성, canonical docs 작성, 사이트 데이터 정리, signup toggle | `students`, `members`, `instructors`, `instructorAccounts`, `admins`, `settings/signup`, legacy `users` cleanup helper | Firebase Auth 계정 삭제/비밀번호 변경은 Console 수동 |

### 추론/불확실

관리자 UI는 기능 폭이 넓고 일부 화면은 모달/테이블이 큽니다. 모바일/태블릿에서 텍스트 겹침, 버튼 상태, 다크모드 색상, 모달 스크롤은 별도 브라우저 QA가 필요합니다.

## 8. Data Model Summary

### 확인된 사실

#### active 주요 컬렉션

- `admins`: 관리자 역할 판별 및 관리자 문서
- `students`: 학생 프로필, 회원가입 학생 데이터
- `members`: 일반/학부모 회원 프로필
- `studentParentLinks`: 학부모-자녀 active 링크
- `memberChildLinkAttempts`: 자녀 연결 시도/결과 로그
- `instructors`: 공개 강사 프로필
- `instructorAccounts`: Auth UID 기반 강사 계정 private lookup
- `courses`: 온라인 강좌 source of truth
- `enrollments`: `uid_courseId` 형태의 온라인 수강/진도 문서
- `offlineClasses`: 오프라인 반
- `offlineClassMembers`: 오프라인 반 학생 배정
- `offlineClassSessions`: 오프라인 회차/영상
- `offlineSessionAccess`: 회차별 수동 허용/차단 기록
- `publicTimetableEntries`: 공개 시간표 source of truth
- `pages`: 이야기/문의/D-DAY 등 CMS 페이지 콘텐츠
- `settings`: `signup`, `coursesMenu`, `instructorsMenu`, `courseCatalog`, `timetableCatalog`, `popups`
- `operationTasks`: legacy 운영 문서. 신규 생성 중단, 자동/수동 cleanup 대상 제외
- `emailVerifications`: Function-managed 인증번호 임시 문서
- `signupAttempts`: Function-managed 가입 인증 요청/rate limit 기록

#### deprecated/blocked/residual

- `users`: Firestore rules에서 read/write 모두 deny. 활성 역할 모델이 아님.
- `changeHistory`: rules에서 read/write 모두 deny. 기존 데이터가 있으면 추후 수동/정책 기반 정리 대상.
- `exam_contents`: rules에는 남아 있고 migration script의 source로 존재하지만, 활성 강좌 source는 `courses`.
- `arrangements`: rules에는 public read/admin write가 있으나 현재 주요 JS 사용은 확인되지 않음.
- `parents`: admin-only residual collection. 현재 학부모 기능은 `members`와 `studentParentLinks` 사용.
- `classes`: active source로 쓰지 말라는 문서 지침이 있으며 현재 컬렉션 검색에서 주요 코드 사용이 확인되지 않음.
- `publicCourses`: 문서상 deferred. 코드/규칙에서 active 구현 확인 안 됨.

### 추론/불확실

실제 프로덕션 DB에 어떤 legacy 문서가 남아 있는지는 알 수 없습니다. 저장소에는 read-only field census script가 있지만, 이번 감사에서는 production Firestore에 접속하지 않았습니다.

## 9. Security and Authorization Model

### 확인된 사실

Firestore rules의 기본 구조는 다음과 같습니다.

- `signedIn()`: Firebase Auth 로그인 여부
- `isAdmin()`: `admins/{uid}` 존재
- `isInstructor()`: `instructorAccounts/{uid}` 또는 `instructors/{uid}` 존재
- `isStudent()`: `students/{uid}` 존재
- `isMember()`: `members/{uid}` 존재
- `isGeneralMember()`, `isParentMember()`: `members.memberPurpose`
- `isLinkedParentOfStudent(studentUid)`: active `studentParentLinks/{studentUid}_{memberUid}` 확인

공개 read:

- `instructors`
- `courses`
- `settings/signup`
- `settings/coursesMenu`
- `settings/instructorsMenu`
- `settings/courseCatalog`
- `settings/timetableCatalog`
- `settings/popups`
- `publicTimetableEntries`
- `pages`
- `arrangements`
- `exam_contents`

admin-only write:

- 강사, 강사 계정, 코스, 설정, 페이지, 시간표, 오프라인 반/멤버/회차/접근 대부분
- `emailVerifications`, `signupAttempts`는 admin read/delete만 허용되고 client create/update는 거부됩니다.

학생/회원 self-write:

- 학생/회원은 가입 시 본인 문서 생성 가능
- 본인 프로필 일부 필드와 마케팅 동의 설정 수정 가능
- 학생/일반 회원은 enrollment 생성 가능
- enrollment owner는 일부 학습 상태 업데이트 또는 수강 취소 delete 가능

강사:

- 배정된 온라인 강좌/enrollments 읽기
- 배정된 오프라인 반/멤버/회차/접근 읽기
- 오프라인 class/session/member/access 쓰기는 현재 관리자 중심입니다.

### 추론/불확실

보안상 중요한 caveat가 있습니다.

- `courses`가 public read라서 member-only UI가 있어도 course 문서 자체는 공개 읽기입니다.
- 오프라인 회차의 joinedAt 이후 접근, 수동 revoke 같은 일부 조건은 `student-offline-class.js` 클라이언트 로직에서 더 강하게 걸러집니다. rules는 published session과 active class membership 중심입니다.
- 실제 Firestore indexes는 확인하지 않았습니다. 일부 instructor dashboard query는 코드에서 index/configuration warning을 처리합니다.

## 10. Operations Model

### 확인된 사실

비개발자 관리자가 웹 CMS에서 할 수 있는 일:

- 온라인 강좌 생성/수정/보관/삭제
- 수강생 확인과 수강 기록 제거
- 오프라인 반 생성/수정/보관/삭제
- 학생 입반/제거, 회차 등록, 회차별 수동 허용/차단
- 공개 시간표 생성/수정/보관/삭제
- 강사 프로필, 표시 순서, 상세 표시 섹션 관리
- 학생/회원/강사 사이트 데이터 확인/정리
- 회원가입 활성화/비활성화 설정
- 사이트 이야기/문의/D-DAY 문구 관리
- 팝업 문구/경로/노출 설정
- 운영 기록 정리 수동 확인/삭제와 `scheduledRecordCleanup` 자동 정리 상태 확인

개발자 또는 로컬 PC 작업이 필요한 일:

- 이미지/PDF/CSV 파일을 실제 `/assets` 폴더에 추가
- `npm run prebuild` 실행
- `npm run verify` 또는 strict readiness 확인
- production branch push 후 Cloudflare Pages 자동 배포 확인
- Firestore rules 또는 Functions 변경 시 별도 배포
- Firebase Auth 계정 삭제, 관리자 권한 변경, 비밀번호/이메일 관리
- production 데이터 cleanup 전 백업/드라이런/승인/QA

### 추론/불확실

운영자가 CMS에 이미지 경로만 저장하고 실제 파일을 넣지 않으면 화면에서 이미지가 깨질 수 있습니다. 현재 build report는 missing reference fatal 오류는 없지만, popup 쪽 큰 PNG와 source WebP 미생성 경고 후보가 있습니다.

## 11. Image and Asset Workflow

### 확인된 사실

이미지 정책은 로컬 `/assets` 중심입니다.

- Firebase Storage API 사용 없음
- `assets/js/firebase-init.js`의 `storageBucket`은 주석 처리
- 이미지 경로는 `/assets/...` 형태
- `docs/IMAGE_ASSET_POLICY.md`가 source-of-truth 문서
- `scripts/convert-webp.js`는 `assets/instructors/curriculum`, `assets/popup`, `assets/story` 등 일부 폴더의 PNG/JPG를 WebP로 변환
- `scripts/prebuild.js`는 `main.png`, `banner_main.png`를 runtime WebP로 출력하고 HTML 참조를 WebP로 교체
- `prebuild`는 missing references, duplicate pairs, large source images, missing WebP counterparts를 report에 남김

기존 `dist/build-report.json` 확인 결과:

- version: `20260615-174516`
- generatedAt: `2026-06-15T08:45:16.474Z`
- strictMode: `false`
- prebuild step warnings: `0`
- CSS fallback: 없음
- JS fallback files: 없음
- JS processed: 76
- missing references: 없음
- required missing: 없음
- dist asset references: 없음
- large source images: `assets/popup/banner_main.png` 1.51MB, `assets/popup/main.png` 1.85MB
- duplicate pairs: `assets/footer/fee` jpg/webp, `assets/footer/refund` jpg/webp
- missing WebP counterparts 후보: curriculum 5개, popup 5개

### 추론/불확실

이번 감사에서 `npm run prebuild`를 새로 실행하지 않았기 때문에 report는 기존 `dist/build-report.json` 기준입니다. 현재 source changes와 build report가 완전히 일치하는지는 불확실합니다.

## 12. Cost and Billing Structure

### 확인된 사실

주요 비용 발생 영역:

- Cloudflare Pages: HTML/CSS/JS/이미지/PDF/CSV 정적 배포와 traffic
- Firestore: read/write/delete, storage, index
- Firebase Auth: 일반 인증 사용
- Cloud Functions: callable invocation, runtime, logs
- Secret Manager: `EMAIL_USER`, `EMAIL_PASS` secret access
- Cloud Build/Artifact Registry/Cloud Storage artifacts: Functions deploy/build 인프라로 나타날 수 있음

비용 절감 방향:

- 정적 Hosting 중심 구조
- Firebase Storage 미사용
- 이미지 파일은 로컬 assets와 Hosting cache header로 관리
- Functions는 이메일 인증/자녀 연동 등 최소 기능에 집중
- signup rate-limit query는 composite index를 피하기 위해 single-field query 후 서버 메모리 필터링
- admin dashboard는 count를 필요할 때 수동으로 불러오는 구조
- cleanup/operation task 도구가 존재

### 추론/불확실

정확한 월 비용은 트래픽, Firestore 문서 수, 조회 패턴, Functions 호출 수, Hosting download량, Artifact Registry 보관량을 봐야 알 수 있습니다. 이번 감사에서는 청구/모니터링 콘솔을 확인하지 않았고, 정성적 비용 구조만 정리했습니다.

## 13. Current Readiness

### 확인된 사실

#### stable/completed로 볼 수 있는 영역

- Firebase 정적 Hosting 구조
- Firestore role/rules 기반 권한 모델
- 학생/회원/강사/관리자 역할 분리
- 온라인 강좌 CRUD 및 수강/학습 기본 흐름
- 학생/일반 회원 enrollment 모델
- 학부모 자녀 연결 callable Function
- 오프라인 반/회차/학생/접근 관리
- 공개 시간표 분리 모델
- 강사 프로필/계정 canonical 모델
- 이메일 인증 Functions와 Secret Manager 기반 발송
- 로컬 asset/WebP/prebuild 정책
- `users` aggregate deny 처리
- `changeHistory` deny 처리

#### needs browser QA

- 모바일/태블릿 관리자 모달/테이블
- 다크모드 버튼/상태/위험 버튼 색상
- 팝업 public runtime, 위치/크기/모바일 렌더링
- student/member course learning playback UX
- iOS Safari 영상/모달 동작
- 현재 dirty worktree 변경 후 전체 회귀 QA

#### needs deployment confirmation

- Hosting 최신 `dist`가 실제 배포되었는지
- Firestore rules 최신 버전 배포 여부
- Functions Node 22/Functions v7 코드가 실제 배포되었는지
- `EMAIL_USER`, `EMAIL_PASS` secrets 설정 여부
- 필요한 Firestore composite indexes 존재 여부

#### needs final documentation

- popup 관련 오래된 readiness 문서와 현재 rules/code 차이
- root의 임시/감사 문서와 active source-of-truth 문서 정리 상태
- 실제 운영자용 이미지 배치/배포 절차

#### deferred/not implemented

- 결제
- DRM
- 네이티브 앱
- push/PWA 완성
- Firebase Storage 업로드형 CMS
- `publicCourses` projection/private curriculum split
- TTL 또는 scheduled cleanup for temporary signup support collections

### 추론/불확실

코드상 구현이 확인되어도 production readiness는 별도입니다. 이번 감사는 브라우저, Firebase Console, 실제 DB, 배포 상태를 확인하지 않았으므로 production-ready라고 과장하지 않습니다.

## 14. Risks and Open Items

### 확인된 사실

- 현재 git worktree가 매우 dirty입니다.
- `functions/node_modules` 관련 tracked/modified/deleted 항목이 대량으로 보입니다.
- `.gitignore`에는 `node_modules`가 있으나 현재 git status에는 `functions/node_modules` 변경이 많이 보입니다.
- 루트에 `e deploy --only functions`라는 파일이 있고 내용은 functions dependency update diff/log입니다.
- `dist`는 `.gitignore` 대상이지만 로컬에 존재합니다.
- `scripts/clean-unused.js`, `scripts/split-css-v2.js`는 쓰기/삭제를 수행하는 스크립트입니다. 이번 감사에서는 실행하지 않았습니다.
- Firestore rules에 `enrollments` legacy `classId` 관련 TODO가 남아 있습니다.
- active docs와 older audit docs 사이에 drift가 있습니다. 예: 오래된 readiness audit은 popup public read blocked라고 쓰지만 현재 rules는 `settings/popups` public read를 허용합니다.
- build report에 큰 popup source image와 WebP counterpart 후보가 남아 있습니다.

### 추론/불확실

주요 운영 리스크:

- 문서 drift로 인해 운영자가 오래된 제약을 현재 상태로 오해할 수 있음
- `functions/node_modules` repo hygiene가 commit/review/deploy를 어렵게 만들 수 있음
- public `courses` read 모델은 비공개/유료 영상으로 확장할 때 위험
- indexes 누락 시 강사/관리자 쿼리가 production에서 실패할 수 있음
- mobile QA 없이 관리자 작업을 맡기면 삭제/보관/접근 모달에서 실수 가능
- Auth deletion/manual reset이 Console 수동이라 운영 checklist 누락 가능

## 15. Presentation Summary

### 확인된 사실 중심 PT 설명

우리가 만든 것은 그릿에듀의 공개 홈페이지와 LMS, 그리고 운영자가 직접 관리할 수 있는 관리자 CMS입니다. 학생은 온라인 강의를 수강하고 오프라인 반 회차를 확인할 수 있으며, 일반 회원은 회원전용 강의를 수강할 수 있습니다. 학부모 회원은 자녀 정보를 입력해 학생 계정과 연결하고 학습 현황을 볼 수 있습니다. 강사는 자신에게 배정된 온라인 강좌와 오프라인 반 정보를 확인합니다.

기술적으로는 정적 HTML/CSS/JS를 Cloudflare Pages로 배포하고, 로그인은 Firebase Auth, 데이터는 Firestore, 이메일 인증/자녀 연결/월간 운영 기록 정리는 Cloud Functions로 처리합니다. 이미지 파일은 Firebase Storage에 업로드하지 않고 고정 자산은 `/assets`, mutable public 이미지는 R2 public URL로 운영하므로 단순하고 비용을 낮게 유지합니다.

관리자는 CMS에서 강좌, 반, 시간표, 강사 프로필, 회원/학생/강사 데이터, 사이트 문구, 팝업, 운영 기록 정리를 관리합니다. 다만 로컬 파일 추가, prebuild, Cloudflare Pages 배포, Auth 계정 삭제, rules/functions 배포는 아직 개발자 또는 Firebase Console 작업이 필요합니다.

현재 핵심 기능은 코드상 구현되어 있지만, 실제 production release로 말하려면 최신 배포 확인, 실기기 QA, Firestore indexes 확인, Functions secrets 확인, 이미지 경로 QA가 필요합니다. 결제, DRM, 네이티브 앱, push, 완성형 PWA는 아직 범위 밖입니다.

### 추론/불확실

비용은 작은 학원 규모에서는 정적 Hosting과 최소 Functions 구조로 낮게 유지될 가능성이 큽니다. 다만 Firestore 전체 목록 read, 큰 이미지 다운로드, `school.csv` 반복 다운로드, Functions artifact storage는 트래픽이 커지면 모니터링해야 합니다.

## 16. Suggested PT Slide Outline

1. Project title  
   그릿에듀 웹사이트/LMS/CMS 통합 프로젝트

2. Background/problem  
   홍보 사이트, 강좌 운영, 학생/회원/강사 관리, 오프라인 반 운영을 한 곳에서 관리해야 함

3. Service overview  
   공개 페이지, 온라인 강좌, 오프라인 반, 회원/학부모/강사/관리자 화면

4. User roles  
   방문자, 학생, 일반 회원, 학부모 회원, 강사, 관리자

5. Main user features  
   강좌 탐색, 수강 신청, 학습 진도, 오프라인 회차 확인, 자녀 학습 현황

6. Admin CMS  
   강좌, 반, 시간표, 강사, 회원, 사이트 문구, 팝업, 운영 기록 정리

7. Technical architecture  
   Cloudflare Pages + Firebase Auth + Firestore + Cloud Functions + local assets/R2

8. Firestore/data model  
   `courses`, `enrollments`, `students`, `members`, `offlineClasses`, `pages`, `settings`

9. Security/authorization  
   role document 기반 권한, rules 중심 접근 제어, public read 영역과 한계

10. Operations/cost  
   정적 Hosting, 로컬 assets, Storage 미사용, 최소 Functions, cleanup 도구

11. Current status  
   핵심 기능 구현, QA/배포/인덱스/문서 drift 확인 필요

12. Roadmap  
   실기기 QA, deployment confirmation, retention cleanup, private course model, PWA/push/payment는 후속

## 17. Files Inspected

### 확인된 주요 파일 그룹

- 루트 public HTML: `index.html`, `courses.html`, `course-detail.html`, `instructors.html`, `instructor-details.html`, `schedule.html`, `story.html`, `contact.html`, `tuition.html`, `terms.html`, `privacy.html`, `404.html`
- member/student/member/instructor HTML: `members/login.html`, `members/signup.html`, `members/dashboard.html`, `members/students/*`, `members/member/*`, `members/instructors/*`
- admin HTML: `members/admin/dashboard.html`, `members/admin/courses.html`, `members/admin/offline-classes.html`, `members/admin/timetable.html`, `members/admin/site.html`, `members/admin/popup.html`, `members/admin/operation-tasks.html`, `members/admin/users/*`
- Firebase/config: `package.json`, `firebase.json`, `firestore.rules`, `assets/js/firebase-init.js`
- Functions: `functions/package.json`, `functions/index.js`, `functions/scripts/migrate-exam-contents-to-courses.js`
- build/scripts: `scripts/prebuild.js`, `scripts/convert-webp.js`, `scripts/verify-build.js`, `scripts/check-rules.js`, `scripts/check-functions.js`, `scripts/backfill-course-visibility.js`, `scripts/audit-firestore-fields.js`, `scripts/ensure-dist.js`, `scripts/clean-unused.js`, `scripts/split-css-v2.js`
- CSS: `assets/css/main.css`, `assets/css/base/*`, `assets/css/components/*`, `assets/css/pages/*`
- JS: `assets/js/common.js`, `assets/js/utils/*`, `assets/js/pages/*`, `assets/js/features/signup/*`, dashboard submodules
- assets: root brand images, `assets/footer`, `assets/instructors/profile`, `assets/instructors/curriculum`, `assets/popup`, `assets/partials`, `assets/school.csv`
- dist metadata: `dist/build-report.json`, `dist/version.json`, representative `dist` file list
- active docs/supporting docs: `PROJECT_STATE.md`, `PROJECT_DOCS_INDEX.md`, `ADMIN_CMS_STATE.md`, `ONLINE_COURSE_SYSTEM_STATE.md`, `OFFLINE_CLASS_SYSTEM_PLAN.md`, `md/DATABASE_SCHEMA.md`, `docs/IMAGE_ASSET_POLICY.md`, `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`, `SITE_OPERATION_READINESS_AUDIT.md`, recent CMS/member/image audits
- repository hygiene: `.gitignore`, git status, root file `e deploy --only functions`

### 제외/제한

개별 이미지 파일은 그룹과 build report 중심으로 확인했고, 모든 이미지 바이너리를 개별 열람하지 않았습니다. Firebase Console, production Firestore, production Hosting URL, production Functions logs는 확인하지 않았습니다.

## 18. Commands Run

일부 명령은 병렬로 실행했습니다. 아래 명령들은 모두 읽기/탐색 목적이었습니다.

```powershell
Get-Content -LiteralPath 'C:\Users\USEr\.codex\attachments\7cfd0e7d-ee64-4313-ab18-5b19b03933bd\pasted-text.txt'
rg --files
Get-ChildItem -Force
git status --short
Get-Content -Raw -LiteralPath 'package.json'
Get-Content -Raw -LiteralPath 'firebase.json'
Get-Content -Raw -LiteralPath 'functions\package.json'
Get-Content -Raw -LiteralPath 'functions\index.js'
Get-Content -Raw -LiteralPath 'assets\js\firebase-init.js'
Get-Content -Raw -LiteralPath 'firestore.rules'
Get-Content -Raw -LiteralPath 'scripts\prebuild.js'
Get-Content -Raw -LiteralPath 'scripts\convert-webp.js'
Get-Content -Raw -LiteralPath 'scripts\verify-build.js'
Get-Content -Raw -LiteralPath 'scripts\check-rules.js'
Get-Content -Raw -LiteralPath 'scripts\check-functions.js'
Get-Content -Raw -LiteralPath 'scripts\audit-firestore-fields.js'
rg -n "<title>|<script|stylesheet|assets/css|assets/js" -g "*.html" -g "!dist/**" -g "!node_modules/**"
rg --files -g "*.html" -g "!dist/**" -g "!node_modules/**"
rg --files -g "*.js" -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!node_modules/**"
rg --files -g "*.css" -g "!dist/**" -g "!node_modules/**"
rg --files -g "*.md" -g "!dist/**" -g "!node_modules/**" -g "!functions/node_modules/**"
rg -n "collection\(db,|doc\(db,|collectionGroup\(|query\(|where\(|getDocs\(|setDoc\(|addDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|runTransaction\(" assets\js functions\index.js functions\scripts scripts -g "*.js" -g "!**/node_modules/**"
rg -n "guardPage|requireRole|getUserRole|checkRole|isAdmin|isInstructor|isStudent|isMember|onAuthStateChanged|sendVerificationCode|verifyEmailCode|linkMemberChild|getFunctions|httpsCallable" assets\js functions\index.js -g "*.js"
rg -n "match /|allow read|allow create|allow update|allow delete|allow write|allow read, write" firestore.rules
rg -n "exports\.|collection\(" functions\index.js functions\scripts\migrate-exam-contents-to-courses.js
$files = Get-ChildItem -Recurse -Include *.js,*.rules -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\' }; ... collection/rules regex extraction ...
rg -n "TODO|deprecated|legacy|delete|삭제|cleanup|정리|archive|archived|danger|warning|warn|미구현|준비|임시|blocked|readiness|strict|index" assets\js functions scripts firestore.rules -g "*.js" -g "*.rules" -g "!**/node_modules/**"
rg -n "TODO|deprecated|legacy|delete|삭제|cleanup|정리|archive|archived|danger|warning|warn|미구현|준비|임시|blocked|readiness|strict|index" *.md docs md -g "*.md"
rg -n "Firebase Storage|Storage|storageBucket|WebP|webp|assets|image|이미지|prebuild|deploy|배포|Hosting|Firestore|Functions|Secret|Artifact|Cloud Build|cost|비용" *.md docs md scripts assets\js -g "*.md" -g "*.js" -g "!**/node_modules/**"
rg -n "^#|^##|Status|status|Last updated|Date/context|완료|보류|deferred|Deferred|risk|Risk|QA|production|Production|ready|Ready|source of truth|current" PROJECT_STATE.md PROJECT_DOCS_INDEX.md ADMIN_CMS_STATE.md ONLINE_COURSE_SYSTEM_STATE.md OFFLINE_CLASS_SYSTEM_PLAN.md CMS_FINAL_STABILIZATION_AUDIT.md CMS_UI_UX_SIMPLIFICATION_AUDIT.md MEMBER_AND_OPERATIONAL_CLEANUP_AUDIT.md SITE_OPERATION_READINESS_AUDIT.md docs\IMAGE_ASSET_POLICY.md docs\FIREBASE_USAGE_AND_COST_AUDIT.md md\DATABASE_SCHEMA.md
rg -n "^(async function|function|const [A-Z_][A-Z0-9_]*|const [a-zA-Z0-9_]+ = async|window\.|document\.addEventListener|export function)" assets\js\pages -g "admin-*.js"
rg -n "^(async function|function|const [A-Z_][A-Z0-9_]*|const [a-zA-Z0-9_]+ = async|window\.|document\.addEventListener|export function)" assets\js\pages\student-dashboard assets\js\pages\instructor-dashboard assets\js\pages\student-dashboard.js assets\js\pages\instructor-dashboard.js assets\js\pages\member-dashboard.js assets\js\pages\student-course.js assets\js\pages\student-offline-class.js assets\js\pages\instructor-course-detail.js assets\js\pages\instructor-offline-class.js
rg -n "^(async function|function|const [A-Z_][A-Z0-9_]*|const [a-zA-Z0-9_]+ = async|window\.|document\.addEventListener|export function)" assets\js\pages\courses.js assets\js\pages\course-detail.js assets\js\pages\home-popup.js assets\js\pages\home-instructors.js assets\js\pages\instructors.js assets\js\pages\instructor-details.js assets\js\pages\schedule.js assets\js\pages\contact.js assets\js\pages\story.js assets\js\utils\page-content.js assets\js\utils\settings-cache.js
Get-Content -Raw -LiteralPath '.gitignore'
Get-ChildItem -Recurse -Depth 2 -Force -Directory | Select-Object FullName
Get-ChildItem -Recurse -File assets | Where-Object { $_.FullName -notmatch '\\css\\|\\js\\' } | Group-Object { $_.DirectoryName.Replace((Get-Location).Path + '\\','') } | Sort-Object Name | Select-Object Name, Count
Get-ChildItem -Recurse -File dist | Select-Object -First 80 FullName, Length
Get-Content -Raw -LiteralPath 'dist\build-report.json'
Get-Content -Raw -LiteralPath 'dist\version.json'
Get-Content -Raw -LiteralPath 'scripts\backfill-course-visibility.js'
Get-Content -Raw -LiteralPath 'functions\scripts\migrate-exam-contents-to-courses.js'
rg -n "createUserWithEmailAndPassword|initializeApp\(|deleteUser|secondary|secondaryApp|inMemoryPersistence|setPersistence|Firebase Authentication|Auth|password|비밀번호|deleteUser" assets\js\pages\admin-user-add.js assets\js\features\signup assets\js\pages\signup-step*.js assets\js\pages\login.js
rg -n "createUserWithEmailAndPassword|signInWithEmailAndPassword|signOut|sendPasswordResetEmail|deleteUser|updatePassword|updateEmail|EmailAuthProvider|reauthenticate|verifyEmail|sendEmailVerification" assets\js -g "*.js"
rg -n "sendVerificationCode|verifyEmailCode|emailVerifications|signupAttempts|settings.*signup|termsAgreed|privacyAgreed|marketingConsent|school.csv|회원가입" assets\js\features\signup assets\js\pages functions\index.js firestore.rules -g "signup*.js" -g "signup-step*.js" -g "firestore.js" -g "*.rules" -g "index.js"
rg -n "Firebase Storage|getStorage|uploadBytes|getDownloadURL|deleteObject|firebase/storage|storageBucket|firebasestorage|storage.googleapis|gs://" . -g "*.js" -g "*.html" -g "*.json" -g "*.md" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!dist/**"
rg -n "TODO|FIXME|undefined content|content reference|popup|settings.*popups|public read|not launch-ready|런타임|placeholder|누락|bug|버그" assets\js\pages\home-popup.js assets\js\pages\admin-popup.js firestore.rules SITE_OPERATION_READINESS_AUDIT.md docs\FIREBASE_USAGE_AND_COST_AUDIT.md md\DATABASE_SCHEMA.md
Get-Content -TotalCount 80 -LiteralPath 'e deploy --only functions'
Get-Content -Raw -LiteralPath 'scripts\ensure-dist.js'
Get-Content -Raw -LiteralPath 'scripts\clean-unused.js'
Get-Content -Raw -LiteralPath 'scripts\split-css-v2.js'
(rg --files -g "!node_modules/**" -g "!functions/node_modules/**" -g "!dist/**" | Measure-Object).Count
rg --files -g "*.html" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!dist/**" | Measure-Object
rg --files -g "*.js" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!dist/**" | Measure-Object
rg --files -g "*.css" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!dist/**" | Measure-Object
rg --files -g "*.md" -g "!node_modules/**" -g "!functions/node_modules/**" -g "!dist/**" | Measure-Object
Get-Item -LiteralPath 'PROJECT_FULL_OVERVIEW_AUDIT.md'
```

다음 탐색 명령 일부는 Windows glob 또는 regex 문제로 경고/오류가 있었고, 후속 명령으로 재실행해 보완했습니다.

- `*.md`를 PowerShell/rg 조합으로 넘긴 일부 markdown 탐색
- `assets\js\pages\admin-*.js` 직접 경로 glob 탐색
- 따옴표가 섞인 signup regex 탐색 1회

## 19. Commands Not Run

### 명시적으로 실행하지 않은 작업

- deploy 실행하지 않음
- `firebase deploy` 실행하지 않음
- `npm run deploy`, `npm run deploy:hosting`, `npm run deploy:all`, `npm run deploy:phase1-member` 실행하지 않음
- source formatting command 실행하지 않음
- `npm run prebuild` 실행하지 않음
- `npm run verify` 실행하지 않음
- `npm run ready:deploy` 실행하지 않음
- `npm run clean` 또는 `scripts/clean-unused.js` 실행하지 않음
- `scripts/split-css-v2.js` 실행하지 않음
- Firestore production read/audit script 실행하지 않음
- Firestore data 수정/삭제 없음
- Firestore rules 수정 없음
- Functions 수정/배포 없음
- 기존 문서 수정 없음
- source code 수정 없음
- `dist` 수동 수정 없음

### 최종 확인

이 보고서는 실제 저장소 코드와 설정을 기준으로 작성했습니다. 기존 문서는 보조 문맥으로 사용했으며, 문서와 코드가 다를 때는 코드/규칙을 우선하고 drift를 별도로 표시했습니다.
