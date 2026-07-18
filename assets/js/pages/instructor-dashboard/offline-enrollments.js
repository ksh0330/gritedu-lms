import { db } from "/assets/js/firebase-init.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { handleError } from "/assets/js/utils/error-handler.js";
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
const expandedOfflineStudentIds = new Set();

function memberDisplayFields(member) {
  return {
    name:
      String(member.studentNameSnapshot || member.name || member.studentName || "").trim() ||
      "이름 미등록",
    school: String(member.schoolSnapshot || member.school || "").trim() || "-",
    grade: formatInstructorGrade(member.gradeSnapshot || member.grade),
    phone: String(member.phoneSnapshot || member.phone || "").trim() || "-"
  };
}

function isVisibleMember(member) {
  return String(member?.status || "active").trim() !== "removed";
}

function formatJoinedAtLabel(joinedAt) {
  if (joinedAt == null || joinedAt === "") return "-";
  try {
    if (typeof joinedAt?.toDate === "function") {
      return joinedAt.toDate().toLocaleDateString("ko-KR");
    }
    const raw = String(joinedAt).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
        "ko-KR"
      );
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleDateString("ko-KR");
  } catch {
    /* ignore */
  }
  return "-";
}

function aggregateOfflineStudentsByUid(membershipRows) {
  const byStudent = new Map();

  membershipRows.forEach(({ member, classRow }) => {
    const studentUid = String(member.studentUid || "").trim();
    if (!studentUid) return;

    const fields = memberDisplayFields(member);
    const classEntry = {
      classId: classRow.id,
      className: String(classRow.className || "반명 없음").trim(),
      joinedAtLabel: formatJoinedAtLabel(member.joinedAt)
    };

    if (!byStudent.has(studentUid)) {
      byStudent.set(studentUid, {
        studentUid,
        name: fields.name,
        school: fields.school,
        grade: fields.grade,
        phone: fields.phone,
        classes: [classEntry],
        classIds: [classRow.id]
      });
      return;
    }

    const existing = byStudent.get(studentUid);
    existing.classes.push(classEntry);
    existing.classIds.push(classRow.id);

    if (!existing.school || existing.school === "-") existing.school = fields.school;
    if (!existing.grade || existing.grade === "-") existing.grade = fields.grade;
    if (!existing.phone || existing.phone === "-") existing.phone = fields.phone;
    if (existing.name === "이름 미등록" && fields.name !== "이름 미등록") {
      existing.name = fields.name;
    }
  });

  return Array.from(byStudent.values()).map((row) => {
    const classes = row.classes
      .slice()
      .sort((a, b) => a.className.localeCompare(b.className, "ko"));
    return {
      studentUid: row.studentUid,
      name: row.name,
      school: row.school,
      grade: row.grade,
      phone: row.phone,
      classes,
      classIds: [...new Set(row.classIds)],
      classCount: classes.length
    };
  });
}

function renderOfflineClassDetails(row) {
  const items = row.classes
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.className)}</strong> / 입반일 ${escapeHtml(c.joinedAtLabel)}</li>`
    )
    .join("");
  return `<ul class="instructor-student-detail-list">${items}</ul>`;
}

function populateOfflineEnrollmentFilters() {
  if (dom.offlineEnrollmentClassFilter) {
    dom.offlineEnrollmentClassFilter.innerHTML = '<option value="">전체 반</option>';
    state.myOfflineClasses.forEach((classRow) => {
      const option = document.createElement("option");
      option.value = classRow.id;
      option.textContent = classRow.className || "반명 없음";
      dom.offlineEnrollmentClassFilter.appendChild(option);
    });
  }

  if (!dom.offlineEnrollmentGradeFilter) return;
  const grades = [
    ...new Set(state.allOfflineEnrollments.map((r) => r.grade).filter((g) => g && g !== "-"))
  ];
  const gradeOrder = [
    ...GRADE_PRESET.filter((g) => grades.includes(g)),
    ...grades.filter((g) => !GRADE_PRESET.includes(g))
  ];
  dom.offlineEnrollmentGradeFilter.innerHTML =
    '<option value="">전체 학년</option>' +
    gradeOrder.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
}

function applyOfflineEnrollmentFilters() {
  state.filteredOfflineEnrollments = [...state.allOfflineEnrollments];

  const keyword = dom.offlineEnrollmentSearch?.value.trim().toLowerCase() || "";
  if (keyword) {
    state.filteredOfflineEnrollments = state.filteredOfflineEnrollments.filter((row) => {
      const haystack = [
        row.name,
        row.school,
        row.grade,
        row.phone,
        ...row.classes.map((c) => c.className)
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(keyword);
    });
  }

  const classFilter = dom.offlineEnrollmentClassFilter?.value || "";
  if (classFilter) {
    state.filteredOfflineEnrollments = state.filteredOfflineEnrollments.filter((row) =>
      row.classIds.includes(classFilter)
    );
  }

  const gradeFilter = dom.offlineEnrollmentGradeFilter?.value || "";
  if (gradeFilter) {
    state.filteredOfflineEnrollments = state.filteredOfflineEnrollments.filter(
      (row) => row.grade === gradeFilter
    );
  }

  state.filteredOfflineEnrollments.sort((a, b) => {
    const countCmp = b.classCount - a.classCount;
    if (countCmp !== 0) return countCmp;
    return a.name.localeCompare(b.name, "ko");
  });
}

function renderOfflineEnrollmentsTable() {
  if (!dom.offlineEnrollmentTable) return;

  applyOfflineEnrollmentFilters();
  const total = state.filteredOfflineEnrollments.length;

  if (!state.allOfflineEnrollments.length) {
    renderEmptyTable(
      dom.offlineEnrollmentTable,
      6,
      state.myOfflineClasses.length ? "오프라인 반 학생이 없습니다." : "담당 오프라인 반이 없습니다."
    );
    if (dom.offlineEnrollmentsPagination) {
      dom.offlineEnrollmentsPagination.innerHTML = "";
      dom.offlineEnrollmentsPagination.onclick = null;
    }
    return;
  }

  if (total === 0) {
    renderEmptyTable(dom.offlineEnrollmentTable, 6, "조건에 맞는 학생이 없습니다.");
    if (dom.offlineEnrollmentsPagination) {
      dom.offlineEnrollmentsPagination.innerHTML = "";
      dom.offlineEnrollmentsPagination.onclick = null;
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.offlineEnrollmentsPage > totalPages) state.offlineEnrollmentsPage = totalPages;

  const start = (state.offlineEnrollmentsPage - 1) * PAGE_SIZE;
  const pageRows = state.filteredOfflineEnrollments.slice(start, start + PAGE_SIZE);

  dom.offlineEnrollmentTable.innerHTML = pageRows
    .map((row) => {
      const isOpen = expandedOfflineStudentIds.has(row.studentUid);
      const countLabel = row.classCount === 1 ? "1개" : `${row.classCount}개`;
      const toggleLabel = isOpen ? "접기" : "펼치기";
      return `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.school)}</td>
      <td>${escapeHtml(row.grade)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td class="instructor-student-count">${escapeHtml(countLabel)}</td>
      <td>
        <button type="button" class="btn sm instructor-student-expand-btn" data-offline-student-expand="${escapeHtml(row.studentUid)}" aria-expanded="${isOpen ? "true" : "false"}">${toggleLabel}</button>
      </td>
    </tr>
    <tr class="instructor-student-detail-row"${isOpen ? "" : " hidden"}>
      <td colspan="6">${renderOfflineClassDetails(row)}</td>
    </tr>`;
    })
    .join("");

  state.offlineEnrollmentsPage = renderListPagination(dom.offlineEnrollmentsPagination, {
    page: state.offlineEnrollmentsPage,
    totalItems: total,
    dataAttr: "offline-enroll-p",
    onPageChange: (nextPage) => {
      state.offlineEnrollmentsPage = nextPage;
      renderOfflineEnrollmentsTable();
      dom.offlineEnrollmentsPagination?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }) || state.offlineEnrollmentsPage;
}

export async function loadOfflineEnrollments() {
  if (!dom.offlineEnrollmentTable) return;

  try {
    renderEmptyTable(dom.offlineEnrollmentTable, 6, "오프라인 수강생을 불러오는 중입니다...");
    expandedOfflineStudentIds.clear();

    if (!state.myOfflineClasses.length) {
      state.allOfflineEnrollments = [];
      state.filteredOfflineEnrollments = [];
      renderOfflineEnrollmentsTable();
      if (dom.offlineEnrollmentInfo) {
        dom.offlineEnrollmentInfo.textContent = "담당 오프라인 반이 없습니다.";
        dom.offlineEnrollmentInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
      }
      setDashboardText(dom.statOfflineStudents, "0");
      return;
    }

    const membershipRows = [];
    let membershipCount = 0;

    for (const classRow of state.myOfflineClasses) {
      const membersSnap = await getDocs(
        query(collection(db, "offlineClassMembers"), where("classId", "==", classRow.id))
      );
      membersSnap.docs.forEach((memberDoc) => {
        const member = { id: memberDoc.id, ...memberDoc.data() };
        if (!isVisibleMember(member)) return;
        membershipCount += 1;
        membershipRows.push({ member, classRow });
      });
    }

    const students = aggregateOfflineStudentsByUid(membershipRows);
    state.allOfflineEnrollments = students;
    state.filteredOfflineEnrollments = [...students];
    populateOfflineEnrollmentFilters();

    if (dom.offlineEnrollmentInfo) {
      dom.offlineEnrollmentInfo.textContent = `배정 기록 ${membershipCount}건 / 고유 수강생 ${students.length}명`;
      dom.offlineEnrollmentInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
    }

    state.offlineEnrollmentsPage = 1;
    renderOfflineEnrollmentsTable();
    setDashboardText(dom.statOfflineStudents, String(students.length));
  } catch (error) {
    handleError(error, "Load offline enrollments", { showToast: false, logError: true });
    renderEmptyTable(dom.offlineEnrollmentTable, 6, "오프라인 수강생을 불러오지 못했습니다.");
    if (dom.offlineEnrollmentInfo) {
      dom.offlineEnrollmentInfo.textContent = "오프라인 수강생을 불러오지 못했습니다.";
      dom.offlineEnrollmentInfo.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
    }
    setDashboardText(dom.statOfflineStudents, "-");
  }
}

export function setupOfflineEnrollmentFilters() {
  const rerender = () => {
    state.offlineEnrollmentsPage = 1;
    renderOfflineEnrollmentsTable();
  };

  [dom.offlineEnrollmentClassFilter, dom.offlineEnrollmentGradeFilter].forEach((el) => {
    el?.addEventListener("change", rerender);
  });

  if (dom.offlineEnrollmentSearch) {
    dom.offlineEnrollmentSearch.addEventListener("input", () => {
      if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
      state.searchDebounceTimer = setTimeout(rerender, 250);
    });
  }

  document.getElementById("offlineEnrollmentTable")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-offline-student-expand]");
    if (!btn) return;
    const studentUid = btn.getAttribute("data-offline-student-expand") || "";
    if (!studentUid) return;
    if (expandedOfflineStudentIds.has(studentUid)) {
      expandedOfflineStudentIds.delete(studentUid);
    } else {
      expandedOfflineStudentIds.add(studentUid);
    }
    renderOfflineEnrollmentsTable();
  });
}
