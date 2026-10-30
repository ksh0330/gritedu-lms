const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(root, "assets/js/pages", name), "utf8");

function exportClickHandler(file, buttonId, context) {
  const code = source(file);
  const marker = `$("#${buttonId}")?.addEventListener("click", async () => {`;
  const start = code.indexOf(marker);
  assert.ok(start >= 0, `${buttonId} handler exists`);
  const closing = file === "admin-offline-classes.js" ? "\n  });" : "\n});";
  const end = code.indexOf(closing, start);
  assert.ok(end > start, `${buttonId} handler ends`);
  const callback = code.slice(start + marker.indexOf("async () =>"), end + closing.indexOf("}") + 1);
  return vm.runInNewContext(`(${callback})`, context);
}

function fakeButton() {
  return {
    disabled: false, dataset: {}, textContent: "엑셀", attributes: {},
    addEventListener(type, callback) { if (type === "click") this.onClick = callback; },
    click() { return this.onClick(); },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  };
}

test("one export click locks the button, protects formula prefixes and creates one workbook", async () => {
  const { writeAdminXlsx } = await import("../assets/js/utils/admin-xlsx.js");
  const button = fakeButton();
  let release;
  const writes = [];
  const fakeXlsx = {
    utils: {
      json_to_sheet: (rows) => rows,
      book_new: () => ({}),
      book_append_sheet: (book, rows) => { book.rows = rows; },
    },
    writeFile: (book, filename) => {
      writes.push({ book, filename });
      return new Promise((resolve) => { release = resolve; });
    },
  };
  const options = { rows: [{ 이름: "=2+2", 연락처: "+8210", 수: 12 }], sheetName: "검증", filename: "검증.xlsx", button };
  const first = writeAdminXlsx(fakeXlsx, options);
  const second = await writeAdminXlsx(fakeXlsx, options);
  assert.equal(second, false);
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "true");
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].book.rows)), [{ 이름: "'=2+2", 연락처: "'+8210", 수: 12 }]);
  release();
  assert.equal(await first, true);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], undefined);
});

test("one workbook supports separate relationship sheets and protects their text", async () => {
  const { writeAdminXlsx } = await import("../assets/js/utils/admin-xlsx.js");
  const sheets = [];
  const xlsx = {
    utils: {
      json_to_sheet: (rows) => rows,
      book_new: () => ({}),
      book_append_sheet: (_, rows, name) => sheets.push({ name, rows }),
    },
    writeFile: async () => {},
  };
  assert.equal(await writeAdminXlsx(xlsx, {
    sheets: [
      { name: "학생", rows: [{ 이름: "홍길동" }] },
      { name: "학부모연결", rows: [
        { 학생UID: "s1", 학부모명: "=부모", 상태: "active" },
        { 학생UID: "s2", 학부모명: "=부모", 상태: "revoked" },
      ] },
    ], filename: "synthetic.xlsx",
  }), true);
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets[1].rows.map((row) => row.학생UID), ["s1", "s2"]);
  assert.equal(sheets[1].rows[0].학부모명, "'=부모");
});

test("instructor click has a single XLSX handler with the prior CSV business columns", async () => {
  const code = source("admin-instructors.js");
  assert.equal((code.match(/dlInstructors["']\)\?\.addEventListener\(["']click/g) || []).length, 1);
  const button = fakeButton();
  const exports = [];
  const records = Array.from({ length: 15 }, (_, index) => ({
    profileDocId: `profile-${index}`, name: `강사${index}`, subject: "수학",
    email: "public-should-not-export@example.test", phone: "public-phone", note: "public-note",
    hasAccount: true, onlineCourseCount: 2, offlineClassCount: 3,
    onlineCourseNames: ["대수", "기하"], offlineClassNames: ["고3 A반"],
  }));
  const privateRows = new Map(records.map((row, index) => [row.profileDocId, {
    email: `private${index}@example.test`, phone: "010-0000-0000", note: "관리자 메모",
  }]));
  privateRows.delete("profile-14");
  const context = {
    instructorsLoaded: true, allInstructors: records, getFilteredInstructors: () => records,
    instructorPrivateByProfileId: privateRows,
    getInstructorSubjectLabel: (row) => row.subject, classCounts: {}, offlineClassCounts: {},
    appliedInstructorKeyword: "강사", XLSX: {}, $: () => button, toast: () => {}, console,
    adminXlsxFilename: (_, count) => `${count}.xlsx`,
    writeAdminXlsx: async (_, options) => { exports.push(options); return true; },
  };
  button.addEventListener("click", exportClickHandler("admin-instructors.js", "dlInstructors", context));
  await button.click();
  assert.equal(exports.length, 1);
  assert.equal(exports[0].rows.length, 15);
  assert.deepEqual(Object.keys(exports[0].rows[0]), ["이름", "과목", "이메일", "연락처", "내부 메모", "계정 연결", "온라인 강좌", "담당 온라인 강좌", "오프라인 반", "담당 오프라인 반"]);
  assert.equal(exports[0].rows[0]["담당 온라인 강좌"], "대수; 기하");
  assert.equal(exports[0].rows[0]["담당 오프라인 반"], "고3 A반");
  assert.equal(exports[0].rows[0].email, undefined);
  assert.equal(exports[0].rows[0].이메일, "private0@example.test");
  assert.equal(exports[0].rows[14].이메일, "");
  assert.equal(JSON.stringify(exports[0].rows).includes("public-should-not-export"), false);
  assert.equal(JSON.stringify(exports[0].rows).includes("public-phone"), false);
});

test("member, course and class exports use all matching loaded rows without private fields", async () => {
  const cases = [
    {
      file: "admin-members.js", id: "dlMembers",
      rows: Array.from({ length: 15 }, (_, index) => ({ name: `회원${index}`, email: "test@example.test", phone: "010", memberPurpose: "general", status: "active", secretId: "hidden" })),
      context: (records, button, exports) => ({
        memberExportPending: false, db: {}, fetchScopedExportRows: async () => [], fetchExportDocuments: async () => new Map(),
        openAdminConfirm: async () => true,
        hasLoadedMembers: true, filteredMembers: records, allMembers: records,
        getMemberPurposeLabel: () => "일반 회원", getSignupSourceLabel: () => "인터넷 검색", formatDate: () => "2026. 10. 19.",
        getConsentStatusLabel: () => "미동의", getMarketingConsentStatusLabel: () => "미동의", getMarketingConsent: () => ({}),
        getFilterValues: () => ({ keyword: "회원", purpose: "", signupSource: "" }),
        window: { toast: { error() {}, success() {} } }, $: () => button, XLSX: {}, console,
        showAdminToast() {},
        adminXlsxFilename: (_, count) => `${count}.xlsx`,
        writeAdminXlsx: async (_, options) => { exports.push(options); return true; },
      }),
      expected: ["회원 유형", "이름", "이메일", "연락처", "가입 경로", "가입일", "상태", "이용약관 동의", "개인정보 동의", "광고성 정보 수신", "활성 온라인 강좌", "활성 자녀 연결"],
    },
    {
      file: "admin-courses.js", id: "dlCourses",
      rows: Array.from({ length: 15 }, (_, index) => ({ title: `강좌${index}`, subject: "수학", grade: "고3", year: "2026", instructorName: "강사", accessType: "public", courseFormat: "single", status: "published", previewVideoUrl: "private-video" })),
      context: (records, button, exports) => ({
        courseExportPending: false, db: {}, fetchScopedExportRows: async () => [], fetchExportDocuments: async () => new Map(),
        openAdminConfirm: async () => { throw new Error("course export must be immediate"); },
        coursesLoaded: true, viewRows: records, rows: records, filters: { search: "강좌", status: "all" },
        getAdminAccessTypeLabel: () => "공개", getAdminCourseFormatLabel: () => "특강", getAdminCourseStatusLabel: () => "게시",
        toast() {}, $: () => button, XLSX: {}, console,
        adminXlsxFilename: (_, count) => `${count}.xlsx`,
        writeAdminXlsx: async (_, options) => { exports.push(options); return true; },
      }),
      expected: ["강좌명", "과목", "학년", "연도", "강사", "수강유형", "형식", "운영 상태", "주차 수", "영상 수", "콘텐츠 집계", "등록일"],
    },
    {
      file: "admin-offline-classes.js", id: "dlOfflineClasses",
      rows: Array.from({ length: 15 }, (_, index) => ({ className: `반${index}`, subject: "수학", room: "101", status: "active", scheduleItems: [{ day: "mon" }], videoUrl: "private-video", id: `private-${index}` })),
      context: (records, button, exports) => ({
        offlineClassExportPending: false, db: {}, fetchScopedExportRows: async () => [], fetchExportDocuments: async () => new Map(),
        openAdminConfirm: async () => true,
        offlineClassesLoaded: true, allClasses: records, getFilteredClasses: () => records,
        formatSchoolGrade: () => "고3", instructorDisplayName: () => "강사", formatScheduleItemLine: () => "월 18:00",
        resolveScheduleGroupLabel: () => "정규", selectedScheduleGroupId: "regular", scheduleGroupsDraft: [],
        appliedOfflineClassKeyword: "반", toast() {}, $: () => button, XLSX: {}, console,
        adminXlsxFilename: (_, count) => `${count}.xlsx`,
        writeAdminXlsx: async (_, options) => { exports.push(options); return true; },
      }),
      expected: ["반명", "그룹", "과목", "학교/학년", "담당 강사", "강의실", "수업 일정", "상태", "활성 입반 학생", "재원 학생명"],
    },
  ];
  for (const item of cases) {
    const button = fakeButton();
    const exports = [];
    button.addEventListener("click", exportClickHandler(item.file, item.id, item.context(item.rows, button, exports)));
    await button.click();
    assert.equal(exports.length, 1, item.id);
    const mainRows = exports[0].rows || exports[0].sheets[0].rows;
    assert.equal(mainRows.length, 15, item.id);
    assert.deepEqual(Object.keys(mainRows[0]), item.expected, item.id);
    assert.equal(JSON.stringify(exports[0]).includes("private-video"), false, item.id);
    assert.equal(JSON.stringify(exports[0]).includes("private-0"), false, item.id);
  }
});

test("export handlers distinguish not loaded, empty and write failure", async () => {
  const cases = [
    { file: "admin-instructors.js", id: "dlInstructors", loaded: "instructorsLoaded", all: "allInstructors", filtered: "getFilteredInstructors" },
    { file: "admin-members.js", id: "dlMembers", loaded: "hasLoadedMembers", all: "allMembers", filtered: "filteredMembers" },
    { file: "admin-courses.js", id: "dlCourses", loaded: "coursesLoaded", all: "rows", filtered: "viewRows" },
    { file: "admin-offline-classes.js", id: "dlOfflineClasses", loaded: "offlineClassesLoaded", all: "allClasses", filtered: "getFilteredClasses" },
    { file: "admin-user-add.js", id: "dlUsers", loaded: "usersLoaded", all: "allUsers", filtered: "filteredUsers" },
    { file: "admin-students.js", id: "dlStudents", loaded: "hasLoadedStudentStatus", all: "allStudents", filtered: "filteredStudents" },
  ];
  for (const item of cases) {
    const messages = [];
    const button = fakeButton();
    const context = {
      [item.loaded]: false,
      [item.all]: [],
      [item.filtered]: item.filtered.startsWith("get") ? () => [] : [],
      $: () => button,
      toast: (message) => messages.push(message),
      window: { toast: { error: (message) => messages.push(message) } },
      studentExportPending: false,
      showAdminToast: (message) => messages.push(message),
      memberExportPending: false, courseExportPending: false, offlineClassExportPending: false,
      console,
    };
    const handler = exportClickHandler(item.file, item.id, context);
    await handler();
    assert.match(messages.pop(), /먼저 불러와 주세요/, item.id);
    context[item.loaded] = true;
    await handler();
    assert.match(messages.pop(), /등록된 .+ 없습니다/, item.id);
    context[item.all] = [{}];
    await handler();
    assert.match(messages.pop(), /(검색 결과|필터 결과|선택 그룹과 필터).+없습니다/, item.id);
  }
  const messages = [];
  const button = fakeButton();
  const record = { name: "회원", email: "member@example.test" };
  const context = {
    memberExportPending: false, db: {}, fetchScopedExportRows: async () => [], fetchExportDocuments: async () => new Map(),
    openAdminConfirm: async () => true,
    hasLoadedMembers: true, allMembers: [record], filteredMembers: [record],
    getMemberPurposeLabel: () => "일반", getSignupSourceLabel: () => "", formatDate: () => "",
    getConsentStatusLabel: () => "", getMarketingConsentStatusLabel: () => "", getMarketingConsent: () => ({}),
    getFilterValues: () => ({ keyword: "", purpose: "", signupSource: "" }),
    adminXlsxFilename: () => "members.xlsx", writeAdminXlsx: async () => { throw new Error("disk full"); },
    window: { toast: { error: (message) => messages.push(message), success() {} } },
    showAdminToast: (message) => messages.push(message),
    $: () => button, XLSX: {}, console: { error() {} },
  };
  await exportClickHandler("admin-members.js", "dlMembers", context)();
  assert.match(messages.pop(), /엑셀 다운로드에 실패/);
});

test("course export counts loaded content and leaves protected content blank without extra reads", async () => {
  const exports = [];
  const records = [
    { title: "공개", accessType: "public", weeks: [{ videos: [{}, {}] }, { videos: [{}] }] },
    { title: "승인형", accessType: "approvalRequired", weeks: [], protectedUrl: "do-not-export" },
  ];
  const context = {
    courseExportPending: false, coursesLoaded: true, viewRows: records, rows: records,
    filters: {}, db: {}, XLSX: {}, console, $: () => fakeButton(), toast() {},
    openAdminConfirm: async () => { throw new Error("no confirmation for loaded courses"); },
    fetchScopedExportRows: async () => { throw new Error("no relationship read"); },
    getAdminAccessTypeLabel: () => "", getAdminCourseFormatLabel: () => "", getAdminCourseStatusLabel: () => "",
    adminXlsxFilename: () => "courses.xlsx",
    writeAdminXlsx: async (_, options) => { exports.push(options); return true; },
  };
  await exportClickHandler("admin-courses.js", "dlCourses", context)();
  assert.equal(exports.length, 1);
  assert.equal(exports[0].rows[0]["주차 수"], 2);
  assert.equal(exports[0].rows[0]["영상 수"], 3);
  assert.equal(exports[0].rows[0]["콘텐츠 집계"], "강좌 문서");
  assert.equal(exports[0].rows[1]["주차 수"], "");
  assert.equal(exports[0].rows[1]["영상 수"], "");
  assert.equal(exports[0].rows[1]["콘텐츠 집계"], "보호 콘텐츠 제외");
  assert.equal(JSON.stringify(exports[0]).includes("미조회"), false);
  assert.equal(JSON.stringify(exports[0]).includes("do-not-export"), false);
});

test("only relationship exports confirm with plain language and cancellation makes no reads", async () => {
  const cases = [
    { file: "admin-students.js", id: "dlStudents", loaded: "hasLoadedStudentStatus", rows: "filteredStudents", all: "allStudents", title: "학생 명단 다운로드", words: "수강 강좌, 오프라인 반, 학부모 정보" },
    { file: "admin-members.js", id: "dlMembers", loaded: "hasLoadedMembers", rows: "filteredMembers", all: "allMembers", title: "회원 명단 다운로드", words: "수강 내역과 학부모 자녀 정보" },
    { file: "admin-offline-classes.js", id: "dlOfflineClasses", loaded: "offlineClassesLoaded", rows: "getFilteredClasses", all: "allClasses", title: "반 명단 다운로드", words: "학생 명단" },
  ];
  for (const item of cases) {
    const prompts = [];
    const records = Array.from({ length: 12 }, (_, index) => ({ uid: `u${index}`, id: `c${index}` }));
    const context = {
      [item.loaded]: true, [item.all]: records,
      [item.rows]: item.rows.startsWith("get") ? () => records : records,
      studentExportPending: false, memberExportPending: false, offlineClassExportPending: false,
      openAdminConfirm: async (options) => { prompts.push(options); return false; },
      fetchScopedExportRows: async () => { throw new Error("read after cancel"); },
      writeAdminXlsx: async () => { throw new Error("write after cancel"); },
      $: () => fakeButton(), toast() {}, showAdminToast() {}, console,
    };
    await exportClickHandler(item.file, item.id, context)();
    assert.equal(prompts.length, 1, item.id);
    assert.equal(prompts[0].title, item.title);
    assert.match(prompts[0].message, /12/);
    assert.ok(prompts[0].message.includes(item.words));
    assert.equal(prompts[0].confirmLabel, "다운로드");
    assert.doesNotMatch(prompts[0].message, /UID|ID 범위|조회는|첫 페이지|최소 \d+회/);
  }
});

test("student export prevents a second click while summary confirmation is pending", async () => {
  const button = fakeButton();
  let release;
  let confirmations = 0;
  const student = { role: "student", uid: "synthetic-1" };
  const context = {
    studentExportPending: false, hasLoadedStudentStatus: true, appliedSearchKeyword: "",
    allStudents: [student], filteredStudents: [student],
    hasStudentSummary: () => false, studentSummaryErrors: new Set(),
    openAdminConfirm: () => { confirmations += 1; return new Promise((resolve) => { release = resolve; }); },
    $: () => button, toast() {}, console,
  };
  const handler = exportClickHandler("admin-students.js", "dlStudents", context);
  const first = handler();
  await handler();
  assert.equal(confirmations, 1);
  release(false);
  await first;
  assert.equal(context.studentExportPending, false);
});

test("account and student exports retain their loaded filtered results across pages", async () => {
  const users = Array.from({ length: 15 }, (_, index) => ({
    uid: `synthetic-${index}`, role: "student", name: `학생${index}`,
    email: "student@example.test", phone: "010", grade: "12", note: "관리 메모",
    authSecret: "never-export",
  }));
  const shared = {
    getConsentStatusLabel: () => "동의", getConsentSourceLabel: () => "가입",
    getMarketingConsentStatusLabel: () => "미동의", getMarketingConsent: () => ({}),
    getSignupSourceLabel: () => "온라인", formatGrade: () => "고3",
    formatCreatedAt: () => "2026. 10. 20.", getUserCreatedAtValue: () => null,
    formatDate: () => "", adminXlsxFilename: (_, count) => `${count}.xlsx`,
    $: () => fakeButton(), XLSX: {}, toast() {}, console,
  };
  const accountExports = [];
  const accountContext = {
    ...shared, usersLoaded: true, filteredUsers: users, allUsers: users,
    appliedUserKeyword: "학생", roleFilterInput: { value: "student" },
    writeAdminXlsx: async (_, options) => { accountExports.push(options); return true; },
  };
  await exportClickHandler("admin-user-add.js", "dlUsers", accountContext)();
  assert.equal(accountExports.length, 1);
  assert.equal(accountExports[0].rows.length, 15);
  assert.match(accountExports[0].filename, /15\.xlsx/);
  assert.equal(JSON.stringify(accountExports[0].rows).includes("synthetic-0"), false);
  assert.equal(JSON.stringify(accountExports[0].rows).includes("never-export"), false);
  accountContext.filteredUsers = [{
    role: "instructor", instructorId: "profile-1", name: "강사",
    email: "public@example.test", note: "public-note", subject: "수학",
  }];
  accountContext.instructorPrivateExportById = new Map([["profile-1", {
    email: "private@example.test", phone: "010-1234-5678", note: "private-note",
  }]]);
  await exportClickHandler("admin-user-add.js", "dlUsers", accountContext)();
  assert.equal(accountExports[1].rows[0].이메일, "private@example.test");
  assert.equal(accountExports[1].rows[0].전화번호, "010-1234-5678");
  assert.equal(accountExports[1].rows[0].비고, "private-note");
  assert.equal(JSON.stringify(accountExports[1].rows).includes("public@example.test"), false);

  const studentExports = [];
  const studentContext = {
    ...shared, studentExportPending: false, hasLoadedStudentStatus: true,
    openAdminConfirm: async () => true,
    db: {}, fetchScopedExportRows: async () => [], fetchExportDocuments: async () => new Map(),
    isActiveEnrollment: () => true,
    filteredStudents: users, allStudents: users, appliedSearchKeyword: "학생",
    hasStudentSummary: () => true, studentSummaryErrors: new Set(),
    courseEnrollmentCounts: {}, offlineClassCounts: {},
    writeAdminXlsx: async (_, options) => { studentExports.push(options); return true; },
  };
  await exportClickHandler("admin-students.js", "dlStudents", studentContext)();
  assert.equal(studentExports.length, 1);
  assert.equal(studentExports[0].sheets[0].rows.length, 15);
  assert.equal(JSON.stringify(studentExports[0].sheets[0].rows).includes("synthetic-0"), false);
  assert.equal(JSON.stringify(studentExports[0].sheets).includes("never-export"), false);
});

test("student relationship sheets keep UID identity, revoked links and missing references", async () => {
  const students = [
    { uid: "s1", role: "student", name: "동명이인" },
    { uid: "s2", role: "student", name: "동명이인" },
  ];
  const relationRows = {
    enrollments: [
      { userId: "s1", courseId: "c1", status: "active" },
      { userId: "s1", courseId: "c2", status: "active" },
      { userId: "s2", courseId: "missing", status: "active" },
    ],
    offlineClassMembers: [
      { studentUid: "s1", classId: "cl1", status: "active" },
      { studentUid: "s1", classId: "cl2", status: "active" },
    ],
    studentParentLinks: [
      { studentUid: "s1", memberUid: "m1", status: "active", relationLabel: "mother" },
      { studentUid: "s1", memberUid: "m2", status: "active", relationLabel: "father" },
      { studentUid: "s2", memberUid: "m1", status: "revoked", relationLabel: "mother" },
    ],
  };
  const exports = [];
  const context = {
    studentExportPending: false, hasLoadedStudentStatus: true, appliedSearchKeyword: "",
    openAdminConfirm: async () => true,
    allStudents: students, filteredStudents: students,
    hasStudentSummary: () => true, studentSummaryErrors: new Set(),
    fetchScopedExportRows: async (_, collectionName) => relationRows[collectionName],
    fetchExportDocuments: async (_, collectionName) => ({
      courses: new Map([["c1", { title: "대수" }], ["c2", { title: "기하" }]]),
      offlineClasses: new Map([["cl1", { className: "고3 A반" }], ["cl2", { className: "고3 B반" }]]),
      members: new Map([["m1", { name: "보호자" }], ["m2", { name: "두번째 보호자", phone: "010-2222-2222" }]]),
    })[collectionName],
    isActiveEnrollment: (row) => row.status === "active",
    getSignupSourceLabel: () => "", getConsentStatusLabel: () => "",
    getConsentSourceLabel: () => "", getMarketingConsentStatusLabel: () => "",
    getMarketingConsent: () => ({}), formatGrade: () => "", formatDate: () => "",
    $: () => fakeButton(), db: {}, XLSX: {}, toast() {}, console,
    adminXlsxFilename: () => "synthetic.xlsx",
    writeAdminXlsx: async (_, options) => { exports.push(options); return true; },
  };
  await exportClickHandler("admin-students.js", "dlStudents", context)();
  assert.equal(exports.length, 1);
  const sheets = exports[0].sheets;
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.map((sheet) => sheet.name))), ["학생목록", "온라인수강", "오프라인입반", "학부모연결"]);
  assert.deepEqual(JSON.parse(JSON.stringify(sheets[0].rows.map((row) => row.온라인강좌수))), [2, 1]);
  assert.equal(sheets[0].rows[0].오프라인반수, 2);
  assert.equal(sheets[1].rows[2].강좌명, "확인 불가");
  assert.deepEqual(JSON.parse(JSON.stringify(sheets[3].rows.map((row) => [row.학생UID, row.회원UID, row.상태]))), [["s1", "m1", "active"], ["s1", "m2", "active"], ["s2", "m1", "revoked"]]);
  assert.equal(sheets[3].rows[1].학부모연락처, "010-2222-2222");
});

test("member export retains multiple children and class export retains multiple assignments", async () => {
  const memberExports = [];
  const memberContext = {
    memberExportPending: false, hasLoadedMembers: true, db: {},
    openAdminConfirm: async () => true,
    filteredMembers: [{ uid: "m1", name: "보호자", memberPurpose: "parent" }],
    allMembers: [{ uid: "m1" }],
    fetchScopedExportRows: async (_, name, field, ids) => {
      if (name === "studentParentLinks") return [
        { memberUid: "m1", studentUid: "s1", status: "active", relationLabel: "mother" },
        { memberUid: "m1", studentUid: "s2", status: "active", relationLabel: "mother" },
      ];
      if (name === "enrollments" && field === "userId" && ids.includes("s1")) return [{ userId: "s1", courseId: "c1", status: "active" }];
      if (name === "offlineClassMembers") return [{ studentUid: "s2", classId: "cl1", status: "active" }];
      return [];
    },
    fetchExportDocuments: async (_, name) => ({
      students: new Map([
        ["s1", { name: "동명이인", school: "가학교", grade: "4", phone: "010-1111-1111" }],
        ["s2", { name: "동명이인", school: "나학교", grade: "5", phone: "010-2222-2222" }],
      ]),
      courses: new Map([["c1", { title: "대수" }]]),
      offlineClasses: new Map([["cl1", { className: "B반" }]]),
    })[name],
    getMemberPurposeLabel: () => "학부모", getSignupSourceLabel: () => "",
    getConsentStatusLabel: () => "", getMarketingConsentStatusLabel: () => "",
    getMarketingConsent: () => ({}), getFilterValues: () => ({}),
    GRADE_LABELS: { 4: "고1", 5: "고2" }, ATTEMPT_RELATION_LABELS: { mother: "모" },
    formatDate: () => "", adminXlsxFilename: () => "member.xlsx",
    window: { toast: { error() {}, success() {} } }, $: () => fakeButton(),
    showAdminToast() {},
    XLSX: {}, console, writeAdminXlsx: async (_, options) => { memberExports.push(options); return true; },
  };
  await exportClickHandler("admin-members.js", "dlMembers", memberContext)();
  assert.equal(memberExports[0].sheets[0].rows[0]["활성 자녀 연결"], 2);
  assert.deepEqual(JSON.parse(JSON.stringify(memberExports[0].sheets[2].rows.map((row) => [row.학생UID, row.학교]))), [["s1", "가학교"], ["s2", "나학교"]]);
  assert.equal(memberExports[0].sheets[2].rows[0].학생연락처, "010-1111-1111");
  assert.equal(memberExports[0].sheets[3].rows[0].강좌명, "대수");
  assert.equal(memberExports[0].sheets[4].rows[0].반명, "B반");

  const classExports = [];
  const classes = [
    { id: "cl1", className: "A반", groupId: "regular", status: "active" },
    { id: "cl2", className: "B반", groupId: "regular", status: "active" },
  ];
  const classContext = {
    offlineClassExportPending: false, offlineClassesLoaded: true,
    openAdminConfirm: async () => true,
    allClasses: classes, getFilteredClasses: () => classes, db: {},
    fetchScopedExportRows: async () => [
      { classId: "cl1", studentUid: "s1", status: "active" },
      { classId: "cl2", studentUid: "s1", status: "active" },
      { classId: "cl1", studentUid: "s2", status: "active", studentNameSnapshot: "이전 학생", schoolSnapshot: "가학교", gradeSnapshot: "4", phoneSnapshot: "010-2222-2222" },
      { classId: "cl1", studentUid: "s1", status: "active" },
      { classId: "cl1", studentUid: "s3", status: "active" },
      { classId: "cl1", studentUid: "s4", status: "revoked" },
      { classId: "cl1", studentUid: "s5", status: "active" },
    ],
    fetchExportDocuments: async () => new Map([
      ["s1", { name: "학생", phone: "010-0000-0000" }],
      ["s3", { name: "학생", phone: "010-3333-3333" }],
      ["s4", { name: "해제 학생" }],
    ]),
    resolveScheduleGroupLabel: () => "정규", selectedScheduleGroupId: "regular", scheduleGroupsDraft: [],
    formatSchoolGrade: () => "", instructorDisplayName: () => "", formatScheduleItemLine: () => "",
    formatTimestamp: () => "-",
    formatGrade: () => "", appliedOfflineClassKeyword: "", toast() {},
    $: () => fakeButton(), XLSX: {}, console, adminXlsxFilename: () => "classes.xlsx",
    writeAdminXlsx: async (_, options) => { classExports.push(options); return true; },
  };
  await exportClickHandler("admin-offline-classes.js", "dlOfflineClasses", classContext)();
  assert.deepEqual(JSON.parse(JSON.stringify(classExports[0].sheets[1].rows.map((row) => row.반UID))), ["cl1", "cl2", "cl1", "cl1", "cl1", "cl1", "cl1"]);
  assert.equal(classExports[0].sheets[1].rows[0].연락처, "010-0000-0000");
  assert.equal(classExports[0].sheets[0].rows[0]["활성 입반 학생"], 4);
  assert.equal(classExports[0].sheets[0].rows[0]["재원 학생명"], "학생, 학생");
  assert.equal(classExports[0].sheets[0].rows[1]["재원 학생명"], "학생");
  assert.equal(classExports[0].sheets[1].rows[2].학생명, "이전 학생");
  assert.equal(classExports[0].sheets[1].rows[2].연락처, "010-2222-2222");
  assert.equal(classExports[0].sheets[1].rows[2].학생정보출처, "배정 시 스냅샷");
});

test("scoped relation reads page by 200 and fail before a partial export above the cap", async () => {
  const code = fs.readFileSync(path.join(root, "assets/js/utils/admin-export-scope.js"), "utf8");
  const start = code.indexOf("export async function fetchScopedExportRows");
  const end = code.indexOf("export async function fetchExportDocuments", start);
  assert.ok(start >= 0 && end > start);
  let calls = 0;
  const context = {
    uniqueExportIds: (ids) => [...new Set(ids)],
    collection: () => ({}), where: () => ({}), limit: (count) => { assert.equal(count, 200); return {}; },
    startAfter: () => ({}), query: () => ({}),
    getDocs: async () => {
      calls += 1;
      const size = calls <= 25 ? 200 : 1;
      return { size, docs: Array.from({ length: size }, (_, index) => ({
        id: `${calls}-${index}`, data: () => ({ userId: "s1" }),
      })) };
    },
  };
  const fetchRows = vm.runInNewContext(`(() => {
    const CHUNK_SIZE = 10, PAGE_SIZE = 200, MAX_RELATION_ROWS = 5000;
    ${code.slice(start, end).replace("export async function", "async function")}
    return fetchScopedExportRows;
  })()`, context);
  await assert.rejects(fetchRows({}, "enrollments", "userId", ["s1"]), /5,000|5000/);
  assert.equal(calls, 26);
  context.getDocs = async () => { throw new Error("permission-denied"); };
  await assert.rejects(fetchRows({}, "enrollments", "userId", ["s1"]), /permission-denied/);
});
