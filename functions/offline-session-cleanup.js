/**
 * 오프라인 수업(offlineClassSessions) 자동 정리.
 * 정책은 Firestore settings/retentionPolicy 에서 읽습니다.
 * CMS: assets/js/pages/admin-operation-tasks.js
 */

const admin = require("firebase-admin");
const { deleteDocsInBatches } = require("./record-cleanup");

const RETENTION_POLICY_DOC = "retentionPolicy";
const SESSION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QUERY_BUFFER_MULTIPLIER = 3;
const SESSION_ID_IN_CHUNK_SIZE = 30;

const DEFAULT_RETENTION_POLICY = {
  offlineSessionCleanupEnabled: true,
  offlineSessionDryRun: false,
  offlineSessionRetentionDays: 180,
  offlineSessionStatuses: ["published", "archived"],
  offlineSessionPerRunLimit: 200,
  offlineSessionSkipActiveAccess: true
};

function hasPolicyField(raw, key) {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function normalizeRetentionPolicy(raw = {}) {
  const retentionDays = Number.parseInt(raw.offlineSessionRetentionDays, 10);
  const perRunLimit = Number.parseInt(raw.offlineSessionPerRunLimit, 10);
  const statuses = Array.isArray(raw.offlineSessionStatuses)
    ? raw.offlineSessionStatuses.map((value) => String(value || "").trim()).filter(Boolean)
    : null;

  return {
    offlineSessionCleanupEnabled: hasPolicyField(raw, "offlineSessionCleanupEnabled")
      ? raw.offlineSessionCleanupEnabled === true
      : DEFAULT_RETENTION_POLICY.offlineSessionCleanupEnabled,
    offlineSessionDryRun: hasPolicyField(raw, "offlineSessionDryRun")
      ? raw.offlineSessionDryRun === true
      : DEFAULT_RETENTION_POLICY.offlineSessionDryRun,
    offlineSessionRetentionDays: hasPolicyField(raw, "offlineSessionRetentionDays") &&
      Number.isFinite(retentionDays) &&
      retentionDays > 0
      ? retentionDays
      : DEFAULT_RETENTION_POLICY.offlineSessionRetentionDays,
    offlineSessionStatuses: statuses && statuses.length
      ? statuses
      : DEFAULT_RETENTION_POLICY.offlineSessionStatuses.slice(),
    offlineSessionPerRunLimit: hasPolicyField(raw, "offlineSessionPerRunLimit") &&
      Number.isFinite(perRunLimit) &&
      perRunLimit > 0
      ? perRunLimit
      : DEFAULT_RETENTION_POLICY.offlineSessionPerRunLimit,
    offlineSessionSkipActiveAccess: hasPolicyField(raw, "offlineSessionSkipActiveAccess")
      ? raw.offlineSessionSkipActiveAccess === true
      : DEFAULT_RETENTION_POLICY.offlineSessionSkipActiveAccess
  };
}

function isValidSessionDateString(value) {
  const sessionDate = String(value || "").trim();
  if (!SESSION_DATE_PATTERN.test(sessionDate)) return false;
  const parsed = Date.parse(`${sessionDate}T00:00:00.000Z`);
  return Number.isFinite(parsed);
}

function formatUtcDateString(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeCutoffDateString(retentionDays, now = new Date()) {
  const safeDays = Number.isFinite(retentionDays) && retentionDays > 0
    ? retentionDays
    : DEFAULT_RETENTION_POLICY.offlineSessionRetentionDays;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - safeDays);
  return formatUtcDateString(cutoff);
}

async function loadRetentionPolicy(db) {
  const snap = await db.collection("settings").doc(RETENTION_POLICY_DOC).get();
  return normalizeRetentionPolicy(snap.exists ? (snap.data() || {}) : {});
}

async function loadAccessInfoForSessionIds(db, sessionIds) {
  const activeSessionIds = new Set();
  const countsBySession = new Map();
  const accessDocIdsBySession = new Map();
  const uniqueIds = [...new Set(
    sessionIds.map((id) => String(id || "").trim()).filter(Boolean)
  )];

  if (!uniqueIds.length) {
    return { activeSessionIds, countsBySession, accessDocIdsBySession };
  }

  for (let index = 0; index < uniqueIds.length; index += SESSION_ID_IN_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + SESSION_ID_IN_CHUNK_SIZE);
    const snap = await db.collection("offlineSessionAccess")
      .where("sessionId", "in", chunk)
      .get();

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const sessionId = String(data.sessionId || "").trim();
      if (!sessionId) return;

      countsBySession.set(sessionId, (countsBySession.get(sessionId) || 0) + 1);

      const docIds = accessDocIdsBySession.get(sessionId) || [];
      docIds.push(docSnap.id);
      accessDocIdsBySession.set(sessionId, docIds);

      if (String(data.status || "").trim() === "active") {
        activeSessionIds.add(sessionId);
      }
    });
  }

  return { activeSessionIds, countsBySession, accessDocIdsBySession };
}

async function deleteAccessDocsByIds(db, accessDocIds) {
  if (!accessDocIds?.length) return 0;
  return deleteDocsInBatches(db, "offlineSessionAccess", accessDocIds);
}

async function queryExpiredSessions(db, cutoffDate, queryLimit) {
  return db.collection("offlineClassSessions")
    .where("sessionDate", "<", cutoffDate)
    .orderBy("sessionDate")
    .limit(queryLimit)
    .get();
}

function filterSessionCandidates(snapshot, statusSet) {
  const candidates = [];
  let skippedInvalidDateCount = 0;
  let skippedStatusCount = 0;

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const sessionDate = String(data.sessionDate || "").trim();

    if (!isValidSessionDateString(sessionDate)) {
      skippedInvalidDateCount += 1;
      console.warn("[offlineSessionCleanup] invalid sessionDate skipped", {
        sessionId: docSnap.id,
        sessionDate: data.sessionDate || null
      });
      return;
    }

    const status = String(data.status || "published").trim();
    if (!statusSet.has(status)) {
      skippedStatusCount += 1;
      return;
    }

    candidates.push({
      id: docSnap.id,
      sessionDate,
      status,
      hasVideo: data.hasVideo === true
    });
  });

  return { candidates, skippedInvalidDateCount, skippedStatusCount };
}

async function deleteAccessDocsForSession(db, sessionId) {
  const snap = await db.collection("offlineSessionAccess")
    .where("sessionId", "==", sessionId)
    .get();
  const accessIds = snap.docs.map((docSnap) => docSnap.id);
  if (!accessIds.length) return 0;
  return deleteDocsInBatches(db, "offlineSessionAccess", accessIds);
}

function buildSessionTargetSummary(policy, cutoffDate) {
  const statusSet = new Set(policy.offlineSessionStatuses);
  return {
    enabled: policy.offlineSessionCleanupEnabled,
    dryRun: policy.offlineSessionDryRun,
    actualDeleteEnabled: !policy.offlineSessionDryRun,
    retentionDays: policy.offlineSessionRetentionDays,
    cutoffDate,
    statuses: [...statusSet],
    perRunLimit: policy.offlineSessionPerRunLimit,
    skipActiveAccess: policy.offlineSessionSkipActiveAccess
  };
}

function buildDisabledSummary(policy, cutoffDate, reason) {
  return {
    ...buildSessionTargetSummary(policy, cutoffDate),
    skipped: true,
    reason,
    scannedSessionCount: 0,
    candidateSessionCount: 0,
    processedCount: 0,
    deletedSessionCount: 0,
    deletedAccessCount: 0,
    skippedInvalidDateCount: 0,
    skippedStatusCount: 0,
    skippedActiveAccessCount: 0,
    remainingLimitReached: false,
    errorCount: 0
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ policy?: ReturnType<typeof normalizeRetentionPolicy>, persistSummary?: boolean }} options
 */
async function runOfflineSessionCleanup(db, options = {}) {
  const policy = options.policy || await loadRetentionPolicy(db);
  const persistSummary = options.persistSummary !== false;
  const cutoffDate = computeCutoffDateString(policy.offlineSessionRetentionDays);
  const statusSet = new Set(policy.offlineSessionStatuses);
  let errorCount = 0;

  if (!policy.offlineSessionCleanupEnabled) {
    const summary = buildDisabledSummary(policy, cutoffDate, "disabled");
    if (persistSummary) {
      await persistOfflineSessionLastRun(db, summary);
    }
    return summary;
  }

  const queryLimit = policy.offlineSessionPerRunLimit * QUERY_BUFFER_MULTIPLIER;
  let snapshot;
  try {
    snapshot = await queryExpiredSessions(db, cutoffDate, queryLimit);
  } catch (error) {
    errorCount += 1;
    console.error("[offlineSessionCleanup] session query failed", error);
    const summary = {
      ...buildDisabledSummary(policy, cutoffDate, "query_failed"),
      errorCount
    };
    if (persistSummary) {
      await persistOfflineSessionLastRun(db, summary);
    }
    return summary;
  }

  const { candidates, skippedInvalidDateCount, skippedStatusCount } =
    filterSessionCandidates(snapshot, statusSet);

  const candidateIds = candidates.map((row) => row.id);
  let activeAccessSessionIds = new Set();
  let accessCountsBySession = new Map();
  let accessDocIdsBySession = new Map();

  if (candidateIds.length) {
    try {
      const accessInfo = await loadAccessInfoForSessionIds(db, candidateIds);
      activeAccessSessionIds = accessInfo.activeSessionIds;
      accessCountsBySession = accessInfo.countsBySession;
      accessDocIdsBySession = accessInfo.accessDocIdsBySession;
    } catch (error) {
      errorCount += 1;
      console.error("[offlineSessionCleanup] candidate access query failed", error);
    }
  }

  let skippedActiveAccessCount = 0;
  let deletedSessionCount = 0;
  let deletedAccessCount = 0;
  let processedCount = 0;

  for (const candidate of candidates) {
    if (processedCount >= policy.offlineSessionPerRunLimit) break;

    if (policy.offlineSessionSkipActiveAccess && activeAccessSessionIds.has(candidate.id)) {
      skippedActiveAccessCount += 1;
      continue;
    }

    processedCount += 1;

    if (policy.offlineSessionDryRun) {
      deletedAccessCount += accessCountsBySession.get(candidate.id) || 0;
      deletedSessionCount += 1;
      continue;
    }

    try {
      const preloadedAccessIds = accessDocIdsBySession.get(candidate.id);
      if (preloadedAccessIds) {
        deletedAccessCount += await deleteAccessDocsByIds(db, preloadedAccessIds);
      } else {
        deletedAccessCount += await deleteAccessDocsForSession(db, candidate.id);
      }
      await db.collection("offlineClassSessions").doc(candidate.id).delete();
      deletedSessionCount += 1;
    } catch (error) {
      errorCount += 1;
      console.error("[offlineSessionCleanup] delete failed", {
        sessionId: candidate.id,
        error
      });
    }
  }

  const remainingLimitReached =
    processedCount >= policy.offlineSessionPerRunLimit ||
    snapshot.size >= queryLimit;

  const summary = {
    ...buildSessionTargetSummary(policy, cutoffDate),
    skipped: false,
    scannedSessionCount: snapshot.size,
    candidateSessionCount: candidates.length,
    processedCount,
    deletedSessionCount,
    deletedAccessCount,
    skippedInvalidDateCount,
    skippedStatusCount,
    skippedActiveAccessCount,
    remainingLimitReached,
    errorCount,
    scannedCount: snapshot.size,
    candidateCount: candidates.length,
    hasMoreCandidates: remainingLimitReached
  };

  if (persistSummary) {
    await persistOfflineSessionLastRun(db, summary);
  }

  return summary;
}

async function persistOfflineSessionLastRun(db, summary) {
  await db.collection("settings").doc(RETENTION_POLICY_DOC).set({
    offlineSessionLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    offlineSessionLastRunSummary: summary,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

module.exports = {
  DEFAULT_RETENTION_POLICY,
  QUERY_BUFFER_MULTIPLIER,
  RETENTION_POLICY_DOC,
  computeCutoffDateString,
  filterSessionCandidates,
  isValidSessionDateString,
  loadAccessInfoForSessionIds,
  loadRetentionPolicy,
  normalizeRetentionPolicy,
  persistOfflineSessionLastRun,
  runOfflineSessionCleanup
};
