// 역할별 권한 경계 행동 테스트. Firestore Emulator(127.0.0.1:8080)와 합성 데이터만 사용한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { Timestamp } = require("firebase/firestore");

const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
const JOINED_AT = Timestamp.fromDate(new Date("2026-05-10T01:00:00.000Z")); // KST 2026-05-10 10:00
const STUDENT_EMAIL = "student-1@example.test";

const consent = () => ({
  sms: false,
  email: false,
  agreedAt: null,
  updatedAt: Timestamp.now(),
  withdrawnAt: null,
  source: "signup",
  policyVersion: "2026-07-18",
});

let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-gritedu-security",
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
});

test.after(async () => {
  await environment.cleanup();
});

test.beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes = [
      ["admins/admin-1", { name: "관리자" }],
      ["students/student-1", { name: "학생", email: STUDENT_EMAIL, phone: "01000000001", school: "가나고", grade: "4", role: "student" }],
      ["students/student-2", { name: "다른 학생", email: "student-2@example.test", phone: "01000000002", school: "가나고", grade: "4" }],
      ["members/general-1", { uid: "general-1", role: "member", name: "회원", email: "general-1@example.test", phone: "01000000003", memberPurpose: "general", status: "active", hasLinkedChildren: false, linkedChildrenCount: 0 }],
      ["members/parent-1", { uid: "parent-1", role: "member", name: "학부모", email: "parent-1@example.test", phone: "01000000004", memberPurpose: "parent", status: "active", hasLinkedChildren: true, linkedChildrenCount: 1, linkedStudentUids: ["student-1"] }],
      ["members/parent-unlinked", { uid: "parent-unlinked", role: "member", name: "미연동 학부모", email: "unlinked@example.test", phone: "01000000005", memberPurpose: "parent", status: "active", hasLinkedChildren: false, linkedChildrenCount: 0 }],
      ["studentParentLinks/student-1_parent-1", {
        studentUid: "student-1",
        memberUid: "parent-1",
        status: "active",
        memberSnapshot: { name: "학부모", email: "parent-1@example.test", phone: "01000000004" },
        studentSnapshot: { name: "학생", school: "가나고", grade: "4", phoneLast4: "0001" },
      }],
      ["instructorAccounts/instructor-1", { instructorId: "profile-1", name: "담당 강사" }],
      ["instructorAccounts/instructor-2", { instructorId: "profile-2", name: "다른 강사" }],
      ["courses/course-1", { accessType: "public", status: "published", instructorId: "profile-1" }],
      ["enrollments/student-1_course-1", { userId: "student-1", courseId: "course-1", status: "active", progress: 10, learnerType: "student" }],
      ["offlineClasses/class-1", { className: "A반", status: "active", instructorId: "profile-1" }],
      ["offlineClasses/class-other", { className: "B반", status: "active", instructorId: "profile-2" }],
      ["offlineClassMembers/class-1_student-1", { classId: "class-1", studentUid: "student-1", status: "active", joinedAt: JOINED_AT }],
      ["offlineClassSessions/before-join", { classId: "class-1", status: "published", sessionDate: "2026-05-09" }],
      ["offlineClassSessions/join-day", { classId: "class-1", status: "published", sessionDate: "2026-05-10" }],
      ["offlineClassSessions/after-join", { classId: "class-1", status: "published", sessionDate: "2026-05-11" }],
      ["offlineClassSessions/granted-old", { classId: "class-1", status: "published", sessionDate: "2026-05-01" }],
      ["offlineClassSessions/revoked-new", { classId: "class-1", status: "published", sessionDate: "2026-05-12" }],
      ["offlineClassSessions/draft-new", { classId: "class-1", status: "draft", sessionDate: "2026-05-13" }],
      ...["before-join", "join-day", "after-join", "granted-old", "revoked-new", "draft-new"].map((id) => [`offlineSessionPrivate/${id}`, { classId: "class-1", videos: [{ title: "", url: `https://example.test/${id}` }], videoUrl: `https://example.test/${id}` }]),
      ["offlineSessionAccess/granted-old_student-1", { classId: "class-1", sessionId: "granted-old", studentUid: "student-1", status: "active" }],
      ["offlineSessionAccess/revoked-new_student-1", { classId: "class-1", sessionId: "revoked-new", studentUid: "student-1", status: "revoked" }],
      ["emailVerifications/victim@example.test", { email: "victim@example.test", signupType: "student", used: true, verifiedAt: Timestamp.now(), cleanupAt: Timestamp.fromMillis(Date.now() + 3600000) }],
      ["signupAttempts/a1", { email: "x@example.test", ip: "198.51.100.1" }],
      ["memberChildLinkAttempts/a1", { memberUid: "parent-1", result: "notFound" }],
    ];
    await Promise.all(writes.map(([docPath, data]) => db.doc(docPath).set(data)));
  });
});

const as = (uid, token) => environment.authenticatedContext(uid, token).firestore();
const student = () => as("student-1", { email: STUDENT_EMAIL });

test("강사: 담당 강좌 수강 기록을 읽을 수 있지만 수정·탈취할 수 없다", async () => {
  const instructor = as("instructor-1");
  const ref = instructor.doc("enrollments/student-1_course-1");
  await assertSucceeds(ref.get());
  await assertFails(ref.update({ status: "revoked" }));
  await assertFails(ref.update({ userId: "attacker" }));
  await assertFails(ref.update({ progress: 100 }));
  await assertFails(as("instructor-2").doc("enrollments/student-1_course-1").get());
});

test("학습자 본인의 진도 저장과 관리자 수정은 유지된다", async () => {
  const ref = student().doc("enrollments/student-1_course-1");
  await assertSucceeds(ref.update({ progress: 55, updatedAt: Timestamp.now() }));
  await assertFails(ref.update({ userId: "student-2" }));
  await assertFails(as("student-2", { email: "student-2@example.test" }).doc("enrollments/student-1_course-1").update({ progress: 99 }));
  await assertSucceeds(as("admin-1").doc("enrollments/student-1_course-1").update({ status: "active" }));
});

test("학생은 학부모 관계 문서의 연락처를 읽지 못하고, 학부모는 자기 관계만 읽는다", async () => {
  await assertFails(student().doc("studentParentLinks/student-1_parent-1").get());
  await assertFails(student().collection("studentParentLinks").where("studentUid", "==", "student-1").get());
  const parent = as("parent-1");
  const own = await assertSucceeds(parent.collection("studentParentLinks").where("memberUid", "==", "parent-1").get());
  assert.equal(own.size, 1);
  await assertFails(as("parent-unlinked").doc("studentParentLinks/student-1_parent-1").get());
  await assertFails(as("general-1").collection("studentParentLinks").where("studentUid", "==", "student-1").get());
});

test("학생 본인 프로필: 허용 항목은 수정되고 잘못된 값과 권한 필드는 거부된다", async () => {
  const ref = student().doc("students/student-1");
  await assertSucceeds(ref.update({ name: "새이름", phone: "010-1234-5678", school: "다라고", grade: "5", updatedAt: Timestamp.now(), email: STUDENT_EMAIL, gradeManualOverride: true, lastAutoPromotionYear: 2026 }));
  await assertFails(ref.update({ name: 1 }));
  await assertFails(ref.update({ name: "" }));
  await assertFails(ref.update({ name: "가".repeat(101) }));
  await assertFails(ref.update({ phone: 1 }));
  await assertFails(ref.update({ phone: "1".repeat(31) }));
  await assertFails(ref.update({ school: { a: 1 } }));
  await assertFails(ref.update({ school: "가".repeat(101) }));
  await assertFails(ref.update({ grade: "8" }));
  await assertFails(ref.update({ grade: 4 }));
  await assertFails(ref.update({ email: "other@example.test" }));
  await assertFails(ref.update({ gradeManualOverride: "yes" }));
  await assertFails(ref.update({ updatedAt: "now" }));
  await assertFails(ref.update({ role: "admin" }));
  await assertFails(ref.update({ isAdmin: true }));
  await assertFails(as("student-2", { email: "student-2@example.test" }).doc("students/student-1").get());
  await assertFails(as("student-2", { email: "student-2@example.test" }).doc("students/student-1").update({ name: "탈취" }));
});

test("기존 비정상 값이 있어도 다른 항목 수정은 막지 않는다(변경한 항목만 검사)", async () => {
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("students/student-1").update({ grade: "고1", name: "x".repeat(150) }));
  await assertSucceeds(student().doc("students/student-1").update({ phone: "01099998888" }));
});

test("회원·학부모 본인 프로필: 이름·연락처만 수정하고 목적·상태·연동 수는 바꾸지 못한다", async () => {
  for (const uid of ["general-1", "parent-1"]) {
    const ref = as(uid).doc(`members/${uid}`);
    await assertSucceeds(ref.update({ name: "새이름", phone: "010-1111-2222", updatedAt: Timestamp.now() }));
    await assertFails(ref.update({ name: 1 }));
    await assertFails(ref.update({ name: "" }));
    await assertFails(ref.update({ name: "가".repeat(101) }));
    await assertFails(ref.update({ phone: "1".repeat(31) }));
    await assertFails(ref.update({ memberPurpose: uid === "general-1" ? "parent" : "general" }));
    await assertFails(ref.update({ status: "disabled" }));
    await assertFails(ref.update({ role: "admin" }));
    await assertFails(ref.update({ hasLinkedChildren: true, linkedChildrenCount: 5 }));
    await assertFails(ref.update({ email: "other@example.test" }));
  }
  await assertFails(as("general-1").doc("members/parent-1").get());
  await assertFails(as("general-1").collection("members").limit(1).get());
});

test("권한 상승: 비관리자는 역할 문서·관계 문서·보호 기록을 만들거나 읽지 못한다", async () => {
  const attacker = as("general-1");
  for (const [docPath, data] of [
    ["admins/general-1", { name: "x" }],
    ["instructorAccounts/general-1", { instructorId: "profile-1" }],
    ["instructors/general-1", { name: "x" }],
    ["parents/general-1", { name: "x" }],
    ["users/general-1", { role: "admin" }],
    ["studentParentLinks/student-1_general-1", { studentUid: "student-1", memberUid: "general-1", status: "active" }],
    ["offlineClassMembers/class-1_general-1", { classId: "class-1", studentUid: "general-1", status: "active" }],
    ["offlineSessionAccess/granted-old_general-1", { classId: "class-1", sessionId: "granted-old", studentUid: "general-1", status: "active" }],
    ["signupAttempts/x", { email: "x" }],
    ["emailVerifications/general-1@example.test", { used: true }],
    ["memberChildLinkAttempts/x", { memberUid: "x" }],
    ["changeHistory/x", { a: 1 }],
  ]) {
    await assertFails(attacker.doc(docPath).set(data));
  }
  for (const docPath of ["admins/admin-1", "instructorPrivate/profile-1", "parents/parent-1", "signupAttempts/a1", "emailVerifications/victim@example.test", "memberChildLinkAttempts/a1", "settings/offlineClassCatalog"]) {
    await assertFails(attacker.doc(docPath).get());
  }
  await assertFails(attacker.collection("students").limit(1).get());
  await assertFails(attacker.collection("offlineClasses").limit(1).get());
  await assertFails(attacker.collection("enrollments").limit(1).get());
});

test("오프라인 회차 영상: 입반일·수동 허용·수동 해제를 단건 조회에서 강제한다", async () => {
  const db = student();
  await assertFails(db.doc("offlineSessionPrivate/before-join").get());
  await assertSucceeds(db.doc("offlineSessionPrivate/join-day").get());
  await assertSucceeds(db.doc("offlineSessionPrivate/after-join").get());
  await assertSucceeds(db.doc("offlineSessionPrivate/granted-old").get());
  await assertFails(db.doc("offlineSessionPrivate/revoked-new").get());
  await assertFails(db.doc("offlineSessionPrivate/draft-new").get());
  await assertFails(db.collection("offlineSessionPrivate").where("classId", "==", "class-1").get());
  await assertFails(as("student-2", { email: "student-2@example.test" }).doc("offlineSessionPrivate/join-day").get());
  await assertFails(as("general-1").doc("offlineSessionPrivate/join-day").get());
  await assertFails(as("parent-1").doc("offlineSessionPrivate/join-day").get());
  await assertFails(environment.unauthenticatedContext().firestore().doc("offlineSessionPrivate/join-day").get());
  await assertSucceeds(as("instructor-1").doc("offlineSessionPrivate/before-join").get());
  await assertFails(as("instructor-2").doc("offlineSessionPrivate/before-join").get());
  await assertSucceeds(as("admin-1").collection("offlineSessionPrivate").where("classId", "==", "class-1").get());
});

test("오프라인 회차 목록: 학생은 일정 정보만 조회하고 다른 반·비공개 회차는 거부된다", async () => {
  const db = student();
  const published = () => db.collection("offlineClassSessions").where("classId", "==", "class-1").where("status", "==", "published");
  const list = await assertSucceeds(published().where("sessionDate", ">=", "2026-05-10").get());
  assert.ok(list.docs.every((d) => !("videos" in d.data()) && !("videoUrl" in d.data())), "목록에 영상 URL이 없다");
  assert.deepEqual(list.docs.map((d) => d.id).sort(), ["after-join", "join-day", "revoked-new"], "입반일(KST) 이후 회차만 목록에 나온다");
  // 입반 전 회차 메타: 하한 없는 목록, 더 이른 하한, 단건 조회 모두 거부. 수동 허용만 단건으로 읽는다.
  await assertFails(published().get());
  await assertFails(published().where("sessionDate", ">=", "2026-05-09").get());
  await assertFails(db.doc("offlineClassSessions/before-join").get());
  await assertSucceeds(db.doc("offlineClassSessions/granted-old").get());
  await assertFails(db.doc("offlineClassSessions/revoked-new").get());
  await assertSucceeds(db.doc("offlineClassSessions/join-day").get());
  await assertFails(db.collection("offlineClassSessions").where("classId", "==", "class-1").get());
  await assertFails(db.doc("offlineClassSessions/draft-new").get());
  await assertFails(as("student-2", { email: "student-2@example.test" }).collection("offlineClassSessions").where("classId", "==", "class-1").where("status", "==", "published").get());
  await assertFails(as("general-1").doc("offlineClassSessions/join-day").get());
  await assertFails(as("parent-1").doc("offlineClassSessions/join-day").get());
  await assertSucceeds(as("instructor-1").collection("offlineClassSessions").where("classId", "==", "class-1").get());
  await assertFails(as("instructor-2").collection("offlineClassSessions").where("classId", "==", "class-1").get());
});

test("오프라인 회차 단건: 강사 배정 필드가 모두 채워진 실제 반에서도 학생 단건 조회가 문서 접근 한도에 걸리지 않는다", async () => {
  // 운영 회귀(2026-11-03): 강사 판정을 학생 판정보다 먼저 평가하면 instructors 프로필 조회가 더해져 학생 단건 조회가 거부됐다.
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("instructors/profile-a").set({ uid: "instructor-a", name: "강사 A" });
    await db.doc("instructors/profile-b").set({ uid: "instructor-b", name: "강사 B" });
    await db.doc("offlineClasses/class-real").set({
      className: "실제 반", status: "active",
      instructorUid: "instructor-a", instructorId: "profile-a",
      instructorUids: ["instructor-a", "instructor-b"], instructorIds: ["profile-a", "profile-b"],
    });
    await db.doc("offlineClassMembers/class-real_student-1").set({ classId: "class-real", studentUid: "student-1", status: "active", joinedAt: JOINED_AT });
    await db.doc("offlineClassSessions/real-after").set({ classId: "class-real", status: "published", sessionDate: "2026-05-11" });
    await db.doc("offlineClassSessions/real-granted").set({ classId: "class-real", status: "published", sessionDate: "2026-05-01" });
    await db.doc("offlineClassSessions/real-before").set({ classId: "class-real", status: "published", sessionDate: "2026-05-02" });
    await db.doc("offlineSessionAccess/real-granted_student-1").set({ classId: "class-real", sessionId: "real-granted", studentUid: "student-1", status: "active" });
  });
  const db = student();
  await assertSucceeds(db.doc("offlineClassSessions/real-after").get());
  await assertSucceeds(db.doc("offlineClassSessions/real-granted").get());
  await assertFails(db.doc("offlineClassSessions/real-before").get());
  await assertSucceeds(db.collection("offlineClassSessions").where("classId", "==", "class-real").where("status", "==", "published").where("sessionDate", ">=", "2026-05-10").get());
  await assertSucceeds(as("instructor-a").doc("offlineClassSessions/real-before").get());
});

test("오프라인 회차 쓰기: 관리자만 가능하고 회차 문서에 영상 URL을 새로 넣지 못한다", async () => {
  const admin = as("admin-1");
  await assertFails(student().doc("offlineSessionPrivate/join-day").set({ classId: "class-1", videos: [] }));
  await assertFails(as("instructor-1").doc("offlineSessionPrivate/join-day").set({ classId: "class-1", videos: [] }));
  await assertFails(admin.doc("offlineClassSessions/new-1").set({ classId: "class-1", status: "published", videos: [{ url: "https://example.test/x" }] }));
  await assertSucceeds(admin.doc("offlineClassSessions/new-2").set({ classId: "class-1", status: "published", hasVideo: true, videoCount: 1 }));
  await assertSucceeds(admin.doc("offlineSessionPrivate/new-2").set({ classId: "class-1", videos: [{ title: "", url: "https://example.test/x" }], videoUrl: "https://example.test/x" }));
  await assertFails(admin.doc("offlineClassSessions/new-2").update({ videoUrl: "https://example.test/x" }));
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("offlineClassSessions/legacy-1").set({ classId: "class-1", status: "published", title: "이전 전", videos: [{ url: "https://example.test/legacy" }] }));
  await assertSucceeds(admin.doc("offlineClassSessions/legacy-1").update({ title: "제목만 수정" }));
  await assertFails(admin.doc("offlineClassSessions/legacy-1").update({ videos: [{ url: "https://example.test/changed" }] }));
});

test("입반 정보가 없거나 제거된 학생은 회차 영상을 읽지 못한다", async () => {
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("offlineClassMembers/class-1_student-1").update({ status: "removed" }));
  await assertFails(student().doc("offlineSessionPrivate/after-join").get());
  await assertFails(student().collection("offlineClassSessions").where("classId", "==", "class-1").where("status", "==", "published").get());
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("offlineClassMembers/class-1_student-1").update({ status: "active", joinedAt: null }));
  await assertFails(student().doc("offlineSessionPrivate/after-join").get());
  await assertSucceeds(student().doc("offlineSessionPrivate/granted-old").get());
  // 입반일이 없으면 목록은 증명할 하한이 없어 거부되고, 수동 허용 회차 메타만 단건으로 읽는다.
  await assertFails(student().collection("offlineClassSessions").where("classId", "==", "class-1").where("status", "==", "published").where("sessionDate", ">=", "2026-05-10").get());
  await assertSucceeds(student().doc("offlineClassSessions/granted-old").get());
  await assertFails(student().doc("offlineClassSessions/after-join").get());
});

test("보관된 반의 회차는 학생이 읽지 못한다(강사·관리자는 유지)", async () => {
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("offlineClasses/class-1").update({ status: "archived" }));
  await assertFails(student().doc("offlineSessionPrivate/after-join").get());
  await assertFails(student().collection("offlineClassSessions").where("classId", "==", "class-1").where("status", "==", "published").get());
  await assertSucceeds(as("instructor-1").doc("offlineSessionPrivate/after-join").get());
  await assertSucceeds(as("admin-1").doc("offlineClassSessions/after-join").get());
});

test("오프라인 반 문서: 자녀 연동이 없는 학부모·일반 회원은 ID를 알아도 읽지 못한다", async () => {
  await assertFails(as("parent-unlinked").doc("offlineClasses/class-1").get());
  await assertFails(as("general-1").doc("offlineClasses/class-1").get());
  await assertSucceeds(as("parent-1").doc("offlineClasses/class-1").get());
  await assertFails(as("parent-1").collection("offlineClasses").limit(1).get());
  await assertSucceeds(as("instructor-1").doc("offlineClasses/class-1").get());
  await assertFails(as("instructor-2").doc("offlineClasses/class-1").get());
  await assertSucceeds(student().doc("offlineClasses/class-1").get());
  await assertFails(student().doc("offlineClasses/class-other").get());
});

test("학부모는 연동된 자녀의 수강·반 배정만 읽는다", async () => {
  const parent = as("parent-1");
  await assertSucceeds(parent.collection("offlineClassMembers").where("studentUid", "==", "student-1").get());
  await assertSucceeds(parent.collection("enrollments").where("userId", "==", "student-1").get());
  await assertFails(parent.collection("offlineClassMembers").where("studentUid", "==", "student-2").get());
  await assertFails(parent.collection("enrollments").where("userId", "==", "student-2").get());
  await assertFails(as("parent-unlinked").collection("enrollments").where("userId", "==", "student-1").get());
});

test("학부모 반 문서: 연동 자녀가 활성 입반한 반만 읽고, 다른 반 ID 직접 조회는 거부된다", async () => {
  const parent = as("parent-1");
  await assertSucceeds(parent.doc("offlineClasses/class-1").get());
  await assertFails(parent.doc("offlineClasses/class-other").get());
  await assertFails(parent.collection("offlineClasses").where("status", "==", "active").get());
  await assertFails(parent.doc("offlineClassSessions/join-day").get());
  await assertFails(parent.doc("offlineSessionPrivate/join-day").get());

  // 자녀 목록이 아직 없는(보정 전) 학부모는 hasLinkedChildren 만으로 반을 읽지 못한다(fail closed).
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("members/parent-1").update({ linkedStudentUids: [] }));
  await assertFails(parent.doc("offlineClasses/class-1").get());

  // 자녀가 반에서 제거되면 읽지 못한다.
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("members/parent-1").update({ linkedStudentUids: ["student-1"] });
    await context.firestore().doc("offlineClassMembers/class-1_student-1").update({ status: "removed" });
  });
  await assertFails(parent.doc("offlineClasses/class-1").get());

  // 본인 프로필에서 자녀 목록을 바꿔 권한을 넓히지 못한다.
  await assertFails(parent.doc("members/parent-1").update({ linkedStudentUids: ["student-1", "student-2"] }));
  await assertFails(as("parent-unlinked").doc("members/parent-unlinked").update({ linkedStudentUids: ["student-1"] }));
});

test("학부모 반 문서: 자녀 5명까지는 문서 접근 한도 안에서 확인하고 6번째부터는 거부된다", async () => {
  const children = ["c1", "c2", "c3", "c4", "c5", "c6"];
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("members/parent-1").update({ linkedStudentUids: children, linkedChildrenCount: children.length });
    // 실제 반처럼 강사 배정 필드를 모두 채운 최악 조건(강사 판정이 프로필 문서를 더 읽는다).
    const realInstructorFields = { instructorUid: "instructor-a", instructorId: "profile-a", instructorUids: ["instructor-a", "instructor-b"], instructorIds: ["profile-a", "profile-b"] };
    await db.doc("instructors/profile-a").set({ uid: "instructor-a", name: "강사 A" });
    await db.doc("offlineClasses/class-5").set({ className: "5번째 자녀 반", status: "active", ...realInstructorFields });
    await db.doc("offlineClasses/class-6").set({ className: "6번째 자녀 반", status: "active", ...realInstructorFields });
    await db.doc("offlineClassMembers/class-5_c5").set({ classId: "class-5", studentUid: "c5", status: "active", joinedAt: JOINED_AT });
    await db.doc("offlineClassMembers/class-6_c6").set({ classId: "class-6", studentUid: "c6", status: "active", joinedAt: JOINED_AT });
  });
  const parent = as("parent-1");
  await assertSucceeds(parent.doc("offlineClasses/class-5").get());
  await assertFails(parent.doc("offlineClasses/class-6").get());
  await assertFails(parent.doc("offlineClasses/class-other").get());
  // 같은 반을 담당 강사·입반 학생·관리자가 읽는 경로도 판정 순서 변경 뒤 그대로 허용된다.
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("offlineClassMembers/class-5_student-1").set({ classId: "class-5", studentUid: "student-1", status: "active", joinedAt: JOINED_AT }));
  await assertSucceeds(as("instructor-a").doc("offlineClasses/class-5").get());
  await assertSucceeds(student().doc("offlineClasses/class-5").get());
  await assertSucceeds(as("admin-1").doc("offlineClasses/class-5").get());
  await assertFails(as("instructor-2").doc("offlineClasses/class-5").get());
});

test("관리자 자녀 연결/해제: 연결 수와 자녀 목록을 같은 트랜잭션에서 함께 바꿔야 한다", async () => {
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("members/parent-unlinked").update({ linkedStudentUids: [] }));
  const admin = as("admin-1");
  const Ts = Timestamp;
  const link = (status) => ({
    studentUid: "student-2", memberUid: "parent-unlinked", status, relationLabel: "guardian", relationDisplay: "보호자",
    linkedBy: "admin", matchMethod: "admin_manual", studentSnapshot: {}, memberSnapshot: {},
    createdAt: Ts.now(), updatedAt: Ts.now(), revokedAt: status === "active" ? null : Ts.now(),
  });
  const linkRef = admin.doc("studentParentLinks/student-2_parent-unlinked");
  const memberRef = admin.doc("members/parent-unlinked");

  // 연결 수만 올리고 자녀 목록을 빠뜨리면 거부된다.
  const missingList = admin.batch();
  missingList.set(linkRef, link("active"));
  missingList.update(memberRef, { hasLinkedChildren: true, linkedChildrenCount: 1 });
  await assertFails(missingList.commit());

  const linkBatch = admin.batch();
  linkBatch.set(linkRef, link("active"));
  linkBatch.update(memberRef, { hasLinkedChildren: true, linkedChildrenCount: 1, linkedStudentUids: ["student-2"] });
  await assertSucceeds(linkBatch.commit());

  // 해제하면서 자녀 목록에 남겨 두면 거부되고, 함께 빼면 허용된다.
  const keepList = admin.batch();
  keepList.update(linkRef, { status: "revoked", revokedAt: Ts.now(), updatedAt: Ts.now() });
  keepList.update(memberRef, { hasLinkedChildren: false, linkedChildrenCount: 0 });
  await assertFails(keepList.commit());

  const revokeBatch = admin.batch();
  revokeBatch.update(linkRef, { status: "revoked", revokedAt: Ts.now(), updatedAt: Ts.now() });
  revokeBatch.update(memberRef, { hasLinkedChildren: false, linkedChildrenCount: 0, linkedStudentUids: [] });
  await assertSucceeds(revokeBatch.commit());
});

test("가입: 입력 크기를 제한하고, 인증 증표 없는 프로필 생성을 거부한다", async () => {
  const signup = (overrides = {}) => ({
    name: "신규",
    email: "new@example.test",
    school: "가나고",
    grade: "4",
    phone: "01012341234",
    note: "",
    termsAgreed: true,
    privacyAgreed: true,
    termsAgreedAt: Timestamp.now(),
    privacyAgreedAt: Timestamp.now(),
    consentSource: "signup",
    policyVersion: "2026-07-18",
    marketingConsent: consent(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  });
  const newUser = as("new-1", { email: "new@example.test" });
  await assertFails(newUser.doc("students/new-1").set(signup()));
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("emailVerifications/new@example.test").set({
    email: "new@example.test", signupType: "student", used: true, verifiedAt: Timestamp.now(), cleanupAt: Timestamp.fromMillis(Date.now() + 3600000),
  }));
  await assertFails(newUser.doc("students/new-1").set(signup({ name: "가".repeat(101) })));
  await assertFails(newUser.doc("students/new-1").set(signup({ phone: "1".repeat(31) })));
  await assertFails(newUser.doc("students/new-1").set(signup({ school: "가".repeat(101) })));
  await assertFails(newUser.doc("students/new-1").set(signup({ note: "가".repeat(1001) })));
  await assertFails(newUser.doc("students/new-1").set(signup({ role: "admin" })));
  await assertFails(newUser.doc("students/new-1").set(signup({ ageOver14Confirmed: false })));
  await assertFails(newUser.doc("students/new-1").set(signup({ policyVersion: "2020-01-01" })));
  await assertFails(as("new-2", { email: "new@example.test" }).doc("students/new-1").set(signup()));
  await assertSucceeds(newUser.doc("students/new-1").set(signup({ ageOver14Confirmed: true, policyVersion: "2026-11-09", marketingConsent: { ...consent(), policyVersion: "2026-11-09" } })));
  // 이전 화면(확인 항목 없음, 직전 약관 버전)으로 가입해도 전환 기간에는 막지 않는다.
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc("students/new-1").delete());
  await assertSucceeds(newUser.doc("students/new-1").set(signup()));
});
