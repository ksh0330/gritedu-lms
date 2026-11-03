// 관리자 명시 조회 버튼 계약('현황 불러오기' → '새로고침')과 목록 검색창 단일 경계 CSS 회귀 테스트.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function fakeButton() {
  const classes = new Set(["btn", "sm"]);
  const attrs = {};
  return {
    classes, attrs, title: "", disabled: false, textContent: "",
    classList: { toggle: (n, on) => (on ? classes.add(n) : classes.delete(n)), contains: (n) => classes.has(n) },
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
  };
}

async function loadUserAddContract() {
  const source = read("assets/js/pages/admin-user-add.js");
  const start = source.indexOf("function syncUsersLoadButton()");
  const end = source.indexOf("function setUsersReadyState()");
  assert.ok(start > 0 && end > start);
  const { setAdminRefreshButtonState } = await import(pathToFileURL(path.join(root, "assets/js/utils/admin-refresh.js")).href);
  const button = fakeButton();
  const context = vm.createContext({ $: () => button, setAdminRefreshButtonState });
  vm.runInContext(`let usersLoaded=false,usersLoading=false,usersLoadFailed=false;${source.slice(start, end)}`, context);
  const set = (patch) => Object.entries(patch).forEach(([k, v]) => vm.runInContext(`${k}=${JSON.stringify(v)}`, context));
  const sync = () => vm.runInContext("syncUsersLoadButton()", context);
  const message = () => vm.runInContext("getUsersReadyMessage()", context);
  return { button, set, sync, message };
}

test("계정 목록: 최초 '현황 불러오기'(주황) → 조회 중 비활성 → 성공 후 '새로고침'(회색)", async () => {
  const c = await loadUserAddContract();
  c.sync();
  assert.equal(c.button.textContent, "현황 불러오기");
  assert.equal(c.button.classes.has("primary"), true);
  assert.equal(c.button.classes.has("admin-refresh-btn"), false);
  assert.equal(c.button.disabled, false);

  c.set({ usersLoading: true });
  c.sync();
  assert.equal(c.button.textContent, "불러오는 중...");
  assert.equal(c.button.disabled, true);
  assert.equal(c.button.attrs["aria-busy"], "true");

  c.set({ usersLoading: false, usersLoaded: true });
  c.sync();
  assert.equal(c.button.textContent, "새로고침");
  assert.equal(c.button.classes.has("primary"), false);
  assert.equal(c.button.classes.has("secondary"), true);
  assert.equal(c.button.classes.has("admin-refresh-btn"), true);
  assert.equal(c.button.disabled, false);
  assert.equal(c.button.attrs["aria-busy"], undefined);
});

test("계정 목록: 실패하면 '현황 불러오기'로 돌아가고 빈 상태·로딩·실패 문구를 구분한다", async () => {
  const c = await loadUserAddContract();
  assert.match(c.message(), /'현황 불러오기'를 눌러/);
  c.set({ usersLoading: true });
  assert.match(c.message(), /불러오는 중/);
  c.set({ usersLoading: false, usersLoadFailed: true, usersLoaded: false });
  assert.match(c.message(), /불러오지 못했습니다.*다시 시도/);
  c.sync();
  assert.equal(c.button.textContent, "현황 불러오기");
  assert.equal(c.button.disabled, false, "다시 시도할 수 있어야 한다");
});

test("계정 목록: 자동 조회로 바꾸지 않는다(초기 진입에서 loadUsers 를 호출하지 않는다)", () => {
  const source = read("assets/js/pages/admin-user-add.js");
  const init = source.slice(source.indexOf("function initTabButtons()"), source.indexOf("// 회원가입 설정 관리"));
  assert.doesNotMatch(init, /loadUsers\(/);
  assert.match(init, /setUsersReadyState\(\)/);
  const html = read("members/admin/users/add.html");
  assert.match(html, /id="refreshBtn"[^>]*>현황 불러오기</);
  assert.doesNotMatch(html, /새로고침을 눌러/);
  assert.doesNotMatch(source, /새로고침을 눌러/);
});

test("계정 목록: 처음 불러오는 동안 안내를 조회 중으로 바꾸고, 실패하면 불러온 상태를 해제한다", () => {
  const source = read("assets/js/pages/admin-user-add.js");
  const load = source.slice(source.indexOf("async function loadUsers()"), source.indexOf("// 사용자 정렬 함수"));
  assert.match(load, /usersLoading = true;[\s\S]*if \(!allUsers\.length\) setUsersReadyState\(\);/);
  assert.match(load, /catch \(err\) \{[\s\S]*usersLoaded = false;[\s\S]*usersLoadFailed = true;/);
});

test("자동 조회 페이지(강사·반·강좌)의 새로고침 버튼은 그대로 유지된다", () => {
  for (const rel of ["members/admin/users/instructors.html", "members/admin/offline-classes.html", "members/admin/courses.html", "members/admin/timetable.html"]) {
    assert.match(read(rel), /id="refreshBtn"[^>]*>\s*새로고침\s*</, rel);
  }
  assert.match(read("members/admin/users/members.html"), /id="refreshBtn"[^>]*>현황 불러오기</);
  assert.match(read("members/admin/users/students.html"), /id="loadStudentsStatus"[\s\S]*?현황 불러오기/);
});

const PAGES = ["admin-courses-page", "admin-offline-classes-page", "admin-user-add-page", "admin-instructors-page", "admin-members-body", "admin-students-page"];

test("검색창: 안쪽 input 은 테두리·배경·그림자가 없고 경계는 wrap 하나(focus-within)뿐이다", () => {
  const css = read("assets/css/pages/admin.css");
  const scope = `:is(${PAGES.map((p) => `.${p}`).join(",")})`;
  const inputRule = css.slice(css.indexOf(`${scope} .admin-toolbar__search-wrap > .admin-toolbar__search-input {`));
  const block = inputRule.slice(0, inputRule.indexOf("}"));
  for (const decl of ["background:transparent", "border:0", "box-shadow:none", "outline:0", "min-width:0"]) {
    assert.ok(block.includes(decl), decl);
  }
  assert.match(css, /\.admin-toolbar__search-wrap:focus-within \{\s*border-color:var\(--brand\)/);
  assert.match(css, /\.admin-toolbar__search-wrap \{[\s\S]*?border:1px solid/);
  // 공개/학습 화면에서 같은 class 를 쓰는 페이지는 범위에 넣지 않는다.
  assert.doesNotMatch(scope, /member-course-page|courses-all|schedule/);
});

test("검색창: 목록 도구 모음에서 폭·높이를 통일하고 모바일은 44px·전폭이며 검색 버튼은 최소 40px 터치 영역이다", () => {
  const css = read("assets/css/pages/admin.css");
  const where = `:where(${PAGES.map((p) => `.${p}`).join(",")})`;
  const desktop = css.slice(css.indexOf(`${where} .admin-toolbar > .admin-toolbar__search-wrap {`));
  const desktopBlock = desktop.slice(0, desktop.indexOf("}"));
  assert.match(desktopBlock, /flex:1 1 280px/);
  assert.match(desktopBlock, /max-width:min\(100%,420px\)/);
  assert.match(desktopBlock, /min-height:40px/);
  const mobile = css.slice(css.indexOf("@media (max-width:768px) {\n  :where("));
  assert.match(mobile.slice(0, 900), /\.admin-toolbar > \.admin-toolbar__search-wrap \{\s*min-height:44px/);
  assert.match(mobile.slice(0, 1200), /search-button \{\s*min-height:40px;\s*min-width:40px/);
  assert.match(css, /@media \(max-width:640px\) \{\s*:where\([^)]*\) \.admin-toolbar:not\(\.admin-toolbar--primary-list\) > \.admin-toolbar__search-wrap \{\s*flex-basis:100%;\s*max-width:none/);
  // 기존 Enter/버튼 확정 검색 동작은 CSS 와 무관하게 유지: 검색 버튼 aria-label 이 모든 관리자 목록에 있다.
  for (const rel of ["members/admin/courses.html", "members/admin/users/students.html", "members/admin/users/members.html", "members/admin/users/instructors.html", "members/admin/users/add.html", "members/admin/offline-classes.html"]) {
    assert.match(read(rel), /admin-toolbar__search-button" aria-label="[^"]*검색 실행"/, rel);
  }
  const members = read("assets/css/pages/admin-members.css");
  assert.doesNotMatch(members, /\.admin-members-toolbar \.admin-toolbar__search-wrap \{\s*flex: 1 1 260px;\s*max-width: none/);
});
