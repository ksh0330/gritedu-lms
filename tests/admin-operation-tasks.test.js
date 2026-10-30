const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.join(__dirname, "..");
const readSource = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), "utf8");

const pageHtml = readSource("members/admin/operation-tasks.html");
const dashboardHtml = readSource("members/admin/dashboard.html");
const pageScript = readSource("assets/js/pages/admin-operation-tasks.js");
const pageStyles = readSource("assets/css/pages/admin-operation-tasks.css");

test("operations page preserves the administrator status contracts", () => {
  assert.match(pageHtml, /href="\/members\/admin\/dashboard\.html"/);
  assert.match(pageHtml, /src="\/assets\/js\/pages\/admin-operation-tasks\.js"/);
  assert.match(pageHtml, /id="operationTaskStatus"/);
  assert.match(pageHtml, /id="recordCleanupMessage"/);
  assert.match(pageScript, /requireRole\("admin", "\/members\/login\.html"\)/);
  assert.match(pageScript, /getDoc\(doc\(db, "settings", RETENTION_POLICY_DOC\)\)/);
  assert.match(pageScript, /recordCleanupLastRunAt/);
  assert.match(pageScript, /recordCleanupLastRunSummary/);
});

test("obsolete offline-retention controls and Firestore operations stay removed", () => {
  const combinedPageAssets = `${pageHtml}\n${pageScript}\n${pageStyles}`;
  const forbiddenTokens = [
    "offlineSessionRetentionForm",
    "offlineSessionPreviewButton",
    "offlineSessionPolicySave",
    "offlineSessionLastRun",
    "offlineClassSessions",
    "offlineSessionAccess",
    ".offline-session-"
  ];

  forbiddenTokens.forEach((token) => assert.doesNotMatch(combinedPageAssets, new RegExp(token)));
  assert.doesNotMatch(pageScript, /\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\baddDoc\b|\bwriteBatch\b|\bserverTimestamp\b|\bgetDocs\b|\bquery\b|\bwhere\b|\borderBy\b|\blimit\b|\bonSnapshot\b/);
  assert.doesNotMatch(pageScript, /addEventListener\("submit"|addEventListener\("click"/);
  assert.doesNotMatch(pageHtml, /오래된 수업|6개월이 지난 수업|실제 삭제 실행/);
});

test("daily cleanup wording is accurate without internal collection names", () => {
  assert.match(pageHtml, /매일 03:00 자동 실행/);
  assert.match(pageHtml, /만료된 임시 인증·가입·연동 시도 기록만 자동으로 정리합니다/);
  assert.doesNotMatch(pageHtml, /emailVerifications|signupAttempts|memberChildLinkAttempts/);
  assert.match(dashboardHtml, /매일 03:00 자동/);
  assert.doesNotMatch(dashboardHtml, /월 1회 자동/);
});

test("status and responsive page styling remain available", () => {
  assert.match(pageStyles, /\.operation-task-page \.task-notice/);
  assert.match(pageStyles, /\.operation-task-page \.record-cleanup-panel/);
  assert.match(pageStyles, /\.operation-task-page \.record-cleanup-message/);
  assert.match(pageStyles, /@media \(max-width: 640px\)/);
  assert.match(pageStyles, /\.operation-task-page \.page-header-row/);
});
