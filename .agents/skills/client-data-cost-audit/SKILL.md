---
name: client-data-cost-audit
description: Audit the GRIT Edu LMS browser code (assets/js/**, HTML pages, sw.js, build scripts) for Firestore read cost, unbounded queries, XSS, PII caching, Cloudflare Pages/R2 delivery, and docs-vs-code drift. Use for whole-repo sweeps of the static frontend and documentation.
---

# 클라이언트 · 비용 · 인프라 · 문서 정합성 감사

## 1. Firestore 사용 패턴 (비용·확장성)

`assets/js/**` 전체에서 다음을 검색하고 호출 지점을 표로 만든다: `getDocs(`, `getDoc(`, `onSnapshot(`, `query(`, `limit(`, `startAfter(`, `getCountFromServer(`, `writeBatch(`, `runTransaction(`.

- `limit` 없는 `getDocs`를 누적 컬렉션(`enrollments`, `offlineClassMembers`, `offlineSessionAccess`, `changeHistory`, `operationTasks`, `students`, `members`)에 쓰는 곳 → 데이터 증가 시 read 폭증
- 목록 렌더링 루프 안의 `getDoc` (N+1)
- 탭 전환·키 입력·모달 열기마다 재조회 (AGENTS.md는 Enter/버튼 검색, 페이지 메모리 캐시를 요구)
- 저장 후 전체 컬렉션 reload
- 각 지점마다 "현재 규모 / 1년 후 추정 규모에서의 read 수"를 대략 계산한다.

## 2. 보안 (브라우저)

- `innerHTML`, `insertAdjacentHTML`, `outerHTML` 사용처 중 Firestore·URL·사용자 입력이 이스케이프 없이 들어가는 곳 (`assets/js/utils/html.js`의 escape 함수 사용 여부 대조). CMS 관리자 입력도 공개 페이지에 렌더링되면 저장형 XSS다.
- `localStorage`/`sessionStorage`에 개인정보·수강·배정 데이터 저장 여부 (AGENTS.md 금지)
- 클라이언트에서만 하는 권한 판단 (Rules가 막지 않으면 우회 가능 → `firestore-rules-audit`와 교차 확인 필요로 표시)
- `assets/js/firebase-init.js`의 설정, App Check 초기화 여부
- `sw.js`가 로그인 이후 페이지·개인 데이터를 캐시하는지, 버전 갱신 시 오래된 JS가 남는지
- prebuild가 생성하는 Cloudflare Pages `_headers`(`scripts/prebuild.js`)의 CSP, `X-Frame-Options`, `Referrer-Policy`, 캐시 정책

## 3. 빌드·배포·이미지

- `scripts/prebuild.js`가 `dist`에 복사하는 대상이 화이트리스트인지, 내부 문서·스크립트·`.review/`·`.agents/`가 배포물에 섞일 가능성
- R2 공개 이미지 URL 조립(`assets/js/utils/public-image-url.js`, `image-upload.js`)과 업로드 경로: 클라이언트에 R2 쓰기 자격증명이 노출되지 않는지
- 캐시 버전(`version.json`) 갱신과 `no-cache` 헤더 정책 일관성

## 4. 문서 ↔ 코드 정합성

루트와 `docs/**`, `md/DATABASE_SCHEMA.md`의 주장 중 코드로 확인 가능한 것을 골라 표로 만든다.

| 문서:줄 | 문서 주장 | 코드 근거(파일:줄) | 판정(일치/불일치/코드에서 확인 불가) |

- 컬렉션·필드 이름, Functions 목록, Rules 정책, 보관기간, 배포 방식, npm 스크립트 이름을 우선 확인한다.
- 불일치는 P3로 기록하되, 운영자가 문서를 믿고 잘못 조작할 수 있는 경우(삭제·배포 절차)는 P2로 올린다.

## 5. 출력 시 주의

- 큰 컨텍스트로 많은 파일을 읽더라도, 줄 번호는 반드시 해당 파일을 다시 확인해서 쓴다.
- UI·디자인 변경 제안은 범위 밖. 결함 수정에 필요한 최소 변경만 제안한다.
