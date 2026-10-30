#!/usr/bin/env node
// Shared PreToolUse guard for Claude Code and Codex CLI.
// Reads the hook payload (JSON) from stdin. Exit 2 + stderr message = block.
// Mode comes from GRIT_AGENT_MODE: "audit" (default) or "fix".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODE = (process.env.GRIT_AGENT_MODE || 'audit').toLowerCase();

function block(reason) {
  process.stderr.write(`[grit-guard:${MODE}] BLOCKED: ${reason}\n`);
  process.exit(2);
}

let payload = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  payload = raw.trim() ? JSON.parse(raw) : {};
} catch {
  process.exit(0); // unreadable payload: do not break the session
}

const toolName = String(payload.tool_name || '');
const input = payload.tool_input ?? {};
const cwd = payload.cwd || process.cwd();

// ---------- helpers ----------
function collectStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

function rel(p) {
  if (!p) return '';
  const abs = path.resolve(cwd, String(p).trim().replace(/^["']|["']$/g, ''));
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

const SECRET_RE = /(^|\/)(\.env(\.[^/]*)?|serviceAccountKey[^/]*\.json|appPW\.md)$/i;
const isSecret = (r) => SECRET_RE.test(r) && !/\.env\.example$/i.test(r);
const isOutsideRepo = (r) => r.startsWith('..') || path.isAbsolute(r);
const PROTECTED = [/^\.agents\/hooks\//, /^\.claude\/settings\.json$/, /^\.codex\//, /^AGENTS\.md$/];
const isProtected = (r) => PROTECTED.some((re) => re.test(r));
const isReviewArea = (r) => r === '.review' || r.startsWith('.review/');

// ---------- classify tool ----------
const SHELL_TOOLS = /^(bash|shell|local_shell|exec_command|run_shell_command|unified_exec|powershell)$/i;
const WRITE_TOOLS = /^(write|edit|multiedit|notebookedit|apply_patch|write_file|replace|create_file|str_replace_editor)$/i;
const READ_TOOLS = /^(read|read_file|view|read_many_files)$/i;

// ---------- shell commands ----------
if (SHELL_TOOLS.test(toolName)) {
  const cmd = collectStrings(input.command ?? input.cmd ?? input).join(' ');

  const always = [
    [/\bfirebase(\.cmd)?\s+deploy\b/i, 'firebase deploy는 사람이 직접 실행합니다.'],
    [/\bfirebase(\.cmd)?\s+(firestore:delete|functions:delete|auth:import|auth:export|database:)/i, '운영 Firebase 데이터/함수 조작 금지'],
    [/\bwrangler\b[\s\S]*\b(deploy|publish|r2\s+object\s+(put|delete)|r2\s+bucket\s+delete)\b/i, 'Cloudflare 배포/R2 쓰기 금지'],
    [/\bgcloud\b/i, 'gcloud 사용 금지'],
    [/\bgsutil\s+(rm|cp|mv|rsync)\b/i, 'gsutil 쓰기 금지'],
    [/\bgit\s+push\b/i, 'git push는 사람이 직접 실행합니다.'],
    [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard 금지'],
    [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean -f 금지'],
    [/\bgit\s+(branch\s+-D|checkout\s+--\s|restore\s+\.)/i, '변경 유실 위험 git 명령 금지'],
    [/--force\b|\s-f\s+origin\b/i, 'force 옵션 금지'],
    [/\bscripts[\\/][\w.-]+\.(m?js)\b[\s\S]*--write\b/i, '마이그레이션 --write 실행 금지 (dry-run만)'],
    [/\bnpm\s+run\s+[\w:-]*:write\b/i, '마이그레이션 :write 스크립트 금지'],
    [/GOOGLE_APPLICATION_CREDENTIALS/i, '서비스 계정 자격증명 사용 금지'],
    [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, 'rm -rf 금지'],
    [/Remove-Item\b[\s\S]*-Recurse/i, 'Remove-Item -Recurse 금지'],
    [/\b(rd|rmdir)\s+\/s\b/i, 'rmdir /s 금지'],
    [/(?:^|[\s/\\"'=])\.env(?!\.example)(?:\.[\w-]+)?(?=$|[\s"';|&)])/i, '비밀 파일(.env) 접근 금지'],
    [/serviceAccountKey[\w-]*\.json|appPW\.md/i, '비밀 파일 접근 금지'],
    [/(>|Set-Content|Add-Content|Out-File|sed\s+-i|\bmv\b|\bcp\b|\brm\b|\bdel\b|Copy-Item|Move-Item|Remove-Item)[\s\S]*(\.agents[\\/]hooks|\.claude[\\/]settings|\.codex[\\/])/i, '에이전트 가드 설정 변경 금지'],
  ];
  for (const [re, why] of always) if (re.test(cmd)) block(`${why}  (command: ${cmd.slice(0, 160)})`);

  if (MODE !== 'fix') {
    const auditOnly = [
      [/\bgit\s+(commit|checkout|switch|merge|rebase|stash|cherry-pick|tag|am|apply)\b/i, 'audit 모드: 저장소 상태 변경 git 명령 금지'],
      [/\b(npm|pnpm|yarn)\s+(i|install|ci|add|update|uninstall)\b/i, 'audit 모드: 의존성 설치 금지'],
      [/\bnpm\s+run\s+(lint:fix|build|prebuild|clean|build:clean|convert-[\w-]+|kor-to-eng)\b/i, 'audit 모드: 파일을 생성/수정하는 npm 스크립트 금지'],
      [/\b(sed|perl)\s+-[a-z]*i\b/i, 'audit 모드: in-place 편집 금지'],
      [/\b(Set-Content|Add-Content|Out-File|New-Item|Move-Item|Copy-Item|Rename-Item)\b/i, 'audit 모드: 파일 쓰기 명령 금지'],
      [/\b(tee|touch|mv|cp|mkdir)\s/i, 'audit 모드: 파일 쓰기 명령 금지'],
    ];
    for (const [re, why] of auditOnly) if (re.test(cmd)) block(`${why}  (command: ${cmd.slice(0, 160)})`);

    // redirections: only to .review/, /dev/null, NUL, $null, or fd duplication
    const redir = /(?:^|[^0-9&>=-])\d?>{1,2}\s*(?!&)([^\s|;&<>]+)/g;
    let m;
    while ((m = redir.exec(cmd)) !== null) {
      const target = m[1].replace(/^["']|["']$/g, '');
      if (/^(\/dev\/null|nul|\$null)$/i.test(target)) continue;
      if (isReviewArea(rel(target))) continue;
      block(`audit 모드: .review/ 밖으로 리다이렉트 금지 (${target})`);
    }
  }
  process.exit(0);
}

// ---------- file writes ----------
if (WRITE_TOOLS.test(toolName)) {
  const paths = new Set();
  for (const k of ['file_path', 'path', 'filePath', 'notebook_path', 'target_file']) {
    if (typeof input[k] === 'string') paths.add(input[k]);
  }
  for (const s of collectStrings(input)) {
    for (const mm of s.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm)) paths.add(mm[1]);
    for (const mm of s.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) paths.add(mm[1]);
  }
  if (paths.size === 0 && /^apply_patch$/i.test(toolName)) block('apply_patch 대상 경로를 확인할 수 없습니다.');

  for (const p of paths) {
    const r = rel(p);
    if (isOutsideRepo(r)) block(`저장소 밖 파일 수정 금지: ${p}`);
    if (isSecret(r)) block(`비밀 파일 수정 금지: ${r}`);
    if (isProtected(r)) block(`보호 파일 수정 금지: ${r} (사람이 직접 수정)`);
    if (MODE !== 'fix' && !isReviewArea(r)) block(`audit 모드에서는 .review/ 아래만 쓸 수 있습니다: ${r}`);
  }
  process.exit(0);
}

// ---------- file reads ----------
if (READ_TOOLS.test(toolName)) {
  for (const s of [input.file_path, input.path, input.absolute_path, ...(input.paths || [])]) {
    if (typeof s === 'string' && isSecret(rel(s))) block(`비밀 파일 읽기 금지: ${rel(s)}`);
  }
}

process.exit(0);
