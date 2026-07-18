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
  setDoc
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { handleError, createErrorUI } from "/assets/js/utils/error-handler.js";
import { confirmDiscardIfDirty, createFormDirtyTracker } from "/assets/js/utils/admin-dialog.js";
import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
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
  getAccessTypeBadgeLabel,
  getSubjectAccentClass,
  getSubjectLabel,
  getGradeLabel
} from "/assets/js/utils/course-readonly.js";

(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (_) {
  }
})();

const $ = (s, r = document) => r.querySelector(s);
const contentFormDirty = createFormDirtyTracker(document.querySelector("#contentEditForm"));
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
let page = 1;
let weeksState = [];
let activeEnrollmentCourseId = "";
let activeEnrollmentRows = [];
let deleteBlockedState = {
  courseId: "",
  course: null,
  enrollments: []
};
let noEnrollmentDeleteState = {
  courseId: "",
  course: null
};
let enrollmentRemovalState = {
  courseId: "",
  enrollment: null
};

const PAGE_SIZE = 20;
const PAGINATION_GROUP_SIZE = 5;
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
  const editor = $("#courseCatalogSubjectEditor");
  if (editor) {
    editor.innerHTML = courseSubjectDraft
      .map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === courseSubjectDraft.length - 1;
        return `
      <div class="admin-catalog-tag course-catalog-subject-row">
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

  if (quick.dataset.ready === "1") return;
  quick.dataset.ready = "1";
  quick.addEventListener("change", () => {
    syncCourseSubjectCustomField(quick, raw);
    if (quick.value === "__custom__") {
      raw.value = "";
      raw.focus();
    }
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
    const settingsSnap = await getDoc(settingsRef);
    const existing = settingsSnap.exists() ? settingsSnap.data() : {};
    const uid = auth.currentUser?.uid || "";
    await setDoc(
      settingsRef,
      {
        ...existing,
        chipGroups: mergedCourseCatalog.chipGroups,
        updatedAt: serverTimestamp(),
        ...(uid ? { updatedBy: uid } : {})
      },
      { merge: true }
    );
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
  if (raw === "public") return "공개 강좌";
  if (raw === "memberOnly") return "회원전용 강좌";
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

function normalizeInstructorProfile(docSnap) {
  const data = docSnap.data() || {};
  const instructorId = String(docSnap.id || "").trim();
  const authUid = typeof data.uid === "string" ? data.uid.trim() : "";
  const name = String(data.name || data.displayName || "").trim();
  if (!instructorId || !authUid || !name) return null;
  return {
    uid: authUid,
    authUid,
    instructorId,
    name
  };
}

function findInstructorForRecord(record = {}) {
  const instructorUid = String(record.instructorUid || "").trim();
  if (instructorUid && instructors.has(instructorUid)) return instructors.get(instructorUid);

  const instructorId = String(record.instructorId || "").trim();
  if (instructorId) {
    const byProfileId = Array.from(instructors.values()).find((inst) => inst.instructorId === instructorId);
    if (byProfileId) return byProfileId;
  }

  if (instructorUid) {
    const byLegacyProfileUid = Array.from(instructors.values()).find((inst) => inst.instructorId === instructorUid);
    if (byLegacyProfileUid) return byLegacyProfileUid;
  }

  return null;
}

function getInstructorSelectValue(record = {}) {
  const matched = findInstructorForRecord(record);
  if (matched) return matched.uid;
  return String(record.instructorUid || record.instructorId || "").trim();
}

function getInstructorMatchKeys(selectedValue) {
  const value = String(selectedValue || "").trim();
  const inst = value ? instructors.get(value) : null;
  return new Set([value, inst?.uid, inst?.authUid, inst?.instructorId].filter(Boolean));
}

function getSelectedInstructor(existingCourse = {}) {
  const instructorUid = $("#contentEditInstructorUid")?.value.trim() || "";
  if (!instructorUid) {
    return {
      instructorUid: String(existingCourse.instructorUid || "").trim(),
      instructorId: String(existingCourse.instructorId || "").trim(),
      instructorName: String(existingCourse.instructorName || "").trim()
    };
  }
  const selected = instructors.get(instructorUid);
  if (!selected) {
    return {
      instructorUid: String(existingCourse.instructorUid || "").trim(),
      instructorId: String(existingCourse.instructorId || "").trim(),
      instructorName: String(existingCourse.instructorName || "").trim()
    };
  }
  return {
    instructorUid: String(selected.uid || "").trim(),
    instructorId: String(selected.instructorId || "").trim(),
    instructorName: String(selected.name || "").trim()
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
  const { instructorName } = getSelectedInstructor();

  const excerptRaw = cardContentRaw || "강좌 카드 내용을 입력하세요";
  const excerpt = excerptRaw.length > PREVIEW_EXCERPT_MAX
    ? `${excerptRaw.slice(0, PREVIEW_EXCERPT_MAX)}...`
    : excerptRaw;
  const subjectClass = getSubjectAccentClass(subjectCode, subjectLabel);
  const accessBadge = getAccessTypeBadgeLabel(accessType);
  const formatBadge = getCourseFormatBadgeLabel(courseFormat);
  const accessBadgeClass = accessType === "memberOnly" ? " is-member" : "";
  const previewStatus = previewVideoUrl ? "미리보기 영상 있음" : "미리보기 영상 없음";
  const curriculumStatus = getPreviewCurriculumStatus(courseFormat);

  root.innerHTML = `
    <article class="course-card course-card--public course-card--admin-preview ${subjectClass}">
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
        <span class="course-card__meta-item">${toPreviewDisplayValue(instructorName, "미배정")}</span>
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
  let el = $("#statusMsg");
  if (!el) {
    el = document.createElement("div");
    el.id = "statusMsg";
    el.style.cssText = "position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:10000;padding:10px 14px;border-radius:8px;opacity:0;transition:opacity .2s";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.color = err ? "var(--error-color)" : "var(--success-color)";
  el.style.background = err ? "var(--error-bg)" : "var(--success-bg)";
  el.style.opacity = "1";
  setTimeout(() => { if (el.textContent === msg) el.style.opacity = "0"; }, 2200);
}

function getCourseRow(courseId) {
  return rows.find((row) => row.id === courseId) || null;
}

function getCourseTitle(courseId) {
  return getCourseRow(courseId)?.title || "선택한 강좌";
}

function openSupportModal(modalId) {
  $(`#${modalId}`)?.classList.add("is-open");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
}

function closeSupportModal(modalId) {
  $(`#${modalId}`)?.classList.remove("is-open");
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

function renderEnrollmentTable(enrollments, { showActions = true } = {}) {
  if (!enrollments.length) {
    return '<div class="admin-courses-enrollment-empty">이 강좌의 수강 기록이 없습니다.</div>';
  }

  const actionHeader = showActions ? "<th>관리</th>" : "";
  const rowsHtml = enrollments.map((enrollment) => {
    const actionCell = showActions
      ? `<td><button type="button" class="btn sm danger" data-remove-enrollment="${escapeHtml(enrollment.id)}">수강 기록 제거</button></td>`
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
    ${renderEnrollmentTable(enrollments, { showActions: true })}
  `;
}

async function refreshCourseEnrollments(courseId) {
  const body = $("#courseEnrollmentsBody");
  if (body) body.innerHTML = '<p class="muted">수강 기록을 불러오는 중...</p>';
  const enrollments = await loadCourseEnrollments(courseId);
  activeEnrollmentRows = enrollments;
  renderEnrollmentModal(courseId, enrollments);
  return enrollments;
}

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

function renderInstructorSelect(selected = "", selectedRecord = {}) {
  const el = $("#contentEditInstructorUid");
  if (!el) return;
  const list = Array.from(instructors.values()).sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
  const html = list.map((x) => `<option value="${escapeHtml(x.uid)}">${escapeHtml(x.name || x.uid)}</option>`).join("");
  el.innerHTML = `<option value="">강사 선택</option>${html}`;
  const selectedValue = getInstructorSelectValue({ ...selectedRecord, instructorUid: selected });
  if (selectedValue && !Array.from(el.options).some((opt) => opt.value === selectedValue)) {
    const opt = document.createElement("option");
    opt.value = selectedValue;
    opt.textContent = selectedRecord.instructorName || selectedValue;
    opt.disabled = true;
    el.appendChild(opt);
  }
  el.value = selectedValue || "";
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
    const snap = await getDocs(collection(db, "instructors"));
    snap.docs.forEach((docSnap) => {
      const row = normalizeInstructorProfile(docSnap);
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
  let weeks = normalizeCurriculumWeeks(rawWeeks).map((w, i) => ({
    id: w.id || `week_${i + 1}`,
    title: w.title || `${i + 1}주차`,
    description: w.description || w.content || "",
    videos: (Array.isArray(w.videos) ? w.videos : w.lessons || []).map((v, vi) => ({
      id: v.id || `video_${vi + 1}`,
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
          <input data-video-field="url" placeholder="https://..." value="${escapeHtml(v.url || "")}">
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
    videos: (w.videos || []).map((v) => ({ id: v.id, title: String(v.title || "").trim(), url: String(v.url || "").trim() })).filter((v) => v.url)
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
    if (action === "video-add") { weeksState[wi].videos = weeksState[wi].videos || []; weeksState[wi].videos.push({ id: `video_${Date.now()}`, title: "", url: "" }); renderWeeks(); }
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
  return `<tr>
    <td><strong>${escapeHtml(item.title || "제목 없음")}</strong></td>
    <td>${escapeHtml(item.subjectLabel || item.subject || "-")}</td>
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
      const rowInstructorUid = String(r.instructorUid || "").trim();
      const rowInstructorId = String(r.instructorId || "").trim();
      if (!keys.has(rowInstructorUid) && !keys.has(rowInstructorId)) return false;
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
  if (!pageEl) return;

  const startItem = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, totalItems);
  const rangeText = totalItems === 0 ? "" : `${startItem}-${endItem} / ${totalItems}`;

  pageEl.classList.add("is-visible");
  pageEl.onclick = null;

  if (totalPages <= 1) {
    pageEl.innerHTML = `
      <div class="admin-courses-pagination-inner">
        <p class="admin-courses-pagination-info" aria-live="polite">${escapeHtml(rangeText)}</p>
      </div>
    `;
    return;
  }

  const current = page;
  const firstDisabled = current <= 1;
  const lastDisabled = current >= totalPages;

  let start = Math.max(1, current - Math.floor(PAGINATION_GROUP_SIZE / 2));
  let end = Math.min(totalPages, start + PAGINATION_GROUP_SIZE - 1);
  if (end - start < PAGINATION_GROUP_SIZE - 1) start = Math.max(1, end - PAGINATION_GROUP_SIZE + 1);

  let pages = "";
  for (let index = start; index <= end; index += 1) {
    const activeClass = index === current ? " is-active" : "";
    pages += `<button type="button" class="pagination-btn admin-courses-pagination-num${activeClass}" data-admin-p="${index}">${index}</button>`;
  }

  pageEl.innerHTML = `
    <div class="admin-courses-pagination-inner">
      <div class="admin-courses-pagination-controls">
        <button type="button" class="pagination-btn admin-courses-pagination-arrow" data-admin-p="first" ${firstDisabled ? "disabled" : ""}>&lt;&lt;</button>
        <button type="button" class="pagination-btn admin-courses-pagination-arrow" data-admin-p="prev" ${firstDisabled ? "disabled" : ""}>&lt;</button>
        <div class="admin-courses-pagination-pages">${pages}</div>
        <button type="button" class="pagination-btn admin-courses-pagination-arrow" data-admin-p="next" ${lastDisabled ? "disabled" : ""}>&gt;</button>
        <button type="button" class="pagination-btn admin-courses-pagination-arrow" data-admin-p="last" ${lastDisabled ? "disabled" : ""}>&gt;&gt;</button>
      </div>
      <p class="admin-courses-pagination-info" aria-live="polite">${escapeHtml(rangeText)}</p>
    </div>
  `;

  pageEl.onclick = (event) => {
    const button = event.target.closest("button[data-admin-p]");
    if (!button || button.disabled) return;

    const action = button.getAttribute("data-admin-p");
    const pageCount = Math.max(1, Math.ceil(viewRows.length / PAGE_SIZE));

    let nextPage = current;
    if (action === "first") nextPage = 1;
    else if (action === "prev") nextPage = current - 1;
    else if (action === "next") nextPage = current + 1;
    else if (action === "last") nextPage = pageCount;
    else nextPage = Number.parseInt(action, 10);

    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > pageCount) return;

    page = nextPage;
    renderTable();
    pageEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
}

function renderTable() {
  if (!tbody) return;
  if (!viewRows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted admin-table-empty">표시할 강좌가 없습니다.</td></tr>';
    if (pageEl) {
      pageEl.classList.remove("is-visible");
      pageEl.innerHTML = "";
      pageEl.onclick = null;
    }
    metaEl.textContent = rows.length ? "조건에 맞는 강좌가 없습니다." : "등록된 강좌가 없습니다.";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(viewRows.length / PAGE_SIZE));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * PAGE_SIZE;
  tbody.innerHTML = viewRows.slice(start, start + PAGE_SIZE).map(toRowHtml).join("");
  metaEl.textContent = `${viewRows.length}개 표시 / 전체 ${rows.length}개 (페이지 ${page}/${totalPages})`;
  renderAdminPagination(totalPages, viewRows.length);
}

async function loadRows() {
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
  applyFilters();
}

window.openAddContentModal = function openAddContentModal() {
  $("#contentEditForm")?.reset();
  $("#contentEditId").value = "";
  $("#contentEditStatus").value = "published";
  $("#contentEditCourseFormat").value = "single";
  setSelectValue($("#contentEditAccessType"), "public", "public");
  refreshCourseCatalogSelects("", "", "");
  renderInstructorSelect();
  initWeeks([], "single");
  updateLivePreview();
  $("#contentModalTitle").textContent = "강좌 추가";
  $("#contentEditModal")?.classList.add("is-open");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
  contentFormDirty.capture();
};

window.openEditContentModal = async function openEditContentModal(id) {
  const snap = await getDoc(doc(db, "courses", id));
  if (!snap.exists()) return toast("강좌를 찾을 수 없습니다.", true);
  const rawCourse = snap.data() || {};
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
  renderInstructorSelect(c.instructorUid || "", c);
  initWeeks(c.weeks || c.curriculumWeeks || [], c.courseFormat || "single");
  updateLivePreview();
  $("#contentModalTitle").textContent = "강좌 수정";
  $("#contentEditModal")?.classList.add("is-open");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
  contentFormDirty.capture();
};

window.closeContentModal = async function closeContentModal(force = false) {
  if (!force && !(await confirmDiscardIfDirty(contentFormDirty))) return;
  $("#contentEditModal")?.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
};

window.openCourseEnrollmentsModal = async function openCourseEnrollmentsModal(courseId) {
  activeEnrollmentCourseId = courseId;
  const title = $("#courseEnrollmentsTitle");
  const subtitle = $("#courseEnrollmentsSubtitle");
  const body = $("#courseEnrollmentsBody");
  if (title) title.textContent = "수강생 확인";
  if (subtitle) subtitle.textContent = `${getCourseTitle(courseId)} / 불러오는 중`;
  if (body) body.innerHTML = '<p class="muted">수강 기록을 불러오는 중...</p>';
  openSupportModal("courseEnrollmentsModal");

  try {
    await refreshCourseEnrollments(courseId);
  } catch (error) {
    console.error("[admin-courses] enrollment list load failed:", error);
    if (body) {
      body.innerHTML = '<div class="admin-courses-enrollment-empty">수강 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>';
    }
    toast("수강 기록을 불러오지 못했습니다.", true);
  }
};

window.closeCourseEnrollmentsModal = function closeCourseEnrollmentsModal() {
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
        <strong>${escapeHtml(enrollment.learnerName || "선택한 수강생")}의 수강 기록을 제거합니다.</strong>
        <p style="margin:6px 0 0;">이 작업은 이 강좌의 수강 기록만 제거합니다.</p>
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
    await deleteDoc(doc(db, "enrollments", enrollmentId));
    toast("수강 기록을 제거했습니다.");
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

function renderDeleteBlockedModal(courseId, enrollments) {
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
      <p style="margin:4px 0 0;">위험 삭제를 선택하면 아래 수강 기록과 강좌 문서만 삭제됩니다. 학생/회원/강사 계정과 오프라인 반 데이터는 삭제하지 않습니다.</p>
    </div>
    <div class="admin-courses-enrollment-summary">
      <strong>영향 받는 수강 기록 미리보기</strong>
      <span class="admin-courses-enrollment-count">${enrollments.length}개</span>
    </div>
    ${renderEnrollmentTable(enrollments, { showActions: false })}
  `;
}

function openDeleteBlockedModal(courseId, enrollments) {
  deleteBlockedState = {
    courseId,
    course: getCourseRow(courseId),
    enrollments
  };
  renderDeleteBlockedModal(courseId, enrollments);
  openSupportModal("courseDeleteBlockedModal");
}

window.closeCourseDeleteBlockedModal = function closeCourseDeleteBlockedModal() {
  deleteBlockedState = { courseId: "", course: null, enrollments: [] };
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

function renderForceDeleteModal(courseId, enrollments) {
  const subtitle = $("#courseForceDeleteSubtitle");
  const body = $("#courseForceDeleteBody");
  if (subtitle) {
    subtitle.textContent = `${getCourseTitle(courseId)} / 수강 기록 ${enrollments.length}개`;
  }
  if (!body) return;
  body.innerHTML = `
    <div class="admin-courses-danger-box">
      <strong>위험 작업입니다.</strong>
      <p style="margin:6px 0 0;">강좌와 연결된 수강 기록 ${enrollments.length}개를 함께 삭제한 뒤 강좌를 영구 삭제합니다.</p>
      <p style="margin:4px 0 0;">삭제 직전에 수강 기록을 다시 확인합니다.</p>
    </div>
    <div class="admin-courses-delete-list">
      <div class="admin-courses-delete-list__box">
        <strong>삭제되는 항목</strong>
        <ul>
          <li>이 강좌 문서</li>
          <li>이 강좌의 수강 기록</li>
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

async function deleteCourseWithEnrollments(courseId, enrollments) {
  let batch = writeBatch(db);
  let operationCount = 0;

  for (const enrollment of enrollments) {
    batch.delete(doc(db, "enrollments", enrollment.id));
    operationCount += 1;
    if (operationCount >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      operationCount = 0;
    }
  }

  batch.delete(doc(db, "courses", courseId));
  await batch.commit();
}

window.forceDeleteCourseFromDeleteBlocked = async function forceDeleteCourseFromDeleteBlocked() {
  const { courseId, enrollments } = deleteBlockedState;
  if (!courseId || !enrollments.length) return;
  renderForceDeleteModal(courseId, enrollments);
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

  try {
    const latestEnrollments = await loadCourseEnrollments(courseId);
    await deleteCourseWithEnrollments(courseId, latestEnrollments);
    toast("강좌와 해당 수강 기록을 삭제했습니다.");
    window.closeCourseForceDeleteModal();
    window.closeCourseDeleteBlockedModal();
    await loadRows();
  } catch (error) {
    console.error("[admin-courses] force course delete failed:", error);
    const message = "강좌 영구 삭제 중 오류가 발생했습니다.";
    setCourseDeleteFeedback("#courseForceDeleteFeedback", message);
    toast(message, true);
  }
};

function openNoEnrollmentDeleteModal(courseId) {
  noEnrollmentDeleteState = {
    courseId,
    course: getCourseRow(courseId)
  };
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
  noEnrollmentDeleteState = { courseId: "", course: null };
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

  try {
    await deleteDoc(doc(db, "courses", courseId));
    toast("강좌를 영구 삭제했습니다.");
    window.closeCourseDeleteEmptyModal();
    await loadRows();
  } catch (error) {
    console.error("[admin-courses] course delete failed:", error);
    const message = "강좌 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    setCourseDeleteFeedback("#courseDeleteEmptyFeedback", message);
    toast(message, true);
  }
};

window.deleteContent = async function deleteContent(id) {
  let enrollments;
  try {
    enrollments = await loadCourseEnrollments(id);
  } catch (error) {
    console.error("[admin-courses] enrollment check failed before delete:", error);
    toast("수강 신청 기록 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", true);
    return;
  }

  if (enrollments.length > 0) {
    openDeleteBlockedModal(id, enrollments);
    return;
  }

  openNoEnrollmentDeleteModal(id);
};

$("#contentEditForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#contentEditId").value.trim();
  const title = $("#contentEditTitle").value.trim();
  const subject = resolveSubjectFromForm();
  if (!title || !subject) return toast("강좌명과 과목은 필수입니다.", true);
  if (isReservedCatalogValue(subject)) {
    return toast("전체, 선택, 직접 입력은 과목으로 저장할 수 없습니다.", true);
  }

  const weeks = collectWeeks();
  const previewVideoUrl = $("#contentEditPreviewVideoUrl").value.trim();
  if (previewVideoUrl) {
    try { new URL(previewVideoUrl); } catch (_) { return toast("미리보기 영상 URL 형식이 올바르지 않습니다.", true); }
  }
  for (const w of weeks) {
    for (const v of (w.videos || [])) {
      if (!v.url) continue;
      try { new URL(v.url); } catch (_) { return toast(`주차 영상 URL이 올바르지 않습니다: ${v.url}`, true); }
    }
  }

  const existingCourse = id ? ((await getDoc(doc(db, "courses", id))).data() || {}) : {};
  const { instructorUid, instructorId, instructorName } = getSelectedInstructor(existingCourse);
  const selectedAccess = $("#contentEditAccessType")?.value || existingCourse.accessType || "public";
  const accessType = normalizeAccessType(selectedAccess);
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

  if (id) {
    await updateDoc(doc(db, "courses", id), { ...savePayload, updatedAt: serverTimestamp(), ...legacyRemove });
    toast("강좌 정보를 저장했습니다.");
  } else {
    await addDoc(collection(db, "courses"), { ...savePayload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    toast("강좌를 등록했습니다.");
  }
  closeContentModal(true);
  await loadRows();
});

searchEl?.addEventListener("input", () => { filters.search = searchEl.value || ""; applyFilters(); });
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
    if ($("#courseForceDeleteModal")?.classList.contains("is-open")) return window.closeCourseForceDeleteModal();
    if ($("#courseDeleteEmptyModal")?.classList.contains("is-open")) return window.closeCourseDeleteEmptyModal();
    if ($("#enrollmentRemoveConfirmModal")?.classList.contains("is-open")) return window.closeEnrollmentRemoveConfirmModal();
    if ($("#courseDeleteBlockedModal")?.classList.contains("is-open")) return window.closeCourseDeleteBlockedModal();
    if ($("#courseEnrollmentsModal")?.classList.contains("is-open")) return window.closeCourseEnrollmentsModal();
    if ($("#contentEditModal")?.classList.contains("is-open")) closeContentModal();
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
  try {
    const catalog = await getSettingDoc("courseCatalog");
    mergedCourseCatalog = mergeCourseCatalog(catalog.exists ? catalog.data : {});
    labelMaps = buildLabelMaps(mergedCourseCatalog);
  } catch (_) {
    labelMaps = buildLabelMaps(fallback);
    mergedCourseCatalog = fallback;
  }

  catalogGrades = getCourseGradeLabels(mergedCourseCatalog);
  catalogCourseSubjects = getCourseSubjectOptions(mergedCourseCatalog);
  courseSubjectDraft = getCourseCatalogSubjectDraft(mergedCourseCatalog);
  courseGradeDraft = getCourseCatalogGradeDraft(mergedCourseCatalog).map((item) => item.label);
  courseYearDraft = getCourseCatalogYearDraft(mergedCourseCatalog).map((item) => item.label);
  renderCourseCatalogPanel();
  refreshCourseCatalogSelects();
}
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
