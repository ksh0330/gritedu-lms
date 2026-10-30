const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/utils/instructor-course-access.js"), "utf8");
const helper = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("instructor rosters cover immediate, approval, and legacy paid enrollment types", async () => {
  const { hasInstructorRoster } = await helper;
  assert.equal(hasInstructorRoster("public"), false);
  for (const type of ["memberOnly", "approvalRequired", "paid"]) {
    assert.equal(hasInstructorRoster(type), true, type);
  }
});

test("instructor rosters omit revoked enrollment while retaining legacy active records", async () => {
  const { isActiveCourseEnrollment } = await helper;
  assert.equal(isActiveCourseEnrollment({}), true);
  assert.equal(isActiveCourseEnrollment({ status: "active" }), true);
  for (const status of ["pending", "revoked", "cancelled", "blocked"]) {
    assert.equal(isActiveCourseEnrollment({ status }), false, status);
  }
});

test("instructor pages use the shared roster policy and expose the approval filter", () => {
  const dashboard = fs.readFileSync(path.join(root, "assets/js/pages/instructor-dashboard/enrollments.js"), "utf8");
  const detail = fs.readFileSync(path.join(root, "assets/js/pages/instructor-course-detail.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "members/instructors/dashboard.html"), "utf8");
  assert.match(dashboard, /filter\(isEnrollmentManagedCourse\)/);
  assert.match(dashboard, /isActiveCourseEnrollment\(enrollment\)/);
  assert.match(detail, /isEnrollmentManagedCourse\(courseData\)/);
  assert.match(detail, /isActiveCourseEnrollment\(enrollment\)/);
  assert.match(html, /<option value="approvalRequired">회원 전용\(유료\)<\/option>/);
});
