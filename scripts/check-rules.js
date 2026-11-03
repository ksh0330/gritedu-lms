const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const STRICT_MODE = process.argv.includes('--strict');

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

function run() {
  console.log(`🔎 Firestore rules readiness check start${STRICT_MODE ? ' (strict)' : ''}\n`);

  const firebasePath = path.join(ROOT_DIR, 'firebase.json');
  if (!fs.existsSync(firebasePath)) {
    addError('firebase.json is missing.');
  }

  let rulesRelativePath = null;
  if (errors.length === 0) {
    try {
      const firebaseConfig = readJson(firebasePath);
      rulesRelativePath = firebaseConfig?.firestore?.rules;
      if (!rulesRelativePath || typeof rulesRelativePath !== 'string') {
        addError('firebase.json.firestore.rules is missing.');
      }
    } catch (error) {
      addError(`firebase.json parse failed: ${error.message}`);
    }
  }

  let sourceRulesPath = null;
  if (rulesRelativePath) {
    sourceRulesPath = path.join(ROOT_DIR, rulesRelativePath);
    if (!fs.existsSync(sourceRulesPath)) {
      addError(`Rules file missing: ${rulesRelativePath}`);
    }
  }

  if (sourceRulesPath && fs.existsSync(sourceRulesPath)) {
    const content = fs.readFileSync(sourceRulesPath, 'utf8');
    if (!content.trim()) {
      addError('Rules file is empty.');
    }

    if (!/rules_version\s*=\s*['"]2['"]\s*;/.test(content)) {
      addWarning('rules_version = \'2\'; not found in firestore.rules.');
    }
    if (!/service\s+cloud\.firestore\s*\{/.test(content)) {
      addError('service cloud.firestore block not found in firestore.rules.');
    }
    if (!/match\s*\/databases\/\{[^}]+\}\/documents/.test(content)) {
      addError('Top-level match /databases/{...}/documents not found in firestore.rules.');
    }
  }

  console.log('='.repeat(64));
  if (errors.length > 0) {
    console.error('\n❌ Rules readiness errors:');
    errors.forEach((message) => console.error(`- ${message}`));
  }
  if (warnings.length > 0) {
    console.warn('\n⚠️  Rules readiness warnings:');
    warnings.forEach((message) => console.warn(`- ${message}`));
  }

  if (errors.length > 0) {
    console.error('\n❌ Rules readiness failed.');
    process.exit(1);
  }

  if (STRICT_MODE && warnings.length > 0) {
    console.error('\n❌ Rules strict check failed due to warnings.');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Rules readiness passed with warnings.');
  } else {
    console.log('\n✅ Rules readiness passed.');
  }
}

run();
