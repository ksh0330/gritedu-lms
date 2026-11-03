const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SIGNUP_RATE_LIMIT_POLICY,
  evaluateSignupRateLimit,
} = require("../signup-rate-limit-policy");

function attempt(timestamp) {
  return {timestamp: new Date(timestamp)};
}

test("signup rate limiting is email-first and blocks the sixth hourly send", () => {
  const nowMillis = Date.UTC(2026, 7, 24, 0, 0, 0);
  const emailAttempts = Array.from({length: 5}, (_, index) =>
    attempt(nowMillis - (index + 1) * 5 * 60 * 1000)
  );

  assert.deepEqual(
    evaluateSignupRateLimit({
      emailAttempts: emailAttempts.slice(0, 4),
      nowMillis,
    }),
    {allowed: true}
  );
  const decision = evaluateSignupRateLimit({emailAttempts, nowMillis});
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "too-many-attempts-per-email-hourly");
  assert.ok(decision.retryAfterSeconds >= 60);
});

test("shared IP is only a higher-threshold auxiliary signal", () => {
  const nowMillis = Date.UTC(2026, 7, 24, 0, 0, 0);
  const ipAttempts = Array.from(
    {length: SIGNUP_RATE_LIMIT_POLICY.ipHourlyLimit - 1},
    (_, index) => attempt(nowMillis - (index + 1) * 60 * 1000)
  );

  assert.deepEqual(
    evaluateSignupRateLimit({ipAttempts, nowMillis}),
    {allowed: true}
  );
  assert.deepEqual(
    evaluateSignupRateLimit({
      ipAttempts: [...ipAttempts, attempt(nowMillis - 30 * 1000)],
      nowMillis,
    }).reason,
    "too-many-attempts-per-ip-hourly"
  );
});

test("unknown IP never blocks an email and old attempts leave the window", () => {
  const nowMillis = Date.UTC(2026, 7, 24, 0, 0, 0);
  const oldAttempts = Array.from({length: 100}, () =>
    attempt(nowMillis - SIGNUP_RATE_LIMIT_POLICY.windowMs - 1)
  );

  assert.deepEqual(
    evaluateSignupRateLimit({
      emailAttempts: oldAttempts,
      ipAttempts: oldAttempts,
      nowMillis,
      hasUsableIp: false,
    }),
    {allowed: true}
  );
  assert.equal(
    SIGNUP_RATE_LIMIT_POLICY.attemptRetentionMs,
    24 * 60 * 60 * 1000
  );
  assert.ok(
    SIGNUP_RATE_LIMIT_POLICY.attemptRetentionMs >
      SIGNUP_RATE_LIMIT_POLICY.windowMs
  );
});

test("legacy blockedUntil and reason fields do not restore a week-long block", () => {
  const nowMillis = Date.UTC(2026, 7, 24, 0, 0, 0);
  const legacyBlockedAttempt = {
    timestamp: new Date(nowMillis - 5 * 60 * 1000),
    blockedUntil: new Date(nowMillis + 7 * 24 * 60 * 60 * 1000),
    reason: "too-many-attempts-per-ip-hourly",
  };

  assert.deepEqual(
    evaluateSignupRateLimit({
      emailAttempts: [legacyBlockedAttempt],
      ipAttempts: [legacyBlockedAttempt],
      nowMillis,
    }),
    {allowed: true}
  );
});
