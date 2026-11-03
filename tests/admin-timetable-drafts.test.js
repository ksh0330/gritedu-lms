// 시간표 관리자(admin-timetable.js)의 즉시 저장·필터·그룹 삭제·수정창 회귀 테스트.
// 실제 페이지 모듈과 실제 util을 임시 폴더에 복사해 import하고, Firebase·설정 캐시·확인창·DOM은 가짜로 대체한다. 운영 DB는 사용하지 않는다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const PREFIX = "https://assets.gritedu.kr/public/schedule/";
const URL_A = `${PREFIX}a.png`;
const URL_B = `${PREFIX}b.png`;
const URL_W = `${PREFIX}w.png`;

const REAL_FILES = [
  "assets/js/pages/admin-timetable.js",
  "assets/js/utils/html.js",
  "assets/js/utils/catalog-select-helpers.js",
  "assets/js/utils/timetable-catalog.js",
  "assets/js/utils/schedule-groups-admin.js",
  "assets/js/utils/admin-refresh.js",
  "assets/js/utils/admin-order-feedback.js",
  "assets/js/utils/admin-draft-summary.js",
  "assets/js/utils/admin-catalog-drawer.js",
];

const STUBS = {
  "assets/js/firebase-init.js": `const t = () => globalThis.__tt;
export const auth = { currentUser: { uid: "admin-1" } };
export const db = {};
export const requireRole = async () => {};`,
  "assets/js/utils/settings-cache.js": `export const getAdminSettingDoc = async () => { if (globalThis.__tt.failLoad) throw new Error("offline"); return { exists: true, data: structuredClone(globalThis.__tt.stored) }; };
export const invalidateSetting = () => { globalThis.__tt.invalidated += 1; };`,
  "assets/js/utils/admin-toast.js": `export const showAdminToast = (message, isError) => { globalThis.__tt.toasts.push({ message, isError: !!isError }); };`,
  "assets/js/utils/admin-dialog.js": `export const openAdminConfirm = async (options) => { globalThis.__tt.confirms.push(options); return globalThis.__tt.answers.length ? globalThis.__tt.answers.shift() : true; };
export const createFormDirtyTracker = () => ({ capture() {}, isDirty: () => globalThis.__tt.formDirty });
export const confirmDiscardIfDirty = async (tracker) => (tracker?.isDirty() ? globalThis.__tt.discardAnswer : true);`,
  "firestore-stub.js": `export const deleteField = () => ({ __delete: true });
export const doc = (...args) => ({ path: args.slice(1).join("/") });
export const getDoc = async () => { if (globalThis.__tt.readGate) await globalThis.__tt.readGate; return { exists: () => true, data: () => structuredClone(globalThis.__tt.stored) }; };
export const getDocFromServer = async () => { if (globalThis.__tt.failConfirm) throw new Error("offline"); return { exists: () => true, data: () => structuredClone(globalThis.__tt.stored) }; };
export const serverTimestamp = () => "ts";
export const setDoc = async (ref, payload) => globalThis.__tt.write("setDoc", payload);
export const updateDoc = async (ref, payload) => globalThis.__tt.write("updateDoc", payload);`,
};

let counter = 0;
let builtDir = null;

function buildModuleTree() {
  if (builtDir) return builtDir;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grit-timetable-"));
  const urlFor = (rel) => pathToFileURL(path.join(tmp, rel)).href;
  const rewrite = (source) => source
    .replace(/"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"/g, JSON.stringify(urlFor("firestore-stub.js")))
    .replace(/"\/(assets\/js\/[^"]+)"/g, (_, rel) => JSON.stringify(urlFor(rel)));
  const write = (rel, content) => {
    const target = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rewrite(content));
  };
  REAL_FILES.forEach((rel) => write(rel, fs.readFileSync(path.join(root, rel), "utf8")));
  Object.entries(STUBS).forEach(([rel, content]) => write(rel, content));
  builtDir = tmp;
  return tmp;
}

test.after(() => {
  if (builtDir) fs.rmSync(builtDir, { recursive: true, force: true });
});

function makeElement(selector) {
  const handlers = {};
  const classes = new Set();
  const element = {
    selector,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    dataset: {},
    focused: 0,
    handlers,
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    addEventListener: (type, handler) => { (handlers[type] ||= []).push(handler); },
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() { element.focused += 1; },
    remove() {},
    before() {},
  };
  return element;
}

async function loadGroupHelpers() {
  const tmp = buildModuleTree();
  const helpers = await import(pathToFileURL(path.join(tmp, "assets/js/utils/schedule-groups-admin.js")).href);
  const catalog = await import(pathToFileURL(path.join(tmp, "assets/js/utils/timetable-catalog.js")).href);
  return { addScheduleGroupToDraft: helpers.addScheduleGroupToDraft, renderTabs: helpers.renderAdminScheduleGroupTabs, populateSelect: helpers.populateScheduleGroupSelect, MAX: catalog.MAX_SCHEDULE_GROUPS };
}

async function setup({ answers = [], failWrites = false, failLoad = false, mutate = null } = {}) {
  const baseImages = [
    { name: "A", url: URL_A, division: "high" },
    { name: "B", url: URL_B, division: "high" },
  ];
  const state = {
    stored: {
      scheduleGroups: [
        { id: "regular", label: "정규", type: "regular", active: true, sortOrder: 0 },
        { id: "winter", label: "윈터", type: "seasonal", active: true, sortOrder: 1 },
      ],
      scheduleDivisions: [
        { key: "high", label: "고등부", active: true, sortOrder: 0 },
        { key: "middle", label: "중등부", active: true, sortOrder: 1 },
      ],
      groupCatalogs: {
        regular: { scheduleImages: baseImages },
        winter: { scheduleImages: [{ name: "W", url: URL_W, division: "high" }] },
      },
    },
    failLoad,
    writes: [],
    toasts: [],
    confirms: [],
    answers: [...answers],
    invalidated: 0,
    formDirty: false,
    discardAnswer: true,
    write(kind, payload) {
      if (failWrites) throw new Error("offline");
      state.writes.push({ kind, payload: JSON.parse(JSON.stringify(payload)) });
      Object.entries(payload).forEach(([key, value]) => {
        const match = /^groupCatalogs\.([^.]+)\.scheduleImages$/.exec(key);
        if (match) state.stored.groupCatalogs[match[1]].scheduleImages = value;
      });
      // Firestore merge처럼 배열은 교체하고 중첩 map은 보존한다.
      const merge = (target, changes) => Object.entries(changes).forEach(([key, value]) => {
        if (value?.__delete) delete target[key];
        else if (value && typeof value === "object" && !Array.isArray(value)) {
          target[key] ||= {};
          merge(target[key], value);
        } else target[key] = structuredClone(value);
      });
      if (payload.groupCatalogs) merge(state.stored.groupCatalogs, payload.groupCatalogs);
      if (payload.scheduleGroups) state.stored.scheduleGroups = payload.scheduleGroups;
    },
  };
  if (mutate) mutate(state.stored);
  const elements = new Map();
  const get = (selector) => {
    if (selector === ".admin-confirm-modal") return null;
    if (!elements.has(selector)) elements.set(selector, makeElement(selector));
    return elements.get(selector);
  };
  const windowHandlers = {};
  const documentHandlers = {};
  globalThis.__tt = state;
  globalThis.HTMLElement = class {};
  globalThis.CSS = { escape: (value) => value };
  globalThis.window = { addEventListener: (type, handler) => { (windowHandlers[type] ||= []).push(handler); } };
  globalThis.document = {
    readyState: "complete",
    activeElement: null,
    body: { classList: { add() {}, remove() {} }, appendChild() {} },
    querySelector: get,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => makeElement("created"),
    addEventListener: (type, handler) => { (documentHandlers[type] ||= []).push(handler); },
  };
  const tmp = buildModuleTree();
  const href = `${pathToFileURL(path.join(tmp, "assets/js/pages/admin-timetable.js")).href}?run=${counter += 1}`;
  await import(href);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const el = (selector) => get(selector);
  const fire = async (selector, type, event = {}) => {
    for (const handler of el(selector).handlers[type] || []) await handler({ preventDefault() {}, currentTarget: el(selector), ...event });
  };
  const target = (matches) => ({ closest: (sel) => matches[sel] ?? null });
  return { state, el, fire, target, windowHandlers, documentHandlers, baseImages };
}

const imageClick = (ctx, url, extra) => ctx.fire("#scheduleImageList", "click", {
  target: ctx.target({ ".admin-schedule-image-item": { dataset: { imageUrl: url } }, ...extra }),
});

const moveDown = (ctx, url) => imageClick(ctx, url, { "[data-image-move]": { dataset: { imageMove: "down" } } });
const moveUp = (ctx, url) => imageClick(ctx, url, { "[data-image-move]": { dataset: { imageMove: "up" } } });
const winterTab = (ctx) => ctx.fire("#adminScheduleGroupTabs", "click", { target: ctx.target({ "[data-schedule-group-id]": { dataset: { scheduleGroupId: "winter" } } }) });
const storedNames = (ctx, group = "regular") => ctx.state.stored.groupCatalogs[group].scheduleImages.map((image) => image.name);
const writtenPaths = (ctx) => ctx.state.writes.flatMap((write) => Object.keys(write.payload).filter((key) => key.startsWith("groupCatalogs.")));
const filterClick = (ctx, key) => ctx.fire("#scheduleImageDivisionFilter", "click", { target: ctx.target({ "[data-image-filter]": { dataset: { imageFilter: key } } }) });
const editSubmit = async (ctx, url, name) => {
  await imageClick(ctx, url, { "[data-image-edit]": {} });
  ctx.el("#scheduleImageEditName").value = name;
  ctx.el("#scheduleImageEditUrl").value = url;
  await ctx.fire("#scheduleImageEditForm", "submit");
};
const addImage = async (ctx, name, url, division = "high") => {
  ctx.el("#scheduleImageNameInput").value = name;
  ctx.el("#scheduleImageUrlInput").value = url;
  ctx.el("#scheduleImageDivisionInput").value = division;
  await ctx.fire("#scheduleImageAddBtn", "click");
};
const deleteGroup = (ctx, id) => ctx.fire("#scheduleGroupsEditor", "click", {
  target: ctx.target({ "[data-group-action='delete']": { dataset: { groupId: id } } }),
});

test("추가는 저장 버튼 없이 바로 저장되고, 실패하면 입력값을 남긴다", async () => {
  const ctx = await setup({ failWrites: true });
  await addImage(ctx, "C", `${PREFIX}c.png`);
  assert.equal(ctx.el("#scheduleImageNameInput").value, "C", "실패하면 다시 시도할 수 있게 입력을 남긴다");
  assert.equal(ctx.el("#scheduleImageModalAlert").hidden, false);
  assert.deepEqual(storedNames(ctx), ["A", "B"]);
});

test("추가 성공: 저장본에 반영되고 입력을 비운다", async () => {
  const ctx = await setup();
  await addImage(ctx, "C", `${PREFIX}c.png`, "middle");
  assert.deepEqual(storedNames(ctx), ["A", "B", "C"]);
  assert.equal(ctx.el("#scheduleImageNameInput").value, "");
  assert.equal(ctx.state.confirms.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(ctx.el("#scheduleImagesOrderStatus").textContent, /추가하고 저장했습니다/);
});

test("제거는 확인 후 바로 저장하고, 취소하면 쓰지 않는다", async () => {
  const ctx = await setup({ answers: [false, true] });
  await imageClick(ctx, URL_B, { "[data-image-remove]": {} });
  assert.equal(ctx.state.writes.length, 0);
  assert.match(ctx.state.confirms[0].message, /공개 시간표에 바로 반영/);
  await imageClick(ctx, URL_B, { "[data-image-remove]": {} });
  assert.deepEqual(storedNames(ctx), ["A"]);
});

test("순서 이동은 바로 저장하고 저장 뒤에만 '저장했습니다'라고 알린다", async () => {
  const ctx = await setup();
  await moveDown(ctx, URL_A);
  assert.deepEqual(storedNames(ctx), ["B", "A"]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(ctx.el("#scheduleImagesOrderStatus").textContent, /2개 중 2번째로 옮기고 저장했습니다/);
});

test("순서 이동 실패: 목록과 저장본이 그대로이고 저장했다고 알리지 않는다", async () => {
  const ctx = await setup({ failWrites: true });
  await moveDown(ctx, URL_A);
  assert.deepEqual(storedNames(ctx), ["A", "B"]);
  assert.ok(ctx.el("#scheduleImageList").innerHTML.indexOf("a.png") < ctx.el("#scheduleImageList").innerHTML.indexOf("b.png"));
  assert.doesNotMatch(ctx.el("#scheduleImagesOrderStatus").textContent, /저장했습니다/);
  assert.equal(ctx.el("#scheduleImageModalAlert").hidden, false);
});

test("학교급 필터: 공개 화면처럼 해당 학교급만 저장 순서대로 보이고, 필터 안 이동은 그 안의 순서만 바꾼다", async () => {
  const ctx = await setup();
  await addImage(ctx, "M1", `${PREFIX}m1.png`, "middle");
  await addImage(ctx, "C", `${PREFIX}c.png`, "high");
  await addImage(ctx, "M2", `${PREFIX}m2.png`, "middle");
  assert.deepEqual(storedNames(ctx), ["A", "B", "M1", "C", "M2"]);
  await filterClick(ctx, "middle");
  const list = ctx.el("#scheduleImageList").innerHTML;
  assert.doesNotMatch(list, /a\.png/);
  assert.ok(list.indexOf("m1.png") < list.indexOf("m2.png"));
  assert.match(ctx.el("#scheduleImageDivisionFilter").innerHTML, /data-image-filter="middle"[^>]*aria-pressed="true"/);
  assert.equal(ctx.el("#scheduleImageDivisionInput").value, "middle", "필터를 고르면 추가 구분도 맞춘다");
  await moveDown(ctx, `${PREFIX}m1.png`);
  assert.deepEqual(storedNames(ctx), ["A", "B", "M2", "C", "M1"], "다른 학교급의 자리는 그대로이고 보이는 두 항목만 바뀐다");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(ctx.el("#scheduleImagesOrderStatus").textContent, /2개 중 2번째/);
});

test("숨긴 학교급 이미지는 공개되지 않음을 표시하고, 이미지가 없으면 필터에도 나오지 않는다", async () => {
  const ctx = await setup({ mutate: (stored) => {
    stored.scheduleDivisions[1].active = false;
    stored.scheduleDivisions.push({ key: "elem", label: "초등부", active: false, sortOrder: 2 });
    stored.groupCatalogs.regular.scheduleImages[1].division = "middle";
  } });
  const filter = ctx.el("#scheduleImageDivisionFilter").innerHTML;
  assert.match(filter, /중등부 \(숨김\)/);
  assert.doesNotMatch(filter, /초등부/);
  assert.match(ctx.el("#scheduleImageList").innerHTML, /공개 안 됨/);
});

test("수정창 저장: 확인 없이 바로 저장하고 닫는다", async () => {
  const ctx = await setup();
  await editSubmit(ctx, URL_A, "A-수정");
  assert.equal(ctx.state.confirms.length, 0);
  assert.equal(ctx.state.stored.groupCatalogs.regular.scheduleImages[0].name, "A-수정");
  assert.equal(ctx.el("#scheduleImageEditModal").hidden, true);
});

test("수정창 저장 실패: 닫지 않고 목록을 바꾸지 않으며 재시도할 수 있다", async () => {
  const ctx = await setup({ failWrites: true });
  await editSubmit(ctx, URL_A, "A-수정");
  assert.equal(ctx.el("#scheduleImageEditModal").hidden, false);
  assert.ok(ctx.state.toasts.some((t) => t.isError));
  assert.deepEqual(storedNames(ctx), ["A", "B"]);
});

test("구분 변경: 바로 저장하고 실패하면 선택값을 되돌린다", async () => {
  const ok = await setup();
  await ok.fire("#scheduleImageList", "change", {
    target: ok.target({ "[data-image-division]": { value: "middle", closest: () => ({ dataset: { imageUrl: URL_B } }) } }),
  });
  assert.equal(ok.state.stored.groupCatalogs.regular.scheduleImages[1].division, "middle");
  const fail = await setup({ failWrites: true });
  fail.el("#scheduleImageList").innerHTML = "stale";
  await fail.fire("#scheduleImageList", "change", {
    target: fail.target({ "[data-image-division]": { value: "middle", closest: () => ({ dataset: { imageUrl: URL_B } }) } }),
  });
  assert.notEqual(fail.el("#scheduleImageList").innerHTML, "stale", "선택값을 목록 기준으로 복원한다");
});

test("그룹 탭 전환은 확인 없이 바뀌고 저장하지 않는다", async () => {
  const ctx = await setup();
  await winterTab(ctx);
  assert.equal(ctx.state.confirms.length, 0);
  assert.equal(ctx.el("#scheduleImageGroupLabel").textContent, "윈터");
  assert.equal(ctx.state.writes.length, 0);
});

test("그룹 순서 이동은 저장 전 요약과 위치 안내를 만들고 DB를 쓰지 않는다", async () => {
  const ctx = await setup();
  await ctx.fire("#scheduleGroupsEditor", "click", {
    target: ctx.target({ "[data-group-action^='move-']": { dataset: { groupId: "regular", groupAction: "move-down" } } }),
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(ctx.el("#scheduleGroupsOrderStatus").textContent, /2번째/);
  assert.match(ctx.el("#scheduleGroupsDraftSummary").innerHTML, /변경 1건/);
  assert.doesNotMatch(ctx.el("#scheduleGroupsDraftSummary").innerHTML, /저장 전 변경|\(순서/);
  assert.equal(ctx.el("#scheduleGroupsTriggerBadge").hidden, false);
  assert.equal(ctx.state.writes.length, 0);
});

test("그룹 삭제: 확인창 하나에 그룹·학교급·이미지 영향 전체를 안내하고 취소하면 유지한다", async () => {
  const ctx = await setup({ answers: [false], mutate: (stored) => {
    stored.groupCatalogs.winter.scheduleImages.push({ name: "W2", url: `${PREFIX}w2.png`, division: "middle" });
  } });
  await deleteGroup(ctx, "winter");
  assert.equal(ctx.state.confirms.length, 1);
  const detail = ctx.state.confirms[0];
  assert.match(detail.message, /학교급 2개, 이미지 2개/);
  assert.match(detail.message, /고등부 1개: W/);
  assert.match(detail.message, /중등부 1개: W2/);
  assert.equal(detail.cancelLabel, "취소");
  assert.equal(detail.confirmLabel, "삭제");
  assert.equal(ctx.el("#scheduleGroupsDraftSummary").hidden, true, "취소하면 삭제되지 않는다");
});

test("연결이 없는 그룹 삭제는 확인 한 번이고, 저장 전까지 DB를 쓰지 않는다", async () => {
  const ctx = await setup({ mutate: (stored) => { stored.groupCatalogs.winter.scheduleImages = []; } });
  await deleteGroup(ctx, "winter");
  assert.equal(ctx.state.confirms.length, 1);
  assert.equal(ctx.state.writes.length, 0);
  assert.match(ctx.el("#scheduleGroupsDraftSummary").innerHTML, /제거|변경 1건/);
});

test("그룹 삭제 저장: 삭제한 그룹의 이미지만 실제로 지우고, 목록에 없던 값은 건드리지 않으며, 다음 이미지 저장이 정규를 덮어쓰지 않는다", async () => {
  const ctx = await setup({ mutate: (stored) => { stored.groupCatalogs.legacy = { scheduleImages: [] }; } });
  await winterTab(ctx);
  await deleteGroup(ctx, "winter");
  await ctx.fire("#scheduleGroupsSaveBtn", "click");
  const payload = ctx.state.writes[0].payload;
  assert.deepEqual(payload.groupCatalogs.winter, { __delete: true });
  assert.equal(payload.groupCatalogs.legacy, undefined);
  assert.equal(ctx.state.stored.groupCatalogs.winter, undefined);
  assert.equal(ctx.el("#scheduleImageGroupLabel").textContent, "정규");
  await moveDown(ctx, URL_A);
  assert.deepEqual(storedNames(ctx), ["B", "A"]);
  assert.deepEqual(writtenPaths(ctx), ["groupCatalogs.regular.scheduleImages"]);
});

test("그룹은 5개까지 등록하고 6번째는 거절한다", async () => {
  const { addScheduleGroupToDraft, MAX } = await loadGroupHelpers();
  assert.equal(MAX, 5);
  const full = ["정규", "윈터", "썸머", "봄", "가을"].map((label, sortOrder) => ({ id: sortOrder === 0 ? "regular" : `g${sortOrder}`, label, active: true, sortOrder }));
  assert.equal(addScheduleGroupToDraft(full.slice(0, 4), "가을").ok, true);
  const rejected = addScheduleGroupToDraft(full, "겨울특강");
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /최대 5개/);
});

test("아직 저장하지 않은 새 그룹에는 이미지를 쓰지 않는다", async () => {
  const ctx = await setup();
  await ctx.fire("#adminScheduleGroupTabs", "click", { target: ctx.target({ "[data-schedule-group-id]": { dataset: { scheduleGroupId: "newgroup" } } }) });
  await addImage(ctx, "N", `${PREFIX}n.png`);
  assert.equal(ctx.state.writes.length, 0);
  assert.match(ctx.el("#scheduleImageModalAlert").textContent, /기준값 저장/);
});

test("저장 중 그룹 전환: 다른 그룹 경로에 쓰지 않고 전환도 받지 않는다", async () => {
  const ctx = await setup();
  let release;
  ctx.state.readGate = new Promise((resolve) => { release = resolve; });
  const saving = moveDown(ctx, URL_A);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await winterTab(ctx);
  assert.equal(ctx.el("#scheduleImageGroupLabel").textContent, "정규");
  ctx.state.readGate = null;
  release();
  await saving;
  assert.deepEqual(writtenPaths(ctx), ["groupCatalogs.regular.scheduleImages"]);
  assert.deepEqual(storedNames(ctx, "winter"), ["W"]);
});

test("저장 중 겹치는 변경은 받지 않는다(연타한 이동은 오류 없이 무시)", async () => {
  const ctx = await setup();
  let release;
  ctx.state.readGate = new Promise((resolve) => { release = resolve; });
  const saving = moveDown(ctx, URL_A);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await moveUp(ctx, URL_B);
  assert.equal(ctx.state.toasts.filter((t) => t.isError).length, 0, "연타는 오류로 알리지 않는다");
  await imageClick(ctx, URL_B, { "[data-image-edit]": {} });
  assert.ok(ctx.state.toasts.some((t) => t.isError && /저장하는 중/.test(t.message)));
  ctx.state.readGate = null;
  release();
  await saving;
  assert.equal(ctx.state.writes.length, 1);
  assert.deepEqual(storedNames(ctx), ["B", "A"]);
});

test("쓰기 성공 뒤 확인 읽기만 실패해도 저장 실패로 알리지 않고 목록을 맞춘다", async () => {
  const ctx = await setup();
  ctx.state.failConfirm = true;
  await moveDown(ctx, URL_A);
  assert.equal(ctx.state.writes.length, 1);
  assert.equal(ctx.el("#scheduleImageModalAlert").hidden, true);
  const list = ctx.el("#scheduleImageList").innerHTML;
  assert.ok(list.indexOf("b.png") < list.indexOf("a.png"));
});

test("새로고침: 최신 이미지로 바꾸고, 실패하면 안내하며 다시 시도할 수 있다", async () => {
  const ctx = await setup();
  ctx.state.stored.groupCatalogs.regular.scheduleImages = [{ name: "Z", url: `${PREFIX}z.png`, division: "high" }];
  await ctx.fire("#refreshBtn", "click");
  assert.match(ctx.el("#scheduleImageList").innerHTML, /z\.png/);
  ctx.state.failLoad = true;
  await ctx.fire("#refreshBtn", "click");
  assert.ok(ctx.state.toasts.some((t) => t.isError && /불러오지 못했습니다/.test(t.message)));
  assert.equal(ctx.el("#refreshBtn").disabled, false);
});

test("최초 조회 실패: 빈 값으로 저장하지 않고 새로고침 성공 뒤 복구한다", async () => {
  const ctx = await setup({ failLoad: true });
  assert.equal(ctx.el("#scheduleImageModalAlert").hidden, false);
  await addImage(ctx, "C", `${PREFIX}c.png`);
  await ctx.fire("#scheduleGroupsSaveBtn", "click");
  assert.equal(ctx.state.writes.length, 0);
  ctx.state.failLoad = false;
  await ctx.fire("#refreshBtn", "click");
  assert.match(ctx.el("#scheduleImageList").innerHTML, /a\.png/);
});

test("수정창 Escape: 입력을 바꿨다면 버리기 확인 후에만 닫고 포커스를 돌려준다", async () => {
  const ctx = await setup();
  await imageClick(ctx, URL_A, { "[data-image-edit]": {} });
  const keydown = (event) => Promise.all(ctx.documentHandlers.keydown.map((handler) => handler(event)));
  ctx.state.formDirty = true;
  ctx.state.discardAnswer = false;
  await keydown({ key: "Escape", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ctx.el("#scheduleImageEditModal").hidden, false);
  ctx.state.discardAnswer = true;
  await keydown({ key: "Escape", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ctx.el("#scheduleImageEditModal").hidden, true);
  assert.ok(ctx.el("#scheduleImageAddBtn").focused >= 1);
  assert.equal(ctx.state.writes.length, 0);
});

test("수정창 Tab은 창 안에서 순환한다", async () => {
  const ctx = await setup();
  await imageClick(ctx, URL_A, { "[data-image-edit]": {} });
  const first = makeElement("first");
  const last = makeElement("last");
  const modal = ctx.el("#scheduleImageEditModal");
  modal.querySelectorAll = () => [first, last];
  globalThis.document.activeElement = last;
  modal.contains = (node) => node === first || node === last;
  let prevented = 0;
  await Promise.all(ctx.documentHandlers.keydown.map((handler) => handler({ key: "Tab", shiftKey: false, preventDefault() { prevented += 1; } })));
  assert.equal(prevented, 1);
  assert.equal(first.focused, 1);
  globalThis.document.activeElement = first;
  await Promise.all(ctx.documentHandlers.keydown.map((handler) => handler({ key: "Tab", shiftKey: true, preventDefault() { prevented += 1; } })));
  assert.equal(last.focused, 1);
});

test("페이지를 떠날 때 저장 전 기준값 변경이 있을 때만 브라우저 확인을 요청한다", async () => {
  const ctx = await setup();
  const unload = ctx.windowHandlers.beforeunload[0];
  let event = { prevented: false, preventDefault() { this.prevented = true; } };
  unload(event);
  assert.equal(event.prevented, false);
  ctx.el("#scheduleImageList").innerHTML = "";
  await ctx.fire("#scheduleGroupsEditor", "click", {
    target: ctx.target({ "[data-group-action^='move-']": { dataset: { groupId: "regular", groupAction: "move-down" } } }),
  });
  event = { prevented: false, preventDefault() { this.prevented = true; } };
  unload(event);
  assert.equal(event.prevented, true);
});

test("이미지 저장·변경 취소 버튼은 없고, 추가는 주황·제거는 빨강이다", () => {
  const html = fs.readFileSync(path.join(root, "members/admin/timetable.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "assets/js/pages/admin-timetable.js"), "utf8");
  assert.doesNotMatch(html + js, /scheduleImageSaveBtn|scheduleImageResetBtn|scheduleImagesDraftBadge/);
  assert.match(html, /class="btn primary sm" id="scheduleImageAddBtn"/);
  assert.match(js, /class="btn sm danger" data-image-remove/);
  const css = fs.readFileSync(path.join(root, "assets/css/pages/admin.css"), "utf8");
  assert.match(css, /\.admin-schedule-image-modal__actions \{\s*display: flex;\s*gap: 12px;\s*justify-content: flex-end;/);
});


test("기준값 저장은 다른 관리자가 바꾼 이미지 목록을 다시 쓰지 않는다", async () => {
  const ctx = await setup();
  ctx.state.stored.groupCatalogs.regular.scheduleImages = [{ name: "다른 관리자 변경", url: URL_A, division: "high" }];
  await ctx.fire("#scheduleGroupsSaveBtn", "click");
  assert.deepEqual(storedNames(ctx), ["다른 관리자 변경"]);
  assert.equal(ctx.state.writes[0].payload.groupCatalogs, undefined, "삭제 대상이 없으면 이미지 map을 보내지 않는다");
});

test("새 학교급은 기준값 저장 전 이미지 즉시 저장에 쓸 수 없다", async () => {
  const ctx = await setup();
  ctx.el("[data-division-add-input]").value = "초등부";
  await ctx.fire("#scheduleDivisionsEditor", "click", {
    target: ctx.target({ "[data-division-action]": { dataset: { divisionAction: "add" } } }),
  });
  const key = ctx.el("#scheduleDivisionsEditor").innerHTML.match(/data-division-key="(division-[^"]+)"/)[1];
  await addImage(ctx, "새 학교급 이미지", `${PREFIX}new-division.png`, key);
  assert.equal(ctx.state.writes.length, 0);
  assert.match(ctx.el("#scheduleImageModalAlert").textContent, /기준값 저장/);
  assert.equal(ctx.el("#scheduleImageNameInput").value, "새 학교급 이미지");
  assert.deepEqual(storedNames(ctx), ["A", "B"]);
});


test("관리 반 목록만 숨김·미등록 그룹을 유지하고 선택 목록은 노출 그룹만 표시한다", async () => {
  const { renderTabs } = await loadGroupHelpers();
  const groups = [
    { id: "regular", label: "정규", active: true },
    { id: "winter", label: "윈터", active: false },
  ];
  const main = makeElement("main");
  renderTabs(main, groups, "removed", { retainedGroupIds: ["winter", "removed", "removed"] });
  assert.match(main.innerHTML, /윈터 \(숨김\)/);
  assert.match(main.innerHTML, /미등록 그룹 \(removed\)/);
  assert.equal((main.innerHTML.match(/data-schedule-group-id="removed"/g) || []).length, 1);
  assert.match(main.innerHTML, /data-schedule-group-id="removed"[^>]*aria-selected="true"/);
  const panel = makeElement("panel");
  renderTabs(panel, groups, "regular");
  assert.doesNotMatch(panel.innerHTML, /winter|removed/);
});


test("미등록 그룹의 기존 반 편집은 원래 그룹을 선택하고 신규 생성 목록에는 추가하지 않는다", async () => {
  const { populateSelect } = await loadGroupHelpers();
  const groups = [{ id: "regular", label: "정규", active: true }];
  const edit = makeElement("select");
  populateSelect(edit, groups, "removed", { preserveMissing: true });
  assert.match(edit.innerHTML, /value="removed" selected/);
  const create = makeElement("select");
  populateSelect(create, groups, "removed");
  assert.doesNotMatch(create.innerHTML, /removed/);
});


test("노출 그룹이 없어도 유일한 보존 그룹이 현재 선택과 다르면 탭을 표시한다", async () => {
  const { renderTabs } = await loadGroupHelpers();
  const main = makeElement("tabs");
  renderTabs(main, [{ id: "regular", label: "정규", active: false }], "regular", { retainedGroupIds: ["removed"] });
  assert.equal(main.hidden, false);
  assert.match(main.innerHTML, /data-schedule-group-id="removed"/);
});

test("기존 미등록 학교급 이미지도 URL 수정은 보존한다", async () => {
  const ctx = await setup({ mutate: (stored) => { stored.groupCatalogs.regular.scheduleImages[0].division = "legacy"; } });
  await imageClick(ctx, URL_A, { "[data-image-edit]": {} });
  ctx.el("#scheduleImageEditUrl").value = `${PREFIX}changed.png`;
  await ctx.fire("#scheduleImageEditForm", "submit");
  assert.equal(ctx.state.writes.length, 1);
  assert.equal(ctx.state.stored.groupCatalogs.regular.scheduleImages[0].division, "legacy");
});
