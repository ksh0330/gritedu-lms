import { state } from "/assets/js/pages/student-dashboard/context.js";

function setStatText(elementId, value) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const num = Number(value);
  el.textContent = Number.isFinite(num) ? String(num) : "-";
  el.classList.remove("dashboard-skeleton", "dashboard-skeleton--stat");
}

function getCourseFilterKey(row) {
  const progress = row.completion?.progress;
  if (progress == null) return "in-progress";
  if (progress >= 100) return "completed";
  if (progress <= 0) return "before-start";
  return "in-progress";
}

export function updateCourseStatCounts() {
  const counts = { total: 0, inProgress: 0, beforeStart: 0, completed: 0 };
  state.allMyCourseRows.forEach((row) => {
    counts.total += 1;
    const key = getCourseFilterKey(row);
    if (key === "completed") counts.completed += 1;
    else if (key === "before-start") counts.beforeStart += 1;
    else counts.inProgress += 1;
  });
  state.courseStatCounts = counts;
  refreshStudentDashboardStats();
}

export function setOfflineClassStatCount(count) {
  state.offlineClassCount = Math.max(0, Number(count) || 0);
  refreshStudentDashboardStats();
}

export function refreshStudentDashboardStats() {
  const c = state.courseStatCounts;
  setStatText("statStudentCoursesTotal", c.total);
  setStatText("statStudentCoursesInProgress", c.inProgress);
  setStatText("statStudentCoursesBeforeStart", c.beforeStart);
  setStatText("statStudentCoursesCompleted", c.completed);
  setStatText("statStudentOfflineClasses", state.offlineClassCount);
}
