const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "assets/js/pages/admin-user-add.js"), "utf8");

function slice(startMarker, endMarker) {
  const start = code.indexOf(startMarker);
  const end = code.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `markers not found: ${startMarker}`);
  return code.slice(start, end);
}

async function createRenderer() {
  const { formatGrade } = await import("../assets/js/utils/grade.js");
  const tbody = { innerHTML: "" };
  const context = {
    $: (selector) => (selector === "#tblUsers" ? { querySelector: () => tbody } : null),
    console,
    formatGrade,
    getInstructorSubjects: (user) => user.subjects || [],
    sortUsers: (users) => users,
    setUsersExportReady() {},
    updateUserStats() {},
    renderPagination() {},
  };
  vm.createContext(context);
  vm.runInContext([
    "let allUsers = []; let filteredUsers = []; let currentPage = 1; let itemsPerPage = 50;",
    "let currentSort = { field: '', direction: 'desc' };",
    slice("function getMemberPurposeLabel(value) {", "function requiresMemberSignupSource("),
    slice("function formatCreatedAt(value) {", "function getConsentStatusLabel("),
    slice("function getUserCreatedAtValue(user = {}) {", "function getCreatedAtMillis("),
    slice("const SAFE_ACTION_ARG_PATTERN", "function renderPagination("),
    slice("function escapeHtml(value) {", "function buildCleanupDialogHtml("),
    "globalThis.renderUsers = renderUsers;",
  ].join("\n"), context);
  return (users) => {
    context.renderUsers(users);
    return tbody.innerHTML;
  };
}

test("learner-controlled name, email and note render as text only", async () => {
  const render = await createRenderer();
  const html = render([{
    uid: "studentUid01",
    role: "student",
    name: "<img src=x onerror=alert(1)>",
    email: "\"><svg onload=alert(2)>@example.com",
    note: "memo\" onmouseover=\"alert(3)",
    school: "<b>학교</b>",
    grade: "1\" data-x=\"y",
  }]);
  assert.doesNotMatch(html, /<img|<svg onload|<b>/i);
  assert.match(html, /<td>&lt;img src=x onerror=alert\(1\)&gt;<\/td>/);
  assert.match(html, /<td>&quot;&gt;&lt;svg onload=alert\(2\)&gt;@example\.com<\/td>/);
  assert.match(html, /title="memo&quot; onmouseover=&quot;alert\(3\)">memo&quot; onmouseover=&quot;alert\(3\)<\/td>/);
  assert.doesNotMatch(html, /onmouseover="/);
  assert.match(html, /<td>-<\/td>/);
});

test("normal rows keep the previous text and handler markup", async () => {
  const render = await createRenderer();
  const html = render([
    { uid: "memberUid_01", role: "member", name: "홍길동", email: "parent@example.com", memberPurpose: "parent", note: "" },
    { uid: "studentUid02", role: "student", name: "김학생", email: "student@example.com", school: "그릿중", grade: "2" },
  ]);
  assert.match(html, /<td><span class="pill">일반\/학부모 회원<\/span><\/td>/);
  assert.match(html, /<td>홍길동<\/td>\s*<td>parent@example\.com<\/td>\s*<td>학부모 회원<\/td>/);
  assert.match(html, /<button class="btn warning sm" onclick="deleteUser\('memberUid_01', 'member'\)" title="사이트 데이터 정리"/);
  assert.match(html, /<td>김학생<\/td>\s*<td>student@example\.com<\/td>\s*<td>그릿중<\/td>\s*<td>중2<\/td>/);
  assert.match(html, /onclick="deleteUser\('studentUid02', 'student'\)"/);
  assert.match(html, /title="">-<\/td>/);
});

test("instructor and admin actions keep their handlers and arguments", async () => {
  const render = await createRenderer();
  const html = render([
    { uid: "instAuthUid1", role: "instructor", instructorId: "inst_1700000000000", instructorLinkStatus: "linked", name: "강사" },
    { uid: "profile_inst_1", role: "instructor", instructorId: "inst_1", instructorLinkStatus: "profileOnly", name: "프로필" },
    { uid: "instAuthUid2", role: "instructor", instructorId: "", instructorLinkStatus: "unlinked", name: "미연동" },
    { uid: "adminUid1", role: "admin", name: "관리자" },
  ]);
  assert.match(html, /onclick="unlinkInstructorAccount\('instAuthUid1'\)"/);
  assert.match(html, /onclick="deleteUser\('inst_1', 'instructor'\)" title="미연동 강사 프로필과 배정 데이터 정리"/);
  assert.match(html, /onclick="deleteUser\('instAuthUid2', 'instructor'\)" title="미연동 강사 데이터 정리"/);
  assert.match(html, /<span class="manual-management-badge">수동 관리<\/span>/);
});

test("legacy and hostile identifiers remain string arguments without executing code", async () => {
  const render = await createRenderer();
  for (const uid of ["강사.legacy", "x');alert(1);//", 'id"<> &\n']) {
    const html = render([{uid, role: "student", name: "학생"}]);
    assert.doesNotMatch(html, /<button[^>]* disabled/);
    const attribute = html.match(/onclick="([^"]*)"/)[1];
    const decoded = attribute.replace(/&(amp|lt|gt|quot|#39|#039);/g,
      (_, key) => ({amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#039": "'"})[key]);
    let received;
    vm.runInNewContext(decoded, {deleteUser: (...args) => { received = args; }});
    assert.deepEqual(received, [uid, "student"]);
  }
});
