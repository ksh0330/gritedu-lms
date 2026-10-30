const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "assets/js/pages/admin-courses.js"), "utf8");
const html = fs.readFileSync(path.join(root, "members/admin/courses.html"), "utf8");

test("admin preview has a separate read-only dialog and an explicit role check", () => {
  assert.match(code, /data-course-preview="\$\{escapeHtml\(item\.id\)/);
  assert.match(code, /tbody\?\.addEventListener\("click"/);
  assert.match(html, /id="adminCoursePreviewModal"[^>]+role="dialog"/);
  const preview = code.slice(code.indexOf("window.openAdminCoursePreview ="), code.indexOf("window.closeAdminCoursePreview ="));
  assert.match(preview, /await requireRole\("admin"/);
  assert.match(preview, /getDoc\(doc\(db, "courses", courseId\)\)/);
  assert.match(preview, /getDoc\(doc\(db, "coursePrivateContent", courseId\)\)/);
  assert.doesNotMatch(preview, /(?:updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/);
});

test("preview player supports YouTube live, playlist, MP4 and rejects invalid URLs", async () => {
  const { normalizeVideoUrl } = await import("../assets/js/utils/video-url.js");
  const start = code.indexOf("function renderAdminCourseVideo(");
  const end = code.indexOf("\nwindow.openAdminCoursePreview =", start);
  const render = vm.runInNewContext(`(${code.slice(start, end)})`, {
    normalizeVideoUrl,
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
  });
  assert.match(render({ url: "https://www.youtube.com/live/abcdefghijk" }, "Live"), /<iframe[^>]+youtube\.com\/embed\/abcdefghijk/);
  assert.match(render({ url: "https://www.youtube.com/playlist?list=PLabcdefghijkl" }, "목록"), /embed\/videoseries\?list=PLabcdefghijkl/);
  assert.match(render({ url: "https://example.com/a.mp4" }, "MP4"), /<video controls/);
  assert.doesNotMatch(render({ url: "javascript:alert(1)" }, "잘못됨"), /<(?:iframe|video)/);
});
