// /assets/js/pages/admin-dashboard-index.js
// 관리자 CMS 인덱스 페이지
import { requireRole, db } from "/assets/js/firebase-init.js";
import {
  collection,
  getCountFromServer
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
  offlineStudents: ["statusOfflineStudents", "statusOfflineStudentsMeta"],
  timetable: ["statusTimetable", "statusTimetableMeta"]
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

async function countCollection(collectionName) {
  const snapshot = await getCountFromServer(collection(db, collectionName));
  return snapshot.data().count || 0;
}

async function loadCountCard(key, collectionName, meta) {
  try {
    const count = await countCollection(collectionName);
    setCardState(key, formatCount(count), meta, "loaded");
  } catch (error) {
    console.error(`${collectionName} 현황 로드 실패:`, error);
    setCardState(key, "오류", "조회 실패", "error");
  }
}

async function loadTimetableCard() {
  try {
    const count = await countCollection("publicTimetableEntries");
    setCardState("timetable", formatCount(count), "공개 시간표 기준", "loaded");
  } catch (error) {
    console.error("시간표 현황 로드 실패:", error);
    setCardState("timetable", "확인 필요", "시간표 확인 필요", "warning");
  }
}

function setStatusButtonsLoading(loading) {
  const loadBtn = document.getElementById("loadStatusBtn");
  const refreshBtn = document.getElementById("refreshBtn");

  if (loadBtn) {
    loadBtn.disabled = loading;
    loadBtn.textContent = loading ? "불러오는 중..." : "현황 불러오기";
  }

  if (refreshBtn) {
    refreshBtn.disabled = loading || !hasLoadedStatus;
    refreshBtn.textContent = loading ? "새로고침 중..." : "새로고침";
  }
}

window.loadDashboardStatus = async function() {
  if (!isRoleVerified || isStatusLoading) return;

  isStatusLoading = true;
  setStatusButtonsLoading(true);
  setAllCardsLoading();

  await Promise.all([
    loadCountCard("students", "students", "등록된 학생 기준"),
    loadCountCard("instructors", "instructors", "등록된 강사 기준"),
    loadCountCard("courses", "courses", "등록된 온라인 강좌 기준"),
    loadCountCard("offlineClasses", "offlineClasses", "등록된 오프라인 반 기준"),
    loadCountCard("onlineStudents", "enrollments", "수강 기록 기준"),
    loadCountCard("offlineStudents", "offlineClassMembers", "반 배정 기록 기준"),
    loadTimetableCard()
  ]);

  const updatedAtEl = document.getElementById("statusUpdatedAt");
  if (updatedAtEl) {
    updatedAtEl.textContent = `마지막 조회: ${new Date().toLocaleString("ko-KR")}`;
  }

  hasLoadedStatus = true;
  isStatusLoading = false;
  setStatusButtonsLoading(false);
};

window.refreshDashboard = function() {
  window.loadDashboardStatus();
};

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
    isRoleVerified = true;
    setStatusButtonsLoading(false);
  } catch (_err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();
