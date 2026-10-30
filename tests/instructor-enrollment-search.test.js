const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("instructor enrollment searches commit only on Enter or search button", async () => {
  const { bindCommittedSearch } = await import("../assets/js/utils/list-controls.js");
  const handlers = {};
  const input = { value: "", addEventListener: (type, fn) => { handlers[type] = fn; } };
  const button = { addEventListener: (type, fn) => { handlers[`button:${type}`] = fn; } };
  const commits = [];
  bindCommittedSearch(input, button, (keyword) => commits.push(keyword));
  input.value = " 홍 길동 ";
  assert.deepEqual(commits, []);
  let prevented = false;
  handlers.keydown({ key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(commits, ["홍 길동"]);
  input.value = " 새 검색 ";
  handlers["button:click"]();
  assert.deepEqual(commits, ["홍 길동", "새 검색"]);
});

test("the three instructor roster views use applied keywords and expose search buttons", () => {
  const cases = [
    ["members/instructors/dashboard.html", "enrollmentSearchButton", "assets/js/pages/instructor-dashboard/enrollments.js", "state.appliedEnrollmentKeyword"],
    ["members/instructors/dashboard.html", "offlineEnrollmentSearchButton", "assets/js/pages/instructor-dashboard/offline-enrollments.js", "state.appliedOfflineEnrollmentKeyword"],
    ["members/instructors/course-detail.html", "courseDetailEnrollmentSearchButton", "assets/js/pages/instructor-course-detail.js", "appliedEnrollmentKeyword"],
  ];
  for (const [html, buttonId, js, keyword] of cases) {
    assert.match(read(html), new RegExp(`id="${buttonId}"`));
    const source = read(js);
    assert.ok(source.includes(`bindCommittedSearch(`), js);
    assert.ok(source.includes(keyword), js);
    assert.doesNotMatch(source, /(?:enrollmentSearch|offlineEnrollmentSearch|searchInput)\.addEventListener\("input"/, js);
  }
});
