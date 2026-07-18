import { db } from "/assets/js/firebase-init.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { handleError } from "/assets/js/utils/error-handler.js";
import {
  dom,
  state,
  PAGE_SIZE,
  renderEmptyTable,
  renderListPagination,
  resolveEnrollmentStudentFromSnapshot,
  isMemberOnlyCourse,
  formatLastActivity,
  setDashboardText
} from "/assets/js/pages/instructor-dashboard/context.js";

const GRADE_PRESET = ["중1", "중2", "중3", "고1", "고2", "고3", "졸업"];
const expandedOnlineStudentIds = new Set();

function aggregateStudentsByUser(rows) {
  const byUser = new Map();

  rows.forEach(({ enrollment, course, studentId }) => {
    if (!studentId) return;

    const student = resolveEnrollmentStudentFromSnapshot(enrollment);
    const courseTitle = course.title || "제목 없는 강좌";
    const courseEntry = {
      courseId: course.id,
      courseTitle,
      lastActivity: formatLastActivity(enrollment)
    };

    if (!byUser.has(studentId)) {
      byUser.set(studentId, {
        userId: studentId,
        name: student.name,
        school: student.school,
        grade: student.grade,
        phone: student.phone,
        courses: [courseEntry],
        courseIds: [course.id]
      });
      return;
    }

    const existing = byUser.get(studentId);
    existing.courses.push(courseEntry);
    existing.courseIds.push(course.id);

    if (!existing.school || existing.school === "-") existing.school = student.school;
    if (!existing.grade || existing.grade === "-") existing.grade = student.grade;
    if (!existing.phone || existing.phone === "-") existing.phone = student.phone;
    if (existing.name === "이름 미등록" && student.name !== "이름 미등록") {
      existing.name = student.name;
    }
  });

  return Array.from(byUser.values()).map((row) => {
    const courses = row.courses
      .slice()
      .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle, "ko"));
    return {
      userId: row.userId,
      name: row.name,
      school: row.school,
      grade: row.grade,
      phone: row.phone,
      courses,
      courseIds: [...new Set(row.courseIds)],
      courseCount: courses.length
    };
  });
}

function renderOnlineCourseDetails(row) {
  const items = row.courses
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.courseTitle)}</strong> / 마지막 활동 ${escapeHtml(c.lastActivity)}</li>`
    )
    .join("");
  return `<ul class="instructor-student-detail-list">${items}</ul>`;
}

function populateEnrollmentGradeFilter() {
  if (!dom.enrollmentGradeFilter) return;

  const grades = [...new Set(state.allEnrollments.map((r) => r.grade).filter((g) => g && g !== "-"))];
  const gradeOrder = [
    ...GRADE_PRESET.filter((g) => grades.includes(g)),
    ...grades.filter((g) => !GRADE_PRESET.includes(g))
  ];

  dom.enrollmentGradeFilter.innerHTML =
    '<option value="">전체 학년</option>' +
    gradeOrder.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
}

function applyEnrollmentFilters() {
  state.filteredEnrollments = [...state.allEnrollments];

  const keyword = dom.enrollmentSearch?.value.trim().toLowerCase() || "";
  if (keyword) {
    state.filteredEnrollments = state.filteredEnrollments.filter((row) => {
      const haystack = [
        row.name,
        row.school,
        row.grade,
        row.phone,
        ...row.courses.map((c) => c.courseTitle)
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(keyword);
    });
  }

  const courseFilter = dom.enrollmentCourseFilter?.value || "";
  if (courseFilter) {
    state.filteredEnrollments = state.filteredEnrollments.filter((row) =>
      row.courseIds.includes(courseFilter)
    );
  }

  const gradeFilter = dom.enrollmentGradeFilter?.value || "";
  if (gradeFilter) {
    state.filteredEnrollments = state.filteredEnrollments.filter((row) => row.grade === gradeFilter);
  }

  state.filteredEnrollments.sort((a, b) => {
    const countCmp = b.courseCount - a.courseCount;
    if (countCmp !== 0) return countCmp;
    return a.name.localeCompare(b.name, "ko");
  });
}

function renderEnrollmentsTable() {
  if (!dom.enrollmentTable) return;

  applyEnrollmentFilters();
  const total = state.filteredEnrollments.length;

  if (total === 0) {
    renderEmptyTable(
      dom.enrollmentTable,
      6,
      state.allEnrollments.length ? "조건에 맞는 수강생이 없습니다." : "온라인 수강 데이터가 없습니다."
    );
    if (dom.enrollmentsPagination) {
      dom.enrollmentsPagination.innerHTML = "";
      dom.enrollmentsPagination.onclick = null;
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.enrollmentsPage > totalPages) state.enrollmentsPage = totalPages;

  const start = (state.enrollmentsPage - 1) * PAGE_SIZE;
  const pageRows = state.filteredEnrollments.slice(start, start + PAGE_SIZE);

  dom.enrollmentTable.innerHTML = pageRows
    .map((row) => {
      const isOpen = expandedOnlineStudentIds.has(row.userId);
      const countLabel = row.courseCount === 1 ? "1개" : `${row.courseCount}개`;
      const toggleLabel = isOpen ? "접기" : "펼치기";
      return `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.school)}</td>
      <td>${escapeHtml(row.grade)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td class="instructor-student-count">${escapeHtml(countLabel)}</td>
      <td>
        <button type="button" class="btn sm instructor-student-expand-btn" data-online-student-expand="${escapeHtml(row.userId)}" aria-expanded="${isOpen ? "true" : "false"}">${toggleLabel}</button>
      </td>
    </tr>
    <tr class="instructor-student-detail-row"${isOpen ? "" : " hidden"}>
      <td colspan="6">${renderOnlineCourseDetails(row)}</td>
    </tr>`;
    })
    .join("");

  state.enrollmentsPage = renderListPagination(dom.enrollmentsPagination, {
    page: state.enrollmentsPage,
    totalItems: total,
    dataAttr: "enroll-p",
    onPageChange: (nextPage) => {
      state.enrollmentsPage = nextPage;
      renderEnrollmentsTable();
      dom.enrollmentsPagination?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }) || state.enrollmentsPage;
}

export async function loadEnrollments() {
  if (!dom.enrollmentTable) return;

  try {
    state.allEnrollments = [];
    state.uniqueOnlineStudentCount = 0;
    expandedOnlineStudentIds.clear();

    const memberCourses = state.myCourses.filter(isMemberOnlyCourse);

    if (memberCourses.length === 0) {
      renderEmptyTable(dom.enrollmentTable, 6, "회원전용 온라인 강좌 수강 데이터가 없습니다.");
      if (dom.courseInfoLoading) dom.courseInfoLoading.style.display = "none";
      if (dom.courseInfo) {
        dom.courseInfo.textContent = "회원전용 강좌 수강 기록이 없습니다.";
        dom.courseInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
      }
      setDashboardText(dom.statEnrollments, "0");
      return;
    }

    const rawRows = [];

    for (const course of memberCourses) {
      const enrollmentsSnapshot = await getDocs(
        query(collection(db, "enrollments"), where("courseId", "==", course.id))
      );

      enrollmentsSnapshot.forEach((enrollDoc) => {
        const enrollment = { id: enrollDoc.id, ...enrollDoc.data() };
        const studentId = String(enrollment.userId || "").trim();
        rawRows.push({ enrollment, course, studentId });
      });
    }

    state.allEnrollments = aggregateStudentsByUser(rawRows);
    state.uniqueOnlineStudentCount = state.allEnrollments.length;

    setDashboardText(dom.statEnrollments, String(state.uniqueOnlineStudentCount));

    if (dom.enrollmentCourseFilter) {
      dom.enrollmentCourseFilter.innerHTML = '<option value="">전체 강좌</option>';
      memberCourses.forEach((course) => {
        const option = document.createElement("option");
        option.value = course.id;
        option.textContent = course.title || "제목 없는 강좌";
        dom.enrollmentCourseFilter.appendChild(option);
      });
    }

    populateEnrollmentGradeFilter();

    if (dom.courseInfoLoading) dom.courseInfoLoading.style.display = "none";
    if (dom.courseInfo) {
      const enrollmentCount = rawRows.length;
      dom.courseInfo.textContent = `수강 기록 ${enrollmentCount}건 / 고유 수강생 ${state.uniqueOnlineStudentCount}명`;
      dom.courseInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
    }

    state.enrollmentsPage = 1;
    renderEnrollmentsTable();
  } catch (error) {
    handleError(error, "Load enrollment progress", { showToast: false, logError: true });
    renderEmptyTable(dom.enrollmentTable, 6, "수강 데이터를 불러오지 못했습니다.");
    if (dom.courseInfoLoading) dom.courseInfoLoading.style.display = "none";
    dom.courseInfo?.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
    setDashboardText(dom.statEnrollments, "-");
  }
}

export function setupEnrollmentFilters() {
  const rerender = () => {
    state.enrollmentsPage = 1;
    renderEnrollmentsTable();
  };

  if (dom.enrollmentSearch) {
    dom.enrollmentSearch.addEventListener("input", () => {
      if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
      state.searchDebounceTimer = setTimeout(rerender, 250);
    });
  }

  [dom.enrollmentCourseFilter, dom.enrollmentGradeFilter].forEach((el) => {
    el?.addEventListener("change", rerender);
  });

  document.getElementById("enrollmentTable")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-online-student-expand]");
    if (!btn) return;
    const studentId = btn.getAttribute("data-online-student-expand") || "";
    if (!studentId) return;
    if (expandedOnlineStudentIds.has(studentId)) {
      expandedOnlineStudentIds.delete(studentId);
    } else {
      expandedOnlineStudentIds.add(studentId);
    }
    renderEnrollmentsTable();
  });
}
