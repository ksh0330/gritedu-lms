# PWA Lite Implementation Report

작성일: 2026-06-29

## 1. 작업 목적

`https://gritedu.kr`을 모바일/데스크톱에서 홈 화면에 추가 가능한 PWA Lite로 구성했다. 이번 범위는 완전한 오프라인 LMS가 아니라, 앱처럼 설치되는 웹사이트와 네트워크 장애 시 안내 fallback 제공에 한정했다.

## 2. 구현 범위

- 앱 아이콘 3종 생성
- Web App Manifest 추가
- 최소 오프라인 안내 페이지 추가
- 보수적인 Service Worker 추가
- Service Worker 등록 스크립트 추가
- 주요 공개 HTML 및 `members/**` HTML에 PWA head meta/link와 등록 스크립트 추가
- `scripts/prebuild.js`의 Cloudflare Pages 산출물 복사 및 `_headers` 생성 정책 보강

## 3. 생성 파일 목록

- `manifest.webmanifest`
- `offline.html`
- `sw.js`
- `assets/js/pwa-register.js`
- `assets/icons/icon-192.png`
- `assets/icons/icon-512.png`
- `assets/icons/apple-touch-icon.png`
- `docs/audits/PWA_LITE_IMPLEMENTATION_REPORT.md`

## 4. 수정 파일 목록

- `scripts/prebuild.js`
- `index.html`
- `contact.html`
- `course-detail.html`
- `courses.html`
- `instructor-details.html`
- `instructors.html`
- `privacy.html`
- `schedule.html`
- `story.html`
- `terms.html`
- `tuition.html`
- `404.html`
- `members/dashboard.html`
- `members/login.html`
- `members/signup.html`
- `members/member/dashboard.html`
- `members/member/course.html`
- `members/students/dashboard.html`
- `members/students/course.html`
- `members/students/offline-class.html`
- `members/instructors/dashboard.html`
- `members/instructors/course-detail.html`
- `members/instructors/offline-class.html`
- `members/admin/dashboard.html`
- `members/admin/courses.html`
- `members/admin/offline-classes.html`
- `members/admin/operation-tasks.html`
- `members/admin/popup.html`
- `members/admin/site.html`
- `members/admin/timetable.html`
- `members/admin/users/add.html`
- `members/admin/users/instructors.html`
- `members/admin/users/members.html`
- `members/admin/users/students.html`

## 5. 앱 아이콘 생성 방식

- 원본 favicon 경로: `assets/favicon.png`
- 원본 크기: 500x500 PNG
- 생성 방식: 프로젝트 devDependency인 `sharp`를 사용해 원본을 리사이즈했다.
- 생성 결과:
  - `assets/icons/icon-192.png`: 192x192
  - `assets/icons/icon-512.png`: 512x512
  - `assets/icons/apple-touch-icon.png`: 180x180
- `scripts/prebuild.js`의 이미지 정책에서 `assets/icons/*.png`를 PWA 설치 아이콘 원본 보존 대상으로 추가했다. Manifest가 PNG 경로를 직접 참조하므로 배포 산출물에서도 PNG가 유지되어야 한다.
- 한계: 원본이 500x500이므로 512x512 아이콘은 소폭 업스케일된다. 품질 저하 가능성은 낮지만, 더 선명한 설치 아이콘이 필요하면 1024px 이상 원본 로고로 재생성하는 것이 좋다.

## 6. Manifest 설정 요약

- `name`: `그릿에듀학원`
- `short_name`: `그릿에듀`
- `start_url`: `/`
- `scope`: `/`
- `display`: `standalone`
- `orientation`: `portrait-primary`
- `lang`: `ko-KR`
- `theme_color`: `#ff7a00`
- `background_color`: `#fffaf5`
- 아이콘: 192, 512, 180 PNG를 `purpose: "any"`로 선언했다.

## 7. Service Worker 캐시 전략

- cache 이름은 `PWA_LITE_VERSION` 상수 기반 `gritedu-pwa-lite-2026-06-29-pwa-lite-v1` 형식이다.
- install 단계에서 아래 파일만 precache한다.
  - `/offline.html`
  - `/assets/icons/icon-192.png`
  - `/assets/icons/icon-512.png`
  - `/assets/icons/apple-touch-icon.png`
- navigation 요청은 network-first로 처리한다.
- 네트워크 실패 시에만 `/offline.html` fallback을 반환한다.
- JS/CSS, Firebase SDK, Firestore/Functions 요청, 관리자/회원/학생/강사 LMS 화면은 cache-first로 처리하지 않는다.
- `skipWaiting()`, `clients.claim()`, 강제 reload, 반복 새로고침 유도 코드는 넣지 않았다.

## 8. 명시적으로 제외한 기능

- Push 알림
- Firebase Cloud Messaging
- Firestore offline persistence
- 관리자/회원 페이지 offline-first cache
- 학생/강사 dashboard/course/offline-class 계열 offline-first cache
- Firebase rules/functions 변경
- Firebase Auth/Firestore/Functions 동작 변경
- Cloudflare DNS, Cloudflare Pages Dashboard, Firebase Hosting 설정 변경

## 9. 위험요소

- 구버전 JS/CSS 캐시 위험: Service Worker가 JS/CSS를 cache-first로 잡지 않도록 했고, 기존 `version.json` 및 version query 흐름을 유지했다.
- 로그인/관리자 화면 캐시 위험: 해당 화면의 실제 HTML/JS 데이터를 precache하지 않는다. 오프라인에서는 기능 화면 대신 안내 페이지 fallback만 노출된다.
- iPhone/KakaoTalk 환경 차이: iOS Safari의 홈 화면 추가와 KakaoTalk 인앱브라우저의 Service Worker/설치 동작은 Android Chrome과 다를 수 있다.

## 10. 운영 전 수동 확인 체크리스트

- Manifest 인식 여부
- Service Worker 등록 여부
- `/version.json` 캐시 금지 유지
- 로그인 정상 여부
- 회원가입 정상 여부
- 관리자 CMS 정상 여부
- Android Chrome 홈 화면 추가
- iPhone Safari 홈 화면 추가
- KakaoTalk 인앱브라우저 동작 확인

참고용 권장 명령:

- `npm run prebuild`
- `npm run verify`
- `git diff --check`

위 명령은 운영자가 직접 필요한 시점에 실행해야 한다.

## 11. 검증 미실행

이번 작업에서는 요청에 따라 검증 명령을 실행하지 않았다. `npm run prebuild`, `npm run verify`, `git diff --check`, `git status`, `firebase deploy`, `npm run deploy`, Cloudflare/Firebase 배포 명령도 실행하지 않았다.

## 12. dist 및 인프라 변경 여부

- `dist/**`는 직접 수정하지 않았다.
- Firebase Auth/Firestore/Functions/rules 파일은 변경하지 않았다.
- Firebase Hosting 설정 파일과 Cloudflare DNS/Dashboard 설정은 변경하지 않았다.
