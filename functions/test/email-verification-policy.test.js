const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EMAIL_VERIFICATION_POLICY,
  evaluateEmailVerificationAttempt,
  generateVerificationCode,
  generateVerificationSessionToken,
  hashVerificationSessionToken,
} = require("../email-verification-policy");

const NOW = Date.UTC(2026, 7, 24, 0, 0, 0);

function activeVerification(overrides = {}) {
  const verificationSessionToken = "ab".repeat(32);
  return {
    verificationSessionToken,
    verification: {
      code: "123456",
      sessionTokenHash: hashVerificationSessionToken(
        verificationSessionToken
      ),
      expiresAt: new Date(NOW + EMAIL_VERIFICATION_POLICY.codeTtlMs),
      used: false,
      failedAttempts: 0,
      ...overrides,
    },
  };
}

test("a current code and its active session verify successfully", () => {
  const {verification, verificationSessionToken} = activeVerification();
  assert.deepEqual(evaluateEmailVerificationAttempt({
    verification,
    submittedCode: "123456",
    verificationSessionToken,
    nowMillis: NOW,
  }), {status: "verified", failedAttempts: 0});
});

test("wrong codes increment only the holder of the active session", () => {
  const {verification, verificationSessionToken} = activeVerification();
  assert.deepEqual(evaluateEmailVerificationAttempt({
    verification,
    submittedCode: "000000",
    verificationSessionToken,
    nowMillis: NOW,
  }), {
    status: "wrong-code",
    failedAttempts: 1,
    remainingAttempts: 4,
  });

  assert.deepEqual(evaluateEmailVerificationAttempt({
    verification,
    submittedCode: "000000",
    verificationSessionToken: "cd".repeat(32),
    nowMillis: NOW,
  }), {status: "invalid-session"});
});

test("the fifth wrong code invalidates only the bound verification session", () => {
  const {verification, verificationSessionToken} = activeVerification({
    failedAttempts: EMAIL_VERIFICATION_POLICY.maxFailedAttempts - 1,
  });
  assert.deepEqual(evaluateEmailVerificationAttempt({
    verification,
    submittedCode: "000000",
    verificationSessionToken,
    nowMillis: NOW,
  }), {
    status: "too-many-failures",
    failedAttempts: EMAIL_VERIFICATION_POLICY.maxFailedAttempts,
    remainingAttempts: 0,
  });
});

test("expired and used verification documents are rejected", () => {
  const expired = activeVerification({expiresAt: new Date(NOW)});
  assert.equal(evaluateEmailVerificationAttempt({
    verification: expired.verification,
    submittedCode: "123456",
    verificationSessionToken: expired.verificationSessionToken,
    nowMillis: NOW,
  }).status, "expired");

  const used = activeVerification({used: true});
  assert.equal(evaluateEmailVerificationAttempt({
    verification: used.verification,
    submittedCode: "123456",
    verificationSessionToken: used.verificationSessionToken,
    nowMillis: NOW,
  }).status, "used");
});

test("resend invalidates both the old code and old session while the new pair works", () => {
  const oldSession = activeVerification();
  const newToken = "ef".repeat(32);
  const newVerification = {
    code: "654321",
    sessionTokenHash: hashVerificationSessionToken(newToken),
    expiresAt: new Date(NOW + EMAIL_VERIFICATION_POLICY.codeTtlMs),
    used: false,
    failedAttempts: 0,
  };

  assert.equal(evaluateEmailVerificationAttempt({
    verification: newVerification,
    submittedCode: "123456",
    verificationSessionToken: oldSession.verificationSessionToken,
    nowMillis: NOW,
  }).status, "invalid-session");
  assert.equal(evaluateEmailVerificationAttempt({
    verification: newVerification,
    submittedCode: "654321",
    verificationSessionToken: newToken,
    nowMillis: NOW,
  }).status, "verified");
});

test("codes and verification sessions use cryptographic generators", () => {
  const token = generateVerificationSessionToken((size) => {
    assert.equal(size, EMAIL_VERIFICATION_POLICY.sessionTokenBytes);
    return Buffer.alloc(size, 7);
  });
  assert.equal(token, "07".repeat(EMAIL_VERIFICATION_POLICY.sessionTokenBytes));
  assert.equal(generateVerificationCode("123456", () => 654321), "654321");
  assert.notEqual(generateVerificationCode("123456", () => 123456), "123456");
});
