// 오프라인 회차 영상 분리 저장 도우미·이전 스크립트·저장 경로 회귀 테스트. DB를 사용하지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const load = () => import(pathToFileURL(path.join(root, "assets/js/utils/offline-session-videos.js")).href);

test("회차 문서에 URL이 있으면 그대로 쓰고, 없으면 분리 문서를 읽어야 한다고 판단한다", async () => {
  const { sessionNeedsPrivateVideos } = await load();
  assert.equal(sessionNeedsPrivateVideos({ hasVideo: true, videos: [{ url: "u" }] }), false);
  assert.equal(sessionNeedsPrivateVideos({ hasVideo: true, videoUrl: "u" }), false);
  assert.equal(sessionNeedsPrivateVideos({ hasVideo: true, videoCount: 2 }), true);
  assert.equal(sessionNeedsPrivateVideos({ hasVideo: false }), false);
});

test("분리 문서 내용과 회차 메타: 영상이 없으면 문서를 만들지 않고 URL은 메타에 넣지 않는다", async () => {
  const { buildSessionPrivatePayload, buildSessionVideoMeta } = await load();
  const videos = [{ title: "1강", url: "https://example.test/1" }, { title: "2강", url: "https://example.test/2" }];
  assert.deepEqual(buildSessionPrivatePayload({ classId: "c", videos, hasVideo: true }), { classId: "c", videos, videoUrl: "https://example.test/1" });
  assert.equal(buildSessionPrivatePayload({ classId: "c", videos: [], hasVideo: false }), null);
  assert.deepEqual(buildSessionVideoMeta(videos, true), { hasVideo: true, videoCount: 2 });
  assert.deepEqual(buildSessionVideoMeta([], false), { hasVideo: false, videoCount: 0 });
});

test("영상 저장소: 펼친 회차만 한 번 읽고, 거부되면 URL 없이 실패 상태를 보여준다", async () => {
  const { createSessionVideoStore } = await load();
  const reads = [];
  let changes = 0;
  const store = createSessionVideoStore({
    load: async (id) => {
      reads.push(id);
      if (id === "denied") throw Object.assign(new Error("denied"), { code: "permission-denied" });
      return id === "missing" ? null : { videos: [{ url: `https://example.test/${id}` }] };
    },
    parse: (data) => data.videos,
    onChange: () => { changes += 1; },
  });
  const session = { id: "s1", hasVideo: true, videoCount: 1 };
  assert.deepEqual(store.view(session), { loading: true, failed: false, videos: [], count: 1 });
  await store.ensure(session);
  await store.ensure(session);
  assert.deepEqual(reads, ["s1"], "같은 회차는 다시 읽지 않는다");
  assert.equal(store.view(session).videos.length, 1);
  assert.equal(changes, 1);
  const denied = { id: "denied", hasVideo: true, videoCount: 3 };
  await store.ensure(denied);
  assert.deepEqual(store.view(denied), { loading: false, failed: true, videos: [], count: 3 });
  const legacy = { id: "old", hasVideo: true, videos: [{ url: "u" }] };
  await store.ensure(legacy);
  assert.equal(reads.includes("old"), false, "이전 전 문서는 추가로 읽지 않는다");
  assert.deepEqual(store.view(legacy, [{ url: "u" }]).videos, [{ url: "u" }]);
});

test("관리자 저장은 회차와 분리 문서를 한 batch 로 쓰고 회차 문서의 URL을 지운다", () => {
  const source = read("assets/js/pages/admin-offline-classes.js");
  const save = source.slice(source.indexOf("async function saveSessionFromForm"), source.indexOf("async function deleteMemberAccessDocs"));
  assert.match(save, /const batch = writeBatch\(db\);/);
  assert.match(save, /videos: deleteField\(\), videoUrl: deleteField\(\)/);
  assert.match(save, /batch\.delete\(privateRef\)/);
  assert.doesNotMatch(save, /addDoc\(/);
  assert.match(source, /deleteDocsInBatches\(privateSnap\.docs\.map/, "반 삭제가 분리 문서도 지운다");
  assert.match(source, /deleteDoc\(doc\(db, OFFLINE_SESSION_PRIVATE_COLLECTION, sessionId\)\)/, "회차 삭제가 분리 문서도 지운다");
  assert.match(source, /수업 영상 정보를 불러오지 못했습니다/, "읽지 못하면 빈 값으로 덮어쓰지 않도록 수정창을 열지 않는다");
});

test("학생·강사 화면은 펼친 회차만 분리 문서를 읽는다", () => {
  for (const rel of ["assets/js/pages/student-offline-class.js", "assets/js/pages/instructor-offline-class.js"]) {
    const source = read(rel);
    assert.match(source, /createSessionVideoStore\(/, rel);
    assert.match(source, /find\(\(session\) => session\.id === expandedSessionId\);\s*if \(expanded\) sessionVideoStore\.ensure\(expanded\);/, rel);
  }
});

test("입반일 키: Rules kstDateString 과 같이 KST 날짜로 바꾸고, 값이 없으면 목록을 읽지 않는다", async () => {
  const { kstJoinDateKey } = await load();
  const ts = (iso) => ({ toMillis: () => Date.parse(iso) });
  assert.equal(kstJoinDateKey(ts("2026-05-10T01:00:00.000Z")), "2026-05-10");
  assert.equal(kstJoinDateKey(ts("2026-05-09T14:59:59.000Z")), "2026-05-09"); // KST 23:59:59
  assert.equal(kstJoinDateKey(ts("2026-05-09T15:00:00.000Z")), "2026-05-10"); // KST 자정
  assert.equal(kstJoinDateKey({ seconds: Date.parse("2026-11-02T16:30:00.000Z") / 1000, nanoseconds: 0 }), "2026-11-03");
  assert.equal(kstJoinDateKey(new Date("2026-11-03T00:00:00.000Z")), "2026-11-03");
  assert.equal(kstJoinDateKey(null), null);
  assert.equal(kstJoinDateKey("2026-05-10"), null);
});

test("학생 회차 목록은 입반일 하한으로만 조회하고, 입반 전 수동 허용 회차만 단건으로 읽는다", () => {
  const source = read("assets/js/pages/student-offline-class.js");
  assert.match(source, /where\("sessionDate", ">=", joinDateKey\)/);
  assert.match(source, /if \(joinDateKey\) \{/);
  assert.match(source, /access\.status === "active"/);
  assert.match(source, /where\("studentUid", "==", studentUid\),\s*where\("classId", "==", classId\)/, "수동 허용 기록은 이 반 것만 읽는다");
  assert.match(source, /getDoc\(doc\(db, "offlineClassSessions", sessionId\)\)/);
  assert.doesNotMatch(source, /where\("status", "==", "published"\)\s*\)\s*\);/, "하한 없는 반 전체 목록 조회가 남아 있지 않다");
});
