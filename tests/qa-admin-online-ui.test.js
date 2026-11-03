const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("dashboard distinguishes all failure, partial success, retry, and full success", async () => {
  const code = source("assets/js/pages/admin-dashboard-index.js");
  const body = code.slice(code.indexOf("let isRoleVerified"), code.indexOf("window.refreshDashboard"));
  const ids = ["loadStatusBtn", "refreshBtn", "statusUpdatedAt", "statusResult"];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    hidden: false, disabled: false, textContent: id === "statusUpdatedAt" ? "미조회" : "",
    dataset: {}, setAttribute() {}, removeAttribute() {}
  }]));
  const cards = {};
  let failed = new Set();
  const context = {
    window: {}, console: {error() {}},
    document: {
      getElementById(id) { return elements[id] ||= {textContent: ""}; },
      querySelector(selector) { return cards[selector] ||= {dataset: {}}; }
    },
    collection(_db, name) { return name; },
    query(name) { return name; },
    where() { return {}; },
    db: {},
    getCountFromServer(name) {
      return failed.has(name) ? Promise.reject(new Error("mock failure")) : Promise.resolve({data: () => ({count: 2})});
    },
    setAdminRefreshButtonState(button, loading, {disabledWhenReady}) {
      button.disabled = loading || disabledWhenReady;
    }
  };
  vm.createContext(context);
  vm.runInContext(`${body}\nisRoleVerified = true;`, context);

  failed = new Set(["students", "instructors", "courses", "offlineClasses", "enrollments", "offlineClassMembers"]);
  await context.window.loadDashboardStatus();
  assert.equal(elements.statusUpdatedAt.textContent, "미조회");
  assert.match(elements.statusResult.textContent, /전체 현황을 불러오지 못했습니다/);
  assert.equal(elements.loadStatusBtn.hidden, false);
  assert.equal(elements.refreshBtn.hidden, true);

  failed = new Set(["instructors", "courses"]);
  await context.window.loadDashboardStatus();
  assert.match(elements.statusResult.textContent, /4개 지표를 불러왔고 2개는 실패/);
  assert.equal(elements.statusUpdatedAt.textContent, "미조회");
  assert.equal(elements.statusResult.dataset.state, "error");
  assert.equal(elements.loadStatusBtn.hidden, false);
  assert.equal(elements.refreshBtn.hidden, true);

  failed.clear();
  await context.window.loadDashboardStatus();
  const lastSuccess = elements.statusUpdatedAt.textContent;
  assert.match(lastSuccess, /마지막 성공 조회:/);
  assert.equal(elements.statusResult.dataset.state, "success");
  assert.equal(elements.loadStatusBtn.hidden, true);
  assert.equal(elements.refreshBtn.hidden, false);
  failed = new Set(["students", "instructors", "courses", "offlineClasses", "enrollments", "offlineClassMembers"]);
  await context.window.loadDashboardStatus();
  assert.equal(elements.statusUpdatedAt.textContent, lastSuccess);
  assert.equal(elements.refreshBtn.hidden, false);
});

test("completion closes and toasts only after save; failure keeps modal ready to retry", async () => {
  const code = source("assets/js/pages/student-course.js");
  const body = code.slice(code.indexOf("window.completeCurrentVideo = async function()"), code.indexOf("// 영상 모달 열기"));
  let resolveSave;
  let rejectSave;
  let calls = 0;
  let closed = 0;
  const toasts = [];
  const statuses = [];
  const watchedVideos = new Set();
  const context = {
    window: {closeVideoModal() { closed++; }, toast: {success(message) { toasts.push(message); }}},
    console: {error() {}},
    activeVideoId: "video-1", completionInProgress: false, watchedVideos,
    syncVideoModalActions() {}, setVideoModalStatus(message, state) { statuses.push([message, state]); },
    markVideoAsWatched() {
      calls++;
      return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
    }
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  const first = context.window.completeCurrentVideo();
  await context.window.completeCurrentVideo();
  assert.equal(calls, 1);
  assert.equal(closed, 0);
  rejectSave(new Error("mock failure"));
  await first;
  assert.equal(closed, 0);
  assert.match(statuses.at(-1)[0], /다시 시도/);

  const retry = context.window.completeCurrentVideo();
  watchedVideos.add("video-1");
  resolveSave();
  await retry;
  assert.equal(calls, 2);
  assert.equal(closed, 1);
  assert.deepEqual(toasts, ["학습 완료로 기록했습니다."]);
  await context.window.completeCurrentVideo();
  assert.equal(calls, 2);
});

test("student list has exactly one visible load action in each state", () => {
  const code = source("assets/js/pages/admin-students.js");
  const body = code.slice(code.indexOf("function setStudentStatusButtonsLoading("), code.indexOf("function hasStudentSummary("));
  const buttons = Object.fromEntries(["#loadStudentsStatus", "#refreshBtn", "#dlStudents"].map(id => [id, {hidden:false,disabled:false,textContent:""}]));
  const context = {
    $: id => buttons[id], hasLoadedStudentStatus: false, filteredStudents: [],
    setAdminRefreshButtonState(button, loading, {disabledWhenReady}) { button.disabled = loading || disabledWhenReady; }
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  context.setStudentStatusButtonsLoading(false);
  assert.equal(buttons["#loadStudentsStatus"].hidden, false);
  assert.equal(buttons["#refreshBtn"].hidden, true);
  context.setStudentStatusButtonsLoading(true);
  assert.equal(buttons["#loadStudentsStatus"].disabled, true);
  assert.equal(buttons["#refreshBtn"].hidden, true);
  context.hasLoadedStudentStatus = true;
  context.setStudentStatusButtonsLoading(false);
  assert.equal(buttons["#loadStudentsStatus"].hidden, true);
  assert.equal(buttons["#refreshBtn"].hidden, false);
  assert.equal(buttons["#refreshBtn"].disabled, false);
  assert.match(source("assets/css/pages/admin.css"), /\.admin-students-page \.btn\[hidden\][\s\S]*?display: none/);
});

test("student detail Escape closes and restores its opener's focus", () => {
  const code = source("assets/js/pages/admin-students.js");
  const body = code.slice(code.indexOf("window.closeEnrollmentDetailModal ="), code.indexOf("// 엑셀 다운로드"));
  let keydown;
  let focused = false;
  const opener = {isConnected:true,focus() {focused=true;}};
  const modal = {style:{display:"flex"},addEventListener(){},querySelectorAll(){return [];}};
  const context = {
    window: {}, enrollmentDetailRequest: 1, enrollmentDetailReturnFocus: opener,
    $: () => modal,
    document: {
      body:{classList:{remove(){}}}, documentElement:{classList:{remove(){}}},
      addEventListener(type, callback) { if (type === "keydown") keydown = callback; }
    }
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  let prevented = false;
  keydown({key:"Escape",preventDefault() {prevented=true;}});
  assert.equal(prevented, true);
  assert.equal(modal.style.display, "none");
  assert.equal(focused, true);
});


test("legacy session dates remain plain text and are escaped only in table HTML", () => {
  const code = source("assets/js/pages/admin-offline-classes.js");
  const start = code.indexOf("function formatSessionDateDisplay(");
  const end = code.indexOf("function sortSessions(", start);
  const format = vm.runInNewContext(`(${code.slice(start, end).trim()})`, {parseSessionDateValue: () => 0});
  for (const raw of ['TBD "A"', "<img src=x onerror=alert(1)>", "A & B"]) {
    assert.equal(format(raw), raw);
  }
  assert.equal(format("2026-10-30"), "2026. 10. 30.");
  assert.equal(format(""), "-");
  assert.match(code, /<td>\$\{escapeHtml\(formatSessionDateDisplay\(row.sessionDate\)\)\}<\/td>/);
});
