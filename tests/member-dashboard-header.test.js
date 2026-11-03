// 회원 LMS 상단: 전체 강좌 보기 제거, 환영 인사, 기존 D-Day 설정 공유(DB 없음).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("회원 LMS(일반·학부모)에서 '전체 강좌 보기' 버튼과 빈 화면 링크를 없앤다", () => {
  const html = read("members/member/dashboard.html");
  const js = read("assets/js/pages/member-dashboard.js");
  assert.doesNotMatch(html, /memberCoursesCta|전체 강좌 보기/);
  assert.doesNotMatch(js, /memberCoursesCta|전체 강좌 보기/);
  assert.doesNotMatch(read("assets/css/pages/member-dashboard.css"), /memberCoursesCta/);
  // 공개 강좌 페이지 자체는 그대로 둔다.
  assert.ok(fs.existsSync(path.join(root, "courses.html")));
});

test("일반 회원·학부모 모두 환영 인사를 표시하고 이름 저장 후 갱신한다", () => {
  const js = read("assets/js/pages/member-dashboard.js");
  assert.match(js, /function renderMemberWelcome\(member = \{\}, user = \{\}\)/);
  assert.match(js, /`\$\{name\}님, 환영합니다\.`/);
  assert.match(js, /\|\| "회원";/, "이름이 없어도 문구가 깨지지 않는다");
  const init = js.slice(js.lastIndexOf("(async () => {"));
  assert.match(init, /renderMemberWelcome\(member, user\);/);
  assert.doesNotMatch(init, /statusEl\.hidden = true/, "로딩 후 인사 문구를 숨기지 않는다");
  const save = js.slice(js.indexOf("const saved = await saveMemberProfile"));
  assert.match(save.slice(0, 300), /renderMemberWelcome\(member, user\);/);
});

test("회원 LMS D-Day 는 학생 내 강의실과 같은 대시보드 표시 설정을 쓴다(새 설정 없음)", () => {
  const html = read("members/member/dashboard.html");
  const js = read("assets/js/pages/member-dashboard.js");
  assert.match(html, /id="memberDashboardStatus"[^>]*>[^<]*<\/p>\s*<div id="memberDashboardDday" class="dashboard-dday-slot" hidden><\/div>/, "환영 인사 바로 아래");
  assert.match(js, /import \{ mountDday \} from "\/assets\/js\/utils\/dday\.js";/);
  assert.match(js, /mountDday\(document\.getElementById\("memberDashboardDday"\), \{ variant: "dashboard", placement: "dashboard" \}\)/);
  assert.match(read("assets/js/pages/student-dashboard.js"), /mountDday\(ensureDashboardDdayHost\(\), \{ variant: "dashboard", placement: "dashboard" \}\)/);
  assert.match(read("members/admin/site.html"), /id="ddayShowDashboard"[\s\S]{0,120}내 강의실·회원 LMS·강사 LMS 환영 인사 아래/);
});

test("회원 '기본 정보 수정' 버튼은 학생 내 강의실 버튼과 같은 클래스·스타일·아이콘·문구이고 기존 모달을 연다", () => {
  const buttonOf = (html, id) => {
    const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/button>`));
    assert.ok(m, `#${id} 버튼`);
    const open = m[0].slice(0, m[0].indexOf(">") + 1);
    return {
      cls: (open.match(/class="([^"]*)"/) || [])[1],
      style: (open.match(/style="([^"]*)"/) || [])[1],
      paths: [...m[1].matchAll(/<path d="([^"]+)"/g)].map((p) => p[1]),
      text: m[1].replace(/<svg[\s\S]*?<\/svg>/, "").replace(/\s+/g, " ").trim(),
    };
  };
  const student = buttonOf(read("members/students/dashboard.html"), "editProfileBtn");
  const member = buttonOf(read("members/member/dashboard.html"), "openMemberInfoBtn");
  assert.deepEqual(member, student);
  assert.equal(member.text, "기본 정보 수정");
  assert.match(read("assets/js/pages/member-dashboard.js"), /getElementById\("openMemberInfoBtn"\)/);
  assert.match(read("assets/css/pages/member-dashboard.css"), /\.member-dashboard-hero \{[^}]*align-items: center;/);
});
