import { db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const $ = (selector, root = document) => root.querySelector(selector);
const RETENTION_POLICY_DOC = "retentionPolicy";

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
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

async function refreshCleanupStatus() {
  const snap = await getDoc(doc(db, "settings", RETENTION_POLICY_DOC));
  const policy = snap.exists() ? (snap.data() || {}) : {};
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
      : "만료된 임시 인증·가입·연동 시도 기록만 자동으로 정리합니다.";
  }
}

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
    await refreshCleanupStatus();
  } catch (error) {
    console.error("[operation-tasks] 초기화 실패:", error);
    const status = $("#operationTaskStatus");
    if (status) status.textContent = "운영 기록 정리 화면을 불러오지 못했습니다.";
  }
})();
