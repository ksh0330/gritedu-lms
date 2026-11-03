// /assets/js/pages/admin-dashboard-index.js
// 관리자 CMS 인덱스 페이지
import { requireRole, db } from "/assets/js/firebase-init.js";
import { setAdminRefreshButtonState } from "/assets/js/utils/admin-refresh.js";
import {
  collection,
  getCountFromServer,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

let isRoleVerified = false;
let isStatusLoading = false;
let hasLoadedStatus = false;

const STATUS_CARDS = {
  students: ["statusStudents", "statusStudentsMeta"],
  instructors: ["statusInstructors", "statusInstructorsMeta"],
  courses: ["statusCourses", "statusCoursesMeta"],
  offlineClasses: ["statusOfflineClasses", "statusOfflineClassesMeta"],
  onlineStudents: ["statusOnlineStudents", "statusOnlineStudentsMeta"],
  offlineStudents: ["statusOfflineStudents", "statusOfflineStudentsMeta"]
};

function formatCount(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function setCardState(key, value, meta, state = "") {
  const [valueId, metaId] = STATUS_CARDS[key] || [];
  const valueEl = valueId ? document.getElementById(valueId) : null;
  const metaEl = metaId ? document.getElementById(metaId) : null;
  const cardEl = document.querySelector(`[data-status-key="${key}"]`);

  if (valueEl) valueEl.textContent = value;
  if (metaEl) metaEl.textContent = meta;
  if (cardEl) cardEl.dataset.state = state;
}

function setAllCardsLoading() {
  Object.keys(STATUS_CARDS).forEach((key) => {
    setCardState(key, "...", "불러오는 중", "loading");
  });
}

async function countCollection(collectionName, constraints = []) {
  const collectionRef = collection(db, collectionName);
  const target = constraints.length ? query(collectionRef, ...constraints) : collectionRef;
  const snapshot = await getCountFromServer(target);
  return snapshot.data().count || 0;
}

async function loadCountCard(key, collectionName, meta, constraints = []) {
  try {
    const count = await countCollection(collectionName, constraints);
    setCardState(key, formatCount(count), meta, "loaded");
    return true;
  } catch (error) {
    console.error(`${collectionName} 현황 로드 실패:`, error);
    setCardState(key, "오류", "조회 실패", "error");
    return false;
  }
}

function setStatusButtonsLoading(loading) {
  const loadBtn = document.getElementById("loadStatusBtn");
  const refreshBtn = document.getElementById("refreshBtn");

  if (loadBtn) {
    loadBtn.hidden = hasLoadedStatus;
    loadBtn.disabled = loading;
    loadBtn.textContent = loading ? "불러오는 중..." : "현황 불러오기";
  }

  if (refreshBtn) {
    refreshBtn.hidden = !hasLoadedStatus;
    setAdminRefreshButtonState(refreshBtn, loading, {
      disabledWhenReady: !hasLoadedStatus,
    });
  }
}

window.loadDashboardStatus = async function() {
  if (!isRoleVerified || isStatusLoading) return;

  isStatusLoading = true;
  setStatusButtonsLoading(true);
  setAllCardsLoading();

  const results = await Promise.all([
    loadCountCard("students", "students", "등록된 학생 기준"),
    loadCountCard("instructors", "instructors", "등록된 강사 기준"),
    loadCountCard("courses", "courses", "게시 중인 강좌 기준", [where("status", "==", "published")]),
    loadCountCard("offlineClasses", "offlineClasses", "운영 중인 반 기준", [where("status", "==", "active")]),
    loadCountCard("onlineStudents", "enrollments", "현재 수강 등록 기준", [where("status", "==", "active")]),
    loadCountCard("offlineStudents", "offlineClassMembers", "현재 반 배정 기준", [where("status", "==", "active")])
  ]);

  const updatedAtEl = document.getElementById("statusUpdatedAt");
  const successCount = results.filter(Boolean).length;
  if (updatedAtEl && successCount === results.length) {
    updatedAtEl.textContent = `마지막 성공 조회: ${new Date().toLocaleString("ko-KR")}`;
  }

  const resultEl = document.getElementById("statusResult");
  if (resultEl) {
    resultEl.textContent = successCount === results.length
      ? "전체 현황을 불러왔습니다."
      : successCount === 0
        ? "전체 현황을 불러오지 못했습니다. 다시 시도해 주세요."
        : `${successCount}개 지표를 불러왔고 ${results.length - successCount}개는 실패했습니다. 다시 시도해 주세요.`;
    resultEl.dataset.state = successCount === results.length ? "success" : "error";
  }
  hasLoadedStatus = hasLoadedStatus || successCount === results.length;
  isStatusLoading = false;
  setStatusButtonsLoading(false);
};

window.refreshDashboard = function() {
  window.loadDashboardStatus();
};

document.getElementById("refreshBtn")?.addEventListener("click", window.refreshDashboard);

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
    isRoleVerified = true;
    setStatusButtonsLoading(false);
  } catch (_err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();
