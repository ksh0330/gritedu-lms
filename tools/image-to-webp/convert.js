const fs = require('fs');
const path = require('path');

const TOOL_DIR = __dirname;
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');
const DEFAULT_INPUT = path.join(TOOL_DIR, 'input');
const DEFAULT_OUTPUT = path.join(TOOL_DIR, 'output');
const SOURCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const WEBP_QUALITY = 85;

let sharp;
try {
  sharp = require(path.join(REPO_ROOT, 'node_modules', 'sharp'));
} catch (error) {
  console.error('sharp 모듈을 찾을 수 없습니다. 저장소 루트에서 npm install 을 실행하세요.');
  process.exit(1);
}

let converted = 0;
let skipped = 0;
let errors = 0;

function isSourceImage(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getOutputPath(sourcePath, inputRoot, outputRoot) {
  const relativePath = path.relative(inputRoot, sourcePath);
  const parsed = path.parse(relativePath);
  return path.join(outputRoot, parsed.dir, `${parsed.name}.webp`);
}

async function convertFile(sourcePath, destPath) {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    console.log(`skip: ${path.relative(REPO_ROOT, destPath)} already exists`);
    skipped += 1;
    return;
  }

  try {
    const originalSize = fs.statSync(sourcePath).size;
    await sharp(sourcePath)
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toFile(destPath);

    const webpSize = fs.statSync(destPath).size;
    const reduction = originalSize > 0
      ? ((1 - webpSize / originalSize) * 100).toFixed(1)
      : '0.0';

    console.log(
      `converted: ${path.basename(sourcePath)} -> ${path.basename(destPath)} ` +
      `(${(originalSize / 1024).toFixed(1)}KB -> ${(webpSize / 1024).toFixed(1)}KB, ${reduction}% smaller)`
    );
    converted += 1;
  } catch (error) {
    console.error(`error: ${sourcePath} - ${error.message}`);
    errors += 1;
  }
}

async function processDirectory(inputDir, outputDir) {
  if (!fs.existsSync(inputDir)) {
    console.error(`input folder not found: ${inputDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(inputDir, entry.name);
    if (entry.isDirectory()) {
      await processDirectory(sourcePath, path.join(outputDir, entry.name));
      continue;
    }
    if (!entry.isFile() || !isSourceImage(sourcePath)) {
      continue;
    }
    const destPath = getOutputPath(sourcePath, inputDir, outputDir);
    await convertFile(sourcePath, destPath);
  }
}

async function processPath(targetPath, outputDir) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    console.error(`path not found: ${resolved}`);
    errors += 1;
    return;
  }

  const stats = fs.statSync(resolved);
  if (stats.isDirectory()) {
    await processDirectory(resolved, outputDir);
    return;
  }

  if (!isSourceImage(resolved)) {
    console.log(`skip: ${resolved} (not png/jpg)`);
    skipped += 1;
    return;
  }

  const destPath = path.join(
    outputDir,
    `${path.parse(path.basename(resolved)).name}.webp`
  );
  await convertFile(resolved, destPath);
}

function printUsage() {
  console.log('PNG/JPG -> WebP 변환 도구');
  console.log('');
  console.log('사용법:');
  console.log('  node tools/image-to-webp/convert.js');
  console.log('    tools/image-to-webp/input/ 의 이미지를 output/ 으로 변환');
  console.log('  node tools/image-to-webp/convert.js <파일 또는 폴더> [추가 경로...]');
  console.log('    지정 경로를 tools/image-to-webp/output/ 으로 변환');
  console.log('');
  console.log('Windows: tools/image-to-webp/run.bat');
  console.log('npm:     npm run convert-images');
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--help' && arg !== '-h');
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  console.log('WebP conversion starting...');

  if (args.length === 0) {
    if (!fs.existsSync(DEFAULT_INPUT)) {
      fs.mkdirSync(DEFAULT_INPUT, { recursive: true });
    }
    if (!fs.existsSync(DEFAULT_OUTPUT)) {
      fs.mkdirSync(DEFAULT_OUTPUT, { recursive: true });
    }
    console.log(`input:  ${path.relative(REPO_ROOT, DEFAULT_INPUT)}`);
    console.log(`output: ${path.relative(REPO_ROOT, DEFAULT_OUTPUT)}`);
    await processDirectory(DEFAULT_INPUT, DEFAULT_OUTPUT);
  } else {
    if (!fs.existsSync(DEFAULT_OUTPUT)) {
      fs.mkdirSync(DEFAULT_OUTPUT, { recursive: true });
    }
    console.log(`output: ${path.relative(REPO_ROOT, DEFAULT_OUTPUT)}`);
    for (const arg of args) {
      await processPath(arg, DEFAULT_OUTPUT);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`converted: ${converted}`);
  console.log(`skipped: ${skipped}`);
  console.log(`errors: ${errors}`);
  console.log('='.repeat(50));

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
