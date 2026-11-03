import {
  createCourseLabelMaps,
  normalizeAccessType,
  normalizeCourseFormat,
  getAccessTypeBadgeLabel
} from "/assets/js/utils/course-readonly.js";
import { formatGrade } from "/assets/js/utils/grade.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { hasInstructorRoster } from "/assets/js/utils/instructor-course-access.js";
import { normalizeVideoUrl } from "/assets/js/utils/video-url.js";
import { mergeSubjectColorMap } from "/assets/js/utils/subject-colors.js";
import { renderListPagination as renderCommonListPagination } from "/assets/js/utils/list-controls.js";

export const PAGE_SIZE = 10;

export const dom = {
  instructorInfo: document.getElementById("instructorInfo"),
  courseInfo: document.getElementById("courseInfo"),
  courseInfoLoading: document.getElementById("courseInfoLoading"),
  coursesTable: document.getElementById("coursesTable")?.querySelector("tbody"),
  courseSearch: document.getElementById("courseSearch"),
  courseYearFilter: document.getElementById("courseYearFilter"),
  courseGradeFilter: document.getElementById("courseGradeFilter"),
  courseAccessFilter: document.getElementById("courseAccessFilter"),
  courseFormatFilter: document.getElementById("courseFormatFilter"),
  coursesPagination: document.getElementById("coursesPagination"),
  enrollmentTable: document.getElementById("enrollmentTable")?.querySelector("tbody"),
  enrollmentSearch: document.getElementById("enrollmentSearch"),
  enrollmentSearchButton: document.getElementById("enrollmentSearchButton"),
  enrollmentCourseFilter: document.getElementById("enrollmentCourseFilter"),
  enrollmentGradeFilter: document.getElementById("enrollmentGradeFilter"),
  loadEnrollmentsBtn: document.getElementById("loadEnrollmentsBtn"),
  enrollmentsPagination: document.getElementById("enrollmentsPagination"),
  statCourses: document.getElementById("statCourses"),
  statEnrollments: document.getElementById("statEnrollments"),
  statOfflineClasses: document.getElementById("statOfflineClasses"),
  statOfflineStudents: document.getElementById("statOfflineStudents"),
  offlineClassesTable: document.getElementById("offlineClassesTable")?.querySelector("tbody"),
  offlineClassSearch: document.getElementById("offlineClassSearch"),
  offlineClassStatusFilter: document.getElementById("offlineClassStatusFilter"),
  offlineClassSubjectFilter: document.getElementById("offlineClassSubjectFilter"),
  offlineClassGradeFilter: document.getElementById("offlineClassGradeFilter"),
  offlineClassesPagination: document.getElementById("offlineClassesPagination"),
  offlineEnrollmentTable: document.getElementById("offlineEnrollmentTable")?.querySelector("tbody"),
  offlineEnrollmentSearch: document.getElementById("offlineEnrollmentSearch"),
  offlineEnrollmentSearchButton: document.getElementById("offlineEnrollmentSearchButton"),
  offlineEnrollmentClassFilter: document.getElementById("offlineEnrollmentClassFilter"),
  offlineEnrollmentGradeFilter: document.getElementById("offlineEnrollmentGradeFilter"),
  loadOfflineEnrollmentsBtn: document.getElementById("loadOfflineEnrollmentsBtn"),
  offlineEnrollmentsPagination: document.getElementById("offlineEnrollmentsPagination"),
  offlineEnrollmentInfo: document.getElementById("offlineEnrollmentInfo")
};

export const state = {
  user: null,
  myCourses: [],
  coursesLoadError: null,
  filteredCourses: [],
  coursesPage: 1,
  allEnrollments: [],
  filteredEnrollments: [],
  appliedEnrollmentKeyword: "",
  enrollmentsPage: 1,
  uniqueOnlineStudentCount: 0,
  studentNamesCache: new Map(),
  searchDebounceTimer: null,
  labelMaps: createCourseLabelMaps({}),
  hiddenCourseIds: new Set(),
  instructorsByUid: {},
  subjectColorMap: mergeSubjectColorMap({}),
  instructorProfileId: "",
  myOfflineClasses: [],
  offlineClassesLoadError: null,
  filteredOfflineClasses: [],
  offlineClassesPage: 1,
  allOfflineEnrollments: [],
  filteredOfflineEnrollments: [],
  appliedOfflineEnrollmentKeyword: "",
  offlineEnrollmentsPage: 1
};

export function renderEmptyTable(tableElement, colSpan, message) {
  if (!tableElement) return;
  tableElement.innerHTML = `<tr><td colspan="${colSpan}" class="muted instructor-table-empty">${formatDashboardMessageHtml(message)}</td></tr>`;
}

export function formatListLoadError(message, error) {
  const code = String(error?.code || "unknown").trim() || "unknown";
  return `${message} (에러 코드: ${code})`;
}

function formatDashboardMessageHtml(message) {
  const text = String(message || "");
  const match = text.match(/^(.*?)(\s*\(에러 코드:\s*([^)]+)\))$/);
  if (!match) return escapeHtml(text);
  return `${escapeHtml(match[1])} <span class="instructor-error-code">(에러 코드: ${escapeHtml(match[3])})</span>`;
}

export function setDashboardMessage(element, message) {
  if (!element) return;
  element.innerHTML = formatDashboardMessageHtml(message);
  element.hidden = !message;
}

export function setDashboardText(element, value) {
  if (!element) return;
  element.textContent = value;
  element.classList.remove("dashboard-skeleton", "dashboard-skeleton--stat", "dashboard-skeleton--text");
}

export function formatLastActivity(enrollment) {
  const ts = enrollment?.updatedAt || enrollment?.lastActivityAt || enrollment?.createdAt;
  if (!ts) return "-";
  try {
    const date = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("ko-KR");
  } catch {
    return "-";
  }
}

export function formatInstructorGrade(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const label = formatGrade(raw);
  return label === "-" ? raw : label;
}

function formatStudentFields(source, enrollment) {
  return {
    name: String(source?.name || "").trim() || "이름 미등록",
    school: String(source?.school || "").trim() || "-",
    grade: formatInstructorGrade(source?.gradeSnapshot || source?.grade),
    phone: String(source?.phone || "").trim() || "-",
    lastActivity: formatLastActivity(enrollment)
  };
}

function formatLearnerFields(source, enrollment) {
  const type = String(source?.type || enrollment?.learnerType || "").trim();
  const isMember = type === "member";
  return {
    name: String(source?.name || "").trim() || (isMember ? "회원 이름 미등록" : "이름 미등록"),
    school: isMember ? "-" : (String(source?.school || "").trim() || "-"),
    grade: isMember ? "일반 회원" : formatInstructorGrade(source?.gradeSnapshot || source?.grade),
    phone: String(source?.phone || "").trim() || "-",
    lastActivity: formatLastActivity(enrollment)
  };
}

function hasStudentFields(source) {
  if (!source) return false;
  return Boolean(
    String(source.name || "").trim() ||
    String(source.school || "").trim() ||
    String(source.gradeSnapshot || "").trim() ||
    String(source.grade || "").trim() ||
    String(source.phone || "").trim()
  );
}

function hasLearnerFields(source) {
  if (!source) return false;
  return Boolean(
    String(source.name || "").trim() ||
    String(source.email || "").trim() ||
    String(source.phone || "").trim() ||
    String(source.type || "").trim() ||
    String(source.school || "").trim() ||
    String(source.grade || "").trim()
  );
}

/** Instructor views: enrollment snapshots only (no broad students/users reads). */
export function resolveEnrollmentStudentFromSnapshot(enrollment) {
  const learnerSnap =
    enrollment?.learnerSnapshot && typeof enrollment.learnerSnapshot === "object"
      ? enrollment.learnerSnapshot
      : {};
  if (hasLearnerFields(learnerSnap)) {
    return formatLearnerFields(learnerSnap, enrollment);
  }

  const snap =
    enrollment?.studentSnapshot && typeof enrollment.studentSnapshot === "object"
      ? enrollment.studentSnapshot
      : {};
  if (hasStudentFields(snap)) {
    return formatStudentFields(snap, enrollment);
  }
  return {
    name: "정보 없음",
    school: "-",
    grade: "-",
    phone: "-",
    lastActivity: formatLastActivity(enrollment)
  };
}

/** Canonical students/{uid} takes priority over enrollment snapshots. */
export function resolveEnrollmentStudent(enrollment, usersData = {}, canonicalProfiles = null) {
  const userId = String(enrollment?.userId || "").trim();
  const canonical = canonicalProfiles instanceof Map ? canonicalProfiles.get(userId) : null;

  if (hasStudentFields(canonical)) {
    return formatStudentFields(canonical, enrollment);
  }

  const legacy = usersData[userId] || {};
  if (hasStudentFields(legacy)) {
    return formatStudentFields(legacy, enrollment);
  }

  const snap = enrollment?.studentSnapshot && typeof enrollment.studentSnapshot === "object"
    ? enrollment.studentSnapshot
    : {};
  if (hasStudentFields(snap)) {
    return formatStudentFields(snap, enrollment);
  }

  return formatStudentFields({}, enrollment);
}

export function isEnrollmentManagedCourse(course) {
  return hasInstructorRoster(normalizeAccessType(course?.accessType));
}

export function getInstructorCourseAccessLabel(accessType) {
  return normalizeAccessType(accessType) === "approvalRequired"
    ? "회원 전용(유료)"
    : getAccessTypeBadgeLabel(accessType);
}

export function getEnrollmentActivityMillis(enrollment) {
  const ts = enrollment?.updatedAt || enrollment?.lastActivityAt || enrollment?.createdAt;
  if (!ts) return 0;
  try {
    if (typeof ts.toMillis === "function") return ts.toMillis();
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  } catch {
    return 0;
  }
}

export function getWeekVideoArray(week) {
  if (!week || typeof week !== "object") return [];

  if (Array.isArray(week.videos) && week.videos.length > 0) {
    return week.videos
      .map((video) => (typeof video === "string" ? video : (video?.url || video?.fullUrl || video?.videoUrl || "")))
      .filter(Boolean);
  }

  if (Array.isArray(week.lessons) && week.lessons.length > 0) {
    return week.lessons
      .map((lesson) => (typeof lesson === "string" ? lesson : (lesson?.url || lesson?.fullUrl || lesson?.videoUrl || "")))
      .filter(Boolean);
  }

  const videoData = week.video || week.videoUrl || "";
  return Array.isArray(videoData) ? videoData : (videoData ? [videoData] : []);
}

export function buildVideoPlayerHtml(videoUrl, title = "") {
  const info = normalizeVideoUrl(videoUrl);
  const safeTitle = escapeHtml(title || "강의 영상");

  if (!info) {
    return `<p class="muted instructor-video-unavailable">재생할 수 없는 영상 URL입니다.</p>`;
  }

  if (info.type === "youtube" || info.type === "youtubePlaylist") {
    return `
      <div class="instructor-video-block">
        ${title ? `<p class="instructor-video-title">${safeTitle}</p>` : ""}
        <div class="instructor-video-embed">
          <iframe src="${escapeHtml(info.embedUrl)}" title="${safeTitle}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
        </div>
      </div>
    `;
  }

  return `
    <div class="instructor-video-block">
      ${title ? `<p class="instructor-video-title">${safeTitle}</p>` : ""}
      <video class="instructor-video-mp4" controls preload="metadata" src="${escapeHtml(info.url)}"></video>
    </div>
  `;
}

export { normalizeCourseFormat };

export function renderListPagination(containerEl, options) {
  const {
    page,
    totalItems,
    onPageChange,
  } = options;

  if (!containerEl) return;
  return renderCommonListPagination(containerEl, {
    currentPage: page,
    onPageChange,
    pageSize: PAGE_SIZE,
    totalItems,
  }).currentPage;
}
