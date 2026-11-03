// 로그인·회원가입 비로그인 전용 화면: 로그인 상태면 폼 대신 역할별 화면으로 replace 이동(DB 없음).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
// 브라우저용 firebase-init import 만 빼고 순수 함수를 불러온다.
const moduleSource = read("assets/js/utils/guest-only-page.js").replace(/^import .*firebase-init\.js";\s*$/m, "");
const load = () => import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);
const ORIGIN = "https://gritedu.kr";

test("next 는 같은 출처의 경로만 허용한다(열린 리다이렉트 방지)", async () => {
  const { getSafeNextUrl } = await load();
  assert.equal(getSafeNextUrl("?next=%2Fmembers%2Fstudents%2Foffline-class.html%3FclassId%3Dc1", ORIGIN), "/members/students/offline-class.html?classId=c1");
  assert.equal(getSafeNextUrl("?next=https%3A%2F%2Fevil.example%2Fx", ORIGIN), "");
  assert.equal(getSafeNextUrl("?next=%2F%2Fevil.example%2Fx", ORIGIN), "");
  assert.equal(getSafeNextUrl("", ORIGIN), "");
});

test("로그인 상태면 next 또는 역할별 대시보드, 비로그인·역할 없음이면 화면을 그대로 둔다", async () => {
  const { resolveSignedInRedirect } = await load();
  const base = { getDashboard: (role) => `/dash/${role}`, search: "", origin: ORIGIN };
  assert.equal(await resolveSignedInRedirect({ ...base, getUser: async () => ({ uid: "u" }), getRole: async () => "member" }), "/dash/member");
  assert.equal(await resolveSignedInRedirect({ ...base, search: "?next=%2Fmembers%2Fmember%2Fcourse.html", getUser: async () => ({ uid: "u" }), getRole: async () => "member" }), "/members/member/course.html");
  assert.equal(await resolveSignedInRedirect({ ...base, getUser: async () => null, getRole: async () => "member" }), "");
  assert.equal(await resolveSignedInRedirect({ ...base, getUser: async () => ({ uid: "u" }), getRole: async () => null }), "");
});

test("로그인·회원가입 화면이 비로그인 전용 처리와 bfcache 재확인을 사용하고, 로그인 성공은 replace 로 이동한다", () => {
  const guard = read("assets/js/utils/guest-only-page.js");
  assert.match(guard, /addEventListener\("pageshow"/);
  assert.match(guard, /event\.persisted/);
  assert.match(guard, /location\.replace\(target\)/);
  const login = read("assets/js/pages/login.js");
  assert.match(login, /initGuestOnlyPage\(\)/);
  assert.match(login, /location\.replace\(redirectUrl\)/);
  assert.doesNotMatch(login, /location\.href = redirectUrl/);
  const signup = read("assets/js/pages/signup.js");
  assert.match(signup, /initGuestOnlyPage\(\)/);
  assert.doesNotMatch(signup, /if \(auth\.currentUser\)/, "복원 전 auth.currentUser 로 판단하던 무효한 코드가 남지 않는다");
  for (const rel of ["members/login.html", "members/signup.html"]) {
    assert.match(read(rel), /classList\.add\('guest-auth-checking'\)/, `${rel} 은 확인 중 폼을 숨긴다`);
  }
  const css = read("assets/css/base/utilities.css");
  assert.match(css, /html\.guest-auth-checking main\.auth-wrap \{[^}]*visibility: hidden;[^}]*animation: guest-auth-reveal 0s linear 2\.5s forwards;/);
});
