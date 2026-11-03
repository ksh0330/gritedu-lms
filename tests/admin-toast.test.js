const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("admin work screens use a separate status message path", () => {
  const pages = [
    "admin-students.js", "admin-members.js", "admin-instructors.js",
    "admin-courses.js", "admin-offline-classes.js", "admin-user-add.js",
    "admin-site.js", "admin-story-cms.js", "admin-popup.js", "admin-timetable.js",
  ];
  for (const name of pages) {
    const code = fs.readFileSync(path.join(root, "assets/js/pages", name), "utf8");
    assert.match(code, /import \{ showAdminToast \} from "\/assets\/js\/utils\/admin-toast\.js"/);
  }
  const css = fs.readFileSync(path.join(root, "assets/css/pages/admin.css"), "utf8");
  assert.match(css, /#statusMsg\.admin-work-status[\s\S]*width: min\(420px/);
  assert.match(css, /#statusMsg\.admin-work-status\.is-error/);
  assert.match(css, /#statusMsg\.admin-work-status\[hidden\][\s\S]*display: none/);
  assert.doesNotMatch(css, /admin-toast-host|admin-toast-page/);
  const popup = fs.readFileSync(path.join(root, "assets/js/pages/admin-popup.js"), "utf8");
  assert.match(popup, /if \(err && \$\("#popupEditModal"\)\?\.style\.display === "flex"\) \{[\s\S]*setPopupModalAlert\(msg, true\)/);
});

test("admin status reuses statusMsg, handles error, deduplicates and hides without global toast", () => {
  const source = fs.readFileSync(path.join(root, "assets/js/utils/admin-toast.js"), "utf8");
  assert.doesNotMatch(source, /toast\.js|window\.toast|toast-container/);
  const values = new Set();
  const attrs = {};
  let timer = null;
  let created = 0;
  const status = {
    classList: {
      add: (name) => values.add(name),
      remove: (name) => values.delete(name),
      toggle: (name, enabled) => enabled ? values.add(name) : values.delete(name),
      contains: (name) => values.has(name),
    },
    style: { removeProperty() {} },
    setAttribute: (name, value) => { attrs[name] = value; },
    parentElement: null,
    textContent: "",
  };
  const body = { appendChild: (element) => { element.parentElement = body; } };
  const context = {
    window: { toast: { success() { throw new Error("global auth toast called"); } } },
    document: {
      getElementById: () => status.parentElement ? status : null,
      createElement: () => { created += 1; return status; },
      body,
    },
    Date: { now: () => 1000 },
    setTimeout: (fn, delay) => { timer = { fn, delay }; return timer; },
    clearTimeout: (existing) => { if (existing) existing.cancelled = true; timer = null; },
  };
  const show = vm.runInNewContext(`(() => { ${source.replace("export function", "function")}; return showAdminToast; })()`, context);
  assert.equal(show("다운로드 완료"), status);
  assert.equal(created, 1);
  assert.equal(status.textContent, "다운로드 완료");
  assert.equal(attrs.role, "status");
  assert.equal(timer.delay, 2700);
  const firstTimer = timer;
  show("다운로드 완료");
  assert.equal(firstTimer.cancelled, true);
  assert.notEqual(timer, firstTimer);
  assert.equal(timer.delay, 2700);
  const secondTimer = timer;
  show("조회 실패", true);
  assert.equal(secondTimer.cancelled, true);
  assert.equal(created, 1);
  assert.equal(attrs.role, "alert");
  assert.equal(values.has("is-error"), true);
  assert.equal(status.textContent, "조회 실패");
  timer.fn();
  assert.equal(values.has("is-visible"), false);
  assert.equal(status.textContent, "");
  assert.equal(status.hidden, true);
  show("다시 표시");
  assert.equal(created, 1);
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, "다시 표시");
});

test("six admin export buttons start disabled and pages gate them on loaded results", () => {
  const cases = [
    ["courses.html", "dlCourses", "admin-courses.js", "setCourseExportReady"],
    ["offline-classes.html", "dlOfflineClasses", "admin-offline-classes.js", "setOfflineClassExportReady"],
    ["users/students.html", "dlStudents", "admin-students.js", "setStudentStatusButtonsLoading"],
    ["users/members.html", "dlMembers", "admin-members.js", "setMemberExportReady"],
    ["users/instructors.html", "dlInstructors", "admin-instructors.js", "setInstructorExportReady"],
    ["users/add.html", "dlUsers", "admin-user-add.js", "setUsersExportReady"],
  ];
  for (const [htmlName, id, jsName, stateFunction] of cases) {
    const html = fs.readFileSync(path.join(root, "members/admin", htmlName), "utf8");
    assert.match(html, new RegExp(`<button[^>]+id="${id}"[^>]+disabled`), id);
    const code = fs.readFileSync(path.join(root, "assets/js/pages", jsName), "utf8");
    assert.match(code, new RegExp(`function ${stateFunction}\\(`), jsName);
  }
});
