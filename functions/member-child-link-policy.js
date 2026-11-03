const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const MEMBER_CHILD_LINK_POLICY = Object.freeze({
  tenMinuteLimit: 5,
  dailyLimit: 15,
  failedRetentionDays: 7,
  successfulRetentionDays: 1,
});

const LEGACY_STUDENT_NAME_FALLBACK_LIMIT = 50;

// 정상 입력은 충분히 받으면서, 시도 기록 저장이 실패할 만큼 큰 입력을 막는다.
const MEMBER_CHILD_INPUT_LIMITS = Object.freeze({
  studentName: 50,
  school: 100,
  studentPhone: 30,
  grade: 10,
  relationLabel: 20,
});

function isMemberChildInputFieldValid(field, value) {
  const limit = MEMBER_CHILD_INPUT_LIMITS[field];
  if (field === "grade") {
    return (typeof value === "string" || typeof value === "number") && String(value).length <= limit;
  }
  return typeof value === "string" && value.length <= limit;
}

function getOversizedOrInvalidMemberChildFields(data = {}) {
  return Object.keys(MEMBER_CHILD_INPUT_LIMITS)
    .filter((field) => !isMemberChildInputFieldValid(field, data?.[field]));
}

function truncateMemberChildInput(field, value) {
  return String(value).slice(0, MEMBER_CHILD_INPUT_LIMITS[field]);
}

/**
 * 한도 판정과 시도 기록을 한 트랜잭션으로 묶는다. 동시 요청도 같은 시도 목록을 직렬로 보므로 한도를 넘지 못하고,
 * 결과 기록이 실패해도 pending 예약이 남아 횟수에 포함된다. 거절된 요청은 기록하지 않는다(기존 계약).
 */
async function reserveMemberChildLinkAttempt({ db, memberUid, now, policy = MEMBER_CHILD_LINK_POLICY }) {
  const attempts = db.collection("memberChildLinkAttempts");
  const attemptRef = attempts.doc();
  const decision = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attempts.where("memberUid", "==", memberUid));
    const evaluated = evaluateMemberChildLinkRateLimit({
      attempts: snapshot.docs.map((attemptDoc) => attemptDoc.data() || {}),
      nowMillis: now.toMillis(),
      policy,
    });
    if (evaluated.allowed) {
      transaction.create(attemptRef, {
        memberUid,
        result: "pending",
        matchCount: 0,
        createdAt: now,
        cleanupAt: now.constructor.fromMillis(now.toMillis() + policy.failedRetentionDays * DAY_MS),
      });
    }
    return evaluated;
  });
  return { decision, attemptRef: decision.allowed ? attemptRef : null };
}

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

// Exact, de-duplicated list of a parent's active child UIDs, in link-document order.
// includeStudentUid is the child being (re)linked in the same transaction.
function buildActiveLinkedStudentUids(linkDocs, includeStudentUid = "") {
  const uids = [];
  (Array.isArray(linkDocs) ? linkDocs : []).forEach((linkDoc) => {
    const data = typeof linkDoc?.data === "function" ? (linkDoc.data() || {}) : (linkDoc || {});
    const uid = String(data.studentUid || "").trim();
    if (data.status === "active" && uid && !uids.includes(uid)) uids.push(uid);
  });
  const extra = String(includeStudentUid || "").trim();
  if (extra && !uids.includes(extra)) uids.push(extra);
  return uids;
}

module.exports = {
  buildActiveLinkedStudentUids,
  MEMBER_CHILD_INPUT_LIMITS,
  getOversizedOrInvalidMemberChildFields,
  reserveMemberChildLinkAttempt,
  truncateMemberChildInput,
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
