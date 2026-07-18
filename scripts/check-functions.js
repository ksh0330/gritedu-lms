const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

function runCommand(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: Boolean(options.shell)
  });

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null
  };
}

function runNodeSyntaxCheck(targetPath) {
  const result = runCommand(process.execPath, ['--check', targetPath], ROOT_DIR, { shell: false });
  if (result.status !== 0) {
    addError(`Syntax check failed for ${path.relative(ROOT_DIR, targetPath)}.`);
    if (result.stderr.trim()) {
      addError(result.stderr.trim());
    }
  }
}

function run() {
  console.log(`🔎 Functions readiness check start${STRICT_MODE ? ' (strict)' : ''}\n`);

  const firebasePath = path.join(ROOT_DIR, 'firebase.json');
  if (!fs.existsSync(firebasePath)) {
    addError('firebase.json is missing.');
  }

  let functionsDir = null;
  if (errors.length === 0) {
    try {
      const firebaseConfig = readJson(firebasePath);
      const source = firebaseConfig?.functions?.source;
      if (!source || typeof source !== 'string') {
        addError('firebase.json.functions.source is missing.');
      } else {
        functionsDir = path.join(ROOT_DIR, source);
      }
    } catch (error) {
      addError(`firebase.json parse failed: ${error.message}`);
    }
  }

  if (functionsDir && !fs.existsSync(functionsDir)) {
    addError(`Functions source directory is missing: ${path.relative(ROOT_DIR, functionsDir)}`);
  }

  let functionsPackage = null;
  const functionsPackagePath = functionsDir ? path.join(functionsDir, 'package.json') : null;
  if (functionsPackagePath && fs.existsSync(functionsPackagePath)) {
    try {
      functionsPackage = readJson(functionsPackagePath);
    } catch (error) {
      addError(`functions/package.json parse failed: ${error.message}`);
    }
  } else if (functionsDir) {
    addError('functions/package.json is missing.');
  }

  if (functionsPackage && functionsDir) {
    const entryFile = functionsPackage.main || 'index.js';
    const entryPath = path.join(functionsDir, entryFile);
    if (!fs.existsSync(entryPath)) {
      addError(`Functions entry file is missing: ${path.relative(ROOT_DIR, entryPath)}`);
    } else {
      runNodeSyntaxCheck(entryPath);
    }

    const lintScript = functionsPackage.scripts && functionsPackage.scripts.lint;
    if (!lintScript) {
      addWarning('functions lint script is missing in package.json.');
    } else {
      const lintResult = runCommand('npm', ['run', 'lint'], functionsDir, {
        shell: process.platform === 'win32'
      });
      if (lintResult.status !== 0) {
        const message = 'functions lint script failed.';
        if (STRICT_MODE) {
          addError(message);
        } else {
          addWarning(message);
        }

        if (lintResult.error) {
          if (STRICT_MODE) {
            addError(`lint execution error: ${lintResult.error}`);
          } else {
            addWarning(`lint execution error: ${lintResult.error}`);
          }
        }

        const lintOutput = [lintResult.stdout.trim(), lintResult.stderr.trim()]
          .filter(Boolean)
          .join('\n');
        if (lintOutput) {
          const summary = lintOutput.split('\n').slice(0, 8).join('\n');
          if (STRICT_MODE) {
            addError(summary);
          } else {
            addWarning(summary);
          }
        }
      }
    }
  }

  console.log('='.repeat(64));
  if (errors.length > 0) {
    console.error('\n❌ Functions readiness errors:');
    errors.forEach((message) => console.error(`- ${message}`));
  }
  if (warnings.length > 0) {
    console.warn('\n⚠️  Functions readiness warnings:');
    warnings.forEach((message) => console.warn(`- ${message}`));
  }

  if (errors.length > 0) {
    console.error('\n❌ Functions readiness failed.');
    process.exit(1);
  }

  if (STRICT_MODE && warnings.length > 0) {
    console.error('\n❌ Functions strict check failed due to warnings.');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Functions readiness passed with warnings.');
  } else {
    console.log('\n✅ Functions readiness passed.');
  }
}

run();
