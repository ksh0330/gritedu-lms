const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

const root = path.join(__dirname, "..");

test("public payload and private metadata preserve an unlinked profile through account connection", async () => {
  const source = fs.readFileSync(path.join(root, "assets/js/utils/instructor-privacy.js"), "utf8");
  const { publicInstructorData, privateInstructorData, mergeInstructorPrivate, accountUidByInstructorId,
    selectInstructorProfileForAccount } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const legacy = { instructorId: "inst_1", name: "강사", subject: "수학", photo: "https://example.test/photo.webp",
    email: "Teacher@Example.test", note: "내부", pending: true };
  const publicData = publicInstructorData(legacy);
  assert.deepEqual(Object.keys(publicData).sort(), ["instructorId", "name", "photo", "subject"]);
  assert.deepEqual(publicInstructorData({ order: 2, sortOrder: 3, category: "수학" }),
    { order: 2, sortOrder: 3, category: "수학" });
  const privateData = privateInstructorData(legacy);
  assert.equal(privateData.emailLower, "teacher@example.test");
  assert.equal(privateInstructorData({ ...privateData, email: "new@example.test" }).emailLower, "new@example.test");
  assert.equal(privateInstructorData({ ...privateData, email: "" }).emailLower, "");
  assert.equal(mergeInstructorPrivate(publicData, privateData).note, "내부");
  const connected = privateInstructorData({ ...privateData, uid: "auth-1", pending: false });
  assert.equal(mergeInstructorPrivate(publicData, connected).uid, "auth-1");
  assert.equal(mergeInstructorPrivate(publicData, { uid: "" }, { uid: "auth-1" }).uid, "auth-1");
  assert.equal(mergeInstructorPrivate({ ...publicData, uid: "stale" }, null, { uid: "auth-1" }).uid, "auth-1");
  assert.equal(mergeInstructorPrivate({ ...legacy, uid: "stale" }, { uid: "", email: "", emailLower: "", pending: true }).email, "");
  assert.equal(mergeInstructorPrivate({ ...legacy, uid: "stale" }, { uid: "", email: "", emailLower: "", pending: true }).uid, "");
  assert.equal(mergeInstructorPrivate(legacy, null).email, "Teacher@Example.test");
  assert.equal(mergeInstructorPrivate(legacy, undefined).email, "Teacher@Example.test");
  assert.equal(publicData.instructorId, "inst_1");
  const accountMap = accountUidByInstructorId([{ id: "auth-1", data: () => ({ instructorId: "inst_1" }) }]);
  assert.equal(accountMap.get("inst_1"), "auth-1");
  const unlinked = { id: "inst_1", name: "강사", subjects: ["수학"], email: "Teacher@Example.test", uid: "" };
  const candidate = { name: "강사", subjects: ["수학"], emailLower: "teacher@example.test" };
  assert.equal(selectInstructorProfileForAccount([unlinked], candidate).id, "inst_1");
  assert.equal(selectInstructorProfileForAccount([{ ...unlinked, subjects: ["영어", "수학"] }],
    { ...candidate, subjects: ["과학", "수학"] }).id, "inst_1");
  assert.equal(selectInstructorProfileForAccount([], candidate), null);
  assert.equal(selectInstructorProfileForAccount([{ ...unlinked, email: "" }], candidate).id, "inst_1");
  assert.throws(() => selectInstructorProfileForAccount([unlinked], { ...candidate, name: "다른 강사" }), /이름 또는 과목/);
  assert.throws(() => selectInstructorProfileForAccount([unlinked], { ...candidate, emailLower: "other@example.test" }), /이메일이 다릅니다/);
  assert.throws(() => selectInstructorProfileForAccount([unlinked, { ...unlinked, id: "inst_2" }], candidate), /이메일이 같은/);
  assert.throws(() => selectInstructorProfileForAccount([{ ...unlinked, uid: "auth-1" }], candidate), /이미 계정에 연결/);
});

test("instructor Rules isolate private metadata and reject public internal fields", async () => {
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: "demo-gritedu-instructor-privacy",
    firestore: { host: "127.0.0.1", port: 8080, rules }
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc("admins/admin-1").set({ name: "관리자" });
      await db.doc("students/student-1").set({ name: "학생" });
      await db.doc("instructors/legacy-1").set({ name: "기존", instructorId: "legacy-1", email: "legacy@example.test" });
    });
    const admin = environment.authenticatedContext("admin-1").firestore();
    const student = environment.authenticatedContext("student-1").firestore();
    const guest = environment.unauthenticatedContext().firestore();
    const publicRef = admin.doc("instructors/inst_1");
    const privateRef = admin.doc("instructorPrivate/inst_1");
    const accountRef = admin.doc("instructorAccounts/auth-1");
    const profile = { name: "강사", subject: "수학", subjects: ["수학"], instructorId: "inst_1", photo: "photo.webp" };
    const metadata = { uid: "", email: "teacher@example.test", emailLower: "teacher@example.test", note: "내부", pending: true };

    const create = admin.batch();
    create.set(publicRef, profile);
    create.set(privateRef, metadata);
    await assertSucceeds(create.commit());
    const visible = await assertSucceeds(guest.doc("instructors/inst_1").get());
    assert.deepEqual(visible.data(), profile);
    await assertSucceeds(guest.collection("instructors").get());
    await assertFails(guest.doc("instructorPrivate/inst_1").get());
    await assertFails(student.doc("instructorPrivate/inst_1").get());
    await assertFails(student.collection("instructorPrivate").get());
    assert.equal((await assertSucceeds(privateRef.get())).data().note, "내부");
    await assertFails(student.doc("instructorPrivate/inst_1").set({ note: "변조" }));
    await assertFails(publicRef.set({ ...profile, email: "leak@example.test" }));
    await assertFails(publicRef.update({ uid: "auth-1" }));
    await assertFails(publicRef.update({ note: "노출" }));
    await assertSucceeds(publicRef.update({ bio: "소개" }));
    const edit = admin.batch();
    edit.update(publicRef, { name: "수정", subject: "과학", photo: "new.webp", bio: "새 약력", curriculumImageUrls: ["curriculum.webp"] });
    edit.update(privateRef, { email: "new@example.test", emailLower: "new@example.test", note: "수정된 내부 메모" });
    await assertSucceeds(edit.commit());
    assert.equal((await assertSucceeds(guest.doc("instructors/inst_1").get())).data().name, "수정");
    assert.equal((await assertSucceeds(privateRef.get())).data().emailLower, "new@example.test");
    assert.equal((await assertSucceeds(admin.collection("instructorPrivate").where("emailLower", "==", "new@example.test").get())).size, 1);

    const connect = admin.batch();
    connect.update(privateRef, { uid: "auth-1", pending: false });
    connect.set(accountRef, { uid: "auth-1", instructorId: "inst_1", email: "new@example.test" });
    await assertSucceeds(connect.commit());
    assert.equal((await assertSucceeds(accountRef.get())).data().instructorId, "inst_1");
    assert.equal((await assertSucceeds(guest.doc("instructors/inst_1").get())).data().uid, undefined);

    const badBatch = admin.batch();
    badBatch.update(publicRef, { note: "노출" });
    badBatch.update(privateRef, { note: "부분 저장 금지" });
    await assertFails(badBatch.commit());
    assert.equal((await assertSucceeds(privateRef.get())).data().note, "수정된 내부 메모");
    await assertSucceeds(privateRef.update({ note: "재시도 성공" }));

    const legacy = await assertSucceeds(guest.doc("instructors/legacy-1").get());
    assert.equal(legacy.data().name, "기존");
    await assertFails(admin.doc("instructors/legacy-1").update({ bio: "이전 전 수정 차단" }));
    await assertSucceeds(admin.doc("instructors/legacy-1").update({ email: require("firebase/firestore").deleteField() }));

    const remove = admin.batch();
    remove.delete(accountRef);
    remove.delete(publicRef);
    remove.delete(privateRef);
    await assertSucceeds(remove.commit());
    assert.equal((await assertSucceeds(publicRef.get())).exists, false);
    assert.equal((await assertSucceeds(privateRef.get())).exists, false);
    assert.equal((await assertSucceeds(accountRef.get())).exists, false);
  } finally {
    await environment.cleanup();
  }
});

test("linked instructor keeps own account and assigned teaching access without private metadata", async () => {
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: "demo-gritedu-instructor-role",
    firestore: { host: "127.0.0.1", port: 8080, rules }
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc("instructors/profile-a").set({ name: "강사 A", instructorId: "profile-a", subject: "수학" });
      await db.doc("instructorPrivate/profile-a").set({ uid: "teacher-a", note: "관리자 메모" });
      await db.doc("instructorAccounts/teacher-a").set({ uid: "teacher-a", instructorId: "profile-a", email: "a@example.test" });
      await db.doc("instructorAccounts/teacher-b").set({ uid: "teacher-b", instructorId: "profile-b", email: "b@example.test" });
      await db.doc("courses/course-a").set({ instructorUid: "teacher-a", instructorId: "profile-a", title: "담당 강좌" });
      await db.doc("courses/course-b").set({ instructorUid: "teacher-b", instructorId: "profile-b", title: "다른 강좌" });
      await db.doc("offlineClasses/class-a").set({ instructorUid: "teacher-a", instructorId: "profile-a" });
      await db.doc("offlineClasses/class-b").set({ instructorUid: "teacher-b", instructorId: "profile-b" });
      await db.doc("enrollments/enrollment-a").set({ courseId: "course-a", userId: "student-a" });
      await db.doc("enrollments/enrollment-b").set({ courseId: "course-b", userId: "student-b" });
      await db.doc("offlineClassMembers/member-a").set({ classId: "class-a", studentUid: "student-a" });
      await db.doc("offlineClassMembers/member-b").set({ classId: "class-b", studentUid: "student-b" });
    });
    const teacher = environment.authenticatedContext("teacher-a").firestore();
    assert.equal((await assertSucceeds(teacher.doc("instructors/profile-a").get())).data().name, "강사 A");
    assert.equal((await assertSucceeds(teacher.doc("instructorAccounts/teacher-a").get())).data().instructorId, "profile-a");
    await assertFails(teacher.doc("instructorAccounts/teacher-b").get());
    await assertFails(teacher.doc("instructorPrivate/profile-a").get());
    await assertFails(teacher.doc("instructorPrivate/profile-b").get());
    await assertSucceeds(teacher.doc("courses/course-a").get());
    await assertSucceeds(teacher.doc("offlineClasses/class-a").get());
    await assertFails(teacher.doc("offlineClasses/class-b").get());
    await assertSucceeds(teacher.doc("enrollments/enrollment-a").get());
    await assertFails(teacher.doc("enrollments/enrollment-b").get());
    await assertSucceeds(teacher.doc("offlineClassMembers/member-a").get());
    await assertFails(teacher.doc("offlineClassMembers/member-b").get());
  } finally {
    await environment.cleanup();
  }
});
