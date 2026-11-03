const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("administrator instructor CSV uses merged private fields and escapes spreadsheet input", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../assets/js/utils/instructor-csv.js"), "utf8");
  const { buildInstructorAdminCsv } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const csv = buildInstructorAdminCsv([{ name: "강사, 하나", subjects: ["수학", "과학"],
    email: "teacher@example.test", phone: "010-0000-0000", note: '=HYPERLINK("unsafe")',
    hasAccount: false, onlineCourseCount: 2, offlineClassCount: 1 }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"이메일","연락처","내부 메모","계정 연결"/);
  assert.match(csv, /"teacher@example\.test","010-0000-0000","'=HYPERLINK\(""unsafe""\)","프로필만 등록됨"/);
  assert.match(csv, /"강사, 하나","수학, 과학"/);
  assert.ok(!csv.includes("authUid"));
});
