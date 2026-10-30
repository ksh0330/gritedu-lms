const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

test("approval requests and protected videos respect student, general member, and parent boundaries", async () => {
  const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  const environment = await initializeTestEnvironment({
    projectId: "demo-gritedu-approval",
    firestore: { host: "127.0.0.1", port: 8080, rules }
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        db.doc("students/student-1").set({ name: "학생", email: "student@example.test" }),
        db.doc("members/member-1").set({ name: "회원", email: "member@example.test", memberPurpose: "general" }),
        db.doc("members/parent-1").set({ name: "학부모", email: "parent@example.test", memberPurpose: "parent" }),
        db.doc("studentParentLinks/student-1_parent-1").set({ studentUid: "student-1", memberUid: "parent-1", status: "active" }),
        db.doc("admins/admin-1").set({ name: "관리자" }),
        db.doc("instructorAccounts/instructor-1").set({ instructorId: "profile-1", name: "담당 강사" }),
        db.doc("instructorAccounts/instructor-2").set({ instructorId: "profile-2", name: "다른 강사" }),
        db.doc("courses/approval-1").set({ accessType: "approvalRequired", status: "published", instructorId: "profile-1", weeks: [], previewVideoUrl: null }),
        db.doc("courses/public-1").set({ accessType: "public", status: "published", weeks: [{ videos: [{ url: "https://youtu.be/RjSFJQ60zHg" }] }] }),
        db.doc("courses/open-1").set({ accessType: "memberOnly", status: "published" }),
        db.doc("coursePrivateContent/approval-1").set({ weeks: [{ videos: [{ url: "https://youtube.com/live/RjSFJQ60zHg" }] }] })
      ]);
    });

    const student = environment.authenticatedContext("student-1").firestore();
    const member = environment.authenticatedContext("member-1").firestore();
    const parent = environment.authenticatedContext("parent-1").firestore();
    const admin = environment.authenticatedContext("admin-1").firestore();
    const assignedInstructor = environment.authenticatedContext("instructor-1").firestore();
    const otherInstructor = environment.authenticatedContext("instructor-2").firestore();
    const guest = environment.unauthenticatedContext().firestore();
    const privatePath = "coursePrivateContent/approval-1";
    const requestPath = (uid) => `courses/approval-1/enrollmentRequests/${uid}`;
    const requestData = (uid, learnerType) => ({ courseId: "approval-1", userId: uid, learnerType, status: "pending", createdAt: new Date(), updatedAt: new Date() });

    const namedStudents = await assertSucceeds(admin.collection("students").where("name", ">=", "학").where("name", "<=", "학\uf8ff").limit(20).get());
    const emailedMembers = await assertSucceeds(admin.collection("members").where("email", "==", "member@example.test").limit(20).get());
    assert.equal(namedStudents.size, 1);
    assert.equal(emailedMembers.size, 1);
    await assertFails(student.collection("members").where("email", "==", "member@example.test").limit(20).get());

    const newCourse = admin.batch();
    newCourse.set(admin.doc("courses/approval-new"), { accessType: "approvalRequired", status: "published", title: "합성 강좌", weeks: [], previewVideoUrl: null });
    newCourse.set(admin.doc("coursePrivateContent/approval-new"), { weeks: [{ title: "1주차", videos: [{ url: "https://www.youtube.com/playlist?list=PLaT4Dc4NvTY0" }] }] });
    await assertSucceeds(newCourse.commit());
    assert.equal((await guest.doc("courses/approval-new").get()).data().weeks.length, 0);
    assert.equal((await admin.doc("coursePrivateContent/approval-new").get()).data().weeks[0].videos.length, 1);
    const badCourse = admin.batch();
    badCourse.set(admin.doc("courses/approval-bad"), { accessType: "approvalRequired", status: "published", weeks: [{ videos: [{ url: "https://youtu.be/RjSFJQ60zHg" }] }] });
    badCourse.set(admin.doc("coursePrivateContent/approval-bad"), { weeks: [] });
    await assertFails(badCourse.commit());
    assert.equal((await admin.doc("coursePrivateContent/approval-bad").get()).exists, false);

    const publicCourse = await assertSucceeds(guest.doc("courses/approval-1").get());
    assert.equal(JSON.stringify(publicCourse.data()).includes("RjSFJQ60zHg"), false);
    const legacyPublic = await assertSucceeds(guest.doc("courses/public-1").get());
    assert.equal(legacyPublic.data().weeks[0].videos[0].url, "https://youtu.be/RjSFJQ60zHg");
    await assertSucceeds(guest.doc("courses/open-1").get());
    await assertFails(admin.doc("courses/leaking-1").set({ accessType: "approvalRequired", status: "published", weeks: [{ videos: [{ url: "https://youtu.be/RjSFJQ60zHg" }] }] }));
    await assertFails(admin.doc("courses/leaking-2").set({ accessType: "approvalRequired", status: "published", weeks: [], previewUrl: "https://youtu.be/RjSFJQ60zHg" }));
    await assertFails(admin.doc("courses/leaking-3").set({ accessType: "approvalRequired", status: "published", weeks: [], learningContent: "https://youtu.be/RjSFJQ60zHg" }));
    await assertFails(guest.doc(privatePath).get());
    await assertFails(guest.collection("coursePrivateContent").get());
    await assertFails(student.doc(privatePath).get());
    await assertSucceeds(assignedInstructor.doc(privatePath).get());
    await assertFails(otherInstructor.doc(privatePath).get());
    await assertFails(assignedInstructor.collection("coursePrivateContent").get());
    await assertSucceeds(student.doc(requestPath("student-1")).set(requestData("student-1", "student")));
    await assertSucceeds(member.doc(requestPath("member-1")).set(requestData("member-1", "member")));
    const pending = await assertSucceeds(admin.collection("courses/approval-1/enrollmentRequests").where("status", "==", "pending").limit(30).get());
    assert.equal(pending.size, 2);
    await assertFails(guest.doc(requestPath("guest-1")).set(requestData("guest-1", "student")));
    await assertFails(parent.doc(requestPath("parent-1")).set(requestData("parent-1", "member")));
    await assertFails(student.doc(requestPath("member-1")).set(requestData("member-1", "student")));
    await assertFails(student.doc(requestPath("student-1")).set(requestData("student-1", "student")));
    await assertFails(student.doc(requestPath("student-1")).update({ status: "approved" }));
    await assertFails(student.doc(requestPath("student-1")).delete());
    await assertFails(student.doc(requestPath("student-1")).set({ ...requestData("student-1", "student"), status: "approved" }));
    await assertFails(student.doc("enrollments/student-1_approval-1").set({ userId: "student-1", courseId: "approval-1", status: "active" }));
    await assertFails(admin.doc("enrollments/parent-1_approval-1").set({ userId: "parent-1", courseId: "approval-1", learnerType: "member", status: "active" }));
    await assertFails(admin.doc("enrollments/parent-1_approval-1").set({ userId: "parent-1", courseId: "approval-1", learnerType: "member", status: "revoked" }));
    await assertFails(admin.doc("enrollments/duplicate-approval-1").set({ userId: "student-1", courseId: "approval-1", learnerType: "student", status: "active" }));
    const invalidReview = admin.batch();
    invalidReview.update(admin.doc(requestPath("student-1")), { status: "approved" });
    invalidReview.set(admin.doc("enrollments/parent-1_approval-1"), { userId: "parent-1", courseId: "approval-1", learnerType: "member", status: "active" });
    await assertFails(invalidReview.commit());
    assert.equal((await admin.doc(requestPath("student-1")).get()).data().status, "pending");
    await assertSucceeds(student.doc("enrollments/student-1_open-1").set({
      userId: "student-1", courseId: "open-1", status: "active", progress: 0,
      learnerType: "student",
      studentSnapshot: { name: "학생", email: "student@example.test", phone: "", school: "", grade: "" },
      learnerSnapshot: { name: "학생", email: "student@example.test", phone: "", type: "student", school: "", grade: "" }
    }));

    await assertSucceeds(admin.doc("enrollments/student-1_approval-1").set({ userId: "student-1", courseId: "approval-1", learnerType: "student", status: "active", progress: 0 }));
    await assertSucceeds(parent.doc("enrollments/student-1_approval-1").get());
    const protectedSnap = await assertSucceeds(student.doc(privatePath).get());
    assert.equal(protectedSnap.data().weeks[0].videos[0].url, "https://youtube.com/live/RjSFJQ60zHg");
    await assertFails(parent.doc(privatePath).get());
    await assertFails(student.doc("enrollments/student-1_approval-1").delete());
    await assertSucceeds(student.doc("enrollments/student-1_approval-1").update({ progress: 50 }));
    await assertSucceeds(admin.doc("enrollments/student-1_approval-1").update({ status: "revoked" }));
    await assertFails(student.doc(privatePath).get());
    await assertFails(student.doc("enrollments/student-1_approval-1").update({ status: "active" }));

    await assertSucceeds(admin.doc("courses/approval-1/enrollmentRequests/student-1").update({ status: "approved" }));
    await assertSucceeds(admin.doc("courses/approval-1/enrollmentRequests/member-1").update({ status: "rejected" }));
    await assertFails(member.doc(privatePath).get());
    await assertFails(member.doc(requestPath("member-1")).set(requestData("member-1", "member")));
    await assertSucceeds(admin.doc("enrollments/member-1_approval-1").set({ userId: "member-1", courseId: "approval-1", learnerType: "member", status: "active", progress: 0 }));
    await assertSucceeds(member.doc(privatePath).get());
    await assertFails(member.doc(requestPath("member-1")).update({ status: "approved" }));
    await assertFails(admin.doc("courses/public-1").update({ accessType: "approvalRequired", weeks: [] }));
    await assertFails(admin.doc("courses/open-1").update({ accessType: "public" }));
    await assertFails(admin.doc("courses/approval-1").update({ accessType: "memberOnly" }));
    await assertSucceeds(admin.doc("courses/public-1").update({ title: "공개 수정", status: "archived" }));
    await assertSucceeds(admin.doc("courses/open-1").update({ title: "회원 수정", status: "archived" }));
    await assertSucceeds(admin.doc("courses/approval-1").update({ title: "승인 수정", weeks: [] }));
    await assertSucceeds(admin.doc("coursePrivateContent/approval-1").update({ weeks: [{ videos: [{ url: "https://www.youtube.com/playlist?list=PLaT4Dc4NvTY0" }] }] }));
    await assertSucceeds(admin.doc("courses/approval-1").update({ status: "archived" }));
    await assertSucceeds(admin.doc("courses/approval-1").update({ status: "published" }));
    await assertFails(student.doc("courses/approval-1").delete());
    const courseDelete = admin.batch();
    courseDelete.delete(admin.doc("courses/approval-1/enrollmentRequests/student-1"));
    courseDelete.delete(admin.doc("courses/approval-1/enrollmentRequests/member-1"));
    courseDelete.delete(admin.doc("coursePrivateContent/approval-1"));
    courseDelete.delete(admin.doc("enrollments/student-1_approval-1"));
    courseDelete.delete(admin.doc("enrollments/member-1_approval-1"));
    courseDelete.delete(admin.doc("courses/approval-1"));
    await assertSucceeds(courseDelete.commit());
    assert.equal((await admin.doc("coursePrivateContent/approval-1").get()).exists, false);
    assert.equal((await admin.doc("courses/approval-1/enrollmentRequests/student-1").get()).exists, false);
    assert.equal((await admin.doc("courses/approval-1/enrollmentRequests/member-1").get()).exists, false);
    assert.equal((await admin.doc("enrollments/student-1_approval-1").get()).exists, false);
    assert.equal((await admin.doc("enrollments/member-1_approval-1").get()).exists, false);
    assert.equal((await admin.doc("courses/public-1").get()).data().title, "공개 수정");
    assert.equal((await admin.doc("courses/open-1").get()).data().title, "회원 수정");
  } finally {
    await environment.cleanup();
  }
});
