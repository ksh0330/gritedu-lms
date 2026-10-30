const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const { migrate, moveOne } = require("../scripts/migrate-instructor-private.js");

const admin = createRequire(path.resolve(__dirname, "../functions/package.json"))("firebase-admin");
const expected = { instructors: 2, instructorAccounts: 2, courses: 1, offlineClasses: 1 };

test("per-profile transaction copies original private values and removes public fields atomically", async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) return t.skip("Firestore Emulator required");
  const app = admin.initializeApp({ projectId: "demo-private-migration" }, "migration-test");
  const db = app.firestore();
  try {
    const first = db.collection("instructors").doc("profile-a");
    const second = db.collection("instructors").doc("profile-b");
    await Promise.all([
      first.set({ name: "공개 A", subject: "수학", uid: "auth-a", email: "A@example.test",
        emailLower: "a@example.test", note: "", pending: false, order: 2 }),
      second.set({ name: "공개 B", subject: "영어", uid: "auth-b", email: "B@example.test",
        emailLower: "b@example.test", phone: "01000000000", note: "내부", pending: false, order: 1 }),
      db.collection("instructorAccounts").doc("auth-a").set({ uid: "auth-a", instructorId: "profile-a", emailLower: "a@example.test" }),
      db.collection("instructorAccounts").doc("auth-b").set({ uid: "auth-b", instructorId: "profile-b", emailLower: "b@example.test" }),
      db.collection("courses").doc("course-a").set({ instructorId: "profile-a", instructorUid: "auth-a" }),
      db.collection("offlineClasses").doc("class-b").set({ instructorId: "profile-b", instructorUid: "auth-b" })
    ]);
    const dry = await migrate(db, admin.firestore.FieldValue, { expected });
    assert.equal(dry.mode, "DRY_RUN");
    assert.equal(dry.toMove, 2);
    assert.equal((await db.collection("instructorPrivate").get()).size, 0);

    assert.equal(await moveOne(db, "profile-a", admin.firestore.FieldValue), "moved");
    await db.collection("instructorPrivate").doc("profile-b").set({ uid: "wrong", email: "B@example.test" });
    await assert.rejects(migrate(db, admin.firestore.FieldValue, { apply: true, expected }), /PRIVATE_CONFLICT/);
    assert.equal((await first.get()).data().uid, undefined);
    assert.equal((await second.get()).data().uid, "auth-b");
    await db.collection("instructorPrivate").doc("profile-b").delete();

    const result = await migrate(db, admin.firestore.FieldValue, { apply: true, expected });
    assert.equal(result.moved, 1);
    assert.equal(result.toMove, 0);
    assert.equal(result.private, 2);
    const publicA = (await first.get()).data();
    const privateA = (await db.collection("instructorPrivate").doc("profile-a").get()).data();
    const publicB = (await second.get()).data();
    const privateB = (await db.collection("instructorPrivate").doc("profile-b").get()).data();
    for (const data of [publicA, publicB]) {
      for (const key of ["uid", "email", "emailLower", "phone", "note", "pending"]) assert.equal(key in data, false);
    }
    assert.deepEqual(privateA, { uid: "auth-a", email: "A@example.test", emailLower: "a@example.test", note: "", pending: false });
    assert.deepEqual(privateB, { uid: "auth-b", email: "B@example.test", emailLower: "b@example.test", phone: "01000000000", note: "내부", pending: false });
    assert.equal(publicA.order, 2);
    assert.equal(publicB.order, 1);
    assert.equal((await db.collection("courses").doc("course-a").get()).data().instructorId, "profile-a");
    assert.equal((await db.collection("offlineClasses").doc("class-b").get()).data().instructorUid, "auth-b");
    assert.equal((await migrate(db, admin.firestore.FieldValue, { apply: true, expected })).moved, 0);
  } finally {
    await app.delete();
  }
});
