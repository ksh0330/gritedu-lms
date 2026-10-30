// /assets/js/pages/admin-courses.js
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  writeBatch,
  query,
  orderBy,
  where,
  serverTimestamp,
  runTransaction,
  limit,
  startAfter,
  documentId
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { adminXlsxFilename, writeAdminXlsx } from "/assets/js/utils/admin-xlsx.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";
import { accountUidByInstructorId } from "/assets/js/utils/instructor-privacy.js";
import { handleError, createErrorUI } from "/assets/js/utils/error-handler.js";
import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
import { normalizeVideoUrl } from "/assets/js/utils/video-url.js";
import { getCurrentCourseCompletion } from "/assets/js/utils/course-completion.js";
import { filterApprovalRequests, toApprovalPublicCourse } from "/assets/js/utils/approval-course.js";
import {
  MANUAL_ENROLLMENT_SEARCH_LIMIT,
  classifyEnrollmentSearch,
  toEnrollmentCandidates,
  getSelectedEnrollmentCandidate
} from "/assets/js/utils/approval-enrollment-search.js";
import {
  bindCommittedSearch,
  normalizeListPageSize,
  renderListPagination,
} from "/assets/js/utils/list-controls.js";
import {
  mergeCourseCatalog,
  buildLabelMaps,
  getCourseGradeLabels,
  getCourseYearLabels,
  getCourseSubjectOptions,
  applyCourseCatalogDraft,
  getCourseCatalogSubjectDraft,
  getCourseCatalogGradeDraft,
  getCourseCatalogYearDraft,
  generateNextCustomSubjectCode
} from "/assets/js/utils/course-catalog.js";
import {
  applyCourseSubjectSelectValue,
  resolveCourseSubjectFromControls,
  syncCourseSubjectCustomField,
  buildCourseSubjectSelectHtml,
  withStringListFallback,
  addUniqueCatalogItem,
  isReservedCatalogValue,
  moveCatalogItem,
  removeCatalogItem,
  renameCatalogItem,
  renderStringCatalogTagsHtml
} from "/assets/js/utils/catalog-select-helpers.js";
import {
  normalizeCourseForReadOnly,
  normalizeCurriculumWeeks,
  buildCanonicalCoursePayload,
  normalizeAccessType,
  normalizeCourseFormat,
  getCourseFormatBadgeLabel,
  getSubjectLabel,
  getGradeLabel
} from "/assets/js/utils/course-readonly.js";
import {
  SUBJECT_COLOR_SETTINGS_KEY,
  areSubjectColorMapsEqual,
  buildSubjectColorSettingsPayload,
  ensureSubjectColorMap,
  getSubjectColorMapFromSettings,
  getSubjectColorStyle,
  loadSharedSubjectColorMap,
  mergeSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (_) {
  }
})();

const $ = (s, r = document) => r.querySelector(s);
const tbody = $("#tblContents tbody");
const searchEl = $("#adminContentSearch");
const gradeFilterEl = $("#adminFilterGrade");
const subjectFilterEl = $("#adminFilterSubject");
const statusFilterEl = $("#adminFilterStatus");
const courseFormatFilterEl = $("#adminFilterCourseFormat");
const accessTypeFilterEl = $("#adminFilterAccessType");
const instructorFilterEl = $("#adminFilterInstructor");
const pageEl = $("#adminPagination");
const metaEl = $("#adminCoursesMeta");
const advancedFiltersEl = $("#adminAdvancedFilters");
const advancedFilterToggleEl = $("#adminAdvancedFilterToggle");
const filterResetEl = $("#adminFilterReset");

const filters = {
  search: "",
  grade: "all",
  subject: "all",
  status: "all",
  courseFormat: "all",
  accessType: "all",
  instructor: "all"
};
const PREVIEW_EXCERPT_MAX = 120;
const legacyRemove = {
  thumbnail: deleteField(),
  coverImage: deleteField(),
  image: deleteField(),
  body: deleteField(),
  instructor: deleteField(),
  videoUrl: deleteField(),
  lectureContent: deleteField(),
  learningContent: deleteField(),
  kind: deleteField(),
  month: deleteField(),
  schoolYear: deleteField(),
  classId: deleteField(),
  classIds: deleteField(),
  classes: deleteField(),
  examType: deleteField(),
  qFrom: deleteField(),
  qTo: deleteField(),
  examContents: deleteField(),
  exam_contents: deleteField()
};

let labelMaps = buildLabelMaps(mergeCourseCatalog({}));
let mergedCourseCatalog = mergeCourseCatalog({});
let instructors = new Map();
let rows = [];
let viewRows = [];
let coursesLoaded = false;
function setCourseExportReady() {
  const button = $("#dlCourses");
  if (!button) return;
  button.disabled = !coursesLoaded || !viewRows.length;
  button.title = !coursesLoaded
    ? "강좌 목록을 불러온 뒤 다운로드할 수 있습니다"
    : (viewRows.length ? "현재 필터 결과 전체를 엑셀로 다운로드" : "다운로드할 강좌가 없습니다");
}
let page = 1;
let weeksState = [];
let activeEnrollmentCourseId = "";
let approvalRequestRows = [];
let approvalRequestCursor = null;
let approvalRequestHasMore = false;
let approvalRequestSearch = "";
let approvalListInProgress = false;
let approvalActionInProgress = false;
let manualEnrollmentSearch = { status: "idle", results: [], selectedKey: "", message: "", truncated: false };
let manualEnrollmentSearchRequestId = 0;
let manualEnrollmentSearchTerm = "";
let activeEnrollmentRows = [];
let adminCoursePreviewRequestId = 0;
let deleteBlockedState = {
  courseId: "",
  course: null,
  enrollments: [],
  inventory: null
};
let noEnrollmentDeleteState = {
  courseId: "",
  course: null,
  inventory: null
};
let enrollmentRemovalState = {
  courseId: "",
  enrollment: null
};

let pageSize = 10;
const GRADE_PRESET_FALLBACK = ["중1", "중2", "중3", "고1", "고2", "고3"];
let catalogGrades = GRADE_PRESET_FALLBACK.slice();
let catalogYears = [];
let catalogCourseSubjects = [];
/** @type {Array<{ value: string, label: string }>} */
let courseSubjectDraft = [];
/** @type {string[]} */
let courseGradeDraft = [];
/** @type {string[]} */
let courseYearDraft = [];
let subjectColorMap = mergeSubjectColorMap({});
let courseSubjectColorSourceMap = mergeSubjectColorMap({});
let persistedCourseSubjectColorMap = {};

function syncCourseSubjectDraftFromDom() {
  const editor = $("#courseCatalogSubjectEditor");
  if (!editor) return courseSubjectDraft;
  return courseSubjectDraft.map((item) => {
    const input = editor.querySelector(`[data-subject-code="${CSS.escape(item.value)}"]`);
    const label = input ? String(input.value || "").trim() : item.label;
    return { value: item.value, label: label || item.label };
  });
}

function renderCourseCatalogPanel() {
  subjectColorMap = ensureSubjectColorMap(
    courseSubjectDraft.map((item) => item.label),
    subjectColorMap
  );
  const editor = $("#courseCatalogSubjectEditor");
  if (editor) {
    editor.innerHTML = courseSubjectDraft
      .map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === courseSubjectDraft.length - 1;
        const colorStyle = getSubjectColorStyle(item.label, subjectColorMap);
        return `
      <div class="admin-catalog-tag course-catalog-subject-row${colorStyle ? " has-subject-color" : ""}"${colorStyle ? ` style="${colorStyle}"` : ""}>
        <div class="admin-catalog-tag__moves">
          <button type="button" class="admin-catalog-tag__move" data-subject-move="up" data-subject-code="${escapeHtml(item.value)}"${isFirst ? " disabled" : ""} aria-label="위로" title="위로">↑</button>
          <button type="button" class="admin-catalog-tag__move" data-subject-move="down" data-subject-code="${escapeHtml(item.value)}"${isLast ? " disabled" : ""} aria-label="아래로" title="아래로">↓</button>
        </div>
        <input type="text" class="admin-catalog-tag__input course-catalog-subject-row__label" value="${escapeHtml(item.label)}" data-subject-code="${escapeHtml(item.value)}" aria-label="${escapeHtml(item.label)} 과목명">
        <button type="button" class="admin-catalog-tag__remove course-catalog-subject-row__remove" data-subject-remove="${escapeHtml(item.value)}" aria-label="${escapeHtml(item.label)} 삭제">&times;</button>
      </div>`;
      })
      .join("");
  }
  const gradeHost = $("#courseCatalogGradeTags");
  if (gradeHost) {
    gradeHost.innerHTML = renderStringCatalogTagsHtml(courseGradeDraft, "grades", escapeHtml);
  }
  const yearHost = $("#courseCatalogYearTags");
  if (yearHost) {
    yearHost.innerHTML = renderStringCatalogTagsHtml(courseYearDraft, "years", escapeHtml);
  }
  refreshCourseCatalogSelects();
}

function getEffectiveCourseCatalogFromDraft() {
  const subjects = courseSubjectDraft.length
    ? courseSubjectDraft.map((item) => ({ ...item }))
    : getCourseCatalogSubjectDraft(mergedCourseCatalog);
  const gradeOptions = (courseGradeDraft.length
    ? courseGradeDraft
    : getCourseCatalogGradeDraft(mergedCourseCatalog).map((item) => item.label)
  ).map((label) => ({ value: label, label }));
  const yearOptions = (courseYearDraft.length
    ? courseYearDraft
    : getCourseCatalogYearDraft(mergedCourseCatalog).map((item) => item.label)
  ).map((label) => ({ value: label, label }));
  return applyCourseCatalogDraft(mergedCourseCatalog, subjects, gradeOptions, yearOptions);
}

function syncCourseCatalogArraysFromDraft() {
  const catalog = getEffectiveCourseCatalogFromDraft();
  catalogGrades = getCourseGradeLabels(catalog);
  catalogCourseSubjects = getCourseSubjectOptions(catalog);
  catalogYears = getCourseYearLabels(catalog);
  return catalog;
}

function addCourseSubjectToDraft(rawLabel) {
  const label = String(rawLabel || "").trim();
  if (!label) return { ok: false, message: "과목명을 입력해주세요." };
  if (isReservedCatalogValue(label)) {
    return { ok: false, message: "해당 값은 저장할 수 없습니다." };
  }
  if (courseSubjectDraft.some((item) => item.label === label)) {
    return { ok: false, message: "이미 등록된 과목명입니다." };
  }
  const value = generateNextCustomSubjectCode(courseSubjectDraft.map((item) => item.value));
  if (isReservedCatalogValue(value)) {
    return { ok: false, message: "해당 값은 저장할 수 없습니다." };
  }
  return { ok: true, list: [...courseSubjectDraft, { value, label }] };
}

function moveCourseSubjectInDraft(code, direction) {
  const list = syncCourseSubjectDraftFromDom();
  const index = list.findIndex((item) => item.value === code);
  if (index < 0) return { ok: false, message: "항목을 찾을 수 없습니다." };
  const offset = direction === "up" ? -1 : 1;
  const nextIndex = index + offset;
  if (nextIndex < 0) return { ok: false, message: "이미 맨 위입니다." };
  if (nextIndex >= list.length) return { ok: false, message: "이미 맨 아래입니다." };
  const next = list.slice();
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return { ok: true, list: next };
}

function removeCourseSubjectFromDraft(code) {
  if (courseSubjectDraft.length <= 1) {
    return { ok: false, message: "과목은 1개 이상 유지해야 합니다." };
  }
  return { ok: true, list: courseSubjectDraft.filter((item) => item.value !== String(code || "").trim()) };
}

function applyCourseCatalogToPage() {
  catalogGrades = getCourseGradeLabels(mergedCourseCatalog);
  catalogCourseSubjects = getCourseSubjectOptions(mergedCourseCatalog);
  labelMaps = buildLabelMaps(mergedCourseCatalog);
  courseSubjectDraft = getCourseCatalogSubjectDraft(mergedCourseCatalog);
  courseGradeDraft = getCourseCatalogGradeDraft(mergedCourseCatalog).map((item) => item.label);
  courseYearDraft = getCourseCatalogYearDraft(mergedCourseCatalog).map((item) => item.label);
  renderCourseCatalogPanel();
  refreshCourseCatalogSelects();
}

function refreshCourseCatalogSelects(fallbackSubject = "", fallbackGrade = "", fallbackYear = "") {
  syncCourseCatalogArraysFromDraft();
  buildSubjectQuick(fallbackSubject);
  buildGradeQuick(fallbackGrade);
  buildYearQuick(fallbackYear);
  renderGradeFilterSelect();

  const subjectOptions = catalogCourseSubjects;
  const subjectFilter = $("#adminFilterSubject");
  if (subjectFilter) {
    const current = subjectFilter.value || "all";
    subjectFilter.innerHTML =
      '<option value="all">전체 과목</option>' +
      subjectOptions
        .map((opt) => `<option value="${escapeHtml(String(opt.value))}">${escapeHtml(String(opt.label || opt.value))}</option>`)
        .join("");
    subjectFilter.value = Array.from(subjectFilter.options).some((opt) => opt.value === current) ? current : "all";
  }
}

function buildSubjectQuick(selectedSubject = "") {
  const quick = $("#contentEditSubjectQuick");
  const raw = $("#contentEditSubject");
  if (!quick || !raw) return;

  const subjectOptions = catalogCourseSubjects;
  quick.innerHTML = buildCourseSubjectSelectHtml(subjectOptions, {
    selected: selectedSubject,
    emptyLabel: "과목 선택"
  });
  applyCourseSubjectSelectValue(quick, raw, selectedSubject, subjectOptions);
  applyCourseSubjectColorToSelect();

  if (quick.dataset.ready === "1") return;
  quick.dataset.ready = "1";
  quick.addEventListener("change", () => {
    syncCourseSubjectCustomField(quick, raw);
    if (quick.value === "__custom__") {
      raw.value = "";
      raw.focus();
    }
    applyCourseSubjectColorToSelect();
    updateLivePreview();
  });
  raw.addEventListener("input", () => updateLivePreview());
}

function resolveSubjectFromForm() {
  return resolveCourseSubjectFromControls(
    $("#contentEditSubjectQuick"),
    $("#contentEditSubject"),
    catalogCourseSubjects
  );
}

async function saveCourseCatalogDraft() {
  courseSubjectDraft = syncCourseSubjectDraftFromDom();
  if (courseSubjectDraft.some((item) => !item.label)) {
    toast("모든 과목명을 입력해주세요.", true);
    return;
  }
  if (
    courseSubjectDraft.some((item) => isReservedCatalogValue(item.value) || isReservedCatalogValue(item.label)) ||
    courseGradeDraft.some((value) => isReservedCatalogValue(value)) ||
    courseYearDraft.some((value) => isReservedCatalogValue(value))
  ) {
    toast("해당 값은 저장할 수 없습니다.", true);
    return;
  }
  if (courseSubjectDraft.length < 1) {
    toast("과목은 1개 이상 유지해야 합니다.", true);
    return;
  }
  if (courseGradeDraft.length < 1) {
    toast("학년은 1개 이상 유지해야 합니다.", true);
    return;
  }
  if (courseYearDraft.length < 1) {
    toast("연도는 1개 이상 유지해야 합니다.", true);
    return;
  }

  const gradeOptions = courseGradeDraft.map((label) => ({ value: label, label }));
  const yearOptions = courseYearDraft.map((label) => ({ value: label, label }));
  mergedCourseCatalog = applyCourseCatalogDraft(
    mergedCourseCatalog,
    courseSubjectDraft,
    gradeOptions,
    yearOptions
  );

  try {
    const settingsRef = doc(db, "settings", "courseCatalog");
    const uid = auth.currentUser?.uid || "";
    const colorSettingsPayload = buildSubjectColorSettingsPayload(
      courseSubjectDraft.map((item) => item.label),
      courseSubjectColorSourceMap
    );
    const shouldWriteSubjectColors = !areSubjectColorMapsEqual(
      colorSettingsPayload.subjectColorMap,
      persistedCourseSubjectColorMap
    );
    const batch = writeBatch(db);
    batch.set(
      settingsRef,
      {
        chipGroups: mergedCourseCatalog.chipGroups,
        instructorSubjectChips: deleteField(),
        subjectColorMap: deleteField(),
        subjectMeta: deleteField(),
        updatedAt: serverTimestamp(),
        ...(uid ? { updatedBy: uid } : {})
      },
      { merge: true }
    );
    if (shouldWriteSubjectColors) {
      batch.set(
        doc(db, "settings", SUBJECT_COLOR_SETTINGS_KEY),
        {
          ...colorSettingsPayload,
          updatedAt: serverTimestamp(),
          ...(uid ? { updatedBy: uid } : {}),
        },
        { merge: true }
      );
    }
    await batch.commit();
    subjectColorMap = colorSettingsPayload.subjectColorMap;
    courseSubjectColorSourceMap = { ...colorSettingsPayload.subjectColorMap };
    if (shouldWriteSubjectColors) {
      persistedCourseSubjectColorMap = { ...colorSettingsPayload.subjectColorMap };
      invalidateSetting(SUBJECT_COLOR_SETTINGS_KEY);
    }
    invalidateSetting("courseCatalog");
    applyCourseCatalogToPage();
    toast("강좌 목록을 저장했습니다.");
  } catch (error) {
    console.error("[admin-courses] course catalog save failed:", error);
    toast("목록 저장에 실패했습니다.", true);
  }
}

function setupCourseCatalogPanel() {
  $("#courseCatalogSaveBtn")?.addEventListener("click", () => {
    saveCourseCatalogDraft();
  });
  $("#courseCatalogSubjectAddBtn")?.addEventListener("click", () => {
    courseSubjectDraft = syncCourseSubjectDraftFromDom();
    const result = addCourseSubjectToDraft($("#courseCatalogSubjectLabelInput")?.value || "");
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    courseSubjectDraft = result.list;
    if ($("#courseCatalogSubjectLabelInput")) $("#courseCatalogSubjectLabelInput").value = "";
    renderCourseCatalogPanel();
  });
  $("#courseCatalogGradeAddBtn")?.addEventListener("click", () => {
    const result = addUniqueCatalogItem(courseGradeDraft, $("#courseCatalogGradeInput")?.value || "");
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    courseGradeDraft = result.list;
    if ($("#courseCatalogGradeInput")) $("#courseCatalogGradeInput").value = "";
    renderCourseCatalogPanel();
  });
  $("#courseCatalogSubjectLabelInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    $("#courseCatalogSubjectAddBtn")?.click();
  });
  $("#courseCatalogGradeInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    $("#courseCatalogGradeAddBtn")?.click();
  });
  $("#courseCatalogYearAddBtn")?.addEventListener("click", () => {
    const result = addUniqueCatalogItem(courseYearDraft, $("#courseCatalogYearInput")?.value || "");
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    courseYearDraft = result.list;
    if ($("#courseCatalogYearInput")) $("#courseCatalogYearInput").value = "";
    renderCourseCatalogPanel();
  });
  $("#courseCatalogYearInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    $("#courseCatalogYearAddBtn")?.click();
  });
  $("#courseCatalogPanel")?.addEventListener("click", (event) => {
    const moveSubjectBtn = event.target.closest("[data-subject-move]");
    if (moveSubjectBtn) {
      courseSubjectDraft = syncCourseSubjectDraftFromDom();
      const result = moveCourseSubjectInDraft(
        moveSubjectBtn.dataset.subjectCode || "",
        moveSubjectBtn.dataset.subjectMove || ""
      );
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseSubjectDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const removeSubjectBtn = event.target.closest("[data-subject-remove]");
    if (removeSubjectBtn) {
      courseSubjectDraft = syncCourseSubjectDraftFromDom();
      const result = removeCourseSubjectFromDraft(removeSubjectBtn.dataset.subjectRemove || "");
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseSubjectDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const moveGradeBtn = event.target.closest("[data-catalog-move]");
    if (moveGradeBtn && moveGradeBtn.dataset.catalogField === "grades") {
      const result = moveCatalogItem(
        courseGradeDraft,
        moveGradeBtn.dataset.catalogValue || "",
        moveGradeBtn.dataset.catalogMove || ""
      );
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseGradeDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const removeGradeBtn = event.target.closest(".admin-catalog-tag__remove");
    if (removeGradeBtn && removeGradeBtn.dataset.catalogField === "grades") {
      const result = removeCatalogItem(courseGradeDraft, removeGradeBtn.dataset.catalogValue || "", {
        minItems: 1,
        label: "학년"
      });
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseGradeDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const editGradeBtn = event.target.closest(".admin-catalog-tag__edit");
    if (editGradeBtn && editGradeBtn.dataset.catalogField === "grades") {
      const oldValue = editGradeBtn.dataset.catalogValue || "";
      const nextValue = window.prompt("학년 표시값 수정", oldValue);
      if (nextValue === null) return;
      const result = renameCatalogItem(courseGradeDraft, oldValue, nextValue);
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseGradeDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const moveYearBtn = event.target.closest("[data-catalog-move]");
    if (moveYearBtn && moveYearBtn.dataset.catalogField === "years") {
      const result = moveCatalogItem(
        courseYearDraft,
        moveYearBtn.dataset.catalogValue || "",
        moveYearBtn.dataset.catalogMove || ""
      );
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseYearDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const removeYearBtn = event.target.closest(".admin-catalog-tag__remove");
    if (removeYearBtn && removeYearBtn.dataset.catalogField === "years") {
      const result = removeCatalogItem(courseYearDraft, removeYearBtn.dataset.catalogValue || "", {
        minItems: 1,
        label: "연도"
      });
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseYearDraft = result.list;
      renderCourseCatalogPanel();
      return;
    }
    const editYearBtn = event.target.closest(".admin-catalog-tag__edit");
    if (editYearBtn && editYearBtn.dataset.catalogField === "years") {
      const oldValue = editYearBtn.dataset.catalogValue || "";
      const nextValue = window.prompt("연도 수정", oldValue);
      if (nextValue === null) return;
      const result = renameCatalogItem(courseYearDraft, oldValue, nextValue);
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      courseYearDraft = result.list;
      renderCourseCatalogPanel();
    }
  });
  $("#courseCatalogPanel")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-catalog-inline-input]");
    if (!input) return;
    const field = input.dataset.catalogField || "";
    const source = field === "grades" ? courseGradeDraft : field === "years" ? courseYearDraft : null;
    if (!source) return;
    const result = renameCatalogItem(source, input.dataset.catalogValue || "", input.value);
    if (!result.ok) return toast(result.message, true);
    if (field === "grades") courseGradeDraft = result.list;
    else courseYearDraft = result.list;
    renderCourseCatalogPanel();
  });
}

const COURSE_DELETE_CONFIRM_PHRASE = "강좌 삭제";
const FORCE_DELETE_CONFIRM_PHRASE = "강좌와 수강기록 삭제";

function setCourseDeleteFeedback(selector, message, isError = true) {
  const element = $(selector);
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
  element.style.color = isError ? "#b91c1c" : "#15803d";
  element.style.fontWeight = "700";
}

function normalizeVisibility(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "unlisted" || raw === "private" || raw === "hidden") return raw;
  return "public";
}

function normalizeCourseStatusForSave(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "draft" || raw === "archived") return raw;
  return "published";
}

function getAdminCourseStatusLabel(status) {
  const raw = String(status || "published").trim().toLowerCase();
  if (raw === "published") return "게시";
  if (raw === "archived") return "보관 / 일시 차단";
  if (raw === "draft") return "임시저장 / 미사용";
  return "확인 필요";
}

function getAdminAccessTypeLabel(accessType) {
  const raw = String(accessType || "public").trim();
  if (raw === "public") return "공개";
  if (raw === "memberOnly" || raw === "member") return "회원 전용";
  if (raw === "approvalRequired") return "회원 전용(유료)";
  if (raw === "paid") return "유료 / 미사용";
  return "확인 필요";
}

function getAdminCourseFormatLabel(courseFormat, course = {}) {
  const weeks = Array.isArray(course.curriculumWeeks)
    ? course.curriculumWeeks
    : (Array.isArray(course.weeks) ? course.weeks : []);
  return normalizeCourseFormat(courseFormat, weeks.length) === "series" ? "시리즈" : "특강";
}

function hasExplicitVisibility(course = {}) {
  return Object.prototype.hasOwnProperty.call(course, "visibility") &&
    String(course.visibility ?? "").trim() !== "";
}

function hasLegacyHiddenFlag(course = {}) {
  return course.hidden === true ||
    course.isHidden === true ||
    course.deleted === true ||
    course.isDeleted === true ||
    course.blocked === true ||
    course.isBlocked === true;
}

function resolveVisibilityForSave(existingCourse = {}, status = "published") {
  if (status === "published") return "public";
  if (hasExplicitVisibility(existingCourse)) {
    return normalizeVisibility(existingCourse.visibility);
  }
  if (hasLegacyHiddenFlag(existingCourse)) return "hidden";
  return "public";
}

function setSelectValue(selectEl, value, fallback = "") {
  if (!selectEl) return;
  const nextValue = String(value || fallback || "").trim();
  if (!nextValue) {
    selectEl.value = "";
    return;
  }
  const hasOption = Array.from(selectEl.options).some((opt) => String(opt.value) === nextValue);
  if (!hasOption) {
    const opt = document.createElement("option");
    opt.value = nextValue;
    opt.disabled = true;
    if (selectEl.id === "contentEditStatus") {
      opt.textContent = getAdminCourseStatusLabel(nextValue);
    } else if (selectEl.id === "contentEditAccessType") {
      opt.textContent = getAdminAccessTypeLabel(nextValue);
    } else {
      opt.textContent = nextValue;
      opt.disabled = false;
    }
    selectEl.appendChild(opt);
  }
  selectEl.value = nextValue;
}

function normalizeInstructorProfile(docSnap, accountUidByProfileId = new Map()) {
  const data = docSnap.data() || {};
  const instructorId = String(docSnap.id || "").trim();
  const authUid = accountUidByProfileId.get(instructorId) ||
    accountUidByProfileId.get(String(data.instructorId || "").trim()) ||
    (typeof data.uid === "string" ? data.uid.trim() : "");
  const name = String(data.name || data.displayName || "").trim();
  if (!instructorId || !authUid || !name) return null;
  return {
    uid: authUid,
    authUid,
    instructorId,
    name
  };
}

function getInstructorSelectValues(record = {}) {
  const rawValues = [
    ...(Array.isArray(record.instructorUids) ? record.instructorUids : []),
    ...(Array.isArray(record.instructorIds) ? record.instructorIds : []),
    record.instructorUid,
    record.instructorId
  ];
  const values = [];
  rawValues.forEach((rawValue) => {
    const value = String(rawValue || "").trim();
    if (!value) return;
    const matched = instructors.get(value) ||
      Array.from(instructors.values()).find((inst) => inst.instructorId === value);
    const selectValue = matched?.uid || value;
    if (!values.includes(selectValue)) values.push(selectValue);
  });
  return values;
}

function getCourseSubjectDisplayName(subjectValue) {
  const value = String(subjectValue || "").trim();
  const option = catalogCourseSubjects.find((item) => String(item.value || "") === value);
  return String(option?.label || value).trim();
}

function applyCourseSubjectColorToSelect() {
  const quick = $("#contentEditSubjectQuick");
  if (!quick) return;
  const subjectName = quick.value === "__custom__"
    ? ""
    : getCourseSubjectDisplayName(quick.value);
  const colorStyle = getSubjectColorStyle(subjectName, subjectColorMap);
  quick.classList.toggle("has-subject-color", Boolean(colorStyle));
  if (colorStyle) quick.setAttribute("style", colorStyle);
  else quick.removeAttribute("style");
}

function getInstructorMatchKeys(selectedValue) {
  const value = String(selectedValue || "").trim();
  const inst = value ? instructors.get(value) : null;
  return new Set([value, inst?.uid, inst?.authUid, inst?.instructorId].filter(Boolean));
}

function getSelectedInstructors() {
  const selectedInputs = Array.from(
    $("#contentEditInstructorUid")?.querySelectorAll('input[type="checkbox"]:checked') || []
  );
  const selectedValues = selectedInputs
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
  const selectedRows = selectedValues.map((uid) => instructors.get(uid)).filter(Boolean);
  const fallbackNames = selectedValues
    .filter((uid) => !instructors.has(uid))
    .map((uid) => {
      const input = selectedInputs.find((item) => item.value === uid);
      return String(input?.dataset.instructorName || uid).trim();
    });
  const instructorUids = selectedRows.map((row) => row.uid).concat(
    selectedValues.filter((uid) => !instructors.has(uid))
  );
  const instructorIds = selectedRows.map((row) => row.instructorId).filter(Boolean);
  const instructorNames = selectedRows.map((row) => row.name).concat(fallbackNames).filter(Boolean);
  return {
    instructorUid: instructorUids[0] || "",
    instructorId: instructorIds[0] || "",
    instructorName: instructorNames[0] || "",
    instructorUids,
    instructorIds,
    instructorNames
  };
}

function getPreviewCurriculumStatus(format) {
  if (format === "single") {
    const url = ($("#contentEditSingleVideoUrl")?.value || weeksState[0]?.videos?.[0]?.url || "").trim();
    return url ? "학습 영상 있음" : "학습 영상 없음";
  }
  const weekCount = weeksState.length;
  const videoCount = weeksState.reduce(
    (sum, week) => sum + (week.videos || []).filter((v) => String(v.url || "").trim()).length,
    0
  );
  return `${weekCount}주차 / ${videoCount}개 영상`;
}

function toPreviewDisplayValue(value, fallback = "-") {
  const text = String(value || "").trim();
  return text ? escapeHtml(text) : fallback;
}

function updateLivePreview() {
  const root = $("#contentEditLivePreviewBody");
  if (!root) return;

  const titleRaw = $("#contentEditTitle")?.value.trim() || "강좌명 미입력";
  const subjectCode = resolveSubjectFromForm();
  const subjectLabel = subjectCode ? getSubjectLabel(subjectCode, labelMaps) : "";
  const gradeRaw = $("#contentEditGrade")?.value.trim() || "";
  const gradeLabel = gradeRaw ? (getGradeLabel(gradeRaw, labelMaps) || gradeRaw) : "";
  const yearRaw = $("#contentEditYear")?.value.trim() || "";
  const cardContentRaw = $("#contentEditShortDescription")?.value.trim() || "";
  const accessType = normalizeAccessType($("#contentEditAccessType")?.value || "public");
  const courseFormat = normalizeCourseFormat($("#contentEditCourseFormat")?.value || "single", weeksState.length);
  const previewVideoUrl = $("#contentEditPreviewVideoUrl")?.value.trim() || "";
  const { instructorNames } = getSelectedInstructors();

  const excerptRaw = cardContentRaw || "강좌 카드 내용을 입력하세요";
  const excerpt = excerptRaw.length > PREVIEW_EXCERPT_MAX
    ? `${excerptRaw.slice(0, PREVIEW_EXCERPT_MAX)}...`
    : excerptRaw;
  const subjectColorStyle = getSubjectColorStyle(subjectLabel || subjectCode, subjectColorMap);
  const accessBadge = getAdminAccessTypeLabel(accessType);
  const formatBadge = getCourseFormatBadgeLabel(courseFormat);
  const accessBadgeClass = accessType === "memberOnly" ? " is-member" : "";
  const previewStatus = previewVideoUrl ? "미리보기 영상 있음" : "미리보기 영상 없음";
  const curriculumStatus = getPreviewCurriculumStatus(courseFormat);

  root.innerHTML = `
    <article class="course-card course-card--public course-card--admin-preview${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>
      <div class="admin-course-card-preview__badges">
        <span class="admin-course-card-preview__badge admin-course-card-preview__badge--access${accessBadgeClass}">${escapeHtml(accessBadge)}</span>
        <span class="admin-course-card-preview__badge admin-course-card-preview__badge--format">${escapeHtml(formatBadge)}</span>
      </div>
      <div class="course-card__meta-band" aria-label="강좌 메타">
        <span class="course-card__meta-item">${toPreviewDisplayValue(yearRaw)}</span>
        <span class="course-card__meta-sep" aria-hidden="true">|</span>
        <span class="course-card__meta-item">${toPreviewDisplayValue(gradeLabel)}</span>
        <span class="course-card__meta-sep" aria-hidden="true">|</span>
        <span class="course-card__meta-item course-card__meta-item--subject">${toPreviewDisplayValue(subjectLabel)}</span>
        <span class="course-card__meta-sep" aria-hidden="true">|</span>
        <span class="course-card__meta-item">${toPreviewDisplayValue(instructorNames.join(", "), "미배정")}</span>
      </div>
      <div class="course-card__content-block">
        <h3 class="course-card__title">${escapeHtml(titleRaw)}</h3>
        <p class="course-card__excerpt muted">${escapeHtml(excerpt)}</p>
      </div>
      <div class="admin-course-card-preview__footer muted">
        <span>${escapeHtml(previewStatus)}</span>
        <span>${escapeHtml(curriculumStatus)}</span>
      </div>
    </article>
  `;
}

function bindLivePreview() {
  const form = $("#contentEditForm");
  if (!form || form.dataset.previewBound === "1") return;
  form.dataset.previewBound = "1";
  form.addEventListener("input", updateLivePreview);
  form.addEventListener("change", updateLivePreview);
  $("#contentEditInstructorUid")?.addEventListener("change", updateLivePreview);
}

function toast(msg, err = false) {
  showAdminToast(msg, err);
  if (err && $("#contentEditModal")?.classList.contains("is-open") && $("#contentEditFeedback")?.hidden) showCourseFormError(msg);
}

function showCourseFormError(message, field = null) {
  const feedback = $("#contentEditFeedback");
  if (feedback) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }
  $("#contentEditForm")?.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute("aria-invalid"));
  $("#contentEditForm")?.querySelectorAll(".course-field-error").forEach((el) => el.remove());
  if (field) {
    field.setAttribute("aria-invalid", "true");
    const detail = document.createElement("p");
    detail.className = "course-field-error";
    detail.textContent = message;
    field.insertAdjacentElement("afterend", detail);
  }
}

function getCourseRow(courseId) {
  return rows.find((row) => row.id === courseId) || null;
}

function getCourseTitle(courseId) {
  return getCourseRow(courseId)?.title || "선택한 강좌";
}

function showCourseModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  modal.classList.remove("active");
  modal.classList.add("is-open");
}

function hideCourseModal(modal) {
  if (!modal) return;
  modal.classList.remove("is-open", "active");
  modal.hidden = true;
}

function resetCourseModalState() {
  document.querySelectorAll(".admin-courses-modal").forEach(hideCourseModal);
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
}

function openSupportModal(modalId) {
  showCourseModal($(`#${modalId}`));
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
}

function closeSupportModal(modalId) {
  hideCourseModal($(`#${modalId}`));
  const hasOpenModal = Boolean(document.querySelector(".admin-courses-modal.is-open"));
  if (!hasOpenModal) {
    document.body.classList.remove("modal-open");
    document.documentElement.classList.remove("modal-open");
  }
}

function focusModalInput(selector) {
  window.setTimeout(() => {
    const input = $(selector);
    if (input) input.focus();
  }, 0);
}

function getTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(value) {
  const millis = getTimestampMillis(value);
  if (!millis) return "-";
  return new Date(millis).toLocaleDateString("ko-KR");
}

function normalizeEnrollment(docSnap) {
  const data = docSnap.data() || {};
  const learnerSnapshot = data.learnerSnapshot && typeof data.learnerSnapshot === "object"
    ? data.learnerSnapshot
    : {};
  const studentSnapshot = data.studentSnapshot && typeof data.studentSnapshot === "object"
    ? data.studentSnapshot
    : {};
  const snapshot = Object.keys(learnerSnapshot).length ? learnerSnapshot : studentSnapshot;
  return {
    id: docSnap.id,
    ...data,
    learnerName: String(snapshot.name || data.studentName || data.name || "").trim(),
    learnerEmail: String(snapshot.email || data.email || "").trim(),
    learnerPhone: String(snapshot.phone || data.phone || "").trim(),
    learnerType: String(data.learnerType || snapshot.type || "student").trim(),
    status: String(data.status || "active").trim(),
    progress: data.progress,
    enrolledAt: data.createdAt || data.enrolledAt || data.updatedAt || null
  };
}

function getLearnerTypeLabel(type) {
  if (type === "member") return "회원";
  if (type === "student") return "학생";
  return "확인 필요";
}

function getEnrollmentStatusLabel(status) {
  const raw = String(status || "active").trim().toLowerCase();
  if (raw === "active") return "수강중";
  if (raw === "cancelled" || raw === "canceled") return "취소됨";
  if (raw === "completed") return "완료";
  if (raw === "paused" || raw === "blocked") return "중지";
  if (raw === "revoked") return "해제됨";
  return "확인 필요";
}

function getProgressLabel(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)}%`;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${Math.round(parsed)}%` : value.trim();
  }
  return "-";
}

async function loadCourseEnrollments(courseId) {
  const snap = await getDocs(query(collection(db, "enrollments"), where("courseId", "==", courseId)));
  return snap.docs
    .map(normalizeEnrollment)
    .sort((a, b) => getTimestampMillis(b.enrolledAt) - getTimestampMillis(a.enrolledAt));
}

async function loadCourseDeleteInventory(courseId) {
  // Stay within one atomic batch. Larger courses need a separately reviewed deletion plan.
  const [enrollments, requests, privateSnap, courseSnap] = await Promise.all([
    getDocs(query(collection(db, "enrollments"), where("courseId", "==", courseId), limit(450))),
    getDocs(query(collection(db, "courses", courseId, "enrollmentRequests"), limit(450))),
    getDoc(doc(db, "coursePrivateContent", courseId)),
    getDoc(doc(db, "courses", courseId))
  ]);
  if (!courseSnap.exists()) throw new Error("강좌를 찾을 수 없습니다.");
  const inventory = {
    enrollments: enrollments.docs.map(normalizeEnrollment),
    requests: requests.docs.map((entry) => entry.id),
    hasPrivateContent: privateSnap.exists()
  };
  if (inventory.enrollments.length + inventory.requests.length + Number(inventory.hasPrivateContent) + 1 > 450
      || enrollments.size === 450 || requests.size === 450) {
    throw new Error("연결 기록이 한 번에 안전하게 삭제할 수 있는 범위를 넘습니다. 강좌를 보관하고 별도 삭제 계획을 확인해 주세요.");
  }
  return inventory;
}

function deleteInventoryKey(inventory) {
  return JSON.stringify([
    inventory.enrollments.map((row) => row.id).sort(),
    inventory.requests.slice().sort(), inventory.hasPrivateContent
  ]);
}

function isApprovalCourseRow(courseId) {
  return normalizeAccessType(rows.find((row) => row.id === courseId)?.accessType) === "approvalRequired";
}

async function loadApprovalRequests(courseId, { append = false } = {}) {
  if (!append) {
    approvalRequestRows = [];
    approvalRequestCursor = null;
  }
  const parts = [where("status", "==", "pending"), limit(30)];
  if (append && approvalRequestCursor) parts.push(startAfter(approvalRequestCursor));
  const snap = await getDocs(query(collection(db, "courses", courseId, "enrollmentRequests"), ...parts));
  approvalRequestCursor = snap.docs.at(-1) || null;
  approvalRequestHasMore = snap.docs.length === 30;
  const next = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const profiles = new Map();
  for (const [learnerType, collectionName] of [["student", "students"], ["member", "members"]]) {
    const ids = next.filter((item) => item.learnerType === learnerType).map((item) => item.userId);
    for (let start = 0; start < ids.length; start += 10) {
      const batch = await getDocs(query(collection(db, collectionName), where(documentId(), "in", ids.slice(start, start + 10))));
      batch.forEach((entry) => profiles.set(entry.id, entry.data() || {}));
    }
  }
  approvalRequestRows = approvalRequestRows.concat(next.map((item) => ({
    ...item,
    profile: profiles.get(item.userId) || null
  })));
}

function renderApprovalRequests() {
  const visibleRequests = filterApprovalRequests(approvalRequestRows, approvalRequestSearch);
  const rowsHtml = visibleRequests.map((item) => {
    const profile = item.profile;
    const identity = profile
      ? `${escapeHtml(profile.name || "이름 없음")} · ${escapeHtml(profile.email || item.userId)}`
      : `${escapeHtml(item.userId)} · 계정 확인 필요`;
    const eligible = profile && (item.learnerType === "student" || (item.learnerType === "member" && profile.memberPurpose === "general"));
    const uidAttribute = escapeHtml(item.userId).replace(/"/g, "&quot;");
    return `<div class="admin-courses-enrollment-summary"><span>${identity} (${item.learnerType === "student" ? "학생" : "일반회원"} · 대기)</span><span><button type="button" class="btn sm" data-approve-request="${uidAttribute}" ${eligible ? "" : "disabled"}>승인</button> <button type="button" class="btn sm" data-reject-request="${uidAttribute}">거절</button></span></div>`;
  }).join("");
  const empty = approvalRequestSearch ? "현재 불러온 신청 중 검색 결과가 없습니다." : "대기 중인 신청이 없습니다.";
  const searchAttribute = escapeHtml(approvalRequestSearch).replace(/"/g, "&quot;");
  return `<section aria-label="수강신청 대기"><h3>승인 대기 ${approvalRequestRows.length}건${approvalRequestHasMore ? " 이상" : ""}</h3><form id="approvalRequestSearchForm"><label for="approvalRequestSearch">신청자 검색 · 현재 불러온 목록</label><div class="form-row"><input id="approvalRequestSearch" type="search" value="${searchAttribute}" placeholder="이름, 이메일, UID"><button type="submit" class="btn sm">검색</button><button type="button" class="btn sm" data-clear-request-search="1">초기화</button></div></form>${rowsHtml || `<p class="muted">${empty}</p>`}${approvalRequestHasMore ? '<button type="button" class="btn sm" data-more-requests="1">신청 더 보기</button>' : ""}${renderManualEnrollmentSection()}</section>`;
}

function renderManualEnrollmentResults() {
  const { status, results, selectedKey, truncated } = manualEnrollmentSearch;
  if (status === "loading") return '<p class="admin-courses-manual-message" role="status">계정을 조회하는 중...</p>';
  if (status === "empty") return '<p class="admin-courses-manual-message" role="status">검색 결과가 없습니다. 이름이나 이메일을 확인해 주세요.</p>';
  if (status === "search-error") return '<p class="admin-courses-manual-message is-error" role="alert">계정 조회에 실패했습니다. 다시 검색해 주세요.</p>';
  if (!results.length) return '<p class="admin-courses-manual-message muted">이름 2자 이상 또는 계정 이메일로 검색하세요.</p>';
  const rows = results.map((item) => {
    const key = `${item.type}:${item.id}`;
    const parent = item.type === "member" && item.memberPurpose !== "general";
    const label = item.type === "student" ? "학생" : (parent ? "학부모 · 등록 불가" : "일반회원");
    const details = item.type === "student" ? [item.school, item.grade].filter(Boolean).join(" · ") : "";
    return `<label class="admin-courses-manual-candidate${parent ? " is-disabled" : ""}"><input type="radio" name="manualApprovalCandidate" value="${escapeHtml(key).replace(/"/g, "&quot;")}" ${selectedKey === key ? "checked" : ""} ${parent ? "disabled" : ""}><span><strong>${escapeHtml(item.name || "이름 없음")}</strong><span>${escapeHtml(item.email || "이메일 없음")}</span><small>${escapeHtml(label)}${details ? ` · ${escapeHtml(details)}` : ""} · 계정 ID ${escapeHtml(item.id)}</small></span></label>`;
  }).join("");
  return `<p class="admin-courses-manual-message" role="status">검색 결과 ${results.length}명${truncated ? " 이상 · 더 구체적으로 검색해 주세요" : ""}</p><div class="admin-courses-manual-results" role="radiogroup" aria-label="등록할 회원 선택">${rows}</div>`;
}

function parseManualCandidateKey(key) {
  const separator = String(key || "").indexOf(":");
  return separator < 0 ? ["", ""] : [key.slice(0, separator), key.slice(separator + 1)];
}

function renderManualEnrollmentSection() {
  const selected = getSelectedEnrollmentCandidate(manualEnrollmentSearch.results, ...parseManualCandidateKey(manualEnrollmentSearch.selectedKey));
  const feedback = ["success", "duplicate", "save-error", "selection-error"].includes(manualEnrollmentSearch.status);
  return `<section class="admin-courses-manual-enrollment" aria-label="관리자 직접 등록"><h3>관리자 직접 등록</h3><form id="manualApprovalSearchForm"><label for="manualApprovalSearchInput">학생·일반회원 검색</label><div class="form-row"><input id="manualApprovalSearchInput" type="search" autocomplete="off" value="${escapeHtml(manualEnrollmentSearchTerm).replace(/"/g, "&quot;")}" placeholder="이름 또는 계정 이메일"><button type="submit" class="btn sm" ${manualEnrollmentSearch.status === "loading" ? "disabled" : ""}>검색</button><button type="button" class="btn sm" data-clear-manual-search="1">초기화</button></div></form><div id="manualApprovalSearchResults" aria-live="polite">${renderManualEnrollmentResults()}</div><div class="admin-courses-manual-actions"><button type="button" class="btn primary sm" id="manualApprovalRegisterBtn" data-register-manual="1" ${selected && !approvalActionInProgress ? "" : "disabled"}>등록</button><span class="muted">선택한 계정만 등록합니다. 학부모는 제외됩니다.</span></div><p id="manualApprovalFeedback" class="admin-courses-manual-feedback${manualEnrollmentSearch.status === "success" ? " is-success" : ""}" role="${feedback ? "alert" : "status"}" ${feedback ? "" : "hidden"}>${feedback ? escapeHtml(manualEnrollmentSearch.message) : ""}</p></section>`;
}

function updateManualEnrollmentSection() {
  const section = $(".admin-courses-manual-enrollment");
  if (!section) return;
  const fresh = document.createElement("div");
  fresh.innerHTML = renderManualEnrollmentSection();
  section.replaceWith(fresh.firstElementChild);
}

async function searchManualEnrollment(courseId, raw) {
  const requestId = ++manualEnrollmentSearchRequestId;
  const term = classifyEnrollmentSearch(raw);
  manualEnrollmentSearchTerm = String(raw || "").trim();
  manualEnrollmentSearch = { status: "loading", results: [], selectedKey: "", message: "", truncated: false };
  updateManualEnrollmentSection();
  const input = $("#manualApprovalSearchInput");
  if (input) input.value = String(raw || "").trim();
  if (!term) {
    manualEnrollmentSearch = { ...manualEnrollmentSearch, status: "selection-error", message: "이름은 2자 이상, 이메일은 전체 주소를 입력해 주세요." };
    updateManualEnrollmentSection();
    return;
  }
  try {
    const parts = term.field === "name"
      ? [where("name", ">=", term.value), where("name", "<=", `${term.value}\uf8ff`), limit(MANUAL_ENROLLMENT_SEARCH_LIMIT)]
      : [where("email", "==", term.value), limit(MANUAL_ENROLLMENT_SEARCH_LIMIT)];
    const [students, members] = await Promise.all([
      getDocs(query(collection(db, "students"), ...parts)),
      getDocs(query(collection(db, "members"), ...parts))
    ]);
    if (courseId !== activeEnrollmentCourseId || requestId !== manualEnrollmentSearchRequestId) return;
    const mapDocs = (snapshot) => snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() || {} }));
    const results = toEnrollmentCandidates(mapDocs(students), mapDocs(members));
    manualEnrollmentSearch = {
      status: results.length ? "ready" : "empty", results, selectedKey: "", message: "",
      truncated: students.size === MANUAL_ENROLLMENT_SEARCH_LIMIT || members.size === MANUAL_ENROLLMENT_SEARCH_LIMIT
    };
  } catch (error) {
    if (courseId !== activeEnrollmentCourseId || requestId !== manualEnrollmentSearchRequestId) return;
    console.error("[admin-courses] manual enrollment search failed:", error);
    manualEnrollmentSearch = { status: "search-error", results: [], selectedKey: "", message: "", truncated: false };
  }
  updateManualEnrollmentSection();
  const nextInput = $("#manualApprovalSearchInput");
  if (nextInput) nextInput.value = term.value;
}

function renderEnrollmentTable(enrollments, { showActions = true, approvalCourse = false } = {}) {
  if (!enrollments.length) {
    return '<div class="admin-courses-enrollment-empty">이 강좌의 수강 기록이 없습니다.</div>';
  }

  const actionHeader = showActions ? "<th>관리</th>" : "";
  const rowsHtml = enrollments.map((enrollment) => {
    const actionCell = showActions
      ? `<td>${approvalCourse && enrollment.status === "revoked" ? "해제됨" : `<button type="button" class="btn sm danger" data-remove-enrollment="${escapeHtml(enrollment.id)}">${approvalCourse ? "수강 해제" : "수강 기록 제거"}</button>`}</td>`
      : "";
    return `
      <tr>
        <td><strong>${escapeHtml(enrollment.learnerName || "-")}</strong></td>
        <td>${escapeHtml(enrollment.learnerEmail || "-")}</td>
        <td>${escapeHtml(enrollment.learnerPhone || "-")}</td>
        <td>${escapeHtml(getLearnerTypeLabel(enrollment.learnerType))}</td>
        <td>${escapeHtml(getEnrollmentStatusLabel(enrollment.status))}</td>
        <td>${escapeHtml(formatTimestamp(enrollment.enrolledAt))}</td>
        <td>${escapeHtml(getProgressLabel(enrollment.progress))}</td>
        ${actionCell}
      </tr>
    `;
  }).join("");

  return `
    <div class="admin-courses-enrollment-table-wrap">
      <table class="admin-courses-enrollment-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>이메일</th>
            <th>연락처</th>
            <th>구분</th>
            <th>수강 상태</th>
            <th>수강 신청일</th>
            <th>진도</th>
            ${actionHeader}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderEnrollmentModal(courseId, enrollments) {
  const body = $("#courseEnrollmentsBody");
  const subtitle = $("#courseEnrollmentsSubtitle");
  if (subtitle) {
    subtitle.textContent = `${getCourseTitle(courseId)} / 수강 기록 ${enrollments.length}개`;
  }
  if (!body) return;
  body.innerHTML = `
    <div class="admin-courses-enrollment-summary">
      <strong>수강생 목록</strong>
      <span class="admin-courses-enrollment-count">${enrollments.length}명</span>
    </div>
    ${renderEnrollmentTable(enrollments, { showActions: true, approvalCourse: isApprovalCourseRow(courseId) })}
    ${isApprovalCourseRow(courseId) ? renderApprovalRequests() : ""}
  `;
}

async function refreshCourseEnrollments(courseId) {
  const body = $("#courseEnrollmentsBody");
  if (body) body.innerHTML = `<p class="muted" role="status">${isApprovalCourseRow(courseId) ? "수강 기록과 승인 요청을 불러오는 중..." : "수강 기록을 불러오는 중..."}</p>`;
  const enrollments = await loadCourseEnrollments(courseId);
  let weeks = null;
  try {
    const contentSnap = await getDoc(doc(db, isApprovalCourseRow(courseId) ? "coursePrivateContent" : "courses", courseId));
    if (contentSnap.exists() && Array.isArray(contentSnap.data()?.weeks)) weeks = contentSnap.data().weeks;
  } catch (error) {
    console.warn("[admin-courses] current course progress unavailable", courseId, error);
  }
  enrollments.forEach((enrollment) => {
    enrollment.progress = weeks
      ? getCurrentCourseCompletion(courseId, weeks, enrollment.watchedVideos).progress
      : null;
  });
  if (isApprovalCourseRow(courseId)) await loadApprovalRequests(courseId);
  activeEnrollmentRows = enrollments;
  renderEnrollmentModal(courseId, enrollments);
  return enrollments;
}

async function refreshAfterApprovalWrite(courseId) {
  try {
    await refreshCourseEnrollments(courseId);
  } catch (error) {
    console.error("[admin-courses] enrollment refresh after write failed:", error);
    const body = $("#courseEnrollmentsBody");
    if (body) body.innerHTML = '<div class="admin-courses-enrollment-empty">변경사항은 저장됐지만 목록을 다시 불러오지 못했습니다. <button type="button" class="btn sm" data-retry-enrollments="1">다시 불러오기</button></div>';
    toast("변경사항은 저장됐습니다. 목록을 다시 불러와 상태를 확인해 주세요.", true);
  }
}

function buildApprovedEnrollment(courseId, uid, learnerType, profile) {
  const base = {
    userId: uid,
    courseId,
    status: "active",
    learnerType,
    learnerSnapshot: {
      name: String(profile.name || ""),
      email: String(profile.email || ""),
      phone: String(profile.phone || ""),
      type: learnerType,
      school: learnerType === "student" ? String(profile.school || "") : null,
      grade: learnerType === "student" ? String(profile.grade || "") : null
    },
    updatedAt: serverTimestamp()
  };
  if (learnerType === "student") {
    base.studentSnapshot = {
      name: base.learnerSnapshot.name,
      email: base.learnerSnapshot.email,
      phone: base.learnerSnapshot.phone,
      school: base.learnerSnapshot.school,
      grade: base.learnerSnapshot.grade
    };
  }
  return base;
}

async function grantApprovalEnrollment(courseId, uid, learnerType, { requirePending = false } = {}) {
  const profileRef = doc(db, learnerType === "student" ? "students" : "members", uid);
  const enrollmentRef = doc(db, "enrollments", `${uid}_${courseId}`);
  const courseRef = doc(db, "courses", courseId);
  const requestRef = doc(db, "courses", courseId, "enrollmentRequests", uid);
  await runTransaction(db, async (transaction) => {
    const courseSnap = await transaction.get(courseRef);
    const profileSnap = await transaction.get(profileRef);
    const enrollmentSnap = await transaction.get(enrollmentRef);
    const requestSnap = await transaction.get(requestRef);
    if (!courseSnap.exists() || courseSnap.data().accessType !== "approvalRequired" || courseSnap.data().status !== "published") throw new Error("현재 승인형 게시 강좌가 아닙니다.");
    if (!profileSnap.exists()) throw new Error("신청 계정을 찾을 수 없습니다.");
    const profile = profileSnap.data() || {};
    if (learnerType === "member" && profile.memberPurpose !== "general") throw new Error("학부모 회원은 수강 등록 대상이 아닙니다.");
    if (requirePending && (!requestSnap.exists() || requestSnap.data().status !== "pending")) throw new Error("신청 상태가 변경됐습니다. 목록을 다시 확인해 주세요.");
    if (requestSnap.exists() && (requestSnap.data().userId !== uid || requestSnap.data().learnerType !== learnerType)) throw new Error("신청 계정을 확인해 주세요.");
    if (enrollmentSnap.exists() && (enrollmentSnap.data().userId !== uid || enrollmentSnap.data().courseId !== courseId)) throw new Error("기존 수강 기록을 확인해 주세요.");
    if (enrollmentSnap.exists() && String(enrollmentSnap.data().status || "active") === "active") {
      if (!requirePending) throw new Error("이미 수강 중인 계정입니다.");
      transaction.update(requestRef, { status: "approved", reviewedBy: auth.currentUser.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return;
    }
    const approved = buildApprovedEnrollment(courseId, uid, learnerType, profile);
    transaction.set(enrollmentRef, enrollmentSnap.exists() ? approved : { ...approved, progress: 0, createdAt: serverTimestamp() }, { merge: true });
    if (requestSnap.exists()) transaction.update(requestRef, { status: "approved", reviewedBy: auth.currentUser.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
}

async function reviewApprovalRequest(uid, decision) {
  const courseId = activeEnrollmentCourseId;
  const item = approvalRequestRows.find((row) => row.userId === uid);
  if (!courseId || !item || approvalActionInProgress) return;
  if (!window.confirm(`${item.profile?.name || uid}님의 수강신청을 ${decision === "approved" ? "승인" : "거절"}하시겠습니까?`)) return;
  approvalActionInProgress = true;
  try {
    const requestRef = doc(db, "courses", courseId, "enrollmentRequests", uid);
    if (decision === "approved") await grantApprovalEnrollment(courseId, uid, item.learnerType, { requirePending: true });
    else await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(requestRef);
      if (!snap.exists() || snap.data().status !== "pending") throw new Error("신청 상태가 변경됐습니다.");
      transaction.update(requestRef, { status: "rejected", reviewedBy: auth.currentUser.uid, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    toast(decision === "approved" ? "수강신청을 승인했습니다." : "수강신청을 거절했습니다.");
    await refreshAfterApprovalWrite(courseId);
  } catch (error) {
    toast(error.message || "신청을 처리하지 못했습니다.", true);
  } finally {
    approvalActionInProgress = false;
  }
}

async function manuallyEnrollApproval(courseId) {
  const [type, uid] = parseManualCandidateKey(manualEnrollmentSearch.selectedKey);
  const selected = getSelectedEnrollmentCandidate(manualEnrollmentSearch.results, type, uid);
  if (!selected) {
    manualEnrollmentSearch.status = "selection-error";
    manualEnrollmentSearch.message = "검색 결과에서 등록할 계정을 선택해 주세요.";
    updateManualEnrollmentSection();
    return;
  }
  if (approvalActionInProgress) return;
  approvalActionInProgress = true;
  try {
    if (!window.confirm(`${selected.name || selected.email || uid}님(${type === "student" ? "학생" : "일반회원"} · ${selected.email || uid})을 이 강좌에 등록하시겠습니까?`)) return;
    await grantApprovalEnrollment(courseId, uid, type);
    manualEnrollmentSearch.status = "success";
    manualEnrollmentSearch.selectedKey = "";
    manualEnrollmentSearch.message = "선택한 계정을 등록했습니다.";
    toast("수강생을 등록했습니다.");
    await refreshAfterApprovalWrite(courseId);
  } catch (error) {
    manualEnrollmentSearch.status = error.message?.includes("이미 수강") ? "duplicate" : "save-error";
    manualEnrollmentSearch.message = error.message || "수강생을 등록하지 못했습니다.";
    updateManualEnrollmentSection();
    toast(manualEnrollmentSearch.message, true);
  } finally {
    approvalActionInProgress = false;
  }
}

$("#courseEnrollmentsBody")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.approveRequest) await reviewApprovalRequest(button.dataset.approveRequest, "approved");
  if (button.dataset.rejectRequest) await reviewApprovalRequest(button.dataset.rejectRequest, "rejected");
  if (button.dataset.clearRequestSearch) {
    approvalRequestSearch = "";
    renderEnrollmentModal(activeEnrollmentCourseId, activeEnrollmentRows);
  }
  if (button.dataset.clearManualSearch) {
    manualEnrollmentSearchRequestId++;
    manualEnrollmentSearchTerm = "";
    manualEnrollmentSearch = { status: "idle", results: [], selectedKey: "", message: "", truncated: false };
    updateManualEnrollmentSection();
  }
  if (button.dataset.registerManual) await manuallyEnrollApproval(activeEnrollmentCourseId);
  if (button.dataset.retryEnrollments) await window.openCourseEnrollmentsModal(activeEnrollmentCourseId);
  if (button.dataset.moreRequests && !approvalActionInProgress && !approvalListInProgress) {
    const courseId = activeEnrollmentCourseId;
    approvalListInProgress = true;
    button.disabled = true;
    button.textContent = "불러오는 중...";
    try {
      await loadApprovalRequests(courseId, { append: true });
      renderEnrollmentModal(courseId, activeEnrollmentRows);
    } catch (_) {
      button.disabled = false;
      button.textContent = "신청 더 보기";
      toast("신청 목록을 더 불러오지 못했습니다.", true);
    } finally {
      approvalListInProgress = false;
    }
  }
});

$("#courseEnrollmentsBody")?.addEventListener("change", (event) => {
  if (event.target.name !== "manualApprovalCandidate") return;
  const [type, uid] = parseManualCandidateKey(event.target.value);
  const selected = getSelectedEnrollmentCandidate(manualEnrollmentSearch.results, type, uid);
  manualEnrollmentSearch.selectedKey = selected ? `${type}:${uid}` : "";
  manualEnrollmentSearch.message = selected ? `${selected.name || selected.email || "선택한 계정"}님을 선택했습니다.` : "";
  const register = $("#manualApprovalRegisterBtn");
  if (register) register.disabled = !selected;
});

$("#courseEnrollmentsBody")?.addEventListener("submit", (event) => {
  if (event.target.id === "approvalRequestSearchForm") {
    event.preventDefault();
    approvalRequestSearch = $("#approvalRequestSearch")?.value || "";
    renderEnrollmentModal(activeEnrollmentCourseId, activeEnrollmentRows);
    return;
  }
  if (event.target.id !== "manualApprovalSearchForm") return;
  event.preventDefault();
  searchManualEnrollment(activeEnrollmentCourseId, $("#manualApprovalSearchInput")?.value);
});

function renderGradeFilterSelect() {
  const gradeFilter = $("#adminFilterGrade");
  if (!gradeFilter) return;
  const current = gradeFilter.value || "all";
  gradeFilter.innerHTML =
    "<option value=\"all\">전체 학년</option>" +
    catalogGrades.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  gradeFilter.value = Array.from(gradeFilter.options).some((opt) => opt.value === current) ? current : "all";
}

function buildYearQuick(selectedYear = "") {
  const quick = $("#contentEditYearQuick");
  if (!quick) return;
  const years = withStringListFallback(catalogYears, selectedYear);
  quick.innerHTML = `<option value="">연도 선택</option>${years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("")}<option value="__custom__">직접 입력</option>`;
  if (quick.dataset.ready === "1") return;
  quick.dataset.ready = "1";
  quick.addEventListener("change", () => {
    const raw = $("#contentEditYear");
    if (!raw) return;
    if (quick.value === "__custom__") {
      raw.value = "";
      raw.focus();
    } else {
      raw.value = quick.value || "";
    }
  });
}

function buildGradeQuick(selectedGrade = "") {
  const quick = $("#contentEditGradeQuick");
  if (!quick) return;
  const grades = withStringListFallback(catalogGrades, selectedGrade);
  quick.innerHTML = `<option value="">학년 선택</option>${grades.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("")}<option value="__custom__">직접 입력</option>`;
  if (quick.dataset.ready === "1") return;
  quick.dataset.ready = "1";
  quick.addEventListener("change", () => {
    const raw = $("#contentEditGrade");
    if (!raw) return;
    if (quick.value === "__custom__") {
      raw.value = "";
      raw.focus();
    } else {
      raw.value = quick.value || "";
    }
  });
}

function renderInstructorSelect(selectedRecord = {}) {
  const el = $("#contentEditInstructorUid");
  if (!el) return;
  const list = Array.from(instructors.values()).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  const selectedValues = getInstructorSelectValues(selectedRecord);
  const choices = list.map((instructor) => ({
    uid: instructor.uid,
    name: instructor.name || instructor.uid,
    missing: false
  }));
  selectedValues.forEach((selectedValue, index) => {
    if (choices.some((choice) => choice.uid === selectedValue)) return;
    const fallbackName = selectedRecord.instructorNames?.[index] || selectedRecord.instructorName || selectedValue;
    choices.push({ uid: selectedValue, name: fallbackName, missing: true });
  });
  el.innerHTML = choices.length
    ? choices.map((choice) => `
      <label class="admin-multi-choice">
        <input type="checkbox" value="${escapeHtml(choice.uid)}" data-instructor-name="${escapeHtml(choice.name)}"${selectedValues.includes(choice.uid) ? " checked" : ""}>
        <span>${escapeHtml(choice.name)}${choice.missing ? " (등록 정보 없음)" : ""}</span>
      </label>`).join("")
    : '<p class="admin-multi-choice-empty">배정 가능한 강사가 없습니다.</p>';
}

function renderInstructorFilterSelect() {
  const el = instructorFilterEl;
  if (!el) return;
  const current = el.value || "all";
  const list = Array.from(instructors.values()).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  const html = list.map((x) => `<option value="${escapeHtml(x.uid)}">${escapeHtml(x.name || x.uid)}</option>`).join("");
  el.innerHTML = `<option value="all">전체 강사</option>${html}`;
  el.value = Array.from(el.options).some((opt) => opt.value === current) ? current : "all";
}

async function loadInstructors() {
  const map = new Map();
  try {
    const [snap, accountsSnap] = await Promise.all([
      getDocs(collection(db, "instructors")),
      getDocs(collection(db, "instructorAccounts"))
    ]);
    const accountUidByProfileId = accountUidByInstructorId(accountsSnap.docs);
    snap.docs.forEach((docSnap) => {
      const row = normalizeInstructorProfile(docSnap, accountUidByProfileId);
      if (row) map.set(row.uid, row);
    });
  } catch (_) {
  }
  instructors = map;
  renderInstructorFilterSelect();
}

function syncSingleVideoFromState() {
  const url = weeksState[0]?.videos?.[0]?.url || "";
  const el = $("#contentEditSingleVideoUrl");
  if (el) el.value = url;
}

function syncStateFromSingleVideo() {
  const url = $("#contentEditSingleVideoUrl")?.value.trim() || "";
  if (!weeksState[0]) {
    weeksState = [{ id: "week_1", title: "1주차", description: "", videos: [] }];
  }
  if (!weeksState[0].videos?.length) {
    weeksState[0].videos = [{ id: "video_1", title: "", url: "" }];
  }
  weeksState[0].videos[0] = { ...weeksState[0].videos[0], url };
}

function renderCurriculumPanels() {
  const format = normalizeCourseFormat($("#contentEditCourseFormat")?.value || "single", weeksState.length);
  const singlePanel = $("#contentEditCurriculumSingle");
  const seriesPanel = $("#contentEditCurriculumSeries");
  const addWeekBtn = $("#contentEditAddWeekBtn");
  const isSingle = format === "single";
  if (singlePanel) singlePanel.hidden = !isSingle;
  if (seriesPanel) seriesPanel.hidden = isSingle;
  if (addWeekBtn) addWeekBtn.style.display = isSingle ? "none" : "";
  if (isSingle) {
    syncSingleVideoFromState();
  } else {
    renderWeeks();
  }
  updateLivePreview();
}

function initWeeks(rawWeeks, courseFormat) {
  const format = normalizeCourseFormat(courseFormat, Array.isArray(rawWeeks) ? rawWeeks.length : 0);
  const editingCourseId = String($("#contentEditId")?.value || "").trim();
  const isApprovalCourse = normalizeAccessType($("#contentEditAccessType")?.value) === "approvalRequired";
  let weeks = normalizeCurriculumWeeks(rawWeeks).map((w, i) => ({
    id: w.id || `week_${i + 1}`,
    title: w.title || `${i + 1}주차`,
    description: w.description || w.content || "",
    videos: (Array.isArray(w.videos) ? w.videos : w.lessons || []).map((v, vi) => ({
      id: v.id || `video_${vi + 1}`,
      completionId: v.completionId || (editingCourseId
        ? `${editingCourseId}_week_${isApprovalCourse ? (rawWeeks[i]?.id || `week_${i}`) : w.id}_video_${vi}`
        : ""),
      title: v.title || "",
      url: typeof v === "string" ? v : (v.url || v.fullUrl || v.videoUrl || "")
    }))
  }));
  if (!weeks.length) weeks = [{ id: "week_1", title: "1주차", description: "", videos: [{ id: "video_1", title: "", url: "" }] }];
  if (format === "single") {
    const first = weeks[0] || { id: "week_1", title: "1주차", description: "", videos: [] };
    const firstVideo = (first.videos || []).find((v) => String(v.url || "").trim()) || first.videos?.[0] || { id: "video_1", title: "", url: "" };
    weeks = [{ ...first, videos: [firstVideo] }];
  }
  weeksState = weeks;
  if ($("#contentEditCourseFormat")) {
    $("#contentEditCourseFormat").value = format;
  }
  renderCurriculumPanels();
}

function renderWeeks() {
  const root = $("#contentEditWeeksList");
  const format = $("#contentEditCourseFormat")?.value || "single";
  if (!root) return;
  root.innerHTML = weeksState.map((w, wi) => `
    <div class="course-week-row" data-week-index="${wi}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>주차 ${wi + 1}</strong>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn sm" data-action="week-up" ${wi === 0 ? "disabled" : ""}>위로</button>
          <button type="button" class="btn sm" data-action="week-down" ${wi === weeksState.length - 1 ? "disabled" : ""}>아래로</button>
          <button type="button" class="btn sm danger" data-action="week-remove" ${normalizeCourseFormat(format, weeksState.length) === "single" ? "disabled" : ""}>삭제</button>
        </div>
      </div>
      <div class="form-group"><label>주차 제목</label><input data-week-field="title" value="${escapeHtml(w.title || "")}"></div>
      <div class="form-group"><label>주차 설명</label><textarea rows="2" data-week-field="description">${escapeHtml(w.description || "")}</textarea></div>
      <div class="form-group"><label>영상</label></div>
      ${(w.videos || []).map((v, vi) => `
        <div class="course-video-row" data-video-index="${vi}" style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
          <input data-video-field="title" placeholder="영상 제목 (선택)" value="${escapeHtml(v.title || "")}" style="margin-bottom:8px;">
          <input data-video-field="url" aria-label="영상 URL" placeholder="https://..." value="${escapeHtml(v.url || "")}">
          <div style="margin-top:8px;"><button type="button" class="btn sm danger" data-action="video-remove">영상 삭제</button></div>
        </div>
      `).join("")}
      <button type="button" class="btn sm" data-action="video-add">+ 영상 추가</button>
    </div>
  `).join("");
  updateLivePreview();
}

function collectWeeks() {
  const fmt = normalizeCourseFormat($("#contentEditCourseFormat")?.value || "single", weeksState.length);
  if (fmt === "single") syncStateFromSingleVideo();
  const mapped = weeksState.map((w, i) => ({
    id: w.id || `week_${i + 1}`,
    weekNumber: i + 1,
    title: String(w.title || `${i + 1}주차`).trim(),
    description: String(w.description || "").trim(),
    videos: (w.videos || []).map((v) => ({ id: v.id, completionId: v.completionId, title: String(v.title || "").trim(), url: String(v.url || "").trim() })).filter((v) => v.url)
  }));
  if (fmt === "single") {
    const first = mapped[0] || { id: "week_1", weekNumber: 1, title: "1주차", description: "", videos: [] };
    return [{ ...first, videos: (first.videos || []).filter((v) => v.url) }];
  }
  return mapped;
}

function bindWeeksEditor() {
  const root = $("#contentEditWeeksList");
  const addWeekBtn = $("#contentEditAddWeekBtn");
  const formatEl = $("#contentEditCourseFormat");
  const singleVideoEl = $("#contentEditSingleVideoUrl");
  if (singleVideoEl && singleVideoEl.dataset.bound !== "1") {
    singleVideoEl.dataset.bound = "1";
    singleVideoEl.addEventListener("input", () => {
      syncStateFromSingleVideo();
      updateLivePreview();
    });
  }
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const weekRow = btn.closest(".course-week-row");
    const wi = Number.parseInt(weekRow?.dataset.weekIndex || "", 10);
    const videoRow = btn.closest(".course-video-row");
    const vi = Number.parseInt(videoRow?.dataset.videoIndex || "", 10);
    if (!Number.isInteger(wi) || !weeksState[wi]) return;
    if (action === "week-up" && wi > 0) { const a = weeksState[wi - 1]; weeksState[wi - 1] = weeksState[wi]; weeksState[wi] = a; renderWeeks(); }
    if (action === "week-down" && wi < weeksState.length - 1) { const a = weeksState[wi + 1]; weeksState[wi + 1] = weeksState[wi]; weeksState[wi] = a; renderWeeks(); }
    if (action === "week-remove" && normalizeCourseFormat($("#contentEditCourseFormat")?.value, weeksState.length) === "series") {
      weeksState.splice(wi, 1);
      if (!weeksState.length) weeksState = [{ id: "week_1", title: "1주차", description: "", videos: [] }];
      renderWeeks();
    }
    if (action === "video-add") { weeksState[wi].videos = weeksState[wi].videos || []; const id = `video_${crypto.randomUUID()}`; weeksState[wi].videos.push({ id, completionId: id, title: "", url: "" }); renderWeeks(); }
    if (action === "video-remove" && Number.isInteger(vi)) { weeksState[wi].videos.splice(vi, 1); renderWeeks(); }
  });
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    const weekRow = t.closest(".course-week-row");
    const wi = Number.parseInt(weekRow?.dataset.weekIndex || "", 10);
    if (!Number.isInteger(wi) || !weeksState[wi]) return;
    if (t.dataset.weekField) weeksState[wi][t.dataset.weekField] = t.value || "";
    if (t.dataset.videoField) {
      const vi = Number.parseInt(t.closest(".course-video-row")?.dataset.videoIndex || "", 10);
      if (!Number.isInteger(vi) || !weeksState[wi].videos?.[vi]) return;
      weeksState[wi].videos[vi][t.dataset.videoField] = t.value || "";
      updateLivePreview();
    }
    if (t.dataset.weekField) updateLivePreview();
  });
  addWeekBtn?.addEventListener("click", () => {
    if (normalizeCourseFormat(formatEl?.value, weeksState.length) === "single") {
      return toast("특강형 강좌는 주차를 추가할 수 없습니다.", true);
    }
    weeksState.push({ id: `week_${Date.now()}`, title: `${weeksState.length + 1}주차`, description: "", videos: [] });
    renderWeeks();
  });
  formatEl?.addEventListener("change", () => {
    const format = normalizeCourseFormat(formatEl.value, weeksState.length);
    formatEl.value = format;
    if (format === "single") {
      weeksState = [weeksState[0] || { id: "week_1", title: "1주차", description: "", videos: [{ id: "video_1", title: "", url: "" }] }];
    } else if (!weeksState.length) {
      weeksState = [{ id: "week_1", title: "1주차", description: "", videos: [] }];
    }
    renderCurriculumPanels();
  });
}

function toRowHtml(item) {
  const created = item.createdAt?.toDate?.()?.toLocaleDateString("ko-KR") || "-";
  const subjectName = item.subjectLabel || item.subject || "-";
  const subjectColorStyle = getSubjectColorStyle(subjectName, subjectColorMap);
  return `<tr>
    <td><strong>${escapeHtml(item.title || "제목 없음")}</strong></td>
    <td><span class="admin-course-subject-badge${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>${escapeHtml(subjectName)}</span></td>
    <td>${escapeHtml(item.gradeLabel || item.grade || "-")}</td>
    <td>${escapeHtml(item.year || "-")}</td>
    <td>${escapeHtml(item.instructorName || "-")}</td>
    <td>${escapeHtml(getAdminAccessTypeLabel(item.accessType))}</td>
    <td>${escapeHtml(getAdminCourseFormatLabel(item.courseFormat, item))}</td>
    <td>${escapeHtml(getAdminCourseStatusLabel(item.status))}</td>
    <td>${escapeHtml(created)}</td>
    <td>
      <div class="admin-courses-action-row">
        <button class="btn sm" onclick="openEditContentModal('${escapeHtml(item.id)}')">수정</button>
        <button type="button" class="btn sm" data-course-preview="${escapeHtml(item.id).replace(/"/g, "&quot;")}">강좌 보기</button>
        <button class="btn sm" onclick="openCourseEnrollmentsModal('${escapeHtml(item.id)}')">수강생 확인</button>
        <button class="btn sm danger" onclick="deleteContent('${escapeHtml(item.id)}')">영구 삭제</button>
      </div>
    </td>
  </tr>`;
}

function applyFilters() {
  viewRows = rows.filter((r) => {
    if (filters.grade !== "all") {
      const gradeValue = String(r.grade || r.gradeCode || "").trim();
      const gradeLabel = String(r.gradeLabel || "").trim();
      const target = filters.grade;
      if (gradeValue !== target && gradeLabel !== target) return false;
    }
    if (filters.subject !== "all") {
      const subjectCode = String(r.subject || r.subjectCode || "").trim();
      if (subjectCode !== filters.subject) return false;
    }
    if (filters.status !== "all" && (r.status || "published") !== filters.status) return false;
    if (filters.courseFormat !== "all") {
      const format = normalizeCourseFormat(
        r.courseFormat,
        Array.isArray(r.curriculumWeeks) ? r.curriculumWeeks.length : (Array.isArray(r.weeks) ? r.weeks.length : 0)
      );
      if (format !== filters.courseFormat) return false;
    }
    if (filters.accessType !== "all") {
      if (normalizeAccessType(r.accessType) !== filters.accessType) return false;
    }
    if (filters.instructor !== "all") {
      const keys = getInstructorMatchKeys(filters.instructor);
      const rowInstructorKeys = [
        r.instructorUid,
        r.instructorId,
        ...(Array.isArray(r.instructorUids) ? r.instructorUids : []),
        ...(Array.isArray(r.instructorIds) ? r.instructorIds : [])
      ].map((value) => String(value || "").trim()).filter(Boolean);
      if (!rowInstructorKeys.some((value) => keys.has(value))) return false;
    }
    const q = filters.search.trim().toLowerCase();
    if (q && !String(r.title || "").toLowerCase().includes(q)) return false;
    return true;
  });
  page = 1;
  renderTable();
}

function setFilterSelectValue(el, value = "all") {
  if (!el) return;
  el.value = Array.from(el.options).some((opt) => opt.value === value) ? value : "all";
}

function resetCourseFilters() {
  filters.search = "";
  filters.grade = "all";
  filters.subject = "all";
  filters.status = "all";
  filters.courseFormat = "all";
  filters.accessType = "all";
  filters.instructor = "all";

  if (searchEl) searchEl.value = "";
  setFilterSelectValue(gradeFilterEl);
  setFilterSelectValue(subjectFilterEl);
  setFilterSelectValue(statusFilterEl);
  setFilterSelectValue(courseFormatFilterEl);
  setFilterSelectValue(accessTypeFilterEl);
  setFilterSelectValue(instructorFilterEl);
  applyFilters();
}

function setAdvancedFiltersOpen(isOpen) {
  if (!advancedFiltersEl || !advancedFilterToggleEl) return;
  advancedFiltersEl.hidden = !isOpen;
  advancedFilterToggleEl.setAttribute("aria-expanded", isOpen ? "true" : "false");
  advancedFilterToggleEl.textContent = isOpen ? "상세 필터 닫기" : "상세 필터";
}

function renderAdminPagination(totalPages, totalItems) {
  void totalPages;
  pageEl?.classList.add("is-visible");
  const state = renderListPagination(pageEl, {
    currentPage: page,
    itemLabel: "개",
    onPageChange: (nextPage) => {
      page = nextPage;
      renderTable();
    },
    pageSize,
    totalItems,
  });
  page = state.currentPage;
}

function renderTable() {
  setCourseExportReady();
  if (!tbody) return;
  if (!viewRows.length) {
    const emptyMessage = rows.length ? "조건에 맞는 강좌가 없습니다." : "등록된 강좌가 없습니다.";
    tbody.innerHTML = `<tr><td colspan="10" class="muted admin-table-empty">${emptyMessage}</td></tr>`;
    renderAdminPagination(1, 0);
    metaEl.textContent = emptyMessage;
    metaEl.hidden = false;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(viewRows.length / pageSize));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * pageSize;
  tbody.innerHTML = viewRows.slice(start, start + pageSize).map(toRowHtml).join("");
  metaEl.textContent = "";
  metaEl.hidden = true;
  renderAdminPagination(totalPages, viewRows.length);
}

async function loadRows() {
  coursesLoaded = false;
  setCourseExportReady();
  const snap = await getDocs(query(collection(db, "courses"), orderBy("createdAt", "desc")));
  const instructorsByUid = {};
  instructors.forEach((row) => {
    [row.uid, row.authUid, row.instructorId].filter(Boolean).forEach((key) => {
      instructorsByUid[key] = { name: row?.name || "" };
    });
  });
  rows = snap.docs.map((d) => normalizeCourseForReadOnly(
    { id: d.id, ...d.data() },
    { labelMaps, instructorsByUid }
  ));
  coursesLoaded = true;
  applyFilters();
}

window.openAddContentModal = function openAddContentModal() {
  $("#contentEditForm")?.reset();
  showCourseFormError("");
  $("#contentEditId").value = "";
  $("#contentEditStatus").value = "published";
  $("#contentEditCourseFormat").value = "single";
  setSelectValue($("#contentEditAccessType"), "public", "public");
  $("#contentEditAccessType").disabled = false;
  refreshCourseCatalogSelects("", "", "");
  renderInstructorSelect();
  initWeeks([], "single");
  updateLivePreview();
  $("#contentModalTitle").textContent = "강좌 추가";
  showCourseModal($("#contentEditModal"));
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
};

window.openEditContentModal = async function openEditContentModal(id) {
  showCourseFormError("");
  const snap = await getDoc(doc(db, "courses", id));
  if (!snap.exists()) return toast("강좌를 찾을 수 없습니다.", true);
  const rawCourse = snap.data() || {};
  if (normalizeAccessType(rawCourse.accessType) === "approvalRequired") {
    const protectedSnap = await getDoc(doc(db, "coursePrivateContent", id));
    if (!protectedSnap.exists()) return toast("보호된 강좌 영상을 찾을 수 없어 편집을 중단했습니다.", true);
    const protectedData = protectedSnap.data() || {};
    rawCourse.weeks = protectedData.weeks || [];
    rawCourse.previewVideoUrl = protectedData.previewVideoUrl || "";
  }
  const c = normalizeCourseForReadOnly({ id: snap.id, ...rawCourse }, { labelMaps });
  $("#contentEditId").value = id;
  $("#contentEditTitle").value = c.title || "";
  $("#contentEditShortDescription").value = c.shortDescription || "";
  $("#contentEditDescription").value = c.fullDescription || "";
  refreshCourseCatalogSelects(c.subject || "", c.grade || "", c.year || "");
  $("#contentEditGrade").value = c.grade || "";
  $("#contentEditYear").value = c.year || "";
  $("#contentEditPreviewVideoUrl").value = c.previewVideoUrl || "";
  setSelectValue($("#contentEditStatus"), normalizeCourseStatusForSave(c.status), "published");
  setSelectValue($("#contentEditAccessType"), normalizeAccessType(c.accessType), "public");
  $("#contentEditAccessType").disabled = true;
  renderInstructorSelect(rawCourse);
  initWeeks(Array.isArray(rawCourse.weeks) && rawCourse.weeks.length ? rawCourse.weeks : (c.weeks || c.curriculumWeeks || []), c.courseFormat || "single");
  updateLivePreview();
  $("#contentModalTitle").textContent = "강좌 수정";
  showCourseModal($("#contentEditModal"));
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
};

window.closeContentModal = function closeContentModal() {
  hideCourseModal($("#contentEditModal"));
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
};

function renderAdminCourseVideo(video, title) {
  const info = normalizeVideoUrl(video.url);
  if (!info) return '<p class="muted">영상 주소를 확인할 수 없습니다.</p>';
  if (info.type === "mp4") {
    return `<video controls preload="metadata" src="${escapeHtml(info.url)}" aria-label="${escapeHtml(title)}"></video>`;
  }
  return `<iframe src="${escapeHtml(info.embedUrl)}" title="${escapeHtml(title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe><a href="${escapeHtml(info.watchUrl)}" target="_blank" rel="noopener noreferrer">YouTube에서 보기</a>`;
}

window.openAdminCoursePreview = async function openAdminCoursePreview(courseId) {
  const requestId = ++adminCoursePreviewRequestId;
  const body = $("#adminCoursePreviewBody");
  const title = $("#adminCoursePreviewTitle");
  const note = $("#adminCoursePreviewNote");
  if (!body || !title || !note) return;
  try {
    await requireRole("admin", "/members/login.html");
  } catch (_) {
    return;
  }
  if (requestId !== adminCoursePreviewRequestId) return;
  title.textContent = "강좌 보기";
  note.textContent = "학습 진도와 수강 기록을 변경하지 않는 관리자 보기입니다.";
  body.innerHTML = '<p class="muted" role="status">강좌 영상을 불러오는 중...</p>';
  openSupportModal("adminCoursePreviewModal");
  try {
    const snap = await getDoc(doc(db, "courses", courseId));
    if (!snap.exists()) throw new Error("강좌를 찾을 수 없습니다.");
    const raw = snap.data() || {};
    if (normalizeAccessType(raw.accessType) === "approvalRequired") {
      const protectedSnap = await getDoc(doc(db, "coursePrivateContent", courseId));
      if (!protectedSnap.exists()) throw new Error("보호된 강좌 영상을 찾을 수 없습니다.");
      raw.weeks = protectedSnap.data()?.weeks || [];
    }
    const course = normalizeCourseForReadOnly({ id: snap.id, ...raw }, { labelMaps });
    if (requestId !== adminCoursePreviewRequestId) return;
    title.textContent = course.title || "강좌 보기";
    note.textContent = `${getAdminAccessTypeLabel(course.accessType)} · ${getAdminCourseStatusLabel(course.status)} · 관리자 읽기 전용`;
    const weeks = course.curriculumWeeks || [];
    body.innerHTML = weeks.length
      ? weeks.map((week) => `<section class="admin-course-preview-week"><h3>${escapeHtml(week.title)}</h3>${(week.videos || []).map((video) => `<div class="admin-course-preview-video"><h4>${escapeHtml(video.title || "강좌 영상")}</h4>${renderAdminCourseVideo(video, video.title || "강좌 영상")}</div>`).join("") || '<p class="muted">등록된 영상이 없습니다.</p>'}</section>`).join("")
      : '<p class="muted">등록된 학습 영상이 없습니다.</p>';
  } catch (error) {
    if (requestId !== adminCoursePreviewRequestId) return;
    console.error("[admin-courses] preview failed", error);
    body.innerHTML = `<p role="alert">${escapeHtml(error.message || "강좌 영상을 불러오지 못했습니다.")}</p>`;
  }
};

window.closeAdminCoursePreview = function closeAdminCoursePreview() {
  adminCoursePreviewRequestId++;
  closeSupportModal("adminCoursePreviewModal");
  const body = $("#adminCoursePreviewBody");
  if (body) body.innerHTML = "";
};

window.openCourseEnrollmentsModal = async function openCourseEnrollmentsModal(courseId) {
  activeEnrollmentCourseId = courseId;
  approvalRequestSearch = "";
  manualEnrollmentSearchRequestId++;
  manualEnrollmentSearchTerm = "";
  manualEnrollmentSearch = { status: "idle", results: [], selectedKey: "", message: "", truncated: false };
  const title = $("#courseEnrollmentsTitle");
  const subtitle = $("#courseEnrollmentsSubtitle");
  const body = $("#courseEnrollmentsBody");
  if (title) title.textContent = "수강생 확인";
  if (subtitle) subtitle.textContent = `${getCourseTitle(courseId)} / 불러오는 중`;
  if (body) body.innerHTML = '<p class="muted" role="status">수강 기록을 불러오는 중...</p>';
  openSupportModal("courseEnrollmentsModal");

  try {
    await refreshCourseEnrollments(courseId);
  } catch (error) {
    console.error("[admin-courses] enrollment list load failed:", error);
    if (body) {
      body.innerHTML = '<div class="admin-courses-enrollment-empty">수강 기록 또는 승인 요청을 불러오지 못했습니다. <button type="button" class="btn sm" data-retry-enrollments="1">다시 시도</button></div>';
    }
    toast("수강 기록을 불러오지 못했습니다.", true);
  }
};

window.closeCourseEnrollmentsModal = function closeCourseEnrollmentsModal() {
  manualEnrollmentSearchRequestId++;
  activeEnrollmentCourseId = "";
  activeEnrollmentRows = [];
  closeSupportModal("courseEnrollmentsModal");
};

function removeEnrollmentRecord(enrollmentId) {
  if (!activeEnrollmentCourseId || !enrollmentId) return;
  const enrollment = activeEnrollmentRows.find((row) => row.id === enrollmentId) || { id: enrollmentId };
  enrollmentRemovalState = {
    courseId: activeEnrollmentCourseId,
    enrollment
  };

  const subtitle = $("#enrollmentRemoveConfirmSubtitle");
  const body = $("#enrollmentRemoveConfirmBody");
  if (subtitle) {
    subtitle.textContent = `${getCourseTitle(activeEnrollmentCourseId)} / ${enrollment.learnerName || "선택한 수강생"}`;
  }
  if (body) {
    body.innerHTML = `
      <div class="admin-courses-warning-box">
        <strong>${escapeHtml(enrollment.learnerName || "선택한 수강생")}의 ${isApprovalCourseRow(activeEnrollmentCourseId) ? "수강을 해제합니다." : "수강 기록을 제거합니다."}</strong>
        <p style="margin:6px 0 0;">${isApprovalCourseRow(activeEnrollmentCourseId) ? "학습 접근을 차단하고 완료 기록은 보존합니다." : "이 작업은 이 강좌의 수강 기록만 제거합니다."}</p>
        <p style="margin:4px 0 0;">학생/회원 계정은 삭제하지 않습니다.</p>
        <p style="margin:4px 0 0;">강좌도 삭제하지 않습니다.</p>
      </div>
    `;
  }
  openSupportModal("enrollmentRemoveConfirmModal");
}

window.closeEnrollmentRemoveConfirmModal = function closeEnrollmentRemoveConfirmModal() {
  enrollmentRemovalState = { courseId: "", enrollment: null };
  closeSupportModal("enrollmentRemoveConfirmModal");
};

window.confirmEnrollmentRemoval = async function confirmEnrollmentRemoval() {
  const { courseId, enrollment } = enrollmentRemovalState;
  const enrollmentId = enrollment?.id || "";
  if (!courseId || !enrollmentId) return;

  try {
    if (isApprovalCourseRow(courseId)) {
      await updateDoc(doc(db, "enrollments", enrollmentId), { status: "revoked", updatedAt: serverTimestamp() });
      toast("수강을 해제하고 기존 진도를 보존했습니다.");
    } else {
      await deleteDoc(doc(db, "enrollments", enrollmentId));
      toast("수강 기록을 제거했습니다.");
    }
    window.closeEnrollmentRemoveConfirmModal();
    await refreshCourseEnrollments(courseId);
    await loadRows();
  } catch (error) {
    console.error("[admin-courses] enrollment delete failed:", error);
    toast("수강 기록 제거 중 오류가 발생했습니다.", true);
  }
};

$("#courseEnrollmentsBody")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-enrollment]");
  if (!button) return;
  removeEnrollmentRecord(button.dataset.removeEnrollment || "");
});

function renderDeleteBlockedModal(courseId, inventory) {
  const enrollments = inventory.enrollments;
  const body = $("#courseDeleteBlockedBody");
  const subtitle = $("#courseDeleteBlockedSubtitle");
  if (subtitle) {
    subtitle.textContent = `${getCourseTitle(courseId)} / 수강 기록 ${enrollments.length}개`;
  }
  if (!body) return;
  body.innerHTML = `
    <div class="admin-courses-warning-box">
      <strong>기본 삭제는 차단되었습니다.</strong>
      <p style="margin:6px 0 0;">이 강좌에는 수강 기록이 있습니다. 일반 운영에서는 <strong>보관으로 전환</strong>을 권장합니다.</p>
      <p style="margin:4px 0 0;">영구 삭제 시 강좌, 보호 영상 ${Number(inventory.hasPrivateContent)}개, 신청 기록 ${inventory.requests.length}개, 수강·진도 기록 ${enrollments.length}개를 함께 삭제합니다. 학생/회원/강사 계정과 오프라인 반 데이터는 삭제하지 않습니다.</p>
    </div>
    <div class="admin-courses-enrollment-summary">
      <strong>영향 받는 수강 기록 미리보기</strong>
      <span class="admin-courses-enrollment-count">${enrollments.length}개</span>
    </div>
    ${renderEnrollmentTable(enrollments, { showActions: false })}
  `;
}

function openDeleteBlockedModal(courseId, inventory) {
  deleteBlockedState = {
    courseId,
    course: getCourseRow(courseId),
    enrollments: inventory.enrollments,
    inventory
  };
  renderDeleteBlockedModal(courseId, inventory);
  openSupportModal("courseDeleteBlockedModal");
}

window.closeCourseDeleteBlockedModal = function closeCourseDeleteBlockedModal() {
  deleteBlockedState = { courseId: "", course: null, enrollments: [], inventory: null };
  closeSupportModal("courseDeleteBlockedModal");
};

window.openEnrollmentsFromDeleteBlocked = function openEnrollmentsFromDeleteBlocked() {
  const courseId = deleteBlockedState.courseId;
  if (!courseId) return;
  window.closeCourseDeleteBlockedModal();
  window.openCourseEnrollmentsModal(courseId);
};

window.archiveCourseFromDeleteBlocked = async function archiveCourseFromDeleteBlocked() {
  const courseId = deleteBlockedState.courseId;
  if (!courseId) return;

  try {
    await updateDoc(doc(db, "courses", courseId), {
      status: "archived",
      updatedAt: serverTimestamp()
    });
    toast("강좌를 보관 / 일시 차단으로 전환했습니다.");
    window.closeCourseDeleteBlockedModal();
    await loadRows();
  } catch (error) {
    console.error("[admin-courses] course archive failed:", error);
    toast("보관 전환 중 오류가 발생했습니다.", true);
  }
};

function renderForceDeleteModal(courseId, inventory) {
  const enrollments = inventory.enrollments;
  const subtitle = $("#courseForceDeleteSubtitle");
  const body = $("#courseForceDeleteBody");
  if (subtitle) {
    subtitle.textContent = `${getCourseTitle(courseId)} / 수강 기록 ${enrollments.length}개`;
  }
  if (!body) return;
  body.innerHTML = `
    <div class="admin-courses-danger-box">
      <strong>위험 작업입니다.</strong>
      <p style="margin:6px 0 0;">강좌, 보호 영상 ${Number(inventory.hasPrivateContent)}개, 신청 기록 ${inventory.requests.length}개와 수강·진도 기록 ${enrollments.length}개를 함께 영구 삭제합니다.</p>
      <p style="margin:4px 0 0;">삭제 직전에 수강 기록을 다시 확인합니다.</p>
    </div>
    <div class="admin-courses-delete-list">
      <div class="admin-courses-delete-list__box">
        <strong>삭제되는 항목</strong>
        <ul>
          <li>이 강좌 문서</li>
          <li>이 강좌의 수강 기록</li>
          <li>이 강좌의 보호 영상 및 신청 기록</li>
        </ul>
      </div>
      <div class="admin-courses-delete-list__box">
        <strong>삭제하지 않는 항목</strong>
        <ul>
          <li>학생 계정</li>
          <li>회원 계정</li>
          <li>강사 계정</li>
          <li>오프라인 반 데이터</li>
        </ul>
      </div>
    </div>
    <div class="admin-courses-enrollment-summary">
      <strong>영향 받는 수강 기록 미리보기</strong>
      <span class="admin-courses-enrollment-count">${enrollments.length}개</span>
    </div>
    ${renderEnrollmentTable(enrollments, { showActions: false })}
    <div style="margin-top:14px;">
      <label class="admin-courses-confirm-label" for="courseForceDeleteConfirmInput">확인 문구 입력</label>
      <input id="courseForceDeleteConfirmInput" class="admin-courses-confirm-input" type="text" autocomplete="off" placeholder="${escapeHtml(FORCE_DELETE_CONFIRM_PHRASE)}">
      <p class="muted admin-courses-modal-note">삭제하려면 <strong>${escapeHtml(FORCE_DELETE_CONFIRM_PHRASE)}</strong>를 정확히 입력하세요.</p>
      <p id="courseForceDeleteFeedback" class="admin-courses-modal-note" role="status" aria-live="polite" hidden></p>
    </div>
  `;
}

async function deleteCourseWithEnrollments(courseId, inventory) {
  const latest = await loadCourseDeleteInventory(courseId);
  if (deleteInventoryKey(latest) !== deleteInventoryKey(inventory)) {
    throw new Error("삭제 대상이 변경됐습니다. 삭제 화면을 닫고 다시 확인해 주세요.");
  }
  const batch = writeBatch(db);
  for (const enrollment of latest.enrollments) {
    batch.delete(doc(db, "enrollments", enrollment.id));
  }
  for (const requestId of latest.requests) batch.delete(doc(db, "courses", courseId, "enrollmentRequests", requestId));
  if (latest.hasPrivateContent) batch.delete(doc(db, "coursePrivateContent", courseId));
  batch.delete(doc(db, "courses", courseId));
  await batch.commit();
}

window.forceDeleteCourseFromDeleteBlocked = async function forceDeleteCourseFromDeleteBlocked() {
  const { courseId, inventory } = deleteBlockedState;
  if (!courseId || !inventory?.enrollments.length) return;
  renderForceDeleteModal(courseId, inventory);
  openSupportModal("courseForceDeleteModal");
  focusModalInput("#courseForceDeleteConfirmInput");
};

window.closeCourseForceDeleteModal = function closeCourseForceDeleteModal() {
  closeSupportModal("courseForceDeleteModal");
};

window.confirmForceCourseDelete = async function confirmForceCourseDelete() {
  const { courseId } = deleteBlockedState;
  if (!courseId) return;
  const phrase = $("#courseForceDeleteConfirmInput")?.value.trim() || "";
  if (phrase !== FORCE_DELETE_CONFIRM_PHRASE) {
    const message = "확인 문구가 일치하지 않습니다.";
    setCourseDeleteFeedback("#courseForceDeleteFeedback", message);
    toast(message, true);
    return;
  }

  let deleted = false;
  try {
    await deleteCourseWithEnrollments(courseId, deleteBlockedState.inventory);
    deleted = true;
    window.closeCourseForceDeleteModal();
    window.closeCourseDeleteBlockedModal();
    await loadRows();
    toast("강좌와 관련 기록을 삭제했습니다.");
  } catch (error) {
    console.error("[admin-courses] force course delete failed:", error);
    const message = deleted ? "강좌는 삭제됐지만 목록을 새로고침하지 못했습니다. 페이지를 새로고침해 확인해 주세요." : (error.message || "강좌 영구 삭제 중 오류가 발생했습니다.");
    setCourseDeleteFeedback("#courseForceDeleteFeedback", message);
    toast(message, true);
  }
};

function openNoEnrollmentDeleteModal(courseId, inventory) {
  noEnrollmentDeleteState = {
    courseId,
    course: getCourseRow(courseId),
    inventory
  };
  const impact = $("#courseDeleteEmptyImpact");
  if (impact) impact.textContent = `강좌, 보호 영상 ${Number(inventory.hasPrivateContent)}개, 신청 기록 ${inventory.requests.length}개를 삭제합니다. 현재 수강·진도 기록은 없습니다.`;
  const subtitle = $("#courseDeleteEmptySubtitle");
  const input = $("#courseDeleteEmptyConfirmInput");
  if (subtitle) {
    subtitle.textContent = getCourseTitle(courseId);
  }
  if (input) input.value = "";
  setCourseDeleteFeedback("#courseDeleteEmptyFeedback", "");
  openSupportModal("courseDeleteEmptyModal");
  focusModalInput("#courseDeleteEmptyConfirmInput");
}

window.closeCourseDeleteEmptyModal = function closeCourseDeleteEmptyModal() {
  noEnrollmentDeleteState = { courseId: "", course: null, inventory: null };
  closeSupportModal("courseDeleteEmptyModal");
};

window.confirmNoEnrollmentCourseDelete = async function confirmNoEnrollmentCourseDelete() {
  const courseId = noEnrollmentDeleteState.courseId;
  if (!courseId) return;
  const phrase = $("#courseDeleteEmptyConfirmInput")?.value.trim() || "";
  if (phrase !== COURSE_DELETE_CONFIRM_PHRASE) {
    const message = "확인 문구가 일치하지 않습니다.";
    setCourseDeleteFeedback("#courseDeleteEmptyFeedback", message);
    toast(message, true);
    return;
  }

  let deleted = false;
  try {
    await deleteCourseWithEnrollments(courseId, noEnrollmentDeleteState.inventory);
    deleted = true;
    window.closeCourseDeleteEmptyModal();
    await loadRows();
    toast("강좌를 영구 삭제했습니다.");
  } catch (error) {
    console.error("[admin-courses] course delete failed:", error);
    const message = deleted ? "강좌는 삭제됐지만 목록을 새로고침하지 못했습니다. 페이지를 새로고침해 확인해 주세요." : (error.message || "강좌 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    setCourseDeleteFeedback("#courseDeleteEmptyFeedback", message);
    toast(message, true);
  }
};

window.deleteContent = async function deleteContent(id) {
  let inventory;
  try {
    inventory = await loadCourseDeleteInventory(id);
  } catch (error) {
    console.error("[admin-courses] enrollment check failed before delete:", error);
    toast(error.message || "삭제 대상 확인 중 오류가 발생했습니다.", true);
    return;
  }

  if (inventory.enrollments.length > 0) {
    openDeleteBlockedModal(id, inventory);
    return;
  }

  openNoEnrollmentDeleteModal(id, inventory);
};

let courseSaveInProgress = false;
$("#contentEditForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (courseSaveInProgress) return;
  showCourseFormError("");
  const id = $("#contentEditId").value.trim();
  const title = $("#contentEditTitle").value.trim();
  const subject = resolveSubjectFromForm();
  if (!title || !subject) return toast("강좌명과 과목은 필수입니다.", true);
  if (isReservedCatalogValue(subject)) {
    return toast("전체, 선택, 직접 입력은 과목으로 저장할 수 없습니다.", true);
  }

  const weeks = collectWeeks();
  const previewVideoUrl = $("#contentEditPreviewVideoUrl").value.trim();
  if (previewVideoUrl && !normalizeVideoUrl(previewVideoUrl)) {
    showCourseFormError("미리보기 영상 또는 재생목록 주소를 확인해 주세요.", $("#contentEditPreviewVideoUrl"));
    return toast("미리보기 영상 URL 형식이 올바르지 않습니다.", true);
  }
  for (const [weekIndex, w] of weeks.entries()) {
    for (const [videoIndex, v] of (w.videos || []).entries()) {
      if (!v.url) continue;
      if (!normalizeVideoUrl(v.url)) {
        const field = $("#contentEditCourseFormat")?.value === "single"
          ? $("#contentEditSingleVideoUrl")
          : $(`#contentEditWeeksList [data-week-index="${weekIndex}"] [data-video-index="${videoIndex}"] [data-video-field="url"]`);
        showCourseFormError("영상 또는 재생목록 주소를 확인해 주세요. YouTube 공유 URL이나 MP4 주소를 입력할 수 있습니다.", field);
        return toast("영상 또는 재생목록 주소를 확인해 주세요.", true);
      }
    }
  }

  courseSaveInProgress = true;
  const saveButton = $("#contentEditSaveBtn");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "저장 중...";
  }
  let saved = false;
  try {
  const existingSnap = id ? await getDoc(doc(db, "courses", id)) : null;
  if (id && !existingSnap.exists()) throw new Error("강좌를 찾을 수 없습니다.");
  const existingCourse = existingSnap?.data() || {};
  const {
    instructorUid,
    instructorId,
    instructorName,
    instructorUids,
    instructorIds,
    instructorNames
  } = getSelectedInstructors();
  const selectedAccess = $("#contentEditAccessType")?.value || existingCourse.accessType || "public";
  const accessType = id ? (existingCourse.accessType || "public") : normalizeAccessType(selectedAccess);
  if (id && normalizeAccessType(selectedAccess) !== normalizeAccessType(existingCourse.accessType)) {
    throw new Error("기존 강좌의 수강 유형은 변경할 수 없습니다. 제목과 영상 등 다른 항목은 수정할 수 있습니다.");
  }
  const statusRaw = String($("#contentEditStatus")?.value || existingCourse.status || "published").trim();
  const status = normalizeCourseStatusForSave(statusRaw);
  const visibility = resolveVisibilityForSave(existingCourse, status);
  const courseFormat = normalizeCourseFormat($("#contentEditCourseFormat")?.value || "single", weeks.length);

  const payload = buildCanonicalCoursePayload({
    title,
    shortDescription: $("#contentEditShortDescription").value.trim(),
    description: $("#contentEditDescription").value.trim(),
    subject,
    instructorUid,
    instructorId,
    instructorName,
    instructorUids,
    instructorIds,
    instructorNames,
    grade: $("#contentEditGrade").value.trim(),
    year: $("#contentEditYear").value.trim(),
    previewVideoUrl,
    courseFormat,
    weeks,
    status
  }, { existingCourse });

  const savePayload = {
    ...payload,
    accessType,
    visibility,
    status,
    courseFormat
  };
  delete savePayload.lectureContent;

  if (id && Object.prototype.hasOwnProperty.call(existingCourse, "detailSections")) {
    savePayload.detailSections = existingCourse.detailSections;
  }

   if (accessType === "approvalRequired") {
     const courseRef = id ? doc(db, "courses", id) : doc(collection(db, "courses"));
     const privateRef = doc(db, "coursePrivateContent", courseRef.id);
     const batch = writeBatch(db);
     const publicPayload = {
       ...toApprovalPublicCourse(savePayload),
       updatedAt: serverTimestamp(),
       ...(id ? legacyRemove : {})
     };
     if (id) batch.update(courseRef, publicPayload);
     else batch.set(courseRef, { ...publicPayload, createdAt: serverTimestamp() });
     batch.set(privateRef, { weeks: savePayload.weeks, previewVideoUrl: savePayload.previewVideoUrl || null, updatedAt: serverTimestamp() });
     await batch.commit();
     saved = true;
   } else if (id) {
     await updateDoc(doc(db, "courses", id), { ...savePayload, updatedAt: serverTimestamp(), ...legacyRemove });
    saved = true;
  } else {
    await addDoc(collection(db, "courses"), { ...savePayload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    saved = true;
  }
  window.closeContentModal(true);
  await loadRows();
  toast(id ? "강좌 정보를 저장했습니다." : "강좌를 등록했습니다.");
  } catch (error) {
    console.error("[admin-courses] course save failed:", error);
    toast(saved
      ? "강좌는 저장됐지만 목록을 새로고침하지 못했습니다. 새로고침해 확인해 주세요."
      : (error.message?.includes("수강 유형은 변경") ? error.message : "강좌를 저장하지 못했습니다. 다시 시도해 주세요."), true);
  } finally {
    courseSaveInProgress = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "저장";
    }
  }
});

bindCommittedSearch(searchEl, $("#adminCourseSearchButton"), (keyword) => {
  filters.search = keyword;
  applyFilters();
});

let courseExportPending = false;
$("#dlCourses")?.addEventListener("click", async () => {
  if (courseExportPending) return;
  if (!coursesLoaded) return toast("강좌 목록을 먼저 불러와 주세요.", true);
  if (!viewRows.length) return toast(rows.length ? "필터 결과에 강좌가 없습니다." : "등록된 강좌가 없습니다.", true);
  courseExportPending = true;
  try {
    const exportRows = viewRows.map((course) => {
      const weeks = course.accessType === "approvalRequired"
        ? null
        : (course.weeks || []);
      return {
        강좌명: course.title || "",
        과목: course.subjectLabel || course.subject || "",
        학년: course.gradeLabel || course.grade || "",
        연도: course.year || "",
        강사: course.instructorName || "",
        수강유형: getAdminAccessTypeLabel(course.accessType),
        형식: getAdminCourseFormatLabel(course.courseFormat, course),
        "운영 상태": getAdminCourseStatusLabel(course.status),
        "주차 수": weeks ? weeks.length : "",
        "영상 수": weeks ? weeks.reduce((sum, week) => sum + (week.videos || []).length, 0) : "",
        "콘텐츠 집계": weeks ? "강좌 문서" : "보호 콘텐츠 제외",
        등록일: course.createdAt?.toDate?.()?.toLocaleDateString("ko-KR") || "",
      };
    });
    const filtered = Object.values(filters).some((value) => value && value !== "all");
    const done = await writeAdminXlsx(XLSX, {
      rows: exportRows, sheetName: "강좌", button: $("#dlCourses"),
      filename: adminXlsxFilename("강좌목록", exportRows.length, filtered ? "필터결과" : "전체"),
    });
    if (done) toast(`강좌 ${exportRows.length}개 엑셀 파일을 다운로드했습니다.`);
  } catch (error) {
    console.error("[admin-courses] export failed", error);
    toast(`엑셀 다운로드에 실패했습니다. ${error.message || "다시 시도해 주세요."}`, true);
  } finally {
    courseExportPending = false;
  }
});
$("#adminCoursesPageSize")?.addEventListener("change", (event) => {
  pageSize = normalizeListPageSize(event.target.value);
  page = 1;
  renderTable();
});
tbody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-course-preview]");
  if (button) window.openAdminCoursePreview(button.getAttribute("data-course-preview"));
});
gradeFilterEl?.addEventListener("change", () => { filters.grade = gradeFilterEl.value || "all"; applyFilters(); });
subjectFilterEl?.addEventListener("change", () => { filters.subject = subjectFilterEl.value || "all"; applyFilters(); });
statusFilterEl?.addEventListener("change", () => { filters.status = statusFilterEl.value || "all"; applyFilters(); });
courseFormatFilterEl?.addEventListener("change", () => { filters.courseFormat = courseFormatFilterEl.value || "all"; applyFilters(); });
accessTypeFilterEl?.addEventListener("change", () => { filters.accessType = accessTypeFilterEl.value || "all"; applyFilters(); });
instructorFilterEl?.addEventListener("change", () => { filters.instructor = instructorFilterEl.value || "all"; applyFilters(); });
advancedFilterToggleEl?.addEventListener("click", () => {
  setAdvancedFiltersOpen(advancedFiltersEl?.hidden !== false);
});
filterResetEl?.addEventListener("click", resetCourseFilters);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#adminCoursePreviewModal")?.classList.contains("is-open")) return window.closeAdminCoursePreview();
    if ($("#courseForceDeleteModal")?.classList.contains("is-open")) return window.closeCourseForceDeleteModal();
    if ($("#courseDeleteEmptyModal")?.classList.contains("is-open")) return window.closeCourseDeleteEmptyModal();
    if ($("#enrollmentRemoveConfirmModal")?.classList.contains("is-open")) return window.closeEnrollmentRemoveConfirmModal();
    if ($("#courseDeleteBlockedModal")?.classList.contains("is-open")) return window.closeCourseDeleteBlockedModal();
    if ($("#courseEnrollmentsModal")?.classList.contains("is-open")) return window.closeCourseEnrollmentsModal();
    if ($("#contentEditModal")?.classList.contains("is-open")) window.closeContentModal();
  }
  if (e.key === "Enter" && $("#courseDeleteEmptyModal")?.classList.contains("is-open")) {
    if (e.target === $("#courseDeleteEmptyConfirmInput")) window.confirmNoEnrollmentCourseDelete();
  }
  if (e.key === "Enter" && $("#courseForceDeleteModal")?.classList.contains("is-open")) {
    if (e.target === $("#courseForceDeleteConfirmInput")) window.confirmForceCourseDelete();
  }
});
document.addEventListener("input", (event) => {
  if (event.target === $("#courseDeleteEmptyConfirmInput")) {
    setCourseDeleteFeedback("#courseDeleteEmptyFeedback", "");
  }
  if (event.target === $("#courseForceDeleteConfirmInput")) {
    setCourseDeleteFeedback("#courseForceDeleteFeedback", "");
  }
});

async function initSelects() {
  const fallback = mergeCourseCatalog({});
  mergedCourseCatalog = fallback;
  await Promise.all([
    (async () => {
      try {
        const catalog = await getSettingDoc("courseCatalog");
        mergedCourseCatalog = mergeCourseCatalog(catalog.exists ? catalog.data : {});
        labelMaps = buildLabelMaps(mergedCourseCatalog);
      } catch (_) {
        labelMaps = buildLabelMaps(fallback);
        mergedCourseCatalog = fallback;
      }
    })(),
    (async () => {
      try {
        const colorResult = await getSettingDoc(SUBJECT_COLOR_SETTINGS_KEY);
        persistedCourseSubjectColorMap = colorResult.exists
          ? getSubjectColorMapFromSettings(colorResult.data)
          : {};
        subjectColorMap = Object.keys(persistedCourseSubjectColorMap).length
          ? mergeSubjectColorMap(persistedCourseSubjectColorMap)
          : await loadSharedSubjectColorMap(getSettingDoc);
        courseSubjectColorSourceMap = { ...subjectColorMap };
      } catch (_) {
        subjectColorMap = mergeSubjectColorMap({});
        courseSubjectColorSourceMap = { ...subjectColorMap };
      }
    })(),
  ]);

  catalogGrades = getCourseGradeLabels(mergedCourseCatalog);
  catalogCourseSubjects = getCourseSubjectOptions(mergedCourseCatalog);
  courseSubjectDraft = getCourseCatalogSubjectDraft(mergedCourseCatalog);
  courseGradeDraft = getCourseCatalogGradeDraft(mergedCourseCatalog).map((item) => item.label);
  courseYearDraft = getCourseCatalogYearDraft(mergedCourseCatalog).map((item) => item.label);
  renderCourseCatalogPanel();
  refreshCourseCatalogSelects();
}
resetCourseModalState();
window.addEventListener("pageshow", (event) => {
  if (event.persisted) resetCourseModalState();
});
(async () => {
  bindLivePreview();
  bindWeeksEditor();
  initWeeks([], "single");
  setupCourseCatalogPanel();
  await Promise.all([initSelects(), loadInstructors()]);
  await loadRows().catch((error) => {
    handleError(error, "관리자 강좌 목록 로드", { showToast: true, logError: true });
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10">${createErrorUI("강좌 목록을 불러오지 못했습니다.", { showReloadButton: false })}</td></tr>`;
    }
  });
})();
