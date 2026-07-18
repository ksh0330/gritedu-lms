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

function getSignupAttemptLastSeenAt(row = {}) {
  return Math.max(
    timestampToMillis(row.timestamp),
    timestampToMillis(row.lastAttemptAt),
    timestampToMillis(row.updatedAt),
    timestampToMillis(row.createdAt)
  );
}

function isSuccessfulChildLinkAttempt(row = {}) {
  const value = String(row.result || row.status || row.code || "").trim();
  return ["success", "linked", "alreadyLinked", "ok", "completed"].includes(value);
}

function isEmailVerificationTarget(row, now = Date.now()) {
  const expiresAt = timestampToMillis(row.expiresAt || row.expireAt || row.expires);
  if (expiresAt > 0 && expiresAt <= now) return true;
  const createdAt = timestampToMillis(row.createdAt);
  return createdAt > 0 && now - createdAt >= 7 * DAY_MS;
}

function classifyEmailVerification(row, now = Date.now()) {
  const expiresAt = timestampToMillis(row.expiresAt || row.expireAt || row.expires);
  if (expiresAt > 0 && expiresAt <= now) return "expired";
  const createdAt = timestampToMillis(row.createdAt);
  if (createdAt > 0 && now - createdAt >= 7 * DAY_MS) return "stale";
  return null;
}

function isSignupAttemptTarget(row, now = Date.now()) {
  const blockedUntil = timestampToMillis(row.blockedUntil);
  if (blockedUntil > now) return false;
  const lastSeenAt = getSignupAttemptLastSeenAt(row);
  if (lastSeenAt <= 0) return false;
  if (now - lastSeenAt >= 30 * DAY_MS) return true;
  if (blockedUntil > 0 && blockedUntil <= now) {
    const anchor = Math.max(lastSeenAt, blockedUntil);
    return now - anchor >= 7 * DAY_MS;
  }
  return false;
}

function isMemberChildLinkAttemptTarget(row, now = Date.now()) {
  const createdAt = timestampToMillis(row.createdAt);
  if (createdAt <= 0) return false;
  const age = now - createdAt;
  if (!isSuccessfulChildLinkAttempt(row)) return age >= 90 * DAY_MS;
  return age >= 180 * DAY_MS;
}

function classifyMemberChildLinkAttempt(row, now = Date.now()) {
  const createdAt = timestampToMillis(row.createdAt);
  if (createdAt <= 0) return null;
  const age = now - createdAt;
  if (!isSuccessfulChildLinkAttempt(row) && age >= 90 * DAY_MS) return "failed";
  if (isSuccessfulChildLinkAttempt(row) && age >= 180 * DAY_MS) return "success";
  return null;
}

const RECORD_CLEANUP_COLLECTIONS = [
  {
    collectionName: "emailVerifications",
    title: "이메일 인증 기록",
    policy: "만료 또는 생성 후 7일 경과",
    isTarget: isEmailVerificationTarget,
    classify: classifyEmailVerification,
    breakdown: [
      { key: "expired", title: "만료된 인증", policy: "만료 시각 경과" },
      { key: "stale", title: "오래된 인증", policy: "생성 후 7일 경과" }
    ]
  },
  {
    collectionName: "signupAttempts",
    title: "회원가입 인증 시도 기록",
    policy: "30일 경과 또는 차단 만료 후 7일 (활성 차단 제외)",
    isTarget: isSignupAttemptTarget,
    classify: () => "target",
    breakdown: []
  },
  {
    collectionName: "memberChildLinkAttempts",
    title: "자녀 연동 시도 기록",
    policy: "실패 90일, 성공 180일 경과",
    isTarget: isMemberChildLinkAttemptTarget,
    classify: classifyMemberChildLinkAttempt,
    breakdown: [
      { key: "failed", title: "실패·미완료 시도", policy: "90일 경과" },
      { key: "success", title: "성공한 시도", policy: "180일 경과" }
    ]
  }
];

async function deleteDocsInBatches(db, collectionName, docIds, batchSize = 500) {
  let deletedCount = 0;
  for (let index = 0; index < docIds.length; index += batchSize) {
    const chunk = docIds.slice(index, index + batchSize);
    const batch = db.batch();
    chunk.forEach((docId) => {
      batch.delete(db.collection(collectionName).doc(docId));
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
    targets.push({ id: docSnap.id, data });
    const bucket = config.classify(data, now);
    if (bucket && Object.prototype.hasOwnProperty.call(breakdownCounts, bucket)) {
      breakdownCounts[bucket] += 1;
    }
  });

  return { targets, breakdownCounts, scannedCount: snapshot.size };
}

async function scanCollectionTargets(db, config, now = Date.now(), options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : DEFAULT_CLEANUP_LIMIT;
  const nowTimestamp = require("firebase-admin").firestore.Timestamp.fromMillis(now);
  const snapshot = await db.collection(config.collectionName)
    .where("cleanupAt", "<=", nowTimestamp)
    .orderBy("cleanupAt", "asc")
    .limit(limit)
    .get();
  return collectTargetsFromSnapshot(snapshot, config, now);
}

async function scanLegacyCollectionTargets(db, config, now = Date.now()) {
  const snapshot = await db.collection(config.collectionName).get();
  const legacyDocs = snapshot.docs.filter((docSnap) => !docSnap.data()?.cleanupAt);
  return collectTargetsFromSnapshot({
    docs: legacyDocs,
    size: legacyDocs.length,
    forEach(callback) {
      legacyDocs.forEach(callback);
    }
  }, config, now);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ perCollectionLimit?: number, includeLegacy?: boolean }} options
 */
async function runRecordCleanup(db, options = {}) {
  const perCollectionLimit = Number.isFinite(options.perCollectionLimit)
    ? options.perCollectionLimit
    : DEFAULT_CLEANUP_LIMIT;
  const now = Date.now();
  const results = [];
  let totalDeleted = 0;
  let hasMore = false;

  for (const config of RECORD_CLEANUP_COLLECTIONS) {
    const due = await scanCollectionTargets(db, config, now, { limit: perCollectionLimit });
    const legacy = options.includeLegacy === true
      ? await scanLegacyCollectionTargets(db, config, now)
      : { targets: [], breakdownCounts: {}, scannedCount: 0 };
    const targetsById = new Map([...due.targets, ...legacy.targets].map((target) => [target.id, target]));
    const targets = [...targetsById.values()];
    const limitedTargets = targets.slice(0, perCollectionLimit);
    const breakdownCounts = { ...due.breakdownCounts };
    Object.entries(legacy.breakdownCounts).forEach(([key, count]) => {
      breakdownCounts[key] = (breakdownCounts[key] || 0) + count;
    });
    const scannedCount = due.scannedCount + legacy.scannedCount;
    const deletedCount = await deleteDocsInBatches(
      db,
      config.collectionName,
      limitedTargets.map((target) => target.id)
    );

    totalDeleted += deletedCount;
    hasMore = hasMore || targets.length > perCollectionLimit || due.scannedCount >= perCollectionLimit;

    results.push({
      collectionName: config.collectionName,
      title: config.title,
      policy: config.policy,
      scannedCount,
      targetCount: targets.length,
      deletedCount,
      breakdown: (config.breakdown || []).map((item) => ({
        title: item.title,
        policy: item.policy,
        count: breakdownCounts[item.key] || 0
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
  isMemberChildLinkAttemptTarget,
  isSignupAttemptTarget,
  runRecordCleanup,
  scanCollectionTargets,
  scanLegacyCollectionTargets,
  timestampToMillis
};
