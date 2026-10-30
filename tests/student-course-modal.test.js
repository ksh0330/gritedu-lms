const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "assets/js/pages/student-course.js"), "utf8");
const start = page.indexOf("function setVideoModalStatus(");
const end = page.indexOf("// 영상 모달 외부 클릭 시 닫기", start);
assert.ok(start >= 0 && end > start);
const modalSource = page.slice(start, end);
const videoSource = fs.readFileSync(path.join(root, "assets/js/utils/video-url.js"), "utf8");
const videoModule = import(`data:text/javascript;base64,${Buffer.from(videoSource).toString("base64")}`);

async function createModalHarness(save = async () => {}) {
  const { normalizeVideoUrl } = await videoModule;
  const elements = new Map();
  const document = {
    activeElement: null,
    body: { style: {}, classList: { add() {}, remove() {} } },
    documentElement: { style: {} },
    getElementById: (id) => elements.get(id),
    querySelectorAll: () => [opener]
  };
  const opener = { dataset: { videoId: "video-a" }, isConnected: true, focus: () => { document.activeElement = opener; } };
  const closeButton = { focus: () => { document.activeElement = closeButton; } };
  const modal = { style: { display: "none" }, querySelector: () => closeButton };
  const link = { hidden: true, href: "", removeAttribute: () => { link.href = ""; } };
  const button = { disabled: false, textContent: "" };
  const status = { textContent: "", dataset: {} };
  const player = { innerHTML: "" };
  const hint = { textContent: "" };
  elements.set("videoModal", modal);
  elements.set("videoModalTitle", { textContent: "" });
  elements.set("videoPlayer", player);
  elements.set("watchOnYouTube", link);
  elements.set("markVideoComplete", button);
  elements.set("videoModalStatus", status);
  elements.set("videoModalHint", hint);
  document.activeElement = opener;

  let saveCalls = 0;
  const successToasts = [];
  const context = {
    document,
    navigator: { userAgent: "" },
    normalizeVideoUrl,
    escapeHtml: (value) => value,
    isStudentCourseAvailable: () => true,
    showLearningGate: () => { throw new Error("unexpected gate"); },
    console: { error() {} },
    save: async (id) => { saveCalls++; await save(id); },
    window: { scrollY: 0, scrollTo() {}, toast: { success(message) { successToasts.push(message); } } }
  };
  vm.runInNewContext(`
    let activeVideoId = null;
    let modalReturnFocus = null;
    let completionInProgress = false;
    const watchedVideos = new Set();
    const courseData = {};
    async function markVideoAsWatched(id) { await save(id); watchedVideos.add(id); }
    ${modalSource}
  `, context);
  return { context, document, modal, player, link, button, status, hint, opener, successToasts, get saveCalls() { return saveCalls; } };
}

test("opening, external viewing, and closing never save completion", async () => {
  const harness = await createModalHarness();
  harness.context.window.openVideoModal("https://youtube.com/live/RjSFJQ60zHg?feature=share", "수학 1교시", "video-a");
  assert.match(harness.player.innerHTML, /youtube\.com\/embed\/RjSFJQ60zHg/);
  assert.equal(harness.link.href, "https://www.youtube.com/watch?v=RjSFJQ60zHg");
  assert.equal(harness.link.hidden, false);
  assert.equal(harness.saveCalls, 0);
  harness.context.window.closeVideoModal();
  assert.equal(harness.saveCalls, 0);
  assert.equal(harness.document.activeElement, harness.opener);
});

test("completion button saves once and announces success only after acknowledgement", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const harness = await createModalHarness(() => pending);
  harness.context.window.openVideoModal("https://youtu.be/RjSFJQ60zHg", "수학 1교시", "video-a");
  const first = harness.context.window.completeCurrentVideo();
  const second = harness.context.window.completeCurrentVideo();
  assert.equal(harness.saveCalls, 1);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.status.dataset.state, "saving");
  release();
  await Promise.all([first, second]);
  assert.equal(harness.modal.style.display, "none");
  assert.equal(harness.document.activeElement, harness.opener);
  assert.deepEqual(harness.successToasts, ["학습 완료로 기록했습니다."]);
  assert.equal(harness.button.textContent, "학습 완료됨");
  assert.equal(harness.button.disabled, true);
});

test("failed completion remains retryable and does not show success", async () => {
  const harness = await createModalHarness(async () => { throw new Error("offline"); });
  harness.context.window.openVideoModal("https://www.youtube.com/watch?v=RjSFJQ60zHg", "수학 1교시", "video-a");
  await harness.context.window.completeCurrentVideo();
  assert.equal(harness.status.dataset.state, "error");
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, "학습 완료");
});

test("MP4 keeps in-modal playback without a YouTube link", async () => {
  const harness = await createModalHarness();
  harness.context.window.openVideoModal("https://cdn.example.test/video.mp4", "MP4", "video-a");
  assert.match(harness.player.innerHTML, /<video controls autoplay>/);
  assert.equal(harness.link.hidden, true);
  assert.equal(harness.saveCalls, 0);
});
