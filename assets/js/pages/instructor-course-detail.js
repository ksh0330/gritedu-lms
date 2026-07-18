// /assets/js/pages/instructor-course-detail.js
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection, query, where, getDocs, getDoc, doc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import "/assets/js/utils/toast.js";
import { handleError, createErrorUI } from "/assets/js/utils/error-handler.js";
import {
  normalizeCourseForReadOnly,
  normalizeAccessType,
  getAccessTypeBadgeLabel,
  getCourseFormatBadgeLabel
} from "/assets/js/utils/course-readonly.js";
import {
  PAGE_SIZE,
  renderListPagination,
  resolveEnrollmentStudentFromSnapshot,
  formatLastActivity,
  buildVideoPlayerHtml,
  getWeekVideoArray,
  normalizeCourseFormat
} from "/assets/js/pages/instructor-dashboard/context.js";
let user;
let instructorProfileId = "";
const urlParams = new URLSearchParams(window.location.search);
const courseId = urlParams.get("id");

const roleCheckPromise = (async () => {
  const result = await requireRole("instructor", "/members/login.html");
  user = result.user;
  return { user };
})();

let courseData = null;
let allEnrollments = [];
let filteredEnrollments = [];
let enrollmentsPage = 1;
let searchDebounceTimer = null;

const PUBLIC_ENROLLMENT_MESSAGE = "공개 강좌는 수강신청 없이 제공되는 강좌입니다.";

function getAssignedInstructorIds(course) {
  const ids = [
    course?.instructorUid,
    course?.instructorId,
    ...(Array.isArray(course?.instructorUids) ? course.instructorUids : [])
  ];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

function canCurrentInstructorAccessCourse(course, currentUser) {
  const uid = String(currentUser?.uid || "").trim();
  if (!uid) return false;
  const allowedIds = new Set(getAssignedInstructorIds(course));
  return allowedIds.has(uid) || (instructorProfileId && allowedIds.has(instructorProfileId));
}

function isMemberOnlyCourse(course) {
  return normalizeAccessType(course?.accessType) === "memberOnly";
}

function formatEnrollmentDate(enrollment) {
  const ts = enrollment?.createdAt || enrollment?.enrolledAt;
  if (!ts) return "-";
  try {
    const date = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("ko-KR");
  } catch {
    return "-";
  }
}

function resolveStudentRow(enrollment) {
  const base = resolveEnrollmentStudentFromSnapshot(enrollment);
  return {
    ...base,
    enrolledAt: formatEnrollmentDate(enrollment),
    lastActivity: formatLastActivity(enrollment)
  };
}

function hideStatsSection() {
  const statsSection = document.getElementById("statEnrollments")?.closest(".grit-section");
  if (statsSection) statsSection.hidden = true;
}

function getWeekVideoUrl(video) {
  if (typeof video === "string") return String(video || "").trim();
  return String(video?.url || video?.fullUrl || video?.videoUrl || "").trim();
}

function getWeekVideoTitle(video, index) {
  if (typeof video === "string") return `${index + 1}차시`;
  const text = String(video?.title || "").trim();
  return text || `${index + 1}차시`;
}

function getWeekVideoItems(week) {
  if (!week || typeof week !== "object") return [];

  if (Array.isArray(week.videos) && week.videos.length > 0) {
    return week.videos.map((video, index) => ({
      url: getWeekVideoUrl(video),
      title: getWeekVideoTitle(video, index)
    })).filter((item) => item.url);
  }

  if (Array.isArray(week.lessons) && week.lessons.length > 0) {
    return week.lessons.map((lesson, index) => ({
      url: getWeekVideoUrl(lesson),
      title: getWeekVideoTitle(lesson, index)
    })).filter((item) => item.url);
  }

  const legacyUrls = getWeekVideoArray(week);
  return legacyUrls.map((url, index) => ({
    url,
    title: `${index + 1}차시`
  }));
}

function renderSingleCourseVideos(weeks) {
  const firstWeek = weeks[0] || {};
  const items = getWeekVideoItems(firstWeek);

  if (!items.length) {
    return '<p class="muted instructor-course-content-empty">등록된 강의 영상이 없습니다.</p>';
  }

  return items.map((item) => buildVideoPlayerHtml(item.url, item.title)).join("");
}

function renderSeriesCourseVideos(weeks) {
  const cards = weeks.map((week, weekIndex) => {
    const weekTitle = String(week?.title || `${weekIndex + 1}주차`).trim();
    const weekDescription = String(week?.description || week?.content || "").trim();
    const items = getWeekVideoItems(week);
    const videoCount = items.length;
    const metaLabel = videoCount > 0 ? `${videoCount}개 영상` : "영상 없음";
    const videosHtml = videoCount
      ? items.map((item) => buildVideoPlayerHtml(item.url, item.title)).join("")
      : '<p class="muted instructor-week-empty">이 주차에 등록된 영상이 없습니다.</p>';

    return `
      <article class="instructor-week-card" data-week-index="${weekIndex}">
        <button
          type="button"
          class="instructor-week-card__toggle"
          aria-expanded="false"
          aria-controls="instructorWeekBody_${weekIndex}"
        >
          <span class="instructor-week-card__num">${weekIndex + 1}</span>
          <span class="instructor-week-card__heading">
            <span class="instructor-week-card__title">${escapeHtml(weekTitle)}</span>
            <span class="instructor-week-card__meta">${escapeHtml(metaLabel)}</span>
          </span>
          <span class="instructor-week-card__icon" aria-hidden="true">▾</span>
        </button>
        <div id="instructorWeekBody_${weekIndex}" class="instructor-week-card__body">
          ${weekDescription ? `<p class="instructor-week-card__desc">${escapeHtml(weekDescription)}</p>` : ""}
          <div class="instructor-week-card__videos">${videosHtml}</div>
        </div>
      </article>
    `;
  }).join("");

  if (!cards.trim()) {
    return '<p class="muted instructor-course-content-empty">등록된 강의 영상이 없습니다.</p>';
  }

  return `<div class="instructor-week-list instructor-week-list--collapsible">${cards}</div>`;
}

function setupWeekToggles(panel) {
  if (!panel) return;

  if (panel.dataset.weekToggleBound !== "1") {
    panel.dataset.weekToggleBound = "1";
    panel.addEventListener("click", (event) => {
      const toggle = event.target.closest(".instructor-week-card__toggle");
      if (!toggle || !panel.contains(toggle)) return;

      const card = toggle.closest(".instructor-week-card");
      if (!card) return;

      const expanded = card.classList.toggle("is-expanded");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  }

  const firstCard = panel.querySelector(".instructor-week-card");
  if (firstCard && !firstCard.classList.contains("is-expanded")) {
    firstCard.classList.add("is-expanded");
    const firstToggle = firstCard.querySelector(".instructor-week-card__toggle");
    if (firstToggle) firstToggle.setAttribute("aria-expanded", "true");
  }
}

function renderCourseContent() {
  const panel = document.getElementById("courseContentPanel");
  if (!panel || !courseData) return;

  const weeks = Array.isArray(courseData.weeks) ? courseData.weeks : [];
  const format = normalizeCourseFormat(courseData.courseFormat, weeks.length);

  if (!weeks.length) {
    panel.innerHTML = '<p class="muted instructor-course-content-empty">등록된 강의 영상이 없습니다.</p>';
    panel.dataset.weekToggleBound = "";
    return;
  }

  panel.innerHTML = format === "series"
    ? renderSeriesCourseVideos(weeks)
    : renderSingleCourseVideos(weeks);

  if (format === "series") {
    setupWeekToggles(panel);
  } else {
    panel.dataset.weekToggleBound = "";
  }
}

function setEnrollmentsSectionVisible(visible) {
  const section = getEnrollmentsSection();
  if (section) section.hidden = !visible;
}

function setupEnrollmentSearch() {
  const searchInput = document.getElementById("courseDetailEnrollmentSearch");
  if (!searchInput || searchInput.dataset.bound === "1") return;
  searchInput.dataset.bound = "1";
  searchInput.addEventListener("input", () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      enrollmentsPage = 1;
      renderEnrollmentsTable();
    }, 250);
  });
}

function getEnrollmentsSection() {
  return document.querySelector(".instructor-enrollments-section");
}

function ensureEnrollmentToolbar() {
  const section = getEnrollmentsSection();
  if (!section || section.querySelector("#courseDetailEnrollmentSearch")) return;

  const heading = section.querySelector("h2");
  const toolbar = document.createElement("div");
  toolbar.className = "instructor-section-toolbar instructor-course-detail-toolbar";
  toolbar.innerHTML = `
    <h2 class="instructor-section-title" style="margin:0;">수강생</h2>
    <input type="search" id="courseDetailEnrollmentSearch" class="instructor-search-input" placeholder="이름, 학교, 학년, 전화번호 검색" aria-label="수강생 검색">
  `;
  if (heading) heading.replaceWith(toolbar);
  else section.insertBefore(toolbar, section.firstChild);

  const searchInput = document.getElementById("courseDetailEnrollmentSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        enrollmentsPage = 1;
        renderEnrollmentsTable();
      }, 250);
    });
  }

  let paginationEl = document.getElementById("courseDetailEnrollmentsPagination");
  if (!paginationEl) {
    paginationEl = document.createElement("div");
    paginationEl.id = "courseDetailEnrollmentsPagination";
    paginationEl.className = "instructor-pagination";
    section.appendChild(paginationEl);
  }
}

function setupEnrollmentsTableHeader() {
  const thead = document.querySelector(".instructor-enrollments-section .progress-table thead");
  if (!thead) return;
  thead.innerHTML = `
    <tr>
      <th>이름</th>
      <th>학교</th>
      <th>학년</th>
      <th>전화번호</th>
      <th>수강신청일</th>
    </tr>
  `;
}

function renderEnrollmentsBody(html) {
  const tbody = document.getElementById("enrollmentsTableBody");
  if (!tbody) return;
  tbody.innerHTML = html;
}

function renderEnrollmentsMessage(message) {
  renderEnrollmentsBody(
    `<tr><td colspan="5" class="instructor-enrollments-message">${escapeHtml(message)}</td></tr>`
  );
  const paginationEl = document.getElementById("courseDetailEnrollmentsPagination");
  if (paginationEl) {
    paginationEl.innerHTML = "";
    paginationEl.onclick = null;
  }
}

function applyEnrollmentSearch() {
  const keyword = document.getElementById("courseDetailEnrollmentSearch")?.value.trim().toLowerCase() || "";
  filteredEnrollments = allEnrollments.filter((row) => {
    if (!keyword) return true;
    const haystack = [row.name, row.school, row.grade, row.phone, row.enrolledAt]
      .map((v) => String(v || "").toLowerCase())
      .join(" ");
    return haystack.includes(keyword);
  });
}

function renderEnrollmentsTable() {
  const tbody = document.getElementById("enrollmentsTableBody");
  if (!tbody) return;

  applyEnrollmentSearch();
  const total = filteredEnrollments.length;

  if (total === 0) {
    renderEnrollmentsMessage(allEnrollments.length ? "검색 조건에 맞는 수강생이 없습니다." : "등록된 수강생이 없습니다.");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (enrollmentsPage > totalPages) enrollmentsPage = totalPages;

  const start = (enrollmentsPage - 1) * PAGE_SIZE;
  const pageRows = filteredEnrollments.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.school)}</td>
      <td>${escapeHtml(row.grade)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td>${escapeHtml(row.enrolledAt)}</td>
    </tr>
  `).join("");

  const paginationEl = document.getElementById("courseDetailEnrollmentsPagination");
  enrollmentsPage = renderListPagination(paginationEl, {
    page: enrollmentsPage,
    totalItems: total,
    dataAttr: "detail-p",
    onPageChange: (nextPage) => {
      enrollmentsPage = nextPage;
      renderEnrollmentsTable();
      paginationEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }) || enrollmentsPage;
}

function renderCourseHeaderBadges() {
  const header = document.getElementById("courseHeader");
  if (!header || !courseData) return;

  let badgeWrap = header.querySelector(".instructor-course-header-badges");
  if (!badgeWrap) {
    badgeWrap = document.createElement("div");
    badgeWrap.className = "instructor-course-header-badges";
    const meta = document.getElementById("courseMeta");
    if (meta?.parentNode) meta.parentNode.insertBefore(badgeWrap, meta);
    else header.appendChild(badgeWrap);
  }

  const accessKey = normalizeAccessType(courseData.accessType);
  const accessClass = accessKey === "memberOnly" ? "member" : "public";
  badgeWrap.innerHTML = `
    <span class="instructor-course-badge instructor-course-badge--${accessClass}">${escapeHtml(getAccessTypeBadgeLabel(accessKey))}</span>
    <span class="instructor-course-badge instructor-course-badge--format">${escapeHtml(getCourseFormatBadgeLabel(courseData.courseFormat))}</span>
  `;
}

function renderPageState(title, message) {
  hideStatsSection();
  const section = getEnrollmentsSection();
  if (section) {
    section.innerHTML = `
      <div class="instructor-course-state">
        <h2 class="instructor-course-state__title">${escapeHtml(title)}</h2>
        <p class="instructor-course-state__message">${escapeHtml(message)}</p>
        <a href="/members/instructors/dashboard.html" class="btn sm">강사 LMS로 돌아가기</a>
      </div>
    `;
    return;
  }

  const main = document.querySelector("main.grit-page-container");
  if (main) {
    main.innerHTML = `
      <div class="instructor-course-state" style="margin:48px auto;max-width:480px;text-align:center;">
        <h2>${escapeHtml(title)}</h2>
        <p class="muted">${escapeHtml(message)}</p>
        <a href="/members/instructors/dashboard.html" class="btn sm">강사 LMS로 돌아가기</a>
      </div>
    `;
  }
}

function markEnrollmentsSection() {
  const table = document.querySelector(".progress-table");
  const section = table?.closest(".grit-section");
  if (section) section.classList.add("instructor-enrollments-section");
}

async function loadInstructorProfile() {
  let currentUser = user;
  if (!currentUser?.uid && auth.currentUser) currentUser = auth.currentUser;
  if (!currentUser?.uid) return;

  try {
    const accountDoc = await getDoc(doc(db, "instructorAccounts", currentUser.uid));
    if (accountDoc.exists()) {
      instructorProfileId = String(accountDoc.data()?.instructorId || "").trim();
      if (instructorProfileId) return;
    }
    const profilesByUid = await getDocs(query(collection(db, "instructors"), where("uid", "==", currentUser.uid)));
    if (!profilesByUid.empty) {
      const profileDoc = profilesByUid.docs[0];
      instructorProfileId = String(profileDoc.data()?.instructorId || profileDoc.id || "").trim();
    }
  } catch (error) {
    console.warn("[instructor-course-detail] instructor profile load failed", error);
  }
}

async function loadCourseData() {
  let currentUser = user;
  if (!currentUser?.uid && auth.currentUser) currentUser = auth.currentUser;
  if (!currentUser?.uid) return "error";

  if (!courseId) {
    renderPageState("강좌를 불러올 수 없습니다", "강좌 ID가 없습니다.");
    return "missing_id";
  }

  try {
    const courseDoc = await getDoc(doc(db, "courses", courseId));
    if (!courseDoc.exists()) {
      renderPageState("강좌를 찾을 수 없습니다", "요청하신 강좌 정보가 없습니다.");
      return "not_found";
    }

    courseData = normalizeCourseForReadOnly({ id: courseDoc.id, ...courseDoc.data() });

    if (!canCurrentInstructorAccessCourse(courseData, currentUser)) {
      courseData = null;
      renderPageState("접근 권한 없음", "이 강좌에 대한 접근 권한이 없습니다.");
      return "denied";
    }

    document.getElementById("courseTitle").textContent = courseData.title || "제목 없는 강좌";
    document.getElementById("courseSubject").textContent = courseData.subjectLabel || courseData.subject || "일반";

    const meta = [
      `상태: ${courseData.statusLabel || courseData.status || "임시저장"}`,
      `학년: ${courseData.gradeLabel || courseData.grade || "-"}`,
      `연도: ${courseData.year || "-"}`
    ];
    document.getElementById("courseMeta").textContent = meta.filter(Boolean).join(" | ");
    renderCourseHeaderBadges();
    renderCourseContent();
    hideStatsSection();
    return "ok";
  } catch (error) {
    handleError(error, "강좌 정보 로드", { showToast: true, logError: true });
    const courseHeader = document.getElementById("courseHeader");
    if (courseHeader) courseHeader.innerHTML = createErrorUI("강좌 정보를 불러오지 못했습니다.");
    return "error";
  }
}

async function loadEnrollments() {
  hideStatsSection();
  setupEnrollmentsTableHeader();
  setupEnrollmentSearch();

  if (!courseData) return;

  if (!isMemberOnlyCourse(courseData)) {
    setEnrollmentsSectionVisible(false);
    return;
  }

  setEnrollmentsSectionVisible(true);

  try {
    allEnrollments = [];
    filteredEnrollments = [];
    enrollmentsPage = 1;

    const enrollmentsSnap = await getDocs(query(
      collection(db, "enrollments"),
      where("courseId", "==", courseId)
    ));

    enrollmentsSnap.docs.forEach((enrollDoc) => {
      const enrollment = enrollDoc.data() || {};
      allEnrollments.push(resolveStudentRow(enrollment));
    });

    allEnrollments.sort((a, b) => {
      const dateCmp = (b.enrolledAt || "").localeCompare(a.enrolledAt || "", "ko");
      if (dateCmp !== 0) return dateCmp;
      return a.name.localeCompare(b.name, "ko");
    });

    filteredEnrollments = [...allEnrollments];
    renderEnrollmentsTable();
  } catch (error) {
    console.error("[instructor-course-detail] enrollments read failed", error);
    handleError(error, "수강생 정보 로드", { showToast: true, logError: true });

    const message = error?.code === "permission-denied"
      ? "수강생 목록을 조회할 권한이 없습니다. 관리자에게 문의해 주세요."
      : "수강생 정보를 불러오는 중 오류가 발생했습니다.";

    renderEnrollmentsBody(
      `<tr><td colspan="5" class="instructor-enrollments-error">${escapeHtml(message)}</td></tr>`
    );
  }
}

(async () => {
  try {
    await roleCheckPromise;
    markEnrollmentsSection();
    hideStatsSection();

    if (!courseId) {
      renderPageState("강좌를 불러올 수 없습니다", "강좌 ID가 없습니다.");
      return;
    }

    await loadInstructorProfile();
    const status = await loadCourseData();
    if (status !== "ok") return;
    setupEnrollmentSearch();
    await loadEnrollments();
  } catch (error) {
    console.error("[instructor-course-detail] init failed", error);
  }
})();
