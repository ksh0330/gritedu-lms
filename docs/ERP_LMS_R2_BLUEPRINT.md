# Grit Edu ERP/LMS 장기 방향성 청사진

최종 갱신: 2026-06-29
권장 저장 위치: `docs/ERP_LMS_R2_BLUEPRINT.md`

---

## 1. 결론

현재 프로젝트는 **Firebase 기반을 유지**하고, 정적 Hosting은 **Cloudflare Pages**, 공개/향후 private 파일 계층은 **Cloudflare R2**로 분리하는 방향이 가장 현실적입니다.

```text
Firebase = 로그인, 권한, Firestore DB, 관리자 CMS, ERP/LMS 핵심 데이터
Cloudflare Pages = 공개 정적 사이트, GitHub main push 자동 배포
Cloudflare R2 = 수업자료, PDF, 리포트, 포스터, 강사 참고 자료 이미지, 첨부파일
YouTube = 영상 업로드/공유
MathPlat = 문제은행, 오답노트, 교재, 리포트 생성
ACA2000 = 문자, 결제, 일부 운영 기능을 당분간 유지
```

Cloudflare 전체 이전은 지금 하지 않습니다.  
다만 장기적으로 Workers, D1, R2 구조를 이해한 뒤 필요하면 재검토합니다.

---

## 2. 현재 프로젝트 상태

현재 Grit Edu LMS/CMS는 다음 구조를 기준으로 운영됩니다.

```text
Frontend       : 정적 HTML/CSS/JS
Hosting        : Cloudflare Pages (`gritedu.kr`)
Auth           : Firebase Authentication
Database       : Cloud Firestore
Functions      : Cloud Functions for Firebase
File workflow  : 로컬 /assets + prebuild + Cloudflare Pages, mutable public image는 R2
Storage        : Firebase Storage 미사용
```

현재 구현된 영역:

- 공개 사이트
- 학생/회원/강사/관리자 로그인
- 온라인 강의
- 오프라인 반
- 수강 연결
- 관리자 CMS
- 공개 시간표
- 사이트/팝업 관리
- 운영 정리 센터
- 공식 도메인 `https://gritedu.kr` 기준의 SEO 1차 보강
- R2 public URL 기반 popup/instructor/story image 운영
- Firestore `pages/story` v2 기반 학원 안내 CMS 운영
- Firestore `pages/contact.structure.locations[]` 기반 상담 문의 CMS 운영
- Firebase Hosting disable 완료 및 old URL 404 유지

현재 보류된 영역:

- 결제
- 문자/SMS/알림톡 직접 연동
- PWA/Push
- 네이티브 앱
- Firebase Storage 업로드 CMS
- DRM/비공개 영상 보호
- `gritedu.online` 검색 제외 처리 후 재확인

2026-06-29 운영 메모:

- sitemap은 핵심 공개 페이지 6개(`/`, `/courses.html`, `/instructors.html`, `/contact.html`, `/schedule.html`, `/story.html`) 중심으로 유지합니다.
- `gritedu.kr` Search Console 속성에 `https://gritedu.kr/sitemap.xml` 제출이 완료되었고, 발견 페이지 6개와 주요 URL 색인 생성됨 상태를 확인했습니다.
- old `gritedu-lms.web.app` Search Console 속성은 임시 삭제 요청 처리 상태 확인용으로 유지하고, old Firebase Hosting URL은 404를 유지합니다.
- Naver Search Advisor old 도메인 검색 제외 요청은 완료되었습니다.
- `gritedu.online`은 과거 Adobe Portfolio 도메인이며 코드 제어보다 검색 제외 처리 후 재확인 대상으로 둡니다.
- Firebase Hosting old URL을 `gritedu.kr`로 301 redirect하지 않습니다.
- `www.gritedu.kr`, `gritedu.pages.dev`, Cloudflare Pages deployment alias는 `https://gritedu.kr` 301 redirect 완료 상태이며 path/query 보존 확인도 완료되었습니다.
- R2 custom domain `https://assets.gritedu.kr`은 운영 기준 URL이며, 기존 `r2.dev` URL은 과도기 호환으로 둡니다.
- R2 이미지 로딩 QA와 `gritedu.kr` 회원가입 QA 1차는 완료되었습니다.
- 기능 추가 우선순위와 rules 선행 조건은 과거 기능 로드맵 감사의 핵심 내용을 이 청사진에 병합한 것으로 봅니다.

---

## 3. 최종 목표

최종 목표는 단순 홈페이지가 아니라 다음 3개를 통합한 운영 시스템입니다.

```text
1. 공개 사이트
   - 학원 홍보
   - 강좌/강사/시간표
   - 공지
   - 수강후기
   - 네이버/구글 검색 노출

2. 학원 운영 ERP
   - 학생 관리
   - 학부모/회원 관리
   - 강사 관리
   - 반 관리
   - 출결
   - 과제
   - 성적/리포트
   - 자료 관리
   - 결제 정보
   - 문자/알림

3. 학생/학부모/강사 포털
   - 내 수업
   - 내 자료
   - 영상 URL
   - 과제
   - 출결
   - 성적/리포트
   - 공지
   - 수강후기
   - 나중에 앱/PWA
```

---

## 4. 플랫폼 선택 기준

### 4.1 Firebase 유지 이유

Firebase는 현재 프로젝트의 핵심 역할을 이미 담당하고 있습니다.

- Firebase Auth로 사용자 로그인 관리
- Firestore rules로 권한 경계 설정
- Firestore로 학생/회원/강사/강좌/반/수강 데이터 관리
- Cloud Functions로 필요한 서버 보조 로직 처리
- 관리자 CMS가 이미 Firebase 구조에 맞춰 구현됨

따라서 Firebase를 버리면 다음을 다시 만들어야 합니다.

```text
- Auth
- 권한 체계
- 관리자 CMS CRUD
- Firestore rules에 해당하는 API 권한검사
- 학생/학부모/강사 역할 판정
- 강좌/반/수강 연결 모델
- 데이터 마이그레이션
```

지금 단계에서는 전체 이전보다 **파일 계층 분리**가 더 효율적입니다.

### 4.2 Cloudflare 전체 이전 보류 이유

Cloudflare Pages/Workers/D1/R2 전체 이전은 가능하지만, 지금은 보류합니다.

이유:

- Workers API에서 권한 검사를 직접 구현해야 함
- Firestore rules 같은 내장 문서 권한 모델이 없음
- Auth를 별도로 설계해야 함
- D1 SQL 스키마를 새로 설계해야 함
- 관리자 CMS를 대부분 재작성해야 함
- 비개발자 운영 안정성이 떨어질 수 있음

Cloudflare는 지금 전체 플랫폼이 아니라 **R2 파일 저장소**로 먼저 사용합니다.

### 4.3 AWS 제외 이유

AWS는 강력하지만 현재 규모와 운영자 수준에 비해 과합니다.

예상 구성:

```text
S3 + CloudFront + Lambda + Cognito + DynamoDB/RDS + IAM
```

문제:

- IAM/권한 설정 복잡
- 비용 구조가 분산됨
- 비개발자 운영 난이도 높음
- 초기 생산성 낮음

따라서 AWS는 지금 선택하지 않습니다.

---

## 5. 권장 최종 아키텍처

```text
[Public Site]
Cloudflare Pages
- 홈페이지
- 강사/강좌/시간표
- 공지 일부
- 수강후기
- SEO 페이지

[Auth]
Firebase Authentication
- 학생
- 학부모/회원
- 강사
- 관리자

[ERP/LMS DB]
Cloud Firestore
- students
- members
- studentParentLinks
- instructors
- instructorAccounts
- courses
- enrollments
- offlineClasses
- offlineClassMembers
- offlineClassSessions
- offlineSessionAccess
- notices
- reviews
- materials
- scores
- studentReports
- attendanceRecords
- assignments

[Server Logic]
Cloud Functions
- 관리자 권한 검증
- R2 업로드 URL 발급
- R2 다운로드 signed URL 발급
- 다운로드 로그 기록
- 나중에 문자/결제 webhook

[File Storage]
Cloudflare R2
- 수업자료 PDF
- 학생별 리포트 PDF
- 포스터
- 강사 참고 자료 이미지
- Story 공개 이미지
- 과제 첨부
- 공지 첨부 이미지

[Video]
YouTube
- 공개 영상
- 일부 공개 보충 영상
- 나중에 보호 영상은 Vimeo/Cloudflare Stream 검토

[External Systems]
ACA2000
- 문자
- 결제
- 일부 출결/운영
- 최종 단계까지 병행

MathPlat
- 문제은행
- 교재
- 오답노트
- PDF 리포트 생성
- 계속 사용
```

---

## 6. `/assets`와 R2 역할 분리

현재 `/assets` workflow는 유지하되, 역할을 축소합니다.

### 6.1 `/assets` 유지 대상

```text
- 로고
- favicon
- 홈 메인 이미지
- 고정 배너
- 기본 사이트 이미지
- 장기간 바뀌지 않는 강사 기본 이미지
- 공통 아이콘
```

이 파일들은 소스에 포함하고, `npm run prebuild` 후 연결된 production branch에 push하여 Cloudflare Pages로 배포합니다. `npm run deploy` 또는 `firebase deploy --only hosting`은 일반 운영에서 사용하지 않습니다.

### 6.2 R2로 이동할 대상

```text
- 수업자료 PDF
- 학생별 리포트 PDF
- 성적표
- 과제 첨부파일
- 공지 이미지
- 팝업 이미지
- Story 상단 배너/대표 사진
- 포스터
- 강사 참고 자료 이미지
- 자주 바뀌는 강사/강좌 관련 이미지
- 다운로드가 발생하는 학습 자료
```

관리자가 CMS에서 직접 업로드/삭제/교체할 수 있어야 합니다.

2026-06-29 현재 실제 적용 사례:

- Story 학원 안내의 상단 배너와 대표 사진은 R2 public URL을 CMS에 저장합니다.
- 공식 prefix는 `https://assets.gritedu.kr/public/story/`이며, 필요 시 `https://assets.gritedu.kr/public/pages/story/`도 허용합니다.
- Story 이미지는 public 홍보 이미지로만 사용하고, 학생별 리포트/PDF/자료실/과제 첨부 같은 private 파일과 섞지 않습니다.
- private 자료실/리포트/PDF는 아직 미구현이며, R2 private + signed URL + 권한 확인 + 다운로드 로그 설계 후 진행합니다.

---

## 7. R2 파일 관리 구조

### 7.1 R2 버킷 개념

R2 버킷은 파일 보관함입니다.

예시:

```text
grit-materials/
  notices/2026/notice-poster.webp
  materials/offline-class-a/chapter-03.pdf
  reports/student-uid/report-2026-06.pdf
  curriculum/2026-summer/math-curriculum.webp
```

R2에는 파일만 저장합니다.  
파일의 제목, 대상 학생, 반, 공개 여부, 다운로드 권한은 Firestore에 저장합니다.

### 7.2 다운로드 흐름

```text
1. 학생/학부모/강사가 로그인
2. 자료실에서 자료 클릭
3. Cloud Function 호출
4. Firebase Auth uid 확인
5. Firestore에서 자료 접근 권한 확인
6. R2 signed URL 발급
7. 사용자는 제한 시간 동안 다운로드
8. Firestore에 다운로드 로그 저장
```

### 7.3 업로드 흐름

```text
1. 관리자가 CMS에서 파일 선택
2. Cloud Function이 관리자 권한 확인
3. R2 업로드용 URL 또는 서버 업로드 처리
4. R2에 파일 저장
5. Firestore materials/studentReports 문서 생성
6. 대상 학생/반/강좌/회원에게 노출
```

운영자는 Cloudflare Dashboard에 들어가지 않고, 관리자 CMS만 사용합니다.

---

## 8. 신규 Firestore 컬렉션 초안

### 8.1 `notices/{noticeId}`

공지사항입니다.

```text
- title
- body
- targetType: all | students | members | course | offlineClass | student
- targetIds
- attachmentIds
- pinned
- status: draft | published | hidden
- publishedAt
- createdBy
- createdAt
- updatedAt
```

### 8.2 `reviews/{reviewId}`

수강후기입니다.

```text
- userId
- studentUid
- courseId
- offlineClassId
- rating
- body
- displayName
- status: pending | approved | hidden
- createdAt
- updatedAt
```

### 8.3 `materials/{materialId}`

수업자료 metadata입니다.

```text
- title
- description
- fileName
- fileType
- fileSize
- provider: r2
- r2Key
- targetType: all | course | offlineClass | student | member
- targetIds
- visible
- downloadable
- createdBy
- createdAt
- updatedAt
```

### 8.4 `materialAccessLogs/{logId}`

자료 조회/다운로드 로그입니다.

```text
- materialId
- userId
- role
- action: view | download
- createdAt
- userAgent
```

### 8.5 `scores/{scoreId}`

학생이 직접 입력하거나 관리자가 입력하는 성적 기록입니다.

```text
- studentUid
- examName
- subject
- score
- gradeLevel
- examDate
- memo
- source: student | admin | import
- createdBy
- createdAt
- updatedAt
```

### 8.6 `studentReports/{reportId}`

학생별 리포트입니다.

```text
- studentUid
- title
- summary
- period
- fileId
- visibleToStudent
- visibleToParent
- createdBy
- createdAt
- updatedAt
```

### 8.7 `attendanceRecords/{recordId}`

출결 확인용 기록입니다.

```text
- studentUid
- classId
- sessionId
- date
- status: present | late | absent | makeup
- memo
- createdBy
- createdAt
- updatedAt
```

### 8.8 `assignments/{assignmentId}`

과제 확인용 기록입니다.

```text
- title
- description
- classId
- courseId
- targetType
- targetIds
- dueDate
- materialIds
- status
- createdBy
- createdAt
- updatedAt
```

### 8.9 `assignmentSubmissions/{submissionId}`

과제 제출/확인 상태입니다.

```text
- assignmentId
- studentUid
- status: notStarted | submitted | checked | missing
- submittedAt
- checkedAt
- memo
- attachmentIds
- createdAt
- updatedAt
```

---

## 9. 기능 개발 우선순위

### Phase 1. 운영 기능 확장

외부 업체 없이 만들 수 있는 기능부터 진행합니다.

```text
1. 공지사항
2. 수강후기
3. 자료 metadata
4. 학생 성적 입력/조회
5. 학생/학부모 포털 UX 개선
```

QnA는 초기 우선순위에서 제외합니다.

### Phase 2. R2 자료실

```text
1. R2 버킷 생성
2. R2 접근 키 발급
3. Cloud Functions에서 R2 연동
4. 관리자 파일 업로드 UI
5. 학생/학부모 다운로드 UI
6. 다운로드 로그 저장
7. 파일 삭제/교체 UI
```

### Phase 3. 리포트/성적

```text
1. MathPlat PDF 리포트 업로드
2. 학생별 리포트 연결
3. 학생/학부모 조회
4. 학생 직접 성적 입력
5. 과목별/시험별 추이 그래프
```

### Phase 4. 출결/과제

```text
1. 출결 기록 조회
2. 관리자/강사 출결 입력
3. 과제 등록
4. 학생별 과제 상태 확인
```

### Phase 5. 포털 고도화

```text
학생 포털:
- 내 수업
- 내 자료
- 내 성적
- 내 리포트
- 내 출결
- 내 과제

학부모 포털:
- 자녀별 수업
- 자녀별 자료
- 자녀별 성적/리포트
- 자녀별 출결/과제
```

### Phase 6. 나중 기능

```text
- 공부량 기록
- 월별 랭킹
- 반별 경쟁 시스템
- PWA/Push
- 문자 API
- 결제 PG
- 앱스토어 배포
```

---

## 10. 비용 관리 원칙

### 10.1 Firestore 비용 통제

Firestore 비용은 주로 read/write/delete에서 발생합니다. 다음 원칙을 지킵니다.

```text
- 관리자 목록은 페이지네이션 사용
- 대시보드는 summary 문서 사용
- 실시간 listener 남발 금지
- 공개 페이지는 필요한 데이터만 읽기
- 학생 포털은 본인 데이터만 읽기
- 반/강좌별 자료는 target index를 명확히 설계
- 다운로드 로그는 월별 파티셔닝 검토
```

### 10.2 R2 비용 통제

R2는 파일 다운로드에 유리하지만, 무제한 저장소처럼 쓰면 안 됩니다.

```text
- 영상 원본 저장 금지
- 대용량 영상은 YouTube/Vimeo 사용
- PDF/이미지는 압축 후 업로드
- 오래된 자료 보관/숨김 정책 필요
- 파일 삭제/교체 기록 관리
```

### 10.3 Functions 비용 통제

Cloud Functions는 필요한 곳에만 사용합니다.

```text
Functions 사용 대상:
- R2 업로드/다운로드 권한 검증
- signed URL 발급
- 다운로드 로그 기록
- 나중에 결제 webhook
- 나중에 문자 API 발송

Functions 사용 지양:
- 단순 목록 조회
- 공개 페이지 렌더링
- 반복적인 대량 집계
```

현재 규모에서는 R2 signed URL 발급 정도의 Functions 호출은 큰 비용 리스크가 아닙니다.

---

## 11. Cloudflare 전체 이전 재검토 기준

아래 조건이 여러 개 충족될 때만 Cloudflare 전체 이전을 다시 검토합니다.

```text
- Firebase 구조 유지보수가 어려워짐
- Firestore rules가 지나치게 복잡해짐
- 관리자 CMS를 전면 재작성해야 함
- D1/Workers/R2 운영 경험이 충분히 생김
- Auth를 별도 관리형 서비스로 안정화할 수 있음
- 실제 사용자 데이터 마이그레이션 부담이 작음
- Cloudflare 기반으로 새 제품을 다시 만드는 편이 더 낫다고 판단됨
```

전체 이전 후보 구조:

```text
Cloudflare Pages
Cloudflare Workers
Cloudflare D1
Cloudflare R2
관리형 Auth 또는 별도 Auth 서비스
```

단, 지금은 보류합니다.

---

## 12. 비개발자 운영 원칙

운영자는 Firebase Console이나 Cloudflare Dashboard를 직접 만지지 않습니다.

운영자가 사용할 화면:

```text
- 관리자 CMS
- 학생 관리
- 반 관리
- 강사 관리
- 공지 관리
- 자료 관리
- 리포트 관리
- 출결/과제 관리
```

개발자/최고관리자만 볼 화면:

```text
- Firebase Console
- Cloudflare Dashboard
- GitHub
- Cursor/Codex
- 비용/로그/권한 설정
```

목표는 **Cloudflare와 Firebase를 모르는 운영자도 CMS만으로 운영할 수 있게 만드는 것**입니다.

---

## 13. 개인정보 처리방침/약관 반영 필요 항목

R2와 자료실/리포트 기능을 도입하면 개인정보 처리방침에 다음을 반영해야 합니다.

```text
- Cloudflare R2 파일 저장 위탁 여부
- 자료/리포트 파일 보관 목적
- 학생 성적 정보 처리 목적
- 다운로드 로그 수집 여부
- 학부모 열람 범위
- 파일 보관 기간
- 파일 삭제 요청 절차
- 접근 권한 관리 방식
```

나중에 추가될 기능별 항목:

```text
문자/SMS/알림톡:
- 수신 동의
- 발송 대행사
- 발송 로그
- 광고성/정보성 구분

결제:
- PG사 위탁
- 결제 정보 처리
- 환불/취소 기록
- 영수증/정산 정보

PWA/Push:
- 푸시 알림 동의
- 기기 토큰 저장
- 수신 철회
```

---

## 14. 하지 말 것

```text
- Cloudflare 전체 이전을 지금 바로 하지 말 것
- D1로 DB를 지금 바로 갈아타지 말 것
- 자체 Auth/JWT 로그인 구조를 새로 만들지 말 것
- 학생 자료를 공개 URL로 직접 노출하지 말 것
- courses 문서에 비공개 영상 URL/결제 권한/DRM 토큰을 넣지 말 것
- 운영자가 Firebase Console/Cloudflare Dashboard에서 직접 데이터를 수정하게 하지 말 것
- 영상 파일을 직접 R2에 대량 저장하지 말 것
- 문자/결제부터 붙이지 말 것
```

---

## 15. 바로 다음 작업

```text
1. Cloudflare Pages `_headers` live QA와 forbidden URL live QA 완료
2. Google Search Console old `gritedu-lms.web.app` 임시 삭제 요청 처리 상태와 404 유지 상태 확인
3. `gritedu.online` 검색 제외 처리 후 재확인
4. 신규 컬렉션 설계 확정
5. 공지사항/수강후기/자료 metadata부터 구현
```

추천 Codex 지시:

```text
Read docs/ERP_LMS_R2_BLUEPRINT.md and current source-of-truth docs.
Do not modify code.
Produce a read-only implementation plan for Phase 1 and Phase 2:
- notices
- reviews
- materials metadata
- R2 upload/download architecture
- Firestore rules impact
- admin CMS affected files
- student/parent portal affected files
- migration from /assets to R2 for variable files only
```

---

## 16. 최종 판단

현재 최선의 방향은 다음입니다.

```text
Firebase 유지
+ Cloudflare R2 파일 저장소 추가
+ /assets는 고정 공개 이미지 전용으로 축소
+ 공지/후기/자료실/성적/리포트/포털 순서로 개발
+ 문자/결제/앱은 최종 단계로 보류
```

이 방향은 현재 작업량을 살리면서, 장기적으로 자료 업로드/다운로드 비용과 운영 편의성을 개선하는 가장 안정적인 선택입니다.
