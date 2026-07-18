import { auth, db } from "/assets/js/firebase-init.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { handleError } from "/assets/js/utils/error-handler.js";
import {
  normalizeCourseForReadOnly,
  normalizeAccessType,
  normalizeCourseFormat,
  getAccessTypeBadgeLabel,
  getCourseFormatBadgeLabel
} from "/assets/js/utils/course-readonly.js";
import {
  dom,
  state,
  PAGE_SIZE,
  renderEmptyTable,
  renderListPagination,
  formatInstructorGrade,
  setDashboardText
} from "/assets/js/pages/instructor-dashboard/context.js";

const GRADE_PRESET = ["중1", "중2", "중3", "고1", "고2", "고3", "졸업"];

function getAssignedInstructorIds(course) {
  const ids = [
    course?.instructorUid,
    course?.instructorId,
    ...(Array.isArray(course?.instructorUids) ? course.instructorUids : [])
  ];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

function isAssignedToCurrentInstructor(course, currentUserId) {
  const uid = String(currentUserId || "").trim();
  if (!uid) return false;
  const allowedIds = new Set(getAssignedInstructorIds(course));
  return allowedIds.has(uid) || (state.instructorProfileId && allowedIds.has(state.instructorProfileId));
}

function populateCourseFilterOptions() {
  const years = [...new Set(state.myCourses.map((c) => String(c.year || "").trim()).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, "ko"));

  const grades = [...new Set(state.myCourses.map((c) => formatInstructorGrade(c.gradeLabel || c.grade)).filter((g) => g && g !== "-"))];
  const gradeOrder = [...GRADE_PRESET.filter((g) => grades.includes(g)), ...grades.filter((g) => !GRADE_PRESET.includes(g))];

  if (dom.courseYearFilter) {
    dom.courseYearFilter.innerHTML = '<option value="">전체 연도</option>' +
      years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
  }

  if (dom.courseGradeFilter) {
    dom.courseGradeFilter.innerHTML = '<option value="">전체 학년</option>' +
      gradeOrder.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  }
}

function courseMatchesFilters(course) {
  const keyword = dom.courseSearch?.value.trim().toLowerCase() || "";
  if (keyword) {
    const haystack = [
      course.title,
      course.year,
      formatInstructorGrade(course.gradeLabel || course.grade),
      getAccessTypeBadgeLabel(course.accessType),
      getCourseFormatBadgeLabel(course.courseFormat)
    ].map((v) => String(v || "").toLowerCase()).join(" ");
    if (!haystack.includes(keyword)) return false;
  }

  const yearFilter = dom.courseYearFilter?.value || "";
  if (yearFilter && String(course.year || "").trim() !== yearFilter) return false;

  const gradeFilter = dom.courseGradeFilter?.value || "";
  if (gradeFilter) {
    const grade = formatInstructorGrade(course.gradeLabel || course.grade);
    if (grade !== gradeFilter) return false;
  }

  const accessFilter = dom.courseAccessFilter?.value || "";
  if (accessFilter && normalizeAccessType(course.accessType) !== accessFilter) return false;

  const formatFilter = dom.courseFormatFilter?.value || "";
  if (formatFilter && normalizeCourseFormat(course.courseFormat) !== formatFilter) return false;

  return true;
}

function applyCourseFilter(resetPage = false) {
  state.filteredCourses = state.myCourses.filter(courseMatchesFilters);
  if (resetPage) state.coursesPage = 1;
}

function renderCoursesTable() {
  if (!dom.coursesTable) return;

  applyCourseFilter();
  const total = state.filteredCourses.length;

  if (total === 0) {
    renderEmptyTable(dom.coursesTable, 6, state.myCourses.length ? "조건에 맞는 강좌가 없습니다." : "담당 온라인 강좌가 없습니다.");
    if (dom.coursesPagination) {
      dom.coursesPagination.innerHTML = "";
      dom.coursesPagination.onclick = null;
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.coursesPage > totalPages) state.coursesPage = totalPages;

  const start = (state.coursesPage - 1) * PAGE_SIZE;
  const pageRows = state.filteredCourses.slice(start, start + PAGE_SIZE);

  dom.coursesTable.innerHTML = pageRows.map((course) => {
    const accessKey = normalizeAccessType(course.accessType);
    const accessLabel = escapeHtml(getAccessTypeBadgeLabel(accessKey));
    const formatLabel = escapeHtml(getCourseFormatBadgeLabel(course.courseFormat));
    const title = escapeHtml(course.title || "제목 없는 강좌");
    const year = escapeHtml(course.year || "-");
    const grade = escapeHtml(formatInstructorGrade(course.gradeLabel || course.grade));
    const courseId = escapeHtml(course.id);

    return `
      <tr>
        <td class="instructor-table-title">${title}</td>
        <td>${year}</td>
        <td>${grade}</td>
        <td><span class="instructor-course-badge instructor-course-badge--${accessKey === "memberOnly" ? "member" : "public"}">${accessLabel}</span></td>
        <td><span class="instructor-course-badge instructor-course-badge--format">${formatLabel}</span></td>
        <td class="instructor-table-actions">
          <button type="button" class="btn primary sm" onclick="viewCourseDetail('${courseId}')">강좌 보기</button>
        </td>
      </tr>
    `;
  }).join("");

  state.coursesPage = renderListPagination(dom.coursesPagination, {
    page: state.coursesPage,
    totalItems: total,
    dataAttr: "courses-p",
    onPageChange: (nextPage) => {
      state.coursesPage = nextPage;
      renderCoursesTable();
      dom.coursesPagination?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }) || state.coursesPage;
}

function bindCourseFilterEvents() {
  const rerender = () => {
    state.coursesPage = 1;
    renderCoursesTable();
  };

  [dom.courseYearFilter, dom.courseGradeFilter, dom.courseAccessFilter, dom.courseFormatFilter].forEach((el) => {
    el?.addEventListener("change", rerender);
  });
}

export function setupCourseFilters() {
  bindCourseFilterEvents();

  if (!dom.courseSearch) return;
  dom.courseSearch.addEventListener("input", () => {
    if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => {
      applyCourseFilter(true);
      renderCoursesTable();
    }, 250);
  });
}

export async function loadMyCourses() {
  if (!dom.coursesTable) return;

  try {
    renderEmptyTable(dom.coursesTable, 6, "강좌를 불러오는 중입니다...");
    const currentUserId = state.user?.uid || auth.currentUser?.uid;
    if (!currentUserId) {
      renderEmptyTable(dom.coursesTable, 6, "현재 로그인 정보를 확인할 수 없습니다.");
      return;
    }

    let snapshots;
    let needsClientFiltering = false;
    try {
      const courseQueries = [
        query(collection(db, "courses"), where("instructorUid", "==", currentUserId)),
        query(collection(db, "courses"), where("instructorUids", "array-contains", currentUserId))
      ];
      if (state.instructorProfileId) {
        courseQueries.push(
          query(collection(db, "courses"), where("instructorUid", "==", state.instructorProfileId)),
          query(collection(db, "courses"), where("instructorUids", "array-contains", state.instructorProfileId)),
          query(collection(db, "courses"), where("instructorId", "==", state.instructorProfileId))
        );
      }
      snapshots = await Promise.all(courseQueries.map((courseQuery) => getDocs(courseQuery)));
    } catch (queryError) {
      if (queryError.code === "failed-precondition" || queryError.code === "unimplemented") {
        console.warn("[instructor-dashboard] assigned course query requires index/configuration", queryError);
        renderEmptyTable(dom.coursesTable, 6, "담당 강좌 조회 설정을 확인해야 합니다. 관리자에게 문의해 주세요.");
        setDashboardText(dom.statCourses, "-");
        return;
      } else {
        throw queryError;
      }
    }

    const rowsById = new Map();
    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((docSnap) => {
        rowsById.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
      });
    });
    let rows = Array.from(rowsById.values());
    if (needsClientFiltering) {
      rows = rows.filter((course) => isAssignedToCurrentInstructor(course, currentUserId));
    }

    state.myCourses = rows
      .map((course) => normalizeCourseForReadOnly(course, {
        labelMaps: state.labelMaps,
        hiddenCourseIds: state.hiddenCourseIds,
        instructorsByUid: state.instructorsByUid
      }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    populateCourseFilterOptions();

    setDashboardText(dom.statCourses, String(state.myCourses.length));
    state.filteredCourses = [...state.myCourses];
    state.coursesPage = 1;
    renderCoursesTable();
  } catch (error) {
    handleError(error, "Load instructor courses", { showToast: false, logError: true });
    renderEmptyTable(dom.coursesTable, 6, "강좌 목록을 불러오지 못했습니다.");
    setDashboardText(dom.statCourses, "-");
  }
}
