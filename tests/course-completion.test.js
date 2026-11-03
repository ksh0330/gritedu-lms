const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/utils/course-completion.js"), "utf8");
const completion = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const readonlySource = fs.readFileSync(path.join(root, "assets/js/utils/course-readonly.js"), "utf8")
  .replace(/^import \{ mergeCourseCatalog, buildLabelMaps \} from [^\n]+\n/m, "");
const readonly = import(`data:text/javascript;base64,${Buffer.from(readonlySource).toString("base64")}`);

function createStoredEnrollment(initial = []) {
  let watchedVideos = [...initial];
  const writes = [];
  return {
    get watchedVideos() { return watchedVideos; },
    writes,
    run: async (operation) => {
      const transaction = {
        get: async () => ({ exists: () => true, data: () => ({ watchedVideos: [...watchedVideos] }) }),
        update: (_ref, next) => { writes.push(next); watchedVideos = next.watchedVideos; }
      };
      return operation(transaction);
    }
  };
}

test("0, 1, 2, and 3 video completion ratios stay exact", async () => {
  const { summarizeCourseCompletion } = await completion;
  assert.deepEqual(summarizeCourseCompletion([], []), { completed: 0, total: 0, progress: 0 });
  assert.equal(summarizeCourseCompletion(["a"], []).progress, 0);
  assert.equal(summarizeCourseCompletion(["a"], ["a"]).progress, 100);
  assert.equal(summarizeCourseCompletion(["a", "b"], ["a"]).progress, 50);
  assert.deepEqual(summarizeCourseCompletion(["a", "b", "c"], ["a"]), {
    completed: 1, total: 3, progress: 33
  });
  assert.equal(summarizeCourseCompletion(["a", "b", "c"], ["a", "b", "c"]).progress, 100);
});

test("current course videos recalculate completion after content changes", async () => {
  const { collectCourseVideoIds, getCurrentCourseCompletion } = await completion;
  const courseId = "course-1";
  const first = [{ id: "week_1", videos: [{ id: "video_1", title: "기존 영상", url: "https://example.com/one" }] }];
  const watchedVideos = collectCourseVideoIds(courseId, first);
  assert.equal(getCurrentCourseCompletion(courseId, first, watchedVideos).progress, 100);

  const changed = [{ id: "week_1", videos: [
    { id: "video_1", title: "수정된 제목", url: "https://example.com/updated" },
    { id: "video_2", title: "새 영상", url: "https://example.com/two" }
  ] }];
  assert.deepEqual(getCurrentCourseCompletion(courseId, changed, watchedVideos), {
    completed: 1, total: 2, progress: 50
  });
  assert.equal(getCurrentCourseCompletion(courseId, changed, [...watchedVideos, collectCourseVideoIds(courseId, changed)[1]]).progress, 100);
  assert.equal(getCurrentCourseCompletion(courseId, [], watchedVideos).progress, 0);

  const replacement = [{ id: "week_1", videos: [
    { id: "video_new", completionId: "video_new_unique", url: "https://example.com/replacement" }
  ] }];
  assert.deepEqual(getCurrentCourseCompletion(courseId, replacement, watchedVideos), {
    completed: 0, total: 1, progress: 0
  });
});

test("course save and read normalization preserve completion IDs", async () => {
  const { buildCanonicalCoursePayload, normalizeCurriculumWeeks } = await readonly;
  const weeks = [{ id: "week_legacy", title: "1주차", videos: [
    { id: "video_old", completionId: "course_week_week_legacy_video_0", title: "수정", url: "https://example.com/old" },
    { id: "video_new", completionId: "video_unique", title: "추가", url: "https://example.com/new" }
  ] }];
  const payload = buildCanonicalCoursePayload({ title: "강좌", courseFormat: "series", weeks });
  assert.equal(payload.weeks[0].id, "week_legacy");
  assert.equal(payload.weeks[0].videos[0].id, "video_old");
  assert.equal(payload.weeks[0].videos[0].completionId, "course_week_week_legacy_video_0");
  assert.equal(payload.weeks[0].videos[1].completionId, "video_unique");
  assert.equal(normalizeCurriculumWeeks(payload.weeks)[0].videos[1].completionId, "video_unique");
});

test("existing completion IDs remain, and duplicate clicks create no write", async () => {
  const { completeVideoInTransaction } = await completion;
  const store = createStoredEnrollment(["legacy-video", "a"]);
  const args = [store.run, "enrollment", ["a", "b"], "b", () => "timestamp"];
  const first = await completeVideoInTransaction(...args);
  assert.deepEqual(first.watchedVideos, ["legacy-video", "a", "b"]);
  assert.equal(first.progress, 100);
  assert.equal(store.writes.length, 1);
  await completeVideoInTransaction(...args);
  assert.equal(store.writes.length, 1);
});

test("each completion reads current stored IDs, preserving another tab's update", async () => {
  const { completeVideoInTransaction } = await completion;
  const store = createStoredEnrollment();
  await completeVideoInTransaction(store.run, "enrollment", ["a", "b"], "a", () => "timestamp");
  const second = await completeVideoInTransaction(store.run, "enrollment", ["a", "b"], "b", () => "timestamp");
  assert.deepEqual(second.watchedVideos, ["a", "b"]);
  assert.equal(second.progress, 100);
});

test("invalid ID and failed save leave completion unchanged", async () => {
  const { completeVideoInTransaction } = await completion;
  const store = createStoredEnrollment();
  await assert.rejects(completeVideoInTransaction(store.run, "enrollment", ["a"], "b", () => "timestamp"));
  await assert.rejects(completeVideoInTransaction(async () => { throw new Error("offline"); }, "enrollment", ["a"], "a", () => "timestamp"));
  assert.deepEqual(store.watchedVideos, []);
  assert.equal(store.writes.length, 0);
});

test("student and member modals expose explicit completion and safe external viewing", () => {
  const page = fs.readFileSync(path.join(root, "assets/js/pages/student-course.js"), "utf8");
  for (const file of ["members/students/course.html", "members/member/course.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /id="watchOnYouTube"[^>]*target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /id="markVideoComplete"[^>]*onclick="completeCurrentVideo\(\)"/);
    assert.match(html, /id="videoModalStatus"[^>]*role="status" aria-live="polite"/);
  }
  assert.match(page, /youtubeLink\.href = videoInfo\.watchUrl/);
  assert.match(page, /await markVideoAsWatched\(videoId\)/);
  assert.match(page, /item\.dataset\.videoUrl, item\.dataset\.videoTitle, item\.dataset\.videoId/);
  assert.doesNotMatch(page, /onclick="openVideoModal/);
  assert.doesNotMatch(page, /setTimeout\(async \(\) => \{\s*await markVideoAsWatched/);
});

test("100%(완료)는 현재 영상을 모두 봤을 때만 표시하고 반올림으로 완료가 되지 않는다", async () => {
  const { summarizeCourseCompletion, getCurrentCourseCompletion } = await completion;
  const ids = Array.from({ length: 200 }, (_, i) => `v${i}`);
  assert.deepEqual(summarizeCourseCompletion(ids, ids.slice(0, 199)), { completed: 199, total: 200, progress: 99 });
  assert.equal(summarizeCourseCompletion(ids, ids).progress, 100);
  assert.equal(summarizeCourseCompletion(["a", "b", "c"], ["a", "b"]).progress, 67);
  // 삭제된 영상의 시청 기록은 세지 않고, 새 영상이 추가되면 다시 100% 미만이 된다.
  const courseId = "course-1";
  const weeks = [{ id: "w1", videos: [{ completionId: "keep", url: "https://example.com/keep" }] }];
  assert.deepEqual(getCurrentCourseCompletion(courseId, weeks, ["keep", "deleted-video"]), { completed: 1, total: 1, progress: 100 });
  const added = [{ id: "w1", videos: [
    { completionId: "keep", url: "https://example.com/keep" },
    { completionId: "new", url: "https://example.com/new" },
  ] }];
  assert.equal(getCurrentCourseCompletion(courseId, added, ["keep"]).progress, 50);
});

test("학부모 자녀 학습 카드는 현재 강좌 영상으로 계산한 완료율이 100일 때만 '수강 완료'로 표시한다", () => {
  const dashboard = fs.readFileSync(path.join(root, "assets/js/pages/member-dashboard.js"), "utf8");
  const childRows = dashboard.slice(dashboard.indexOf("async function loadChildOnlineRows"), dashboard.indexOf("async function loadChildOfflineRows"));
  assert.match(childRows, /getCurrentCourseCompletion\(enrollment\.courseId, course\.weeks, enrollment\.watchedVideos\)/);
  assert.doesNotMatch(childRows, /enrollment\.progress/, "저장된 진도 값(과거 영상 기준)을 쓰지 않는다");
  const labels = dashboard.slice(dashboard.indexOf("function formatChildOnlineRows"));
  assert.match(labels, /progress >= 100\s*\?\s*"수강 완료"/);
});
