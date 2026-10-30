#!/usr/bin/env node
// SessionStart hook (Claude Code / Codex): prints short repo context that the agent receives.
import { execSync } from 'node:child_process';

const run = (c) => {
  try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return '(unavailable)'; }
};

const mode = (process.env.GRIT_AGENT_MODE || 'audit').toLowerCase();
const branch = run('git rev-parse --abbrev-ref HEAD');
const head = run('git log -1 --format=%h%x20%s');
const status = run('git status --porcelain');
const changed = status && status !== '(unavailable)' ? status.split('\n').length : 0;

const lines = [
  `[GRIT Edu LMS session context]`,
  `mode=${mode} run_id=${process.env.GRIT_RUN_ID || '-'} branch=${branch} head=${head} changed_files=${changed}`,
  `Rules: AGENTS.md (product/cost/deploy) + .agents/rules/review-protocol.md (review format).`,
  mode === 'fix'
    ? `fix mode: edit only the approved work-package files; never deploy, push, or touch production data.`
    : `audit mode: read-only. Do not modify files outside .review/. Deliver the report as your final message.`,
];
process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
