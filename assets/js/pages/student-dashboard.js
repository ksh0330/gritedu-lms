// /assets/js/pages/student-dashboard.js
// Student dashboard entrypoint
import { requireRole } from "/assets/js/firebase-init.js";
import { state } from "/assets/js/pages/student-dashboard/context.js";
import { loadMyCourses, setupCourseFilters, updateCourseFilterButtons } from "/assets/js/pages/student-dashboard/courses.js";
import { loadMyOfflineClasses } from "/assets/js/pages/student-dashboard/offline-classes.js";
import { setupProfileModalHandlers } from "/assets/js/pages/student-dashboard/profile.js";
import { setWelcomeMessage, updateGradeIfNeeded } from "/assets/js/pages/student-dashboard/settings.js";
import { mountDday } from "/assets/js/utils/dday.js";

function ensureDashboardDdayHost() {
  const existing = document.getElementById("dashboardDday");
  if (existing) return existing;

  const host = document.createElement("div");
  host.id = "dashboardDday";
  host.hidden = true;

  const welcomeTarget = document.querySelector(
    "#welcomeMessage, [data-welcome-message], .welcome-message, .dash-welcome, .dashboard-welcome, .student-welcome, .welcome-card"
  );

  if (welcomeTarget) {
    welcomeTarget.insertAdjacentElement("afterend", host);
    return host;
  }

  const fallbackTarget = document.querySelector("main .grit-page-container, main, .grit-page-container");
  fallbackTarget?.prepend(host);
  return host;
}

const roleCheckPromise = (async () => {
  try {
    const result = await requireRole("student", "/members/login.html");
    state.user = result.user;
    state.role = result.role;
    return result;
  } catch (error) {
    console.error("[student-dashboard] role check failed:", error?.message || error);
    throw error;
  }
})();

(async () => {
  try {
    await roleCheckPromise;
  } catch (_error) {
    return;
  }

  if (!state.user) {
    console.error("[student-dashboard] user 변수가 설정되지 않았습니다.");
    return;
  }

  setupCourseFilters();
  setupProfileModalHandlers();
  updateCourseFilterButtons();
  await updateGradeIfNeeded();
  await setWelcomeMessage();
  await mountDday(ensureDashboardDdayHost(), { variant: "dashboard", placement: "dashboard" });
  await loadMyCourses();
  await loadMyOfflineClasses();
})();
