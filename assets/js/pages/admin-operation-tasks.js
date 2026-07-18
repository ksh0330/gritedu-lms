import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const RECORD_CLEANUP_DELETE_LIMIT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECORD_CLEANUP_COOLDOWN_MS = 30 * DAY_MS;
const RECORD_CLEANUP_LAST_SCAN_KEY = "grit_admin_record_cleanup_last_scan";
const RETENTION_POLICY_DOC = "retentionPolicy";
const SESSION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFLINE_SESSION_PREVIEW_LIMIT = 50;

// functions/offline-session-cleanup.js DEFAULT_RETENTION_POLICY 와 동기화합니다.
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

// functions/record-cleanup.js 와 정책을 동기화합니다.
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

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSignupAttemptLastSeenAt(row = {}) {
  return Math.max(
    getTimestampMillis(row.timestamp),
    getTimestampMillis(row.lastAttemptAt),
    getTimestampMillis(row.updatedAt),
    getTimestampMillis(row.createdAt)
  );
}

function isSuccessfulChildLinkAttempt(row = {}) {
  const value = String(row.result || row.status || row.code || "").trim();
  return ["success", "linked", "alreadyLinked", "ok", "completed"].includes(value);
}

function isEmailVerificationTarget(row, now = Date.now()) {
  const expiresAt = getTimestampMillis(row.expiresAt || row.expireAt || row.expires);
  if (expiresAt > 0 && expiresAt <= now) return true;
  const createdAt = getTimestampMillis(row.createdAt);
  return createdAt > 0 && now - createdAt >= 7 * DAY_MS;
}

function classifyEmailVerification(row, now = Date.now()) {
  const expiresAt = getTimestampMillis(row.expiresAt || row.expireAt || row.expires);
  if (expiresAt > 0 && expiresAt <= now) return "expired";
  const createdAt = getTimestampMillis(row.createdAt);
  if (createdAt > 0 && now - createdAt >= 7 * DAY_MS) return "stale";
  return null;
}

function isSignupAttemptTarget(row, now = Date.now()) {
  const blockedUntil = getTimestampMillis(row.blockedUntil);
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
  const createdAt = getTimestampMillis(row.createdAt);
  if (createdAt <= 0) return false;
  const age = now - createdAt;
  if (!isSuccessfulChildLinkAttempt(row)) return age >= 90 * DAY_MS;
  return age >= 180 * DAY_MS;
}

function classifyMemberChildLinkAttempt(row, now = Date.now()) {
  const createdAt = getTimestampMillis(row.createdAt);
  if (createdAt <= 0) return null;
  const age = now - createdAt;
  if (!isSuccessfulChildLinkAttempt(row) && age >= 90 * DAY_MS) return "failed";
  if (isSuccessfulChildLinkAttempt(row) && age >= 180 * DAY_MS) return "success";
  return null;
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
      : DEFAULT_RETENTION_POLICY.offlineSessionSkipActiveAccess,
    offlineSessionLastRunAt: raw.offlineSessionLastRunAt || null,
    offlineSessionLastRunSummary: raw.offlineSessionLastRunSummary || null,
    recordCleanupLastRunAt: raw.recordCleanupLastRunAt || null,
    recordCleanupLastRunSummary: raw.recordCleanupLastRunSummary || null,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || ""
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

function getLastCleanupScanAt() {
  const raw = localStorage.getItem(RECORD_CLEANUP_LAST_SCAN_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function markCleanupScanNow() {
  localStorage.setItem(RECORD_CLEANUP_LAST_SCAN_KEY, String(Date.now()));
}

function getNextCleanupAvailableAt() {
  const lastScanAt = getLastCleanupScanAt();
  if (!lastScanAt) return 0;
  return lastScanAt + RECORD_CLEANUP_COOLDOWN_MS;
}

function isCleanupCooldownActive() {
  const nextAvailableAt = getNextCleanupAvailableAt();
  return nextAvailableAt > Date.now();
}

function formatKoreanDateTime(millis) {
  return new Date(millis).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function localizedCountHtml(value) {
  return escapeHtml(Number(value || 0).toLocaleString("ko-KR") + "개");
}

function refreshCooldownUi() {
  const executeButton = $("#recordCleanupExecute");
  const previewButton = $("#recordCleanupPreviewButton");
  const cooldownNotice = $("#recordCleanupCooldownNotice");
  const nextAvailableAt = getNextCleanupAvailableAt();
  const cooldownActive = isCleanupCooldownActive();

  if (executeButton) executeButton.disabled = cooldownActive;
  if (previewButton) previewButton.disabled = cooldownActive;

  if (!cooldownNotice) return;

  if (!cooldownActive) {
    cooldownNotice.hidden = true;
    cooldownNotice.textContent = "";
    return;
  }

  cooldownNotice.hidden = false;
  cooldownNotice.textContent = `Firestore 읽기 비용 절감을 위해 수동 정리는 월 1회만 가능합니다. 다음 실행 가능 시각: ${formatKoreanDateTime(nextAvailableAt)}`;
}

function assertCleanupAllowed() {
  if (!isCleanupCooldownActive()) return true;
  const nextAvailableAt = getNextCleanupAvailableAt();
  setRecordCleanupMessage(
    `이번 달 수동 정리를 이미 실행했습니다. 다음 가능 시각: ${formatKoreanDateTime(nextAvailableAt)}`,
    "error"
  );
  refreshCooldownUi();
  return false;
}

function getCleanupErrorMessage(error) {
  const text = String(error?.code || error?.message || error || "").toLowerCase();
  if (text.includes("permission") || text.includes("권한") || text.includes("insufficient")) {
    return "권한 또는 규칙 설정을 확인해 주세요.";
  }
  return "운영 기록 정리 중 문제가 발생했습니다. 다시 시도해 주세요.";
}

function setRecordCleanupMessage(message, type = "info") {
  const messageEl = $("#recordCleanupMessage");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.className = `record-cleanup-message ${type === "error" ? "is-error" : ""} ${type === "success" ? "is-success" : ""}`.trim();
  messageEl.hidden = !message;
}

function setOfflineSessionPolicyMessage(message, type = "info") {
  const messageEl = $("#offlineSessionPolicyMessage");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.className = `record-cleanup-message ${type === "error" ? "is-error" : ""} ${type === "success" ? "is-success" : ""}`.trim();
  messageEl.hidden = !message;
}

function buildDisplayRows(scanResults, suffix = "") {
  const rows = [];
  scanResults.forEach(({ config, targets, breakdownCounts }) => {
    if (config.breakdown.length) {
      config.breakdown.forEach((item) => {
        rows.push({
          title: `${config.title} · ${item.title}`,
          policy: item.policy,
          count: breakdownCounts[item.key] || 0,
          suffix
        });
      });
      return;
    }
    rows.push({
      title: config.title,
      policy: config.policy,
      count: targets.length,
      suffix
    });
  });
  return rows;
}

function renderRecordCleanupCounts(listId, rows = []) {
  const list = $(listId);
  if (!list) return;
  list.hidden = false;
  list.innerHTML = rows.map((result) => `
    <li>
      <strong>${escapeHtml(result.title)}</strong>
      <span class="muted" style="display:block;font-size:12px;margin-top:2px;">${escapeHtml(result.policy)}</span>
      <span style="display:block;margin-top:4px;">${Number(result.count || 0).toLocaleString("ko-KR") + "개"}${result.suffix || ""}</span>
    </li>
  `).join("");
}

async function scanCollectionTargets(config, now = Date.now()) {
  const snapshot = await getDocs(collection(db, config.collectionName));
  const targets = [];
  const breakdownCounts = Object.fromEntries(
    config.breakdown.map((item) => [item.key, 0])
  );

  snapshot.forEach((recordDoc) => {
    const data = recordDoc.data() || {};
    if (!config.isTarget(data, now)) return;
    targets.push({ id: recordDoc.id, data });
    const bucket = config.classify(data, now);
    if (bucket && Object.prototype.hasOwnProperty.call(breakdownCounts, bucket)) {
      breakdownCounts[bucket] += 1;
    }
  });

  return { config, targets, breakdownCounts, scannedCount: snapshot.size };
}

async function collectRecordCleanupTargets() {
  const now = Date.now();
  return Promise.all(RECORD_CLEANUP_COLLECTIONS.map((config) => scanCollectionTargets(config, now)));
}

async function deleteRecordsInChunks(records, collectionName) {
  const targets = records.slice(0, RECORD_CLEANUP_DELETE_LIMIT);
  let deletedCount = 0;
  for (let index = 0; index < targets.length; index += 50) {
    const chunk = targets.slice(index, index + 50);
    await Promise.all(chunk.map((record) => deleteDoc(doc(db, collectionName, record.id))));
    deletedCount += chunk.length;
  }
  return deletedCount;
}

function readRetentionPolicyFromForm() {
  const statuses = $$('input[name="offlineSessionStatus"]:checked')
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);

  if (!statuses.length) {
    throw new Error("정리 대상 상태를 1개 이상 선택해 주세요.");
  }

  const retentionDays = Number.parseInt($("#offlineSessionRetentionDays")?.value || "", 10);
  const perRunLimit = Number.parseInt($("#offlineSessionPerRunLimit")?.value || "", 10);

  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error("보존 기간을 확인해 주세요.");
  }
  if (!Number.isFinite(perRunLimit) || perRunLimit < 1) {
    throw new Error("1회 최대 처리 개수를 확인해 주세요.");
  }

  return normalizeRetentionPolicy({
    offlineSessionCleanupEnabled: $("#offlineSessionCleanupEnabled")?.checked === true,
    offlineSessionDryRun: $("#offlineSessionActualDelete")?.checked !== true,
    offlineSessionRetentionDays: retentionDays,
    offlineSessionStatuses: statuses,
    offlineSessionPerRunLimit: perRunLimit,
    offlineSessionSkipActiveAccess: $("#offlineSessionSkipActiveAccess")?.checked === true
  });
}

function applyRetentionPolicyToForm(policy) {
  const normalized = normalizeRetentionPolicy(policy);
  if ($("#offlineSessionCleanupEnabled")) {
    $("#offlineSessionCleanupEnabled").checked = normalized.offlineSessionCleanupEnabled;
  }
  if ($("#offlineSessionActualDelete")) {
    $("#offlineSessionActualDelete").checked = !normalized.offlineSessionDryRun;
  }
  if ($("#offlineSessionRetentionDays")) {
    $("#offlineSessionRetentionDays").value = String(normalized.offlineSessionRetentionDays);
  }
  if ($("#offlineSessionPerRunLimit")) {
    $("#offlineSessionPerRunLimit").value = String(normalized.offlineSessionPerRunLimit);
  }
  if ($("#offlineSessionSkipActiveAccess")) {
    $("#offlineSessionSkipActiveAccess").checked = normalized.offlineSessionSkipActiveAccess;
  }

  const statusSet = new Set(normalized.offlineSessionStatuses);
  $$('input[name="offlineSessionStatus"]').forEach((input) => {
    input.checked = statusSet.has(String(input.value || "").trim());
  });

  renderOfflineSessionLastRun(normalized);
}

async function loadRetentionPolicyDoc() {
  const snap = await getDoc(doc(db, "settings", RETENTION_POLICY_DOC));
  return normalizeRetentionPolicy(snap.exists() ? (snap.data() || {}) : {});
}

async function saveRetentionPolicyFromForm(event) {
  event.preventDefault();
  const saveButton = $("#offlineSessionPolicySave");
  let payload;
  try {
    payload = readRetentionPolicyFromForm();
  } catch (error) {
    setOfflineSessionPolicyMessage(error.message || String(error), "error");
    return;
  }

  try {
    if (saveButton) saveButton.disabled = true;
    setOfflineSessionPolicyMessage("설정을 저장하는 중입니다.", "info");
    const existing = await loadRetentionPolicyDoc();
    await setDoc(
      doc(db, "settings", RETENTION_POLICY_DOC),
      {
        ...payload,
        offlineSessionLastRunAt: existing.offlineSessionLastRunAt || null,
        offlineSessionLastRunSummary: existing.offlineSessionLastRunSummary || null,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || ""
      },
      { merge: true }
    );
    setOfflineSessionPolicyMessage("오프라인 수업 정리 설정을 저장했습니다.", "success");
    await refreshRetentionPolicyUi();
  } catch (error) {
    console.error("[operation-tasks] retention policy save failed:", error);
    setOfflineSessionPolicyMessage(getCleanupErrorMessage(error), "error");
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

function filterPreviewSessionCandidates(snapshot, statusSet) {
  const candidates = [];
  let skippedInvalidDateCount = 0;
  let skippedStatusCount = 0;

  snapshot.forEach((recordDoc) => {
    const data = recordDoc.data() || {};
    const sessionDate = String(data.sessionDate || "").trim();

    if (!isValidSessionDateString(sessionDate)) {
      skippedInvalidDateCount += 1;
      return;
    }

    const status = String(data.status || "published").trim();
    if (!statusSet.has(status)) {
      skippedStatusCount += 1;
      return;
    }

    candidates.push({
      id: recordDoc.id,
      sessionDate,
      status,
      hasVideo: data.hasVideo === true
    });
  });

  return { candidates, skippedInvalidDateCount, skippedStatusCount };
}

async function loadAccessSummaryForSessionIds(sessionIds) {
  const activeSessionIds = new Set();
  const accessCountBySession = new Map();
  if (!sessionIds.length) {
    return { activeSessionIds, accessCountBySession };
  }

  for (let index = 0; index < sessionIds.length; index += 30) {
    const chunk = sessionIds.slice(index, index + 30);
    const snap = await getDocs(
      query(collection(db, "offlineSessionAccess"), where("sessionId", "in", chunk))
    );
    snap.forEach((recordDoc) => {
      const data = recordDoc.data() || {};
      const sessionId = String(data.sessionId || "").trim();
      if (!sessionId) return;
      accessCountBySession.set(sessionId, (accessCountBySession.get(sessionId) || 0) + 1);
      if (String(data.status || "").trim() === "active") {
        activeSessionIds.add(sessionId);
      }
    });
  }

  return { activeSessionIds, accessCountBySession };
}

async function collectOfflineSessionCleanupPreview(policyInput) {
  const policy = normalizeRetentionPolicy(policyInput);
  const cutoffDate = computeCutoffDateString(policy.offlineSessionRetentionDays);
  const statusSet = new Set(policy.offlineSessionStatuses);

  if (!policy.offlineSessionCleanupEnabled) {
    return {
      policy,
      cutoffDate,
      disabled: true,
      scannedSessionCount: 0,
      candidateSessionCount: 0,
      wouldProcessCount: 0,
      wouldDeleteAccessCount: 0,
      skippedInvalidDateCount: 0,
      skippedStatusCount: 0,
      skippedActiveAccessCount: 0,
      previewLimited: true,
      previewLimit: OFFLINE_SESSION_PREVIEW_LIMIT
    };
  }

  const sessionsSnap = await getDocs(
    query(
      collection(db, "offlineClassSessions"),
      where("sessionDate", "<", cutoffDate),
      orderBy("sessionDate"),
      limit(OFFLINE_SESSION_PREVIEW_LIMIT)
    )
  );

  const { candidates, skippedInvalidDateCount, skippedStatusCount } =
    filterPreviewSessionCandidates(sessionsSnap, statusSet);

  const previewSessionIds = candidates.map((row) => row.id);
  const { activeSessionIds, accessCountBySession } = policy.offlineSessionSkipActiveAccess
    ? await loadAccessSummaryForSessionIds(previewSessionIds)
    : { activeSessionIds: new Set(), accessCountBySession: new Map() };

  let wouldProcessCount = 0;
  let wouldDeleteAccessCount = 0;
  let skippedActiveAccessCount = 0;

  for (const candidate of candidates) {
    if (wouldProcessCount >= policy.offlineSessionPerRunLimit) break;

    if (policy.offlineSessionSkipActiveAccess && activeSessionIds.has(candidate.id)) {
      skippedActiveAccessCount += 1;
      continue;
    }

    wouldProcessCount += 1;
    wouldDeleteAccessCount += accessCountBySession.get(candidate.id) || 0;
  }

  return {
    policy,
    cutoffDate,
    disabled: false,
    scannedSessionCount: sessionsSnap.size,
    candidateSessionCount: candidates.length,
    wouldProcessCount,
    wouldDeleteAccessCount,
    skippedInvalidDateCount,
    skippedStatusCount,
    skippedActiveAccessCount,
    previewLimited: true,
    previewLimit: OFFLINE_SESSION_PREVIEW_LIMIT,
    hasMoreInSample: candidates.length >= OFFLINE_SESSION_PREVIEW_LIMIT
  };
}

function renderOfflineSessionPreviewCounts(preview) {
  if (preview.disabled) {
    renderRecordCleanupCounts("#offlineSessionPreviewCounts", [{
      title: "오프라인 수업 정리",
      policy: "자동 정리가 꺼져 있습니다.",
      count: 0,
      suffix: ""
    }]);
    return;
  }

  const deleteLabel = preview.policy.offlineSessionDryRun ? " (대상만 기록)" : " (실제 삭제 예정)";
  renderRecordCleanupCounts("#offlineSessionPreviewCounts", [
    {
      title: "확인한 수업 (샘플)",
      policy: `${preview.cutoffDate} 이전, 최대 ${preview.previewLimit}개 조회`,
      count: preview.scannedSessionCount,
      suffix: preview.hasMoreInSample ? " · 더 있을 수 있음" : ""
    },
    {
      title: "정리 후보 (상태 필터 후)",
      policy: preview.policy.offlineSessionStatuses.join(", "),
      count: preview.candidateSessionCount,
      suffix: ""
    },
    {
      title: `이번 자동 실행 예상${deleteLabel}`,
      policy: `1회 최대 ${preview.policy.offlineSessionPerRunLimit}건`,
      count: preview.wouldProcessCount,
      suffix: ""
    },
    {
      title: "함께 삭제될 권한 기록 예상",
      policy: "수업별 연결 기록",
      count: preview.wouldDeleteAccessCount,
      suffix: ""
    },
    {
      title: "수동 권한(active) 제외",
      policy: preview.policy.offlineSessionSkipActiveAccess ? "적용" : "미적용",
      count: preview.skippedActiveAccessCount,
      suffix: ""
    }
  ]);
}

function renderOfflineSessionLastRun(policy) {
  const container = $("#offlineSessionLastRun");
  if (!container) return;

  const lastRunAtMs = getTimestampMillis(policy.offlineSessionLastRunAt);
  const summary = policy.offlineSessionLastRunSummary && typeof policy.offlineSessionLastRunSummary === "object"
    ? policy.offlineSessionLastRunSummary
    : null;

  if (!lastRunAtMs && !summary) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  container.hidden = false;
  const lastRunText = lastRunAtMs ? formatKoreanDateTime(lastRunAtMs) : "기록 없음";
  const actualDelete =
    summary?.actualDeleteEnabled === true ||
    summary?.dryRun === false;
  const modeText = summary?.skipped
    ? `건너뜀 (${String(summary.reason || "disabled")})`
    : (actualDelete ? "실제 삭제" : "대상만 기록");
  const scanned = Number(summary?.scannedSessionCount ?? summary?.scannedCount ?? 0);
  const candidates = Number(summary?.candidateSessionCount ?? summary?.candidateCount ?? 0);
  const deletedSessions = Number(summary?.deletedSessionCount || 0);
  const deletedAccess = Number(summary?.deletedAccessCount || 0);
  const skippedActive = Number(summary?.skippedActiveAccessCount || 0);
  const excluded = skippedActive + Number(summary?.skippedStatusCount || 0);

  const cutoffLabel = String(summary?.cutoffDate || "-") + " (" + String(Number(summary?.retentionDays || "-")) + "일 보존)";
  container.innerHTML = [
    "<strong>마지막 자동 실행</strong>",
    "<dl>",
    "<dt>마지막 실행</dt>",
    "<dd>" + escapeHtml(lastRunText) + "</dd>",
    "<dt>실행 방식</dt>",
    "<dd>" + escapeHtml(modeText) + "</dd>",
    "<dt>기준일</dt>",
    "<dd>" + escapeHtml(cutoffLabel) + "</dd>",
    "<dt>확인한 수업</dt>",
    "<dd>" + localizedCountHtml(scanned) + "</dd>",
    "<dt>정리 대상</dt>",
    "<dd>" + localizedCountHtml(candidates) + "</dd>",
    "<dt>실제 삭제된 수업</dt>",
    "<dd>" + localizedCountHtml(deletedSessions) + "</dd>",
    "<dt>함께 삭제된 권한 기록</dt>",
    "<dd>" + localizedCountHtml(deletedAccess) + "</dd>",
    "<dt>제외된 수업</dt>",
    "<dd>" + localizedCountHtml(excluded) + " (수동 권한 등)</dd>",
    "</dl>"
  ].join("");
}

async function previewOfflineSessionCleanupTargets() {
  const previewButton = $("#offlineSessionPreviewButton");
  try {
    if (previewButton) previewButton.disabled = true;
    setOfflineSessionPolicyMessage("오프라인 수업 정리 대상을 확인하는 중입니다.", "info");
    const policy = readRetentionPolicyFromForm();
    const preview = await collectOfflineSessionCleanupPreview(policy);
    renderOfflineSessionPreviewCounts(preview);

    if (preview.disabled) {
      setOfflineSessionPolicyMessage("자동 정리가 꺼져 있어 대상을 계산하지 않았습니다.", "info");
      return;
    }

    setOfflineSessionPolicyMessage(
      preview.wouldProcessCount
        ? `확인 ${preview.scannedSessionCount.toLocaleString("ko-KR")}건 · 정리 ${preview.wouldProcessCount.toLocaleString("ko-KR")}건${preview.policy.offlineSessionDryRun ? " (기록만)" : ""}`
        : "현재 설정·샘플 기준으로 정리할 오프라인 수업이 없습니다.",
      preview.wouldProcessCount ? "info" : "success"
    );
  } catch (error) {
    console.error("[operation-tasks] offline session preview failed:", error);
    setOfflineSessionPolicyMessage(error.message || getCleanupErrorMessage(error), "error");
  } finally {
    if (previewButton) previewButton.disabled = false;
  }
}

async function refreshRetentionPolicyUi() {
  const policy = await loadRetentionPolicyDoc();
  applyRetentionPolicyToForm(policy);
  const status = $("#operationTaskStatus");
  const message = $("#recordCleanupMessage");
  const summary = policy.recordCleanupLastRunSummary;
  const lastRunAt = getTimestampMillis(policy.recordCleanupLastRunAt);
  if (status) {
    status.textContent = lastRunAt
      ? `매일 03:00 자동 정리 · 최근 실행 ${formatKoreanDateTime(lastRunAt)}`
      : "매일 03:00 자동 정리 · 아직 실행 기록이 없습니다.";
  }
  if (message) {
    message.hidden = false;
    message.className = "record-cleanup-message is-success";
    message.textContent = summary
      ? `최근 자동 정리: ${Number(summary.totalDeleted || 0).toLocaleString("ko-KR")}개 삭제${summary.hasMore ? " · 남은 항목은 다음 실행에서 처리" : ""}`
      : "만료된 인증·가입 시도·자녀 연동 기록을 자동으로 정리합니다.";
  }
}

async function previewRecordCleanupTargets() {
  if (!assertCleanupAllowed()) return;

  const previewButton = $("#recordCleanupPreviewButton");
  try {
    if (previewButton) previewButton.disabled = true;
    setRecordCleanupMessage("정리 대상을 확인하는 중입니다. (컬렉션 3개 조회)", "info");
    const scanResults = await collectRecordCleanupTargets();
    markCleanupScanNow();
    refreshCooldownUi();

    const rows = buildDisplayRows(scanResults);
    renderRecordCleanupCounts("#recordCleanupCounts", rows);
    const total = scanResults.reduce((sum, result) => sum + result.targets.length, 0);
    setRecordCleanupMessage(
      total ? `정리 대상 ${total.toLocaleString("ko-KR")}개를 확인했습니다.` : "정리할 오래된 운영 기록이 없습니다.",
      total ? "info" : "success"
    );
  } catch (error) {
    console.error("[operation-tasks] 운영 기록 정리 대상 확인 실패:", error);
    setRecordCleanupMessage(getCleanupErrorMessage(error), "error");
  } finally {
    refreshCooldownUi();
  }
}

async function executeRecordCleanup() {
  if (!assertCleanupAllowed()) return;

  const executeButton = $("#recordCleanupExecute");
  const previewButton = $("#recordCleanupPreviewButton");
  const originalText = executeButton?.textContent || "오래된 운영 기록 정리";

  try {
    if (executeButton) {
      executeButton.disabled = true;
      executeButton.textContent = "정리 중...";
    }
    if (previewButton) previewButton.disabled = true;
    setRecordCleanupMessage("운영 기록을 정리하는 중입니다. (컬렉션 3개 조회)", "info");

    const scanResults = await collectRecordCleanupTargets();
    markCleanupScanNow();
    refreshCooldownUi();

    const resultRows = [];
    let totalDeleted = 0;
    let hasMore = false;

    for (const { config, targets } of scanResults) {
      const deletedCount = await deleteRecordsInChunks(targets, config.collectionName);
      totalDeleted += deletedCount;
      hasMore = hasMore || targets.length > RECORD_CLEANUP_DELETE_LIMIT;
      resultRows.push({
        title: config.title,
        policy: config.policy,
        count: deletedCount,
        suffix: " 정리"
      });
    }

    renderRecordCleanupCounts("#recordCleanupCounts", resultRows);

    if (totalDeleted > 0) {
      setRecordCleanupMessage(
        `${totalDeleted.toLocaleString("ko-KR")}개 정리 완료${hasMore ? " · 남은 항목은 다음 자동 정리에서 처리" : ""}`,
        "success"
      );
    } else {
      setRecordCleanupMessage("정리할 오래된 운영 기록이 없습니다.", "success");
    }
  } catch (error) {
    console.error("[operation-tasks] 운영 기록 정리 실패:", error);
    setRecordCleanupMessage(getCleanupErrorMessage(error), "error");
  } finally {
    if (executeButton) {
      executeButton.textContent = originalText;
    }
    refreshCooldownUi();
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("#offlineSessionPreviewButton")) {
    previewOfflineSessionCleanupTargets();
  }
});

$("#offlineSessionRetentionForm")?.addEventListener("submit", saveRetentionPolicyFromForm);

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
    await refreshRetentionPolicyUi();
  } catch (error) {
    console.error("[operation-tasks] 초기화 실패:", error);
    const status = $("#operationTaskStatus");
    if (status) status.textContent = "운영 기록 정리 화면을 불러오지 못했습니다.";
  }
})();
