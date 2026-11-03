// 순서 변경 피드백·선택 목록 drawer 공통 도우미 회귀 테스트. DB·브라우저 없이 가짜 DOM만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const load = (rel) => import(require("node:url").pathToFileURL(path.join(root, rel)).href);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeRow() {
  const classes = new Set();
  return {
    classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n) },
    scrolled: 0,
    scrollIntoView() { this.scrolled += 1; },
    controls: {},
    querySelector(selector) { return this.controls[selector] || null; },
  };
}

test("describeOrderMove: 저장 전 초안과 저장 완료 문구를 구분한다", async () => {
  const { describeOrderMove } = await load("assets/js/utils/admin-order-feedback.js");
  const draft = describeOrderMove({ label: "국어", index: 2, total: 5, saveHint: "‘목록 저장’을 눌러야 반영됩니다." });
  assert.match(draft, /5개 중 3번째/);
  assert.match(draft, /아직 저장 전 변경입니다/);
  assert.match(draft, /목록 저장/);
  assert.doesNotMatch(draft, /저장했습니다/);
  const saved = describeOrderMove({ label: "국어", index: 0, total: 5, persisted: true });
  assert.match(saved, /1번째로 옮기고 저장했습니다/);
  assert.doesNotMatch(saved, /저장 전/);
});

test("flashMovedRow: 클래스를 잠깐 붙였다 제거하고 화면 안으로 스크롤한다", async () => {
  const { flashMovedRow, ORDER_MOVED_CLASS } = await load("assets/js/utils/admin-order-feedback.js");
  const row = fakeRow();
  flashMovedRow(row, { duration: 15 });
  assert.equal(row.classList.contains(ORDER_MOVED_CLASS), true);
  assert.equal(row.scrolled, 1);
  await wait(40);
  assert.equal(row.classList.contains(ORDER_MOVED_CLASS), false);
  assert.doesNotThrow(() => flashMovedRow(null));
});

test("restoreMoveFocus: 맨 끝에서 비활성화된 버튼 대신 반대 방향 버튼으로 포커스를 옮긴다", async () => {
  const { restoreMoveFocus } = await load("assets/js/utils/admin-order-feedback.js");
  const row = fakeRow();
  const focused = [];
  row.controls['[data-m="down"]'] = { disabled: true, focus: () => focused.push("down") };
  row.controls['[data-m="up"]'] = { disabled: false, focus: () => focused.push("up") };
  assert.equal(restoreMoveFocus(row, ['[data-m="down"]', '[data-m="up"]']), true);
  assert.deepEqual(focused, ["up"]);
  assert.equal(restoreMoveFocus(row, ['[data-x]']), false);
});

test("announceOrderChange: 보이는 상태 줄에 쓰고, 없으면 화면 밖 aria-live 영역을 한 번만 만든다", async () => {
  const { announceOrderChange, clearOrderStatus } = await load("assets/js/utils/admin-order-feedback.js");
  const status = { textContent: "이전" };
  announceOrderChange("새 안내", { statusEl: status });
  assert.equal(status.textContent, "", "같은 문구도 다시 읽히도록 먼저 비운다");
  await wait(60);
  assert.equal(status.textContent, "새 안내");
  clearOrderStatus(status);
  assert.equal(status.textContent, "");

  const created = [];
  const attrs = {};
  const region = { id: "", className: "", textContent: "", setAttribute: (k, v) => { attrs[k] = v; } };
  const doc = {
    body: { appendChild: (el) => created.push(el) },
    getElementById: (id) => (created.find((el) => el.id === id) || null),
    createElement: () => region,
  };
  announceOrderChange("전역 안내", { doc });
  announceOrderChange("전역 안내 2", { doc });
  await wait(60);
  assert.equal(created.length, 1);
  assert.equal(region.className, "sr-only");
  assert.equal(attrs["aria-live"], "polite");
  assert.equal(region.textContent, "전역 안내 2");
});

test("setDraftBadge / isListDirty: 순서만 달라도 변경으로 보고, 같은 목록은 변경 없음이다", async () => {
  const { setDraftBadge, isListDirty } = await load("assets/js/utils/admin-order-feedback.js");
  const badge = { dataset: {}, textContent: "", hidden: true };
  setDraftBadge(badge, true);
  assert.deepEqual([badge.hidden, badge.dataset.draftState, badge.textContent], [false, "dirty", "저장 전 변경 있음"]);
  setDraftBadge(badge, false);
  assert.deepEqual([badge.hidden, badge.dataset.draftState, badge.textContent], [true, "clean", ""]);
  assert.equal(isListDirty(["a", "b"], ["b", "a"]), true);
  assert.equal(isListDirty(["a", "b"], ["a", "b"]), false);
  assert.equal(isListDirty([{ id: 1, label: "x" }], [{ id: 1, label: "y" }], (i) => [i.id, i.label]), true);
  assert.equal(isListDirty(null, []), false);
});

test("findCatalogTagRow / reportCatalogTagMove: 값에 해당하는 태그 행을 강조하고 안내한다", async () => {
  const { findCatalogTagRow, reportCatalogTagMove } = await load("assets/js/utils/admin-order-feedback.js");
  const row = fakeRow();
  row.controls['[data-catalog-move="up"]'] = { disabled: false, focus() { this.focused = true; } };
  const button = { dataset: { catalogField: "grades", catalogValue: "고2" }, closest: () => row };
  const host = { querySelectorAll: () => [button] };
  assert.equal(findCatalogTagRow(host, "grades", "고2"), row);
  assert.equal(findCatalogTagRow(host, "years", "고2"), null);
  const status = { textContent: "" };
  reportCatalogTagMove({ host, field: "grades", value: "고2", list: ["고1", "고2", "고3"], direction: "up", statusEl: status });
  await wait(60);
  assert.match(status.textContent, /3개 중 2번째/);
  assert.match(status.textContent, /저장 전/);
  assert.equal(row.classList.contains("is-order-moved"), true);
  assert.equal(row.controls['[data-catalog-move="up"]'].focused, true);
});

function drawerFixture() {
  const bodyClasses = new Set();
  const listeners = {};
  const focusLog = [];
  const trigger = {
    hidden: true, attrs: {}, isConnected: true,
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener: (t, h) => { (listeners.trigger ||= {})[t] = h; },
    focus: () => focusLog.push("trigger"),
  };
  const first = { disabled: false, hidden: false, closest: () => null, focus: () => focusLog.push("first") };
  const last = { disabled: false, hidden: false, closest: () => null, focus: () => focusLog.push("last") };
  const title = { hasAttribute: () => false, setAttribute() {}, focus: () => focusLog.push("title") };
  const panelAttrs = {};
  const panelClasses = new Set();
  const panel = {
    hidden: true,
    classList: { add: (n) => panelClasses.add(n), contains: (n) => panelClasses.has(n) },
    setAttribute: (k, v) => { panelAttrs[k] = v; },
    before() {},
    addEventListener: (t, h) => { (listeners.panel ||= {})[t] = h; },
    querySelectorAll: () => [first, last],
    contains: (n) => n === first || n === last,
  };
  const backdrop = { hidden: false, attrs: {}, className: "", setAttribute() {}, addEventListener: (t, h) => { (listeners.backdrop ||= {})[t] = h; } };
  let confirmOpen = false;
  const doc = {
    activeElement: trigger,
    body: { classList: { toggle: (n, on) => (on ? bodyClasses.add(n) : bodyClasses.delete(n)) } },
    createElement: () => backdrop,
    getElementById: () => title,
    querySelector: () => (confirmOpen ? {} : null),
    addEventListener: (t, h) => { listeners.doc = { ...(listeners.doc || {}), [t]: h }; },
  };
  globalThis.HTMLElement = class {};
  Object.setPrototypeOf(trigger, globalThis.HTMLElement.prototype);
  return { doc, panel, trigger, backdrop, panelAttrs, panelClasses, bodyClasses, listeners, focusLog, first, last, setConfirm: (v) => { confirmOpen = v; } };
}

test("initCatalogDrawer: 요소가 없으면 아무것도 하지 않는다", async () => {
  const { initCatalogDrawer } = await load("assets/js/utils/admin-catalog-drawer.js");
  assert.equal(initCatalogDrawer({}), null);
});

test("initCatalogDrawer: 모달 dialog 의미, 열기/닫기 상태, Escape·Tab 순환, 포커스 복귀", async () => {
  const { initCatalogDrawer } = await load("assets/js/utils/admin-catalog-drawer.js");
  const f = drawerFixture();
  let opened = 0;
  let closed = 0;
  const drawer = initCatalogDrawer({ panel: f.panel, openButton: f.trigger, titleId: "t", doc: f.doc, onOpen: () => { opened += 1; }, onClose: () => { closed += 1; } });
  assert.ok(drawer);
  assert.equal(f.panelAttrs.role, "dialog");
  assert.equal(f.panelAttrs["aria-modal"], "true");
  assert.equal(f.panelAttrs["aria-labelledby"], "t");
  assert.equal(f.trigger.attrs["aria-expanded"], "false");

  f.listeners.trigger.click();
  assert.equal(f.panel.hidden, false);
  assert.equal(f.backdrop.hidden, false);
  assert.equal(f.trigger.attrs["aria-expanded"], "true");
  assert.equal(f.bodyClasses.has("modal-open"), true);
  assert.deepEqual([opened, f.focusLog.at(-1)], [1, "title"]);

  // Tab 순환
  let prevented = 0;
  f.doc.activeElement = f.last;
  f.listeners.doc.keydown({ key: "Tab", shiftKey: false, preventDefault: () => { prevented += 1; } });
  f.doc.activeElement = f.first;
  f.listeners.doc.keydown({ key: "Tab", shiftKey: true, preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 2);
  assert.deepEqual(f.focusLog.slice(-2), ["first", "last"]);

  // 열린 직후 제목(목록에 없는 패널 안 요소)에서 Shift+Tab 해도 패널 밖으로 나가지 않는다
  const titleEl = { focus() {}, getAttribute: (name) => (name === "tabindex" ? "-1" : null) };
  f.panel.contains = (n) => n === f.first || n === f.last || n === titleEl;
  f.doc.activeElement = titleEl;
  f.listeners.doc.keydown({ key: "Tab", shiftKey: true, preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 3);
  assert.equal(f.focusLog.at(-1), "last");

  // 확인창이 위에 있으면 Escape 를 가로채지 않는다
  f.setConfirm(true);
  f.listeners.doc.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(f.panel.hidden, false);
  f.setConfirm(false);

  f.listeners.doc.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(f.panel.hidden, true);
  assert.equal(f.backdrop.hidden, true);
  assert.equal(f.trigger.attrs["aria-expanded"], "false");
  assert.equal(f.bodyClasses.has("modal-open"), false);
  assert.deepEqual([closed, f.focusLog.at(-1)], [1, "trigger"]);

  // backdrop 클릭과 [data-catalog-drawer-close] 도 닫는다. 닫는 동작은 초안을 건드리지 않는다(이 모듈은 데이터를 모른다).
  drawer.open();
  f.listeners.backdrop.click();
  assert.equal(drawer.isOpen(), false);
  drawer.open();
  f.listeners.panel.click({ target: { closest: (s) => (s === "[data-catalog-drawer-close]" ? {} : null) } });
  assert.equal(drawer.isOpen(), false);
});

test("선택 목록 drawer 모듈은 DB·네트워크·listener 컬렉션 API를 쓰지 않는다", () => {
  for (const rel of ["assets/js/utils/admin-catalog-drawer.js", "assets/js/utils/admin-order-feedback.js"]) {
    const code = read(rel);
    assert.doesNotMatch(code, /firebase|firestore|getDocs?\b|onSnapshot|fetch\(|localStorage|sessionStorage/, rel);
  }
});

test("강좌 선택 목록: 기존 패널 ID·저장 버튼·입력 ID가 유지되고 검색 입력은 추가되지 않는다", () => {
  const html = read("members/admin/courses.html");
  for (const id of [
    "courseCatalogPanel", "courseCatalogSaveBtn", "courseCatalogSubjectLabelInput", "courseCatalogSubjectAddBtn",
    "courseCatalogSubjectEditor", "courseCatalogGradeInput", "courseCatalogGradeAddBtn", "courseCatalogGradeTags",
    "courseCatalogYearInput", "courseCatalogYearAddBtn", "courseCatalogYearTags",
  ]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<div class="admin-catalog-panel is-drawer grit-section" id="courseCatalogPanel" role="dialog" aria-modal="true" aria-labelledby="courseCatalogDrawerTitle" hidden>/);
  assert.doesNotMatch(html, /<details class="admin-catalog-panel|admin-catalog-panel__summary/, "이전 펼침 토글을 남기지 않는다");
  const panel = html.slice(html.indexOf('id="courseCatalogPanel"'), html.indexOf('id="courseCatalogSaveBtn"'));
  assert.doesNotMatch(panel, /type="search"|검색/, "새 패널에 검색을 넣지 않는다");
  assert.match(html, /id="courseCatalogOpenBtn"[^>]*aria-controls="courseCatalogPanel"[^>]*>/);
  assert.doesNotMatch(html.match(/<button[^>]*id="courseCatalogOpenBtn"[^>]*>/)[0], /\shidden/, "트리거는 첫 화면부터 보인다");
  const js = read("assets/js/pages/admin-courses.js");
  assert.match(js, /initCatalogDrawer\(\{[\s\S]*courseCatalogPanel[\s\S]*courseCatalogOpenBtn/);
  // 열기/닫기/이동 경로에는 새 Firestore 호출이 없다: setup 함수 안의 getDocs/getDoc/onSnapshot 은 0건.
  const setup = js.slice(js.indexOf("function setupCourseCatalogPanel()"), js.indexOf("const COURSE_DELETE_CONFIRM_PHRASE"));
  assert.doesNotMatch(setup, /getDocs?\(|onSnapshot\(|query\(|collection\(/);
});

test("순서 피드백 CSS: 정적 강조가 기본이고 움직임은 reduced-motion 이 아닐 때만 켠다", () => {
  const css = read("assets/css/pages/admin.css");
  const staticRule = css.slice(css.indexOf(".is-order-moved {"), css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.doesNotMatch(staticRule, /animation/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.is-order-moved \{\s*animation:/);
  assert.match(css, /\.admin-catalog-panel\.is-drawer:not\(\[hidden\]\) \{[\s\S]*position: fixed;[\s\S]*width: min\(640px, 100vw\)/);
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.admin-catalog-panel\.is-drawer:not\(\[hidden\]\) \{\s*padding: 0 16px;\s*width: 100vw;/);
});

test("초기화 전 트리거 숨김은 .btn 의 display 에 덮이지 않도록 명시한다", () => {
  assert.match(read("assets/css/pages/admin.css"), /\.admin-catalog-open-btn\[hidden\] \{\s*display: none;/);
  assert.match(read("assets/css/pages/admin.css"), /\.admin-draft-badge\[hidden\] \{\s*display: none;/);
});
