const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const MAIN_CSS = path.join(ROOT_DIR, 'assets', 'css', 'main.css');
const CSS_DIR = path.join(ROOT_DIR, 'assets', 'css');

// CSS 내용 읽기
const mainCssContent = fs.readFileSync(MAIN_CSS, 'utf8');
const lines = mainCssContent.split('\n');

console.log('📦 CSS 분리 시작...\n');

// 라인 번호로 섹션 찾기
function findSection(startPattern, endPattern) {
  let startIdx = -1;
  let endIdx = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (startIdx === -1 && startPattern.test(lines[i])) {
      startIdx = i;
    }
    if (startIdx !== -1 && endPattern.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  
  if (startIdx === -1) return null;
  if (endIdx === -1) endIdx = lines.length;
  
  return lines.slice(startIdx, endIdx).join('\n');
}

// 1. Variables (1-55줄)
const variables = findSection(/^:root\s*\{/, /^@media\s+\(prefers-color-scheme:dark\)\s*\{/) || 
  mainCssContent.substring(0, mainCssContent.indexOf('*,:after,:before')).trim();
if (variables) {
  const filePath = path.join(CSS_DIR, 'base', 'variables.css');
  fs.writeFileSync(filePath, variables, 'utf8');
  console.log(`✅ variables.css: ${variables.split('\n').length}줄`);
}

// 2. Reset (56-101줄)
const reset = findSection(/^\*,\s*:after,\s*:before\s*\{/, /^\.visually-hidden\s*\{/) ||
  mainCssContent.match(/(\*,\s*:after,\s*:before\s*\{[\s\S]*?\.visually-hidden\s*\{[\s\S]*?\n\})/)?.[0];
if (reset) {
  const filePath = path.join(CSS_DIR, 'base', 'reset.css');
  fs.writeFileSync(filePath, reset, 'utf8');
  console.log(`✅ reset.css: ${reset.split('\n').length}줄`);
}

// 3. Typography (html, body, a 등)
const typography = findSection(/^html\s*\{/, /^\.grit-page-container\s*\{/) ||
  mainCssContent.match(/(html\s*\{[\s\S]*?)(?=\.grit-page-container)/)?.[0];
if (typography) {
  const filePath = path.join(CSS_DIR, 'base', 'typography.css');
  fs.writeFileSync(filePath, typography, 'utf8');
  console.log(`✅ typography.css: ${typography.split('\n').length}줄`);
}

// 4. Card
const card = findSection(/^\.card\s*\{/, /^\.btn\s*\{/) ||
  mainCssContent.match(/(\.card[^{]*\{[\s\S]*?)(?=\.btn[^{]*\{)/)?.[0];
if (card) {
  const filePath = path.join(CSS_DIR, 'components', 'card.css');
  fs.writeFileSync(filePath, card, 'utf8');
  console.log(`✅ card.css: ${card.split('\n').length}줄`);
}

// 5. Button
const button = findSection(/^\.btn\s*\{/, /^\.grit-section\s*\{/) ||
  mainCssContent.match(/(\.btn[^{]*\{[\s\S]*?)(?=\.grit-section)/)?.[0];
if (button) {
  const filePath = path.join(CSS_DIR, 'components', 'button.css');
  fs.writeFileSync(filePath, button, 'utf8');
  console.log(`✅ button.css: ${button.split('\n').length}줄`);
}

// 6. Header (2734-3212줄)
const header = findSection(/^:root\s*\{\s*--nav-item-w:/, /^body\.nav-open\s*\{/) ||
  mainCssContent.match(/(:root\s*\{\s*--nav-item-w:[\s\S]*?body\.nav-open\s*\{[\s\S]*?\n\})/)?.[0];
if (header) {
  const filePath = path.join(CSS_DIR, 'components', 'header.css');
  fs.writeFileSync(filePath, header, 'utf8');
  console.log(`✅ header.css: ${header.split('\n').length}줄`);
}

// 7. Footer (3982-4147줄)
const footer = findSection(/^\.grit-footer\s*\{/, /^\.schedule-filter\s*\{/) ||
  mainCssContent.match(/(\.grit-footer\s*\{[\s\S]*?)(?=\.schedule-filter)/)?.[0];
if (footer) {
  const filePath = path.join(CSS_DIR, 'components', 'footer.css');
  fs.writeFileSync(filePath, footer, 'utf8');
  console.log(`✅ footer.css: ${footer.split('\n').length}줄`);
}

// 8. Admin (3869-3968줄)
const admin = findSection(/^\.admin-tabs\s*\{/, /^\.modal\.active\s*\{/) ||
  mainCssContent.match(/(\.admin-tabs\s*\{[\s\S]*?)(?=\.modal\.active|\.student-dashboard)/)?.[0];
if (admin) {
  const filePath = path.join(CSS_DIR, 'pages', 'admin.css');
  fs.writeFileSync(filePath, admin, 'utf8');
  console.log(`✅ admin.css: ${admin.split('\n').length}줄`);
}

// 9. Student (3639-3691줄)
const student = findSection(/^\.student-dashboard\s*\{/, /^\.lightbox-container\s*\{/) ||
  mainCssContent.match(/(\.student-dashboard\s*\{[\s\S]*?)(?=\.lightbox-container|\.mt-0)/)?.[0];
if (student) {
  const filePath = path.join(CSS_DIR, 'pages', 'student.css');
  fs.writeFileSync(filePath, student, 'utf8');
  console.log(`✅ student.css: ${student.split('\n').length}줄`);
}

// 10. Public (나머지 공개 페이지 스타일)
// course, notice, qna, gallery, home, instructor, contact 등
const publicStart = mainCssContent.indexOf('.grit-section');
const publicEnd = mainCssContent.indexOf('.admin-tabs');
if (publicStart !== -1 && publicEnd !== -1) {
  const public = mainCssContent.substring(publicStart, publicEnd).trim();
  if (public) {
    const filePath = path.join(CSS_DIR, 'pages', 'public.css');
    fs.writeFileSync(filePath, public, 'utf8');
    console.log(`✅ public.css: ${public.split('\n').length}줄`);
  }
}

console.log('\n✅ CSS 분리 완료!');

