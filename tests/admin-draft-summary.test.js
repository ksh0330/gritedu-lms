// 저장본 ↔ 초안 차이 요약 회귀 테스트. DB·브라우저 없이 실제 모듈을 임시 경로로 불러와 검증한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let tmp;
let mod;

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grit-draft-summary-"));
  fs.writeFileSync(path.join(tmp, "html.mjs"), read("assets/js/utils/html.js"));
  fs.writeFileSync(
    path.join(tmp, "summary.mjs"),
    read("assets/js/utils/admin-draft-summary.js").replace('"/assets/js/utils/html.js"', '"./html.mjs"')
  );
  mod = await import(pathToFileURL(path.join(tmp, "summary.mjs")).href);
});

test.after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const subjects = [
  { value: "kor", label: "국어", active: true },
  { value: "eng", label: "영어", active: true },
  { value: "mat", label: "수학", active: true },
];
const keyed = (current, options = {}) => mod.diffOrderedList({
  saved: subjects,
  current,
  keyOf: (item) => item.value,
  labelOf: (item) => item.label,
  ...options,
});

test("키가 있는 목록: 추가·이름·순서·제거를 구분한다", () => {
  const diff = keyed([
    { value: "mat", label: "수학" },
    { value: "kor", label: "국어(개편)" },
    { value: "sci", label: "과학" },
  ]);
  assert.deepEqual(diff.added, ["과학"]);
  assert.deepEqual(diff.renamed, [{ from: "국어", to: "국어(개편)" }]);
  assert.deepEqual(diff.removed, ["영어"]);
  assert.equal(diff.moved.length, 1, "남은 두 항목의 앞뒤가 바뀌면 순서 변경은 1건이다");
});

test("한 칸 이동은 교환된 두 항목이 아니라 옮긴 항목 1건으로 센다", () => {
  const diff = keyed([subjects[1], subjects[0], subjects[2]]);
  assert.equal(diff.moved.length, 1);
  assert.equal(mod.summarizeDraftSections([{ title: "과목", diff }]).total, 1);
});

test("원래 상태로 되돌린 변경은 요약에서 빠진다", () => {
  const moved = keyed([subjects[1], subjects[0], subjects[2]]);
  assert.equal(mod.summarizeDraftSections([{ title: "과목", diff: moved }]).total, 1);
  const restored = keyed(subjects.map((item) => ({ ...item })));
  const summary = mod.summarizeDraftSections([{ title: "과목", diff: restored }]);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.sections, []);
  const renamedBack = mod.diffStringList({ saved: ["고1", "고2"], current: ["고1", "고2"] });
  assert.equal(mod.summarizeDraftSections([{ title: "학년", diff: renamedBack }]).total, 0);
});

test("색상: 양쪽 값이 있을 때만 비교하고 새 항목은 추가로만 센다", () => {
  const colors = { 국어: "#111111", 영어: "#222222", 수학: "#333333" };
  const nextColors = { ...colors, 국어: "#999999" };
  const diff = keyed(subjects.map((item) => ({ ...item })).concat({ value: "sci", label: "과학" }), {
    colorOf: (item) => (subjects.includes(item) ? colors[item.label] : nextColors[item.label]),
  });
  assert.deepEqual(diff.recolored, ["국어"]);
  assert.deepEqual(diff.added, ["과학"]);
});

test("노출 상태 변경을 따로 센다", () => {
  const diff = keyed([{ ...subjects[0], active: false }, subjects[1], subjects[2]], {
    stateOf: (item) => (item.active !== false ? "노출" : "숨김"),
  });
  assert.deepEqual(diff.state, [{ label: "국어", to: "숨김" }]);
  assert.equal(mod.summarizeDraftSections([{ title: "x", diff }]).counts.state, 1);
});

test("문자열 목록: 같은 자리의 변경은 이름 변경이고, 이름 변경은 순서 변경으로 세지 않는다", () => {
  const renamed = mod.diffStringList({ saved: ["고1", "고2", "고3"], current: ["고1", "고2 심화", "고3"] });
  assert.deepEqual(renamed.renamed, [{ from: "고2", to: "고2 심화" }]);
  assert.deepEqual([renamed.added, renamed.removed, renamed.moved], [[], [], []]);
  const added = mod.diffStringList({ saved: ["고1"], current: ["고1", "고2", "고3"] });
  assert.deepEqual(added.added, ["고2", "고3"]);
  const removed = mod.diffStringList({ saved: ["고1", "고2", "고3"], current: ["고1"] });
  assert.deepEqual(removed.removed, ["고2", "고3"]);
  const moved = mod.diffStringList({ saved: ["고1", "고2", "고3"], current: ["고3", "고1", "고2"] });
  assert.deepEqual(moved.moved, ["고3"]);
  const both = mod.diffStringList({ saved: ["고1", "고2"], current: ["고2", "고1", "고3"] });
  assert.deepEqual(both.added, ["고3"]);
  assert.equal(both.moved.length, 1);
});

test("요약 문구·HTML: 건수를 구분하고 값은 이스케이프한다", () => {
  const summary = mod.summarizeDraftSections([
    { title: "과목", diff: mod.diffStringList({ saved: ["국어"], current: ["국어", "<b>x</b>"] }) },
    { title: "학년", diff: mod.diffStringList({ saved: ["고1", "고2"], current: ["고2", "고1"] }) },
    { title: "연도", diff: mod.diffStringList({ saved: ["2026"], current: ["2026"] }) },
  ]);
  assert.equal(mod.describeDraftSummary(summary), "변경 2건");
  assert.equal(summary.counts.added, 1);
  assert.equal(summary.counts.moved, 1);
  assert.equal(summary.sections.length, 2, "변경 없는 구역은 뺀다");
  const html = mod.buildDraftSummaryHtml(summary);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x/);
  assert.match(html, /<details class="admin-draft-summary__details">/);
  assert.doesNotMatch(html, /연도/);
});

test("renderDraftSummary: 변경이 없으면 숨기고 취소 버튼을 끄며, 상세를 연 상태는 유지한다", () => {
  const details = { open: true };
  const host = { hidden: true, innerHTML: "", querySelector: () => details };
  const badge = { dataset: {}, textContent: "", hidden: true };
  const reset = { disabled: true };
  const dirty = mod.summarizeDraftSections([{ title: "학년", diff: mod.diffStringList({ saved: [], current: ["고1"] }) }]);
  assert.equal(mod.renderDraftSummary({ host, badges: [{ el: badge, text: "저장 전" }], resetButton: reset, summary: dirty }), true);
  assert.deepEqual([host.hidden, badge.hidden, badge.textContent, reset.disabled, details.open], [false, false, "저장 전", false, true]);
  const clean = mod.summarizeDraftSections([]);
  assert.equal(mod.renderDraftSummary({ host, badges: [{ el: badge, text: "저장 전" }], resetButton: reset, summary: clean }), false);
  assert.deepEqual([host.hidden, host.innerHTML, badge.hidden, badge.textContent, reset.disabled], [true, "", true, "", true]);
});

test("요약 모듈은 DB·저장소·listener를 쓰지 않는다", () => {
  assert.doesNotMatch(read("assets/js/utils/admin-draft-summary.js"), /firebase|firestore|getDocs?\b|onSnapshot|fetch\(|localStorage|sessionStorage/);
});

test("네 화면 모두 drawer·요약·변경 취소·중립 관리 버튼·주황 저장을 쓰고 검색을 넣지 않는다", () => {
  const pages = [
    ["members/admin/courses.html", "assets/js/pages/admin-courses.js", "courseCatalog", "courseCatalogPanel", "courseCatalogDrawerTitle", "courseCatalogSaveBtn"],
    ["members/admin/users/instructors.html", "assets/js/pages/admin-instructors.js", "instructorCatalog", "instructorCatalogPanel", "instructorCatalogDrawerTitle", "instructorCatalogSaveBtn"],
    ["members/admin/offline-classes.html", "assets/js/pages/admin-offline-classes.js", "offlineCatalog", "offlineCatalogPanel", "offlineCatalogDrawerTitle", "offlineCatalogSaveBtn"],
    ["members/admin/timetable.html", "assets/js/pages/admin-timetable.js", "scheduleGroups", "scheduleGroupsPanel", "scheduleGroupsDrawerTitle", "scheduleGroupsSaveBtn"],
  ];
  for (const [htmlPath, jsPath, prefix, panelId, titleId, saveId] of pages) {
    const html = read(htmlPath);
    const js = read(jsPath);
    const trigger = html.match(new RegExp(`<button[^>]*class="btn sm admin-catalog-open-btn" id="${prefix}OpenBtn"[^>]*aria-controls="${panelId}"[^>]*>`));
    assert.ok(trigger, htmlPath);
    assert.doesNotMatch(trigger[0], /\shidden/, `${htmlPath}: 관리 버튼은 첫 화면부터 보인다`);
    assert.match(html, new RegExp(`<div class="admin-catalog-panel is-drawer grit-section" id="${panelId}"[^>]* hidden>`), `${htmlPath}: 패널은 처음부터 닫혀 있다`);
    assert.doesNotMatch(html, /admin-catalog-panel__summary|<details class="admin-catalog-panel/, `${htmlPath}: 이전 토글 제거`);
    assert.match(html, new RegExp(`id="${titleId}"`), htmlPath);
    assert.match(html, new RegExp(`id="${prefix}DraftSummary"`), htmlPath);
    assert.match(html, new RegExp(`id="${prefix}ResetBtn" disabled`), htmlPath);
    assert.match(html, new RegExp(`class="btn primary sm" id="${saveId}"`), htmlPath);
    const start = html.indexOf(`id="${panelId}"`);
    const panel = html.slice(start, html.indexOf(`id="${saveId}"`, start));
    assert.doesNotMatch(panel, /type="search"|검색/, `${htmlPath}: 작은 목록에 검색을 넣지 않는다`);
    assert.match(panel, /벗어나/, `${htmlPath}: 초안 유지 안내`);
    assert.match(panel, /저장/, `${htmlPath}: 저장 시점 안내`);
    assert.match(js, /initCatalogDrawer\(/, jsPath);
    assert.match(js, /renderDraftSummary\(/, jsPath);
    assert.match(js, /setCatalogPanelSaving\(/, jsPath);
    assert.match(js, /beforeunload/, jsPath);
  }
});

test("행 렌더: 한 열 순서·독립 버튼·접근성 이름, 첫/마지막 이동 비활성, '목록에서 제거' 표현", () => {
  const helpers = read("assets/js/utils/catalog-select-helpers.js");
  const render = helpers.slice(helpers.indexOf("export function renderStringCatalogTagsHtml"));
  assert.match(render, /admin-catalog-row__index/);
  assert.match(render, /index === 0 \? " disabled"/);
  assert.match(render, /index === list\.length - 1 \? " disabled"/);
  assert.match(render, /목록에서 제거/);
  assert.doesNotMatch(render.slice(0, render.indexOf("join")), /삭제/, "목록 항목 제거를 데이터 삭제처럼 표현하지 않는다");
  const css = read("assets/css/pages/admin.css");
  assert.match(css, /\.admin-catalog-tags,\s*\.course-catalog-subject-editor,\s*\.admin-schedule-groups-editor__list \{\s*display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/, "읽는 순서가 저장 순서가 되도록 한 열");
});

test("공통 CSS 한 곳: 페이지 CSS에 선택 목록 행·입력 규칙을 다시 두지 않는다", () => {
  for (const rel of ["assets/css/pages/admin-courses.css", "assets/css/pages/admin-instructors.css", "assets/css/pages/admin-offline-classes.css", "assets/css/pages/admin-timetable.css", "assets/css/components/form.css"]) {
    assert.doesNotMatch(read(rel), /\.admin-catalog-(tag|field|panel)/, rel);
  }
});

test("오프라인 반 패널에서 시간표 관리의 노출 그룹으로 바꿀 수 있다", () => {
  assert.match(read("members/admin/offline-classes.html"), /id="offlineCatalogGroupTabs"/);
  const js = read("assets/js/pages/admin-offline-classes.js");
  assert.match(js, /renderAdminScheduleGroupTabs\(\s*\$\("#offlineCatalogGroupTabs"\),\s*scheduleGroupsDraft/);
  assert.match(js, /\$\("#offlineCatalogGroupTabs"\)\?\.addEventListener\("click"[\s\S]*selectScheduleGroup\(groupId\)/);
});
