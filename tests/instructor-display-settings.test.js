const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helper = import(`data:text/javascript;base64,${Buffer.from(read("assets/js/utils/instructor-videos.js")).toString("base64")}`);
const A = "RjSFJQ60zHg";
const B = "dQw4w9WgXcQ";

test("강사 소개영상은 여러 줄·CRLF·빈 줄·중복 URL을 같은 순서로 저장하고 재편집한다", async () => {
  const { parseInstructorVideoLines, collectInstructorVideos } = await helper;
  const text = `https://youtu.be/${A}\r\n\r\nhttps://www.youtube.com/watch?v=${B}\nhttps://youtube.com/watch?v=${A}`;
  const parsed = parseInstructorVideoLines(text);
  assert.deepEqual(parsed.invalidLines, []);
  assert.deepEqual(parsed.videos.map((v) => v.id), [A, B]);
  assert.deepEqual(collectInstructorVideos({ videos: parsed.videos }).map((v) => v.id), [A, B]);
  assert.deepEqual(Object.keys(parsed.videos[0]), ["url", "fullUrl", "id", "title"]);
});

test("소개영상 Shorts·Live·embed·ID와 기존 MP4가 모두 관리자/공개에서 같은 목록이다", async () => {
  const { parseInstructorVideoLines, collectInstructorVideos } = await helper;
  const text = `https://youtube.com/shorts/${A}?feature=share\nhttps://youtube.com/live/${B}\nhttps://youtube.com/embed/${A}\n${B}\nhttps://media.example.test/video.mp4`;
  const { videos, invalidLines } = parseInstructorVideoLines(text);
  assert.deepEqual(invalidLines, []);
  assert.equal(videos.length, 3);
  assert.deepEqual(collectInstructorVideos({ videos }).map((v) => v.type), ["youtube", "youtube", "media"]);
});

test("레거시 영상 객체 및 여러 줄 단일 필드가 재저장 시 누락되지 않는다", async () => {
  const { collectInstructorVideos } = await helper;
  const list = collectInstructorVideos({ videos: [{ embedUrl: `https://youtube.com/embed/${A}` }, { youtubeId: B }], video: `${A}\n${B}`, youtube_url: `https://youtu.be/${A}` });
  assert.deepEqual(list.map((v) => v.id), [A, B]);
});

test("script·속성 탈출·잘못된 YouTube ID는 거절하고 잘못된 줄 번호를 보존한다", async () => {
  const { parseInstructorVideoLines } = await helper;
  const parsed = parseInstructorVideoLines(`${A}\n\njavascript:alert(1)\nhttps://youtube.com/watch?v=bad\nhttps://youtube.com/watch?v=${A}%22onload=alert(1)`);
  assert.deepEqual(parsed.invalidLines, [3, 4, 5]);
  assert.equal(parsed.videos.length, 1);
});

function saveContext({ fail = false, migration = false, changeSubject = false } = {}) {
  const source = read("assets/js/pages/admin-instructors.js");
  const start = source.indexOf("async function saveInstructorSubjectsDraft()");
  const fn = source.slice(start, source.indexOf("\nfunction setupInstructorCatalogPanel()", start));
  const writes = [];
  const ctx = vm.createContext({
    instructorCatalogSaving: false, instructorCatalogLoadFailed: false,
    instructorSubjectsNeedMigration: migration,
    instructorSubjectsDraft: changeSubject ? ["국어", "논술"] : ["국어"], instructorMenuSubjects: ["국어"],
    savedInstructorDetailSections: { video: true, curriculum: false, courses: true },
    readGlobalDetailSectionFromUi: () => ({ video: false, curriculum: false, courses: true }),
    auth: { currentUser: { uid: "admin-test" } }, db: {},
    $: () => ({}), setCatalogPanelSaving() {}, toast() {},
    instructorSubjectColorSourceMap: {}, persistedInstructorSubjectColorMap: {},
    instructorSubjectColorMap: {}, buildSubjectColorSettingsPayload: () => ({ subjectColorMap: {} }),
    areSubjectColorMapsEqual: () => true,
    buildInstructorMenuSubjectsPayload: (subjects) => ({ subjects }),
    writeBatch: () => ({ set: (ref, payload) => writes.push({ ref, payload }), commit: async () => { if (fail) throw Error("offline"); } }),
    doc: (_db, ...parts) => parts.join("/"), serverTimestamp: () => "ts", deleteField: () => "DELETE",
    invalidateSetting() {}, applyInstructorSubjectsDraft() {}, scheduleInstructorDetailPreview() {},
    console: { error() {} },
  });
  vm.runInContext(fn, ctx);
  return { ctx, writes };
}

test("공개 표시만 저장하면 과목을 다시 쓰지 않고, 실패하면 저장본 상태를 바꾸지 않는다", async () => {
  const ok = saveContext();
  await ok.ctx.saveInstructorSubjectsDraft();
  assert.equal(ok.writes[0].ref, "settings/instructorsMenu");
  assert.equal(ok.writes[0].payload.subjects, undefined);
  assert.equal(ok.writes[0].payload.detailSections.video, false);
  assert.equal(ok.ctx.savedInstructorDetailSections.video, false);
  const fail = saveContext({ fail: true });
  await fail.ctx.saveInstructorSubjectsDraft();
  assert.equal(fail.ctx.savedInstructorDetailSections.video, true);
  assert.equal(fail.ctx.instructorCatalogSaving, false);
});

test("레거시 과목 설정은 표시 설정만 바꿔도 canonical subjects를 기록한 뒤 정리한다", async () => {
  const { ctx, writes } = saveContext({ migration: true });
  await ctx.saveInstructorSubjectsDraft();
  assert.deepEqual(Array.from(writes[0].payload.subjects), ["국어"]);
  assert.equal(ctx.instructorSubjectsNeedMigration, false);
});

test("강사 계정 생성·패널은 같은 메뉴를 최신 조회하고 관리자와 공개 영상은 동일 파서를 사용한다", () => {
  assert.match(read("assets/js/pages/admin-user-add.js"), /loadInstructorMenuSubjects\(getAdminSettingDoc\)/);
  const admin = read("assets/js/pages/admin-instructors.js");
  assert.match(admin, /getAdminSettingDoc\("instructorsMenu"\)/);
  assert.doesNotMatch(admin, /window\.savePublicInstructorDetailSections/);
  assert.match(admin, /escapeHtml\(videoInfo\.url\)/);
  const html = read("members/admin/users/instructors.html");
  assert.match(html, /선택 목록 관리 <span/);
  assert.doesNotMatch(html, /표시 설정 저장|강사 공개 페이지 표시 설정/);
  for (const page of ["admin-instructors.js", "instructor-details.js"]) {
    assert.match(read(`assets/js/pages/${page}`), /import \{ collectInstructorVideos[, }].*instructor-videos\.js/);
  }
});


test("기존 상대 영상 경로는 localhost origin으로 바꿔 저장하지 않는다", async () => {
  const { parseInstructorVideoLines } = await helper;
  const before = globalThis.location;
  globalThis.location = { origin: "http://127.0.0.1:8000" };
  try {
    const parsed = parseInstructorVideoLines("/media/one.mp4\n./two.mp4\nvideos/three.mp4");
    assert.deepEqual(parsed.invalidLines, []);
    assert.deepEqual(parsed.videos.map((v) => v.url), ["/media/one.mp4", "./two.mp4", "videos/three.mp4"]);
    assert.ok(parsed.videos.every((v) => !v.fullUrl.includes("127.0.0.1")));
  } finally { globalThis.location = before; }
});
