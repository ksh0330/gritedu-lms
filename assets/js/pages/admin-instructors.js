// /assets/js/pages/admin-instructors.js
// 강사 관리 페이지
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, setDoc, serverTimestamp, deleteField,
  collection, query, where, getDocs, getDocsFromServer, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs";
import { escapeHtml } from "/assets/js/utils/html.js";
import {
  clearModalAlert,
  ensureAdminToastHost,
  setModalAlert,
} from "/assets/js/utils/admin-modal-alert.js";
import { invalidateSetting, getSettingDoc } from "/assets/js/utils/settings-cache.js";
import { requestPhraseConfirmation } from "/assets/js/utils/confirm-phrase-modal.js";
import { confirmDiscardIfDirty, createFormDirtyTracker } from "/assets/js/utils/admin-dialog.js";
import {
  buildSubjectSelectHtml,
  resolveSubjectFromControls,
  addUniqueCatalogItem,
  moveCatalogItem,
  removeCatalogItem,
  renameCatalogItem,
  renderStringCatalogTagsHtml,
} from "/assets/js/utils/catalog-select-helpers.js";
import {
  DEFAULT_INSTRUCTOR_MENU_SUBJECTS,
  buildInstructorMenuSubjectsPayload,
  cloneInstructorMenuSubjects,
  loadInstructorMenuSubjects,
} from "/assets/js/utils/instructor-subjects.js";
import {
  PUBLIC_IMAGE_FIELD,
  normalizePublicImageUrl,
  isRemotePublicImageUrl,
  normalizePersistableInstructorProfilePhoto,
  getInstructorProfilePhotoPath,
  sanitizePublicImageSrc,
  INSTRUCTOR_PROFILE_PLACEHOLDER,
  getInstructorProfileValidationMessage,
  getInstructorCurriculumValidationMessage,
} from "/assets/js/utils/public-image-url.js";
import {
  assignImageSrc,
  probeImageUrl,
  clearImageLoadGuards,
  isImageLoadExhausted,
  resetImageLoadGuard,
  bindGuardedImages,
} from "/assets/js/utils/image-load-guard.js";

// 역할 가드: 관리자만 접근 가능
(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const editInstructorFormDirty = createFormDirtyTracker(document.querySelector("#editInstructorForm"));
const addInstructorFormDirty = createFormDirtyTracker(document.querySelector("#addInstructorInfoForm"));

// 이미지 URL에 캐시 버스터 추가 (브라우저 캐시 무효화)
// 이미지 URL은 R2 key 또는 local 파일명 변경으로 갱신한다.
function addImageCacheBuster(url) {
  return url;
}

const imagePathValidationCache = new Map();
const curriculumRowTimers = new WeakMap();
let instructorDetailPreviewTimer = 0;
let photoPreviewInputTimer = 0;
let lastRenderedDetailPreviewKey = '';

function clearImagePathValidationCache() {
  imagePathValidationCache.clear();
}

function scheduleInstructorDetailPreview(delay = 150) {
  clearTimeout(instructorDetailPreviewTimer);
  instructorDetailPreviewTimer = window.setTimeout(() => {
    instructorDetailPreviewTimer = 0;
    updateInstructorDetailPreviewNow();
  }, delay);
}

function bindGuardedPreviewImages(root) {
  bindGuardedImages(root);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSubjectList(values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const result = [];

  source.forEach((value) => {
    const subject = normalizeText(value);
    if (!subject || seen.has(subject)) return;
    seen.add(subject);
    result.push(subject);
  });

  return result;
}

function getInstructorSubjectValues(instructor = {}) {
  return normalizeSubjectList([
    instructor.subject,
    ...(Array.isArray(instructor.subjects) ? instructor.subjects : []),
    instructor.category
  ]);
}

function getInstructorSubjectLabel(instructor = {}) {
  return getInstructorSubjectValues(instructor).join(", ");
}

function getPrimarySubject(subjects, fallback = "") {
  return normalizeSubjectList(subjects)[0] || normalizeText(fallback);
}

function getSubjectSavePayload(subjects, fallback = "") {
  const normalizedSubjects = normalizeSubjectList(subjects);
  const primarySubject = getPrimarySubject(normalizedSubjects, fallback);
  return {
    subject: primarySubject,
    subjects: normalizedSubjects.length ? normalizedSubjects : (primarySubject ? [primarySubject] : [])
  };
}

function hasLinkedUid(data = {}) {
  return typeof data.uid === "string" && data.uid.trim() !== "";
}

function getAccountSnapshotForProfile(profile = {}, accountsByUid = {}, accountsByInstructorId = {}) {
  const uid = hasLinkedUid(profile) ? profile.uid.trim() : "";
  const instructorId = normalizeText(profile.instructorId || profile.profileDocId || profile.id);
  return (uid && accountsByUid[uid]) || accountsByInstructorId[instructorId] || accountsByInstructorId[profile.profileDocId] || null;
}

function buildInstructorAccountSnapshot({ uid, instructorId, name, email, subject, subjects }) {
  const subjectPayload = getSubjectSavePayload(subjects, subject);
  return {
    uid,
    instructorId,
    name: name || "",
    email: email || "",
    emailLower: normalizeEmail(email),
    subject: subjectPayload.subject || "",
    subjects: subjectPayload.subjects,
    updatedAt: serverTimestamp()
  };
}

function applyGlobalDetailSectionToUi(ds) {
  const d = ds || {};
  const set = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.checked = d[key] !== false;
  };
  set("globalDetailSecVideo", "video");
  set("globalDetailSecCurriculum", "curriculum");
  set("globalDetailSecCourses", "courses");
}

function readGlobalDetailSectionFromUi() {
  const g = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked !== false : true;
  };
  return {
    video: g("globalDetailSecVideo"),
    curriculum: g("globalDetailSecCurriculum"),
    courses: g("globalDetailSecCourses")
  };
}

async function loadPublicInstructorDetailSections() {
  try {
    const snap = await getDoc(doc(db, "settings", "instructorsMenu"));
    const ds = snap.exists() ? (snap.data().detailSections || {}) : {};
    applyGlobalDetailSectionToUi(ds);
  } catch (e) {
    if (e.code !== "permission-denied") {
      console.warn("강사 상세 공개 항목 로드 실패:", e);
    }
  }
}

window.savePublicInstructorDetailSections = async () => {
  try {
    const settingsRef = doc(db, "settings", "instructorsMenu");
    const settingsSnap = await getDoc(settingsRef);
    const existingDetailSections = settingsSnap.exists() ? (settingsSnap.data().detailSections || {}) : {};
    const detailSections = {
      ...existingDetailSections,
      ...readGlobalDetailSectionFromUi()
    };
    await setDoc(
      settingsRef,
      { detailSections, updatedAt: serverTimestamp() },
      { merge: true }
    );
    invalidateSetting("instructorsMenu");
    toast("강사 상세 페이지 공개 항목이 저장되었습니다.");
    if (typeof updateInstructorDetailPreview === "function") scheduleInstructorDetailPreview(0);
  } catch (e) {
    toast("저장 실패: " + (e.message || e), true);
  }
};

function setupGlobalDetailSectionListeners() {
  const ids = [
    "globalDetailSecVideo",
    "globalDetailSecCurriculum",
    "globalDetailSecCourses"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.hasAttribute("data-detail-listener")) {
      el.setAttribute("data-detail-listener", "1");
      el.addEventListener("change", () => {
        if (typeof updateInstructorDetailPreview === "function") scheduleInstructorDetailPreview(0);
      });
    }
  });
}

function isInstructorModalOpen(modal) {
  return Boolean(modal && modal.style.display !== "none" && modal.style.display !== "");
}

function isAnyInstructorModalOpen() {
  return (
    isInstructorModalOpen($("#editInstructorModal")) ||
    isInstructorModalOpen($("#addInstructorInfoModal"))
  );
}

function scrollInstructorModalFeedback(preferredEl) {
  const target =
    preferredEl && !preferredEl.hidden
      ? preferredEl
      : $("#editInstructorModalAlert");
  target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setActiveInstructorModalAlert(message = "", isError = false, preferredScrollEl = null) {
  if (isInstructorModalOpen($("#editInstructorModal"))) {
    setModalAlert($("#editInstructorModalAlert"), message, isError);
    if (isError) scrollInstructorModalFeedback(preferredScrollEl);
    return;
  }
  if (isInstructorModalOpen($("#addInstructorInfoModal"))) {
    setModalAlert($("#addInstructorModalAlert"), message, isError);
    return;
  }
}

function setProfilePhotoFieldAlert(message = "", isError = false) {
  setModalAlert($("#editInstructorPhotoAlert"), message, isError);
  if (isError && message) {
    scrollInstructorModalFeedback($("#editInstructorPhotoAlert"));
  }
}

function clearProfilePhotoFieldAlert() {
  clearModalAlert($("#editInstructorPhotoAlert"));
}

function showProfilePhotoValidationError() {
  const message = getInstructorProfileValidationMessage();
  setActiveInstructorModalAlert(message, true, $("#editInstructorPhotoAlert"));
  setProfilePhotoFieldAlert(message, true);
}

function toast(msg, err = false) {
  if (err && isAnyInstructorModalOpen()) {
    setActiveInstructorModalAlert(msg, true);
    return;
  }

  const statusMsg = $("#statusMsg");
  if (statusMsg) {
    ensureAdminToastHost(statusMsg);
    statusMsg.textContent = msg;
    statusMsg.style.color = err ? "var(--error-color)" : "var(--success-color)";
    statusMsg.style.background = err ? "var(--error-bg)" : "var(--success-bg)";
    statusMsg.style.padding = "12px";
    statusMsg.style.borderRadius = "8px";
    statusMsg.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    statusMsg.style.opacity = "1";
    statusMsg.style.pointerEvents = "auto";
    setTimeout(() => {
      if (statusMsg.textContent === msg) {
        statusMsg.style.opacity = "0";
        statusMsg.style.pointerEvents = "none";
        setTimeout(() => {
          if (statusMsg.textContent === msg) {
            statusMsg.textContent = "";
            statusMsg.style.background = "";
            statusMsg.style.boxShadow = "";
          }
        }, 300);
      }
    }, 3000);
  }
}

// 강사 목록 실시간 로드
let tbody = null;
let searchInput = null;
let sortOption = null;
let allInstructors = [];
let classCounts = {}; // 강사별 담당 온라인 강좌 수 캐시
let classNames = {}; // 강사별 담당 온라인 강좌 이름 목록 캐시
let offlineClassCounts = {}; // 강사별 담당 오프라인 반 수 캐시
let offlineClassNames = {}; // 강사별 담당 오프라인 반 이름 목록 캐시
let onlineCourseRecords = [];
let offlineClassRecords = [];
let currentSort = { field: 'name', direction: 'asc' };
let currentPage = 1;
const itemsPerPage = 10;

// DOM 요소 초기화
function initDOMElements() {
  if (!tbody) {
    const table = $("#tblInstructors");
    if (table) {
      tbody = table.querySelector('tbody');
    }
  }
  if (!searchInput) {
    searchInput = $("#searchInstructors");
  }
  if (!sortOption) {
    sortOption = $("#sortOption");
  }
  
  return !!tbody;
}

function getInstructorAssignmentKeys(instructor) {
  const keys = new Set();
  const add = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) keys.add(normalized);
  };

  if (instructor?.uid && !String(instructor.uid).startsWith("pending_")) {
    add(instructor.uid);
  }
  add(instructor?.accountUid);
  add(instructor?.instructorId);
  add(instructor?.id);
  add(instructor?.profileDocId);
  return keys;
}

function isOnlineCourseAssignedToInstructor(course, instructor) {
  const keys = getInstructorAssignmentKeys(instructor);
  if (keys.size === 0) return false;

  if (course.instructorUid && keys.has(String(course.instructorUid))) return true;
  if (Array.isArray(course.instructorUids) && course.instructorUids.some((uid) => keys.has(String(uid)))) return true;
  if (course.instructorId && keys.has(String(course.instructorId))) return true;
  return false;
}

function isOfflineClassAssignedToInstructor(offlineClass, instructor) {
  const keys = getInstructorAssignmentKeys(instructor);
  if (keys.size === 0) return false;

  if (offlineClass.instructorUid && keys.has(String(offlineClass.instructorUid))) return true;
  if (offlineClass.instructorId && keys.has(String(offlineClass.instructorId))) return true;
  if (Array.isArray(offlineClass.instructorUids) && offlineClass.instructorUids.some((uid) => keys.has(String(uid)))) return true;
  return false;
}

function getCourseTitle(course) {
  return course.title || course.name || "제목 없는 강좌";
}

function getOfflineClassName(offlineClass) {
  return offlineClass.className || offlineClass.name || offlineClass.title || "이름 없는 반";
}

function applyAssignmentSummaries(instructors) {
  classCounts = {};
  classNames = {};
  offlineClassCounts = {};
  offlineClassNames = {};

  return instructors.map((instructor) => {
    const onlineCourses = onlineCourseRecords.filter((course) => isOnlineCourseAssignedToInstructor(course, instructor));
    const offlineClasses = offlineClassRecords.filter((offlineClass) => isOfflineClassAssignedToInstructor(offlineClass, instructor));
    const onlineNames = onlineCourses.map(getCourseTitle);
    const offlineNames = offlineClasses.map(getOfflineClassName);

    classCounts[instructor.uid] = onlineNames.length;
    classNames[instructor.uid] = onlineNames;
    offlineClassCounts[instructor.uid] = offlineNames.length;
    offlineClassNames[instructor.uid] = offlineNames;

    return {
      ...instructor,
      classCount: onlineNames.length,
      onlineCourseCount: onlineNames.length,
      onlineCourseNames: onlineNames,
      offlineClassCount: offlineNames.length,
      offlineClassNames: offlineNames
    };
  });
}

// 담당 온라인 강좌/오프라인 반 정보를 한 번에 조회 (onSnapshot 제거)
async function loadClassesData() {
  try {
    const [coursesSnap, offlineClassesSnap] = await Promise.all([
      getDocs(collection(db, "courses")),
      getDocs(collection(db, "offlineClasses"))
    ]);

    onlineCourseRecords = coursesSnap.docs.map((courseDoc) => ({
      id: courseDoc.id,
      ...courseDoc.data()
    }));
    offlineClassRecords = offlineClassesSnap.docs.map((classDoc) => ({
      id: classDoc.id,
      ...classDoc.data()
    }));
  } catch (error) {
    if (error.code !== 'permission-denied') console.error("담당 강좌/반 목록 로드 실패:", error);
    onlineCourseRecords = [];
    offlineClassRecords = [];
  }
}

// Canonical instructors profiles plus optional private account snapshots.
let instructorAccountsData = {};
let instructorsData = {};
let isInitialized = false;
let instructorMenuSubjects = DEFAULT_INSTRUCTOR_MENU_SUBJECTS.slice();
let instructorSubjectsDraft = DEFAULT_INSTRUCTOR_MENU_SUBJECTS.slice();
const SUBJECT_CUSTOM_VALUE = "__custom__";

function getInstructorSubjectOptions() {
  if (instructorSubjectsDraft.length) {
    return instructorSubjectsDraft.slice();
  }
  return instructorMenuSubjects.length
    ? instructorMenuSubjects.slice()
    : DEFAULT_INSTRUCTOR_MENU_SUBJECTS.slice();
}

function renderInstructorCatalogPanel() {
  const host = $("#instructorCatalogSubjectTags");
  if (host) {
    host.innerHTML = renderStringCatalogTagsHtml(instructorSubjectsDraft, "subjects", escapeHtml);
  }
  populateInstructorSubjectSelects();
}

function applyInstructorSubjectsDraft() {
  instructorMenuSubjects = cloneInstructorMenuSubjects(instructorSubjectsDraft);
  renderInstructorCatalogPanel();
}

async function saveInstructorSubjectsDraft() {
  if (instructorSubjectsDraft.length < 1) {
    toast("과목은 1개 이상 유지해야 합니다.", true);
    return;
  }
  try {
    const settingsRef = doc(db, "settings", "instructorsMenu");
    const settingsSnap = await getDoc(settingsRef);
    const existing = settingsSnap.exists ? settingsSnap.data() : {};
    const uid = auth.currentUser?.uid || "";
    await setDoc(
      settingsRef,
      {
        ...existing,
        ...buildInstructorMenuSubjectsPayload(instructorSubjectsDraft),
        updatedAt: serverTimestamp(),
        ...(uid ? { updatedBy: uid } : {})
      },
      { merge: true }
    );
    invalidateSetting("instructorsMenu");
    applyInstructorSubjectsDraft();
    toast("과목 목록을 저장했습니다.");
  } catch (error) {
    console.error("[admin-instructors] subject catalog save failed:", error);
    toast("목록 저장에 실패했습니다.", true);
  }
}

function setupInstructorCatalogPanel() {
  $("#instructorCatalogSaveBtn")?.addEventListener("click", () => {
    saveInstructorSubjectsDraft();
  });
  $("#instructorCatalogSubjectAddBtn")?.addEventListener("click", () => {
    const result = addUniqueCatalogItem(instructorSubjectsDraft, $("#instructorCatalogSubjectInput")?.value || "");
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    instructorSubjectsDraft = result.list;
    if ($("#instructorCatalogSubjectInput")) $("#instructorCatalogSubjectInput").value = "";
    renderInstructorCatalogPanel();
  });
  $("#instructorCatalogSubjectInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    $("#instructorCatalogSubjectAddBtn")?.click();
  });
  $("#instructorCatalogPanel")?.addEventListener("click", (event) => {
    const moveBtn = event.target.closest("[data-catalog-move]");
    if (moveBtn) {
      const result = moveCatalogItem(
        instructorSubjectsDraft,
        moveBtn.dataset.catalogValue || "",
        moveBtn.dataset.catalogMove || ""
      );
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      instructorSubjectsDraft = result.list;
      renderInstructorCatalogPanel();
      return;
    }
    const removeBtn = event.target.closest(".admin-catalog-tag__remove");
    if (removeBtn) {
      const result = removeCatalogItem(instructorSubjectsDraft, removeBtn.dataset.catalogValue || "", {
        minItems: 1,
        label: "과목"
      });
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      instructorSubjectsDraft = result.list;
      renderInstructorCatalogPanel();
      return;
    }
    const editBtn = event.target.closest(".admin-catalog-tag__edit");
    if (editBtn) {
      const oldValue = editBtn.dataset.catalogValue || "";
      const nextValue = window.prompt("과목 이름 수정", oldValue);
      if (nextValue === null) return;
      const result = renameCatalogItem(instructorSubjectsDraft, oldValue, nextValue);
      if (!result.ok) {
        toast(result.message, true);
        return;
      }
      instructorSubjectsDraft = result.list;
      renderInstructorCatalogPanel();
    }
  });
  $("#instructorCatalogPanel")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-catalog-inline-input]");
    if (!input) return;
    const result = renameCatalogItem(instructorSubjectsDraft, input.dataset.catalogValue || "", input.value);
    if (!result.ok) return toast(result.message, true);
    instructorSubjectsDraft = result.list;
    renderInstructorCatalogPanel();
  });
}

function findInstructorProfileConflict(name, subjects, excludeProfileDocId = "") {
  const normalizedName = normalizeText(name);
  const normalizedSubjects = normalizeSubjectList(subjects);
  if (!normalizedName || normalizedSubjects.length === 0) return null;
  const subjectSet = new Set(normalizedSubjects);

  const matches = Object.values(instructorsData).filter((inst) => {
    const profileDocId = normalizeText(inst.profileDocId || inst.instructorId);
    if (excludeProfileDocId && profileDocId === excludeProfileDocId) return false;
    const instructorSubjects = getInstructorSubjectValues(inst);
    return normalizeText(inst.name) === normalizedName &&
      instructorSubjects.some((subject) => subjectSet.has(subject));
  });

  if (!matches.length) return null;
  return matches.length === 1 ? matches[0] : { multiple: true, count: matches.length };
}

function formatInstructorConflictMessage(conflict) {
  if (!conflict) return "";
  if (conflict.multiple) {
    return `같은 이름·과목 조합의 강사 프로필이 ${conflict.count}개 있습니다. 먼저 기존 프로필을 정리해주세요.`;
  }
  const status = conflict.hasAccount ? "계정 연결됨" : "프로필만 등록됨";
  return `이미 같은 이름·과목의 강사가 있습니다. (${status}: ${conflict.name || "-"})`;
}

async function initInstructorSubjectCatalog() {
  instructorMenuSubjects = await loadInstructorMenuSubjects(getSettingDoc);
  instructorSubjectsDraft = cloneInstructorMenuSubjects(instructorMenuSubjects);
  renderInstructorCatalogPanel();
  populateInstructorSubjectSelects();
}

function populateInstructorSubjectSelects() {
  renderInstructorSubjectControl(
    "#addInstructorInfoSubject",
    "#addInstructorInfoSubjectCustom",
    getInstructorSubjectControlValues("#addInstructorInfoSubject", "#addInstructorInfoSubjectCustom"),
    { emptyLabel: "선택하세요" }
  );
  renderInstructorSubjectControl(
    "#editInstructorSubject",
    "#editInstructorSubjectCustom",
    getInstructorSubjectControlValues("#editInstructorSubject", "#editInstructorSubjectCustom"),
    { emptyLabel: "비어있음" }
  );
}

function setupInstructorSubjectControls() {
}

function getSubjectChoiceContainer(selectEl) {
  if (!selectEl?.id) return null;
  return document.getElementById(`${selectEl.id}Choices`);
}

function ensureSubjectChoiceContainer(selectEl) {
  if (!selectEl?.id) return null;

  let container = getSubjectChoiceContainer(selectEl);
  if (!container) {
    container = document.createElement("div");
    container.id = `${selectEl.id}Choices`;
    container.className = "subject-choice-list";
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "과목 복수 선택");
    selectEl.insertAdjacentElement("afterend", container);
  }
  return container;
}

function updateSubjectChoiceStyles(container) {
  container?.querySelectorAll(".subject-choice-chip").forEach((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    label.classList.toggle("is-checked", !!input?.checked);
  });
}

function setHiddenSubjectSelectValue(selectEl, primarySubject) {
  if (!selectEl) return;
  const knownSubjects = normalizeSubjectList(getInstructorSubjectOptions());
  if (!primarySubject) {
    selectEl.value = "";
  } else if (knownSubjects.includes(primarySubject)) {
    selectEl.value = primarySubject;
  } else {
    selectEl.value = SUBJECT_CUSTOM_VALUE;
  }
}

function readSubjectChoiceValues(selectEl, customEl) {
  const container = getSubjectChoiceContainer(selectEl);
  if (!container) {
    return normalizeSubjectList(resolveSubjectFromControls(
      selectEl,
      customEl,
      getInstructorSubjectOptions()
    ));
  }

  const values = $$('input[data-subject-option]:checked', container)
    .map((input) => input.value);
  const customToggle = container.querySelector("[data-subject-custom-toggle]");
  if (customToggle?.checked) {
    values.push(customEl?.value || "");
  }
  return normalizeSubjectList(values);
}

function syncSubjectChoiceControl(selectEl, customEl) {
  const container = getSubjectChoiceContainer(selectEl);
  if (!container) return;

  const customToggle = container.querySelector("[data-subject-custom-toggle]");
  const showCustom = !!customToggle?.checked;
  if (customEl) {
    customEl.style.display = showCustom ? "" : "none";
    customEl.required = false;
    if (!showCustom) customEl.value = "";
  }

  updateSubjectChoiceStyles(container);
  setHiddenSubjectSelectValue(selectEl, getPrimarySubject(readSubjectChoiceValues(selectEl, customEl)));
}

function wireSubjectChoiceControl(selectEl, customEl) {
  const container = getSubjectChoiceContainer(selectEl);
  if (!container || container.dataset.subjectChoiceWired === "true") return;

  container.dataset.subjectChoiceWired = "true";
  container.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    syncSubjectChoiceControl(selectEl, customEl);
    if (selectEl.id === "editInstructorSubject") scheduleInstructorDetailPreview();
  });

  if (customEl && customEl.dataset.subjectChoiceWired !== "true") {
    customEl.dataset.subjectChoiceWired = "true";
    customEl.addEventListener("input", () => {
      syncSubjectChoiceControl(selectEl, customEl);
      if (selectEl.id === "editInstructorSubject") scheduleInstructorDetailPreview();
    });
  }
}

function renderInstructorSubjectControl(selectSelector, customSelector, selectedValues = [], options = {}) {
  const selectEl = $(selectSelector);
  const customEl = $(customSelector);
  if (!selectEl) return;

  const subjects = normalizeSubjectList(getInstructorSubjectOptions());
  const selectedSubjects = normalizeSubjectList(selectedValues);
  const selectedSet = new Set(selectedSubjects);
  const primarySubject = getPrimarySubject(selectedSubjects);
  const customSubjects = selectedSubjects.filter((subject) => !subjects.includes(subject));
  const customInputValue = customSubjects[0] || "";
  const extraCustomSubjects = customSubjects.slice(1);

  selectEl.innerHTML = buildSubjectSelectHtml(subjects, {
    selected: primarySubject,
    emptyLabel: options.emptyLabel || "선택하세요",
    emptyValue: ""
  });
  selectEl.required = false;
  selectEl.classList.add("subject-select-hidden");
  selectEl.setAttribute("aria-hidden", "true");
  selectEl.tabIndex = -1;

  const container = ensureSubjectChoiceContainer(selectEl);
  if (!container) return;

  if (customEl) {
    customEl.value = customInputValue;
    customEl.classList.add("subject-choice-custom-input");
    customEl.placeholder = "과목명을 입력하세요";
  }

  const knownHtml = subjects.map((subject, index) => {
    const id = `${selectEl.id}SubjectChoice${index}`;
    const checked = selectedSet.has(subject);
    return `
      <label class="subject-choice-chip${checked ? " is-checked" : ""}" data-subject="${escapeHtml(subject)}" for="${id}">
        <input type="checkbox" id="${id}" value="${escapeHtml(subject)}" data-subject-option${checked ? " checked" : ""}>
        <span>${escapeHtml(subject)}</span>
      </label>
    `;
  }).join("");

  const extraCustomHtml = extraCustomSubjects.map((subject, index) => {
    const id = `${selectEl.id}CustomSubjectChoice${index}`;
    return `
      <label class="subject-choice-chip is-checked" data-subject="${escapeHtml(subject)}" for="${id}">
        <input type="checkbox" id="${id}" value="${escapeHtml(subject)}" data-subject-option data-custom-subject checked>
        <span>${escapeHtml(subject)}</span>
      </label>
    `;
  }).join("");

  const customId = `${selectEl.id}SubjectCustomToggle`;
  const customChecked = !!customInputValue;
  container.innerHTML = `
    ${knownHtml}
    ${extraCustomHtml}
    <label class="subject-choice-chip subject-choice-chip--custom${customChecked ? " is-checked" : ""}" for="${customId}">
      <input type="checkbox" id="${customId}" value="${SUBJECT_CUSTOM_VALUE}" data-subject-custom-toggle${customChecked ? " checked" : ""}>
      <span>직접 입력</span>
    </label>
  `;

  wireSubjectChoiceControl(selectEl, customEl);
  syncSubjectChoiceControl(selectEl, customEl);
}

function setInstructorSubjectControlValues(selectSelector, customSelector, values, options = {}) {
  renderInstructorSubjectControl(selectSelector, customSelector, values, options);
}

function getInstructorSubjectControlValues(selectSelector, customSelector) {
  return readSubjectChoiceValues($(selectSelector), $(customSelector));
}

// 초기화 함수
async function initializeInstructorList() {
  // DOM 요소가 준비될 때까지 대기
  let retries = 0;
  while (!initDOMElements() && retries < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retries++;
  }
  
  if (!tbody) {
    console.error("강사 목록 테이블을 찾을 수 없습니다. tblInstructors 요소가 존재하는지 확인하세요.");
    toast("강사 목록 테이블을 찾을 수 없습니다.", true);
    return;
  }
  
  if (isInitialized) {
    return; // 이미 초기화됨
  }
  
  isInitialized = true;
  
  setupSearchAndSort();
  setupInstructorSubjectControls();
  setupInstructorCatalogPanel();
  await initInstructorSubjectCatalog();
  await Promise.all([loadClassesData(), loadPublicInstructorDetailSections()]);
  await loadInstructorData();
  setupGlobalDetailSectionListeners();
}

async function loadInstructorData() {
  try {
    const [instSnap, accountsSnap] = await Promise.all([
      getDocsFromServer(collection(db, "instructors")),
      getDocsFromServer(collection(db, "instructorAccounts"))
    ]);
    instructorAccountsData = {};
    const accountsByInstructorId = {};
    accountsSnap.forEach((d) => {
      const data = d.data() || {};
      const uid = normalizeText(data.uid || d.id);
      if (!uid) return;
      const account = { id: d.id, ...data, uid };
      instructorAccountsData[uid] = account;
      const accountInstructorId = normalizeText(data.instructorId);
      if (accountInstructorId) accountsByInstructorId[accountInstructorId] = account;
    });

    instructorsData = {};
    instSnap.forEach((d) => {
      const data = d.data() || {};
      const profileDocId = d.id;
      const instructorId = normalizeText(data.instructorId || profileDocId);
      const account = getAccountSnapshotForProfile({ ...data, instructorId, profileDocId }, instructorAccountsData, accountsByInstructorId);
      const linkedUid = normalizeText(data.uid || account?.uid);
      const subjects = normalizeSubjectList([
        data.subject || account?.subject || "",
        ...(Array.isArray(data.subjects) ? data.subjects : []),
        ...(Array.isArray(account?.subjects) ? account.subjects : [])
      ]);
      instructorsData[profileDocId] = {
        ...data,
        profileDocId,
        id: instructorId,
        instructorId,
        uid: linkedUid || `pending_${profileDocId}`,
        accountUid: linkedUid,
        hasAccount: !!linkedUid,
        accountDocExists: !!account,
        email: data.email || account?.email || '',
        emailLower: data.emailLower || account?.emailLower || normalizeEmail(data.email || account?.email),
        subject: data.subject || account?.subject || subjects[0] || '',
        subjects,
        name: data.name || account?.name || ''
      };
    });
    await updateInstructorList();
  } catch (error) {
    if (error.code !== 'permission-denied') {
      console.error("강사 목록 로드 실패:", error);
      toast("강사 목록 로드 실패: " + (error.message || error), true);
    }
  }
}

window.refreshInstructors = async () => {
  await loadClassesData();
  await loadInstructorData();
  toast("강사 목록이 새로고침되었습니다.");
};

async function updateInstructorList() {
  // DOM 요소가 준비되지 않았으면 초기화 시도
  if (!tbody && !initDOMElements()) {
    console.warn("tbody가 아직 준비되지 않았습니다. 잠시 후 다시 시도합니다.");
    return;
  }
  
  if (!tbody) {
    console.error("강사 목록 테이블을 찾을 수 없습니다.");
    return;
  }
  
  try {
    const instructorsList = Object.values(instructorsData);

    if (instructorsList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">등록된 강사가 없습니다.</td></tr>';
      allInstructors = [];
      return;
    }

    // 각 강사에 담당 온라인 강좌/오프라인 반 요약 추가 (읽기 전용)
    const instructorsWithClasses = applyAssignmentSummaries(instructorsList);

    allInstructors = instructorsWithClasses;
    
    // 필터 옵션 업데이트
    await loadFilterOptions();
    
    // 필터 적용하여 렌더링
    applyFilters();
    
    // 페이지 리셋
    currentPage = 1;
  } catch (error) {
    console.error("강사 목록 로드 실패:", error);
    toast("데이터 로드 실패: " + (error.message || error), true);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
  }
}

// 페이지 로드 시 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeInstructorList);
} else {
  // DOM이 이미 로드된 경우
  initializeInstructorList();
}

// 필터 상태
let activeFilters = {
  subjects: new Set()
};

// 필터 패널 토글
window.toggleFilterPanel = () => {
  const panel = $("#filterPanel");
  const btn = $("#toggleFilters");
  if (panel && btn) {
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    btn.textContent = isVisible ? '필터 닫기' : '필터';
  }
};

// 필터 초기화
window.clearAllFilters = () => {
  activeFilters.subjects.clear();
  
  // 모든 체크박스 해제
  document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false);
  
  // 필터 적용
  applyFilters();
  updateFilterCount();
};

// 필터 적용
function applyFilters(resetPage = true) {
  let filtered = [...allInstructors];
  
  // 검색 필터
  const keyword = searchInput?.value.trim().toLowerCase() || '';
  if (keyword) {
    filtered = filtered.filter(instructor => {
      const name = (instructor.name || '').toLowerCase();
      const subjects = getInstructorSubjectLabel(instructor).toLowerCase();
      return name.includes(keyword) || subjects.includes(keyword);
    });
  }
  
  // 과목 필터
  if (activeFilters.subjects.size > 0) {
    filtered = filtered.filter(instructor => {
      return getInstructorSubjectValues(instructor)
        .some((subject) => activeFilters.subjects.has(subject));
    });
  }
  
  // 페이지 리셋 (필터/검색 변경 시에만)
  if (resetPage) {
    currentPage = 1;
  }
  renderInstructors(filtered);
}

// 필터 개수 업데이트
function updateFilterCount() {
  const count = activeFilters.subjects.size;
  const countEl = $("#filterCount");
  if (countEl) {
    if (count > 0) {
      countEl.textContent = `적용된 필터: ${count}개`;
      countEl.style.color = 'var(--brand)';
    } else {
      countEl.textContent = '';
    }
  }
}

// 필터 체크박스 변경 이벤트
function setupFilterCheckboxes() {
  // 과목 필터
  document.querySelectorAll('.filter-checkbox[data-type="subject"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const value = e.target.value;
      if (e.target.checked) {
        activeFilters.subjects.add(value);
      } else {
        activeFilters.subjects.delete(value);
      }
      applyFilters();
      updateFilterCount();
    });
  });
}

// 필터 옵션 로드
async function loadFilterOptions() {
  // 과목 목록
  const subjects = new Set();
  allInstructors.forEach(instructor => {
    getInstructorSubjectValues(instructor).forEach((subject) => subjects.add(subject));
  });
  activeFilters.subjects = new Set(
    Array.from(activeFilters.subjects).filter((subject) => subjects.has(subject))
  );
  
  const subjectFilters = $("#subjectFilters");
  if (subjectFilters) {
    if (subjects.size === 0) {
      subjectFilters.innerHTML = '<div class="muted" style="padding:4px;">등록된 과목이 없습니다.</div>';
    } else {
      const sortedSubjects = Array.from(subjects).sort();
      subjectFilters.innerHTML = sortedSubjects.map((subject, index) => `
        <div class="filter-checkbox-item">
          <input type="checkbox" id="filter_subject_${index}" value="${escapeHtml(subject)}" class="filter-checkbox" data-type="subject"${activeFilters.subjects.has(subject) ? " checked" : ""}>
          <label for="filter_subject_${index}">${escapeHtml(subject)}</label>
        </div>
      `).join('');
    }
  }
  
  // 체크박스 이벤트 설정
  setupFilterCheckboxes();
}

// 검색 기능 (초기화 후 설정)
function setupSearchAndSort() {
  // DOM 요소 다시 초기화
  initDOMElements();
  
  if (searchInput) {
    // 중복 이벤트 리스너 방지를 위해 한 번만 설정
    if (!searchInput.hasAttribute('data-listener-attached')) {
      searchInput.setAttribute('data-listener-attached', 'true');
      searchInput.addEventListener('input', async (e) => {
        applyFilters();
      });
    }
  }

  // 정렬 옵션 변경
  if (sortOption) {
    // 중복 이벤트 리스너 방지를 위해 한 번만 설정
    if (!sortOption.hasAttribute('data-listener-attached')) {
      sortOption.setAttribute('data-listener-attached', 'true');
      sortOption.addEventListener('change', (e) => {
        const value = e.target.value;
        const [field, direction] = value.split('_');
        currentSort = { field, direction };
        applyFilters();
      });
    }
  }
}

// 테이블 헤더 클릭 정렬
document.addEventListener('click', (e) => {
  const th = e.target.closest('.sortable');
  if (!th) return;
  
  const field = th.dataset.sort;
  if (!field) return;
  
  // 같은 필드면 방향 전환, 다른 필드면 오름차순으로
  if (currentSort.field === field) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.field = field;
    currentSort.direction = 'asc';
  }
  
  // 드롭다운 동기화
  if (sortOption) {
    const optionValue = `${currentSort.field}_${currentSort.direction}`;
    sortOption.value = optionValue;
  }
  
  applyFilters();
});

// 강사 정렬 함수
function sortInstructors(instructors, sortField, sortDirection) {
  const sorted = [...instructors];
  
  sorted.sort((a, b) => {
    let aVal, bVal;
    
    if (sortField === 'name') {
      aVal = (a.name || '').toLowerCase();
      bVal = (b.name || '').toLowerCase();
    } else if (sortField === 'subject') {
      aVal = getInstructorSubjectLabel(a).toLowerCase();
      bVal = getInstructorSubjectLabel(b).toLowerCase();
    } else if (sortField === 'createdAt') {
      aVal = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      bVal = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    } else {
      return 0;
    }
    
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
  
  return sorted;
}

// 통계 업데이트
function updateInstructorStats(instructors) {
  const total = instructors.length;
  const connected = instructors.filter(i => i.hasAccount).length;
  const pending = instructors.filter(i => !i.hasAccount).length;
  
  const statTotal = $("#statTotal");
  const statConnected = $("#statConnected");
  const statPending = $("#statPending");
  
  if (statTotal) statTotal.textContent = total;
  if (statConnected) statConnected.textContent = connected;
  if (statPending) statPending.textContent = pending;
}

// 정렬 아이콘 업데이트
function updateSortIcons() {
  $$('.sortable').forEach(th => {
    const field = th.dataset.sort;
    const icon = th.querySelector('.sort-icon');
    if (icon) {
      if (currentSort.field === field) {
        icon.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
        icon.style.color = 'var(--brand)';
      } else {
        icon.textContent = '⇅';
        icon.style.color = 'var(--muted)';
      }
    }
  });
}

async function renderInstructors(instructors) {
  if (!tbody && !initDOMElements()) {
    console.warn("tbody가 아직 준비되지 않았습니다.");
    return;
  }
  if (!tbody) return;

  // 정렬 적용
  let sortedInstructors = sortInstructors(instructors, currentSort.field, currentSort.direction);
  
  // 통계 업데이트
  updateInstructorStats(allInstructors);

  if (sortedInstructors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">검색 결과가 없습니다.</td></tr>';
    renderPagination(0);
    return;
  }

  // 페이지네이션 계산
  const totalPages = Math.ceil(sortedInstructors.length / itemsPerPage);
  
  // 현재 페이지가 유효한 범위인지 확인
  if (currentPage > totalPages) {
    currentPage = totalPages || 1;
  }
  if (currentPage < 1) {
    currentPage = 1;
  }

  // 현재 페이지에 표시할 강사 추출
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const instructorsToShow = sortedInstructors.slice(startIndex, endIndex);

  const rows = instructorsToShow.map(instructor => {
    const onlineCourseNames = instructor.onlineCourseNames || classNames[instructor.uid] || [];
    const offlineClassNameList = instructor.offlineClassNames || offlineClassNames[instructor.uid] || [];
    const onlineCourseCount = instructor.onlineCourseCount ?? classCounts[instructor.uid] ?? instructor.classCount ?? onlineCourseNames.length;
    const offlineClassCount = instructor.offlineClassCount ?? offlineClassCounts[instructor.uid] ?? offlineClassNameList.length;
    const isPending = !instructor.hasAccount;
    const email = instructor.email || '-';
    const subjectLabel = getInstructorSubjectLabel(instructor) || '-';
    const hasPhoto = !!getInstructorProfilePhotoPath(instructor);
    const instructorDetailUrl = instructor.id ? `/instructor-details.html?doc=${encodeURIComponent(instructor.id)}` : '#';
    const deleteButtonHtml = isLinkedInstructorProfile(instructor)
      ? ''
      : `<button class="btn sm danger" onclick="event.stopPropagation(); deleteUnlinkedInstructorProfile('${instructor.uid}')">프로필 삭제</button>`;
    const statusHtml = isPending
      ? `<span style="display:inline-flex;align-items:center;padding:4px 8px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;border-radius:999px;font-size:12px;font-weight:700;">프로필만 등록됨</span>
         <div class="muted" style="margin-top:4px;font-size:12px;">계정 미연결</div>`
      : `<span style="display:inline-flex;align-items:center;padding:4px 8px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;border-radius:999px;font-size:12px;font-weight:700;">계정 연결됨</span>`;
    
    return `
    <tr>
      <td>
        ${instructor.id ? `<strong><a href="${instructorDetailUrl}" target="_blank" style="color:var(--text);text-decoration:none;cursor:pointer;border-bottom:1px solid var(--border);">${instructor.name || '-'}</a></strong>` : `<strong>${instructor.name || '-'}</strong>`}
      </td>
      <td style="font-size:13px;">${email}</td>
      <td>${statusHtml}</td>
      <td class="subject-list-text">${escapeHtml(subjectLabel)}</td>
      <td style="text-align:center;">
        <span class="assignment-count-chip" title="배정 강좌 ${onlineCourseCount}개">${onlineCourseCount}개</span>
      </td>
      <td style="text-align:center;">
        <span class="assignment-count-chip assignment-count-chip--offline" title="배정 반 ${offlineClassCount}개">${offlineClassCount}개</span>
      </td>
      <td style="text-align:center;">
        ${hasPhoto 
          ? '<span style="color:var(--success-color);font-weight:700;display:inline-flex;align-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' 
          : '<span style="color:var(--muted);">-</span>'
        }
      </td>
      <td onclick="event.stopPropagation();">
        <div style="display:flex;gap:4px;">
          <button class="btn sm" onclick="event.stopPropagation(); openEditModal('${instructor.uid}')">수정</button>
          ${deleteButtonHtml}
        </div>
      </td>
    </tr>
    `;
  }).join('');

  tbody.innerHTML = rows;
  
  // 정렬 아이콘 업데이트
  updateSortIcons();
  
  // 페이지네이션 UI 렌더링
  renderPagination(sortedInstructors.length);
}

// 페이지네이션 UI 렌더링
function renderPagination(totalItems) {
  const paginationContainer = $("#paginationContainer");
  if (!paginationContainer) return;

  if (totalItems === 0) {
    paginationContainer.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (totalPages <= 1) {
    paginationContainer.innerHTML = '';
    return;
  }

  let paginationHTML = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:20px;flex-wrap:wrap;">';
  
  // 이전 페이지 버튼
  if (currentPage > 1) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(${currentPage - 1})" style="padding:6px 12px;">이전</button>`;
  } else {
    paginationHTML += `<button class="btn sm" disabled style="padding:6px 12px;opacity:0.5;cursor:not-allowed;">이전</button>`;
  }

  // 페이지 번호 버튼들
  const maxVisiblePages = 10;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // 시작 페이지 조정
  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // 첫 페이지
  if (startPage > 1) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(1)" style="padding:6px 12px;">1</button>`;
    if (startPage > 2) {
      paginationHTML += `<span style="padding:6px 4px;color:var(--muted);">...</span>`;
    }
  }

  // 페이지 번호들
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      paginationHTML += `<button class="btn sm" style="padding:6px 12px;background:var(--brand);color:#fff;border-color:var(--brand);" disabled>${i}</button>`;
    } else {
      paginationHTML += `<button class="btn sm" onclick="goToPage(${i})" style="padding:6px 12px;">${i}</button>`;
    }
  }

  // 마지막 페이지
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      paginationHTML += `<span style="padding:6px 4px;color:var(--muted);">...</span>`;
    }
    paginationHTML += `<button class="btn sm" onclick="goToPage(${totalPages})" style="padding:6px 12px;">${totalPages}</button>`;
  }

  // 다음 페이지 버튼
  if (currentPage < totalPages) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(${currentPage + 1})" style="padding:6px 12px;">다음</button>`;
  } else {
    paginationHTML += `<button class="btn sm" disabled style="padding:6px 12px;opacity:0.5;cursor:not-allowed;">다음</button>`;
  }

  // 페이지 정보 표시
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  paginationHTML += `<span style="margin-left:16px;color:var(--muted);font-size:13px;">${startItem}-${endItem} / 총 ${totalItems}명</span>`;

  paginationHTML += '</div>';
  paginationContainer.innerHTML = paginationHTML;
}

// 페이지 이동 함수
window.goToPage = (page) => {
  currentPage = page;
  applyFilters(false); // 페이지 리셋하지 않음
  
  // 페이지 상단으로 스크롤
  const table = $("#tblInstructors");
  if (table) {
    table.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

function renderAssignmentNameList(names, emptyText) {
  if (!names || names.length === 0) {
    return `<p class="assignment-empty">${emptyText}</p>`;
  }

  return `
    <ul>
      ${names.map((name) => `<li>${escapeHtml(String(name || ""))}</li>`).join("")}
    </ul>
  `;
}

function renderEditAccountStatus(instructor) {
  const target = $("#editInstructorAccountStatus");
  if (!target) return;

  const isLinked = !!instructor.hasAccount && !String(instructor.uid || "").startsWith("pending_");
  const statusLabel = isLinked ? "계정 연결됨" : "프로필만 등록됨";
  const statusClass = isLinked ? "account-linked" : "account-unlinked";
  const accountUid = normalizeText(instructor.accountUid || (isLinked ? instructor.uid : ""));
  const email = normalizeText(instructor.email);
  const accountDocStatus = instructor.accountDocExists ? "instructorAccounts 문서 확인됨" : "연결 문서 없음";

  target.innerHTML = `
    <p><span class="account-status-pill ${statusClass}">${statusLabel}</span></p>
    <div class="instructor-meta-list">
      <div class="instructor-meta-item">
        <span class="instructor-meta-label">프로필 문서 ID</span>
        <span class="instructor-meta-value">${escapeHtml(instructor.profileDocId || instructor.instructorId || "-")}</span>
      </div>
      <div class="instructor-meta-item">
        <span class="instructor-meta-label">계정 UID</span>
        <span class="instructor-meta-value">${escapeHtml(accountUid || "-")}</span>
      </div>
      <div class="instructor-meta-item">
        <span class="instructor-meta-label">이메일</span>
        <span class="instructor-meta-value">${escapeHtml(email || "-")}</span>
      </div>
      <div class="instructor-meta-item">
        <span class="instructor-meta-label">연결 문서</span>
        <span class="instructor-meta-value">${escapeHtml(isLinked ? accountDocStatus : "계정 미연결")}</span>
      </div>
    </div>
  `;
}

function renderEditAssignmentSummary(instructor) {
  const target = $("#editInstructorAssignmentSummary");
  if (!target) return;

  const onlineNames = instructor.onlineCourseNames || classNames[instructor.uid] || [];
  const offlineNames = instructor.offlineClassNames || offlineClassNames[instructor.uid] || [];
  const onlineCount = instructor.onlineCourseCount ?? onlineNames.length;
  const offlineCount = instructor.offlineClassCount ?? offlineNames.length;

  target.innerHTML = `
    <div class="assignment-summary-grid">
      <div class="assignment-summary-card">
        <h4>담당 온라인 강좌 <span class="assignment-count-chip">${onlineCount}개</span></h4>
      </div>
      <div class="assignment-summary-card">
        <h4>담당 오프라인 반 <span class="assignment-count-chip assignment-count-chip--offline">${offlineCount}개</span></h4>
      </div>
    </div>
    <div class="assignment-summary-actions">
      <button type="button" class="btn sm" data-assignment-detail-toggle aria-expanded="false">담당 보기</button>
    </div>
    <div class="assignment-inline-detail" data-assignment-inline-detail hidden>
      <section class="assignment-inline-section">
        <h4>담당 온라인 강좌</h4>
        <div class="assignment-inline-list">${renderAssignmentNameList(onlineNames, "담당 온라인 강좌가 없습니다.")}</div>
      </section>
      <section class="assignment-inline-section">
        <h4>담당 오프라인 반</h4>
        <div class="assignment-inline-list">${renderAssignmentNameList(offlineNames, "담당 오프라인 반이 없습니다.")}</div>
      </section>
    </div>
  `;

  const toggleButton = target.querySelector("[data-assignment-detail-toggle]");
  const detailPanel = target.querySelector("[data-assignment-inline-detail]");
  if (toggleButton && detailPanel) {
    toggleButton.addEventListener("click", () => {
      const isOpening = detailPanel.hidden;
      detailPanel.hidden = !isOpening;
      toggleButton.textContent = isOpening ? "담당 닫기" : "담당 보기";
      toggleButton.setAttribute("aria-expanded", String(isOpening));
    });
  }
}

function getProfileDocId(instructor = {}) {
  const pendingUid = String(instructor.uid || "").startsWith("pending_")
    ? String(instructor.uid).replace("pending_", "")
    : "";
  return normalizeText(instructor.profileDocId || instructor.instructorId || pendingUid);
}

function isLinkedInstructorProfile(instructor = {}) {
  const uid = normalizeText(instructor.accountUid || instructor.uid);
  return !!instructor.hasAccount || !!instructor.accountDocExists || (uid && !uid.startsWith("pending_"));
}

function getInstructorByUid(uid) {
  return allInstructors.find((item) => item.uid === uid);
}

function getInstructorReferenceKeys(instructor = {}) {
  const keys = getInstructorAssignmentKeys(instructor);
  const profileDocId = getProfileDocId(instructor);
  const accountUid = normalizeText(instructor.accountUid);
  const rawUid = normalizeText(instructor.uid);
  if (profileDocId) keys.add(profileDocId);
  if (accountUid) keys.add(accountUid);
  if (rawUid) keys.add(rawUid);
  return keys;
}

function getAssignmentRecordsForInstructor(instructor) {
  return {
    onlineCourses: onlineCourseRecords.filter((course) => isOnlineCourseAssignedToInstructor(course, instructor)),
    offlineClasses: offlineClassRecords.filter((offlineClass) => isOfflineClassAssignedToInstructor(offlineClass, instructor))
  };
}

function timetableEntryReferencesInstructor(entry, instructor) {
  const keys = getInstructorReferenceKeys(instructor);
  const name = normalizeText(instructor.name);
  const matchesKey = (value) => keys.has(normalizeText(value));

  if (matchesKey(entry.instructorUid)) return true;
  if (matchesKey(entry.instructorId)) return true;
  if (Array.isArray(entry.instructorUids) && entry.instructorUids.some(matchesKey)) return true;
  if (name && normalizeText(entry.instructorName) === name) return true;
  return false;
}

const SETTINGS_DELETE_SENTINEL = Symbol("deleteInstructorSettingReference");

function isPlainSettingsObject(value) {
  return value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function cleanInstructorSettingReferences(value, keys) {
  if (value == null) return value;
  if (typeof value === "string") {
    return keys.has(normalizeText(value)) ? SETTINGS_DELETE_SENTINEL : value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanInstructorSettingReferences(item, keys))
      .filter((item) => item !== SETTINGS_DELETE_SENTINEL);
  }
  if (isPlainSettingsObject(value)) {
    return Object.entries(value).reduce((cleaned, [key, nestedValue]) => {
      if (keys.has(normalizeText(key))) return cleaned;
      const cleanedValue = cleanInstructorSettingReferences(nestedValue, keys);
      if (cleanedValue !== SETTINGS_DELETE_SENTINEL) {
        cleaned[key] = cleanedValue;
      }
      return cleaned;
    }, {});
  }
  return value;
}

async function getCleanedInstructorMenuSettings(instructor) {
  const settingsRef = doc(db, "settings", "instructorsMenu");
  const settingsSnap = await getDoc(settingsRef);
  if (!settingsSnap.exists()) {
    return { settingsRef, cleanedSettings: null };
  }

  const keys = getInstructorReferenceKeys(instructor);
  const cleanedSettings = cleanInstructorSettingReferences(settingsSnap.data() || {}, keys);
  return { settingsRef, cleanedSettings };
}

async function collectInstructorDeleteBlockers(instructor) {
  const blockers = [];
  const profileDocId = getProfileDocId(instructor);
  const instructorId = normalizeText(instructor.instructorId || profileDocId);
  const accountUid = normalizeText(instructor.accountUid || (String(instructor.uid || "").startsWith("pending_") ? "" : instructor.uid));

  if (!profileDocId) {
    blockers.push("강사 프로필 문서 ID를 찾을 수 없습니다.");
    return blockers;
  }

  const profileSnap = await getDoc(doc(db, "instructors", profileDocId));
  if (!profileSnap.exists()) {
    blockers.push("강사 프로필 문서를 찾을 수 없습니다.");
    return blockers;
  }

  const freshProfile = profileSnap.data() || {};
  const freshUid = normalizeText(freshProfile.uid);
  if (freshUid) {
    blockers.push("연결된 계정 UID가 있는 프로필입니다.");
  }

  const accountChecks = [];
  if (accountUid || freshUid) {
    accountChecks.push(getDoc(doc(db, "instructorAccounts", accountUid || freshUid)));
  }
  if (instructorId) {
    accountChecks.push(getDocs(query(collection(db, "instructorAccounts"), where("instructorId", "==", instructorId))));
  }
  if (profileDocId && profileDocId !== instructorId) {
    accountChecks.push(getDocs(query(collection(db, "instructorAccounts"), where("instructorId", "==", profileDocId))));
  }

  const accountResults = await Promise.all(accountChecks);
  const hasMatchingAccount = accountResults.some((result) => {
    if ("exists" in result) return result.exists();
    return !result.empty;
  });
  if (hasMatchingAccount) {
    blockers.push("계정 연동 정보가 있는 강사입니다.");
  }

  const { onlineCourses, offlineClasses } = getAssignmentRecordsForInstructor(instructor);
  if (onlineCourses.length > 0) blockers.push(`담당 온라인 강좌 ${onlineCourses.length}개가 있습니다.`);
  if (offlineClasses.length > 0) blockers.push(`담당 오프라인 반 ${offlineClasses.length}개가 있습니다.`);

  const timetableSnap = await getDocs(collection(db, "publicTimetableEntries"));
  const timetableReferences = timetableSnap.docs.filter((entryDoc) => timetableEntryReferencesInstructor(entryDoc.data() || {}, instructor));
  if (timetableReferences.length > 0) {
    blockers.push(`공개 시간표 참조 ${timetableReferences.length}개가 있습니다.`);
  }

  return blockers;
}

window.deleteUnlinkedInstructorProfile = async (uid) => {
  const instructor = getInstructorByUid(uid);
  if (!instructor) {
    toast("강사 정보를 찾을 수 없습니다.", true);
    return;
  }

  if (isLinkedInstructorProfile(instructor)) {
    toast("연결된 계정을 먼저 해제해 주세요.", true);
    return;
  }

  let confirmationModal = null;
  try {
    const blockers = await collectInstructorDeleteBlockers(instructor);
    if (blockers.length > 0) {
      alert(`참조가 남아 있어 삭제할 수 없습니다.\n\n${blockers.join("\n")}`);
      return;
    }

    const profileDocId = getProfileDocId(instructor);
    const deleteMessage =
      `${instructor.name || "강사"} 프로필을 영구 삭제합니다.\n\n` +
      `삭제 대상: instructors/${profileDocId}\n` +
      "강사 프로필 문서가 삭제됩니다.\n" +
      "강사진 노출/정렬 설정에 남아 있는 이 강사 참조도 함께 정리됩니다.\n" +
      "Firebase Auth 로그인 계정은 삭제하지 않습니다.\n" +
      "계정이 연동된 강사는 이 화면에서 삭제할 수 없습니다.\n" +
      "계정 연동 정보가 있는 강사는 먼저 계정 생성/정리 화면에서 연동 해제 또는 데이터 정리를 진행하세요.\n" +
      "강좌/반/시간표 문서는 삭제하지 않습니다.";
    confirmationModal = await requestPhraseConfirmation({
      title: "강사 프로필 영구 삭제",
      message: deleteMessage,
      phrase: "강사 삭제",
      confirmLabel: "강사 삭제",
      pendingMessage: "강사 프로필을 삭제하는 중입니다.",
      notifyError: (errorMessage) => toast(errorMessage, true),
    });
    if (!confirmationModal) return;

    const batch = writeBatch(db);
    const instructorRef = doc(db, "instructors", profileDocId);
    const { settingsRef, cleanedSettings } = await getCleanedInstructorMenuSettings(instructor);
    if (cleanedSettings) {
      batch.set(settingsRef, { ...cleanedSettings, updatedAt: serverTimestamp() });
    }
    batch.delete(instructorRef);
    await batch.commit();
    invalidateSetting("instructorsMenu");
    toast("강사 프로필이 삭제되었습니다.");
    confirmationModal.success("강사 프로필이 삭제되었습니다.");
    window.closeEditModal(true);
    await Promise.all([loadClassesData(), loadPublicInstructorDetailSections()]);
    await loadInstructorData();
  } catch (error) {
    console.error("강사 프로필 삭제 실패:", error);
    const errorMessage = "삭제 실패: " + (error.message || error);
    toast(errorMessage, true);
    if (confirmationModal) confirmationModal.error(errorMessage);
  }
};

function setupEditPreviewListeners() {
  [
    ["#editInstructorName", "input"],
    ["#editInstructorSubject", "change"],
    ["#editInstructorBrief", "input"],
    ["#editInstructorIntro", "input"],
    ["#editInstructorPhoto", "input"],
    ["#editInstructorCurriculumImage", "input"],
    ["#editInstructorVideos", "input"]
  ].forEach(([selector, eventName]) => {
    const el = $(selector);
    if (!el || el.hasAttribute("data-preview-listener")) return;
    el.setAttribute("data-preview-listener", "1");
    el.addEventListener(eventName, () => scheduleInstructorDetailPreview());
  });
}

// YouTube URL에서 ID 추출 (ID만 입력해도 인식)
function extractYouTubeId(url) {
  if (!url) return null;
  
  // YouTube ID 패턴 (11자리 영문/숫자/하이픈/언더스코어)
  const youtubeIdPattern = /^[\w-]{11}$/;
  if (youtubeIdPattern.test(url.trim())) {
    return url.trim();
  }
  
  // URL 패턴들
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// YouTube URL을 표준 형식으로 변환
function normalizeVideoUrl(url) {
  if (!url) return { url: '', fullUrl: '', id: '', title: '' };
  
  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return {
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      fullUrl: `https://www.youtube.com/embed/${youtubeId}`,
      id: youtubeId,
      title: `YouTube Video ${youtubeId}`
    };
  }
  
  // MP4 URL인 경우
  if (url.endsWith('.mp4') || url.includes('.mp4')) {
    return {
      url: url,
      fullUrl: url,
      id: '',
      title: 'MP4 Video'
    };
  }
  
  return {
    url: url,
    fullUrl: url,
    id: '',
    title: 'Video'
  };
}

// 강사 수정 모달 열기
window.openEditModal = (uid) => {
  const instructor = allInstructors.find(i => i.uid === uid);
  if (!instructor) {
    toast("강사 정보를 찾을 수 없습니다.", true);
    return;
  }

  const modal = $("#editInstructorModal");
  const form = $("#editInstructorForm");
  
  if (modal && form) {
    clearModalAlert($("#editInstructorModalAlert"));
    clearProfilePhotoFieldAlert();
    clearImageLoadGuards();
    clearImagePathValidationCache();
    lastRenderedDetailPreviewKey = '';

    populateInstructorSubjectSelects();
    $("#editInstructorUid").value = instructor.uid;
    $("#editInstructorName").value = instructor.name || '';
    setInstructorSubjectControlValues(
      "#editInstructorSubject",
      "#editInstructorSubjectCustom",
      getInstructorSubjectValues(instructor),
      { emptyLabel: "비어있음" }
    );
    $("#editInstructorBrief").value = instructor.brief || '';
    $("#editInstructorIntro").value = instructor.bio || '';
    
    // 프로필 사진 경로 정규화: 상대 경로를 절대 경로로 변환
    let photoPath = getInstructorProfilePhotoPath(instructor);
    if (/^(data:|blob:)/i.test(photoPath)) {
      photoPath = '';
    } else if (photoPath && !photoPath.startsWith('http')) {
      // 상대 경로인 경우 절대 경로로 변환
      if (!photoPath.startsWith('/')) {
        photoPath = '/' + photoPath;
      }
    }
    $("#editInstructorPhoto").value = photoPath;
    $("#editInstructorNote").value = instructor.note || '';

    const curriculumImagePaths = Array.isArray(instructor.curriculumImageUrls) && instructor.curriculumImageUrls.length > 0
      ? instructor.curriculumImageUrls
      : [instructor.curriculumImageUrl || ''];
    renderCurriculumImageRows(
      curriculumImagePaths
        .map((path) => normalizeImagePath(path))
        .filter(Boolean)
    );
    
    // 영상 목록 (단일/복합 통합, 중복 제거 - YouTube ID 기준)
    const allVideos = [];
    const videoIdSet = new Set(); // YouTube ID 기준 중복 제거용 Set
    const videoUrlSet = new Set(); // URL 기준 중복 제거용 Set (MP4용)
    
    // URL을 정규화하여 YouTube ID 추출하는 헬퍼 함수
    const getVideoId = (url) => {
      if (!url) return null;
      return extractYouTubeId(url);
    };
    
    // URL을 표준 형식으로 변환하는 헬퍼 함수 (YouTube는 watch?v= 형식, MP4는 그대로)
    const normalizeUrlForDisplay = (url) => {
      if (!url) return '';
      const youtubeId = extractYouTubeId(url);
      if (youtubeId) {
        return `https://www.youtube.com/watch?v=${youtubeId}`;
      }
      return url.trim();
    };
    
    // videos 배열을 먼저 추가 (우선순위)
    if (instructor.videos && Array.isArray(instructor.videos)) {
      instructor.videos.forEach(v => {
        let videoUrl = '';
        if (typeof v === 'string') {
          videoUrl = v.trim();
        } else if (v && v.url) {
          videoUrl = v.url.trim();
        } else if (v && v.fullUrl) {
          // fullUrl은 embed 형식이므로 watch 형식으로 변환
          const youtubeId = extractYouTubeId(v.fullUrl);
          if (youtubeId) {
            videoUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
          } else {
            videoUrl = v.fullUrl.trim();
          }
        }
        
        if (videoUrl) {
          const videoId = getVideoId(videoUrl);
          const normalizedUrl = normalizeUrlForDisplay(videoUrl);
          
          if (videoId) {
            // YouTube 영상: ID 기준으로 중복 제거
            if (!videoIdSet.has(videoId)) {
              allVideos.push(normalizedUrl);
              videoIdSet.add(videoId);
            }
          } else {
            // MP4 영상: URL 기준으로 중복 제거
            if (!videoUrlSet.has(normalizedUrl)) {
              allVideos.push(normalizedUrl);
              videoUrlSet.add(normalizedUrl);
            }
          }
        }
      });
    }
    
    // 단일 필드들은 배열에 없을 때만 추가 (호환성)
    if (instructor.youtube_url && instructor.youtube_url.trim()) {
      const youtubeId = getVideoId(instructor.youtube_url);
      const normalizedUrl = normalizeUrlForDisplay(instructor.youtube_url);
      if (youtubeId && !videoIdSet.has(youtubeId)) {
        allVideos.push(normalizedUrl);
        videoIdSet.add(youtubeId);
      } else if (!youtubeId && !videoUrlSet.has(normalizedUrl)) {
        allVideos.push(normalizedUrl);
        videoUrlSet.add(normalizedUrl);
      }
    }
    if (instructor.video && instructor.video.trim()) {
      const videoId = getVideoId(instructor.video);
      const normalizedUrl = normalizeUrlForDisplay(instructor.video);
      if (videoId && !videoIdSet.has(videoId)) {
        allVideos.push(normalizedUrl);
        videoIdSet.add(videoId);
      } else if (!videoId && !videoUrlSet.has(normalizedUrl)) {
        allVideos.push(normalizedUrl);
        videoUrlSet.add(normalizedUrl);
      }
    }
    
    $("#editInstructorVideos").value = allVideos.join('\n');
    renderEditAccountStatus(instructor);
    renderEditAssignmentSummary(instructor);
    
    // 프로필 사진 URL 미리보기 설정
    const photoInput = $("#editInstructorPhoto");
    const previewDiv = $("#photoPreview");
    const previewImg = $("#photoPreviewImg");
    setupPhotoUrlPreview(photoInput, previewDiv, previewImg);
    refreshPhotoPreviewFromInput(photoInput, previewDiv, previewImg);

    setupCurriculumImageControls();
    updateInstructorDetailPreviewNow();
    setupEditPreviewListeners();
    
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
    editInstructorFormDirty.capture();
  }
};

// 이미지 미리보기 설정 함수
function normalizePhotoPreviewUrl(url) {
  let normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return '';
  if (/^(data:|blob:)/i.test(normalizedUrl)) return '';
  if (!normalizedUrl.startsWith('http')) {
    if (!normalizedUrl.startsWith('/')) {
      normalizedUrl = `/${normalizedUrl}`;
    }
  }
  return addImageCacheBuster(normalizedUrl);
}

function handlePhotoUrlInput(url, previewDiv, previewImg) {
  const normalizedForStatus = normalizeImagePath(url);

  if (!url) {
    hidePhotoPreview(previewDiv, previewImg);
    profilePhotoValidationToken++;
    setProfilePhotoStatus('', 'neutral');
    clearProfilePhotoFieldAlert();
    return;
  }

  if (!normalizedForStatus && !/^(data:|blob:)/i.test(url)) {
    hidePhotoPreview(previewDiv, previewImg);
    profilePhotoValidationToken++;
    setProfilePhotoStatus('', 'neutral');
    showProfilePhotoValidationError();
    return;
  }

  clearProfilePhotoFieldAlert();

  const normalizedUrl = normalizePhotoPreviewUrl(url);
  const previousUrl = previewImg.dataset.previewUrl || '';
  if (normalizedUrl !== previousUrl) {
    if (normalizedUrl) {
      resetImageLoadGuard(normalizedUrl);
    }
    previewImg.dataset.previewUrl = normalizedUrl;
  }
  showPhotoPreview(previewDiv, previewImg, normalizedUrl);
  validateProfilePhotoPath(normalizedForStatus || normalizedUrl);
}

function refreshPhotoPreviewFromInput(urlInput, previewDiv, previewImg) {
  if (!urlInput || !previewDiv || !previewImg) return;
  handlePhotoUrlInput(urlInput.value.trim(), previewDiv, previewImg);
}

function setupPhotoUrlPreview(urlInput, previewDiv, previewImg) {
  if (!urlInput || !previewDiv || !previewImg) return;

  if (!urlInput.hasAttribute('data-preview-bound')) {
    urlInput.setAttribute('data-preview-bound', '1');
    urlInput.addEventListener('input', (e) => {
      clearTimeout(photoPreviewInputTimer);
      const nextUrl = e.target.value.trim();
      photoPreviewInputTimer = window.setTimeout(() => {
        handlePhotoUrlInput(nextUrl, previewDiv, previewImg);
      }, 150);
    });
  }
}

function hidePhotoPreview(previewDiv, previewImg) {
  if (!previewDiv || !previewImg) return;
  previewDiv.style.display = 'none';
  previewImg.removeAttribute('data-load-key');
  previewImg.removeAttribute('data-load-state');
  previewImg.removeAttribute('src');
  previewImg.onload = null;
  previewImg.onerror = null;
}

function showPhotoPreview(previewDiv, previewImg, url, { onMissing = null } = {}) {
  if (!previewDiv || !previewImg || !url) {
    hidePhotoPreview(previewDiv, previewImg);
    return;
  }

  if (isImageLoadExhausted(url)) {
    if (typeof onMissing === 'function') {
      onMissing();
      return;
    }
    hidePhotoPreview(previewDiv, previewImg);
    setProfilePhotoStatus('이미지를 불러올 수 없습니다. URL을 확인한 뒤 다시 입력해 주세요.', 'warning');
    return;
  }

  previewDiv.style.display = 'block';
  assignImageSrc(previewImg, url, {
    allowFallbackOnce: true,
    fallbackSrc: INSTRUCTOR_PROFILE_PLACEHOLDER,
    onGiveUp: () => {
      if (typeof onMissing === 'function') {
        onMissing();
        return;
      }
      hidePhotoPreview(previewDiv, previewImg);
      setProfilePhotoStatus('이미지를 불러올 수 없습니다. URL을 확인한 뒤 다시 입력해 주세요.', 'warning');
    },
  });
}

function normalizeImagePath(path) {
  const value = String(path || '').trim();
  if (!value) return '';
  if (value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }
  const normalizedRemoteOrLocal = normalizePublicImageUrl(value, {
    field: PUBLIC_IMAGE_FIELD.instructorProfile,
    allowEmpty: false,
  });
  if (normalizedRemoteOrLocal) return normalizedRemoteOrLocal;
  if (value.startsWith('http')) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

// Legacy local rollback path (신규 R2 운영: public/instructors/image/)
const CURRICULUM_IMAGE_BASE_PATH = '/assets/instructors/curriculum/';
const MAX_CURRICULUM_IMAGES = 4;
let profilePhotoValidationToken = 0;

function getStatusColor(tone) {
  if (tone === 'success') return 'var(--success-color)';
  if (tone === 'warning') return 'var(--error-color)';
  return 'var(--muted)';
}

function upsertInlineStatus(container, className, message, tone = 'neutral') {
  if (!container) return null;
  let status = container.querySelector(`.${className}`);
  if (!status) {
    status = document.createElement('p');
    status.className = className;
    status.style.cssText = 'margin-top:4px;font-size:12px;';
    container.appendChild(status);
  }
  status.textContent = message || '';
  status.style.color = getStatusColor(tone);
  return status;
}

function getImagePathCheckingMessage() {
  return '이미지 URL을 확인 중입니다...';
}

function getImagePathConfirmedMessage() {
  return '이미지 URL에서 미리보기를 불러왔습니다.';
}

function getImagePathMissingMessage() {
  return '이미지 URL을 불러올 수 없습니다. R2 public URL 또는 rollback용 /assets 경로를 확인하세요.';
}

function setProfilePhotoStatus(message, tone = 'neutral', className = 'photo-path-status') {
  return upsertInlineStatus($("#photoPreview"), className, message, tone);
}

function validateProfilePhotoPath(path) {
  const normalized = normalizeImagePath(path);
  const token = ++profilePhotoValidationToken;
  if (!normalized || /^(data:|blob:)/i.test(normalized)) {
    setProfilePhotoStatus('', 'neutral');
    return;
  }

  if (isRemotePublicImageUrl(normalized)) {
    imagePathValidationCache.set(normalized, 'ok');
    setProfilePhotoStatus('공개 URL 확인 완료', 'success');
    return;
  }

  const cached = imagePathValidationCache.get(normalized);
  if (cached === 'ok') {
    setProfilePhotoStatus(getImagePathConfirmedMessage(), 'success');
    return;
  }
  if (cached === 'fail' || isImageLoadExhausted(normalized)) {
    setProfilePhotoStatus(getImagePathMissingMessage(), 'warning');
    return;
  }

  setProfilePhotoStatus(getImagePathCheckingMessage(), 'neutral');
  probeImageUrl(normalized).then((ok) => {
    if (token !== profilePhotoValidationToken) return;
    imagePathValidationCache.set(normalized, ok ? 'ok' : 'fail');
    if (ok) {
      setProfilePhotoStatus(getImagePathConfirmedMessage(), 'success');
      return;
    }
    setProfilePhotoStatus(getImagePathMissingMessage(), 'warning');
  });
}

function normalizeCurriculumImagePath(path) {
  const normalized = normalizePublicImageUrl(path, {
    field: PUBLIC_IMAGE_FIELD.instructorCurriculum,
    allowEmpty: true,
  });
  if (normalized) return normalized;

  const value = String(path || '').trim();
  if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
  const localPath = value.startsWith('/') ? value : `/${value}`;
  if (!localPath.startsWith(CURRICULUM_IMAGE_BASE_PATH)) return localPath;
  return localPath;
}

function getCurriculumImageList() {
  return $("#curriculumImageList");
}

function getCurriculumImageRows() {
  const list = getCurriculumImageList();
  return list ? $$("[data-curriculum-image-row]", list) : [];
}

function getCurriculumImageInputs() {
  const list = getCurriculumImageList();
  return list ? $$(".curriculum-image-input", list) : [];
}

function getCurriculumImageRawValues() {
  return getCurriculumImageInputs().map((input) => input.value.trim());
}

function getCurriculumImageValues() {
  const seen = new Set();
  return getCurriculumImageRawValues()
    .map((value) => normalizeCurriculumImagePath(value))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, MAX_CURRICULUM_IMAGES);
}

function revokeCurriculumRowObjectUrl(row) {
  const objectUrl = row?.dataset?.curriculumObjectUrl;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    delete row.dataset.curriculumObjectUrl;
  }
}

function setCurriculumRowStatus(row, message, tone = 'neutral') {
  const fields = row?.querySelector('.curriculum-image-fields');
  return upsertInlineStatus(fields, 'curriculum-image-status', message, tone);
}

function validateCurriculumRowPath(row, path) {
  const normalized = normalizeCurriculumImagePath(path);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (!row) return;
  row.dataset.curriculumValidationToken = token;

  if (!normalized || /^(data:|blob:)/i.test(normalized)) {
    setCurriculumRowStatus(row, '', 'neutral');
    return;
  }

  if (isRemotePublicImageUrl(normalized)) {
    imagePathValidationCache.set(normalized, 'ok');
    setCurriculumRowStatus(row, '공개 URL 확인 완료', 'success');
    return;
  }

  const cached = imagePathValidationCache.get(normalized);
  if (cached === 'ok') {
    setCurriculumRowStatus(row, getImagePathConfirmedMessage(), 'success');
    return;
  }
  if (cached === 'fail' || isImageLoadExhausted(normalized)) {
    setCurriculumRowStatus(row, getImagePathMissingMessage(), 'warning');
    return;
  }

  setCurriculumRowStatus(row, getImagePathCheckingMessage(), 'neutral');
  probeImageUrl(normalized).then((ok) => {
    if (row.dataset.curriculumValidationToken !== token) return;
    imagePathValidationCache.set(normalized, ok ? 'ok' : 'fail');
    if (ok) {
      setCurriculumRowStatus(row, getImagePathConfirmedMessage(), 'success');
      return;
    }
    setCurriculumRowStatus(row, getImagePathMissingMessage(), 'warning');
  });
}

function setCurriculumRowThumbnail(row, src = '', useObjectUrl = false) {
  const thumb = row?.querySelector("[data-curriculum-image-thumb]");
  if (!thumb) return;

  if (!useObjectUrl) {
    revokeCurriculumRowObjectUrl(row);
  }
  thumb.replaceChildren();

  if (!src) {
    const placeholder = document.createElement('span');
    placeholder.textContent = '미리보기';
    thumb.appendChild(placeholder);
    thumb.classList.remove('has-image');
    setCurriculumRowStatus(row, '', 'neutral');
    return;
  }

  const image = document.createElement('img');
  image.alt = '참고 자료 이미지 미리보기';
  image.loading = 'lazy';
  thumb.classList.add('has-image');
  thumb.appendChild(image);

  if (useObjectUrl) {
    image.src = src;
    return;
  }

  if (isImageLoadExhausted(src)) {
    setCurriculumRowThumbnail(row);
    setCurriculumRowStatus(row, '이미지를 불러올 수 없습니다.', 'warning');
    return;
  }

  assignImageSrc(image, src, {
    onGiveUp: () => {
      setCurriculumRowThumbnail(row);
      setCurriculumRowStatus(row, '이미지를 불러올 수 없습니다.', 'warning');
    },
  });
}

function scheduleCurriculumRowUpdate(row) {
  if (!row) return;
  const previousTimer = curriculumRowTimers.get(row);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }
  const timer = window.setTimeout(() => {
    curriculumRowTimers.delete(row);
    updateCurriculumRowThumbnail(row);
    scheduleInstructorDetailPreview();
  }, 150);
  curriculumRowTimers.set(row, timer);
}

function updateCurriculumRowThumbnail(row) {
  const input = row?.querySelector('.curriculum-image-input');
  const normalized = normalizeCurriculumImagePath(input?.value || '');
  const nextSrc = normalized ? addImageCacheBuster(normalized) : '';
  if (nextSrc && nextSrc !== row?.dataset?.curriculumThumbSrc) {
    resetImageLoadGuard(nextSrc);
  }
  if (row?.dataset?.curriculumThumbSrc === nextSrc) {
    validateCurriculumRowPath(row, normalized);
    return;
  }
  if (row) {
    row.dataset.curriculumThumbSrc = nextSrc;
  }
  setCurriculumRowThumbnail(row, nextSrc);
  validateCurriculumRowPath(row, normalized);
}


function updateCurriculumImageRemoveButtons() {
  const inputs = getCurriculumImageInputs();
  const list = getCurriculumImageList();
  if (!list) return;
  const showRemove = inputs.length > 1;
  $$("[data-curriculum-image-remove]", list).forEach((button) => {
    button.hidden = !showRemove;
  });
  updateCurriculumImageAddButton();
}

function updateCurriculumImageAddButton() {
  const addButton = $("#addCurriculumImageButton");
  if (!addButton) return;
  const isMax = getCurriculumImageInputs().length >= MAX_CURRICULUM_IMAGES;
  addButton.disabled = isMax;
  addButton.title = isMax ? "참고 자료 이미지는 최대 4개까지 등록할 수 있습니다." : "";
}

function renderCurriculumImageRows(paths = []) {
  const list = getCurriculumImageList();
  if (!list) return;

  getCurriculumImageRows().forEach((row) => revokeCurriculumRowObjectUrl(row));
  const values = (paths.length > 0 ? paths : [""]).slice(0, MAX_CURRICULUM_IMAGES);
  list.replaceChildren();
  values.forEach((path, index) => {
    const row = document.createElement('div');
    row.className = 'curriculum-image-row';
    row.setAttribute('data-curriculum-image-row', '');

    const thumb = document.createElement('div');
    thumb.className = 'curriculum-image-thumb';
    thumb.setAttribute('data-curriculum-image-thumb', '');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'curriculum-image-input';
    input.placeholder = 'https://assets.gritedu.kr/public/instructors/image/파일명.webp';
    input.value = path;
    if (index === 0) {
      input.id = 'editInstructorCurriculumImage';
    }
    input.addEventListener('input', () => {
      scheduleCurriculumRowUpdate(row);
    });

    const fields = document.createElement('div');
    fields.className = 'curriculum-image-fields';

    const actions = document.createElement('div');
    actions.className = 'curriculum-image-row-actions';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn sm curriculum-image-remove';
    removeButton.setAttribute('data-curriculum-image-remove', '');
    removeButton.textContent = '삭제';
    removeButton.addEventListener('click', () => {
      revokeCurriculumRowObjectUrl(row);
      row.remove();
      if (getCurriculumImageInputs().length === 0) {
        renderCurriculumImageRows([""]);
        return;
      }
      const firstInput = getCurriculumImageInputs()[0];
      if (firstInput && !firstInput.id) firstInput.id = 'editInstructorCurriculumImage';
      updateCurriculumImageRemoveButtons();
      updateInstructorDetailPreview();
    });

    actions.append(removeButton);
    fields.append(input, actions);
    row.append(thumb, fields);
    list.appendChild(row);
    updateCurriculumRowThumbnail(row);
  });

  updateCurriculumImageRemoveButtons();
}

function setupCurriculumImageControls() {
  const addButton = $("#addCurriculumImageButton");
  if (addButton && !addButton.hasAttribute('data-curriculum-listener')) {
    addButton.setAttribute('data-curriculum-listener', '1');
    addButton.addEventListener('click', () => {
      if (getCurriculumImageInputs().length >= MAX_CURRICULUM_IMAGES) {
        toast("참고 자료 이미지는 최대 4개까지 등록할 수 있습니다.", true);
        updateCurriculumImageAddButton();
        return;
      }
      renderCurriculumImageRows([...getCurriculumImageRawValues(), ""]);
      getCurriculumImageInputs().at(-1)?.focus();
    });
  }
  updateCurriculumImageAddButton();
}

// 강사 수정 모달 닫기
window.closeEditModal = async (force = false) => {
  if (!force && !(await confirmDiscardIfDirty(editInstructorFormDirty))) return;
  clearTimeout(instructorDetailPreviewTimer);
  clearTimeout(photoPreviewInputTimer);
  instructorDetailPreviewTimer = 0;
  photoPreviewInputTimer = 0;
  lastRenderedDetailPreviewKey = '';

  const modal = $("#editInstructorModal");
  if (modal) {
    modal.style.display = 'none';
    clearModalAlert($("#editInstructorModalAlert"));
    clearProfilePhotoFieldAlert();
    
    // color input 필드들을 유효한 기본값으로 설정 (빈 값 경고 방지)
    const colorInputs = modal.querySelectorAll('input[type="color"]');
    colorInputs.forEach(input => {
      if (!input.value || input.value === '') {
        input.value = '#000000'; // 기본 검은색
      }
    });
    
    $("#editInstructorForm")?.reset();
    setInstructorSubjectControlValues(
      "#editInstructorSubject",
      "#editInstructorSubjectCustom",
      [],
      { emptyLabel: "비어있음" }
    );
    
    // color input 필드들을 다시 기본값으로 설정 (reset 후에도 유지)
    colorInputs.forEach(input => {
      input.value = '#000000';
    });
    
    // 프로필 사진 미리보기 초기화
    const photoPreview = $("#photoPreview");
    const photoPreviewImg = $("#photoPreviewImg");
    if (photoPreview && photoPreviewImg) {
      const profileObjectUrl = photoPreviewImg.getAttribute('data-profile-object-url');
      if (profileObjectUrl) {
        URL.revokeObjectURL(profileObjectUrl);
      }
      photoPreview.style.display = 'none';
      photoPreviewImg.src = '';
      photoPreviewImg.removeAttribute('data-blob-url');
      photoPreviewImg.removeAttribute('data-profile-object-url');
    }

    renderCurriculumImageRows([""]);
    
    const preview = $("#instructorDetailPreview");
    if (preview) {
      preview.innerHTML = '<p class="muted" style="text-align:center;padding:40px;color:var(--muted);">미리보기가 여기에 표시됩니다.</p>';
    }
    const prevWrap = $("#adminInstructorPreviewWrap");
    if (prevWrap) prevWrap.style.display = "";
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }
};

// 강사 수정 폼 제출
const editForm = $("#editInstructorForm");
if (editForm) {
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const uid = $("#editInstructorUid")?.value;
    const name = $("#editInstructorName")?.value.trim();
    const selectedSubjects = getInstructorSubjectControlValues("#editInstructorSubject", "#editInstructorSubjectCustom");
    const subjectPayload = getSubjectSavePayload(selectedSubjects);
    const subject = subjectPayload.subject || '';
    const subjects = subjectPayload.subjects;
    const brief = $("#editInstructorBrief")?.value.trim();
    const bio = $("#editInstructorIntro")?.value.trim();
    const curriculumImageUrls = getCurriculumImageValues();
    for (const curriculumUrl of curriculumImageUrls) {
      if (!normalizePublicImageUrl(curriculumUrl, {
        field: PUBLIC_IMAGE_FIELD.instructorCurriculum,
        allowEmpty: false,
      })) {
        const message = getInstructorCurriculumValidationMessage();
        toast(message, true);
        setModalAlert($("#editInstructorModalAlert"), message, true);
        return;
      }
    }
    const curriculumImageUrl = curriculumImageUrls[0] || '';
    const note = $("#editInstructorNote")?.value.trim();

    if (!uid || !name) {
      toast("이름은 필수 항목입니다.", true);
      return;
    }

    const currentInstructor = allInstructors.find((item) => item.uid === uid);
    const profileDocId = normalizeText(
      currentInstructor?.profileDocId ||
      currentInstructor?.instructorId ||
      (String(uid).startsWith("pending_") ? uid.replace("pending_", "") : "")
    );
    const conflict = findInstructorProfileConflict(name, subjects, profileDocId);
    if (conflict) {
      toast(formatInstructorConflictMessage(conflict), true);
      return;
    }
    
    let photo = $("#editInstructorPhoto")?.value.trim() || '';
    const rawPhotoInput = photo;
    photo = normalizePersistableInstructorProfilePhoto(photo);
    if (rawPhotoInput && !photo) {
      showProfilePhotoValidationError();
      return;
    }

    // 영상 목록 파싱 (단일/복합 통합)
    const videosText = $("#editInstructorVideos")?.value.trim() || '';
    const videoUrls = videosText.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    const videos = videoUrls.map(url => normalizeVideoUrl(url));

    try {
      const currentInstructor = allInstructors.find((item) => item.uid === uid);
      if (!currentInstructor) {
        toast("강사 정보를 찾을 수 없습니다.", true);
        return;
      }

      const isLinkedInstructor = currentInstructor.hasAccount && !String(uid).startsWith("pending_");
      const accountUid = normalizeText(currentInstructor.accountUid || (isLinkedInstructor ? uid : ""));
      const profileDocId = normalizeText(currentInstructor.profileDocId || currentInstructor.instructorId || (String(uid).startsWith("pending_") ? uid.replace("pending_", "") : ""));
      const instructorId = normalizeText(currentInstructor.instructorId || profileDocId);
      if (!profileDocId || !instructorId) {
        toast("강사 프로필 문서 ID를 찾을 수 없습니다.", true);
        return;
      }

      const updateData = {
        name,
        subject,
        subjects,
        brief,
        bio,
        photo,
        profilePhoto: deleteField(),
        youtube_url: deleteField(),
        video: deleteField(),
        note,
        curriculumImageUrl,
        curriculumImageUrls,
        videos,
        instructorId: instructorId,
        updatedAt: serverTimestamp()
      };

      const instructorRef = doc(db, "instructors", profileDocId);
      const instructorDoc = await getDoc(instructorRef);
      if (!instructorDoc.exists()) {
        toast("강사 정보를 찾을 수 없습니다.", true);
        return;
      }

      if (!isLinkedInstructor) {
        await setDoc(instructorRef, {
          ...updateData,
          instructorId
        }, { merge: true });

        await loadInstructorData();
        toast("강사 정보가 수정되었습니다. 최신 목록을 반영했습니다.");
        closeEditModal(true);
      } else {
        const email = currentInstructor.email || instructorDoc.data()?.email || "";
        await setDoc(instructorRef, {
          ...updateData,
          uid: accountUid,
          email,
          emailLower: instructorDoc.data()?.emailLower || normalizeEmail(email),
          pending: false
        }, { merge: true });

        if (accountUid) {
          try {
            await setDoc(doc(db, "instructorAccounts", accountUid), buildInstructorAccountSnapshot({
              uid: accountUid,
              instructorId,
              name,
              email,
              subject,
              subjects
            }), { merge: true });
          } catch (accountErr) {
            console.warn("[admin-instructors] instructorAccounts mirror failed:", accountErr);
          }
        }

        // 해당 강사가 담당하는 모든 강의의 instructorName 업데이트
        if (updateData.name && accountUid) {
          try {
            const coursesSnapshot = await getDocs(
              query(collection(db, "courses"), where("instructorUid", "==", accountUid))
            );

            if (!coursesSnapshot.empty) {
              const batch = [];
              coursesSnapshot.forEach((courseDoc) => {
                batch.push(
                  setDoc(doc(db, "courses", courseDoc.id), {
                    instructorName: updateData.name,
                    updatedAt: serverTimestamp()
                  }, { merge: true })
                );
              });
              await Promise.all(batch);
              console.log(`강의 ${coursesSnapshot.size}개의 강사 이름이 업데이트되었습니다.`);
            }
          } catch (error) {
            console.warn("강의 강사 이름 업데이트 실패 (무시):", error);
          }
        }

        await loadInstructorData();
        toast("강사 정보가 수정되었습니다. 최신 목록을 반영했습니다.");
        closeEditModal(true);
      }
    } catch (error) {
      console.error("강사 수정 실패:", error);
      toast("수정 실패: " + (error.message || error), true);
    }
  });
}

// 엑셀 다운로드
$("#dlInstructors")?.addEventListener("click", async () => {
  try {
    // 캐시된 담당 반 수 사용 (성능 개선)
    const instructorsWithClasses = allInstructors.map(i => ({
      이름: i.name || "",
      과목: getInstructorSubjectLabel(i) || "",
      한줄소개: i.brief || "",
      약력: i.bio || "",
      "담당 강좌 수": i.hasAccount ? (classCounts[i.uid] || 0) : 0,
      비고: i.note || ""
    }));

    const ws = XLSX.utils.json_to_sheet(instructorsWithClasses);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "강사");
    XLSX.writeFile(wb, "그릿에듀_강사목록.xlsx");
    toast("엑셀 파일이 다운로드되었습니다.");
  } catch (error) {
    console.error("엑셀 다운로드 실패:", error);
    toast("엑셀 다운로드 실패: " + (error.message || error), true);
  }
});

function renderFormattedBioPreview(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const rows = lines.map((line) => {
    const match = line.match(/^(現|현|前|전)\s*\)\s*(.*)$/);
    if (!match) {
      return `<div class="instructor-bio-row">${escapeHtml(line)}</div>`;
    }

    const prefix = `${match[1]})`;
    const prefixClass = match[1] === "現" || match[1] === "현" ? "is-current" : "is-previous";
    return `
      <div class="instructor-bio-row">
        <span class="instructor-bio-prefix ${prefixClass}">${prefix}</span>
        <span class="instructor-bio-text">${escapeHtml(match[2].trim())}</span>
      </div>
    `;
  }).join("");

  return `<div class="instructor-bio-formatted">${rows}</div>`;
}

// 강사 상세 페이지 미리보기 업데이트
window.updateInstructorDetailPreview = () => {
  scheduleInstructorDetailPreview();
};

function updateInstructorDetailPreviewNow() {
  const preview = $("#instructorDetailPreview");
  if (!preview) return;

  const wrap = $("#adminInstructorPreviewWrap");
  if (wrap) wrap.style.display = "";

  const S = readGlobalDetailSectionFromUi();
  
  const name = $("#editInstructorName")?.value.trim() || '강사명';
  const subject = getInstructorSubjectControlValues("#editInstructorSubject", "#editInstructorSubjectCustom").join(", ");
  const brief = $("#editInstructorBrief")?.value.trim() || '';
  const bio = $("#editInstructorIntro")?.value.trim() || '';
  const photoInputValue = $("#editInstructorPhoto")?.value.trim() || '';
  const safePhoto = sanitizePublicImageSrc(photoInputValue, { field: PUBLIC_IMAGE_FIELD.instructorProfile });
  const curriculumImageUrls = getCurriculumImageValues();
  const safeName = escapeHtml(name);
  const safeSubject = escapeHtml(subject);
  const safeBrief = escapeHtml(brief || "끝까지 해내는 힘");
  const formattedBio = renderFormattedBioPreview(bio);
  
  const videosText = $("#editInstructorVideos")?.value.trim() || '';
  const videoUrls = videosText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const mediaKey = JSON.stringify({
    photo: safePhoto || '',
    curriculum: curriculumImageUrls,
  });
  const textKey = JSON.stringify({
    name,
    subject,
    brief,
    bio,
    videos: videoUrls,
    sections: S,
  });
  const nextPreviewKey = `${mediaKey}::${textKey}`;
  if (nextPreviewKey === lastRenderedDetailPreviewKey) {
    return;
  }
  lastRenderedDetailPreviewKey = nextPreviewKey;

  const photoWithCacheBuster = safePhoto ? addImageCacheBuster(safePhoto) : '';
  
  let html = `
    <div class="instructor-hero">
      <div class="hero-photo-wrapper">
        ${photoWithCacheBuster && !isImageLoadExhausted(photoWithCacheBuster)
    ? `<img class="hero-photo" data-guarded-src="${escapeHtml(photoWithCacheBuster)}" alt="${safeName}" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">`
    : photoWithCacheBuster
      ? `<div style="width:100%;aspect-ratio:3/4;border-radius:12px;background:var(--hover);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px;">이미지를 불러올 수 없음</div>`
      : `<div style="width:100%;aspect-ratio:3/4;border-radius:12px;background:var(--hover);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px;">프로필 사진 없음</div>`}
      </div>
      <div class="hero-content">
        <p class="hero-headline">${safeBrief}</p>
        <h1 class="hero-title">
          <span>${safeName}</span>
          <span class="hero-sub">${safeSubject}</span>
        </h1>
        ${formattedBio ? `<div class="hero-lead">${formattedBio}</div>` : ''}
      </div>
    </div>
    <div class="instructor-sections">
  `;
  
  // 1) 소개 영상
  if (S.video && videoUrls.length > 0) {
    html += `
      <section class="section-card">
        <h2 class="section-title">소개 영상</h2>
        <div class="video-grid">
    `;
    videoUrls.forEach((url, index) => {
      const videoInfo = normalizeVideoUrl(url);
      if (videoInfo.id) {
        // YouTube 영상
        html += `
          <div style="margin-bottom:20px;">
            <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;background:#000;">
              <iframe 
                src="https://www.youtube.com/embed/${videoInfo.id}" 
                style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen>
              </iframe>
            </div>
          </div>
        `;
      } else {
        // MP4 영상
        html += `
          <div style="margin-bottom:20px;">
            <video controls style="width:100%;border-radius:8px;background:#000;" src="${videoInfo.url}">
              브라우저가 비디오 태그를 지원하지 않습니다.
            </video>
          </div>
        `;
      }
    });
    html += `
        </div>
      </section>
    `;
  }
  
  // 2) 참고 자료 이미지
  if (S.curriculum && curriculumImageUrls.length > 0) {
    html += `
      <section class="section-card">
        <h2 class="section-title">참고 자료</h2>
        <div class="curriculum-preview-panel curriculum-preview-grid">
          ${curriculumImageUrls.map((path, index) => {
            const guardedSrc = addImageCacheBuster(path);
            if (isImageLoadExhausted(guardedSrc)) {
              return `
            <figure class="curriculum-preview-item">
              <div style="min-height:120px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">이미지를 불러올 수 없음</div>
              <figcaption>${escapeHtml(path)}</figcaption>
            </figure>
          `;
            }
            return `
            <figure class="curriculum-preview-item">
              <img data-guarded-src="${escapeHtml(guardedSrc)}" alt="참고 자료 이미지 ${index + 1}">
              <figcaption>${escapeHtml(path)}</figcaption>
            </figure>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }
  
  // 3) 담당 강의 (목록은 공개 페이지 전용)
  if (S.courses) {
    html += `
      <section class="section-card">
        <h2 class="section-title">담당 강좌</h2>
        <p class="muted" style="margin:0;">공개 사이트에는 실제 강좌가 표시됩니다.</p>
      </section>
    `;
  }

  html += `</div>`;
  
  preview.innerHTML = html || '<p class="muted" style="text-align:center;padding:40px;color:var(--muted);">미리보기가 여기에 표시됩니다.</p>';
  bindGuardedPreviewImages(preview);
};


// 강사 정보만 추가 모달 열기
window.openAddInstructorInfoModal = () => {
  const modal = $("#addInstructorInfoModal");
  const form = $("#addInstructorInfoForm");
  
  if (modal && form) {
    form.reset();
    clearModalAlert($("#addInstructorModalAlert"));
    populateInstructorSubjectSelects();
    setInstructorSubjectControlValues(
      "#addInstructorInfoSubject",
      "#addInstructorInfoSubjectCustom",
      [],
      { emptyLabel: "선택하세요" }
    );
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
    addInstructorFormDirty.capture();
  }
};

// 강사 정보만 추가 모달 닫기
window.closeAddInstructorInfoModal = async (force = false) => {
  if (!force && !(await confirmDiscardIfDirty(addInstructorFormDirty))) return;
  const modal = $("#addInstructorInfoModal");
  if (modal) {
    modal.style.display = 'none';
    clearModalAlert($("#addInstructorModalAlert"));
    $("#addInstructorInfoForm")?.reset();
    setInstructorSubjectControlValues(
      "#addInstructorInfoSubject",
      "#addInstructorInfoSubjectCustom",
      [],
      { emptyLabel: "선택하세요" }
    );
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }
};

// 강사 정보만 추가 폼 제출
const addInstructorInfoForm = $("#addInstructorInfoForm");
if (addInstructorInfoForm) {
  addInstructorInfoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = $("#addInstructorInfoName")?.value.trim();
    const selectedSubjects = getInstructorSubjectControlValues("#addInstructorInfoSubject", "#addInstructorInfoSubjectCustom");
    const subjectPayload = getSubjectSavePayload(selectedSubjects);
    const subject = subjectPayload.subject || "";
    const subjects = subjectPayload.subjects;
    const email = $("#addInstructorInfoEmail")?.value.trim();
    const note = $("#addInstructorInfoNote")?.value.trim();

    if (!name || !subject) {
      toast("이름과 과목은 필수 항목입니다.", true);
      return;
    }

    const conflict = findInstructorProfileConflict(name, subjects);
    if (conflict) {
      toast(formatInstructorConflictMessage(conflict), true);
      return;
    }

    try {
      const instructorId = `inst_${Date.now()}`;

      await setDoc(doc(db, "instructors", instructorId), {
        name,
        subject,
        subjects,
        email: email || '',
        emailLower: normalizeEmail(email),
        note: note || '',
        bio: '',
        brief: '',
        photo: '',
        videos: [],
        curriculumImageUrl: '',
        curriculumImageUrls: [],
        instructorId,
        pending: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      
      if (email) {
        toast("강사 정보가 추가되었습니다.\n나중에 해당 이메일로 계정을 생성하면 자동으로 연동됩니다.");
      } else {
        toast("강사 정보가 추가되었습니다.\n나중에 이메일을 추가하여 계정과 연동할 수 있습니다.");
      }
      closeAddInstructorInfoModal(true);
      await loadInstructorData();
    } catch (error) {
      console.error("강사 정보 추가 실패:", error);
      toast("추가 실패: " + (error.message || error), true);
    }
  });
}
