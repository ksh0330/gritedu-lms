const crypto = require("node:crypto");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const EMAIL_VERIFICATION_POLICY = Object.freeze({
  codeTtlMs: 5 * MINUTE_MS,
  cleanupGraceMs: 24 * HOUR_MS,
  maxFailedAttempts: 5,
  sessionTokenBytes: 32,
});

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function generateVerificationCode(excludedCode = "", randomInt = crypto.randomInt) {
  const excluded = String(excludedCode || "");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = String(randomInt(100000, 1000000));
    if (code !== excluded) return code;
  }

  const fallback = excluded === "999999" ? 100000 : Number(excluded) + 1;
  return String(Number.isInteger(fallback) ? fallback : 100000).padStart(6, "0");
}

function generateVerificationSessionToken(randomBytes = crypto.randomBytes) {
  return randomBytes(EMAIL_VERIFICATION_POLICY.sessionTokenBytes).toString("hex");
}

function hashVerificationSessionToken(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function verificationSessionMatches(storedHash, submittedToken) {
  const expected = String(storedHash || "");
  const submitted = String(submittedToken || "");
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(submitted)) {
    return false;
  }

  const actualHash = hashVerificationSessionToken(submitted);
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actualHash, "hex")
  );
}

function evaluateEmailVerificationAttempt({
  verification = {},
  submittedCode = "",
  verificationSessionToken = "",
  nowMillis = Date.now(),
  policy = EMAIL_VERIFICATION_POLICY,
} = {}) {
  if (!verificationSessionMatches(
    verification.sessionTokenHash,
    verificationSessionToken
  )) {
    return {status: "invalid-session"};
  }

  if (verification.used === true) {
    return {status: "used"};
  }

  const expiresAtMillis = timestampToMillis(verification.expiresAt);
  if (expiresAtMillis == null || expiresAtMillis <= nowMillis) {
    return {status: "expired"};
  }

  const failedAttempts = Number.isFinite(verification.failedAttempts)
    ? Math.max(0, Number(verification.failedAttempts))
    : 0;

  if (String(verification.code || "") !== String(submittedCode || "")) {
    const nextFailedAttempts = failedAttempts + 1;
    return {
      status: nextFailedAttempts >= policy.maxFailedAttempts
        ? "too-many-failures"
        : "wrong-code",
      failedAttempts: nextFailedAttempts,
      remainingAttempts: Math.max(0, policy.maxFailedAttempts - nextFailedAttempts),
    };
  }

  return {status: "verified", failedAttempts};
}

module.exports = {
  EMAIL_VERIFICATION_POLICY,
  evaluateEmailVerificationAttempt,
  generateVerificationCode,
  generateVerificationSessionToken,
  hashVerificationSessionToken,
  timestampToMillis,
  verificationSessionMatches,
};
