const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL_DIR = __dirname;
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');
const DEFAULT_INPUT = path.join(TOOL_DIR, 'input');
const DEFAULT_OUTPUT = path.join(TOOL_DIR, 'output');
const MAX_SEGMENT_LENGTH = 100;
const IGNORED_FILE_NAMES = new Set(['.gitkeep', '.ds_store', 'thumbs.db']);
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const CHOSEONG = [
  'g',
  'kk',
  'n',
  'd',
  'tt',
  'r',
  'm',
  'b',
  'pp',
  's',
  'ss',
  '',
  'j',
  'jj',
  'ch',
  'k',
  't',
  'p',
  'h',
];

const JUNGSEONG = [
  'a',
  'ae',
  'ya',
  'yae',
  'eo',
  'e',
  'yeo',
  'ye',
  'o',
  'wa',
  'wae',
  'oe',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'eu',
  'ui',
  'i',
];

const JONGSEONG = [
  '',
  'k',
  'k',
  'ks',
  'n',
  'nj',
  'nh',
  't',
  'l',
  'lk',
  'lm',
  'lb',
  'ls',
  'lt',
  'lp',
  'lh',
  'm',
  'p',
  'ps',
  't',
  't',
  'ng',
  't',
  't',
  'k',
  't',
  'p',
  't',
];

const COMPAT_JAMO = new Map([
  ['ㄱ', 'g'],
  ['ㄲ', 'kk'],
  ['ㄳ', 'ks'],
  ['ㄴ', 'n'],
  ['ㄵ', 'nj'],
  ['ㄶ', 'nh'],
  ['ㄷ', 'd'],
  ['ㄸ', 'tt'],
  ['ㄹ', 'r'],
  ['ㄺ', 'lk'],
  ['ㄻ', 'lm'],
  ['ㄼ', 'lb'],
  ['ㄽ', 'ls'],
  ['ㄾ', 'lt'],
  ['ㄿ', 'lp'],
  ['ㅀ', 'lh'],
  ['ㅁ', 'm'],
  ['ㅂ', 'b'],
  ['ㅃ', 'pp'],
  ['ㅄ', 'ps'],
  ['ㅅ', 's'],
  ['ㅆ', 'ss'],
  ['ㅇ', 'ng'],
  ['ㅈ', 'j'],
  ['ㅉ', 'jj'],
  ['ㅊ', 'ch'],
  ['ㅋ', 'k'],
  ['ㅌ', 't'],
  ['ㅍ', 'p'],
  ['ㅎ', 'h'],
  ['ㅏ', 'a'],
  ['ㅐ', 'ae'],
  ['ㅑ', 'ya'],
  ['ㅒ', 'yae'],
  ['ㅓ', 'eo'],
  ['ㅔ', 'e'],
  ['ㅕ', 'yeo'],
  ['ㅖ', 'ye'],
  ['ㅗ', 'o'],
  ['ㅘ', 'wa'],
  ['ㅙ', 'wae'],
  ['ㅚ', 'oe'],
  ['ㅛ', 'yo'],
  ['ㅜ', 'u'],
  ['ㅝ', 'wo'],
  ['ㅞ', 'we'],
  ['ㅟ', 'wi'],
  ['ㅠ', 'yu'],
  ['ㅡ', 'eu'],
  ['ㅢ', 'ui'],
  ['ㅣ', 'i'],
]);

const SYMBOL_WORDS = new Map([
  ['&', ' and '],
  ['+', ' plus '],
  ['@', ' at '],
  ['%', ' percent '],
  ['#', ' number '],
]);

const options = {
  dryRun: false,
  overwrite: true,
  outputDir: DEFAULT_OUTPUT,
  paths: [],
};

const usedOutputPaths = new Set();
let copied = 0;
let skipped = 0;
let errors = 0;

function printUsage() {
  console.log('Korean filename -> R2-safe English filename copy tool');
  console.log('');
  console.log('Usage:');
  console.log('  node tools/kor-to-eng/convert.js');
  console.log('    Copy all files from tools/kor-to-eng/input/ to tools/kor-to-eng/output/');
  console.log('');
  console.log('  node tools/kor-to-eng/convert.js <file-or-folder> [more paths...]');
  console.log('    Copy selected files or folders into tools/kor-to-eng/output/');
  console.log('');
  console.log('Options:');
  console.log('  -o, --output <folder>  Choose a custom output folder');
  console.log('  --dry-run             Preview changes without copying files');
  console.log('  --no-overwrite        Keep existing output files and add suffixes instead');
  console.log('  -h, --help            Show this help');
  console.log('');
  console.log('Output names use lowercase ASCII letters, digits, and hyphens.');
}

function parseArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--no-overwrite') {
      options.overwrite = false;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      const outputDir = args[index + 1];
      if (!outputDir) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      options.outputDir = path.resolve(outputDir);
      index += 1;
      continue;
    }

    options.paths.push(arg);
  }
}

function shortHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function romanizeHangulSyllable(char) {
  const code = char.codePointAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    return null;
  }

  const offset = code - 0xac00;
  const choseongIndex = Math.floor(offset / (21 * 28));
  const jungseongIndex = Math.floor((offset % (21 * 28)) / 28);
  const jongseongIndex = offset % 28;

  return `${CHOSEONG[choseongIndex]}${JUNGSEONG[jungseongIndex]}${JONGSEONG[jongseongIndex]}`;
}

function romanizeChar(char) {
  const hangul = romanizeHangulSyllable(char);
  if (hangul !== null) {
    return hangul;
  }

  if (COMPAT_JAMO.has(char)) {
    return COMPAT_JAMO.get(char);
  }

  if (SYMBOL_WORDS.has(char)) {
    return SYMBOL_WORDS.get(char);
  }

  const normalized = char.normalize('NFKD');
  let result = '';

  for (const part of normalized) {
    if (/[\u0300-\u036f]/.test(part)) {
      continue;
    }
    if (/[a-zA-Z0-9]/.test(part)) {
      result += part.toLowerCase();
      continue;
    }
    if (SYMBOL_WORDS.has(part)) {
      result += SYMBOL_WORDS.get(part);
      continue;
    }
    result += '-';
  }

  return result;
}

function toSafeSegment(value, fallback) {
  let safe = '';

  for (const char of value) {
    safe += romanizeChar(char);
  }

  safe = safe
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!safe) {
    safe = `${fallback}-${shortHash(value)}`;
  }

  if (WINDOWS_RESERVED_NAMES.has(safe)) {
    safe = `${safe}-${fallback}`;
  }

  if (safe.length > MAX_SEGMENT_LENGTH) {
    const hash = shortHash(value);
    safe = safe.slice(0, MAX_SEGMENT_LENGTH - hash.length - 1).replace(/-+$/g, '');
    safe = `${safe}-${hash}`;
  }

  return safe;
}

function toSafeExtension(ext) {
  if (!ext) {
    return '';
  }

  let safe = '';
  for (const char of ext.replace(/^\.+/, '')) {
    safe += romanizeChar(char);
  }

  safe = safe.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return safe ? `.${safe.slice(0, 20)}` : '';
}

function toSafeFileName(fileName) {
  const parsed = path.parse(fileName);
  const base = toSafeSegment(parsed.name || fileName, 'file');
  const ext = toSafeExtension(parsed.ext);
  return `${base}${ext}`;
}

function toOutputKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function withSuffix(filePath, suffix) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
}

function reserveOutputPath(filePath, type) {
  let candidate = filePath;
  let suffix = 2;

  while (true) {
    const key = toOutputKey(candidate);
    const exists = fs.existsSync(candidate);
    const hasWrongType =
      exists && type === 'directory' && !fs.statSync(candidate).isDirectory();
    const isExistingFile = exists && type === 'file' && fs.statSync(candidate).isDirectory();
    const shouldAvoidExistingFile = type === 'file' && exists && !options.overwrite;

    if (
      !usedOutputPaths.has(key) &&
      !hasWrongType &&
      !isExistingFile &&
      !shouldAvoidExistingFile
    ) {
      usedOutputPaths.add(key);
      return candidate;
    }

    candidate = withSuffix(filePath, suffix);
    suffix += 1;
  }
}

function isIgnoredFileName(fileName) {
  return IGNORED_FILE_NAMES.has(fileName.toLowerCase());
}

function isSameOrInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function relativeForLog(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  return relative.startsWith('..') ? filePath : relative;
}

function ensureDirectory(dirPath) {
  if (!options.dryRun) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFile(sourcePath, outputDir) {
  const destFileName = toSafeFileName(path.basename(sourcePath));
  const destPath = reserveOutputPath(path.join(outputDir, destFileName), 'file');

  if (!options.dryRun) {
    ensureDirectory(path.dirname(destPath));
    fs.copyFileSync(sourcePath, destPath);
  }

  console.log(`${options.dryRun ? 'would copy' : 'copied'}: ${relativeForLog(sourcePath)} -> ${relativeForLog(destPath)}`);
  copied += 1;
}

function processDirectory(sourceDir, outputDir) {
  if (isSameOrInside(sourceDir, options.outputDir)) {
    console.log(`skip: ${relativeForLog(sourceDir)} is inside the output folder`);
    skipped += 1;
    return;
  }

  ensureDirectory(outputDir);

  const entries = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  for (const entry of entries) {
    if (isIgnoredFileName(entry.name)) {
      skipped += 1;
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);

    if (entry.isDirectory()) {
      const destDirName = toSafeSegment(entry.name, 'folder');
      const destDir = reserveOutputPath(path.join(outputDir, destDirName), 'directory');
      processDirectory(sourcePath, destDir);
      continue;
    }

    if (entry.isFile()) {
      copyFile(sourcePath, outputDir);
      continue;
    }

    console.log(`skip: ${relativeForLog(sourcePath)} is not a regular file`);
    skipped += 1;
  }
}

function processPath(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    console.error(`error: path not found: ${resolved}`);
    errors += 1;
    return;
  }

  const stats = fs.statSync(resolved);
  if (stats.isDirectory()) {
    const destDir = reserveOutputPath(
      path.join(options.outputDir, toSafeSegment(path.basename(resolved), 'folder')),
      'directory'
    );
    processDirectory(resolved, destDir);
    return;
  }

  if (stats.isFile()) {
    if (isIgnoredFileName(path.basename(resolved))) {
      skipped += 1;
      return;
    }
    copyFile(resolved, options.outputDir);
    return;
  }

  console.log(`skip: ${resolved} is not a regular file or folder`);
  skipped += 1;
}

function main() {
  parseArgs(process.argv.slice(2));
  options.outputDir = path.resolve(options.outputDir);

  console.log('Korean filename copy starting...');
  console.log(`output: ${relativeForLog(options.outputDir)}`);
  console.log(`mode:   ${options.dryRun ? 'dry-run' : options.overwrite ? 'overwrite existing outputs' : 'keep existing outputs'}`);

  if (options.paths.length === 0) {
    ensureDirectory(DEFAULT_INPUT);
    ensureDirectory(options.outputDir);
    console.log(`input:  ${relativeForLog(DEFAULT_INPUT)}`);
    processDirectory(DEFAULT_INPUT, options.outputDir);
  } else {
    ensureDirectory(options.outputDir);
    for (const targetPath of options.paths) {
      processPath(targetPath);
    }
  }

  console.log('');
  console.log('='.repeat(50));
  console.log(`copied:  ${copied}`);
  console.log(`skipped: ${skipped}`);
  console.log(`errors:  ${errors}`);
  console.log('='.repeat(50));

  if (errors > 0) {
    process.exit(1);
  }
}

main();
