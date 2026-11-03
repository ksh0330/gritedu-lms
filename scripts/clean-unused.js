// 사용하지 않는 파일 정리 스크립트
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

// 정리할 디렉토리/파일 목록
const CLEANUP_TARGETS = [
  'static',      // 번들된 파일 (사용하지 않음)
  'dist',        // 스크래핑 결과물
  'dist_backup', // 백업
  'node_modules/.cache', // 캐시
];

// .gitignore에 추가할 항목
const GITIGNORE_ADDITIONS = [
  'build/',
  '.build/',
];

function cleanDirectory(dirPath) {
  const fullPath = path.join(ROOT_DIR, dirPath);
  
  if (fs.existsSync(fullPath)) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`✅ 삭제: ${dirPath}/`);
      return true;
    } catch (error) {
      console.warn(`⚠️  ${dirPath}/ 삭제 실패:`, error.message);
      return false;
    }
  } else {
    console.log(`ℹ️  ${dirPath}/ 없음 (건너뜀)`);
    return false;
  }
}

function updateGitignore() {
  const gitignorePath = path.join(ROOT_DIR, '.gitignore');
  let gitignoreContent = '';
  
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  }
  
  let updated = false;
  GITIGNORE_ADDITIONS.forEach(item => {
    if (!gitignoreContent.includes(item)) {
      gitignoreContent += `\n${item}`;
      updated = true;
    }
  });
  
  if (updated) {
    fs.writeFileSync(gitignorePath, gitignoreContent);
    console.log('✅ .gitignore 업데이트 완료');
  } else {
    console.log('ℹ️  .gitignore 업데이트 불필요');
  }
}

function main() {
  console.log('🧹 불필요한 파일 정리 시작...\n');
  
  let cleaned = 0;
  CLEANUP_TARGETS.forEach(target => {
    if (cleanDirectory(target)) {
      cleaned++;
    }
  });
  
  updateGitignore();
  
  console.log(`\n✅ 정리 완료: ${cleaned}개 디렉토리 삭제`);
}

main();

