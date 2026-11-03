// 자녀 연동 시도 예약의 동시성 행동 테스트. Firestore Emulator(127.0.0.1:8080)와 합성 데이터만 사용한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const functionsRequire = createRequire(path.resolve(__dirname, "../functions/package.json"));
const admin = functionsRequire("firebase-admin");
const { MEMBER_CHILD_LINK_POLICY, reserveMemberChildLinkAttempt } = require("../functions/member-child-link-policy");

const app = admin.initializeApp({ projectId: "demo-gritedu-child-link" }, "child-link-reservation");
const db = app.firestore();

test.after(async () => {
  await app.delete();
});

async function clearAttempts(memberUid) {
  const snap = await db.collection("memberChildLinkAttempts").where("memberUid", "==", memberUid).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

async function attemptReservation(memberUid) {
  try {
    return await reserveMemberChildLinkAttempt({ db, memberUid, now: admin.firestore.Timestamp.now() });
  } catch (error) {
    return { error }; // 경합으로 재시도 한도를 넘으면 진행되지 않는다(fail closed).
  }
}

test("동시 요청 20건도 10분 한도(5건)를 넘겨 진행되지 않는다", async () => {
  const memberUid = "parent-burst";
  await clearAttempts(memberUid);
  const results = await Promise.all(Array.from({ length: 20 }, () => attemptReservation(memberUid)));
  const allowed = results.filter((result) => result.decision?.allowed);
  assert.ok(allowed.length <= MEMBER_CHILD_LINK_POLICY.tenMinuteLimit, `허용 ${allowed.length}건`);
  assert.ok(allowed.length >= 1, "한도 안의 요청은 진행된다");
  const stored = await db.collection("memberChildLinkAttempts").where("memberUid", "==", memberUid).get();
  assert.equal(stored.size, allowed.length, "허용된 요청만 예약이 남는다");
  assert.ok(stored.docs.every((doc) => doc.data().result === "pending" && doc.data().cleanupAt));
});

test("결과 기록이 실패해도 예약이 남아 다음 판정에 포함되고, 한도를 넘으면 예약하지 않는다", async () => {
  const memberUid = "parent-sequential";
  await clearAttempts(memberUid);
  for (let index = 0; index < MEMBER_CHILD_LINK_POLICY.tenMinuteLimit; index += 1) {
    const { decision, attemptRef } = await reserveMemberChildLinkAttempt({ db, memberUid, now: admin.firestore.Timestamp.now() });
    assert.equal(decision.allowed, true);
    assert.ok(attemptRef);
  }
  const { decision, attemptRef } = await reserveMemberChildLinkAttempt({ db, memberUid, now: admin.firestore.Timestamp.now() });
  assert.equal(decision.allowed, false);
  assert.equal(attemptRef, null);
  assert.ok(decision.retryAfterSeconds > 0);
  const stored = await db.collection("memberChildLinkAttempts").where("memberUid", "==", memberUid).get();
  assert.equal(stored.size, MEMBER_CHILD_LINK_POLICY.tenMinuteLimit);
});
