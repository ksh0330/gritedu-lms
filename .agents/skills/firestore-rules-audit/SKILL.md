---
name: firestore-rules-audit
description: Audit firestore.rules and the Firebase Auth role model of the GRIT Edu LMS for privilege escalation, data exposure, and missing field validation. Use when reviewing or changing firestore.rules, role checks, signup/profile creation, or parent-child links.
---

# Firestore Rules + Auth 감사 체크리스트

`.agents/rules/review-protocol.md`의 형식으로 보고한다. `firestore.rules` 전체(약 1,000줄)를 처음부터 끝까지 읽은 뒤 시작한다. 부분 발췌만 보고 판단하지 않는다.

## 1. 역할 모델 먼저 정리

- 역할 판정 함수(`isAdmin`, `isInstructor`, `isStudent`, `isMember` 등)를 표로 정리한다: 함수 / 근거 문서 경로 / 그 문서를 누가 create·update 할 수 있는지.
- **역할 문서를 본인이 만들 수 있으면 권한 상승이다.** `admins`, `instructorAccounts`, `instructors`, `students`, `members`, `parents`, `users` 각각에 대해 "비관리자 로그인 사용자가 자기 uid로 create 가능한가"를 확인한다.
- `isInstructor`처럼 legacy 컬렉션을 OR로 함께 보는 함수는 legacy 쪽 쓰기 권한이 막혀 있는지 확인한다.
- `exists()`/`get()` 호출 수: 한 요청 평가에서 문서 접근 상한(단일 문서 요청 10회, 배치·트랜잭션 20회)에 걸릴 수 있는 규칙을 표시한다.

## 2. 컬렉션별 매트릭스

모든 `match` 블록에 대해 역할(비로그인 / member / student / instructor / admin) × 작업(get / list / create / update / delete) 표를 만든다. 특히:

- `list` 권한이 `get`보다 넓어지는 경우 (쿼리로 타인 문서 열거)
- `allow read`가 `get`+`list`를 모두 여는데 의도는 단건 조회인 경우
- `update`에서 `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` 같은 필드 화이트리스트가 없는 경우 → 역할·상태·카운터 필드 자가 수정 가능 여부
- `create`에서 `keys().hasOnly()` / 타입 검사 / 길이 제한 부재
- `match /{document=**}` 기본 거부가 마지막에 있는지, 하위 컬렉션(`courses/{id}/enrollmentRequests` 등)이 의도대로 막히는지

## 3. 이 저장소의 고위험 경계 (AGENTS.md 근거)

- **가입 이메일 인증**: profile create Rules가 `emailVerifications`의 최근 검증 증표를 실제로 확인하는지, 증표를 다른 uid/이메일로 재사용할 수 있는지, 만료 확인이 서버 시간(`request.time`) 기준인지.
- **공개 `courses` 문서**: 비공개 상태 강좌의 영상 URL이 공개 문서에 같이 저장될 수 있는 경로가 있는지 (`coursePrivateContent` 분리가 rules로 강제되는지).
- **`studentParentLinks/{studentUid}_{memberUid}`**: 결정적 ID가 rules에서 `request.auth.uid`와 결합되는지, member가 임의 학생과 link를 직접 create 할 수 있는지, `members.linkedChildrenCount` 카운터를 직접 조작할 수 있는지.
- **`instructorPrivate`**: 강사 개인정보가 공개 `instructors` 문서와 분리되어 읽기 권한이 좁은지.
- **transient 컬렉션** (`emailVerifications`, `signupAttempts`, `memberChildLinkAttempts`): 클라이언트 쓰기·읽기가 막혀 있는지(Functions/Admin SDK 전용이어야 하는지 코드로 확인).
- **`enrollments`, `offlineClassMembers`, `offlineSessionAccess`**: 학생이 자기 수강 상태를 승인됨으로 바꾸거나 남의 수강 기록을 읽을 수 있는지.
- **`changeHistory`, `operationTasks`**: 감사 기록을 비관리자가 쓰거나 지울 수 있는지.

## 4. 클라이언트 코드와 대조

Rules만 보지 말고 실제 쿼리를 대조한다.

- `assets/js/**`에서 `collection(`, `query(`, `where(`, `getDocs(`, `setDoc(`, `updateDoc(`를 검색해 각 쿼리가 rules의 어떤 match에 걸리는지 확인한다.
- Rules가 허용하지 않는 쿼리를 코드가 쓰고 있으면 → 기능 장애(P1/P2).
- 코드는 쓰지 않는데 Rules가 열어 둔 권한 → 공격면(P0~P2).

## 5. 검증 방법 제안

- 저장소에 이미 `@firebase/rules-unit-testing` 기반 테스트(`tests/*-rules.test.js`, `tests/instructor-*.test.js`)가 있다. 새 테스트를 무겁게 만들지 말고, 발견 사항마다 "기존 테스트 파일에 추가할 케이스 1~3개"를 의사코드로 제안한다.
- 실행은 Emulator 전용: `firebase emulators:exec --only firestore --project gritedu-lms "node --test tests/<file>.test.js"` (Java 필요). 운영 프로젝트 대상 실행 금지.
- `npm run check:rules:strict`는 구조 점검일 뿐 권한 동작 테스트가 아니다.
