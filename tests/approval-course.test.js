const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/utils/approval-course.js"), "utf8");
const helper = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("only students and general members can request approval", async () => {
  const { canRequestApprovalCourse } = await helper;
  assert.equal(canRequestApprovalCourse("student", null), true);
  assert.equal(canRequestApprovalCourse("member", "general"), true);
  assert.equal(canRequestApprovalCourse("member", "parent"), false);
  assert.equal(canRequestApprovalCourse("member", null), false);
  assert.equal(canRequestApprovalCourse("instructor", null), false);
  assert.equal(canRequestApprovalCourse(null, null), false);
});

test("loaded approval requests search by name, email, or UID without changing source rows", async () => {
  const { filterApprovalRequests } = await helper;
  const rows = [
    { userId: "student-1", profile: { name: "유진", email: "student@example.test" } },
    { userId: "member-2", profile: { name: "민수", email: "member@example.test" } }
  ];
  assert.deepEqual(filterApprovalRequests(rows, "  유진 "), [rows[0]]);
  assert.deepEqual(filterApprovalRequests(rows, "MEMBER@"), [rows[1]]);
  assert.deepEqual(filterApprovalRequests(rows, "student-1"), [rows[0]]);
  assert.deepEqual(filterApprovalRequests(rows, "없음"), []);
  assert.equal(rows.length, 2);
});

test("public approval course payload excludes video and preview content", async () => {
  const { toApprovalPublicCourse } = await helper;
  const full = {
    title: "샘플 강좌",
    accessType: "approvalRequired",
    weeks: [{ title: "1주차", videos: [{ url: "https://youtube.com/live/RjSFJQ60zHg" }] }],
    previewVideoUrl: "https://youtu.be/RjSFJQ60zHg",
    lectureContent: "protected video content",
    learningContent: "https://youtu.be/RjSFJQ60zHg",
    videoUrl: "https://youtu.be/RjSFJQ60zHg",
    curriculumWeeks: [{ videos: [{ url: "https://youtu.be/RjSFJQ60zHg" }] }],
    previewUrl: "https://youtu.be/RjSFJQ60zHg"
  };
  const publicPayload = toApprovalPublicCourse(full);
  assert.equal(publicPayload.title, full.title);
  assert.deepEqual(publicPayload.weeks, []);
  assert.equal(publicPayload.previewVideoUrl, null);
  assert.equal("lectureContent" in publicPayload, false);
  assert.equal("learningContent" in publicPayload, false);
  assert.equal("videoUrl" in publicPayload, false);
  assert.equal("curriculumWeeks" in publicPayload, false);
  assert.equal("previewUrl" in publicPayload, false);
  assert.equal(full.weeks[0].videos[0].url, "https://youtube.com/live/RjSFJQ60zHg");
});
