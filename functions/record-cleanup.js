/**
 * Firestore 운영 기록 정리 정책.
 * 클라이언트 assets/js/pages/admin-operation-tasks.js 와 동기화합니다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_LIMIT = 500;

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSuccessfulChildLinkAttempt(row = {}) {
  const value = String(row.result || row.status || row.code || "").trim();
  return ["success", "linked", "alreadyLinked", "ok", "completed"].includes(value);
}

function isEmailVerificationTarget(row, now = Date.now()) {
  return isCleanupAtDue(row, now);
}

function classifyEmailVerification(row, now = Date.now()) {
  if (!isCleanupAtDue(row, now)) return null;
  if (row.used === true) return "used";
  const expiresAt = timestampToMillis(row.expiresAt || row.expireAt || row.expires);
  if (expiresAt > 0 && expiresAt <= now) return "expired";
  return "due";
}

function isSignupAttemptTarget(row, now = Date.now()) {
  return isCleanupAtDue(row, now);
}

function isMemberChildLinkAttemptTarget(row, now = Date.now()) {
  return isCleanupAtDue(row, now);
}

function classifyMemberChildLinkAttempt(row, now = Date.now()) {
  if (!isCleanupAtDue(row, now)) return null;
  return isSuccessfulChildLinkAttempt(row) ? "success" : "failed";
}

function isCleanupAtDue(row = {}, now = Date.now()) {
  const cleanupAt = timestampToMillis(row.cleanupAt);
  return cleanupAt > 0 && cleanupAt <= now;
}

const RECORD_CLEANUP_COLLECTIONS = [
  {
    collectionName: "emailVerifications",
    title: "이메일 인증 기록",
    policy: "저장된 cleanupAt 도래",
    isTarget: isEmailVerificationTarget,
    classify: classifyEmailVerification,
    breakdown: [
      { key: "used", title: "사용·무효화된 인증", policy: "cleanupAt 도래" },
      { key: "expired", title: "만료된 인증", policy: "cleanupAt 도래" },
      { key: "due", title: "기타 도래 기록", policy: "cleanupAt 도래" }
    ]
  },
  {
    collectionName: "signupAttempts",
    title: "회원가입 인증 시도 기록",
    policy: "저장된 cleanupAt 도래 (현재 writer 1일)",
    isTarget: isSignupAttemptTarget,
    classify: () => "target",
    breakdown: []
  },
  {
    collectionName: "memberChildLinkAttempts",
    title: "자녀 연동 시도 기록",
    policy: "저장된 cleanupAt 도래 (실패 7일, 성공 1일)",
    isTarget: isMemberChildLinkAttemptTarget,
    classify: classifyMemberChildLinkAttempt,
    breakdown: [
      { key: "failed", title: "실패·미완료 시도", policy: "cleanupAt 도래" },
      { key: "success", title: "성공한 시도", policy: "cleanupAt 도래" }
    ]
  }
];

async function deleteDocsInBatches(db, collectionName, targets, batchSize = 500) {
  let deletedCount = 0;
  for (let index = 0; index < targets.length; index += batchSize) {
    const chunk = targets.slice(index, index + batchSize);
    const batch = db.batch();
    chunk.forEach((target) => {
      if (!target?.updateTime) {
        throw new Error(`${collectionName}/${target?.id || "unknown"} updateTime 누락`);
      }
      batch.delete(
        db.collection(collectionName).doc(target.id),
        {lastUpdateTime: target.updateTime}
      );
    });
    await batch.commit();
    deletedCount += chunk.length;
  }
  return deletedCount;
}

function collectTargetsFromSnapshot(snapshot, config, now) {
  const targets = [];
  const breakdownCounts = Object.fromEntries(
    (config.breakdown || []).map((item) => [item.key, 0])
  );

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!config.isTarget(data, now)) return;
    targets.push({ id: docSnap.id, data, updateTime: docSnap.updateTime });
    const bucket = config.classify(data, now);
    if (bucket && Object.prototype.hasOwnProperty.call(breakdownCounts, bucket)) {
      breakdownCounts[bucket] += 1;
    }
  });

  return { targets, breakdownCounts, scannedCount: snapshot.size };
}

async function scanCollectionTargets(db, config, now = Date.now(), options = {}) {
  const requestedLimit = Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : DEFAULT_CLEANUP_LIMIT;
  const limit = Math.min(requestedLimit, DEFAULT_CLEANUP_LIMIT);
  const nowTimestamp = require("firebase-admin").firestore.Timestamp.fromMillis(now);
  const snapshot = await db.collection(config.collectionName)
    .where("cleanupAt", "<=", nowTimestamp)
    .orderBy("cleanupAt", "asc")
    .limit(limit)
    .get();
  return collectTargetsFromSnapshot(snapshot, config, now);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ perCollectionLimit?: number }} options
 */
async function runRecordCleanup(db, options = {}) {
  const requestedLimit = Number.isFinite(options.perCollectionLimit) &&
    options.perCollectionLimit > 0
    ? Math.floor(options.perCollectionLimit)
    : DEFAULT_CLEANUP_LIMIT;
  const perCollectionLimit = Math.min(requestedLimit, DEFAULT_CLEANUP_LIMIT);
  const now = Date.now();
  const results = [];
  let totalDeleted = 0;
  let hasMore = false;

  // Complete every bounded prerequisite read before any delete starts.
  const scans = [];
  for (const config of RECORD_CLEANUP_COLLECTIONS) {
    const due = await scanCollectionTargets(db, config, now, { limit: perCollectionLimit });
    scans.push({ config, due });
  }

  for (const { config, due } of scans) {
    const deletedCount = await deleteDocsInBatches(
      db,
      config.collectionName,
      due.targets
    );

    totalDeleted += deletedCount;
    hasMore = hasMore || due.scannedCount >= perCollectionLimit;

    results.push({
      collectionName: config.collectionName,
      title: config.title,
      policy: config.policy,
      scannedCount: due.scannedCount,
      targetCount: due.targets.length,
      deletedCount,
      breakdown: (config.breakdown || []).map((item) => ({
        title: item.title,
        policy: item.policy,
        count: due.breakdownCounts[item.key] || 0
      }))
    });
  }

  return { results, totalDeleted, hasMore };
}

module.exports = {
  DAY_MS,
  RECORD_CLEANUP_COLLECTIONS,
  classifyEmailVerification,
  classifyMemberChildLinkAttempt,
  deleteDocsInBatches,
  isEmailVerificationTarget,
  isCleanupAtDue,
  isMemberChildLinkAttemptTarget,
  isSignupAttemptTarget,
  runRecordCleanup,
  scanCollectionTargets,
  timestampToMillis
};
