// /assets/js/pages/instructor-dashboard.js
// Instructor dashboard entrypoint

import { requireRole } from "/assets/js/firebase-init.js";
import { handleError } from "/assets/js/utils/error-handler.js";
import { dom, renderEmptyTable, setDashboardText, state } from "/assets/js/pages/instructor-dashboard/context.js";
import { loadDashboardSettings, setInstructorInfo } from "/assets/js/pages/instructor-dashboard/settings.js";
import { loadMyCourses, setupCourseFilters } from "/assets/js/pages/instructor-dashboard/courses.js";
import { loadEnrollments, setupEnrollmentFilters } from "/assets/js/pages/instructor-dashboard/enrollments.js";
import {
  loadMyOfflineClasses,
  setupOfflineClassFilters
} from "/assets/js/pages/instructor-dashboard/offline-classes.js";
import {
  loadOfflineEnrollments,
  setupOfflineEnrollmentFilters
} from "/assets/js/pages/instructor-dashboard/offline-enrollments.js";

const roleCheckPromise = (async () => {
  const result = await requireRole("instructor", "/members/login.html");
  state.user = result.user;
  return result;
})();

window.viewCourseDetail = function viewCourseDetail(courseId) {
  window.location.href = `/members/instructors/course-detail.html?id=${encodeURIComponent(courseId)}`;
};

function setRosterLoadButton(button, loading, label) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? "불러오는 중..." : label;
}

function renderDeferredRosterPlaceholders() {
  if (dom.courseInfoLoading) dom.courseInfoLoading.style.display = "none";
  if (dom.courseInfo) {
    dom.courseInfo.textContent = "필요할 때 수강생 목록을 불러오세요.";
    dom.courseInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
  }
  renderEmptyTable(dom.enrollmentTable, 6, "수강생 불러오기를 눌러 온라인 수강생 현황을 조회하세요.");
  setDashboardText(dom.statEnrollments, "-");

  if (dom.offlineEnrollmentInfo) {
    dom.offlineEnrollmentInfo.textContent = "필요할 때 오프라인 수강생 목록을 불러오세요.";
    dom.offlineEnrollmentInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
  }
  renderEmptyTable(dom.offlineEnrollmentTable, 6, "수강생 불러오기를 눌러 오프라인 수강생 현황을 조회하세요.");
  setDashboardText(dom.statOfflineStudents, "-");
}

function bindDeferredRosterLoaders() {
  dom.loadEnrollmentsBtn?.addEventListener("click", async () => {
    setRosterLoadButton(dom.loadEnrollmentsBtn, true, "수강생 불러오기");
    try {
      await loadEnrollments();
    } finally {
      setRosterLoadButton(dom.loadEnrollmentsBtn, false, "새로고침");
    }
  });

  dom.loadOfflineEnrollmentsBtn?.addEventListener("click", async () => {
    setRosterLoadButton(dom.loadOfflineEnrollmentsBtn, true, "수강생 불러오기");
    try {
      await loadOfflineEnrollments();
    } finally {
      setRosterLoadButton(dom.loadOfflineEnrollmentsBtn, false, "새로고침");
    }
  });
}

(async () => {
  try {
    await roleCheckPromise;
    if (!state.user) return;
    await Promise.all([loadDashboardSettings(), setInstructorInfo()]);
    setupCourseFilters();
    setupEnrollmentFilters();
    setupOfflineClassFilters();
    setupOfflineEnrollmentFilters();
    bindDeferredRosterLoaders();
    await loadMyCourses();
    await loadMyOfflineClasses();
    renderDeferredRosterPlaceholders();
  } catch (error) {
    handleError(error, "Initialize instructor dashboard", { showToast: true, logError: true });
  }
})();

window.addEventListener("beforeunload", () => {
  if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
});
