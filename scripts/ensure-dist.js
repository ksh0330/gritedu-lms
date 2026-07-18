// firebase serve / emulators 전에 dist 산출물이 있는지 확인
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const indexHtml = path.join(dist, 'index.html');
const firebaseInit = path.join(dist, 'assets', 'js', 'firebase-init.js');
const mainCss = path.join(dist, 'assets', 'css', 'main.css');

if (!fs.existsSync(indexHtml)) {
  console.error('❌ dist/index.html 이 없습니다.');
  console.error('   로컬 미리보기 전에 먼저 실행: npm run prebuild');
  console.error('   (또는 한 번에: npm run preview)');
  process.exit(1);
}

if (!fs.existsSync(firebaseInit)) {
  console.warn('⚠️  dist/assets/js/firebase-init.js 가 없습니다. prebuild 로그를 확인하세요.');
}
if (!fs.existsSync(mainCss)) {
  console.warn('⚠️  dist/assets/css/main.css 가 없습니다. prebuild 로그를 확인하세요.');
}

const commonJs = path.join(dist, 'assets', 'js', 'common.js');
if (!fs.existsSync(commonJs)) {
  console.warn('⚠️  dist/assets/js/common.js 가 없습니다. 대부분 페이지에서 필요합니다. npm run prebuild 를 실행하세요.');
}

const schoolCsv = path.join(dist, 'assets', 'school.csv');
if (!fs.existsSync(schoolCsv)) {
  console.warn('⚠️  dist/assets/school.csv 가 없습니다. 학교 검색이 필요하면 assets/school.csv 를 두고 prebuild 하세요.');
}

process.exit(0);
