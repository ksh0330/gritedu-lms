// 승인형 강좌 완료 ID 보정 스크립트와 학부모 계산: 합성 데이터만 사용한다(운영 DB 없음).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseArgs, buildCompletionIdPlan, backfillCourse, loadCompletion } = require("../scripts/backfill-course-completion-ids.js");

const root = path.join(__dirname, "..");
const weeks = [{ id: "w1", videos: [
  { completionId: "keep", url: "https://example.com/private-1" },
  { url: "https://example.com/private-2" },
] }];

test("인자: 기본 dry-run, 쓰기는 명시 플래그와 숫자 확인값만", () => {
  assert.deepEqual(parseArgs(["--project", "p"]), { dryRun: true, projectId: "p", confirmCount: null });
  assert.throws(() => parseArgs(["--write", "--confirm-count", "-1"]), /nonnegative integer/);
  assert.throws(() => parseArgs(["--all"]), /Unknown argument/);
});

test("대상 계산: 학생 화면과 같은 ID를 만들고 URL은 담지 않으며, 보호 문서가 없으면 막는다", async () => {
  const { collectCourseVideoIds } = await loadCompletion();
  const expected = collectCourseVideoIds("c1", weeks);
  assert.deepEqual(expected, ["keep", "c1_week_w1_video_1"]);
  const courses = [
    { id: "c1", data: { accessType: "approvalRequired" } },
    { id: "c2", data: { accessType: "approvalRequired", completionVideoIds: ["c2_week_w1_video_0"] } },
    { id: "c3", data: { accessType: "approvalRequired" } },
  ];
  const privateById = new Map([
    ["c1", { weeks }],
    ["c2", { weeks: [{ id: "w1", videos: [{ url: "https://example.com/a" }] }] }],
    ["c3", null],
  ]);
  const { totals, targets } = buildCompletionIdPlan(courses, privateById, collectCourseVideoIds);
  assert.deepEqual(targets, ["c1"]);
  assert.deepEqual(totals, { approvalCourses: 3, toUpdate: 1, alreadyCurrent: 1, blockedMissingPrivate: 1, withoutVideos: 0 });
});

test("쓰기: 트랜잭션 안에서 보호 문서로 다시 계산하고 ID 목록 한 필드만 쓴다", async () => {
  const { collectCourseVideoIds } = await loadCompletion();
  const writes = [];
  const refs = { courses: { id: "c1", kind: "course" }, coursePrivateContent: { id: "c1", kind: "private" } };
  const db = {
    collection: (name) => ({ doc: () => refs[name] }),
    runTransaction: (fn) => fn({
      get: async (ref) => ref.kind === "course"
        ? { exists: true, data: () => ({ accessType: "approvalRequired" }) }
        : { exists: true, data: () => ({ weeks }) },
      update: (ref, data) => writes.push({ ref: ref.kind, data }),
    }),
  };
  assert.equal(await backfillCourse(db, "c1", collectCourseVideoIds), "updated");
  assert.deepEqual(writes, [{ ref: "course", data: { completionVideoIds: ["keep", "c1_week_w1_video_1"] } }]);
  assert.ok(!JSON.stringify(writes).includes("http"));
});

test("학부모 계산: 완료 ID 목록이 있으면 그것으로, 없으면 확인 불가(null)", async () => {
  const { getCompletionFromVideoIds } = await loadCompletion();
  assert.equal(getCompletionFromVideoIds(undefined, ["a"]), null);
  assert.deepEqual(getCompletionFromVideoIds(["a", "b"], ["a", "gone"]), { completed: 1, total: 2, progress: 50 });
  assert.deepEqual(getCompletionFromVideoIds([], []), { completed: 0, total: 0, progress: 0 });
  const dashboard = fs.readFileSync(path.join(root, "assets/js/pages/member-dashboard.js"), "utf8");
  assert.match(dashboard, /getCompletionFromVideoIds\(result\.data\.completionVideoIds, enrollment\.watchedVideos\)/);
  const adminCourses = fs.readFileSync(path.join(root, "assets/js/pages/admin-courses.js"), "utf8");
  const approvalSave = adminCourses.slice(adminCourses.indexOf('if (accessType === "approvalRequired") {'));
  assert.match(approvalSave, /completionVideoIds: collectCourseVideoIds\(courseRef\.id, savePayload\.weeks\)/);
});
