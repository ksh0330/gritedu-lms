const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Source-side WebP preparation helper.
// Intentionally excludes root brand/OG assets and instructor profile images.
const alwaysConvertDirs = [
  'assets/instructors/posters',
  'assets/instructors/curriculum',
  'assets/popup',
  'assets/story'
];

const optionalConvertDirs = [
  'assets/course',
  'assets/class',
  'assets/instructors/books'
];

const imageDirs = [
  ...alwaysConvertDirs,
  ...optionalConvertDirs.filter((dir) => fs.existsSync(dir))
];

const imageExtensions = ['.png', '.jpg', '.jpeg'];

let converted = 0;
let skipped = 0;
let errors = 0;

async function convertToWebP(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!imageExtensions.includes(ext)) {
      return false;
    }

    const webpPath = filePath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
    if (fs.existsSync(webpPath)) {
      console.log(`skip: ${webpPath} already exists`);
      skipped++;
      return false;
    }

    const originalStats = fs.statSync(filePath);
    const originalSize = originalStats.size;

    await sharp(filePath)
      .webp({ quality: 85, effort: 6 })
      .toFile(webpPath);

    const webpStats = fs.statSync(webpPath);
    const webpSize = webpStats.size;
    const reduction = ((1 - webpSize / originalSize) * 100).toFixed(1);

    console.log(
      `converted: ${path.basename(filePath)} -> ${path.basename(webpPath)} ` +
      `(${(originalSize / 1024).toFixed(1)}KB -> ${(webpSize / 1024).toFixed(1)}KB, ${reduction}% smaller)`
    );
    converted++;
    return true;
  } catch (error) {
    console.error(`error: ${filePath} - ${error.message}`);
    errors++;
    return false;
  }
}

async function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await processDirectory(filePath);
    } else if (entry.isFile()) {
      await convertToWebP(filePath);
    }
  }
}

async function main() {
  console.log('WebP source conversion starting...');
  console.log('Targets:');
  imageDirs.forEach((dir) => console.log(`  - ${dir}`));

  for (const dir of imageDirs) {
    console.log(`\nprocessing: ${dir}`);
    await processDirectory(dir);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`converted: ${converted}`);
  console.log(`skipped: ${skipped}`);
  console.log(`errors: ${errors}`);
  console.log('='.repeat(50));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
