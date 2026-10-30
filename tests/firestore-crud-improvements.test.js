const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.join(__dirname, "..");
const readSource = (relativePath) =>
  fs.readFileSync(path.join(rootDir, relativePath), "utf8");

async function importStandaloneBrowserModule(relativePath) {
  const source = readSource(relativePath);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("administrator student pagination and summary reads keep their contracts", () => {
  const source = readSource("assets/js/pages/admin-students.js");
  assert.match(source, /buildUidConstraint\("userId", uids\)/);
  assert.match(source, /buildUidConstraint\("studentUid", uids\)/);
  assert.match(source, /where\(field, "in", uids\)/);
  assert.match(source, /loadStudentSummaries\(studentsToShow\)/);
  assert.doesNotMatch(source, /loadStudentSummaries\(allStudents\)/);
  assert.match(source, /loadSummaries: false/);
  assert.match(source, /studentSummaryErrors\.has\(user\.uid\)/);
  assert.doesNotMatch(source, /loadVisibleStudentSummaries/);
  assert.doesNotMatch(
    source,
    /window\.goToPage[\s\S]*?currentPage = page;\s*applyFilters\(\);/
  );
});

test("footer CMS uses a bounded public session cache and keeps fallback", () => {
  const settingsSource = readSource("assets/js/utils/settings-cache.js");
  const commonSource = readSource("assets/js/common.js");
  assert.match(settingsSource, /PUBLIC_SESSION_CACHE_KEYS = new Set\(\["footer"\]\)/);
  assert.match(settingsSource, /SESSION_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(settingsSource, /writeSessionCachedSetting\(key, result\)/);
  assert.match(commonSource, /getPublicSettingDoc\("footer"\)/);
  assert.match(commonSource, /console\.warn\("\[footer\] 설정을 불러오지 못했습니다\."/);
});

test("small UI corrections use the established display contracts", () => {
  const scheduleSource = readSource("assets/js/pages/schedule.js");
  const ddaySource = readSource("assets/js/utils/dday.js");
  assert.doesNotMatch(scheduleSource, /details\.open = true/);
  assert.match(ddaySource, /if \(days > 0\) return `D-\$\{days\}`/);
  assert.doesNotMatch(ddaySource, /if \(days > 0\) return `D-Day \$\{days\}`/);
});

test("member child linking avoids full student scans and keeps scoped diagnostics", () => {
  const functionsSource = readSource("functions/index.js");
  const dashboardSource = readSource("assets/js/pages/member-dashboard.js");
  assert.match(
    functionsSource,
    /const studentsRef = db\.collection\("students"\)/
  );
  assert.match(functionsSource, /\.where\("name", "==", input\.studentName\)/);
  assert.match(functionsSource, /getStudentNameFallbackPrefixes\(input\.studentName\)/);
  assert.match(functionsSource, /\.limit\(LEGACY_STUDENT_NAME_FALLBACK_LIMIT\)/);
  assert.doesNotMatch(functionsSource, /db\.collection\("students"\)\.get\(\)/);
  assert.match(functionsSource, /mismatchFields/);
  assert.match(functionsSource, /submittedInput/);
  assert.match(functionsSource, /studentPhone: normalizePhoneDigits/);
  assert.match(functionsSource, /result: "notFound"[\s\S]*?submittedInput/);
  assert.match(functionsSource, /result: "ambiguous"[\s\S]*?submittedInput/);
  const successAttemptBlock = functionsSource.match(
    /const result = alreadyLinked \? "alreadyLinked" : "linked";[\s\S]*?await recordMemberChildLinkAttempt\(\{[\s\S]*?\n\s{4}\}\);/
  )?.[0] || "";
  assert.match(successAttemptBlock, /result,[\s\S]*?matchCount: 1/);
  assert.match(successAttemptBlock, /submittedInput/);
  const rateLimitedBlock = functionsSource.match(
    /if \(!rateLimit\.allowed\) \{[\s\S]*?\n\s{4}\}/
  )?.[0] || "";
  assert.match(rateLimitedBlock, /result: "rateLimited"/);
  assert.match(rateLimitedBlock, /retryAfterSeconds/);
  assert.doesNotMatch(rateLimitedBlock, /recordMemberChildLinkAttempt/);
  assert.ok(
    functionsSource.indexOf("await enforceMemberChildLinkRateLimit(memberUid)") <
      functionsSource.indexOf("if (!member) {")
  );
  assert.match(functionsSource, /\^\[1-7\]\$/);
  assert.match(dashboardSource, /7: "졸업\/N수"/);
  assert.match(dashboardSource, /onlineSummaryUnavailable/);
  assert.match(dashboardSource, /getChildLinkCallableErrorMessage/);
  assert.match(functionsSource, /transaction\.get\([\s\S]*?studentParentLinks/);
  assert.match(functionsSource, /linkedChildrenCount,[\s\S]*?updatedAt: now/);
  assert.doesNotMatch(functionsSource, /recomputeMemberLinkedChildrenCount/);
});

test("active student writers trim names used by exact-name matching", () => {
  const signupFirestoreSource = readSource("assets/js/features/signup/firestore.js");
  const adminAddSource = readSource("assets/js/pages/admin-user-add.js");
  const adminStudentsSource = readSource("assets/js/pages/admin-students.js");
  const studentProfileSource = readSource("assets/js/utils/student-profile.js");
  assert.match(signupFirestoreSource, /name: String\(data\.name \|\| ""\)\.trim\(\)/);
  assert.match(adminAddSource, /const finalName = normalizeText\(userData\.name\)/);
  assert.match(adminStudentsSource, /const newName = nameInput\.value\.trim\(\)/);
  assert.match(studentProfileSource, /const name = String\(profile\.name \|\| ""\)\.trim\(\)/);
});

test("administrator student edits atomically synchronize offline class snapshots", () => {
  const source = readSource("assets/js/pages/admin-students.js");
  assert.match(source, /where\("studentUid", "==", uid\)/);
  assert.match(source, /studentNameSnapshot: String\(name \|\| ""\)\.trim\(\)/);
  assert.match(source, /schoolSnapshot: String\(school \|\| ""\)\.trim\(\)/);
  assert.match(source, /gradeSnapshot: normalizeGrade\(grade\)/);
  assert.match(source, /phoneSnapshot: String\(phone \|\| ""\)\.trim\(\)/);
  assert.match(source, /const batch = writeBatch\(db\)/);
  assert.match(source, /batch\.set\(doc\(db, "students", uid\), studentPayload, \{merge: true\}\)/);
  assert.match(source, /batch\.update\(memberDoc\.ref, \{\.\.\.snapshots, updatedAt\}\)/);
  assert.match(source, /await batch\.commit\(\)/);
});

test("offline class UI formats grade codes and supports multi-term student search", () => {
  const source = readSource("assets/js/pages/admin-offline-classes.js");
  const html = readSource("members/admin/offline-classes.html");
  assert.match(source, /import \{ formatGrade \} from "\/assets\/js\/utils\/grade\.js"/);
  assert.match(source, /function formatOfflineGrade\(value\)/);
  assert.match(source, /formatOfflineGrade\(m\.gradeSnapshot\)/);
  assert.match(source, /formatOfflineGrade\(member\.gradeSnapshot\)/);
  assert.match(source, /\.split\(\/\\s\+\/\)/);
  assert.match(source, /function getStudentPhoneLastFour\(phone\)/);
  assert.match(source, /if \(\/\^\\d\{4\}\$\/\.test\(token\)\)/);
  assert.match(source, /getStudentPhoneLastFour\(student\.phone\) === token/);
  assert.match(source, /function getStudentGradeLevel\(grade\)/);
  assert.match(source, /formatOfflineGrade\(grade\)\.match\(\/\^\[중고\]\(\[1-3\]\)\$\/\)/);
  assert.match(source, /if \(\/\^\[1-3\]\$\/\.test\(token\)\)/);
  assert.match(source, /return gradeLevel === token/);
  assert.match(source, /if \(\/\^\[중고\]\[1-3\]\$\/\.test\(token\)\)/);
  assert.match(source, /const compactSchoolGrade = token\.match\(\/\^\(\.\{2,\}\)\(\[1-3\]\)\$\/\)/);
  assert.match(source, /textFields\.some\(\(value\) => value\.includes\(compactSchoolGrade\[1\]\)\)/);
  assert.match(source, /tokens\.every\(\(token\) => matchesStudentSearchToken\(student, token\)\)/);
  assert.doesNotMatch(source, /\[s\.name, s\.school, s\.grade, formatOfflineGrade\(s\.grade\), s\.phone\]/);
  assert.match(html, /placeholder="이름, 학교, 학년, 전화번호 뒤 4자리 검색"/);
});

test("signup attempts do not accept client IP or user-agent telemetry", () => {
  const functionsSource = readSource("functions/index.js");
  const signupSource = readSource("assets/js/pages/signup-step2.js");
  assert.match(functionsSource, /const requestIp = resolveRequestIp\(context\);/);
  assert.equal(functionsSource.match(/ip: requestIp,/g)?.length, 1);
  assert.doesNotMatch(functionsSource, /data\?\.ip/);
  assert.doesNotMatch(functionsSource, /resolveUserAgent/);
  assert.doesNotMatch(signupSource, /userAgent:/);
});

test("production Firebase Functions exports stay limited to the four approved functions", () => {
  const functionsSource = readSource("functions/index.js");
  const exportedNames = Array.from(
    functionsSource.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g),
    (match) => match[1]
  ).sort();
  assert.deepEqual(exportedNames, [
    "linkMemberChild",
    "scheduledRecordCleanup",
    "sendVerificationCode",
    "verifyEmailCode",
  ]);
});

test("primary searchable lists commit searches and offer 10, 20, or 50 rows", () => {
  const screens = [
    ["assets/js/pages/admin-students.js", "members/admin/users/students.html", "studentsPageSize"],
    ["assets/js/pages/admin-members.js", "members/admin/users/members.html", "membersPageSize"],
    ["assets/js/pages/admin-instructors.js", "members/admin/users/instructors.html", "instructorsPageSize"],
    ["assets/js/pages/admin-user-add.js", "members/admin/users/add.html", "accountsPageSize"],
    ["assets/js/pages/admin-courses.js", "members/admin/courses.html", "adminCoursesPageSize"],
    ["assets/js/pages/admin-offline-classes.js", "members/admin/offline-classes.html", "offlineClassesPageSize"],
    ["assets/js/pages/courses.js", "courses.html", "coursePageSize"],
  ];

  screens.forEach(([sourcePath, htmlPath, pageSizeId]) => {
    const source = readSource(sourcePath);
    const html = readSource(htmlPath);
    assert.match(source, /bindCommittedSearch\(/, sourcePath);
    assert.match(source, /normalizeListPageSize\(/, sourcePath);
    assert.match(html, new RegExp(`id=["']${pageSizeId}["']`), htmlPath);
    [10, 20, 50].forEach((size) => {
      assert.match(html, new RegExp(`<option value=["']${size}["']`), `${htmlPath}: ${size}`);
    });
    assert.match(html, /admin-toolbar--primary-list/, htmlPath);
    assert.doesNotMatch(html, /<span>보기<\/span>/, htmlPath);
  });

  const controls = readSource("assets/js/utils/list-controls.js");
  assert.match(controls, /event\.key !== "Enter"/);
  assert.doesNotMatch(controls, /addEventListener\("input"/);
  assert.match(controls, /container\.hidden = !hasMultiplePages/);
  assert.doesNotMatch(controls, /admin-list-pagination__info|\/ 전체/);
});

test("offline class counts are visible-page cached instead of full-list N+1", () => {
  const source = readSource("assets/js/pages/admin-offline-classes.js");
  assert.match(source, /loadOfflineClassCounts\(pageRows\)/);
  assert.match(source, /!offlineClassCounts\.has\(row\.id\)/);
  assert.doesNotMatch(source, /loadOfflineClassCounts\(allClasses\)/);
  assert.match(source, /renderTable\(\{ loadCounts: false \}\)/);
});

test("important signup and child-link requests unlock after success, failure, or timeout", () => {
  const timeoutSource = readSource("assets/js/utils/async-timeout.js");
  const signupSource = readSource("assets/js/pages/signup-step2.js");
  const verificationUiSource = readSource("assets/js/features/signup/verification-ui.js");
  const dashboardSource = readSource("assets/js/pages/member-dashboard.js");

  assert.match(timeoutSource, /code = "client\/deadline-exceeded"/);
  assert.match(timeoutSource, /Promise\.race/);
  assert.match(signupSource, /인증번호를 발송하고 있습니다\.\.\./);
  assert.match(signupSource, /withAsyncTimeout\([\s\S]*?sendVerificationCodeFn/);
  assert.match(signupSource, /finally \{[\s\S]*?setVerificationSending\(false\)/);
  assert.match(signupSource, /sendResult\?\.data\?\.verificationSessionToken/);
  assert.match(signupSource, /verificationSessionToken: signupState\.verification\.sessionToken/);
  assert.match(verificationUiSource, /shouldLockCodeInput = isSending \|\| isVerifying/);

  assert.match(dashboardSource, /if \(isChildLinkInFlight\) return/);
  assert.match(dashboardSource, /학생 정보를 확인하고 연동하고 있습니다\.\.\./);
  assert.match(dashboardSource, /withAsyncTimeout\(linkMemberChildFn\(payload\)\)/);
  assert.match(dashboardSource, /finally \{[\s\S]*?setChildLinkFormPending\(form, submitButton, false\)/);
});

test("important-request timeout helper clears successful requests and releases hung ones", async () => {
  const source = readSource("assets/js/utils/async-timeout.js");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const { withAsyncTimeout } = await import(moduleUrl);

  assert.equal(await withAsyncTimeout(Promise.resolve("done"), 25), "done");
  await assert.rejects(
    withAsyncTimeout(new Promise(() => {}), 5),
    (error) => error?.code === "client/deadline-exceeded"
  );
});

test("list viewports stay stable without stretching sparse pages", () => {
  const adminCss = readSource("assets/css/pages/admin.css");
  const coursesCss = readSource("assets/css/pages/courses-all.css");
  assert.match(adminCss, /\.admin-list-viewport\s*\{[\s\S]*?height:\s*clamp/);
  assert.match(adminCss, /\.admin-list-viewport\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(adminCss, /\.admin-list-viewport \.admin-table\s*\{[\s\S]*?height:\s*auto/);
  assert.match(adminCss, /\.admin-list-viewport[\s\S]*?thead th[\s\S]*?position:\s*sticky/);
  assert.match(coursesCss, /#contentGrid\.course-grid\s*\{[\s\S]*?align-content:\s*start/);
  assert.match(coursesCss, /#contentGrid\.course-grid\s*\{[\s\S]*?align-items:\s*start/);
  assert.match(coursesCss, /grid-auto-rows:\s*max-content/);
  assert.match(coursesCss, /#contentGrid\.course-grid\s*\{[\s\S]*?min-height:/);
});

test("list counts and range summaries are removed while empty states remain", () => {
  const controls = readSource("assets/js/utils/list-controls.js");
  const adminMembers = readSource("assets/js/pages/admin-members.js");
  const adminCourses = readSource("assets/js/pages/admin-courses.js");
  const adminOffline = readSource("assets/js/pages/admin-offline-classes.js");
  const publicCourses = readSource("assets/js/pages/courses.js");

  assert.doesNotMatch(controls, /rangeStart.*\/ 전체|admin-list-pagination__info/);
  assert.doesNotMatch(adminMembers, /전체 .*?\/ 표시/);
  assert.doesNotMatch(adminCourses, /개 표시 \/ 전체|페이지 \$\{/);
  assert.doesNotMatch(adminOffline, /전체 \$\{allClasses\.length\}개 \/ 조건 일치/);
  assert.doesNotMatch(publicCourses, /rangeText|TEXT_RESULT_FOUND|window\.scrollTo/);

  [adminMembers, adminCourses, adminOffline].forEach((source) => {
    assert.match(source, /조건에 맞는|등록된|해당 조건/);
  });
  assert.match(publicCourses, /TEXT_RESULT_NOT_FOUND/);
  assert.match(publicCourses, /TEXT_EMPTY/);
});

test("pagination keeps browser scroll position and uses one shared button design", () => {
  const directPaginationSources = [
    "assets/js/pages/admin-courses.js",
    "assets/js/pages/courses.js",
    "assets/js/pages/instructor-dashboard/courses.js",
    "assets/js/pages/instructor-dashboard/enrollments.js",
    "assets/js/pages/instructor-dashboard/offline-classes.js",
    "assets/js/pages/instructor-dashboard/offline-enrollments.js",
    "assets/js/pages/instructor-course-detail.js",
    "assets/js/pages/instructor-offline-class.js",
  ];
  directPaginationSources.forEach((sourcePath) => {
    const source = readSource(sourcePath);
    assert.doesNotMatch(source, /scrollIntoView|window\.scrollTo/, sourcePath);
  });

  [
    "assets/js/pages/admin-students.js",
    "assets/js/pages/admin-instructors.js",
    "assets/js/pages/admin-user-add.js",
  ].forEach((sourcePath) => {
    const source = readSource(sourcePath);
    const goToPage = source.match(/window\.goToPage\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[\s\S]*?\n\};/)?.[0] || "";
    assert.ok(goToPage, `${sourcePath}: goToPage`);
    assert.doesNotMatch(goToPage, /scrollIntoView|window\.scrollTo/, sourcePath);
  });

  const controls = readSource("assets/js/utils/list-controls.js");
  const paginationCss = readSource("assets/css/components/pagination.css");
  const publicCourses = readSource("assets/js/pages/courses.js");
  const instructorContext = readSource("assets/js/pages/instructor-dashboard/context.js");
  assert.match(publicCourses, /renderListPagination\(pagination/);
  assert.match(instructorContext, /renderCommonListPagination\(containerEl/);
  assert.match(paginationCss, /\.admin-list-pagination__controls \.btn\s*\{[\s\S]*?height:\s*36px/);
  assert.match(paginationCss, /width:\s*36px/);
  assert.match(paginationCss, /border-radius:\s*8px/);
  assert.match(paginationCss, /font-size:\s*13px/);
  assert.doesNotMatch(controls, /scrollIntoView|window\.scrollTo/);
});

test("administrator course filters fit one desktop row and offline table scrolls only on narrow screens", () => {
  const coursesCss = readSource("assets/css/pages/admin-courses.css");
  const offlineCss = readSource("assets/css/pages/admin-offline-classes.css");
  assert.match(
    coursesCss,
    /\.admin-courses-page \.admin-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(200px, 1fr\)[^;]*auto auto auto;/
  );
  assert.match(offlineCss, /#tblOfflineClasses\s*\{\s*min-width:\s*0;/);
  assert.match(
    offlineCss,
    /@media \(max-width:\s*768px\)[\s\S]*?#tblOfflineClasses\s*\{[\s\S]*?min-width:\s*1040px/
  );
});

test("dashboard list summaries are removed without count-only Firestore queries", () => {
  const files = [
    "assets/js/pages/student-dashboard/courses.js",
    "assets/js/pages/student-dashboard/offline-classes.js",
    "assets/js/pages/member-dashboard.js",
    "assets/js/pages/instructor-dashboard/enrollments.js",
    "assets/js/pages/instructor-dashboard/offline-classes.js",
    "assets/js/pages/instructor-dashboard/offline-enrollments.js",
  ];
  const sources = files.map(readSource);
  sources.forEach((source, index) => {
    assert.doesNotMatch(source, /getCountFromServer/, files[index]);
  });

  assert.doesNotMatch(sources[0], /setMyCoursesMeta|\/ 전체/);
  assert.doesNotMatch(sources[1], /setOfflineMeta|배정된 오프라인 반 \$\{rows\.length\}개/);
  assert.doesNotMatch(sources[2], /setMemberCoursesMeta|수강 중인 강좌 \$\{courseRows\.length\}개/);
  assert.doesNotMatch(sources[3], /수강 기록 \$\{|고유 수강생 \$\{/);
  assert.doesNotMatch(sources[4], /setOfflineMeta|담당 오프라인 반 \$\{total\}개/);
  assert.doesNotMatch(sources[5], /배정 기록 \$\{|고유 수강생 \$\{/);

  const studentHtml = readSource("members/students/dashboard.html");
  const memberHtml = readSource("members/member/dashboard.html");
  const instructorHtml = readSource("members/instructors/dashboard.html");
  assert.doesNotMatch(studentHtml, /myCoursesMeta|myOfflineClassesMeta/);
  assert.doesNotMatch(memberHtml, /memberCoursesMeta/);
  assert.doesNotMatch(instructorHtml, /offlineClassesMeta/);
});

test("dashboard initialization reuses student and instructor profile reads", () => {
  const studentEntry = readSource("assets/js/pages/student-dashboard.js");
  const studentSettings = readSource("assets/js/pages/student-dashboard/settings.js");
  const instructorSettings = readSource("assets/js/pages/instructor-dashboard/settings.js");

  assert.match(studentEntry, /const studentProfile = await updateGradeIfNeeded\(\)/);
  assert.match(studentEntry, /setWelcomeMessage\(studentProfile\)/);
  assert.match(studentSettings, /studentProfile !== undefined/);
  assert.match(instructorSettings, /const instructorAccountReads = new Map\(\)/);
  assert.match(instructorSettings, /instructorAccountReads\.set\(key, getDoc/);
  assert.ok((instructorSettings.match(/loadInstructorAccount\(/g) || []).length >= 3);
});

test("student automatic grade promotion is atomic and limited to once per year", async () => {
  const { getAutomaticGradePromotion } = await importStandaloneBrowserModule("assets/js/utils/grade.js");
  const settings = readSource("assets/js/pages/student-dashboard/settings.js");
  const dashboard = readSource("assets/js/pages/student-dashboard.js");
  const profile = readSource("assets/js/pages/student-dashboard/profile.js");
  const studentProfile = readSource("assets/js/utils/student-profile.js");
  const adminStudents = readSource("assets/js/pages/admin-students.js");
  const rules = readSource("firestore.rules");

  assert.deepEqual(
    getAutomaticGradePromotion({ grade: "5", createdYear: 2025, currentYear: 2026 }),
    { shouldPromote: false, shouldInitialize: true, grade: "5", promotionYear: 2026 }
  );
  assert.deepEqual(
    getAutomaticGradePromotion({ grade: "5", createdYear: 2025, lastPromotionYear: 2025, currentYear: 2026 }),
    { shouldPromote: true, grade: "6", promotionYear: 2026 }
  );
  assert.deepEqual(
    getAutomaticGradePromotion({ grade: "5", createdYear: 2026, currentYear: 2026 }),
    { shouldPromote: false, shouldInitialize: true, grade: "5", promotionYear: 2026 }
  );
  assert.deepEqual(
    getAutomaticGradePromotion({ grade: "5", currentYear: 2026 }),
    { shouldPromote: false, shouldInitialize: true, grade: "5", promotionYear: 2026 }
  );
  assert.deepEqual(
    getAutomaticGradePromotion({ grade: "5", createdYear: 2025, lastPromotionYear: 2026, currentYear: 2026 }),
    { shouldPromote: false, grade: "5" }
  );
  assert.deepEqual(
    getAutomaticGradePromotion({ grade: "7", createdYear: 2025, currentYear: 2026 }),
    { shouldPromote: false, grade: "7" }
  );

  assert.match(settings, /runTransaction\(db, async \(transaction\) =>/);
  assert.match(settings, /transaction\.get\(studentRef\)/);
  assert.match(settings, /if \(!promotion\.shouldPromote && !promotion\.shouldInitialize\) return profile/);
  assert.match(settings, /lastAutoPromotionYear: promotion\.promotionYear/);
  assert.match(settings, /if \(promotion\.shouldPromote\) updateData\.grade = promotion\.grade/);
  assert.doesNotMatch(settings, /if \(studentData\.gradeManualOverride === true\) return profile/);
  assert.match(settings, /if \(studentData\.gradeManualOverride === true\) updateData\.gradeManualOverride = false/);
  assert.doesNotMatch(settings, /updateDoc\(/);
  assert.match(profile, /const gradeChanged = grade !== loadedProfileGrade/);
  assert.match(profile, /gradeManualOverride: false,[\s\S]*?lastAutoPromotionYear: new Date\(\)\.getFullYear\(\)/);
  assert.match(studentProfile, /typeof profile\.gradeManualOverride === "boolean"/);
  assert.match(studentProfile, /Number\.isInteger\(profile\.lastAutoPromotionYear\)/);
  assert.match(adminStudents, /const gradeChanged = normalizeGrade\(currentEditUser\.grade\) !== newGrade/);
  assert.match(adminStudents, /gradeManualOverride: false,[\s\S]*?lastAutoPromotionYear: new Date\(\)\.getFullYear\(\)/);
  assert.match(dashboard, /profile\.js\?v=20260913-grade-tracking/);
  assert.match(dashboard, /settings\.js\?v=20260913-grade-tracking/);
  assert.match(profile, /student-profile\.js\?v=20260913-grade-tracking/);
  assert.match(settings, /grade\.js\?v=20260913-grade-tracking/);
  assert.match(rules, /onlyAllowedFieldsChanged\(\[[^\]]*'lastAutoPromotionYear'/);
  assert.match(rules, /request\.resource\.data\.lastAutoPromotionYear is int/);
});

test("student and member cleanup preserve relationship consistency and refresh targets before deletion", () => {
  const source = readSource("assets/js/pages/admin-user-add.js");
  const studentLoadBlock = source.slice(
    source.indexOf("async function loadStudentCleanupData"),
    source.indexOf("async function deleteRefsInBatches")
  );
  const studentDeleteBlock = source.slice(
    source.indexOf("async function deleteUserFirestoreData"),
    source.indexOf("function sanitizeInstructorVideos")
  );
  const memberExecuteBlock = source.slice(
    source.indexOf("async function executeActiveMemberCleanup"),
    source.indexOf("function ensureInstructorCleanupModal")
  );

  assert.match(studentLoadBlock, /where\("studentUid", "==", uid\)/);
  assert.match(studentLoadBlock, /getRefsByField\("memberChildLinkAttempts", "matchedStudentUid", uid\)/);
  assert.match(studentLoadBlock, /getAccountTransientCleanupRefs/);
  assert.match(studentDeleteBlock, /cleanupData\.blockingParentLinks\.length > 0/);
  assert.match(studentDeleteBlock, /"active-parent-link"/);
  assert.match(studentDeleteBlock, /\.\.\.cleanupData\.parentLinkRefs/);
  assert.match(studentDeleteBlock, /\.\.\.cleanupData\.transientRefs\.signupAttempts/);
  assert.match(
    studentDeleteBlock,
    /\.\.\.cleanupData\.transientRefs\.emailVerifications,\s*cleanupData\.studentRef/
  );
  assert.match(
    memberExecuteBlock,
    /const cleanupData = await loadMemberCleanupData\(\s*activeMemberCleanupPreview\.uid,\s*activeMemberCleanupPreview\.profile\s*\)/
  );
  assert.match(
    memberExecuteBlock,
    /\.\.\.cleanupData\.refs\.emailVerifications,\s*cleanupData\.refs\.member/
  );
  assert.doesNotMatch(memberExecuteBlock, /activeMemberCleanupPreview\.refs/);
  assert.match(source, /if \(error\?\.isOperatorSafe === true && error\?\.message\)/);
});

test("signup attempts keep Auto IDs and the local one-day minimal writer", () => {
  const functionsSource = readSource("functions/index.js");
  const policySource = readSource("functions/signup-rate-limit-policy.js");
  assert.match(functionsSource, /transaction\.create\(\s*db\.collection\("signupAttempts"\)\.doc\(\),\s*acceptedAttempt\s*\)/);
  assert.match(functionsSource, /readQuery: \(query\) => transaction\.get\(query\)/);
  assert.match(functionsSource, /return \{\s*email: normalizedEmail,\s*ip: normalizedIp,\s*timestamp: now,\s*cleanupAt:[^;]*?SIGNUP_RATE_LIMIT_POLICY\.attemptRetentionMs/);
  assert.doesNotMatch(functionsSource, /signupAttemptsRef\.doc\([^)]*(timestamp|Date\.now)/);
  assert.doesNotMatch(functionsSource, /collection\("signupAttempts"\)\.doc\([^)]+\)/);
  assert.doesNotMatch(functionsSource, /signupAttemptsRef\.add\(/);
  assert.doesNotMatch(functionsSource, /userAgent:/);
  assert.match(policySource, /attemptRetentionMs:\s*DAY_MS/);
});

test("member child summaries and member-scoped records stay lazy and bounded", () => {
  const source = readSource("assets/js/pages/admin-members.js");
  const html = readSource("members/admin/users/members.html");
  const summaryBlock = source.match(
    /async function loadVisibleMemberChildSummaries[\s\S]*?\n\}/
  )?.[0] || "";
  assert.match(summaryBlock, /where\("memberUid", "in", chunk\)/);
  assert.match(summaryBlock, /studentSnapshot\?\.name/);
  assert.doesNotMatch(summaryBlock, /getDoc\(doc\(db, "students"/);
  assert.match(source, /const CHILD_SUMMARY_CHUNK_SIZE = 10/);
  assert.match(source, /const MEMBER_ATTEMPT_QUERY_LIMIT = 30/);
  assert.match(source, /const MEMBER_ATTEMPT_ISSUE_DISPLAY_LIMIT = 3/);
  assert.match(source, /const MEMBER_ATTEMPT_ALL_DISPLAY_LIMIT = 5/);
  assert.match(source, /const SIGNUP_ATTEMPT_QUERY_LIMIT = 20/);
  assert.match(
    source,
    /collection\(db, "memberChildLinkAttempts"\),\s*where\("memberUid", "==", uid\),\s*limit\(MEMBER_ATTEMPT_QUERY_LIMIT\)/
  );
  assert.match(
    source,
    /collection\(db, "signupAttempts"\),\s*where\("email", "==", normalizedEmail\),\s*limit\(SIGNUP_ATTEMPT_QUERY_LIMIT\)/
  );
  assert.match(source, />연동 기록 보기</);
  assert.match(source, /data-member-attempt-controls hidden/);
  assert.match(source, /id="memberAttemptsMeta"[^>]* hidden/);
  assert.match(source, /id="memberAttemptsBody"[^>]* hidden/);
  assert.match(source, /controls\.hidden = false/);
  assert.match(source, /sourceRows\.slice\(0, displayLimit\)/);
  assert.match(source, /if \(memberAttemptCache\.uid !== uid\) return/);
  assert.match(source, /function buildParentChildSections[\s\S]*?member\.memberPurpose !== "parent"\) return ""/);
  const parentSectionsBlock = source.match(
    /function buildParentChildSections[\s\S]*?\n\}/
  )?.[0] || "";
  assert.match(parentSectionsBlock, /buildManualLinkSection\(member, children\.length\)/);
  assert.match(parentSectionsBlock, /buildAttemptsSection\(member\.uid\)/);
  assert.match(source, /\$\{buildParentChildSections\(member, children\)\}/);
  assert.doesNotMatch(source, /학부모 회원만 자녀 접근 권한/);
  assert.match(source, />인증 요청 기록 보기</);
  assert.match(source, /memberAttemptCache\.rows\.filter/);
  assert.match(source, /\["linked", "alreadyLinked"\]/);
  const attemptViewHandlerStart = source.indexOf("const attemptViewButton");
  const attemptViewHandler = source.slice(
    attemptViewHandlerStart,
    source.indexOf("const signupAttemptsButton", attemptViewHandlerStart)
  );
  assert.match(attemptViewHandler, /renderMemberAttemptRows/);
  assert.doesNotMatch(attemptViewHandler, /getDocs|loadMemberAttemptRows/);
  assert.doesNotMatch(source, /collection\(db, "emailVerifications"\)/);
  assert.doesNotMatch(source, /window\.alert|window\.confirm/);
  assert.doesNotMatch(source, /OTP code|session token|sessionTokenHash/);
  assert.match(html, /<th>자녀<\/th>/);
  assert.doesNotMatch(html, /memberDiagnosticsModal|openMemberDiagnosticsBtn/);
});

test("administrator manual parent links use canonical transactions and guarded Rules", () => {
  const source = readSource("assets/js/pages/admin-members.js");
  const functionsSource = readSource("functions/index.js");
  const rules = readSource("firestore.rules");
  const automaticTransaction = functionsSource.slice(
    functionsSource.indexOf('const linkId = `${studentUid}_${memberUid}`'),
    functionsSource.indexOf('const result = alreadyLinked ? "alreadyLinked" : "linked";')
  );
  const manualLinkTransaction = source.slice(
    source.indexOf("async function createManualChildLink"),
    source.indexOf("async function revokeManualChildLink")
  );
  const manualRevokeTransaction = source.slice(
    source.indexOf("async function revokeManualChildLink"),
    source.indexOf("function buildAttemptsSection")
  );

  assert.match(automaticTransaction, /where\("memberUid", "==", memberUid\)/);
  assert.match(automaticTransaction, /status === "active" \? count \+ 1 : count, 0/);
  assert.match(automaticTransaction, /alreadyLinked = currentLink\?\.status === "active"/);
  assert.match(automaticTransaction, /if \(alreadyLinked\)[\s\S]*?linkedChildrenCount,/);
  assert.match(automaticTransaction, /linkedChildrenCount \+= 1/);
  assert.match(automaticTransaction, /status: "active"[\s\S]*?revokedAt: null/);
  assert.match(source, /runTransaction\(db, async \(transaction\)/);
  assert.match(source, /`\$\{studentUid\}_\$\{memberUid\}`/);
  assert.match(source, /linkedBy: "admin"/);
  assert.match(source, /matchMethod: "admin_manual"/);
  assert.match(manualLinkTransaction, /currentCount !== expectedActiveCount/);
  assert.match(manualLinkTransaction, /const updatedCount = currentCount \+ 1/);
  assert.match(manualLinkTransaction, /status: "active"[\s\S]*?revokedAt: null/);
  assert.match(manualRevokeTransaction, /currentCount !== expectedActiveCount/);
  assert.match(manualRevokeTransaction, /currentLink\.status !== "active"/);
  assert.match(manualRevokeTransaction, /const updatedCount = Math\.max\(0, currentCount - 1\)/);
  assert.match(source, /status: "revoked"/);
  assert.match(source, /revokedAt: serverTimestamp\(\)/);
  assert.match(source, /openAdminConfirm\(/);
  assert.match(source, /permission-denied/);
  assert.match(source, /현재 권한 설정으로 처리할 수 없습니다\. 관리자에게 문의해 주세요\./);
  assert.match(source, /updateLocalMemberLinkCount\(memberUid, nextCount\)/);
  assert.match(source, /refreshMemberDetailAfterCommit\(memberUid/);
  assert.match(source, /await openMemberDetail\(memberUid, \{showLoading: false, throwOnError: true\}\)/);
  assert.doesNotMatch(source, /window\.alert|window\.confirm/);
  assert.match(rules, /function hasValidAdminParentLinkCore\(linkId, data\)/);
  assert.match(rules, /function hasConsistentAdminParentLinkCount\(memberUid, delta\)/);
  assert.match(rules, /getAfter\([\s\S]*?linkedChildrenCount/);
  assert.match(rules, /allow create: if isAdmin\(\)[\s\S]*?hasConsistentAdminParentLinkCount/);
  assert.match(rules, /allow update: if isAdmin\(\)[\s\S]*?request\.resource\.data\.status == 'revoked'/);
  assert.match(rules, /request\.resource\.data\.status == 'revoked'[\s\S]*?hasConsistentAdminParentLinkCount\(resource\.data\.memberUid, -1\)/);
  assert.match(rules, /resource\.data\.status == 'revoked'[\s\S]*?hasConsistentAdminParentLinkCount\(resource\.data\.memberUid, 1\)/);
});

test("administrator primary tables keep real sticky headers inside list viewports", () => {
  const adminCss = readSource("assets/css/pages/admin.css");
  const screens = [
    ["members/admin/users/students.html", "paginationContainer"],
    ["members/admin/users/members.html", "memberPagination"],
    ["members/admin/users/instructors.html", "paginationContainer"],
    ["members/admin/users/add.html", "paginationContainer"],
    ["members/admin/courses.html", "adminPagination"],
    ["members/admin/offline-classes.html", "offlineClassesPagination"],
  ];

  assert.match(
    adminCss,
    /\.admin-list-viewport \{[\s\S]*?height:clamp\([\s\S]*?overflow:auto[\s\S]*?position:relative/
  );
  assert.match(
    adminCss,
    /\.admin-list-viewport \.admin-table \{[\s\S]*?height:auto[\s\S]*?overflow:visible/
  );
  assert.match(
    adminCss,
    /\.admin-list-viewport \.admin-table thead th \{[\s\S]*?background:[^;\n]+;[\s\S]*?position:sticky;[\s\S]*?top:0;[\s\S]*?z-index:2/
  );

  screens.forEach(([htmlPath, paginationId]) => {
    const html = readSource(htmlPath);
    const viewportStart = html.indexOf("admin-list-viewport");
    const tableStart = html.indexOf("<table", viewportStart);
    const headerStart = html.indexOf("<thead", tableStart);
    const tableEnd = html.indexOf("</table>", headerStart);
    const paginationStart = html.indexOf(`id="${paginationId}"`, tableEnd);
    assert.ok(viewportStart >= 0, `${htmlPath} should use admin-list-viewport`);
    assert.ok(tableStart > viewportStart, `${htmlPath} should keep its table inside the viewport`);
    assert.ok(headerStart > tableStart, `${htmlPath} should keep a real table header`);
    assert.ok(paginationStart > tableEnd, `${htmlPath} should keep pagination outside the table viewport`);
  });
});

test("learning list search commits on Enter or search button without Firestore reads", () => {
  const source = readSource("assets/js/pages/student-course.js");
  const studentHtml = readSource("members/students/course.html");
  const memberHtml = readSource("members/member/course.html");
  const searchBinding = source.match(
    /const searchInput = document\.getElementById\('searchInput'\);[\s\S]*?\n\}\);/
  )?.[0] || "";

  assert.match(source, /import \{ bindCommittedSearch \} from "\/assets\/js\/utils\/list-controls\.js"/);
  assert.match(searchBinding, /const searchButton = document\.getElementById\('searchButton'\)/);
  assert.match(searchBinding, /bindCommittedSearch\(searchInput, searchButton/);
  assert.match(searchBinding, /searchQuery = keyword;\s*renderWeeks\(\)/);
  assert.doesNotMatch(searchBinding, /addEventListener\(['"]input|collection\(|getDocs\(|query\(/);
  [studentHtml, memberHtml].forEach((html) => {
    assert.match(html, /placeholder="주차 또는 영상명을 검색하세요"/);
    assert.match(html, /id="searchButton"/);
    assert.match(html, /admin-toolbar__search-button/);
  });
});

test("primary list mobile controls and simplified instructor UI keep source contracts", () => {
  const adminCss = readSource("assets/css/pages/admin.css");
  const accountCss = readSource("assets/css/pages/admin-user-add.css");
  const accountHtml = readSource("members/admin/users/add.html");
  const publicCss = readSource("assets/css/pages/courses-all.css");
  const instructorsHtml = readSource("members/admin/users/instructors.html");
  const instructorsJs = readSource("assets/js/pages/admin-instructors.js");
  const coursesHtml = readSource("members/admin/courses.html");
  assert.match(adminCss, /admin-toolbar--primary-list[\s\S]*?flex:1 0 calc\(100% - 86px\)/);
  assert.match(adminCss, /admin-list-page-size[\s\S]*?width:76px/);
  assert.match(publicCss, /\.toolbar-search\s*\{[\s\S]*?display:\s*flex/);
  assert.match(accountHtml, /account-user-list-head/);
  assert.match(accountCss, /\.account-user-list-head\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.doesNotMatch(instructorsHtml, /toggleFilters|sortOption|filterPanel/);
  assert.doesNotMatch(instructorsHtml, /소개·사진·영상·자료와 계정 연결 상태를 관리합니다/);
  assert.doesNotMatch(instructorsJs, /activeFilters|loadFilterOptions|sortOption/);
  assert.ok(
    coursesHtml.indexOf('id="courseCatalogSubjectAddBtn"') <
      coursesHtml.indexOf('id="courseCatalogSubjectEditor"')
  );
});

test("verification and signup Rules bind profile creation to a recent server proof", () => {
  const functionsSource = readSource("functions/index.js");
  const policySource = readSource("functions/email-verification-policy.js");
  const rulesSource = readSource("firestore.rules");

  assert.match(functionsSource, /generateVerificationSessionToken\(\)/);
  assert.match(functionsSource, /sessionTokenHash/);
  assert.match(functionsSource, /db\.runTransaction\(async \(transaction\)/);
  assert.doesNotMatch(functionsSource, /Math\.random\(\)/);
  assert.match(policySource, /crypto\.randomInt/);
  assert.match(policySource, /crypto\.timingSafeEqual/);
  assert.match(rulesSource, /function hasRecentEmailVerification\(email, signupType\)/);
  assert.match(
    rulesSource,
    /isStudentSignupEnabled\(\) &&\s*hasRecentEmailVerification\(request\.resource\.data\.email, 'student'\)/
  );
  assert.match(
    rulesSource,
    /isMemberSignupEnabled\(\) &&\s*hasRecentEmailVerification\(request\.resource\.data\.email, 'member'\)/
  );
});

test("member child attempt details are admin-only in Firestore Rules", () => {
  const rulesSource = readSource("firestore.rules");
  const block = rulesSource.match(
    /match \/memberChildLinkAttempts\/\{attemptId\} \{[\s\S]*?\n\s*\}/
  )?.[0] || "";
  assert.match(block, /allow read: if isAdmin\(\);/);
  assert.doesNotMatch(block, /request\.auth\.uid|isMember\(\)/);
});
