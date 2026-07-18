const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STRICT_MODE = process.argv.includes('--strict');

const REQUIRED_DIRS = [
  'assets',
  'assets/css',
  'assets/js'
];

const REQUIRED_FILES = [
  'index.html',
  'schedule-images.html',
  '_redirects',
  'assets/css/main.css',
  'assets/js/common.js',
  'assets/js/firebase-init.js',
  'assets/school.csv',
  'build-report.json',
  'version.json',
  '_headers',
  'sitemap.xml',
  'robots.txt'
];

function distPathAccessible(relPath) {
  try {
    fs.accessSync(path.join(DIST_DIR, relPath), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readDistRedirects() {
  if (!distPathAccessible('_redirects')) return '';
  return fs.readFileSync(path.join(DIST_DIR, '_redirects'), 'utf8');
}

function hasScheduleImagesHtmlRedirectLoop(content) {
  return content.includes('/schedule-images') && content.includes('schedule-images.html');
}

function checkScheduleImagesRedirects() {
  const redirects = readDistRedirects();
  if (hasScheduleImagesHtmlRedirectLoop(redirects)) {
    addError(
      '_redirects must not rewrite /schedule-images to schedule-images.html (Cloudflare pretty URL redirect loop)'
    );
  }
}

const FORBIDDEN_DIST_PATHS = [
  'firestore.rules',
  'firebase.json',
  '.firebaserc',
  'storage.rules',
  'serviceAccountKey.json',
  'functions',
  'scripts',
  'node_modules'
];

const LOCAL_CSS_IMPORT_PATTERN = /@import\s+(?:url\s*\(\s*)?['"]?([^'")]+)['"]?\s*\)?\s*;/gi;

function isExternalCssImport(href) {
  const normalized = String(href || '').trim();
  return /^https?:\/\//i.test(normalized) || normalized.startsWith('//');
}

function findLocalCssImports(content) {
  const imports = [];
  if (typeof content !== 'string' || !content.includes('@import')) {
    return imports;
  }

  for (const match of content.matchAll(LOCAL_CSS_IMPORT_PATTERN)) {
    const href = String(match[1] || '').trim();
    if (!href || isExternalCssImport(href)) {
      continue;
    }
    imports.push({ full: match[0], href });
  }

  return imports;
}

const errors = [];
const warnings = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function checkExists(kind, relativePath) {
  const targetPath = path.join(DIST_DIR, relativePath);
  if (!fs.existsSync(targetPath)) {
    addError(`Missing ${kind}: ${relativePath}`);
    return null;
  }

  return targetPath;
}

function checkBuildReport() {
  const reportPath = checkExists('file', 'build-report.json');
  if (!reportPath) {
    return;
  }

  let report = null;
  try {
    report = readJson(reportPath);
  } catch (error) {
    addError(`Invalid build-report.json: ${error.message}`);
    return;
  }

  const fallbackFiles = report?.minify?.js?.fallbackFiles || [];
  if (fallbackFiles.length > 0) {
    addWarning(`JS minify fallback detected (${fallbackFiles.length} file(s)).`);
    fallbackFiles.forEach((entry) => {
      addWarning(`  - ${entry.file}: ${entry.reason}`);
    });
  }

  if (report?.minify?.css?.fallbackCopied) {
    const reason = report?.minify?.css?.error ? ` (${report.minify.css.error})` : '';
    addWarning(`CSS minify fallback detected${reason}`);
  }

  if (report?.steps?.totalWarnings > 0) {
    addWarning(`Prebuild reported ${report.steps.totalWarnings} warning(s).`);
  }
}

function checkConfigSync() {
  const robotsSource = path.join(ROOT_DIR, 'robots.txt');
  const robotsDist = path.join(DIST_DIR, 'robots.txt');
  if (fs.existsSync(robotsSource) && fs.existsSync(robotsDist)) {
    const sourceContent = fs.readFileSync(robotsSource, 'utf8');
    const distContent = fs.readFileSync(robotsDist, 'utf8');
    if (sourceContent !== distContent) {
      addWarning('dist/robots.txt is out of sync with root robots.txt.');
    }
  }
}

function checkVersionJson() {
  const versionPath = path.join(DIST_DIR, 'version.json');
  if (!fs.existsSync(versionPath)) return;

  let payload = null;
  try {
    payload = readJson(versionPath);
  } catch (error) {
    addError(`Invalid version.json: ${error.message}`);
    return;
  }

  if (!payload.version || typeof payload.version !== 'string') {
    addError('version.json is missing a string version field.');
  }
}

function checkCloudflareHeaders() {
  const headersPath = path.join(DIST_DIR, '_headers');
  if (!fs.existsSync(headersPath)) return;

  const content = fs.readFileSync(headersPath, 'utf8');
  const requiredSnippets = [
    '/version.json',
    'Cache-Control: no-cache, no-store, must-revalidate',
    '/assets/*.js',
    '/assets/*.css',
    '/*.html'
  ];

  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      addError(`_headers is missing expected rule: ${snippet}`);
    }
  }
}

function checkForbiddenDistPaths() {
  for (const relPath of FORBIDDEN_DIST_PATHS) {
    const targetPath = path.join(DIST_DIR, ...relPath.split('/'));
    if (fs.existsSync(targetPath)) {
      addError(`Forbidden public artifact present in dist: ${relPath}`);
    }
  }
}

function checkBundledCssHasNoLocalImports() {
  const cssPath = path.join(DIST_DIR, 'assets/css/main.css');
  if (!fs.existsSync(cssPath)) {
    return;
  }

  const content = fs.readFileSync(cssPath, 'utf8');
  const localImports = findLocalCssImports(content);
  if (localImports.length > 0) {
    localImports.forEach((item) => {
      addError(`dist/assets/css/main.css contains local @import: ${item.href}`);
    });
  }
}

function checkAssetSanity() {
  const cssPath = path.join(DIST_DIR, 'assets/css/main.css');
  if (fs.existsSync(cssPath)) {
    const cssSize = fs.statSync(cssPath).size;
    if (cssSize === 0) {
      addError('assets/css/main.css is empty.');
    } else if (cssSize < 8 * 1024) {
      addWarning(`assets/css/main.css is unusually small (${cssSize} bytes).`);
    }
  }

  const jsRoot = path.join(DIST_DIR, 'assets/js');
  let jsFileCount = 0;
  function countJs(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        countJs(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        jsFileCount++;
      }
    }
  }
  countJs(jsRoot);
  if (jsFileCount < 3) {
    addWarning(`JS bundle appears incomplete (only ${jsFileCount} JS file(s) in dist/assets/js).`);
  }
}

function checkHtmlCoverage() {
  let htmlCount = 0;
  function countHtml(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        countHtml(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        htmlCount++;
      }
    }
  }

  countHtml(DIST_DIR);
  if (htmlCount < 5) {
    addWarning(`dist HTML coverage is low (${htmlCount} file(s)).`);
  }
}

function checkSitemapExclusions() {
  const sitemapPath = path.join(DIST_DIR, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    return;
  }

  const content = fs.readFileSync(sitemapPath, 'utf8');
  if (content.includes('/schedule-images.html') || content.includes('/schedule-images</loc>')) {
    addError('sitemap.xml must not include schedule-images');
  }
}

function ensureScheduleImagesCleanUrl() {
  if (distPathAccessible('schedule-images/index.html')) return;

  const sourcePath = path.join(DIST_DIR, 'schedule-images.html');
  const destPath = path.join(DIST_DIR, 'schedule-images', 'index.html');
  if (!distPathAccessible('schedule-images.html')) return;

  try {
    const content = fs.readFileSync(sourcePath, 'utf8');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf8');
    addWarning('Generated missing schedule-images/index.html from schedule-images.html during verify');
  } catch (err) {
    addWarning(`schedule-images/index.html not writable (${err.message}); Cloudflare pretty URL still applies`);
  }
}

function checkScheduleImagesRoute() {
  if (!distPathAccessible('schedule-images.html')) {
    addError('Missing file: schedule-images.html');
    return;
  }

  checkScheduleImagesRedirects();

  // Production (Cloudflare): schedule-images.html is served at /schedule-images via pretty URLs.
  // Local emulator: optional dist/schedule-images/index.html and/or firebase.json rewrites.
  if (distPathAccessible('schedule-images/index.html')) return;
}

function run() {
  console.log(`🔎 Build verify start${STRICT_MODE ? ' (strict)' : ''}\n`);

  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ dist folder not found. Run `npm run prebuild` first.');
    process.exit(1);
  }

  ensureScheduleImagesCleanUrl();

  for (const dir of REQUIRED_DIRS) {
    checkExists('directory', dir);
  }

  for (const file of REQUIRED_FILES) {
    checkExists('file', file);
  }

  checkScheduleImagesRoute();

  checkBuildReport();
  checkConfigSync();
  checkVersionJson();
  checkCloudflareHeaders();
  checkForbiddenDistPaths();
  checkBundledCssHasNoLocalImports();
  checkAssetSanity();
  checkHtmlCoverage();
  checkSitemapExclusions();

  console.log('='.repeat(64));
  if (errors.length > 0) {
    console.error('\n❌ Verification errors:');
    errors.forEach((message) => console.error(`- ${message}`));
  }
  if (warnings.length > 0) {
    console.warn('\n⚠️  Verification warnings:');
    warnings.forEach((message) => console.warn(`- ${message}`));
  }

  if (errors.length > 0) {
    console.error('\n❌ Build verify failed.');
    process.exit(1);
  }

  if (STRICT_MODE && warnings.length > 0) {
    console.error('\n❌ Strict verify failed due to warnings.');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Verify passed with warnings.');
  } else {
    console.log('\n✅ Verify passed with no warnings.');
  }
}

run();
