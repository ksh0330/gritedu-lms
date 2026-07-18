import {
  createCourseLabelMaps,
  normalizeAccessType,
  normalizeCourseFormat
} from "/assets/js/utils/course-readonly.js";
import { formatGrade } from "/assets/js/utils/grade.js";
import { escapeHtml } from "/assets/js/utils/html.js";

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
  enrollmentCourseFilter: document.getElementById("enrollmentCourseFilter"),
  enrollmentGradeFilter: document.getElementById("enrollmentGradeFilter"),
  loadEnrollmentsBtn: document.getElementById("loadEnrollmentsBtn"),
  enrollmentsPagination: document.getElementById("enrollmentsPagination"),
  statCourses: document.getElementById("statCourses"),
  statEnrollments: document.getElementById("statEnrollments"),
  statOfflineClasses: document.getElementById("statOfflineClasses"),
  statOfflineStudents: document.getElementById("statOfflineStudents"),
  offlineClassesTable: document.getElementById("offlineClassesTable")?.querySelector("tbody"),
  offlineClassesMeta: document.getElementById("offlineClassesMeta"),
  offlineClassSearch: document.getElementById("offlineClassSearch"),
  offlineClassStatusFilter: document.getElementById("offlineClassStatusFilter"),
  offlineClassSubjectFilter: document.getElementById("offlineClassSubjectFilter"),
  offlineClassGradeFilter: document.getElementById("offlineClassGradeFilter"),
  offlineClassesPagination: document.getElementById("offlineClassesPagination"),
  offlineEnrollmentTable: document.getElementById("offlineEnrollmentTable")?.querySelector("tbody"),
  offlineEnrollmentSearch: document.getElementById("offlineEnrollmentSearch"),
  offlineEnrollmentClassFilter: document.getElementById("offlineEnrollmentClassFilter"),
  offlineEnrollmentGradeFilter: document.getElementById("offlineEnrollmentGradeFilter"),
  loadOfflineEnrollmentsBtn: document.getElementById("loadOfflineEnrollmentsBtn"),
  offlineEnrollmentsPagination: document.getElementById("offlineEnrollmentsPagination"),
  offlineEnrollmentInfo: document.getElementById("offlineEnrollmentInfo")
};

export const state = {
  user: null,
  myCourses: [],
  filteredCourses: [],
  coursesPage: 1,
  allEnrollments: [],
  filteredEnrollments: [],
  enrollmentsPage: 1,
  uniqueOnlineStudentCount: 0,
  studentNamesCache: new Map(),
  searchDebounceTimer: null,
  labelMaps: createCourseLabelMaps({}),
  hiddenCourseIds: new Set(),
  instructorsByUid: {},
  instructorProfileId: "",
  myOfflineClasses: [],
  filteredOfflineClasses: [],
  offlineClassesPage: 1,
  allOfflineEnrollments: [],
  filteredOfflineEnrollments: [],
  offlineEnrollmentsPage: 1
};

export function renderEmptyTable(tableElement, colSpan, message) {
  if (!tableElement) return;
  tableElement.innerHTML = `<tr><td colspan="${colSpan}" class="muted instructor-table-empty">${escapeHtml(message)}</td></tr>`;
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

export function isMemberOnlyCourse(course) {
  return normalizeAccessType(course?.accessType) === "memberOnly";
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

export function extractYouTubeId(url) {
  if (!url) return null;
  const youtubeIdPattern = /^[\w-]{11}$/;
  if (youtubeIdPattern.test(String(url).trim())) return String(url).trim();

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/
  ];
  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function normalizeVideoUrl(url) {
  if (!url) return null;

  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return {
      type: "youtube",
      id: youtubeId,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      watchUrl: `https://www.youtube.com/watch?v=${youtubeId}`
    };
  }

  if (String(url).includes(".mp4")) {
    return { type: "mp4", url: String(url) };
  }

  return null;
}

export function buildVideoPlayerHtml(videoUrl, title = "") {
  const info = normalizeVideoUrl(videoUrl);
  const safeTitle = escapeHtml(title || "강의 영상");

  if (!info) {
    return `<p class="muted instructor-video-unavailable">재생할 수 없는 영상 URL입니다.</p>`;
  }

  if (info.type === "youtube") {
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
    dataAttr = "p"
  } = options;

  if (!containerEl) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(safePage * PAGE_SIZE, totalItems);
  const rangeText = totalItems === 0 ? "0건" : `${startItem}-${endItem} / ${totalItems}건`;

  if (totalPages <= 1) {
    containerEl.innerHTML = totalItems > PAGE_SIZE
      ? `<p class="instructor-pagination-info" aria-live="polite">${escapeHtml(rangeText)}</p>`
      : (totalItems > 0 ? `<p class="instructor-pagination-info" aria-live="polite">${escapeHtml(rangeText)}</p>` : "");
    containerEl.onclick = null;
    return safePage;
  }

  const firstDisabled = safePage <= 1;
  const lastDisabled = safePage >= totalPages;
  let start = Math.max(1, safePage - 2);
  let end = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);

  let pages = "";
  for (let i = start; i <= end; i += 1) {
    const active = i === safePage ? " is-active" : "";
    pages += `<button type="button" class="pagination-btn instructor-pagination-num${active}" data-${dataAttr}="${i}">${i}</button>`;
  }

  containerEl.innerHTML = `
    <div class="instructor-pagination-inner">
      <div class="instructor-pagination-controls">
        <button type="button" class="pagination-btn" data-${dataAttr}="first" ${firstDisabled ? "disabled" : ""}>&lt;&lt;</button>
        <button type="button" class="pagination-btn" data-${dataAttr}="prev" ${firstDisabled ? "disabled" : ""}>&lt;</button>
        <div class="instructor-pagination-pages">${pages}</div>
        <button type="button" class="pagination-btn" data-${dataAttr}="next" ${lastDisabled ? "disabled" : ""}>&gt;</button>
        <button type="button" class="pagination-btn" data-${dataAttr}="last" ${lastDisabled ? "disabled" : ""}>&gt;&gt;</button>
      </div>
      <p class="instructor-pagination-info" aria-live="polite">${escapeHtml(rangeText)}</p>
    </div>
  `;

  containerEl.onclick = (event) => {
    const button = event.target.closest(`button[data-${dataAttr}]`);
    if (!button || button.disabled) return;

    const action = button.getAttribute(`data-${dataAttr}`);
    let next = safePage;
    if (action === "first") next = 1;
    else if (action === "prev") next = safePage - 1;
    else if (action === "next") next = safePage + 1;
    else if (action === "last") next = totalPages;
    else next = Number.parseInt(action, 10);

    if (!Number.isInteger(next) || next < 1 || next > totalPages) return;
    onPageChange(next);
  };

  return safePage;
}
