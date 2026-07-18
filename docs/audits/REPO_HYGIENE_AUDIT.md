# REPO_HYGIENE_AUDIT.md

## 1. Summary

### 확인된 사실

- 현재 작업트리는 매우 큽니다. `git status --short` 기준으로 수정 1,776건, 삭제 524건, 미추적 항목 25건이 보였고, `git ls-files --others --exclude-standard` 기준 미추적 파일은 26개입니다.
- 가장 큰 위생 위험은 `functions/node_modules/**`가 Git에 추적되어 있다는 점입니다. 현재 추적 파일 수는 5,850개이고, 그중 작업트리 상태에 나타난 변경은 2,170건입니다.
- 루트 `node_modules/.package-lock.json`도 1개 파일이 추적 중이며 수정 상태입니다.
- `.gitignore`에는 `node_modules`, `dist/`, `.firebase/`, `firebase-debug.log`, `firebase-debug.*.log`, `*.log`, `*.map`, `*.sourcemap`, `*.backup` 계열 패턴이 있습니다. 다만 이미 Git에 들어간 파일은 ignore 패턴만으로 추적이 해제되지 않습니다.
- `dist/` 폴더는 로컬에 존재하고 `build-report.json`, HTML, assets, `firestore.rules` 등 빌드 산출물을 포함하지만, `git ls-files "dist/**"` 결과 현재 추적 파일은 0개입니다.
- `firebase.json`의 Hosting 설정은 `"public": "dist"`입니다. 즉 `dist/`는 배포 입력 폴더이지만 저장소 소스라기보다 빌드 산출물로 취급되는 구조입니다.
- 루트 파일 `e deploy --only functions`는 미추적 파일이며 크기는 20,480바이트입니다. 내용은 `functions/package-lock.json`에 대한 Git diff 텍스트입니다.
- 루트 Markdown은 `.gitignore`의 `*.md`에 의해 기본적으로 무시됩니다. `PROJECT_FULL_OVERVIEW_AUDIT.md`와 이번 보고서 파일명 `REPO_HYGIENE_AUDIT.md`는 `git check-ignore -v`에서 무시 대상으로 확인되었습니다.
- 반대로 `docs/**/*.md`, `md/**/*.md`는 예외 처리되어 있어 `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`, `docs/research/KWMATH_TECH_SECURITY_REPORT.md`는 미추적이지만 Git에 추가 가능한 문서입니다.

### 권장 판단

- 커밋 전에 `functions/node_modules/**`와 루트 `node_modules/.package-lock.json` 추적 해제가 최우선입니다.
- `dist/`, `.firebase/`, 로그 파일은 현재 ignore 정책과 일치하므로 계속 커밋하지 않는 편이 맞습니다.
- 현재 소스 변경, 이미지 삭제, 신규 HTML/CSS/JS/문서 파일은 위생 문제와 기능 변경이 섞여 있으므로 한 번에 커밋하지 말고 소유자 검토 후 범위를 나누는 편이 안전합니다.

## 2. Definitely Should Not Be Tracked

### 확인된 사실

- `functions/node_modules/**`
  - Git 추적 파일: 5,850개
  - 현재 dirty 상태: 수정 1,685건, 삭제 485건
  - 예시 패키지: `@grpc`, `@opentelemetry`, `@firebase`, `google-gax`, `@google-cloud`, `firebase-admin`, `firebase-functions`
  - `.map`, README, LICENSE, compiled JS 등 수백 개의 생성/벤더 파일이 여기에 포함되어 있습니다.
- `node_modules/.package-lock.json`
  - 루트 `node_modules` 아래에서 추적 중인 파일 1개입니다.
  - `.gitignore`의 `node_modules` 패턴과 충돌하는 추적 잔여물입니다.
- `dist/**`
  - 현재 추적 파일은 0개입니다.
  - 로컬에는 존재하며 빌드 산출물로 보입니다.
  - 계속 추적하지 않아야 합니다.
- `.firebase/`, `firebase-debug.log`, `firebase-debug.*.log`, 일반 `*.log`
  - `.gitignore`에서 무시하도록 정의되어 있습니다.
  - `git status --ignored`에서 `.firebase/`와 `firebase-debug.log`가 ignored 상태로 보였습니다.
- `e deploy --only functions`
  - 현재 미추적입니다.
  - 파일 내용이 Git diff 텍스트이므로 프로젝트 소스나 설정 파일로 보기 어렵습니다.

### 권장 사항

- `functions/node_modules/**`와 `node_modules/.package-lock.json`은 삭제가 아니라 먼저 Git 인덱스에서만 제거해야 합니다.
- `dist/`, `.firebase/`, 로그 파일은 현재처럼 ignored 상태로 두고 커밋하지 않는 것이 맞습니다.
- `e deploy --only functions`는 커밋하지 말고, 필요한 diff 보존 여부를 확인한 뒤 삭제하거나 별도 노트로 옮기는 편이 안전합니다.

## 3. Should Be Kept

### 확인된 사실

- 다음 파일들은 프로젝트의 의존성, Firebase, 빌드, 보안 규칙의 원천 파일입니다.
  - `package.json`
  - `package-lock.json`
  - `functions/package.json`
  - `functions/package-lock.json`
  - `firebase.json`
  - `firestore.rules`
  - `functions/index.js`
  - `scripts/*.js`
- `functions/package.json`에는 현재 `firebase-admin` `^13.10.0`, `firebase-functions` `^7.2.5`, `nodemailer` `^8.0.11`, Node engine `22`가 기록되어 있습니다.
- 루트 `package.json`에는 `firebase-tools` `^15.20.0`과 배포 관련 스크립트가 기록되어 있습니다.
- `docs/**/*.md`, `md/**/*.md` 문서는 `.gitignore` 예외에 의해 추적 가능한 문서 영역입니다.
- 기존 추적 문서 중 `PROJECT_STATE.md`, `PROJECT_DOCS_INDEX.md`, `ONLINE_COURSE_SYSTEM_STATE.md`, `ADMIN_CMS_STATE.md`, `docs/IMAGE_ASSET_POLICY.md`, `md/DATABASE_SCHEMA.md`는 현재 수정 상태입니다.
- `assets/**/*.css`, `assets/**/*.js`, `members/**/*.html`, 루트 HTML 파일들은 사이트/관리자/회원 기능의 실제 소스 파일입니다.

### 권장 사항

- `package*.json`과 `functions/package*.json`은 의존성 변경이 의도된 경우 함께 커밋해야 합니다. 특히 package file과 lock file을 따로 커밋하면 재현성이 깨질 수 있습니다.
- `firebase.json`, `firestore.rules`, `functions/index.js`, `scripts/prebuild.js`는 기능/배포 동작에 직접 영향을 주므로 위생 커밋과 분리해 리뷰하는 것이 좋습니다.
- 신규 기능 파일로 보이는 HTML/CSS/JS는 생성물로 단정하지 말고 실제 기능 변경으로 검토해야 합니다.

## 4. Needs Owner Decision

### 확인된 사실

- 미추적 소스 후보 파일:
  - `assets/css/components/dashboard-modal.css`
  - `assets/css/components/dashboard-skeleton.css`
  - `assets/css/pages/admin-members.css`
  - `assets/css/pages/member-dashboard.css`
  - `assets/js/pages/admin-members.js`
  - `assets/js/pages/admin-operation-tasks.js`
  - `assets/js/pages/member-dashboard.js`
  - `assets/js/utils/dday.js`
  - `assets/js/utils/legal-policy.js`
  - `assets/js/utils/operation-tasks.js`
  - `members/admin/operation-tasks.html`
  - `members/admin/users/members.html`
  - `members/member/course.html`
  - `members/member/dashboard.html`
- 미추적 이미지/자산 후보:
  - `assets/instructors/curriculum/fg.png`
  - `assets/instructors/curriculum/zz.jpg`
  - `assets/popup/1_-.webp`
  - `assets/popup/3_-.webp`
  - `assets/popup/6_21.png`
  - `assets/popup/banner_main.png`
  - `assets/popup/favicon.png`
  - `assets/popup/main.png`
  - `assets/popup/open.png`
- 미추적 문서:
  - `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`
  - `docs/research/KWMATH_TECH_SECURITY_REPORT.md`
  - `PROJECT_FULL_OVERVIEW_AUDIT.md`는 존재하지만 루트 `*.md` ignore 규칙 때문에 무시됩니다.
  - `REPO_HYGIENE_AUDIT.md`도 같은 이유로 기본적으로 무시됩니다.
- 삭제 상태의 추적 이미지가 다수 있습니다.
  - `assets/darkmode.webp`
  - `assets/lightmode.webp`
  - `assets/logo.webp`
  - `assets/logo-dark.webp`
  - `assets/main.webp`
  - `assets/favicon.webp`
  - `assets/footer_logo.webp`
  - `assets/story/banner_main.png`
  - `assets/story/banner_main.webp`
  - `assets/popup/___1_______-__________.webp`
  - `assets/popup/___3_______-__________.webp`
  - `assets/instructors/curriculum/aaa.webp`
  - `assets/instructors/profile/profile.webp`
  - `assets/instructors/profile/down/*_profile.png`
  - `assets/instructors/profile/down/*_profile.webp`
- `.gitignore`의 한글 주석은 현재 터미널 출력에서 깨진 문자로 표시됩니다. 패턴 자체는 읽히지만, 주석 인코딩 정리는 별도 결정 사항입니다.

### 권장 사항

- 신규 HTML/CSS/JS는 기능 추가로 보이므로 커밋 여부를 기능 단위로 결정해야 합니다.
- 이미지 삭제는 현재 코드 참조뿐 아니라 CMS/Firestore 저장 경로 참조도 확인한 뒤 확정해야 합니다.
- `docs/FIREBASE_USAGE_AND_COST_AUDIT.md`와 `docs/research/KWMATH_TECH_SECURITY_REPORT.md`는 문서 자산으로 보이며, 보존할 가치가 있으면 일반 `git add` 대상입니다.
- 루트 감사 문서(`PROJECT_FULL_OVERVIEW_AUDIT.md`, `REPO_HYGIENE_AUDIT.md`)를 추적하려면 나중에 `.gitignore` 예외를 추가하거나 `git add -f`로 강제 추가해야 합니다. 이번 감사에서는 `.gitignore`를 수정하지 않았습니다.
- `e deploy --only functions`는 커밋하지 않는 것이 맞지만, 안에 들어 있는 diff가 필요한 기록인지 먼저 확인한 뒤 삭제해야 합니다.

## 5. Recommended Cleanup Plan

아래 명령은 권장 계획이며 이번 감사에서 실행하지 않았습니다.

### 1단계: 현재 상태 재확인

```powershell
git status --short
git diff --stat
git ls-files "functions/node_modules/**"
git ls-files "node_modules/**"
git ls-files "dist/**"
```

### 2단계: 의존성 폴더를 Git 추적에서만 제거

```powershell
git rm -r --cached functions/node_modules
git rm --cached node_modules/.package-lock.json
```

루트 `node_modules` 아래 추적 파일이 더 생긴 경우에는 다음처럼 범위를 넓힐 수 있습니다.

```powershell
git rm -r --cached node_modules
```

### 3단계: 빌드 산출물 추적 여부 확인

```powershell
git ls-files "dist/**"
```

만약 추적 파일이 나타날 경우에만 다음을 검토합니다.

```powershell
git rm -r --cached dist
```

### 4단계: 우발 파일 정리

소유자가 `e deploy --only functions` 안의 diff 내용을 더 이상 보존하지 않아도 된다고 확인한 뒤에만 실행합니다.

```powershell
Remove-Item -LiteralPath "e deploy --only functions"
```

### 5단계: 의도된 소스/문서만 선별 스테이징

예시는 범위 확인용입니다. 실제로는 기능 단위로 더 작게 나누는 편이 안전합니다.

```powershell
git add package.json package-lock.json functions/package.json functions/package-lock.json
git add firebase.json firestore.rules functions/index.js scripts/prebuild.js
git add docs/FIREBASE_USAGE_AND_COST_AUDIT.md docs/research/KWMATH_TECH_SECURITY_REPORT.md
```

루트 감사 문서를 추적하기로 결정한 경우에만 실행합니다.

```powershell
git add -f PROJECT_FULL_OVERVIEW_AUDIT.md REPO_HYGIENE_AUDIT.md
```

### 6단계: 무시 파일 삭제는 먼저 preview만 수행

```powershell
git clean -ndX
```

`git clean -fdX` 같은 실제 삭제 명령은 백업과 소유자 확인 없이 실행하지 않는 편이 안전합니다.

### 7단계: 최종 검증

```powershell
git status --short
git ls-files "functions/node_modules/**"
git ls-files "node_modules/**"
git ls-files "dist/**"
git check-ignore -v REPO_HYGIENE_AUDIT.md PROJECT_FULL_OVERVIEW_AUDIT.md
```

## 6. Risk Notes

### 확인된 사실

- `functions/package.json`과 `functions/package-lock.json`은 Firebase Functions 런타임 의존성의 기준입니다.
- `firebase.json`은 과거 Firebase Hosting public folder를 `dist`로 지정하지만, 현재 일반 운영 배포 기준은 Cloudflare Pages `dist` 배포입니다.
- 이미지 파일 삭제가 다수 있으며, 이 저장소는 `assets/` 아래 이미지를 직접 배포 자산으로 사용합니다.
- `PROJECT_FULL_OVERVIEW_AUDIT.md`와 `REPO_HYGIENE_AUDIT.md`는 루트 Markdown ignore 규칙 때문에 일반 `git status --short`에서 보이지 않을 수 있습니다.

### 위험

- `functions/node_modules`를 물리적으로 삭제하는 것은 로컬 개발 환경을 깨뜨릴 수 있습니다. 저장소 정리는 먼저 `git rm --cached`로 추적만 해제하고, 필요하면 `npm install` 또는 `npm --prefix functions install`로 복구해야 합니다.
- `functions/package-lock.json`을 잘못 되돌리거나 `functions/package.json`과 맞지 않게 커밋하면 Functions 배포 또는 에뮬레이터 실행이 실패할 수 있습니다.
- `dist/`를 Git에서 제거하는 것은 현재 구조상 맞아 보이지만, 만약 별도 GitHub Pages 방식이 `dist` 추적을 전제로 한다면 배포 방식 확인이 필요합니다. 현재 `firebase.json`만 보면 Firebase Hosting은 로컬 빌드된 `dist`를 배포 입력으로 사용합니다.
- 이미지 삭제를 코드 검색만으로 확정하면 위험합니다. Firestore/CMS에 저장된 URL이나 관리자 설정에서 참조할 수 있습니다.
- 루트 Markdown 보고서를 보존하려면 `.gitignore` 예외 또는 `git add -f`가 필요합니다. 그렇지 않으면 감사 문서가 로컬에만 남을 수 있습니다.
- `git clean -fdX`, `Remove-Item`, `git rm --cached` 등은 이번 감사에서 실행하지 않았습니다.

## 7. Commands Run

아래는 이번 감사에서 실행한 읽기 전용 명령입니다. 정리, 삭제, 포맷, 배포 명령은 실행하지 않았습니다.

```powershell
git status --short
Get-Content -Raw -LiteralPath ".gitignore"
git ls-files
git ls-files --others --exclude-standard
git status --short | ForEach-Object { if ($_.Length -ge 2) { $_.Substring(0,2) } else { $_ } } | Group-Object | Sort-Object Name | Select-Object Name,Count
$tracked = git ls-files "functions/node_modules/**"; "functions/node_modules tracked count: $($tracked.Count)"; $tracked | Select-Object -First 40
$tracked = git ls-files "node_modules/**"; "node_modules tracked count: $($tracked.Count)"; $tracked | Select-Object -First 40
$tracked = git ls-files "dist/**"; "dist tracked count: $($tracked.Count)"; $tracked | Select-Object -First 40
Get-Item -LiteralPath "e deploy --only functions" | Format-List FullName,Length,LastWriteTime,Attributes; Get-Content -LiteralPath "e deploy --only functions" -TotalCount 80
git status --short -- package.json package-lock.json functions/package.json functions/package-lock.json firebase.json firestore.rules functions/index.js scripts/prebuild.js docs PROJECT_FULL_OVERVIEW_AUDIT.md REPO_HYGIENE_AUDIT.md "e deploy --only functions"
git check-ignore -v -- PROJECT_FULL_OVERVIEW_AUDIT.md REPO_HYGIENE_AUDIT.md "e deploy --only functions" docs/FIREBASE_USAGE_AND_COST_AUDIT.md docs/research
Select-String -Path .gitignore -Pattern "node_modules|dist|firebase-debug|\.firebase|\*\.log|\*\.md|PROJECT_FULL_OVERVIEW|docs/\*\*/\*\.md" -CaseSensitive:$false
git ls-files --others --exclude-standard | Sort-Object
git status --ignored --short -- dist node_modules functions/node_modules .firebase firebase-debug.log PROJECT_FULL_OVERVIEW_AUDIT.md REPO_HYGIENE_AUDIT.md *.log
git ls-files "*.log" "firebase-debug.log" "firebase-debug.*.log" ".firebase/**" | Sort-Object
git status --short | ForEach-Object { $path = $_.Substring(3); if ($path -match '^"(.+)"$') { $path = $Matches[1] }; $top = ($path -split '/')[0]; [PSCustomObject]@{Status=$_.Substring(0,2); Top=$top} } | Group-Object Status,Top | Sort-Object Count -Descending | Select-Object -First 40 Count,Name
Get-Content -Raw -LiteralPath package.json
Get-Content -Raw -LiteralPath functions/package.json
git diff --stat -- package.json package-lock.json functions/package.json functions/package-lock.json firebase.json firestore.rules scripts/prebuild.js functions/index.js docs/IMAGE_ASSET_POLICY.md
if (Test-Path -LiteralPath dist) { Get-Item -LiteralPath dist | Format-List FullName,Attributes,LastWriteTime; Get-ChildItem -LiteralPath dist -Force | Select-Object -First 20 FullName } else { "dist directory does not exist" }
Get-Content -Raw -LiteralPath firebase.json
Get-Content -Raw -LiteralPath .gitignore
$tracked = git ls-files "functions/node_modules/**"; $tracked | ForEach-Object { ($_ -split '/')[2] } | Group-Object | Sort-Object Count -Descending | Select-Object -First 25 Name,Count
git status --short -- assets | ForEach-Object { $_ } | Select-Object -First 140
git status --short -- docs md *.md | Sort-Object
git ls-files "docs/**" "md/**" "*.md" | Sort-Object | Select-Object -First 200
git ls-files "assets/**/*.map" "*.map" "*.sourcemap" "build/**" ".build/**" "backup/**" "*.backup" "*.dev.backup" "assets/css/*.min.css" | Sort-Object
git ls-files package.json package-lock.json functions/package.json functions/package-lock.json firebase.json firestore.rules .gitignore scripts/*.js | Sort-Object
$files = git ls-files "*.map" "*.sourcemap" "build/**" ".build/**" "backup/**" "*.backup" "*.dev.backup" "assets/css/*.min.css"; $outside = $files | Where-Object { $_ -notlike "functions/node_modules/*" -and $_ -notlike "node_modules/*" }; "tracked generated-like outside node_modules count: $($outside.Count)"; $outside | Sort-Object
$ignored = git status --ignored --short -- dist node_modules .firebase firebase-debug.log firebase-debug.*.log *.log; $ignored | ForEach-Object { $_ } | Select-Object -First 80; "ignored status lines shown: $([Math]::Min(80, $ignored.Count)) of $($ignored.Count)"
git diff -- package.json functions/package.json firebase.json | Select-Object -First 220
git diff --name-status -- assets members docs md PROJECT_STATE.md PROJECT_DOCS_INDEX.md ONLINE_COURSE_SYSTEM_STATE.md ADMIN_CMS_STATE.md | Select-Object -First 220
if (Test-Path -LiteralPath "PROJECT_FULL_OVERVIEW_AUDIT.md") { Get-Item -LiteralPath "PROJECT_FULL_OVERVIEW_AUDIT.md" | Format-List FullName,Length,LastWriteTime } else { "PROJECT_FULL_OVERVIEW_AUDIT.md not found" }
if (Test-Path -LiteralPath "REPO_HYGIENE_AUDIT.md") { Get-Item -LiteralPath "REPO_HYGIENE_AUDIT.md" | Format-List FullName,Length,LastWriteTime } else { "REPO_HYGIENE_AUDIT.md not found before report creation" }
$status = git status --porcelain=v1; $fn = $status | Where-Object { $_ -like "* functions/node_modules/*" }; $rootNode = $status | Where-Object { $_ -like "* node_modules/*" }; "dirty functions/node_modules status lines: $($fn.Count)"; "dirty root node_modules status lines: $($rootNode.Count)"; $fn | ForEach-Object { $_.Substring(0,2) } | Group-Object | Sort-Object Name | Select-Object Name,Count
$u = git ls-files --others --exclude-standard; "untracked files count: $($u.Count)"; $u | Sort-Object
Get-Item -LiteralPath "REPO_HYGIENE_AUDIT.md" | Format-List FullName,Length,LastWriteTime
Select-String -Path "REPO_HYGIENE_AUDIT.md" -Pattern "^# |^## "
git status --ignored --short -- REPO_HYGIENE_AUDIT.md .gitignore
```
