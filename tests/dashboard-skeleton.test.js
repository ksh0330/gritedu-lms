// 대시보드 로딩 skeleton·D-Day 공유 설정·회원 LMS 제목 형식(정적 검사, DB 없음).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const css = () => read("assets/css/components/dashboard-skeleton.css");

const DASHBOARDS = {
  student: { html: "members/students/dashboard.html", ddayId: "dashboardDday" },
  member: { html: "members/member/dashboard.html", ddayId: "memberDashboardDday" },
  instructor: { html: "members/instructors/dashboard.html", ddayId: "instructorDashboardDday" },
};

function headScript(html) {
  const head = html.slice(0, html.indexOf("</head>"));
  const m = head.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "head inline script");
  assert.ok(head.indexOf(m[0]) < head.indexOf("firebase-init.js"), "모듈보다 먼저 실행");
  return m[1];
}

function runHead(code, storage) {
  const classes = new Set();
  const attrs = {};
  const documentElement = {
    classList: { add: (c) => classes.add(c) },
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  const sessionStorage = {
    getItem: (k) => {
      if (storage === "throw") throw new Error("blocked");
      return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null;
    },
  };
  vm.runInNewContext(code, { document: { documentElement }, sessionStorage, JSON });
  return { classes, attrs };
}

test("학생·회원·강사 대시보드 head 스크립트는 세션 D-Day 값으로만 자리를 잡는다", () => {
  for (const [name, { html: rel, ddayId }] of Object.entries(DASHBOARDS)) {
    const html = read(rel);
    assert.match(html, new RegExp(`<div id="${ddayId}" class="dashboard-dday-slot" hidden></div>`), name);
    const code = headScript(html);
    assert.ok(runHead(code, {}).classes.has("dday-slot-pending"), `${name}: 첫 진입은 자리 확보`);
    const on = JSON.stringify({ savedAt: 1, settings: {}, showDashboard: true });
    const off = JSON.stringify({ savedAt: 1, settings: {}, showDashboard: false });
    assert.ok(runHead(code, { "grit:dday:v1": on }).classes.has("dday-slot-pending"), `${name}: 표시 설정`);
    assert.ok(!runHead(code, { "grit:dday:v1": off }).classes.has("dday-slot-pending"), `${name}: 숨김 설정`);
    assert.ok(runHead(code, "throw").classes.has("dday-slot-pending"), `${name}: 저장소 차단`);
  }
});

test("회원 LMS head 스크립트는 세션의 회원 유형(parent/general)만 반영한다", () => {
  const code = headScript(read(DASHBOARDS.member.html));
  assert.equal(runHead(code, { "grit:memberPurpose": "parent" }).attrs["data-member-purpose"], "parent");
  assert.equal(runHead(code, { "grit:memberPurpose": "general" }).attrs["data-member-purpose"], "general");
  assert.equal(runHead(code, { "grit:memberPurpose": "x\" onload" }).attrs["data-member-purpose"], undefined);
  assert.equal(runHead(code, {}).attrs["data-member-purpose"], undefined);

  const js = read("assets/js/pages/member-dashboard.js");
  assert.match(js, /const MEMBER_PURPOSE_SESSION_KEY = "grit:memberPurpose";/);
  const configure = js.slice(js.indexOf("function configureDashboardForPurpose"), js.indexOf("function renderMemberWelcome"));
  assert.match(configure, /sessionStorage\.setItem\(MEMBER_PURPOSE_SESSION_KEY, isParent \? "parent" : "general"\)/);
  assert.match(configure, /removeAttribute\("data-member-purpose"\)/);
  assert.match(js, /purposeBadge\.classList\.remove\("dashboard-skeleton"\)/);
});

test("D-Day 설정은 탭 세션에 5분 보관해 pages/dday 반복 조회를 줄이고, 모든 종료 경로에서 자리를 푼다", () => {
  const js = read("assets/js/utils/dday.js");
  assert.match(js, /export const DDAY_SESSION_CACHE_KEY = "grit:dday:v1";/);
  assert.match(js, /DDAY_SESSION_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(js, /showDashboard: shouldRender\(normalized, "dashboard"\)/);
  const mount = js.slice(js.indexOf("export async function mountDday"));
  assert.match(mount, /await loadDdaySettingsCached\(\)/);
  assert.match(mount, /finally \{\s*releaseDdaySlot\(\);/);
  assert.match(mount, /if \(!element\) \{\s*releaseDdaySlot\(\);/);
  // 사이트 관리 저장 시 같은 탭 캐시를 바로 갱신
  const admin = read("assets/js/pages/admin-site.js");
  assert.match(admin, /writeDdaySessionCache\(settings\);/);
  // 사이트 관리 화면은 항상 원본을 읽는다
  assert.doesNotMatch(admin.slice(admin.indexOf("async function loadDdaySettingsForAdmin")), /^\s*readDdaySessionCache/m);
});

test("강사 LMS 도 같은 '대시보드' 체크박스로 D-Day 를 표시한다(새 설정 없음)", () => {
  const html = read(DASHBOARDS.instructor.html);
  assert.match(html, /id="instructorInfo"[^>]*>[^<]*<\/p>\s*<!--[^>]*-->\s*<div id="instructorDashboardDday"/, "환영 인사 바로 아래");
  const js = read("assets/js/pages/instructor-dashboard.js");
  assert.match(js, /import \{ mountDday \} from "\/assets\/js\/utils\/dday\.js";/);
  assert.match(js, /mountDday\(document\.getElementById\("instructorDashboardDday"\), \{ variant: "dashboard", placement: "dashboard" \}\)/);
  assert.match(css(), /\.instructor-dashboard-page \.dashboard-dday-slot\[hidden\] \{\s*margin-inline: auto;/);
  assert.match(read("members/admin/site.html"), /id="ddayShowDashboard"[\s\S]{0,120}강사 LMS 환영 인사 아래/);
});

test("skeleton 크기는 로딩 완료 화면 실측값과 같다", () => {
  const c = css();
  assert.match(c, /\.dashboard-skeleton--card \{\s*min-height: 203px;/);
  assert.match(c, /\.dashboard-skeleton--offline-row \{\s*min-height: 196px;/);
  assert.match(c, /\.dashboard-skeleton--child-card \{\s*min-height: 107px;/);
  assert.match(c, /\.stat-value\.dashboard-skeleton \{\s*display: block;\s*height: 1\.8em;/);
  assert.match(c, /\.instructor-section-meta\.dashboard-skeleton--text \{\s*height: 1\.8em;/);
  assert.match(c, /@media \(max-width: 768px\) \{\s*\.dashboard-skeleton--card ~ \.dashboard-skeleton--card,/);
  assert.match(c, /html\.dday-slot-pending \.dashboard-dday-slot\[hidden\] \{[^}]*height: 36px;[^}]*margin-top: 16px;/);

  const student = read(DASHBOARDS.student.html);
  assert.equal((student.match(/dashboard-skeleton--offline-row/g) || []).length, 2);
  assert.doesNotMatch(student, /dashboard-skeleton--row"/);
  const member = read(DASHBOARDS.member.html);
  assert.equal((member.match(/dashboard-skeleton--child-card/g) || []).length, 2);
  assert.match(member, /class="member-dashboard-kicker dashboard-skeleton" id="memberPurposeBadge"/);

  const instructor = read(DASHBOARDS.instructor.html);
  assert.equal((instructor.match(/<tbody><tr><td colspan="6" class="muted instructor-table-empty">불러오는 중입니다\.\.\.<\/td><\/tr><\/tbody>/g) || []).length, 4,
    "JS 가 처음 그리는 안내 행과 같은 높이");
});

test("회원 LMS 제목은 학생 내 강의실과 같은 형식(왼쪽 정렬·아이콘)이고 모바일에서도 세로로 쌓지 않는다", () => {
  const titleOf = (html) => {
    const m = html.match(/<h1 class="page-title"( style="[^"]*")?>([\s\S]*?)<\/h1>/);
    assert.ok(m);
    return { style: m[1], paths: [...m[2].matchAll(/<path d="([^"]+)"/g)].map((p) => p[1]) };
  };
  const student = titleOf(read(DASHBOARDS.student.html));
  const member = titleOf(read(DASHBOARDS.member.html));
  assert.deepEqual(member, student);
  assert.equal(member.style, ' style="display:flex;align-items:center;gap:8px;"');

  const memberCss = read("assets/css/pages/member-dashboard.css");
  assert.match(memberCss, /\.member-dashboard-hero \{[^}]*flex-wrap: wrap;[^}]*gap: 12px;/);
  const mobile = memberCss.slice(memberCss.indexOf("@media (max-width: 768px)"));
  assert.doesNotMatch(mobile.slice(0, 200), /\.member-dashboard-hero/);
});

test("강사 LMS D-Day 는 상단 제목·환영 인사처럼 가운데 정렬", () => {
  assert.match(read("assets/css/pages/instructor-dashboard.css"), /\.instructor-dashboard-page #instructorDashboardDday \{\s*text-align: center;/);
});

test("온라인 학습 화면: JS 가 붙이던 클래스를 처음부터 넣어 skeleton 단계에서도 같은 여백·라벨 크기", () => {
  const student = read("members/students/course.html");
  const member = read("members/member/course.html");
  assert.match(student, /<body class="student-learning-page">/);
  assert.match(member, /<body class="member-course-page student-learning-page member-learning-page">/);
  for (const html of [student, member]) {
    assert.match(html, /<main class="grit-page-container student-learning-shell" id="coursePage">/);
    assert.match(html, /<div class="dash-back student-learning-back">/);
  }
  // JS 는 그대로 같은 클래스를 붙인다(중복 무해).
  const js = read("assets/js/pages/student-course.js");
  assert.match(js, /document\.body\.classList\.add\("student-learning-page"\)/);
  const c = read("assets/css/pages/student-course.css");
  assert.match(c, /\.course-instructor:empty::before \{\s*content: "\\00a0";/);
  assert.match(c, /\.skeleton-week-card \{[^}]*min-height: 100px;/);
  assert.match(c, /@media \(max-width: 768px\) \{\s*\.loading-skeleton \{\s*gap: 12px;\s*\}\s*\.skeleton-week-card \{\s*min-height: 92px;/);
  assert.match(c, /@media \(max-width: 480px\) \{\s*\.loading-skeleton \{\s*gap: 10px;\s*\}\s*\.skeleton-week-card \{\s*min-height: 76px;/);
});

test("온라인 학습 화면: 뒤로가기·강좌 정보·학습 목록을 오프라인 반 화면처럼 같은 폭으로", () => {
  const c = read("assets/css/pages/student-course.css");
  const block = (sel) => {
    const i = c.indexOf(`\n${sel} {`);
    assert.ok(i >= 0, sel);
    return c.slice(i, c.indexOf("}", i));
  };
  assert.match(block(".course-header"), /max-width: none;/);
  assert.match(block(".student-learning-toolbar"), /max-width: none;/);
  assert.doesNotMatch(c, /max-width: 920px/);
});

test("공개 강좌 목록 skeleton 카드는 실제 카드 높이(120px)", () => {
  assert.match(read("assets/css/pages/courses-all.css"), /\.courses-all-page \.skeleton-course \{[^}]*min-height: 120px;/);
});

test("목록을 다시 불러올 때도 글자 안내 대신 같은 skeleton 을 그린다(높이 변화 없음)", async () => {
  const { dashboardSkeletonHtml } = await import("../assets/js/utils/dashboard-skeleton.js");
  const html = dashboardSkeletonHtml("offline-row", 2, "오프라인 반을 <불러오는> 중");
  assert.equal((html.match(/dashboard-skeleton--offline-row/g) || []).length, 2);
  assert.match(html, /<span class="sr-only">오프라인 반을 &lt;불러오는&gt; 중<\/span>/);
  assert.equal((dashboardSkeletonHtml("unknown", 99).match(/dashboard-skeleton--card/g) || []).length, 6);

  const uses = [
    ["assets/js/pages/student-dashboard/courses.js", /dashboardSkeletonHtml\("card", 3,/],
    ["assets/js/pages/student-dashboard/offline-classes.js", /dashboardSkeletonHtml\("offline-row", 2,/],
    ["assets/js/pages/member-dashboard.js", /dashboardSkeletonHtml\("card", 3,/],
    ["assets/js/pages/member-dashboard.js", /dashboardSkeletonHtml\("child-card", 2,/],
  ];
  for (const [rel, re] of uses) assert.match(read(rel), re, rel);
  assert.doesNotMatch(read("assets/js/pages/student-dashboard/courses.js"), /student-course-empty">수강 강좌를 불러오는 중/);
  assert.doesNotMatch(read("assets/js/pages/student-dashboard/offline-classes.js"), /student-offline-empty">오프라인 반을 불러오는 중/);
  assert.doesNotMatch(read("assets/js/pages/member-dashboard.js"), /불러오는 중입니다\.<\/p>/);
});

test("교습비·학원 안내 이미지는 도착 전에도 자리를 잡는다", () => {
  const tuition = read("tuition.html");
  assert.equal((tuition.match(/class="tuition-media-wrapper tuition-image-gallery" data-tuition-gallery="(academy|fee|refund)" aria-busy="true"/g) || []).length, 3);
  assert.equal((tuition.match(/<div class="tuition-image-skeleton" aria-hidden="true"><\/div>/g) || []).length, 3);
  const tcss = read("assets/css/pages/tuition.css");
  assert.match(tcss, /\.tuition-image-gallery img \{[^}]*aspect-ratio: auto 638 \/ 904;/);
  assert.match(tcss, /\.tuition-image-skeleton \{[^}]*aspect-ratio: 638 \/ 904;/);
  const tjs = read("assets/js/pages/tuition-images.js");
  assert.equal((tjs.match(/removeAttribute\("aria-busy"\)/g) || []).length, 2);

  const scss = read("assets/css/pages/story.css");
  assert.match(scss, /\.story-hero-image \{[^}]*aspect-ratio: auto 2 \/ 1;/);
  assert.match(scss, /\.story-greeting-photo-image \{[^}]*aspect-ratio: auto 2 \/ 3;/);
});

test("강사 강좌 상세·학생/강사 반 화면은 실제 배치와 같은 skeleton 으로 시작한다", () => {
  const icd = read("members/instructors/course-detail.html");
  assert.match(icd, /<div class="instructor-course-header-badges" aria-hidden="true">/);
  assert.equal((icd.match(/instructor-week-skeleton"/g) || []).length + (icd.match(/instructor-week-skeleton instructor-week-skeleton--open"/g) || []).length, 3);
  assert.match(read("assets/js/pages/instructor-course-detail.js"), /badgeWrap\.removeAttribute\("aria-hidden"\);/);
  const icss = read("assets/css/pages/instructor-course-detail.css");
  assert.match(icss, /\.instructor-week-skeleton \{\s*min-height: 84px;/);
  assert.match(icss, /\.instructor-week-skeleton--open \{\s*min-height: 360px;/);

  const student = read("members/students/offline-class.html");
  const instructor = read("members/instructors/offline-class.html");
  for (const html of [student, instructor]) {
    assert.match(html, /<div class="dashboard-skeleton offline-class-summary-skeleton" aria-hidden="true"><\/div>\s*<span class="sr-only" id="offlineClassLoading">/);
    assert.equal((html.match(/offline-session-skeleton/g) || []).length, 2);
    assert.match(html, /id="offlineSessionsSection">/, "처음부터 보임(막힌 반은 JS 가 숨김)");
  }
  assert.match(instructor, /id="offlineMembersSection">/);
  assert.match(instructor, /id="offlineAccessNote">/);
  assert.match(instructor, /<tbody><tr><td colspan="5" class="muted instructor-table-empty">불러오는 중입니다\.\.\.<\/td><\/tr><\/tbody>/);
  // 막힌 반이면 여전히 숨긴다.
  assert.match(read("assets/js/pages/student-offline-class.js"), /if \(sessionsSection\) sessionsSection\.hidden = true;/);
  assert.match(read("assets/js/pages/instructor-offline-class.js"), /if \(membersSection\) membersSection\.hidden = true;\s*if \(sessionsSection\) sessionsSection\.hidden = true;\s*if \(accessNote\) accessNote\.hidden = true;/);
  const ocss = read("assets/css/pages/offline-class-detail.css");
  assert.match(ocss, /\.offline-class-summary-skeleton \{\s*min-height: 377px;/);
  assert.match(ocss, /\.instructor-offline-class-page \.offline-class-summary-skeleton \{\s*min-height: 470px;/);
});
