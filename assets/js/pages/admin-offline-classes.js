// /assets/js/pages/admin-offline-classes.js
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const FIRESTORE_BATCH_LIMIT = 500;
import { escapeHtml } from "/assets/js/utils/html.js";
import {
  clearModalAlert,
  ensureAdminToastHost,
  setModalAlert,
} from "/assets/js/utils/admin-modal-alert.js";
import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
import { requestPhraseConfirmation } from "/assets/js/utils/confirm-phrase-modal.js";
import { confirmDiscardIfDirty, createFormDirtyTracker, openAdminConfirm } from "/assets/js/utils/admin-dialog.js";
import {
  addUniqueCatalogItem,
  applyGradeSelectValue,
  applySubjectSelectValue,
  buildGradeSelectHtml,
  buildSubjectSelectHtml,
  moveCatalogItem,
  removeCatalogItem,
  renameCatalogItem,
  renderStringCatalogTagsHtml,
  resolveGradeFromControls,
  resolveSubjectFromControls,
  syncGradeCustomField,
  syncSubjectCustomField,
} from "/assets/js/utils/catalog-select-helpers.js";
import {
  cloneGroupCatalogDraft,
  cloneTimetableCatalogDraft,
  DEFAULT_TIMETABLE_SUBJECTS,
  getExactGroupCatalog,
  getGroupCatalog,
  getGroupScheduleImages,
  getScheduleGroups,
  getStoredGroupCatalogEntry,
  hasOwnGroupCatalogEntry,
  REGULAR_SCHEDULE_GROUP_ID,
  resolveGroupId,
  resolveScheduleGroupLabel,
} from "/assets/js/utils/timetable-catalog.js";
import {
  populateScheduleGroupSelect,
  renderAdminScheduleGroupTabs,
} from "/assets/js/utils/schedule-groups-admin.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const classFormDirty = createFormDirtyTracker(document.querySelector("#offlineClassForm"));
const sessionFormDirty = createFormDirtyTracker(document.querySelector("#offlineSessionForm"));

const SUBJECTS_FALLBACK = DEFAULT_TIMETABLE_SUBJECTS.slice();
const GRADES_FALLBACK = ["중1", "중2", "중3", "고1", "고2", "고3", "졸업/N수"];
let catalogSubjects = SUBJECTS_FALLBACK.slice();
let catalogGrades = GRADES_FALLBACK.slice();
let catalogSchools = [];
let catalogClassrooms = [];
/** @type {{ subjects: string[], grades: string[], schools: string[], classrooms: string[] }} */
let catalogDraft = {
  subjects: SUBJECTS_FALLBACK.slice(),
  grades: GRADES_FALLBACK.slice(),
  schools: [],
  classrooms: []
};
/** @type {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} */
let scheduleGroupsDraft = [];
let selectedScheduleGroupId = REGULAR_SCHEDULE_GROUP_ID;
/** @type {Record<string, unknown>} */
let timetableCatalogStored = {};
let offlineClassCatalogStored = {};
/** @type {Record<string, import("/assets/js/utils/timetable-catalog.js").GroupCatalog>} */
let groupCatalogEditsCache = {};

const CATALOG_FIELD_META = {
  subjects: { label: "과목", inputId: "offlineCatalogSubjectInput", minItems: 1 },
  grades: { label: "학년", inputId: "offlineCatalogGradeInput", minItems: 1 },
  schools: { label: "학교", inputId: "offlineCatalogSchoolInput", minItems: 0 },
};
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

let allClasses = [];
/** @type {Map<string, { uid: string, instructorId: string, name: string }>} */
let instructors = new Map();
/** @type {Array<{ uid: string, name: string, school: string, grade: string, phone: string }>} */
let allStudents = [];
/** @type {Array<Record<string, unknown>>} */
let classMembers = [];
let membersClassId = "";
let selectedMemberStudentUids = new Set();
let studentsLoaded = false;
/** @type {Array<Record<string, unknown>>} */
let classSessions = [];
let sessionsClassId = "";
let accessSessionId = "";
/** @type {Record<string, unknown> | null} */
let accessSessionRow = null;
/** @type {Map<string, Record<string, unknown>>} */
let sessionAccessByStudent = new Map();
/** @type {Array<Record<string, unknown>>} */
let accessModalMembers = [];

function toast(msg, isError = false) {
  const el = $("#statusMsg");
  if (!el) return;
  ensureAdminToastHost(el);
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
  el.classList.add("is-visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.classList.remove("is-visible");
    el.textContent = "";
    el.classList.remove("is-error");
  }, 3200);
}

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
  return days.map((day) => ({
    day,
    startTime: start,
    endTime: end,
    room
  }));
}

function formatScheduleItemLine(item) {
  const dayLabel = SCHEDULE_DAYS.find((d) => d.id === item.day)?.label || item.day;
  const timePart =
    item.startTime && item.endTime
      ? `${item.startTime}-${item.endTime}`
      : item.startTime || item.endTime || "";
  const parts = [dayLabel, timePart, item.room].filter(Boolean);
  return parts.join(" ");
}

function formatScheduleRow(row) {
  const items = normalizeScheduleItems(row)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return "-";
  return items.map((item) => formatScheduleItemLine(item)).join("\n");
}

function formatScheduleRowHtml(row) {
  const items = normalizeScheduleItems(row)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  if (!items.length) return '<span class="muted">일정 미정</span>';
  return items.map((item) => escapeHtml(formatScheduleItemLine(item))).join("<br>");
}

function deriveLegacyScheduleFields(scheduleItems) {
  const days = scheduleItems.map((item) => item.day).filter(Boolean);
  const first = scheduleItems[0] || {};
  return {
    scheduleDays: [...new Set(days)],
    startTime: first.startTime || "",
    endTime: first.endTime || "",
    room: first.room || ""
  };
}

function defaultScheduleItemRow() {
  return { day: "", startTime: "", endTime: "", room: "" };
}

function renderScheduleItemsOnForm(items) {
  const list = $("#scheduleItemsList");
  if (!list) return;
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) {
    list.innerHTML =
      '<p class="muted schedule-items-empty-hint">수업 일정은 선택 입력입니다. 필요하면 아래 버튼으로 추가하세요.</p>';
    updateClassPreview();
    return;
  }
  list.innerHTML = rows
    .map((item, index) => {
      const start = escapeHtml(formatTimeDisplay(item.startTime));
      const end = escapeHtml(formatTimeDisplay(item.endTime));
      const room = escapeHtml(item.room || "");
      return `
      <div class="schedule-item-row" data-index="${index}">
        <div class="form-group">
          <label>요일</label>
          <select class="schedule-item-day">
            <option value="">선택</option>
            ${SCHEDULE_DAYS.map(
              (d) =>
                `<option value="${d.id}"${d.id === item.day ? " selected" : ""}>${d.label}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>시작</label>
          <input type="time" class="schedule-item-start" value="${start}">
        </div>
        <div class="form-group">
          <label>종료</label>
          <input type="time" class="schedule-item-end" value="${end}">
        </div>
        <div class="form-group">
          <label>강의실</label>
          <input type="text" class="schedule-item-room" value="${room}" autocomplete="off" list="classroomOptions">
        </div>
        <button type="button" class="btn sm schedule-item-remove-btn" data-action="remove-schedule-item" aria-label="일정 삭제">삭제</button>
      </div>`;
    })
    .join("");
  updateClassPreview();
}

function readScheduleItemsFromForm() {
  const rows = $$(".schedule-item-row", $("#scheduleItemsList"));
  const items = [];
  rows.forEach((row) => {
    const day = (row.querySelector(".schedule-item-day")?.value || "").trim();
    if (!day) return;
    const startTime = formatTimeDisplay(row.querySelector(".schedule-item-start")?.value);
    const endTime = formatTimeDisplay(row.querySelector(".schedule-item-end")?.value);
    const room = (row.querySelector(".schedule-item-room")?.value || "").trim();
    if ((startTime && !endTime) || (!startTime && endTime)) {
      toast("일정 행에 시작/종료 시간을 함께 입력하거나 비워 두세요.", true);
    }
    items.push({ day, startTime, endTime, room });
  });
  return items;
}

function setScheduleItemsOnForm(classRow) {
  renderScheduleItemsOnForm(normalizeScheduleItems(classRow || {}));
}

function addScheduleItemRow() {
  const list = $("#scheduleItemsList");
  const current = readScheduleItemsFromForm();
  current.push(defaultScheduleItemRow());
  if (list?.querySelector(".schedule-items-empty-hint")) {
    list.innerHTML = "";
  }
  renderScheduleItemsOnForm(current);
}

async function deleteDocsInBatches(refs) {
  if (!refs.length) return;
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    refs.slice(i, i + FIRESTORE_BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function deleteDocsFromQuery(q) {
  const snap = await getDocs(q);
  const refs = snap.docs.map((d) => d.ref);
  await deleteDocsInBatches(refs);
  return refs.length;
}

function closeModalsForClass(classId) {
  if (membersClassId === classId) closeMembersModal();
  if (sessionsClassId === classId) closeSessionsModal();
  const editId = ($("#offlineClassEditId")?.value || "").trim();
  if (editId === classId) closeModal(true);
}

function isActiveMember(member) {
  return member?.status !== "removed";
}

function formatSchoolGrade(row) {
  const school = String(row.school || "").trim();
  const grade = String(row.grade || "").trim();
  if (school && grade) return `${school} / ${grade}`;
  return school || grade || "-";
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

function ensureInstructorSelectFallback(selectEl, record = {}) {
  const selectedValue = getInstructorSelectValue(record);
  if (!selectEl || !selectedValue) return selectedValue;
  if (!Array.from(selectEl.options).some((opt) => opt.value === selectedValue)) {
    const opt = document.createElement("option");
    opt.value = selectedValue;
    opt.textContent = record.instructorName || selectedValue;
    opt.disabled = true;
    selectEl.appendChild(opt);
  }
  return selectedValue;
}

function getInstructorMatchKeys(selectedValue) {
  const value = String(selectedValue || "").trim();
  const inst = value ? instructors.get(value) : null;
  return new Set([value, inst?.uid, inst?.authUid, inst?.instructorId].filter(Boolean));
}

function instructorDisplayName(row) {
  const name = String(row.instructorName || "").trim();
  if (name) return name;
  const inst = findInstructorForRecord(row);
  return inst?.name || "미배정";
}

function statusBadge(status) {
  if (status === "archived") {
    return '<span class="offline-class-status offline-class-status--archived">보관</span>';
  }
  return '<span class="offline-class-status offline-class-status--active">운영 중</span>';
}

async function loadInstructors() {
  const map = new Map();
  try {
    const snap = await getDocs(collection(db, "instructors"));
    snap.docs.forEach((docSnap) => {
      const row = normalizeInstructorProfile(docSnap);
      if (row) map.set(row.uid, row);
    });
  } catch (err) {
    console.warn("[offline-classes] instructors load failed:", err);
  }
  instructors = map;
  populateInstructorSelects();
}

function populateInstructorSelects() {
  const modalSelect = $("#classInstructorUid");
  const filterSelect = $("#filterInstructor");
  const sorted = Array.from(instructors.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  if (modalSelect) {
    const current = modalSelect.value;
    modalSelect.innerHTML = '<option value="">미배정</option>';
    sorted.forEach((inst) => {
      const opt = document.createElement("option");
      opt.value = inst.uid;
      opt.textContent = inst.name;
      modalSelect.appendChild(opt);
    });
    modalSelect.value = current;
  }

  if (filterSelect) {
    const current = filterSelect.value;
    filterSelect.innerHTML =
      '<option value="">전체 강사</option><option value="__unassigned__">미배정</option>';
    sorted.forEach((inst) => {
      const opt = document.createElement("option");
      opt.value = inst.uid;
      opt.textContent = inst.name;
      filterSelect.appendChild(opt);
    });
    filterSelect.value = current;
  }
}

function populateClassroomDatalist() {
  const datalist = $("#classroomOptions");
  if (!datalist) return;
  datalist.innerHTML = catalogClassrooms
    .map((room) => `<option value="${escapeHtml(room)}"></option>`)
    .join("");
}

function populateSchoolDatalist() {
  const datalist = $("#schoolOptions");
  if (!datalist) return;
  datalist.innerHTML = catalogSchools
    .map((school) => `<option value="${escapeHtml(school)}"></option>`)
    .join("");
}

function syncCatalogArraysFromDraft() {
  catalogSubjects = catalogDraft.subjects.length ? catalogDraft.subjects.slice() : SUBJECTS_FALLBACK.slice();
  catalogGrades = catalogDraft.grades.length ? catalogDraft.grades.slice() : GRADES_FALLBACK.slice();
  catalogSchools = catalogDraft.schools.slice();
  catalogClassrooms = catalogDraft.classrooms.slice();
}

function updateOfflineCatalogGroupLabel() {
  const labelEl = $("#offlineCatalogGroupLabel");
  if (!labelEl) return;
  labelEl.textContent = resolveScheduleGroupLabel(selectedScheduleGroupId, scheduleGroupsDraft);
}

function getCurrentGroupCatalogDraft() {
  return cloneGroupCatalogDraft({
    ...catalogDraft,
    scheduleImages: [],
  });
}

function cacheCurrentGroupCatalogDraft(groupId = selectedScheduleGroupId) {
  const id = resolveGroupId({ groupId });
  groupCatalogEditsCache[id] = getCurrentGroupCatalogDraft();
}

function loadCatalogForGroup(groupId, formOptions = {}, options = {}) {
  const syncTab = options.syncTab !== false;
  const id = resolveGroupId({ groupId });
  if (syncTab) selectedScheduleGroupId = id;

  const cached = groupCatalogEditsCache[id];
  const source = cached || getExactGroupCatalog(offlineClassCatalogStored, id);
  const draft = cloneGroupCatalogDraft(source);

  const useRegularSubjectFallback =
    id === REGULAR_SCHEDULE_GROUP_ID &&
    !hasOwnGroupCatalogEntry(offlineClassCatalogStored, id) &&
    !draft.subjects.length;
  const useRegularGradeFallback =
    id === REGULAR_SCHEDULE_GROUP_ID &&
    !hasOwnGroupCatalogEntry(offlineClassCatalogStored, id) &&
    !draft.grades.length;

  catalogDraft = cloneTimetableCatalogDraft(
    {
      subjects: draft.subjects.length
        ? draft.subjects
        : useRegularSubjectFallback
          ? SUBJECTS_FALLBACK.slice()
          : [],
      grades: draft.grades.length
        ? draft.grades
        : useRegularGradeFallback
          ? GRADES_FALLBACK.slice()
          : [],
      schools: draft.schools,
    },
    draft.classrooms
  );

  applyCatalogToPage(formOptions);
  if (syncTab) updateOfflineCatalogGroupLabel();
}

function restoreAdminTabCatalog() {
  loadCatalogForGroup(selectedScheduleGroupId, {}, { syncTab: true });
}

async function loadTimetableCatalogStored() {
  try {
    const [timetableResult, offlineResult] = await Promise.all([
      getSettingDoc("timetableCatalog"),
      getSettingDoc("offlineClassCatalog"),
    ]);
    timetableCatalogStored = timetableResult.exists && timetableResult.data ? { ...timetableResult.data } : {};
    offlineClassCatalogStored = offlineResult.exists && offlineResult.data
      ? { ...offlineResult.data }
      : { ...timetableCatalogStored };
  } catch (err) {
    console.warn("[offline-classes] catalog settings load failed:", err);
    timetableCatalogStored = {};
    offlineClassCatalogStored = {};
  }
  scheduleGroupsDraft = getScheduleGroups(timetableCatalogStored);
  groupCatalogEditsCache = {};
  if (!scheduleGroupsDraft.some((group) => group.id === selectedScheduleGroupId)) {
    selectedScheduleGroupId = scheduleGroupsDraft[0]?.id || REGULAR_SCHEDULE_GROUP_ID;
  }
  loadCatalogForGroup(selectedScheduleGroupId);
  renderScheduleGroupsUi();
}

function applyCatalogToPage(formOptions = {}) {
  syncCatalogArraysFromDraft();
  populateClassroomDatalist();
  populateSchoolDatalist();
  populateFilterSelects();
  const subjectValue =
    formOptions.subject !== undefined
      ? formOptions.subject
      : resolveSubjectFromControls($("#classSubject"), $("#classSubjectCustom"), catalogSubjects);
  const gradeValue =
    formOptions.grade !== undefined
      ? formOptions.grade
      : resolveGradeFromControls($("#classGrade"), $("#classGradeCustom"), catalogGrades);
  const schoolValue = formOptions.school !== undefined ? formOptions.school : ($("#classSchool")?.value || "");
  populateClassFormSelects(subjectValue, gradeValue, schoolValue);
  renderOfflineCatalogPanel();
}

function renderOfflineCatalogPanel() {
  Object.keys(CATALOG_FIELD_META).forEach((field) => {
    const host = document.querySelector(`[data-catalog-tags="${field}"]`);
    if (host) {
      host.innerHTML = renderStringCatalogTagsHtml(catalogDraft[field], field, escapeHtml);
    }
  });
}

function renderScheduleGroupsUi() {
  renderAdminScheduleGroupTabs(
    $("#adminScheduleGroupTabs"),
    scheduleGroupsDraft,
    selectedScheduleGroupId
  );
  populateScheduleGroupSelect(
    $("#offlineClassGroupId"),
    scheduleGroupsDraft,
    selectedScheduleGroupId
  );
}

function selectScheduleGroup(groupId) {
  cacheCurrentGroupCatalogDraft();
  loadCatalogForGroup(groupId || REGULAR_SCHEDULE_GROUP_ID);
  renderScheduleGroupsUi();
  renderTable();
}

function populateClassFormSelects(subjectValue = "", gradeValue = "", schoolValue = "") {
  const subjectEl = $("#classSubject");
  const gradeEl = $("#classGrade");
  const subjectCustomEl = $("#classSubjectCustom");
  const gradeCustomEl = $("#classGradeCustom");
  const schoolEl = $("#classSchool");
  if (subjectEl) {
    subjectEl.innerHTML = buildSubjectSelectHtml(catalogSubjects, {
      selected: "",
      emptyLabel: "선택",
      allowCustom: true
    });
    applySubjectSelectValue(subjectEl, subjectCustomEl, subjectValue, catalogSubjects);
    syncSubjectCustomField(subjectEl, subjectCustomEl, catalogSubjects);
  }
  if (gradeEl) {
    gradeEl.innerHTML = buildGradeSelectHtml(catalogGrades, {
      selected: "",
      emptyLabel: "선택",
      allowCustom: true
    });
    applyGradeSelectValue(gradeEl, gradeCustomEl, gradeValue, catalogGrades);
    syncGradeCustomField(gradeEl, gradeCustomEl);
  }
  if (schoolEl) {
    schoolEl.innerHTML = '<option value="">선택</option>' + catalogSchools
      .map((school) => `<option value="${escapeHtml(school)}">${escapeHtml(school)}</option>`)
      .join("");
    if (schoolValue && !catalogSchools.includes(schoolValue)) {
      schoolEl.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(schoolValue)}">${escapeHtml(schoolValue)}</option>`);
    }
    schoolEl.value = schoolValue;
  }
}

function addCatalogDraftValue(field, rawValue) {
  const meta = CATALOG_FIELD_META[field];
  if (!meta) return;
  const result = addUniqueCatalogItem(catalogDraft[field], rawValue);
  if (!result.ok) {
    toast(result.message, true);
    return;
  }
  catalogDraft[field] = result.list;
  const input = $(`#${meta.inputId}`);
  if (input) input.value = "";
  applyCatalogToPage();
}

function removeCatalogDraftValue(field, value) {
  const meta = CATALOG_FIELD_META[field];
  if (!meta) return;
  const result = removeCatalogItem(catalogDraft[field], value, {
    minItems: meta.minItems,
    label: meta.label
  });
  if (!result.ok) {
    toast(result.message, true);
    return;
  }
  catalogDraft[field] = result.list;
  applyCatalogToPage();
}

function renameCatalogDraftValue(field, oldValue, nextValue) {
  const meta = CATALOG_FIELD_META[field];
  if (!meta) return;
  const result = renameCatalogItem(catalogDraft[field], oldValue, nextValue);
  if (!result.ok) {
    toast(result.message, true);
    return;
  }
  catalogDraft[field] = result.list;
  applyCatalogToPage();
}

function moveCatalogDraftValue(field, value, direction) {
  const result = moveCatalogItem(catalogDraft[field], value, direction);
  if (!result.ok) {
    toast(result.message, true);
    return;
  }
  catalogDraft[field] = result.list;
  applyCatalogToPage();
}

async function saveOfflineCatalogDraft() {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (catalogDraft.subjects.length < 1 || catalogDraft.grades.length < 1) {
    toast("과목과 학년은 각각 1개 이상 유지해야 합니다.", true);
    return;
  }

  cacheCurrentGroupCatalogDraft();
  const groupId = resolveGroupId({ groupId: selectedScheduleGroupId });
  const fields = {
    subjects: catalogDraft.subjects.slice(),
    grades: catalogDraft.grades.slice(),
    schools: catalogDraft.schools.slice(),
  };
  const settingsRef = doc(db, "settings", "offlineClassCatalog");

  try {
    const updates = {
      [`groupCatalogs.${groupId}`]: fields,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (groupId === REGULAR_SCHEDULE_GROUP_ID) Object.assign(updates, fields);
    await setDoc(settingsRef, updates, { merge: true });

    invalidateSetting("offlineClassCatalog");
    offlineClassCatalogStored = {
      ...offlineClassCatalogStored,
      ...(groupId === REGULAR_SCHEDULE_GROUP_ID ? fields : {}),
      groupCatalogs: {
        ...(offlineClassCatalogStored.groupCatalogs || {}),
        [groupId]: fields,
      },
    };
    groupCatalogEditsCache[groupId] = cloneGroupCatalogDraft({
      subjects: fields.subjects,
      grades: fields.grades,
      schools: fields.schools,
      classrooms: fields.classrooms,
      scheduleImages: [],
    });
    applyCatalogToPage();
    toast("선택 목록을 저장했습니다.");
  } catch (err) {
    console.error("[offline-classes] catalog save failed:", err);
    toast("목록 저장에 실패했습니다.", true);
  }
}

function populateFilterSelects() {
  const subjectEl = $("#filterSubject");
  const gradeEl = $("#filterGrade");
  if (subjectEl) {
    const cur = subjectEl.value;
    subjectEl.innerHTML = '<option value="">전체 과목</option>';
    catalogSubjects.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      subjectEl.appendChild(opt);
    });
    subjectEl.value = cur;
  }
  if (gradeEl) {
    const cur = gradeEl.value;
    gradeEl.innerHTML = '<option value="">전체 학년</option>';
    catalogGrades.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      gradeEl.appendChild(opt);
    });
    gradeEl.value = cur;
  }
}

async function loadOfflineClasses() {
  const tbody = $("#tblOfflineClasses tbody");
  try {
    const snap = await getDocs(collection(db, "offlineClasses"));
    allClasses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        String(a.className || "").localeCompare(String(b.className || ""), "ko")
      );
    renderScheduleGroupsUi();
    renderTable();
  } catch (err) {
    console.error("[offline-classes] load failed:", err);
    toast("목록을 불러오지 못했습니다: " + (err.message || err), true);
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="muted admin-table-empty">데이터를 불러오지 못했습니다.</td></tr>';
    }
  }
}

function getFilteredClasses() {
  const keyword = ($("#filterSearch")?.value || "").trim().toLowerCase();
  const subject = $("#filterSubject")?.value || "";
  const grade = $("#filterGrade")?.value || "";
  const instructor = $("#filterInstructor")?.value || "";
  const status = $("#filterStatus")?.value || "";

  return allClasses.filter((row) => {
    if (resolveGroupId(row) !== selectedScheduleGroupId) return false;
    if (status && row.status !== status) return false;
    if (subject && row.subject !== subject) return false;
    if (grade && row.grade !== grade) return false;
    if (instructor === "__unassigned__") {
      if (String(row.instructorUid || "").trim()) return false;
    } else if (instructor) {
      const keys = getInstructorMatchKeys(instructor);
      const rowInstructorUid = String(row.instructorUid || "").trim();
      const rowInstructorId = String(row.instructorId || "").trim();
      if (!keys.has(rowInstructorUid) && !keys.has(rowInstructorId)) return false;
    }
    if (keyword) {
      const hay = [
        row.className,
        row.subject,
        row.school,
        row.grade,
        row.instructorName,
        row.room,
        row.description
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
}

function renderTable() {
  const tbody = $("#tblOfflineClasses tbody");
  const meta = $("#offlineClassesMeta");
  if (!tbody) return;

  const rows = getFilteredClasses();
  if (meta) {
    meta.textContent = `총 ${allClasses.length}개 / 표시 ${rows.length}개`;
  }

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="muted admin-table-empty">등록된 오프라인 반이 없습니다. 「반 추가」로 생성하세요.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const isArchived = row.status === "archived";
      const toggleLabel = isArchived ? "다시 활성화" : "보관";
      const toggleAction = isArchived ? "reactivate" : "archive";
      return `
      <tr data-id="${escapeHtml(row.id)}">
        <td><strong>${escapeHtml(row.className || "-")}</strong></td>
        <td>${escapeHtml(row.subject || "-")}</td>
        <td>${escapeHtml(formatSchoolGrade(row))}</td>
        <td>${escapeHtml(instructorDisplayName(row))}</td>
        <td class="offline-class-schedule-cell">${formatScheduleRowHtml(row)}</td>
        <td>${statusBadge(row.status)}</td>
        <td>
          <div class="offline-class-actions">
            <button type="button" class="btn sm" data-action="sessions" data-id="${escapeHtml(row.id)}" title="수업 관리">수업</button>
            <button type="button" class="btn sm" data-action="members" data-id="${escapeHtml(row.id)}" title="반 학생 관리">학생</button>
            <button type="button" class="btn sm" data-action="edit" data-id="${escapeHtml(row.id)}">수정</button>
            <button type="button" class="btn sm" data-action="${toggleAction}" data-id="${escapeHtml(row.id)}">${toggleLabel}</button>
            <button type="button" class="btn sm danger" data-action="delete-permanent" data-id="${escapeHtml(row.id)}" title="영구 삭제">삭제</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function getSelectedInstructorFields(uid, fallbackRecord = {}) {
  if (!uid) {
    return { instructorUid: "", instructorId: "", instructorName: "" };
  }
  const inst = instructors.get(uid);
  if (!inst) {
    return {
      instructorUid: String(fallbackRecord?.instructorUid || uid || "").trim(),
      instructorId: String(fallbackRecord?.instructorId || "").trim(),
      instructorName: String(fallbackRecord?.instructorName || "").trim()
    };
  }
  return {
    instructorUid: inst.uid,
    instructorId: inst?.instructorId || "",
    instructorName: inst?.name || ""
  };
}

function readFormPayload() {
  const className = ($("#className")?.value || "").trim();
  const subject = resolveSubjectFromControls(
    $("#classSubject"),
    $("#classSubjectCustom"),
    catalogSubjects
  );
  if (!className) throw new Error("반명을 입력해주세요.");
  if (!subject) throw new Error("과목을 선택하거나 직접 입력해주세요.");

  const instructorUid = ($("#classInstructorUid")?.value || "").trim();
  const editId = ($("#offlineClassEditId")?.value || "").trim();
  const existingClass = editId ? allClasses.find((c) => c.id === editId) : {};
  const instructorFields = getSelectedInstructorFields(instructorUid, existingClass);
  const scheduleItems = readScheduleItemsFromForm();
  const legacySchedule = deriveLegacyScheduleFields(scheduleItems);

  return {
    className,
    subject,
    grade: resolveGradeFromControls($("#classGrade"), $("#classGradeCustom"), catalogGrades),
    school: ($("#classSchool")?.value || "").trim(),
    groupId:
      ($("#offlineClassGroupId")?.value || "").trim() ||
      (editId ? resolveGroupId(existingClass) : selectedScheduleGroupId) ||
      REGULAR_SCHEDULE_GROUP_ID,
    ...instructorFields,
    scheduleItems,
    scheduleDays: legacySchedule.scheduleDays,
    startTime: legacySchedule.startTime,
    endTime: legacySchedule.endTime,
    room: legacySchedule.room,
    scheduleVisible: $("#classScheduleVisible")?.checked !== false,
    description: ($("#classDescription")?.value || "").trim(),
    status: $("#classStatus")?.value === "archived" ? "archived" : "active"
  };
}

function classPreviewStatusLabel(status) {
  return status === "archived" ? "보관" : "운영 중";
}

function readClassPreviewData() {
  const instructorUid = ($("#classInstructorUid")?.value || "").trim();
  const instructorFields = getSelectedInstructorFields(instructorUid);
  const scheduleItems = readScheduleItemsFromForm();
  return {
    className: ($("#className")?.value || "").trim() || "반명 없음",
    subject: resolveSubjectFromControls($("#classSubject"), $("#classSubjectCustom"), catalogSubjects) || "-",
    school: ($("#classSchool")?.value || "").trim(),
    grade: resolveGradeFromControls($("#classGrade"), $("#classGradeCustom"), catalogGrades),
    instructorName: instructorFields.instructorName || "미배정",
    scheduleItems,
    scheduleVisible: $("#classScheduleVisible")?.checked !== false,
    description: ($("#classDescription")?.value || "").trim(),
    status: $("#classStatus")?.value === "archived" ? "archived" : "active"
  };
}

function updateClassPreview() {
  const preview = $("#offlineClassPreview");
  if (!preview) return;
  const data = readClassPreviewData();
  const scheduleLines = normalizeScheduleItems(data)
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
    .map((item) => formatScheduleItemLine(item));
  const scheduleHtml = data.scheduleVisible === false
    ? '<li class="muted">학생/강사 화면에서는 일정 숨김</li>'
    : scheduleLines.length
      ? scheduleLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
      : '<li class="muted">일정 없음</li>';
  const desc = data.description
    ? `<p class="admin-offline-class-preview__desc">${escapeHtml(data.description.slice(0, 120))}${data.description.length > 120 ? "…" : ""}</p>`
    : '<p class="admin-offline-class-preview__desc muted">설명 없음</p>';
  preview.innerHTML = `
    <div class="admin-offline-class-preview__card">
      <p class="admin-offline-class-preview__label">${escapeHtml(data.subject)}</p>
      <h4 class="admin-offline-class-preview__name">${escapeHtml(data.className)}</h4>
      <p class="admin-offline-class-preview__meta">${escapeHtml(formatSchoolGrade(data))}</p>
      <p class="admin-offline-class-preview__meta">담당: ${escapeHtml(data.instructorName)}</p>
      <ul class="admin-offline-class-preview__schedule">${scheduleHtml}</ul>
      <p class="admin-offline-class-preview__meta">상태: ${escapeHtml(classPreviewStatusLabel(data.status))}</p>
      ${desc}
    </div>`;
}

function bindClassPreviewEvents() {
  const form = $("#offlineClassForm");
  if (!form || form.dataset.previewBound === "1") return;
  form.dataset.previewBound = "1";
  form.addEventListener("input", updateClassPreview);
  form.addEventListener("change", updateClassPreview);
}

function showModal() {
  const modal = $("#offlineClassModal");
  if (!modal) {
    console.warn("[offline-classes]", "modal element not found");
    return;
  }
  modal.hidden = false;
  modal.classList.add("is-open");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
}

function hideModal() {
  const modal = $("#offlineClassModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
}

function openCreateModal() {
  openModal("add");
}

function openModal(mode, classId = "") {
  const modal = $("#offlineClassModal");
  const title = $("#offlineClassModalTitle");
  const editId = $("#offlineClassEditId");
  if (!modal || !title || !editId) {
    console.warn("[offline-classes]", "modal open aborted — missing elements", {
      modal: !!modal,
      title: !!title,
      editId: !!editId
    });
    return;
  }

  syncCatalogArraysFromDraft();
  populateClassroomDatalist();
  populateSchoolDatalist();

  $("#offlineClassForm")?.reset();
  populateInstructorSelects();
  renderScheduleItemsOnForm([]);
  if ($("#classScheduleVisible")) $("#classScheduleVisible").checked = true;
  editId.value = "";

  if (mode === "edit" && classId) {
    const row = allClasses.find((c) => c.id === classId);
    if (!row) {
      toast("반 정보를 찾을 수 없습니다.", true);
      return;
    }
    title.textContent = "반 수정";
    editId.value = classId;
    $("#className").value = row.className || "";
    $("#classSchool").value = row.school || "";
    const instructorSelect = $("#classInstructorUid");
    if (instructorSelect) instructorSelect.value = ensureInstructorSelectFallback(instructorSelect, row);
    setScheduleItemsOnForm(row);
    if ($("#classScheduleVisible")) $("#classScheduleVisible").checked = row.scheduleVisible !== false;
    $("#classDescription").value = row.description || "";
    $("#classStatus").value = row.status === "archived" ? "archived" : "active";
    const entryGroupId = resolveGroupId(row);
    loadCatalogForGroup(
      entryGroupId,
      { subject: row.subject || "", grade: row.grade || "", school: row.school || "" },
      { syncTab: false }
    );
    populateScheduleGroupSelect($("#offlineClassGroupId"), scheduleGroupsDraft, entryGroupId);
  } else {
    title.textContent = "오프라인 반 추가";
    $("#classStatus").value = "active";
    loadCatalogForGroup(
      selectedScheduleGroupId,
      { subject: "", grade: "" },
      { syncTab: false }
    );
    populateScheduleGroupSelect(
      $("#offlineClassGroupId"),
      scheduleGroupsDraft,
      selectedScheduleGroupId
    );
  }

  showModal();
  updateClassPreview();
  bindClassPreviewEvents();
  classFormDirty.capture();
}

async function closeModal(force = false) {
  if (!force && !(await confirmDiscardIfDirty(classFormDirty))) return;
  hideModal();
  restoreAdminTabCatalog();
}

function refreshModalCatalogForGroup(groupId) {
  const subject = resolveSubjectFromControls(
    $("#classSubject"),
    $("#classSubjectCustom"),
    catalogSubjects
  );
  const grade = resolveGradeFromControls($("#classGrade"), $("#classGradeCustom"), catalogGrades);
  loadCatalogForGroup(groupId, { subject, grade }, { syncTab: false });
}

async function saveClassFromForm(e) {
  e.preventDefault();
  const submitBtn = $("#offlineClassFormSubmit");
  const uid = auth.currentUser?.uid;
  if (!uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }

  let payload;
  try {
    payload = readFormPayload();
  } catch (err) {
    toast(err.message || String(err), true);
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  try {
    const editId = ($("#offlineClassEditId")?.value || "").trim();
    if (editId) {
      await setDoc(
        doc(db, "offlineClasses", editId),
        {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedBy: uid
        },
        { merge: true }
      );
      toast("반 정보가 저장되었습니다.");
    } else {
      await addDoc(collection(db, "offlineClasses"), {
        ...payload,
        status: payload.status || "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid
      });
      toast("오프라인 반이 추가되었습니다.");
    }
    closeModal(true);
    await loadOfflineClasses();
  } catch (err) {
    console.error("[offline-classes] save failed:", err);
    toast("저장 실패: " + (err.message || err), true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function permanentDeleteClass(classId) {
  if (!auth.currentUser?.uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  const row = allClasses.find((c) => c.id === classId);
  if (!row) {
    toast("반 정보를 찾을 수 없습니다.", true);
    return;
  }

  const className = String(row.className || "이 반");
  let confirmationModal = null;
  try {
    const [membersSnap, sessionsSnap, accessSnap] = await Promise.all([
      getDocs(query(collection(db, "offlineClassMembers"), where("classId", "==", classId))),
      getDocs(query(collection(db, "offlineClassSessions"), where("classId", "==", classId))),
      getDocs(query(collection(db, "offlineSessionAccess"), where("classId", "==", classId)))
    ]);

    const message = [
      `${className} 오프라인 반을 영구 삭제합니다.`,
      "",
      "함께 정리되는 정보:",
      `- 배정된 학생 정보: ${membersSnap.size}건`,
      `- 수업/영상 정보: ${sessionsSnap.size}건`,
      `- 수동 접근 권한 기록: ${accessSnap.size}건`,
      "",
      "학생 계정과 온라인 강좌 수강 정보는 삭제되지 않습니다.",
      "시간표 게시 정보도 자동으로 삭제되지 않습니다.",
      "",
      "계속 진행하시겠습니까?"
    ].join("\n");
    confirmationModal = await requestPhraseConfirmation({
      title: "오프라인 반 영구 삭제",
      message,
      phrase: "오프라인 반 삭제",
      confirmLabel: "오프라인 반 삭제",
      pendingMessage: "오프라인 반을 삭제하는 중입니다.",
      notifyError: (errorMessage) => toast(errorMessage, true),
    });
    if (!confirmationModal) return;

    await deleteDocsInBatches(accessSnap.docs.map((d) => d.ref));
    await deleteDocsInBatches(sessionsSnap.docs.map((d) => d.ref));
    await deleteDocsInBatches(membersSnap.docs.map((d) => d.ref));
    await deleteDoc(doc(db, "offlineClasses", classId));

    allClasses = allClasses.filter((c) => c.id !== classId);
    closeModalsForClass(classId);
    renderTable();
    toast("오프라인 반이 영구 삭제되었습니다.");
    confirmationModal.success("오프라인 반이 영구 삭제되었습니다.");
  } catch (err) {
    console.error("[offline-classes] permanent delete class failed:", err);
    const errorMessage = "영구 삭제 실패: " + (err.message || err);
    toast(errorMessage, true);
    if (confirmationModal) confirmationModal.error(errorMessage);
  }
}

async function permanentDeleteSession(sessionId) {
  if (!auth.currentUser?.uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (!sessionsClassId || !sessionId) return;

  const row = classSessions.find((s) => s.id === sessionId);
  if (!row) {
    toast("수업 정보를 찾을 수 없습니다.", true);
    return;
  }

  const title = String(row.title || "이 수업");
  let confirmationModal = null;
  try {
    const accessSnap = await getDocs(
      query(collection(db, "offlineSessionAccess"), where("sessionId", "==", sessionId))
    );
    const message = [
      `${title} 수업을 영구 삭제합니다.`,
      "수업 정보, 영상 정보, 이 수업에 대한 수동 접근 권한 기록이 함께 정리됩니다.",
      `이 수업과 연결된 수동 접근 권한 기록 ${accessSnap.size}개가 함께 정리됩니다.`,
      "수강생 계정이나 반 배정 정보는 삭제되지 않습니다.",
      "",
      "계속 진행하시겠습니까?"
    ].join("\n");
    confirmationModal = await requestPhraseConfirmation({
      title: "오프라인 수업 영구 삭제",
      message,
      phrase: "수업 삭제",
      confirmLabel: "수업 삭제",
      pendingMessage: "오프라인 수업을 삭제하는 중입니다.",
      notifyError: (errorMessage) => toast(errorMessage, true),
    });
    if (!confirmationModal) return;

    await deleteDocsFromQuery(
      query(collection(db, "offlineSessionAccess"), where("sessionId", "==", sessionId))
    );
    await deleteDoc(doc(db, "offlineClassSessions", sessionId));

    if (accessSessionId === sessionId) closeSessionAccessModal();
    classSessions = classSessions.filter((s) => s.id !== sessionId);
    renderSessionsTable();
    toast("수업이 영구 삭제되었습니다.");
    confirmationModal.success("수업이 영구 삭제되었습니다.");
  } catch (err) {
    console.error("[offline-classes] permanent delete session failed:", err);
    const errorMessage = "수업 영구 삭제 실패: " + (err.message || err);
    toast(errorMessage, true);
    if (confirmationModal) confirmationModal.error(errorMessage);
  }
}

async function setClassStatus(classId, status) {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  const label = status === "archived" ? "보관" : "운영 재개";
  if (!(await openAdminConfirm({
    title: "반 상태 변경",
    message: `이 반을 ${label} 처리하시겠습니까?`,
    confirmLabel: label,
    danger: status === "archived"
  }))) return;

  try {
    await setDoc(
      doc(db, "offlineClasses", classId),
      {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: uid
      },
      { merge: true }
    );
    toast(status === "archived" ? "보관 처리되었습니다." : "운영 중으로 복원되었습니다.");
    await loadOfflineClasses();
  } catch (err) {
    console.error("[offline-classes] status update failed:", err);
    toast("상태 변경 실패: " + (err.message || err), true);
  }
}

function memberDocId(classId, studentUid) {
  return `${classId}_${studentUid}`;
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  try {
    const date = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("ko-KR");
  } catch {
    return "-";
  }
}

function studentDisplayFields(student) {
  return {
    name: String(student?.name || "").trim() || "-",
    school: String(student?.school || student?.childSchool || "").trim() || "-",
    grade: String(student?.grade || student?.childGrade || "").trim() || "-",
    phone: String(student?.phone || "").trim() || "-"
  };
}

function getCurrentMembersClass() {
  return allClasses.find((c) => c.id === membersClassId) || null;
}

function isMembersClassArchived() {
  const row = getCurrentMembersClass();
  return row?.status === "archived";
}

async function loadStudents() {
  if (studentsLoaded) return;
  try {
    const snap = await getDocs(collection(db, "students"));
    allStudents = snap.docs
      .map((d) => {
        const data = d.data() || {};
        const fields = studentDisplayFields(data);
        return {
          uid: d.id,
          name: fields.name === "-" ? "" : fields.name,
          school: fields.school === "-" ? "" : fields.school,
          grade: fields.grade === "-" ? "" : fields.grade,
          phone: fields.phone === "-" ? "" : fields.phone
        };
      })
      .filter((s) => s.uid)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    studentsLoaded = true;
  } catch (err) {
    console.error("[offline-classes] students load failed:", err);
    toast("학생 목록을 불러오지 못했습니다: " + (err.message || err), true);
    allStudents = [];
  }
}

async function loadClassMembers(classId) {
  const tbody = $("#tblOfflineClassMembers tbody");
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted admin-table-empty">로딩 중...</td></tr>';
  }
  try {
    const snap = await getDocs(
      query(collection(db, "offlineClassMembers"), where("classId", "==", classId))
    );
    classMembers = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isActiveMember)
      .sort((a, b) =>
        String(a.studentNameSnapshot || "").localeCompare(
          String(b.studentNameSnapshot || ""),
          "ko"
        )
      );
    renderMembersTable();
  } catch (err) {
    console.error("[offline-classes] members load failed:", err);
    toast("반 학생 목록을 불러오지 못했습니다: " + (err.message || err), true);
    classMembers = [];
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted admin-table-empty">목록을 불러오지 못했습니다.</td></tr>';
    }
  }
}

function renderMembersTable() {
  const tbody = $("#tblOfflineClassMembers tbody");
  const meta = $("#offlineMembersMeta");
  if (!tbody) return;

  if (meta) {
    meta.textContent = `배정 학생 ${classMembers.length}명`;
  }

  if (!classMembers.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted admin-table-empty">배정된 학생이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = classMembers
    .map((m) => {
      const manageBtn = `<button type="button" class="btn sm danger" data-member-action="remove" data-student-uid="${escapeHtml(m.studentUid || "")}">반에서 제거</button>`;
      return `
      <tr>
        <td>${escapeHtml(String(m.studentNameSnapshot || "-"))}</td>
        <td>${escapeHtml(String(m.schoolSnapshot || "-"))}</td>
        <td>${escapeHtml(String(m.gradeSnapshot || "-"))}</td>
        <td>${escapeHtml(String(m.phoneSnapshot || "-"))}</td>
        <td>${escapeHtml(formatTimestamp(m.joinedAt))}</td>
        <td>${manageBtn}</td>
      </tr>`;
    })
    .join("");
}

function getActiveMemberUids() {
  return new Set(classMembers.map((m) => String(m.studentUid || "")));
}

function updateMemberAddButton() {
  const addBtn = $("#offlineMemberAddBtn");
  if (!addBtn) return;
  const activeUids = getActiveMemberUids();
  const selectedCount = [...selectedMemberStudentUids].filter(
    (uid) => uid && !activeUids.has(uid)
  ).length;
  addBtn.disabled = selectedCount === 0 || isMembersClassArchived();
  addBtn.textContent = selectedCount > 1 ? `선택 학생 ${selectedCount}명 입반` : "선택 학생 입반";
}

function filterStudentsForSearch(keyword) {
  const q = keyword.trim().toLowerCase();
  if (!q) return [];
  return allStudents
    .filter((s) => {
      const hay = [s.name, s.school, s.grade, s.phone]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    })
    .slice(0, 30);
}

function renderStudentSearchResults() {
  const container = $("#offlineMemberSearchResults");
  if (!container) return;

  if (isMembersClassArchived()) {
    container.textContent = "보관된 반에는 학생을 추가할 수 없습니다.";
    updateMemberAddButton();
    return;
  }

  const keyword = ($("#offlineMemberStudentSearch")?.value || "").trim();
  if (!keyword) {
    container.innerHTML = '<span class="muted">검색어를 입력하세요.</span>';
    selectedMemberStudentUids.clear();
    updateMemberAddButton();
    return;
  }

  const results = filterStudentsForSearch(keyword);
  const activeUids = getActiveMemberUids();

  if (!results.length) {
    container.innerHTML = '<span class="muted">검색 결과가 없습니다.</span>';
    selectedMemberStudentUids.clear();
    updateMemberAddButton();
    return;
  }

  container.innerHTML = results
    .map((s) => {
      const isActive = activeUids.has(s.uid);
      const label = [s.name || "(이름 없음)", s.school, s.grade, s.phone]
        .filter(Boolean)
        .join(" / ");
      const disabled = isActive ? " disabled" : "";
      const checked = selectedMemberStudentUids.has(s.uid) ? " checked" : "";
      return `
      <label class="offline-member-search-item${isActive ? " is-disabled" : ""}">
        <input type="checkbox" name="offlineMemberStudentPick" value="${escapeHtml(s.uid)}"${disabled}${checked}>
        <span>${escapeHtml(label)}${isActive ? ' <em class="muted">(배정됨)</em>' : ""}</span>
      </label>`;
    })
    .join("");

  updateMemberAddButton();
}

function showMembersModal() {
  const modal = $("#offlineClassMembersModal");
  if (!modal) return;
  modal.hidden = false;
  modal.classList.add("is-open");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
}

function hideMembersModal() {
  const modal = $("#offlineClassMembersModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
  membersClassId = "";
  selectedMemberStudentUids.clear();
  classMembers = [];
}

function updateMembersArchivedUi() {
  const archived = isMembersClassArchived();
  const notice = $("#offlineClassMembersArchivedNotice");
  const search = $("#offlineMemberStudentSearch");
  const addBtn = $("#offlineMemberAddBtn");
  if (notice) notice.hidden = !archived;
  if (search) search.disabled = archived;
  if (addBtn && archived) addBtn.disabled = true;
}

async function openMembersModal(classId) {
  const row = allClasses.find((c) => c.id === classId);
  if (!row) {
    toast("반 정보를 찾을 수 없습니다.", true);
    return;
  }

  membersClassId = classId;
  selectedMemberStudentUids.clear();
  $("#offlineMemberStudentSearch") && ($("#offlineMemberStudentSearch").value = "");
  const title = $("#offlineClassMembersModalTitle");
  const subtitle = $("#offlineClassMembersModalSubtitle");
  if (title) title.textContent = "반 학생 관리";
  if (subtitle) {
    const parts = [row.className, row.subject, formatSchoolGrade(row)].filter(
      (p) => p && p !== "-"
    );
    subtitle.textContent = parts.join(" / ");
  }

  updateMembersArchivedUi();
  renderStudentSearchResults();
  showMembersModal();
  await loadStudents();
  await loadClassMembers(classId);
}

function closeMembersModal() {
  hideMembersModal();
}

function buildMemberSnapshots(student) {
  const fields = studentDisplayFields(student);
  return {
    studentNameSnapshot: fields.name,
    schoolSnapshot: fields.school,
    gradeSnapshot: fields.grade,
    phoneSnapshot: fields.phone
  };
}

async function addMembers(studentUids) {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (!membersClassId) {
    toast("반 정보가 없습니다.", true);
    return;
  }
  if (isMembersClassArchived()) {
    toast("보관된 반에는 학생을 추가할 수 없습니다.", true);
    return;
  }

  const uniqueUids = [...new Set(studentUids)].filter(Boolean);
  if (!uniqueUids.length) {
    toast("입반 처리할 학생을 선택해주세요.", true);
    return;
  }

  try {
    const activeUids = getActiveMemberUids();
    let addedCount = 0;
    let skippedCount = 0;

    for (const studentUid of uniqueUids) {
      const student = allStudents.find((s) => s.uid === studentUid);
      if (!student || activeUids.has(studentUid)) {
        skippedCount += 1;
        continue;
      }

      const docId = memberDocId(membersClassId, studentUid);
      const memberRef = doc(db, "offlineClassMembers", docId);
      const snapshots = buildMemberSnapshots(student);
      const existing = await getDoc(memberRef);
      if (existing.exists() && isActiveMember(existing.data())) {
        skippedCount += 1;
        activeUids.add(studentUid);
        continue;
      }
      if (existing.exists()) {
        await deleteMemberAccessDocs(membersClassId, studentUid);
        await deleteDoc(memberRef);
      }
      await setDoc(memberRef, {
        classId: membersClassId,
        studentUid,
        ...snapshots,
        status: "active",
        joinedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      addedCount += 1;
      activeUids.add(studentUid);
    }

    const messages = [];
    if (addedCount) messages.push(`${addedCount}명의 학생을 입반 처리했습니다.`);
    if (skippedCount) messages.push(`이미 배정된 학생 ${skippedCount}명은 건너뛰었습니다.`);
    toast(messages.join(" ") || "입반 처리할 학생이 없습니다.", !addedCount);

    selectedMemberStudentUids.clear();
    if ($("#offlineMemberStudentSearch")) $("#offlineMemberStudentSearch").value = "";
    await loadClassMembers(membersClassId);
    renderStudentSearchResults();
  } catch (err) {
    console.error("[offline-classes] add member failed:", err);
    toast("입반 처리 실패: " + (err.message || err), true);
  }
}

function getCurrentSessionsClass() {
  return allClasses.find((c) => c.id === sessionsClassId) || null;
}

function isSessionsClassArchived() {
  return getCurrentSessionsClass()?.status === "archived";
}

function parseSessionDateValue(value) {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }
  return 0;
}

function formatSessionDateDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${y}. ${Number(m)}. ${Number(d)}.`;
  }
  const t = parseSessionDateValue(value);
  if (!t) return escapeHtml(raw);
  return new Date(t).toLocaleDateString("ko-KR");
}

function sortSessions(sessions) {
  return sessions.slice().sort((a, b) => {
    const dateDiff =
      parseSessionDateValue(b.sessionDate) - parseSessionDateValue(a.sessionDate);
    if (dateDiff !== 0) return dateDiff;
    return (Number(b.sessionNo) || 0) - (Number(a.sessionNo) || 0);
  });
}

function isValidVideoUrl(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  try {
    const parsed = new URL(s);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sessionStatusBadge(status) {
  if (status === "published") {
    return '<span class="offline-session-status offline-session-status--published">게시</span>';
  }
  if (status === "archived") {
    return '<span class="offline-session-status offline-session-status--archived">보관</span>';
  }
  return '<span class="offline-session-status offline-session-status--draft">임시저장 / 미사용</span>';
}

function getSessionVideos(row) {
  if (Array.isArray(row?.videos) && row.videos.length) {
    return row.videos
      .map((v) => ({
        title: String(v?.title || "").trim(),
        url: String(v?.url || "").trim()
      }))
      .filter((v) => v.url || v.title);
  }
  const legacyUrl = String(row?.videoUrl || "").trim();
  if (legacyUrl) return [{ title: "", url: legacyUrl }];
  return [];
}

function getSessionVideosWithUrl(row) {
  return getSessionVideos(row).filter((v) => isValidVideoUrl(v.url));
}

function sessionVideoCell(row) {
  if (row?.hasVideo !== true) {
    return '<span class="muted">영상 없음</span>';
  }
  const videos = getSessionVideosWithUrl(row);
  if (!videos.length) {
    return '<span class="muted">영상 URL 확인 필요</span>';
  }
  const countLabel =
    videos.length === 1 ? "영상 1개" : `영상 ${videos.length}개`;
  const firstUrl = escapeHtml(videos[0].url);
  const link = `<a href="${firstUrl}" target="_blank" rel="noopener noreferrer" class="offline-session-video-link">첫 영상 확인</a>`;
  return `<span>${escapeHtml(countLabel)}</span> / ${link}`;
}

function sessionAccessDocId(sessionId, studentUid) {
  return `${sessionId}_${studentUid}`;
}

function renderSessionVideoRows(videos) {
  const list = $("#sessionVideosList");
  if (!list) return;
  const rows = videos?.length ? videos : [{ title: "", url: "" }];
  list.innerHTML = rows
    .map(
      (v, index) => `
    <div class="offline-session-video-row" data-index="${index}">
      <div class="form-group">
        <label>영상 제목</label>
        <input type="text" class="session-video-title" value="${escapeHtml(v.title || "")}" placeholder="예: 1강 복습" autocomplete="off">
      </div>
      <div class="form-group">
        <label>영상 URL</label>
        <input type="url" class="session-video-url" value="${escapeHtml(v.url || "")}" placeholder="https://..." autocomplete="off">
      </div>
      <button type="button" class="btn sm session-video-remove-btn" data-action="remove-video" aria-label="영상 삭제">삭제</button>
    </div>`
    )
    .join("");
}

function readSessionVideoRowsFromForm() {
  const rows = $$(".offline-session-video-row", $("#sessionVideosList"));
  const videos = [];
  rows.forEach((row) => {
    const title = (row.querySelector(".session-video-title")?.value || "").trim();
    const url = (row.querySelector(".session-video-url")?.value || "").trim();
    if (!title && !url) return;
    videos.push({ title, url });
  });
  return videos;
}

function syncSessionVideosSection() {
  const hasVideo = $("#sessionHasVideo")?.checked === true;
  const section = $("#sessionVideosSection");
  const list = $("#sessionVideosList");
  if (section) section.hidden = !hasVideo;
  if (!hasVideo) {
    if (list) list.innerHTML = "";
    return;
  }
  if (list && !list.children.length) {
    renderSessionVideoRows([{ title: "", url: "" }]);
  }
}

function addSessionVideoRow() {
  const current = readSessionVideoRowsFromForm();
  current.push({ title: "", url: "" });
  renderSessionVideoRows(current);
}

async function loadClassSessions(classId) {
  const tbody = $("#tblOfflineClassSessions tbody");
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted admin-table-empty">로딩 중...</td></tr>';
  }
  try {
    const snap = await getDocs(
      query(collection(db, "offlineClassSessions"), where("classId", "==", classId))
    );
    classSessions = sortSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    renderSessionsTable();
  } catch (err) {
    console.error("[offline-classes] sessions load failed:", err);
    toast("수업 목록을 불러오지 못했습니다: " + (err.message || err), true);
    classSessions = [];
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted admin-table-empty">목록을 불러오지 못했습니다.</td></tr>';
    }
  }
}

function renderSessionsTable() {
  const tbody = $("#tblOfflineClassSessions tbody");
  const meta = $("#offlineSessionsMeta");
  if (!tbody) return;

  if (meta) {
    meta.textContent = `총 ${classSessions.length}개 수업`;
  }

  if (!classSessions.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted admin-table-empty">등록된 수업이 없습니다. 「+ 수업 추가」로 생성하세요.</td></tr>';
    return;
  }

  tbody.innerHTML = classSessions
    .map((row) => {
      const accessBtn = `<button type="button" class="btn sm" data-session-action="access" data-session-id="${escapeHtml(row.id)}">예외 권한</button>`;
      return `
      <tr data-session-id="${escapeHtml(row.id)}">
        <td>${escapeHtml(String(row.sessionNo ?? "-"))}</td>
        <td>${formatSessionDateDisplay(row.sessionDate)}</td>
        <td>${escapeHtml(String(row.title || "-"))}</td>
        <td>${sessionVideoCell(row)}</td>
        <td>${sessionStatusBadge(row.status)}</td>
        <td>
          <div class="offline-session-actions">
            ${accessBtn}
            <button type="button" class="btn sm" data-session-action="edit" data-session-id="${escapeHtml(row.id)}">수정</button>
            <button type="button" class="btn sm danger" data-session-action="delete-permanent" data-session-id="${escapeHtml(row.id)}">영구 삭제</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function showSessionsModal() {
  const modal = $("#offlineClassSessionsModal");
  if (!modal) return;
  modal.hidden = false;
  modal.classList.add("is-open");
  document.body.classList.add("modal-open");
  document.documentElement.classList.add("modal-open");
}

function hideSessionsModal() {
  const modal = $("#offlineClassSessionsModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");
  sessionsClassId = "";
  classSessions = [];
  closeSessionFormModal(true);
  closeSessionAccessModal();
}

function updateSessionsArchivedUi() {
  const archived = isSessionsClassArchived();
  const notice = $("#offlineClassSessionsArchivedNotice");
  const addBtn = $("#offlineSessionAddBtn");
  if (notice) notice.hidden = !archived;
  if (addBtn) addBtn.disabled = archived;
}

async function openSessionsModal(classId) {
  const row = allClasses.find((c) => c.id === classId);
  if (!row) {
    toast("반 정보를 찾을 수 없습니다.", true);
    return;
  }

  sessionsClassId = classId;
  const title = $("#offlineClassSessionsModalTitle");
  const subtitle = $("#offlineClassSessionsModalSubtitle");
  if (title) title.textContent = "수업 관리";
  if (subtitle) {
    const parts = [row.className, row.subject, formatSchoolGrade(row)].filter(
      (p) => p && p !== "-"
    );
    subtitle.textContent = parts.join(" / ");
  }

  updateSessionsArchivedUi();
  showSessionsModal();
  await loadClassSessions(classId);
}

function closeSessionsModal() {
  hideSessionsModal();
}

function showSessionFormModal() {
  const modal = $("#offlineSessionFormModal");
  if (!modal) return;
  modal.hidden = false;
  modal.classList.add("is-open");
}

function hideSessionFormModal() {
  const modal = $("#offlineSessionFormModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
}

async function closeSessionFormModal(force = false) {
  if (!force && !(await confirmDiscardIfDirty(sessionFormDirty))) return;
  hideSessionFormModal();
}

function suggestNextSessionNo() {
  if (!classSessions.length) return 1;
  const maxNo = classSessions.reduce(
    (max, s) => Math.max(max, Number(s.sessionNo) || 0),
    0
  );
  return maxNo + 1;
}

function openSessionFormModal(mode, sessionId = "") {
  if (!sessionsClassId) {
    toast("반 정보가 없습니다.", true);
    return;
  }
  if (mode === "add" && isSessionsClassArchived()) {
    toast("보관된 반에는 수업을 추가할 수 없습니다.", true);
    return;
  }

  const title = $("#offlineSessionFormModalTitle");
  const editId = $("#offlineSessionEditId");
  $("#offlineSessionForm")?.reset();
  if (editId) editId.value = "";

  if (mode === "edit" && sessionId) {
    const row = classSessions.find((s) => s.id === sessionId);
    if (!row) {
      toast("수업 정보를 찾을 수 없습니다.", true);
      return;
    }
    if (title) title.textContent = "수업 수정";
    if (editId) editId.value = sessionId;
    $("#sessionNo").value = row.sessionNo ?? "";
    $("#sessionDate").value = String(row.sessionDate || "").slice(0, 10);
    $("#sessionTitle").value = row.title || "";
    $("#sessionDescription").value = row.description || "";
    $("#sessionHasVideo").checked = row.hasVideo === true;
    const videos = getSessionVideos(row);
    renderSessionVideoRows(
      videos.length ? videos : row.hasVideo === true ? [{ title: "", url: "" }] : []
    );
    $("#sessionStatus").value =
      row.status === "archived" || row.status === "draft" ? "archived" : "published";
  } else {
    if (title) title.textContent = "수업 추가";
    $("#sessionNo").value = String(suggestNextSessionNo());
    $("#sessionStatus").value = "published";
    $("#sessionHasVideo").checked = false;
    renderSessionVideoRows([]);
  }

  syncSessionVideosSection();
  showSessionFormModal();
  sessionFormDirty.capture();
}

function readSessionFormPayload() {
  const sessionNo = Number.parseInt($("#sessionNo")?.value || "", 10);
  const sessionDate = ($("#sessionDate")?.value || "").trim();
  const title = ($("#sessionTitle")?.value || "").trim();
  const description = ($("#sessionDescription")?.value || "").trim();
  const hasVideo = $("#sessionHasVideo")?.checked === true;
  const statusRaw = $("#sessionStatus")?.value || "published";
  const status =
    statusRaw === "archived" ? "archived" : "published";

  if (!Number.isFinite(sessionNo) || sessionNo < 1) {
    throw new Error("수업 번호를 입력해주세요.");
  }
  if (!sessionDate) throw new Error("수업일을 선택해주세요.");
  if (!title) throw new Error("제목을 입력해주세요.");

  let videos = [];
  let videoUrl = "";
  if (hasVideo) {
    videos = readSessionVideoRowsFromForm().filter((v) => v.url);
    if (!videos.length) {
      throw new Error("영상 있음으로 저장하려면 재생 가능한 영상 URL이 1개 이상 필요합니다.");
    }
    if (videos.some((v) => !isValidVideoUrl(v.url))) {
      throw new Error("영상 URL을 확인해주세요.");
    }
    videoUrl = videos[0].url;
  }

  return {
    sessionNo,
    sessionDate,
    title,
    description,
    hasVideo,
    videos: hasVideo ? videos : [],
    videoUrl: hasVideo ? videoUrl : "",
    status
  };
}

async function saveSessionFromForm(e) {
  e.preventDefault();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (!sessionsClassId) {
    toast("반 정보가 없습니다.", true);
    return;
  }

  const editId = ($("#offlineSessionEditId")?.value || "").trim();
  if (!editId && isSessionsClassArchived()) {
    toast("보관된 반에는 수업을 추가할 수 없습니다.", true);
    return;
  }

  let payload;
  try {
    payload = readSessionFormPayload();
  } catch (err) {
    toast(err.message || String(err), true);
    return;
  }

  const submitBtn = $("#offlineSessionFormSubmit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    let sessionId = editId;
    if (editId) {
      await setDoc(
        doc(db, "offlineClassSessions", editId),
        {
          ...payload,
          classId: sessionsClassId,
          updatedAt: serverTimestamp(),
          updatedBy: uid
        },
        { merge: true }
      );
      toast("수업이 저장되었습니다.");
    } else {
      const ref = await addDoc(collection(db, "offlineClassSessions"), {
        ...payload,
        classId: sessionsClassId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid
      });
      sessionId = ref.id;
      toast("수업이 추가되었습니다.");
    }
    closeSessionFormModal(true);
    await loadClassSessions(sessionsClassId);
  } catch (err) {
    console.error("[offline-classes] session save failed:", err);
    toast("저장 실패: " + (err.message || err), true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteMemberAccessDocs(classId, studentUid) {
  await deleteDocsFromQuery(
    query(
      collection(db, "offlineSessionAccess"),
      where("classId", "==", classId),
      where("studentUid", "==", studentUid)
    )
  );
}

async function fetchClassMembersForClass(classId) {
  const snap = await getDocs(
    query(collection(db, "offlineClassMembers"), where("classId", "==", classId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(isActiveMember)
    .sort((a, b) =>
      String(a.studentNameSnapshot || "").localeCompare(
        String(b.studentNameSnapshot || ""),
        "ko"
      )
    );
}

function toDateOnlyMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const raw = value.trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    const d = new Date(parsed);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value?.seconds === "number") {
    const d = new Date(value.seconds * 1000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function isSessionOnOrAfterJoinDate(sessionDate, joinedAt) {
  const sessionMs = toDateOnlyMs(sessionDate);
  const joinedMs = toDateOnlyMs(joinedAt);
  if (sessionMs == null || joinedMs == null) return false;
  return sessionMs >= joinedMs;
}

function formatJoinedAtDisplay(joinedAt) {
  const ms = toDateOnlyMs(joinedAt);
  if (ms == null) return "-";
  return new Date(ms).toLocaleDateString("ko-KR");
}

/**
 * @returns {{ key: string, label: string }}
 */
function getMemberAccessDisplayState(member, session, access) {
  if (member?.status === "removed") {
    return { key: "none", label: "접근 없음" };
  }
  if (access?.status === "revoked") {
    return { key: "manualRevoke", label: "수동 차단" };
  }
  if (access?.status === "active") {
    return { key: "manualGrant", label: "수동 허용" };
  }
  if (isSessionOnOrAfterJoinDate(session?.sessionDate, member?.joinedAt)) {
    return { key: "defaultAllow", label: "기본 허용" };
  }
  return { key: "none", label: "접근 없음" };
}

function accessDisplayStatusBadge(state) {
  const cls =
    state.key === "defaultAllow"
      ? "offline-access-status--default"
      : state.key === "manualGrant"
        ? "offline-access-status--active"
        : state.key === "manualRevoke"
          ? "offline-access-status--revoked"
          : "offline-access-status--none";
  return `<span class="offline-access-status ${cls}">${escapeHtml(state.label)}</span>`;
}

function accessTypeLabel(access, state) {
  if (access?.type === "manualGrant" || access?.type === "manualRevoke") {
    return escapeHtml(access.type === "manualGrant" ? "manualGrant" : "manualRevoke");
  }
  if (access?.status === "active" && access?.source === "auto") {
    return "legacy auto";
  }
  if (state.key === "defaultAllow") return "-";
  return "-";
}

function memberStatusLabelForAccess(member) {
  if (member.status === "removed") {
    return '<span class="offline-member-status offline-member-status--removed">퇴출/제외</span>';
  }
  return '<span class="offline-member-status offline-member-status--active">재원</span>';
}

async function loadSessionAccess(sessionId) {
  const snap = await getDocs(
    query(collection(db, "offlineSessionAccess"), where("sessionId", "==", sessionId))
  );
  sessionAccessByStudent = new Map();
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const studentUid = String(data.studentUid || "").trim();
    if (studentUid) sessionAccessByStudent.set(studentUid, { id: d.id, ...data });
  });
}

function renderSessionAccessTable() {
  const tbody = $("#tblSessionAccess tbody");
  if (!tbody || !accessSessionRow) return;

  if (!accessModalMembers.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="muted admin-table-empty">이 반에 등록된 학생이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = accessModalMembers
    .map((member) => {
      const studentUid = String(member.studentUid || "").trim();
      const access = sessionAccessByStudent.get(studentUid);
      const state = getMemberAccessDisplayState(member, accessSessionRow, access);
      const grantBtn =
        state.key === "none" || state.key === "manualRevoke"
          ? `<button type="button" class="btn sm primary" data-access-action="grant" data-student-uid="${escapeHtml(studentUid)}">허용</button>`
          : "";
      const revokeBtn =
        state.key === "defaultAllow" || state.key === "manualGrant"
          ? `<button type="button" class="btn sm danger" data-access-action="revoke" data-student-uid="${escapeHtml(studentUid)}">차단</button>`
          : "";
      const actions = [grantBtn, revokeBtn].filter(Boolean).join(" ") || '<span class="muted">-</span>';
      return `
      <tr class="${member.status === "removed" ? "offline-access-row--removed" : ""}">
        <td>${escapeHtml(String(member.studentNameSnapshot || "-"))}</td>
        <td>${escapeHtml(String(member.schoolSnapshot || "-"))}</td>
        <td>${escapeHtml(String(member.gradeSnapshot || "-"))}</td>
        <td>${escapeHtml(String(member.phoneSnapshot || "-"))}</td>
        <td>${memberStatusLabelForAccess(member)}</td>
        <td>${escapeHtml(formatJoinedAtDisplay(member.joinedAt))}</td>
        <td>${accessDisplayStatusBadge(state)}</td>
        <td>${accessTypeLabel(access, state)}</td>
        <td><div class="offline-access-actions">${actions}</div></td>
      </tr>`;
    })
    .join("");
}

function showSessionAccessModal() {
  const modal = $("#offlineSessionAccessModal");
  if (!modal) return;
  modal.hidden = false;
  modal.classList.add("is-open");
}

function hideSessionAccessModal() {
  const modal = $("#offlineSessionAccessModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  accessSessionId = "";
  accessSessionRow = null;
  sessionAccessByStudent = new Map();
  accessModalMembers = [];
}

function closeSessionAccessModal() {
  hideSessionAccessModal();
}

async function openSessionAccessModal(sessionId) {
  if (!sessionsClassId) {
    toast("반 정보가 없습니다.", true);
    return;
  }
  const session = classSessions.find((s) => s.id === sessionId);
  if (!session) {
    toast("수업 정보를 찾을 수 없습니다.", true);
    return;
  }
  accessSessionId = sessionId;
  accessSessionRow = session;
  const classRow = getCurrentSessionsClass();
  const title = $("#offlineSessionAccessModalTitle");
  const subtitle = $("#offlineSessionAccessModalSubtitle");
  const meta = $("#offlineSessionAccessModalMeta");
  if (title) title.textContent = "예외 권한 관리";
  if (subtitle) {
    const parts = [classRow?.className, session.title].filter(Boolean);
    subtitle.textContent = parts.join(" / ");
  }
  const videoCount = getSessionVideosWithUrl(session).length;
  if (meta) {
    meta.textContent = `${formatSessionDateDisplay(session.sessionDate)} / ${
      videoCount ? `${videoCount}개 영상` : "영상 없음"
    }`;
  }

  const tbody = $("#tblSessionAccess tbody");
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="muted admin-table-empty">로딩 중...</td></tr>';
  }

  showSessionAccessModal();

  try {
    accessModalMembers = await fetchClassMembersForClass(sessionsClassId);
    await loadSessionAccess(sessionId);
    renderSessionAccessTable();
  } catch (err) {
    console.error("[offline-classes] access load failed:", err);
    toast("예외 권한 목록을 불러오지 못했습니다: " + (err.message || err), true);
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="muted admin-table-empty">목록을 불러오지 못했습니다.</td></tr>';
    }
  }
}

async function grantSessionAccess(studentUid) {
  if (!auth.currentUser?.uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (!accessSessionId || !sessionsClassId || !studentUid) return;

  const accessRef = doc(
    db,
    "offlineSessionAccess",
    sessionAccessDocId(accessSessionId, studentUid)
  );

  try {
    const existing = await getDoc(accessRef);
    const payload = {
      classId: sessionsClassId,
      sessionId: accessSessionId,
      studentUid,
      status: "active",
      type: "manualGrant",
      source: "manual",
      grantedAt: serverTimestamp(),
      revokedAt: null,
      updatedAt: serverTimestamp()
    };
    if (!existing.exists()) {
      await setDoc(accessRef, { ...payload, createdAt: serverTimestamp() });
    } else {
      await setDoc(accessRef, payload, { merge: true });
    }
    toast("수동 허용이 저장되었습니다.");
    await loadSessionAccess(accessSessionId);
    renderSessionAccessTable();
  } catch (err) {
    console.error("[offline-classes] grant access failed:", err);
    toast("접근 허용 실패: " + (err.message || err), true);
  }
}

async function revokeSessionAccess(studentUid) {
  if (!auth.currentUser?.uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (!accessSessionId || !sessionsClassId || !studentUid) return;

  const member = accessModalMembers.find((m) => m.studentUid === studentUid);
  const name = String(member?.studentNameSnapshot || "학생");
  if (!(await openAdminConfirm({
    title: "수업 접근 차단",
    message: `${name} 학생의 이 수업 접근을 수동 차단하시겠습니까?`,
    confirmLabel: "접근 차단",
    danger: true
  }))) return;

  const accessRef = doc(
    db,
    "offlineSessionAccess",
    sessionAccessDocId(accessSessionId, studentUid)
  );

  try {
    const existing = await getDoc(accessRef);
    const payload = {
      classId: sessionsClassId,
      sessionId: accessSessionId,
      studentUid,
      status: "revoked",
      type: "manualRevoke",
      source: "manual",
      revokedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (!existing.exists()) {
      await setDoc(accessRef, { ...payload, createdAt: serverTimestamp() });
    } else {
      await setDoc(accessRef, payload, { merge: true });
    }
    toast("수동 차단이 저장되었습니다.");
    await loadSessionAccess(accessSessionId);
    renderSessionAccessTable();
  } catch (err) {
    console.error("[offline-classes] revoke access failed:", err);
    toast("접근 차단 실패: " + (err.message || err), true);
  }
}

async function removeMember(studentUid) {
  if (!auth.currentUser?.uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  if (!membersClassId || !studentUid) return;

  const member = classMembers.find((m) => m.studentUid === studentUid);
  if (!member) {
    toast("배정된 학생을 찾을 수 없습니다.", true);
    return;
  }

  const name = String(member.studentNameSnapshot || "학생");
  try {
    const accessSnap = await getDocs(
      query(
        collection(db, "offlineSessionAccess"),
        where("classId", "==", membersClassId),
        where("studentUid", "==", studentUid)
      )
    );
    const message = [
      `${name} 학생을 해당 오프라인 반에서 제거합니다.`,
      "반 배정 정보와 이 반에 대한 수동 수업 접근 권한 기록이 함께 정리됩니다.",
      `이 학생과 연결된 수동 접근 권한 기록 ${accessSnap.size}개가 함께 정리됩니다.`,
      "학생 계정과 온라인 강좌 수강 정보는 삭제되지 않습니다.",
      "",
      "계속 진행하시겠습니까?"
    ].join("\n");
    if (!(await openAdminConfirm({
      title: "반 학생 제거",
      message,
      confirmLabel: "학생 제거",
      danger: true
    }))) {
      toast("학생 제거가 취소되었습니다.", true);
      return;
    }

    await deleteMemberAccessDocs(membersClassId, studentUid);
    await deleteDoc(doc(db, "offlineClassMembers", memberDocId(membersClassId, studentUid)));
    toast("학생이 반에서 제거되었습니다.");
    await loadClassMembers(membersClassId);
    renderStudentSearchResults();
  } catch (err) {
    console.error("[offline-classes] remove member failed:", err);
    toast("학생 제거 실패: " + (err.message || err), true);
  }
}

function bindEvents() {
  $("#offlineCatalogSaveBtn")?.addEventListener("click", () => {
    saveOfflineCatalogDraft();
  });

  $("#adminScheduleGroupTabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-schedule-group-id]");
    if (!tab) return;
    selectScheduleGroup(tab.getAttribute("data-schedule-group-id") || REGULAR_SCHEDULE_GROUP_ID);
  });

  document.querySelectorAll("[data-catalog-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.getAttribute("data-catalog-add") || "";
      const meta = CATALOG_FIELD_META[field];
      if (!meta) return;
      addCatalogDraftValue(field, $(`#${meta.inputId}`)?.value || "");
    });
  });
  Object.entries(CATALOG_FIELD_META).forEach(([field, meta]) => {
    $(`#${meta.inputId}`)?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addCatalogDraftValue(field, event.currentTarget.value || "");
    });
  });
  $("#offlineCatalogPanel")?.addEventListener("click", (event) => {
    const moveBtn = event.target.closest("[data-catalog-move]");
    if (moveBtn) {
      moveCatalogDraftValue(
        moveBtn.dataset.catalogField || "",
        moveBtn.dataset.catalogValue || "",
        moveBtn.dataset.catalogMove || ""
      );
      return;
    }
    const removeBtn = event.target.closest(".admin-catalog-tag__remove");
    if (removeBtn) {
      removeCatalogDraftValue(removeBtn.dataset.catalogField || "", removeBtn.dataset.catalogValue || "");
      return;
    }
    const editBtn = event.target.closest(".admin-catalog-tag__edit");
    if (editBtn) {
      renameCatalogDraftValue(editBtn.dataset.catalogField || "", editBtn.dataset.catalogValue || "");
    }
  });
  $("#offlineCatalogPanel")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-catalog-inline-input]");
    if (!input) return;
    renameCatalogDraftValue(input.dataset.catalogField || "", input.dataset.catalogValue || "", input.value);
  });

  $("#classSubject")?.addEventListener("change", () => {
    syncSubjectCustomField($("#classSubject"), $("#classSubjectCustom"), catalogSubjects);
  });
  $("#classGrade")?.addEventListener("change", () => {
    syncGradeCustomField($("#classGrade"), $("#classGradeCustom"));
  });
  $("#offlineClassGroupId")?.addEventListener("change", (event) => {
    refreshModalCatalogForGroup(event.currentTarget.value || selectedScheduleGroupId);
  });

  const addBtn = $("#addOfflineClassBtn");
  if (addBtn) {
    addBtn.addEventListener("click", openCreateModal);
  } else {
    console.warn("[offline-classes]", "add button not found (#addOfflineClassBtn)");
  }

  $("#btnRefresh")?.addEventListener("click", () => loadOfflineClasses());
  $("#offlineClassModalClose")?.addEventListener("click", closeModal);
  $("#offlineClassFormCancel")?.addEventListener("click", closeModal);
  $("#offlineClassForm")?.addEventListener("submit", saveClassFromForm);

  ["filterSearch", "filterSubject", "filterGrade", "filterInstructor", "filterStatus"].forEach(
    (id) => {
      $(`#${id}`)?.addEventListener("input", renderTable);
      $(`#${id}`)?.addEventListener("change", renderTable);
    }
  );

  $("#tblOfflineClasses")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "sessions") openSessionsModal(id);
    else if (action === "members") openMembersModal(id);
    else if (action === "edit") openModal("edit", id);
    else if (action === "archive") setClassStatus(id, "archived");
    else if (action === "reactivate") setClassStatus(id, "active");
    else if (action === "delete-permanent") permanentDeleteClass(id);
  });

  $("#offlineClassMembersModalClose")?.addEventListener("click", closeMembersModal);
  $("#offlineMemberStudentSearch")?.addEventListener("input", () => {
    selectedMemberStudentUids.clear();
    renderStudentSearchResults();
  });
  $("#offlineMemberSearchResults")?.addEventListener("change", (e) => {
    const input = e.target.closest('input[name="offlineMemberStudentPick"]');
    if (!input || input.disabled) return;
    const studentUid = input.value || "";
    if (input.checked) selectedMemberStudentUids.add(studentUid);
    else selectedMemberStudentUids.delete(studentUid);
    updateMemberAddButton();
  });
  $("#offlineMemberAddBtn")?.addEventListener("click", () => {
    addMembers([...selectedMemberStudentUids]);
  });
  $("#tblOfflineClassMembers")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-member-action]");
    if (!btn) return;
    const studentUid = btn.dataset.studentUid || "";
    if (btn.dataset.memberAction === "remove") removeMember(studentUid);
  });

  $("#offlineClassSessionsModalClose")?.addEventListener("click", closeSessionsModal);
  $("#offlineSessionAddBtn")?.addEventListener("click", () => openSessionFormModal("add"));
  $("#offlineSessionFormModalClose")?.addEventListener("click", closeSessionFormModal);
  $("#offlineSessionFormCancel")?.addEventListener("click", closeSessionFormModal);
  $("#offlineSessionForm")?.addEventListener("submit", saveSessionFromForm);
  $("#sessionHasVideo")?.addEventListener("change", syncSessionVideosSection);
  $("#sessionVideoAddBtn")?.addEventListener("click", addSessionVideoRow);
  $("#sessionVideosList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='remove-video']");
    if (!btn) return;
    const row = btn.closest(".offline-session-video-row");
    if (!row) return;
    const current = readSessionVideoRowsFromForm();
    const index = Number.parseInt(row.dataset.index || "-1", 10);
    if (index >= 0 && index < current.length) current.splice(index, 1);
    renderSessionVideoRows(current.length ? current : [{ title: "", url: "" }]);
  });
  $("#tblOfflineClassSessions")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-session-action]");
    if (!btn || btn.disabled) return;
    const sessionId = btn.dataset.sessionId || "";
    const action = btn.dataset.sessionAction;
    if (action === "access") openSessionAccessModal(sessionId);
    else if (action === "edit") openSessionFormModal("edit", sessionId);
    else if (action === "delete-permanent") permanentDeleteSession(sessionId);
  });
  $("#scheduleItemAddBtn")?.addEventListener("click", addScheduleItemRow);
  $("#scheduleItemsList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='remove-schedule-item']");
    if (!btn) return;
    const row = btn.closest(".schedule-item-row");
    if (!row) return;
    const current = readScheduleItemsFromForm();
    const index = Number.parseInt(row.dataset.index || "-1", 10);
    if (index >= 0 && index < current.length) current.splice(index, 1);
    renderScheduleItemsOnForm(current);
    updateClassPreview();
  });
  $("#offlineSessionAccessModalClose")?.addEventListener("click", closeSessionAccessModal);
  $("#tblSessionAccess")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-access-action]");
    if (!btn) return;
    const studentUid = btn.dataset.studentUid || "";
    const action = btn.dataset.accessAction;
    if (action === "grant") grantSessionAccess(studentUid);
    else if (action === "revoke") revokeSessionAccess(studentUid);
  });
}

async function init() {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    console.warn("[offline-classes]", "admin check failed", err);
    return;
  }

  populateFilterSelects();
  bindEvents();
  await loadTimetableCatalogStored();
  populateFilterSelects();
  populateClassFormSelects();
  await loadInstructors();
  await loadOfflineClasses();
}

function bootstrap() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init(), { once: true });
  } else {
    init();
  }
}

bootstrap();
