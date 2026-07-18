# Project Presentation Outline

최종 갱신: 2026-06-29

## 1. 한 줄 요약

Grit Edu LMS/CMS는 학원의 온라인 강의, 오프라인 수업, 회원/학생/강사 계정, 공개 시간표, 사이트 콘텐츠 운영을 Cloudflare Pages 정적 사이트와 Firebase backend로 관리하는 서비스입니다.

## 2. 문제와 배경

학원 운영에는 공개 사이트, 수강생 관리, 강사 관리, 온라인 강의, 오프라인 반, 시간표, 팝업 공지, 계정 정리가 함께 필요합니다. 각각을 별도 도구로 운영하면 데이터가 흩어지고, 운영자가 같은 정보를 여러 번 입력해야 하며, 비용과 관리 부담이 커집니다.

이 프로젝트는 큰 플랫폼을 처음부터 만드는 대신, 학원 운영에 필요한 핵심 흐름을 정적 웹과 Firebase로 단순하게 묶는 방향을 선택했습니다.

## 3. 서비스 개요

- 공개 사이트: 강의, 강사, 시간표, 학원 소개, 팝업 공지
- 학생/회원 영역: 수강 강의, 오프라인 반, 계정 정보
- 강사 영역: 담당 강의, 수강생, 오프라인 반
- 관리자 CMS: 계정, 강의, 반, 시간표, 콘텐츠, 팝업, 운영 정리

## 4. 사용자 역할

| 역할 | 주요 사용 목적 |
| --- | --- |
| 학생 | 온라인 강의 수강, 오프라인 수업 확인 |
| 일반 회원 | 본인 수강, 자녀 연결 |
| 학부모 회원 | 연결된 학생 정보 확인 |
| 강사 | 담당 강의/반/수강생 확인 |
| 관리자 | 전체 운영 관리 |
| 공개 방문자 | 강의, 강사, 시간표, 공지 확인 |

## 5. 주요 기능

완료된 기능:

- Firebase Auth 기반 로그인
- 학생/회원/강사/관리자 역할 분리
- 온라인 강의 목록/상세/수강 연결
- 오프라인 반/학생 배정/회차/접근 관리
- 공개 시간표
- 사이트/팝업 CMS
- 운영 cleanup center
- 로컬 `/assets` 이미지 운영과 WebP/prebuild workflow

보류된 기능:

- 결제
- DRM
- Native app
- Push/PWA
- Firebase Storage 업로드 CMS

## 6. 관리자 CMS

관리자 CMS는 운영자의 실제 업무 단위로 구성되어 있습니다.

- 대시보드
- 계정 생성/관리
- 학생 관리
- 회원 관리
- 강사 관리
- 온라인 강의 관리
- 오프라인 반 관리
- 공개 시간표 관리
- 사이트 관리
- 팝업 관리
- 운영 정리 센터

위험 작업은 학생/회원/강사/강의/반 삭제와 대량 cleanup입니다. 삭제 전 연결 데이터와 공개 노출 여부를 확인해야 합니다.

## 7. 기술 아키텍처

| 구성 | 현재 선택 |
| --- | --- |
| Frontend | 정적 HTML/CSS/JS |
| Hosting | Cloudflare Pages Git integration |
| Auth | Firebase Authentication |
| Database | Cloud Firestore |
| Functions | 이메일 인증, 회원-자녀 연결 보조 |
| Image | Cloudflare R2 public + 일부 로컬 `/assets` |
| Build output | `dist/` |

이 구조는 운영비를 낮추고 배포/운영을 단순하게 유지하는 데 초점이 있습니다.

## 8. Firebase 서비스 사용

사용 중:

- Firebase Authentication
- Cloud Firestore
- Cloud Functions for Firebase
- Secret Manager
- Cloud Build / Artifact Registry artifacts

사용하지 않음:

- Firebase Hosting 운영 배포/redirect 경로 (`firebase hosting:disable` 완료)
- Firebase Storage

Firebase Storage는 이미지 업로드 편의성이 있지만, 현재 단계에서는 비용/권한/삭제 정책이 복잡해지므로 도입하지 않았습니다.

## 9. 데이터와 보안 모델

- Firestore rules가 권한의 최종 경계입니다.
- `courses`는 공개 읽기 가능하므로 민감한 비공개 영상 데이터는 저장하지 않습니다.
- `users/*`와 `changeHistory`는 폐기/차단했습니다.
- 역할별 canonical collection을 사용합니다.
- 운영 cleanup은 관리자 권한 UI와 rules로 제한합니다.

## 10. 운영 모델

운영자는 CMS에서 데이터와 노출 상태를 관리합니다. 다만 이미지 파일 자체는 Firebase Storage가 아니라 로컬 `assets/**`에 배치해야 합니다.

운영 흐름:

1. 관리자 로그인
2. 계정/강의/반/시간표/팝업 관리
3. 필요한 이미지 파일을 로컬 assets에 배치
4. prebuild로 누락 경로와 WebP 산출 확인
5. Hosting 배포
6. 운영 cleanup center로 만료성 데이터 관리

## 11. 비용 통제 전략

- 정적 Hosting 중심으로 서버 비용 최소화
- Functions 사용을 이메일 인증/연결 보조로 제한
- Firebase Storage 미사용
- 이미지 WebP 최적화
- `dist/`와 `node_modules`를 Git에 추적하지 않음
- Firestore read가 큰 화면은 운영자 workflow 기준으로 관리

## 12. 현재 준비도

준비된 영역:

- 핵심 LMS/CMS 데이터 모델
- 관리자 CMS 주요 화면
- 온라인/오프라인 수업 운영 흐름
- 공개 시간표와 팝업 CMS
- 이미지 운영 정책
- repo hygiene 및 문서 구조 정리

운영 전 확인 필요:

- 실제 관리자 계정/권한 검증
- 주요 CMS 화면 수동 QA
- 공개 강의/시간표 노출 확인
- 이미지 경로와 파일 존재 확인
- 비용 알림 설정

## 13. 리스크와 열린 항목

- 공개 read 가능한 `courses`에 민감 데이터가 들어가면 안 됩니다.
- 공개 시간표는 오프라인 반의 live sync가 아니므로 운영자가 반영 상태를 확인해야 합니다.
- 이미지 경로와 실제 파일이 어긋나면 화면이 깨집니다.
- 결제/DRM은 현재 모델에 단순 추가할 수 없고 별도 설계가 필요합니다.
- Push/PWA는 운영 정책과 수신 동의 설계가 필요합니다.

## 14. Roadmap

단기:

- 관리자 CMS QA
- 운영자 교육
- 이미지 workflow 리허설
- Firestore 비용/권한 점검

중기:

- 운영 리포트 개선
- 공개 시간표 운영 편의 개선
- 강사/학생 대시보드 polish
- 알림 정책 검토

장기:

- 결제 모델 설계
- 비공개 영상/DRM 권한 모델 설계
- Storage 업로드 CMS 도입 여부 검토
- Native app 또는 PWA 검토

## 15. 12장 슬라이드 구성

| 장 | 제목 | 핵심 메시지 |
| --- | --- | --- |
| 1 | 서비스 한 줄 소개 | 학원 운영용 LMS/CMS |
| 2 | 운영 문제 | 데이터와 도구가 흩어지는 문제 |
| 3 | 해결 방향 | 정적 웹 + Firebase로 핵심 운영 통합 |
| 4 | 사용자 역할 | 학생/회원/학부모/강사/관리자 |
| 5 | 온라인 강의 | 공개/회원 전용 강의와 수강 연결 |
| 6 | 오프라인 수업 | 반/학생/회차/접근 관리 |
| 7 | 관리자 CMS | 실제 운영 업무 단위의 관리 화면 |
| 8 | 공개 사이트 | 강의/강사/시간표/팝업 |
| 9 | 기술 구조 | Hosting/Auth/Firestore/Functions |
| 10 | 보안/데이터 | rules, canonical collection, legacy 차단 |
| 11 | 비용 전략 | Storage 미사용, WebP, Functions 최소화 |
| 12 | 현재 준비도와 다음 단계 | 완료/보류/리스크 구분 |

## 16. 짧은 발표 스크립트

이 프로젝트는 학원 운영자가 온라인 강의와 오프라인 수업, 계정, 시간표, 팝업, 사이트 콘텐츠를 한곳에서 관리할 수 있도록 만든 Firebase 기반 LMS/CMS입니다.

핵심은 복잡한 서버 플랫폼을 먼저 만드는 것이 아니라, Cloudflare Pages 기반 정적 웹과 Firebase Auth, Firestore, 최소한의 Functions로 실제 운영에 필요한 기능을 안정적으로 묶는 것입니다.

현재 학생, 일반 회원, 학부모 회원, 강사, 관리자 역할이 분리되어 있고, 온라인 강의와 오프라인 반 모델도 별도로 정리되어 있습니다. 관리자는 CMS에서 계정, 강의, 반, 시간표, 팝업, 운영 정리 작업을 수행할 수 있습니다.

비용과 운영 복잡도를 낮추기 위해 Firebase Storage는 사용하지 않고, 공개 이미지는 Cloudflare R2 public URL과 일부 로컬 `/assets`로 관리합니다. 결제, DRM, 앱, Push/PWA, private 자료실/리포트는 아직 구현하지 않은 보류 항목이며, 도입 시 별도 권한/비용 설계가 필요합니다.

따라서 현재 상태는 운영 가능한 핵심 LMS/CMS 기반을 갖춘 단계이고, 다음 단계는 운영자 QA, 비용 모니터링, 그리고 결제/DRM 같은 확장 기능의 별도 설계입니다.
