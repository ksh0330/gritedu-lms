# 빌드 및 배포 명령

최종 갱신: 2026-11-03

이 문서는 로컬 빌드, 정적 사이트 배포, Firestore Rules 배포, Cloud Functions 배포를 서로 혼동하지 않도록 명령과 범위를 정리한 운영 기준입니다.

## 1. 배포 구조

| 대상 | 서비스 | 프로젝트 또는 브랜치 | 배포 방식 |
| --- | --- | --- | --- |
| 정적 웹사이트 | Cloudflare Pages | 비공개 GitHub `gritedu/gritedu.github.io`의 `main` | `git push origin main` 후 자동 빌드·배포 |
| Auth·Firestore·Functions | Firebase | `gritedu-lms` | 필요한 대상만 Firebase CLI로 별도 배포 |
| 공개 이미지 | Cloudflare R2 | `assets.gritedu.kr` | 새 객체 업로드 후 CMS URL 변경 |
| Firebase Hosting | 사용하지 않음 | old URL은 404 유지 | 배포 금지 |

Cloudflare Pages의 설정은 다음과 같습니다.

| 항목 | 값 |
| --- | --- |
| Project | `gritedu` |
| Production branch | `main` |
| Build command | `npm run prebuild` |
| Build output directory | `dist` |
| Node version | `22` |

## 2. 빌드 명령

실제 빌드는 `scripts/prebuild.js`가 수행합니다.

```bash
npm run prebuild
```

표준 npm 명령으로 실행해도 됩니다.

```bash
npm run build
```

`npm run build`의 실행 순서는 다음과 같습니다.

```text
npm lifecycle prebuild
  └─ node scripts/prebuild.js       실제 빌드 1회

npm lifecycle build
  └─ node scripts/ensure-dist.js    dist 필수 파일 확인
```

따라서 `npm run prebuild`와 `npm run build` 모두 실제 빌드는 한 번만 수행합니다.

엄격한 빌드는 다음 두 명령 중 하나를 사용합니다. 두 명령 모두 실제 strict 빌드를 한 번 수행합니다.

```bash
npm run prebuild:strict
npm run build:strict
```

`npm run build:strict`도 npm lifecycle의 `prebuild:strict`가 실제 빌드를 담당하고, `build:strict` 단계에서는 생성된 `dist/`만 확인합니다.

빌드 결과만 다시 검사할 때는 다음 명령을 사용합니다.

```bash
npm run verify
npm run verify:strict
```

## 3. `dist/`를 Git에서 제외하는 이유

`dist/`는 소스가 아니라 빌드할 때마다 다시 생성되는 산출물입니다.

- 로컬에서는 `npm run prebuild` 또는 `npm run build`가 생성합니다.
- Cloudflare Pages는 `main` push를 감지한 뒤 깨끗한 환경에서 `npm run prebuild`로 다시 생성합니다.
- 따라서 `dist/`를 commit하거나 `git add -f dist`로 강제 추가하지 않습니다.
- 실제 배포 대상은 Cloudflare Pages가 생성한 `dist/`입니다.

## 4. 로컬 미리보기

권장: 빌드 후 `dist/`만 제공하는 단순 서버(로그인 불필요).

```bash
npm run local        # 빌드 + http://127.0.0.1:8000
npm run local:serve  # 기존 dist 재사용
```

Firebase CLI 기반 미리보기(`npm run preview` / `npm run serve`, `http://localhost:5000`)도 남아 있습니다. 소스를 고친 뒤에는 다시 빌드해야 화면에 반영됩니다.

주의: 로컬 페이지의 Firebase 클라이언트 설정은 운영 Firebase에 연결될 수 있습니다. 로컬 UI 확인 중 실제 운영 데이터를 수정하지 않습니다. Auth·Firestore까지 완전히 격리해서 시험해야 할 때만 에뮬레이터 연결 상태를 확인한 뒤 다음 명령을 사용합니다.

```bash
npm run emulators
```

## 5. 정적 웹사이트 배포

HTML, CSS, JavaScript, 로컬 `/assets` 파일을 변경했을 때 사용합니다.

권장 전체 검사:

```bash
npm run ready:deploy
git diff --check
git status
```

`ready:deploy`는 lint, strict build, strict build 검증, Firestore Rules 준비 검사, Functions 준비 검사를 수행합니다. 배포 자체는 수행하지 않습니다.

과목 공용 색상과 온라인 강좌 모달 초기화 변경은 정적 사이트 범위입니다. `functions/` 변경이 없으면 Functions를 추가하거나 재배포하지 않으며, `git push origin main`으로 Cloudflare Pages만 갱신합니다.

일반 검사만 수행하려면:

```bash
npm run build
npm run verify
git diff --check
git status
```

검사가 끝나면 소스만 commit하고 `main`에 push합니다.

```bash
git add .
git commit -m "작업 내용"
git push origin main
```

`main` push 후 Cloudflare Pages가 `npm run prebuild`를 다시 실행하여 `dist/`를 만들고 `https://gritedu.kr`에 자동 배포합니다. 이 저장소에는 GitHub Actions 배포 workflow가 없으며, Cloudflare Pages의 GitHub 연동이 배포 트리거입니다.

## 6. Firestore Rules 배포

`firestore.rules`를 변경했을 때만 별도로 배포합니다. 정적 사이트 push만으로는 Rules가 배포되지 않습니다.

```bash
npm run check:rules:strict
npm run deploy:rules
```

실제 배포 명령은 다음과 같습니다.

```bash
npx firebase deploy --only firestore:rules --project gritedu-lms
```

현재 `firebase.json`에는 Firestore index 배포 설정이 없습니다. 따라서 이 명령은 `firestore.rules`만 배포합니다.

복합 색인은 콘솔(또는 `gcloud firestore indexes composite create`)에서 관리합니다. 현재 필요한 것: `offlineClassSessions` — `classId` ↑, `status` ↑, `sessionDate` ↑ (학생 회차 목록). `firebase deploy --only firestore:indexes`는 쓰지 않습니다(콘솔 색인과 충돌 방지).

Rules 변경과 정적 변경이 서로 의존할 때는 "새 Rules 아래에서도 기존 화면이 동작하는가"를 먼저 따져 순서를 정합니다. 쿼리 모양이 바뀌는 경우 보통 색인 → 정적 → 데이터 보정 → Rules 순서입니다.

## 7. Cloud Functions 배포

`functions/` 코드를 변경했을 때만 별도로 배포합니다. 정적 사이트 push만으로는 Functions가 배포되지 않습니다.

전체 Functions 배포:

```bash
npm run check:functions:strict
npm run deploy:functions
```

현재 export된 Functions:

| Function | 유형 |
| --- | --- |
| `linkMemberChild` | callable HTTPS |
| `sendVerificationCode` | callable HTTPS |
| `verifyEmailCode` | callable HTTPS |
| `scheduledRecordCleanup` | scheduled Pub/Sub |

변경한 Function 하나만 배포하는 편이 안전하고 빠릅니다.

```bash
npx firebase deploy --only functions:linkMemberChild --project gritedu-lms
npx firebase deploy --only functions:sendVerificationCode --project gritedu-lms
npx firebase deploy --only functions:verifyEmailCode --project gritedu-lms
npx firebase deploy --only functions:scheduledRecordCleanup --project gritedu-lms
```

여러 개를 함께 배포할 때는 쉼표로 구분합니다.

```bash
npx firebase deploy --only "functions:sendVerificationCode,functions:verifyEmailCode" --project gritedu-lms
```

회원 이메일 인증 Functions 두 개와 Firestore Rules를 함께 배포하는 기존 제한 스크립트도 유지합니다.

```bash
npm run deploy:phase1-member
```

Functions 로그:

```bash
npm --prefix functions run logs
```

## 8. 변경 유형별 명령 선택

| 변경 내용 | 필요한 반영 |
| --- | --- |
| HTML·CSS·프런트엔드 JavaScript | build·검증 후 `main` push |
| 로컬 `/assets` 이미지·CSV·PDF | build·검증 후 `main` push |
| CMS가 Firestore에 저장하는 문구·팝업·시간표 | 코드 변경이 없다면 배포 불필요 |
| R2 공개 이미지 | 새 key로 업로드하고 CMS URL 변경; 코드 배포 불필요 |
| `firestore.rules` | `npm run deploy:rules` |
| `functions/` | 변경한 Function만 Firebase CLI로 배포 |
| Firebase Auth 사용자·설정 | 정적 빌드와 무관; Console 또는 별도 관리 절차 |

## 9. 사용하지 않는 명령

Firebase Hosting은 비활성화되어 있으므로 다음 명령은 일반 운영에서 사용하지 않습니다.

```bash
firebase deploy --only hosting
firebase deploy
```

특히 범위 없는 `firebase deploy`는 Hosting, Rules, Functions 등 의도하지 않은 대상을 함께 변경할 수 있으므로 사용하지 않습니다. 항상 `--only`와 `--project gritedu-lms`를 명시합니다.

## 10. Canonical 유지보수 체크리스트

1. `npm run local` 후 공개·학생·회원/학부모·강사·관리자 대표 화면을 수동 smoke test합니다. 로컬 페이지가 운영 Firebase에 연결될 수 있으므로 쓰기·삭제는 하지 않습니다.
2. `npm run build`, `npm run verify:strict`, `npm run check:rules:strict`, `npm run check:functions:strict`, `git diff --check`를 실행합니다. 한 번에 전체 검사할 때는 `npm run ready:deploy`를 사용합니다.
3. `git status`와 전체 diff에서 비의도 변경, 생성물, secret이 없는지 확인합니다.
4. 승인된 경우에만 commit/push합니다. `main` push는 Cloudflare Pages 정적 배포만 유발하며 Rules, Functions, indexes는 별도 명시 배포입니다.
5. 운영 smoke test에서 오류·권한 회귀·핵심 화면 문제를 발견하면 추가 반영을 중지하고 직전 정상 정적 배포로 rollback합니다.

로컬 민감값은 ignore된 `.env` 계열 파일에 저장하고 Functions 운영 비밀값은 Firebase Secret Manager를 사용합니다. 값이 없는 `.env.example`만 저장소에 둘 수 있으며 실제 `.env`, 계정 비밀번호, API key, 개인 데이터는 문서나 소스에 기록하지 않습니다.

## 11. 캐시와 버전

- 빌드가 HTML에 build version meta, JS/CSS URL과 로컬 ES module import·partial fetch·`school.csv`에 버전 query를 붙이고 `version.json`을 만듭니다. 새 버전이 있으면 화면 하단에 안내가 뜹니다.
- 캐시 정책은 빌드가 만드는 `dist/_headers`가 담당합니다. 배포 후 문제가 있으면 `/version.json`, HTML build version, JS/CSS query, 응답 헤더 순서로 확인합니다.
- 이미지·R2 객체는 같은 이름 덮어쓰기 대신 새 파일명/새 key를 씁니다(`docs/IMAGE_ASSET_POLICY.md`).

## 12. 테스트

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev\start-emulators.ps1        # Firestore 8080 + Auth 9099
powershell -ExecutionPolicy Bypass -File tools\dev\run-tests.ps1              # tests/*.test.js + functions
powershell -ExecutionPolicy Bypass -File tools\dev\start-emulators.ps1 -Stop
```

직접 실행할 때는 `node --test tests/*.test.js`, `npm run test:admin-operation-tasks`, `npm run test:firestore-crud`.

- Rules 테스트는 Firestore Emulator(127.0.0.1:8080)가 필요합니다. 한국어 Windows에서는 JVM 로케일 문제로 Rules 로드가 실패하므로 `java -Duser.language=en -Duser.country=US -jar cloud-firestore-emulator-*.jar --host 127.0.0.1 --port 8080`으로 실행합니다(Java 21). 테스트 프로세스에는 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`을 줍니다.
- `tests/instructor-lifecycle.test.js` 일부는 Auth Emulator(9099)가 필요합니다. 없으면 그 2건만 실패합니다.
