import { auth, db } from "/assets/js/firebase-init.js";
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

const SCHEDULE_DAYS = [
  { id: "mon", label: "월" },
  { id: "tue", label: "화" },
  { id: "wed", label: "수" },
  { id: "thu", label: "목" },
  { id: "fri", label: "금" },
  { id: "sat", label: "토" },
  { id: "sun", label: "일" }
];
const DAY_ORDER = SCHEDULE_DAYS.map((d) => d.id);
const GRADE_PRESET = ["중1", "중2", "중3", "고1", "고2", "고3", "졸업"];

function formatTimeDisplay(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function normalizeScheduleItems(classRow) {
  if (Array.isArray(classRow?.scheduleItems) && classRow.scheduleItems.length) {
    return classRow.scheduleItems
      .map((item) => ({
        day: String(item?.day || "").trim(),
        startTime: formatTimeDisplay(item?.startTime),
        endTime: formatTimeDisplay(item?.endTime),
        room: String(item?.room || "").trim()
      }))
      .filter((item) => item.day);
  }
  const days = Array.isArray(classRow?.scheduleDays) ? classRow.scheduleDays : [];
  if (!days.length) return [];
  const start = formatTimeDisplay(classRow?.startTime);
  const end = formatTimeDisplay(classRow?.endTime);
  const room = String(classRow?.room || "").trim();
  return days.map((day) => ({ day, startTime: start, endTime: end, room }));
}

function formatScheduleLine(item) {
  const dayLabel = SCHEDULE_DAYS.find((d) => d.id === item.day)?.label || item.day;
  const timePart =
    item.startTime && item.endTime
      ? `${item.startTime}–${item.endTime}`
      : item.startTime || item.endTime || "";
  const parts = [dayLabel, timePart, item.room].filter(Boolean);
  return parts.join(" ");
}

export function formatScheduleHtml(classRow) {
  const items = normalizeScheduleItems(classRow)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return '<span class="muted">-</span>';
  return items.map((item) => escapeHtml(formatScheduleLine(item))).join("<br>");
}

function formatSchoolGrade(classRow) {
  const school = String(classRow?.school || "").trim();
  const grade = formatInstructorGrade(classRow?.grade);
  const hasGrade = grade && grade !== "-";
  if (school && hasGrade) return `${school} / ${grade}`;
  return school || (hasGrade ? grade : "-");
}

export function isScheduleVisible(classRow) {
  return classRow?.scheduleVisible !== false;
}

function getAssignedInstructorIds(classRow) {
  const ids = [
    classRow?.instructorUid,
    classRow?.instructorId,
    ...(Array.isArray(classRow?.instructorUids) ? classRow.instructorUids : [])
  ];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}

export function isAssignedToCurrentInstructor(classRow, currentUserId) {
  const uid = String(currentUserId || "").trim();
  if (!uid) return false;
  const allowedIds = new Set(getAssignedInstructorIds(classRow));
  return allowedIds.has(uid) || (state.instructorProfileId && allowedIds.has(state.instructorProfileId));
}

function classStatusBadge(status) {
  if (status === "archived") {
    return '<span class="instructor-offline-status instructor-offline-status--archived">보관</span>';
  }
  return '<span class="instructor-offline-status instructor-offline-status--active">운영중</span>';
}

function setOfflineMeta(text) {
  if (dom.offlineClassesMeta) dom.offlineClassesMeta.textContent = text;
  dom.offlineClassesMeta?.classList.remove("dashboard-skeleton", "dashboard-skeleton--text");
}

function offlineClassMatchesFilters(classRow) {
  const keyword = dom.offlineClassSearch?.value.trim().toLowerCase() || "";
  if (keyword) {
    const haystack = [
      classRow.className,
      classRow.subject,
      classRow.school,
      classRow.grade,
      formatSchoolGrade(classRow)
    ]
      .map((v) => String(v || "").toLowerCase())
      .join(" ");
    if (!haystack.includes(keyword)) return false;
  }

  const statusFilter = dom.offlineClassStatusFilter?.value || "";
  if (statusFilter === "active" && classRow.status === "archived") return false;
  if (statusFilter === "archived" && classRow.status !== "archived") return false;

  const subjectFilter = dom.offlineClassSubjectFilter?.value || "";
  if (subjectFilter && String(classRow.subject || "").trim() !== subjectFilter) return false;

  const gradeFilter = dom.offlineClassGradeFilter?.value || "";
  if (gradeFilter && formatInstructorGrade(classRow.grade) !== gradeFilter) return false;

  return true;
}

function applyOfflineClassFilters() {
  state.filteredOfflineClasses = state.myOfflineClasses.filter(offlineClassMatchesFilters);
}

function populateOfflineClassFilterOptions() {
  const subjects = [
    ...new Set(state.myOfflineClasses.map((c) => String(c.subject || "").trim()).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b, "ko"));

  const grades = [
    ...new Set(state.myOfflineClasses.map((c) => formatInstructorGrade(c.grade)).filter((g) => g && g !== "-"))
  ];
  const gradeOrder = [
    ...GRADE_PRESET.filter((g) => grades.includes(g)),
    ...grades.filter((g) => !GRADE_PRESET.includes(g))
  ];

  if (dom.offlineClassSubjectFilter) {
    dom.offlineClassSubjectFilter.innerHTML =
      '<option value="">전체 과목</option>' +
      subjects.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  }

  if (dom.offlineClassGradeFilter) {
    dom.offlineClassGradeFilter.innerHTML =
      '<option value="">전체 학년</option>' +
      gradeOrder.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  }
}

function renderOfflineClassesTable() {
  if (!dom.offlineClassesTable) return;

  applyOfflineClassFilters();
  const total = state.filteredOfflineClasses.length;

  if (!state.myOfflineClasses.length) {
    renderEmptyTable(dom.offlineClassesTable, 6, "담당 오프라인 반이 없습니다.");
    setOfflineMeta("담당 오프라인 반이 없습니다.");
    if (dom.offlineClassesPagination) {
      dom.offlineClassesPagination.innerHTML = "";
      dom.offlineClassesPagination.onclick = null;
    }
    return;
  }

  if (total === 0) {
    renderEmptyTable(dom.offlineClassesTable, 6, "조건에 맞는 오프라인 반이 없습니다.");
    setOfflineMeta(`담당 오프라인 반 ${state.myOfflineClasses.length}개 / 조건에 맞는 반 0개`);
    if (dom.offlineClassesPagination) {
      dom.offlineClassesPagination.innerHTML = "";
      dom.offlineClassesPagination.onclick = null;
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.offlineClassesPage > totalPages) state.offlineClassesPage = totalPages;

  const start = (state.offlineClassesPage - 1) * PAGE_SIZE;
  const pageRows = state.filteredOfflineClasses.slice(start, start + PAGE_SIZE);

  dom.offlineClassesTable.innerHTML = pageRows
    .map((classRow) => {
      const className = escapeHtml(classRow.className || "반명 없음");
      const subject = escapeHtml(classRow.subject || "-");
      const schoolGrade = escapeHtml(formatSchoolGrade(classRow));
      const schedule = isScheduleVisible(classRow)
        ? formatScheduleHtml(classRow)
        : '<span class="muted">표시 안 함</span>';
      const status = classStatusBadge(classRow.status);
      const href = `/members/instructors/offline-class.html?classId=${encodeURIComponent(classRow.id)}`;
      return `
      <tr>
        <td class="instructor-offline-class-name">${className}</td>
        <td>${subject}</td>
        <td>${schoolGrade}</td>
        <td class="instructor-offline-schedule-cell">${schedule}</td>
        <td>${status}</td>
        <td class="instructor-table-actions">
          <a class="btn primary sm" href="${href}">반 보기</a>
        </td>
      </tr>`;
    })
    .join("");

  setOfflineMeta(
    total === state.myOfflineClasses.length
      ? `담당 오프라인 반 ${total}개`
      : `담당 오프라인 반 ${state.myOfflineClasses.length}개 / 조건에 맞는 반 ${total}개`
  );

  state.offlineClassesPage = renderListPagination(dom.offlineClassesPagination, {
    page: state.offlineClassesPage,
    totalItems: total,
    dataAttr: "offline-class-p",
    onPageChange: (nextPage) => {
      state.offlineClassesPage = nextPage;
      renderOfflineClassesTable();
      dom.offlineClassesPagination?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }) || state.offlineClassesPage;
}

export function setupOfflineClassFilters() {
  const rerender = () => {
    state.offlineClassesPage = 1;
    renderOfflineClassesTable();
  };

  [dom.offlineClassStatusFilter, dom.offlineClassSubjectFilter, dom.offlineClassGradeFilter].forEach(
    (el) => {
      el?.addEventListener("change", rerender);
    }
  );

  if (!dom.offlineClassSearch) return;
  dom.offlineClassSearch.addEventListener("input", () => {
    if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(rerender, 250);
  });
}

export async function loadMyOfflineClasses() {
  if (!dom.offlineClassesTable) return;

  try {
    renderEmptyTable(dom.offlineClassesTable, 6, "오프라인 반을 불러오는 중입니다...");
    setOfflineMeta("오프라인 반을 불러오는 중입니다...");

    const currentUserId = state.user?.uid || auth.currentUser?.uid;
    if (!currentUserId) {
      renderEmptyTable(dom.offlineClassesTable, 6, "현재 로그인 정보를 확인할 수 없습니다.");
      setOfflineMeta("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    let snapshots;
    const classQueries = [
      query(collection(db, "offlineClasses"), where("instructorUid", "==", currentUserId)),
      query(collection(db, "offlineClasses"), where("instructorId", "==", currentUserId))
    ];
    if (state.instructorProfileId) {
      classQueries.push(
        query(collection(db, "offlineClasses"), where("instructorUid", "==", state.instructorProfileId)),
        query(collection(db, "offlineClasses"), where("instructorId", "==", state.instructorProfileId))
      );
    }

    try {
      snapshots = await Promise.all(classQueries.map((q) => getDocs(q)));
    } catch (queryError) {
      if (queryError.code === "failed-precondition" || queryError.code === "unimplemented") {
        console.warn("[instructor-dashboard] assigned offline class query requires index/configuration", queryError);
        renderEmptyTable(dom.offlineClassesTable, 6, "담당 오프라인 반 조회 설정을 확인해야 합니다. 관리자에게 문의해 주세요.");
        setOfflineMeta("오프라인 반 조회 설정 확인 필요");
        setDashboardText(dom.statOfflineClasses, "-");
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

    state.myOfflineClasses = Array.from(rowsById.values())
      .filter((classRow) => isAssignedToCurrentInstructor(classRow, currentUserId))
      .sort((a, b) =>
        String(a.className || "").localeCompare(String(b.className || ""), "ko")
      );

    state.filteredOfflineClasses = [...state.myOfflineClasses];
    populateOfflineClassFilterOptions();
    state.offlineClassesPage = 1;
    renderOfflineClassesTable();
    setDashboardText(dom.statOfflineClasses, String(state.myOfflineClasses.length));
  } catch (error) {
    handleError(error, "Load instructor offline classes", { showToast: false, logError: true });
    renderEmptyTable(dom.offlineClassesTable, 6, "오프라인 반 목록을 불러오지 못했습니다.");
    setOfflineMeta("오프라인 반 목록을 불러오지 못했습니다.");
    state.myOfflineClasses = [];
    state.filteredOfflineClasses = [];
    setDashboardText(dom.statOfflineClasses, "-");
  }
}
