const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const MEMBER_CHILD_LINK_POLICY = Object.freeze({
  tenMinuteLimit: 5,
  dailyLimit: 15,
  failedRetentionDays: 7,
  successfulRetentionDays: 1,
});

const LEGACY_STUDENT_NAME_FALLBACK_LIMIT = 50;

const SUCCESSFUL_RESULTS = new Set([
  "success",
  "linked",
  "alreadyLinked",
  "ok",
  "completed",
]);

const LIMIT_EXEMPT_RESULTS = new Set([
  "success",
  "linked",
  "ok",
  "completed",
]);

function normalizeStudentName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function studentNamesMatch(storedName, requestedName) {
  const normalizedRequestedName = normalizeStudentName(requestedName);
  return Boolean(normalizedRequestedName) &&
    normalizeStudentName(storedName) === normalizedRequestedName;
}

function getStudentNameFallbackPrefixes(value) {
  const normalizedName = normalizeStudentName(value);
  const namePrefix = [...normalizedName].slice(0, 2).join("");
  return [...new Set([namePrefix, " "].filter(Boolean))];
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function countsTowardMemberChildLimit(attempt = {}) {
  const result = String(attempt.result || "");
  return !["rateLimited", "serverError"].includes(result) &&
    !LIMIT_EXEMPT_RESULTS.has(result);
}

function countAttemptsSince(attempts, cutoffMillis) {
  return attempts.reduce((count, attempt) => {
    if (!countsTowardMemberChildLimit(attempt)) return count;
    const createdAtMillis = timestampToMillis(attempt?.createdAt);
    return createdAtMillis != null && createdAtMillis > cutoffMillis
      ? count + 1
      : count;
  }, 0);
}

function getRetryAfterSeconds(attempts, nowMillis, windowMs, limit) {
  const activeAttemptTimes = attempts
    .filter(countsTowardMemberChildLimit)
    .map((attempt) => timestampToMillis(attempt?.createdAt))
    .filter((createdAtMillis) =>
      createdAtMillis != null && createdAtMillis > nowMillis - windowMs
    )
    .sort((left, right) => left - right);
  if (activeAttemptTimes.length < limit) return 0;
  const unlockIndex = activeAttemptTimes.length - limit;
  const unlockAt = activeAttemptTimes[unlockIndex] + windowMs;
  return Math.max(1, Math.ceil((unlockAt - nowMillis) / 1000));
}

function evaluateMemberChildLinkRateLimit({
  attempts = [],
  nowMillis = Date.now(),
  policy = MEMBER_CHILD_LINK_POLICY,
} = {}) {
  const tenMinuteCount = countAttemptsSince(
    attempts,
    nowMillis - 10 * MINUTE_MS
  );
  const oneDayCount = countAttemptsSince(attempts, nowMillis - DAY_MS);

  const tenMinuteRetryAfterSeconds = getRetryAfterSeconds(
    attempts,
    nowMillis,
    10 * MINUTE_MS,
    policy.tenMinuteLimit
  );
  const dailyRetryAfterSeconds = getRetryAfterSeconds(
    attempts,
    nowMillis,
    DAY_MS,
    policy.dailyLimit
  );

  if (tenMinuteRetryAfterSeconds || dailyRetryAfterSeconds) {
    const isDailyLimit = dailyRetryAfterSeconds > tenMinuteRetryAfterSeconds;
    return {
      allowed: false,
      reason: isDailyLimit
        ? "too-many-attempts-24h"
        : "too-many-attempts-10m",
      retryAfterSeconds: Math.max(
        tenMinuteRetryAfterSeconds,
        dailyRetryAfterSeconds
      ),
      tenMinuteCount,
      oneDayCount,
    };
  }

  return {allowed: true, tenMinuteCount, oneDayCount};
}

function getMemberChildAttemptRetentionDays(result) {
  return SUCCESSFUL_RESULTS.has(String(result || ""))
    ? MEMBER_CHILD_LINK_POLICY.successfulRetentionDays
    : MEMBER_CHILD_LINK_POLICY.failedRetentionDays;
}

module.exports = {
  LEGACY_STUDENT_NAME_FALLBACK_LIMIT,
  MEMBER_CHILD_LINK_POLICY,
  countsTowardMemberChildLimit,
  evaluateMemberChildLinkRateLimit,
  getRetryAfterSeconds,
  getMemberChildAttemptRetentionDays,
  getStudentNameFallbackPrefixes,
  normalizeStudentName,
  studentNamesMatch,
};
