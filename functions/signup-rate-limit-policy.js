const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SIGNUP_RATE_LIMIT_POLICY = Object.freeze({
  emailHourlyLimit: 5,
  ipHourlyLimit: 30,
  windowMs: HOUR_MS,
  attemptRetentionMs: DAY_MS,
});

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function getRecentAttemptMillis(attempts, cutoffMillis) {
  return attempts
    .map((attempt) => timestampToMillis(attempt?.timestamp))
    .filter((millis) => millis != null && millis > cutoffMillis)
    .sort((a, b) => a - b);
}

function getRetryAfterSeconds(attemptMillis, nowMillis, windowMs) {
  if (!attemptMillis.length) return 60;
  const retryAt = attemptMillis[0] + windowMs;
  return Math.max(60, Math.ceil((retryAt - nowMillis) / 1000));
}

function evaluateSignupRateLimit({
  emailAttempts = [],
  ipAttempts = [],
  nowMillis = Date.now(),
  hasUsableIp = true,
  policy = SIGNUP_RATE_LIMIT_POLICY,
} = {}) {
  const cutoffMillis = nowMillis - policy.windowMs;
  const recentEmailAttempts = getRecentAttemptMillis(emailAttempts, cutoffMillis);

  if (recentEmailAttempts.length >= policy.emailHourlyLimit) {
    return {
      allowed: false,
      reason: "too-many-attempts-per-email-hourly",
      retryAfterSeconds: getRetryAfterSeconds(
        recentEmailAttempts,
        nowMillis,
        policy.windowMs
      ),
    };
  }

  if (hasUsableIp) {
    const recentIpAttempts = getRecentAttemptMillis(ipAttempts, cutoffMillis);
    if (recentIpAttempts.length >= policy.ipHourlyLimit) {
      return {
        allowed: false,
        reason: "too-many-attempts-per-ip-hourly",
        retryAfterSeconds: getRetryAfterSeconds(
          recentIpAttempts,
          nowMillis,
          policy.windowMs
        ),
      };
    }
  }

  return {allowed: true};
}

module.exports = {
  SIGNUP_RATE_LIMIT_POLICY,
  evaluateSignupRateLimit,
};
