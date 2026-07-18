import { createCourseLabelMaps } from "/assets/js/utils/course-readonly.js";

export const dom = {
  welcomeMsg: document.getElementById("welcomeMsg"),
  myCoursesGrid: document.getElementById("myCoursesGrid"),
  myCoursesMeta: document.getElementById("myCoursesMeta"),
  courseFilterButtons: Array.from(document.querySelectorAll(".course-filter-btn")),
  editProfileModal: document.getElementById("editProfileModal"),
  editProfileBtn: document.getElementById("editProfileBtn"),
  closeEditProfileModal: document.getElementById("closeEditProfileModal"),
  editProfileForm: document.getElementById("editProfileForm"),
  editProfileStatus: document.getElementById("editProfileStatus"),
  myOfflineClassesGrid: document.getElementById("myOfflineClassesGrid"),
  myOfflineClassesMeta: document.getElementById("myOfflineClassesMeta"),
  unenrollModal: document.getElementById("unenrollModal"),
  closeUnenrollModal: document.getElementById("closeUnenrollModal"),
  cancelUnenrollBtn: document.getElementById("cancelUnenrollBtn"),
  confirmUnenrollBtn: document.getElementById("confirmUnenrollBtn"),
  unenrollPhraseInput: document.getElementById("unenrollPhraseInput"),
  unenrollCourseTitle: document.getElementById("unenrollCourseTitle"),
  unenrollStatus: document.getElementById("unenrollStatus")
};

export const state = {
  user: null,
  role: null,
  courseLabelMaps: createCourseLabelMaps({}),
  hiddenCourseIds: new Set(),
  instructorsByUid: {},
  allMyCourseRows: [],
  currentCourseFilter: "in-progress",
  latestLegacyCount: 0,
  courseStatCounts: { total: 0, inProgress: 0, beforeStart: 0, completed: 0 },
  offlineClassCount: 0
};

export function escapeHtml(value) {
  if (value == null) return "";
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

export function toast(message, isError = false) {
  const toastApi = window.toast;
  if (toastApi?.error && toastApi?.success) {
    return isError ? toastApi.error(message) : toastApi.success(message);
  }
  if (typeof toastApi === "function") {
    return toastApi(message, isError ? "error" : "success");
  }
  console[isError ? "error" : "log"](message);
}
