const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, deleteUser } = require("firebase/auth");
const { deleteField } = require("firebase/firestore");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

const root = path.join(__dirname, "..");
const finalRules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const interimRules = finalRules.replace(
  "allow create, update: if isAdmin() && isPublicInstructorProfile(request.resource.data);",
  "allow create, update: if isAdmin();"
);
assert.notEqual(interimRules, finalRules, "temporary Rules substitution must match the public writer");
const bridgeRules = finalRules.replace(
  "allow create, update: if isAdmin() && isPublicInstructorProfile(request.resource.data);",
  `allow create: if isAdmin() && isPublicInstructorProfile(request.resource.data);
      allow update: if isAdmin()
        && request.resource.data.diff(resource.data).addedKeys().hasOnly([
          'name', 'subject', 'subjects', 'category', 'bio', 'brief', 'photo', 'videos',
          'curriculumImageUrl', 'curriculumImageUrls', 'instructorId', 'order', 'sortOrder',
          'createdAt', 'updatedAt'
        ])
        && request.resource.data.diff(resource.data).changedKeys().hasOnly([
          'name', 'subject', 'subjects', 'category', 'bio', 'brief', 'photo', 'videos',
          'curriculumImageUrl', 'curriculumImageUrls', 'instructorId', 'order', 'sortOrder',
          'createdAt', 'updatedAt'
        ])
        && request.resource.data.diff(resource.data).removedKeys().hasOnly([
          'uid', 'email', 'emailLower', 'phone', 'note', 'pending'
        ]);`
);
assert.notEqual(bridgeRules, finalRules, "bridge Rules substitution must match the public writer");

async function helpers() {
  const source = fs.readFileSync(path.join(root, "assets/js/utils/instructor-privacy.js"), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

async function environment(projectId, rules = finalRules) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules }
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("admins/admin-1").set({ name: "QA 관리자" });
  });
  return env;
}

function authClient(projectId, name) {
  const app = initializeApp({ apiKey: "demo-key", projectId, authDomain: "localhost" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  return { app, auth };
}

test("profile-first and account-first preserve one public ID and assigned references", async () => {
  const projectId = "demo-instructor-lifecycle-order";
  const env = await environment(projectId);
  const { publicInstructorData, privateInstructorData, mergeInstructorPrivate,
    selectInstructorProfileForAccount } = await helpers();
  const authA = authClient(projectId, "profile-first");
  const authB = authClient(projectId, "account-first");
  try {
    const admin = env.authenticatedContext("admin-1").firestore();
    const guest = env.unauthenticatedContext().firestore();
    const profileId = "profile-before-account";
    const publicRef = admin.doc(`instructors/${profileId}`);
    const privateRef = admin.doc(`instructorPrivate/${profileId}`);
    const publicData = publicInstructorData({ instructorId: profileId, name: "합성 강사 A", subject: "수학",
      subjects: ["수학"], photo: "fixture-photo.webp", bio: "공개 약력", email: "a@example.test", note: "비공개" });
    const createProfile = admin.batch();
    createProfile.set(publicRef, publicData);
    createProfile.set(privateRef, privateInstructorData({ email: "a@example.test", note: "비공개", pending: true }));
    await assertSucceeds(createProfile.commit());
    await assertSucceeds(admin.doc("courses/assigned").set({ instructorId: profileId, instructorUid: profileId, title: "합성 강좌" }));
    await assertSucceeds(admin.doc("offlineClasses/assigned").set({ instructorId: profileId, instructorUid: profileId, className: "합성 반" }));
    const visibleBefore = (await assertSucceeds(guest.doc(`instructors/${profileId}`).get())).data();
    assert.equal(visibleBefore.email, undefined);
    assert.equal(visibleBefore.photo, "fixture-photo.webp");
    const merged = mergeInstructorPrivate(visibleBefore, (await privateRef.get()).data());
    const match = selectInstructorProfileForAccount([{ ...merged, id: profileId }],
      { name: "합성 강사 A", subjects: ["수학"], email: "a@example.test" });
    assert.equal(match.id, profileId);
    const credentialA = await createUserWithEmailAndPassword(authA.auth, "a@example.test", "Password1!");
    const uidA = credentialA.user.uid;
    const connect = admin.batch();
    connect.set(publicRef, publicData, { merge: true });
    connect.set(privateRef, privateInstructorData({ ...merged, uid: uidA, pending: false }), { merge: true });
    connect.set(admin.doc(`instructorAccounts/${uidA}`), { uid: uidA, instructorId: profileId,
      email: "a@example.test", name: "합성 강사 A", subject: "수학" });
    await assertSucceeds(connect.commit());
    assert.equal((await publicRef.get()).data().photo, "fixture-photo.webp");
    assert.equal((await admin.doc("courses/assigned").get()).data().instructorId, profileId);
    assert.equal((await admin.doc("offlineClasses/assigned").get()).data().instructorUid, profileId);
    const teacher = env.authenticatedContext(uidA).firestore();
    await assertSucceeds(teacher.doc(`instructorAccounts/${uidA}`).get());
    await assertSucceeds(teacher.doc("courses/assigned").get());
    await assertSucceeds(teacher.doc("offlineClasses/assigned").get());
    await assertFails(teacher.doc(`instructorPrivate/${profileId}`).get());

    // Existing account-first policy creates its profile in the same Firestore batch.
    const credentialB = await createUserWithEmailAndPassword(authB.auth, "b@example.test", "Password1!");
    const uidB = credentialB.user.uid;
    assert.equal(selectInstructorProfileForAccount([{ ...merged, id: profileId }],
      { name: "합성 강사 B", subjects: ["영어"], email: "b@example.test" }), null);
    const accountFirstId = "profile-created-with-account";
    const createTogether = admin.batch();
    createTogether.set(admin.doc(`instructors/${accountFirstId}`), publicInstructorData({
      instructorId: accountFirstId, name: "합성 강사 B", subject: "영어", subjects: ["영어"] }));
    createTogether.set(admin.doc(`instructorPrivate/${accountFirstId}`), privateInstructorData({
      uid: uidB, email: "b@example.test", pending: false }));
    createTogether.set(admin.doc(`instructorAccounts/${uidB}`), { uid: uidB, instructorId: accountFirstId,
      email: "b@example.test", name: "합성 강사 B", subject: "영어" });
    await assertSucceeds(createTogether.commit());
    const edit = admin.batch();
    edit.update(admin.doc(`instructors/${accountFirstId}`), { bio: "추가 약력", photo: "later.webp" });
    edit.update(admin.doc(`instructorPrivate/${accountFirstId}`), { note: "나중에 입력한 메모" });
    await assertSucceeds(edit.commit());
    assert.equal((await admin.collection("instructors").get()).size, 2);
    assert.equal((await admin.doc(`instructors/${accountFirstId}`).get()).data().bio, "추가 약력");
    assert.equal((await admin.doc(`instructorAccounts/${uidB}`).get()).data().instructorId, accountFirstId);
    assert.equal((await guest.doc(`instructors/${accountFirstId}`).get()).data().note, undefined);
  } finally {
    await deleteApp(authA.app);
    await deleteApp(authB.app);
    await env.cleanup();
  }
});

test("Auth creation failure, Firestore failure, unlink, reconnect and deletion have explicit recovery", async () => {
  const projectId = "demo-instructor-lifecycle-recovery";
  const env = await environment(projectId);
  const authA = authClient(projectId, "recovery-primary");
  const authB = authClient(projectId, "recovery-secondary");
  try {
    const admin = env.authenticatedContext("admin-1").firestore();
    const profileId = "reconnect-profile";
    const publicRef = admin.doc(`instructors/${profileId}`);
    const privateRef = admin.doc(`instructorPrivate/${profileId}`);
    await assertSucceeds(publicRef.set({ instructorId: profileId, name: "합성 강사", subject: "수학", photo: "kept.webp" }));
    await assertSucceeds(privateRef.set({ uid: "", email: "reconnect@example.test", emailLower: "reconnect@example.test",
      note: "유지 메모", pending: true }));
    const credential = await createUserWithEmailAndPassword(authA.auth, "reconnect@example.test", "Password1!");
    const uid = credential.user.uid;
    await assert.rejects(createUserWithEmailAndPassword(authB.auth, "reconnect@example.test", "Password1!"),
      /email-already-in-use/);
    const invalid = admin.batch();
    invalid.update(publicRef, { email: "재노출 금지" });
    invalid.update(privateRef, { uid, pending: false });
    await assertFails(invalid.commit());
    assert.equal((await privateRef.get()).data().uid, "");
    await deleteUser(credential.user); // Client rollback after the failed Firestore batch.
    const retried = await createUserWithEmailAndPassword(authB.auth, "reconnect@example.test", "Password1!");
    const newUid = retried.user.uid;
    const link = admin.batch();
    link.update(privateRef, { uid: newUid, pending: false });
    link.set(admin.doc(`instructorAccounts/${newUid}`), { uid: newUid, instructorId: profileId,
      email: "reconnect@example.test" });
    await assertSucceeds(link.commit());
    await assertSucceeds(admin.doc("courses/reconnect-course").set({ instructorId: profileId, instructorUid: newUid }));
    await assertSucceeds(admin.doc("offlineClasses/reconnect-class").set({ instructorId: profileId, instructorUid: newUid }));

    const unlink = admin.batch();
    unlink.update(admin.doc("courses/reconnect-course"), { instructorId: profileId, instructorUid: profileId });
    unlink.update(admin.doc("offlineClasses/reconnect-class"), { instructorId: profileId, instructorUid: profileId });
    unlink.delete(admin.doc(`instructorAccounts/${newUid}`));
    unlink.update(publicRef, { uid: deleteField(), email: deleteField(), emailLower: deleteField(),
      phone: deleteField(), note: deleteField(), pending: deleteField() });
    unlink.set(privateRef, { uid: "", email: "", emailLower: "", pending: true }, { merge: true });
    await assertSucceeds(unlink.commit());
    assert.equal((await publicRef.get()).data().photo, "kept.webp");
    assert.equal((await privateRef.get()).data().note, "유지 메모");
    assert.equal((await admin.doc("courses/reconnect-course").get()).data().instructorUid, profileId);
    assert.equal((await admin.doc("offlineClasses/reconnect-class").get()).data().instructorId, profileId);
    await assert.rejects(createUserWithEmailAndPassword(authA.auth, "reconnect@example.test", "Password1!"),
      /email-already-in-use/); // Firestore unlink does not remove the Auth identity.
    await deleteUser(retried.user); // Existing policy requires separate Auth deletion.
    const third = await createUserWithEmailAndPassword(authA.auth, "reconnect@example.test", "Password1!");
    const relink = admin.batch();
    relink.update(privateRef, { uid: third.user.uid, email: "reconnect@example.test",
      emailLower: "reconnect@example.test", pending: false });
    relink.set(admin.doc(`instructorAccounts/${third.user.uid}`), { uid: third.user.uid,
      instructorId: profileId, email: "reconnect@example.test" });
    await assertSucceeds(relink.commit());
    assert.equal((await admin.doc(`instructorAccounts/${third.user.uid}`).get()).data().instructorId, profileId);

    const remove = admin.batch();
    remove.update(admin.doc("courses/reconnect-course"), { instructorUid: null, instructorId: null });
    remove.update(admin.doc("offlineClasses/reconnect-class"), { instructorUid: "", instructorId: "" });
    remove.delete(admin.doc(`instructorAccounts/${third.user.uid}`));
    remove.delete(publicRef);
    remove.delete(privateRef);
    await assertSucceeds(remove.commit());
    assert.equal((await publicRef.get()).exists, false);
    assert.equal((await privateRef.get()).exists, false);
    assert.equal((await admin.doc(`instructorAccounts/${third.user.uid}`).get()).exists, false);
  } finally {
    await deleteApp(authA.app);
    await deleteApp(authB.app);
    await env.cleanup();
  }
});

test("synthetic migration copies and verifies private fields before final Rules reject old writers", async () => {
  const projectId = "demo-instructor-rollout-rehearsal";
  let env = await environment(projectId, interimRules);
  try {
    const admin = env.authenticatedContext("admin-1").firestore();
    const guest = env.unauthenticatedContext().firestore();
    const publicRef = admin.doc("instructors/legacy-profile");
    const privateRef = admin.doc("instructorPrivate/legacy-profile");
    await assertSucceeds(publicRef.set({ instructorId: "legacy-profile", name: "합성 강사", subject: "수학",
      uid: "auth-legacy", email: "legacy@example.test", emailLower: "legacy@example.test",
      phone: "000-0000-0000", note: "내부", pending: false }));
    await assertSucceeds(admin.doc("instructorAccounts/auth-legacy").set({ uid: "auth-legacy",
      instructorId: "legacy-profile", email: "legacy@example.test" }));
    await assertFails(guest.doc("instructorPrivate/legacy-profile").get());
    const original = (await publicRef.get()).data();
    await assertSucceeds(privateRef.set({ uid: original.uid, email: original.email,
      emailLower: original.emailLower, phone: original.phone, note: original.note, pending: original.pending }));
    const copied = (await privateRef.get()).data();
    for (const field of ["uid", "email", "emailLower", "phone", "note", "pending"]) {
      assert.deepEqual(copied[field], original[field]);
    }
    await assertSucceeds(publicRef.update({ uid: deleteField(), email: deleteField(), emailLower: deleteField(),
      phone: deleteField(), note: deleteField(), pending: deleteField() }));
    const cleaned = (await publicRef.get()).data();
    assert.deepEqual(Object.keys(cleaned).sort(), ["instructorId", "name", "subject"]);
    assert.equal((await admin.doc("instructorAccounts/auth-legacy").get()).data().instructorId, "legacy-profile");
  } finally {
    await env.cleanup();
  }
  env = await environment(projectId, finalRules);
  try {
    const admin = env.authenticatedContext("admin-1").firestore();
    const guest = env.unauthenticatedContext().firestore();
    const publicRef = admin.doc("instructors/legacy-profile");
    const privateRef = admin.doc("instructorPrivate/legacy-profile");
    await assertFails(publicRef.set({ email: "old-client@example.test" }, { merge: true }));
    await assertSucceeds(publicRef.update({ bio: "최종 Rules 후 공개 수정" }));
    await assertSucceeds(privateRef.update({ note: "최종 Rules 후 비공개 수정" }));
    await assertFails(guest.doc("instructorPrivate/legacy-profile").get());
    assert.equal((await assertSucceeds(guest.doc("instructors/legacy-profile").get())).data().email, undefined);
  } finally {
    await env.cleanup();
  }
});

test("bridge Rules allow new public edits and private copy while blocking internal changes and reinsertion", async () => {
  const env = await environment("demo-instructor-bridge", bridgeRules);
  try {
    const admin = env.authenticatedContext("admin-1").firestore();
    const publicRef = admin.doc("instructors/bridge-profile");
    const privateRef = admin.doc("instructorPrivate/bridge-profile");
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("instructors/bridge-profile").set({
        instructorId: "bridge-profile", name: "합성 강사", subject: "수학",
        email: "legacy@example.test", note: "기존 메모", uid: "legacy-auth", pending: false
      });
    });
    const normalEdit = admin.batch();
    normalEdit.update(publicRef, { bio: "새 관리자 공개 수정" });
    normalEdit.set(privateRef, { email: "legacy@example.test", note: "기존 메모", uid: "legacy-auth" });
    await assertSucceeds(normalEdit.commit());
    await assertFails(publicRef.update({ note: "구버전 메모 수정" }));
    await assertFails(admin.doc("instructors/old-create").set({ name: "구버전 생성", email: "old@example.test" }));
    await assertSucceeds(publicRef.update({ email: deleteField(), note: deleteField(),
      uid: deleteField(), pending: deleteField() }));
    await assertFails(publicRef.set({ email: "reintroduced@example.test" }, { merge: true }));
    await assertSucceeds(publicRef.update({ brief: "새 관리자 후속 수정" }));
    const newProfile = admin.batch();
    newProfile.set(admin.doc("instructors/new-profile"), { name: "신규 강사", subject: "수학" });
    newProfile.set(admin.doc("instructorPrivate/new-profile"), { email: "new@example.test", pending: true });
    await assertSucceeds(newProfile.commit());
    assert.equal((await publicRef.get()).data().email, undefined);
    assert.equal((await privateRef.get()).data().email, "legacy@example.test");
  } finally {
    await env.cleanup();
  }
});
