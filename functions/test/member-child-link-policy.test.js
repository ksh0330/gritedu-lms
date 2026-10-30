const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEMBER_CHILD_LINK_POLICY,
  countsTowardMemberChildLimit,
  evaluateMemberChildLinkRateLimit,
  getMemberChildAttemptRetentionDays,
  getStudentNameFallbackPrefixes,
  normalizeStudentName,
  studentNamesMatch,
} = require("../member-child-link-policy");

function attempt(result, createdAt) {
  return {result, createdAt: new Date(createdAt)};
}

test("successful and already-limited responses do not extend blocking", () => {
  assert.equal(countsTowardMemberChildLimit({result: "linked"}), false);
  assert.equal(countsTowardMemberChildLimit({result: "rateLimited"}), false);
  assert.equal(countsTowardMemberChildLimit({result: "notFound"}), true);
  assert.equal(countsTowardMemberChildLimit({result: "alreadyLinked"}), true);
  assert.equal(countsTowardMemberChildLimit({result: "notMember"}), true);
  assert.equal(countsTowardMemberChildLimit({result: "inactiveMember"}), true);
  assert.equal(countsTowardMemberChildLimit({result: "notParent"}), true);
});

test("child-link limits allow retries but bound repeated failed matching", () => {
  const nowMillis = Date.UTC(2026, 7, 24, 0, 0, 0);
  const failures = Array.from(
    {length: MEMBER_CHILD_LINK_POLICY.tenMinuteLimit},
    (_, index) => attempt("notFound", nowMillis - (index + 1) * 60 * 1000)
  );
  const ignored = [
    attempt("linked", nowMillis - 30 * 1000),
    attempt("rateLimited", nowMillis - 20 * 1000),
  ];

  const decision = evaluateMemberChildLinkRateLimit({
    attempts: [...failures, ...ignored],
    nowMillis,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "too-many-attempts-10m");
  assert.equal(decision.tenMinuteCount, MEMBER_CHILD_LINK_POLICY.tenMinuteLimit);
  assert.ok(decision.retryAfterSeconds >= 5 * 60);
  assert.ok(decision.retryAfterSeconds <= 10 * 60);
});

test("child-link daily limit applies outside the ten-minute window", () => {
  const nowMillis = Date.UTC(2026, 7, 24, 0, 0, 0);
  const failures = Array.from(
    {length: MEMBER_CHILD_LINK_POLICY.dailyLimit},
    (_, index) => attempt("notFound", nowMillis - (index + 1) * 60 * 60 * 1000)
  );

  const decision = evaluateMemberChildLinkRateLimit({
    attempts: failures,
    nowMillis,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "too-many-attempts-24h");
  assert.equal(decision.oneDayCount, MEMBER_CHILD_LINK_POLICY.dailyLimit);
  assert.ok(decision.retryAfterSeconds >= 8 * 60 * 60);
  assert.ok(decision.retryAfterSeconds <= 10 * 60 * 60);
});

test("attempt retention keeps failures briefly and relies on the canonical link", () => {
  assert.equal(getMemberChildAttemptRetentionDays("notFound"), 7);
  assert.equal(getMemberChildAttemptRetentionDays("invalidInput"), 7);
  assert.equal(getMemberChildAttemptRetentionDays("ambiguous"), 7);
  assert.equal(getMemberChildAttemptRetentionDays("linked"), 1);
  assert.equal(getMemberChildAttemptRetentionDays("alreadyLinked"), 1);
});

test("student name matching preserves canonical and legacy whitespace compatibility", () => {
  assert.equal(normalizeStudentName(" 홍  길동 "), "홍 길동");
  assert.equal(studentNamesMatch("홍길동", "홍길동"), true);
  assert.equal(studentNamesMatch("홍  길동", "홍 길동"), true);
  assert.equal(studentNamesMatch(" 홍길동 ", "홍길동"), true);
  assert.deepEqual(
    getStudentNameFallbackPrefixes("홍 길동"),
    ["홍 ", " "]
  );
});
