# kor-to-eng

한글 파일명을 Cloudflare R2 같은 오브젝트 스토리지와 URL에서 깨지기 어려운 영문 파일명으로 바꿔 복사하는 도구입니다.

원본 파일은 그대로 두고, `input` 폴더 안의 모든 파일을 `output` 폴더로 복사합니다. 이미지뿐 아니라 PDF, HWP, DOCX, XLSX, ZIP 등 일반 파일을 모두 처리합니다.

## 사용 방법

1. `tools/kor-to-eng/input/` 폴더에 파일이나 폴더를 넣습니다.
2. 아래 명령 중 하나를 실행합니다.

```bash
npm run kor-to-eng
```

또는 Windows에서:

```bat
tools\kor-to-eng\run.bat
```

3. 결과는 `tools/kor-to-eng/output/` 폴더에 생성됩니다.

## 파일명 규칙

- 한글은 로마자 표기로 변환합니다.
- 영문은 소문자로 통일합니다.
- 공백, 괄호, 특수문자는 하이픈(`-`)으로 바꿉니다.
- 확장자는 소문자 ASCII로 정리합니다.
- 같은 이름이 겹치면 `-2`, `-3`처럼 번호를 붙입니다.

예시:

- `수업 자료 1.JPG` -> `sueop-jaryo-1.jpg`
- `중등_수학(개념).pdf` -> `jungdeung-suhak-gaenyeom.pdf`

## 추가 옵션

```bash
node tools/kor-to-eng/convert.js --dry-run
node tools/kor-to-eng/convert.js --no-overwrite
node tools/kor-to-eng/convert.js -o _r2-upload
node tools/kor-to-eng/convert.js "D:\some-folder"
```

`--dry-run`은 실제 복사 없이 결과 파일명만 미리 보여줍니다.
