// /assets/js/pages/admin-offline-classes.js
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
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
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { adminXlsxFilename, writeAdminXlsx } from "/assets/js/utils/admin-xlsx.js";
import { fetchExportDocuments, fetchScopedExportRows } from "/assets/js/utils/admin-export-scope.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";
import { openAdminConfirm } from "/assets/js/utils/admin-dialog.js";
import { accountUidByInstructorId } from "/assets/js/utils/instructor-privacy.js";
import { formatGrade } from "/assets/js/utils/grade.js";
import { setAdminRefreshButtonState } from "/assets/js/utils/admin-refresh.js";
import {
  bindCommittedSearch,
  getListPageState,
  normalizeListPageSize,
  renderListPagination,
} from "/assets/js/utils/list-controls.js";
import {
  clearModalAlert,
  setModalAlert,
} from "/assets/js/utils/admin-modal-alert.js";
import {
  getAdminSettingDoc,
  invalidateSetting,
} from "/assets/js/utils/settings-cache.js";
import { requestPhraseConfirmation } from "/assets/js/utils/confirm-phrase-modal.js";
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
  getScheduleGroups,
  hasOwnGroupCatalogEntry,
  REGULAR_SCHEDULE_GROUP_ID,
  resolveGroupId,
  resolveScheduleGroupLabel,
} from "/assets/js/utils/timetable-catalog.js";
import {
  populateScheduleGroupSelect,
  renderAdminScheduleGroupTabs,
} from "/assets/js/utils/schedule-groups-admin.js";
import {
  getSchoolSavePayload,
  getTimetableSchools,
  normalizeSchoolList,
} from "/assets/js/utils/timetable-schools.js";
import {
  SUBJECT_COLOR_SETTINGS_KEY,
  areSubjectColorMapsEqual,
  buildSubjectColorSettingsPayload,
  collectManagedSubjectNames,
  ensureSubjectColorMap,
  getSubjectColorMapFromSettings,
  getSubjectColorStyle,
  mergeSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
let subjectColorMap = ensureSubjectColorMap(SUBJECTS_FALLBACK);
let offlineSubjectColorSourceMap = mergeSubjectColorMap({});
let persistedOfflineSubjectColorMap = {};
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
const SCHEDULE_TIME_MINUTES = ["00", "10", "20", "30", "40", "50"];

let allClasses = [];
let offlineClassesLoaded = false;
function setOfflineClassExportReady() {
  const button = $("#dlOfflineClasses");
  if (!button) return;
  const count = offlineClassesLoaded ? getFilteredClasses().length : 0;
  button.disabled = !count;
  button.title = !offlineClassesLoaded
    ? "반 목록을 불러온 뒤 다운로드할 수 있습니다"
    : (count ? "현재 선택 그룹과 필터 결과 전체를 엑셀로 다운로드" : "다운로드할 반이 없습니다");
}
/** @type {Map<string, { sessionCount: number | null, memberCount: number | null }>} */
let offlineClassCounts = new Map();
let offlineClassesCurrentPage = 1;
let offlineClassesPageSize = 10;
let appliedOfflineClassKeyword = "";
let appliedOfflineStudentKeyword = "";
let offlineClassesRenderToken = 0;
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
/** @type {Map<string, Array<Record<string, unknown>>>} */
let sessionAccessDocsByStudent = new Map();
/** @type {Array<Record<string, unknown>>} */
let accessModalMembers = [];

function toast(msg, isError = false) {
  showAdminToast(msg, isError);
}

const OPERATION_ERROR_GUIDANCE = {
  "permission-denied": "관리자 권한 또는 Firestore 보안 규칙을 확인하세요.",
  unauthenticated: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.",
  "failed-precondition": "필요한 Firestore 인덱스 또는 현재 데이터 상태를 확인하세요.",
  unavailable: "서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.",
  "deadline-exceeded": "요청 시간이 초과되었습니다. 잠시 후 다시 시도하세요.",
  "not-found": "처리할 데이터를 찾을 수 없습니다. 목록을 새로고침해 주세요."
};

function operationErrorCode(error, fallbackCode = "unknown") {
  const code = String(error?.code || fallbackCode || "unknown").trim();
  return code || "unknown";
}

function formatOperationError(operation, error, fallbackCode = "unknown") {
  const code = operationErrorCode(error, fallbackCode);
  const rawMessage = String(error?.message || "").trim();
  const guidance = OPERATION_ERROR_GUIDANCE[code] || rawMessage || "알 수 없는 오류가 발생했습니다.";
  const detail = rawMessage && rawMessage !== guidance ? `\n상세: ${rawMessage}` : "";
  return `${operation}: ${guidance}${detail}\n오류 코드: ${code}`;
}

function showOperationError(alertSelector, operation, error, fallbackCode = "unknown") {
  const message = formatOperationError(operation, error, fallbackCode);
  setModalAlert($(alertSelector), message, true);
  toast(message, true);
  return message;
}

function clearMembersAlert() {
  clearModalAlert($("#offlineClassMembersAlert"));
}

function clearSessionAccessAlert() {
  clearModalAlert($("#offlineSessionAccessAlert"));
}

function formatTimeDisplay(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function normalizeScheduleItems(classRow, fieldName = "scheduleItems") {
  if (Array.isArray(classRow?.[fieldName]) && classRow[fieldName].length) {
    return classRow[fieldName]
      .map((item) => ({
        day: String(item?.day || "").trim(),
        startTime: formatTimeDisplay(item?.startTime),
        endTime: formatTimeDisplay(item?.endTime),
        room: String(item?.room || "").trim()
      }))
      .filter((item) => item.day);
  }
  if (fieldName !== "scheduleItems") return [];
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

function parseScheduleTimeParts(value) {
  const normalized = formatTimeDisplay(value);
  const match = normalized.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { period: "", hour: "", minute: "" };
  const hour24 = Number(match[1]);
  return {
    period: hour24 >= 12 ? "pm" : "am",
    hour: String(hour24 % 12 || 12).padStart(2, "0"),
    minute: match[2]
  };
}

function renderScheduleTimeControl(value, fieldClass, label) {
  const parts = parseScheduleTimeParts(value);
  const minuteOptions = SCHEDULE_TIME_MINUTES.slice();
  const isLegacyMinute = parts.minute && !minuteOptions.includes(parts.minute);
  if (isLegacyMinute) minuteOptions.unshift(parts.minute);
  return `
    <div class="schedule-time-controls ${fieldClass}">
      <select class="schedule-time-period" aria-label="${label} 오전 오후">
        <option value="">구분</option>
        <option value="am"${parts.period === "am" ? " selected" : ""}>오전</option>
        <option value="pm"${parts.period === "pm" ? " selected" : ""}>오후</option>
      </select>
      <select class="schedule-time-hour" aria-label="${label} 시간">
        <option value="">시</option>
        ${Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"))
          .map((hour) => `<option value="${hour}"${parts.hour === hour ? " selected" : ""}>${hour}시</option>`)
          .join("")}
      </select>
      <select class="schedule-time-minute" aria-label="${label} 분">
        <option value="">분</option>
        ${minuteOptions
          .map((minute) => {
            const legacyLabel = isLegacyMinute && minute === parts.minute ? " (기존)" : "";
            return `<option value="${minute}"${parts.minute === minute ? " selected" : ""}>${minute}분${legacyLabel}</option>`;
          })
          .join("")}
      </select>
    </div>`;
}

function renderNativeScheduleTimeInput(value, fieldClass, label) {
  return `<input type="time" class="schedule-native-time ${fieldClass}" value="${escapeHtml(
    formatTimeDisplay(value)
  )}" aria-label="${label} 시간">`;
}

function readScheduleTimeControl(control) {
  if (!control) return "";
  if (control.matches?.("input[type='time']")) {
    return formatTimeDisplay(control.value);
  }
  const period = (control.querySelector(".schedule-time-period")?.value || "").trim();
  const hour = (control.querySelector(".schedule-time-hour")?.value || "").trim();
  const minute = (control.querySelector(".schedule-time-minute")?.value || "").trim();
  if (!period || !hour || !minute) return "";
  const hour12 = Number(hour);
  const hour24 = hour12 % 12 + (period === "pm" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

function validateScheduleTimeControls(listSelector, label) {
  const rows = $$(".schedule-item-row", $(listSelector));
  rows.forEach((row, index) => {
    const startControl = row.querySelector(".schedule-item-start");
    const endControl = row.querySelector(".schedule-item-end");
    const controls = [startControl, endControl];
    controls.forEach((control) => {
      const values = [
        control?.querySelector(".schedule-time-period")?.value,
        control?.querySelector(".schedule-time-hour")?.value,
        control?.querySelector(".schedule-time-minute")?.value
      ].filter(Boolean);
      if (values.length > 0 && values.length < 3) {
        throw new Error(`${label} ${index + 1}행의 시작/종료 시간을 함께 입력하거나 비워 두세요.`);
      }
    });
    const startTime = readScheduleTimeControl(startControl);
    const endTime = readScheduleTimeControl(endControl);
    if ((startTime && !endTime) || (!startTime && endTime)) {
      throw new Error(`${label} ${index + 1}행의 시작/종료 시간을 함께 입력하거나 비워 두세요.`);
    }
  });
}

function renderScheduleItemsOnForm(
  items,
  {
    listSelector = "#scheduleItemsList",
    emptyLabel = "수업 일정",
    timeInputMode = "segmented"
  } = {}
) {
  const list = $(listSelector);
  if (!list) return;
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) {
    list.innerHTML =
      `<p class="muted schedule-items-empty-hint">${emptyLabel}은 선택 입력입니다. 필요하면 아래 버튼으로 추가하세요.</p>`;
    updateClassPreview();
    return;
  }
  list.innerHTML = rows
    .map((item, index) => {
      const start = escapeHtml(formatTimeDisplay(item.startTime));
      const end = escapeHtml(formatTimeDisplay(item.endTime));
      const room = escapeHtml(item.room || "");
      const renderTimeInput = timeInputMode === "segmented"
        ? renderScheduleTimeControl
        : renderNativeScheduleTimeInput;
      return `
      <div class="schedule-item-row schedule-item-row--${timeInputMode}" data-index="${index}">
        <div class="form-group schedule-item-field--day">
          <label>요일</label>
          <select class="schedule-item-day">
            <option value="">선택</option>
            ${SCHEDULE_DAYS.map(
              (d) =>
                `<option value="${d.id}"${d.id === item.day ? " selected" : ""}>${d.label}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group schedule-item-field--start">
          <label>시작</label>
          ${renderTimeInput(start, "schedule-item-start", "시작")}
        </div>
        <div class="form-group schedule-item-field--end">
          <label>종료</label>
          ${renderTimeInput(end, "schedule-item-end", "종료")}
        </div>
        <div class="form-group schedule-item-field--room">
          <label>강의실</label>
          <input type="text" class="schedule-item-room" value="${room}" autocomplete="off" list="classroomOptions">
        </div>
        <button type="button" class="btn sm danger schedule-item-remove-btn" data-action="remove-schedule-item" aria-label="일정 삭제">삭제</button>
      </div>`;
    })
    .join("");
  updateClassPreview();
}

function readScheduleItemsFromForm(listSelector = "#scheduleItemsList") {
  const rows = $$(".schedule-item-row", $(listSelector));
  const items = [];
  rows.forEach((row) => {
    const day = (row.querySelector(".schedule-item-day")?.value || "").trim();
    if (!day) return;
    const startTime = readScheduleTimeControl(row.querySelector(".schedule-item-start"));
    const endTime = readScheduleTimeControl(row.querySelector(".schedule-item-end"));
    const room = (row.querySelector(".schedule-item-room")?.value || "").trim();
    items.push({ day, startTime, endTime, room });
  });
  return items;
}

function setScheduleItemsOnForm(classRow) {
  renderScheduleItemsOnForm(normalizeScheduleItems(classRow || {}));
}

function setClinicScheduleItemsOnForm(classRow) {
  renderScheduleItemsOnForm(normalizeScheduleItems(classRow || {}, "clinicScheduleItems"), {
    listSelector: "#clinicScheduleItemsList",
    emptyLabel: "클리닉 일정",
    timeInputMode: "segmented"
  });
}

function addScheduleItemRow({
  listSelector = "#scheduleItemsList",
  emptyLabel = "수업 일정",
  timeInputMode = "segmented"
} = {}) {
  const list = $(listSelector);
  const current = readScheduleItemsFromForm(listSelector);
  current.push(defaultScheduleItemRow());
  if (list?.querySelector(".schedule-items-empty-hint")) {
    list.innerHTML = "";
  }
  renderScheduleItemsOnForm(current, { listSelector, emptyLabel, timeInputMode });
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

function formatOfflineGrade(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const label = formatGrade(raw);
  return label === "-" ? raw : label;
}

function formatSchoolGrade(row) {
  const school = getTimetableSchools(row).join(", ");
  const rawGrade = String(row.grade ?? "").trim();
  const grade = rawGrade ? formatOfflineGrade(rawGrade) : "";
  if (school && grade) return `${school} / ${grade}`;
  return school || grade || "-";
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

function renderInstructorChoices(container, selectedValues = [], record = {}) {
  if (!container) return;
  const sorted = Array.from(instructors.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );
  const choices = sorted.map((instructor) => ({
    uid: instructor.uid,
    name: instructor.name,
    missing: false
  }));
  selectedValues.forEach((selectedValue, index) => {
    if (choices.some((choice) => choice.uid === selectedValue)) return;
    const fallbackName = record.instructorNames?.[index] || record.instructorName || selectedValue;
    choices.push({ uid: selectedValue, name: fallbackName, missing: true });
  });
  container.innerHTML = choices.length
    ? choices.map((choice) => `
      <label class="admin-multi-choice">
        <input type="checkbox" value="${escapeHtml(choice.uid)}" data-instructor-name="${escapeHtml(choice.name)}"${selectedValues.includes(choice.uid) ? " checked" : ""}>
        <span>${escapeHtml(choice.name)}${choice.missing ? " (등록 정보 없음)" : ""}</span>
      </label>`).join("")
    : '<p class="admin-multi-choice-empty">배정 가능한 강사가 없습니다.</p>';
}

function ensureInstructorSelectFallbacks(selectEl, record = {}) {
  const selectedValues = getInstructorSelectValues(record);
  if (!selectEl) return selectedValues;
  renderInstructorChoices(selectEl, selectedValues, record);
  return selectedValues;
}

function getInstructorMatchKeys(selectedValue) {
  const value = String(selectedValue || "").trim();
  const inst = value ? instructors.get(value) : null;
  return new Set([value, inst?.uid, inst?.authUid, inst?.instructorId].filter(Boolean));
}

function instructorDisplayName(row) {
  const names = Array.isArray(row.instructorNames)
    ? row.instructorNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  if (names.length) return names.join(", ");
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
    const [snap, accountsSnap] = await Promise.all([
      getDocs(collection(db, "instructors")),
      getDocs(collection(db, "instructorAccounts"))
    ]);
    const accountUidByProfileId = accountUidByInstructorId(accountsSnap.docs);
    snap.docs.forEach((docSnap) => {
      const row = normalizeInstructorProfile(docSnap, accountUidByProfileId);
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
    const current = Array.from(
      modalSelect.querySelectorAll('input[type="checkbox"]:checked')
    ).map((input) => input.value);
    renderInstructorChoices(modalSelect, current);
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
    const [timetableResult, offlineResult, colorResult] = await Promise.all([
      getAdminSettingDoc("timetableCatalog"),
      getAdminSettingDoc("offlineClassCatalog"),
      getAdminSettingDoc(SUBJECT_COLOR_SETTINGS_KEY),
    ]);
    timetableCatalogStored = timetableResult.exists && timetableResult.data ? { ...timetableResult.data } : {};
    offlineClassCatalogStored = offlineResult.exists && offlineResult.data
      ? { ...offlineResult.data }
      : { ...timetableCatalogStored };
    // A previous setDoc implementation wrote dotted keys as literal field names.
    // Prefer those values while they are being migrated so an operator's latest
    // edits are not lost.
    Object.keys(offlineClassCatalogStored).forEach((key) => {
      if (!key.startsWith("groupCatalogs.")) return;
      const groupId = key.slice("groupCatalogs.".length).trim();
      if (!groupId) return;
      offlineClassCatalogStored.groupCatalogs = {
        ...(offlineClassCatalogStored.groupCatalogs || {}),
        [groupId]: offlineClassCatalogStored[key],
      };
    });
    persistedOfflineSubjectColorMap = colorResult.exists
      ? getSubjectColorMapFromSettings(colorResult.data)
      : {};
    let legacyColorMap = {};
    if (!Object.keys(persistedOfflineSubjectColorMap).length) {
      const instructorsResult = await getAdminSettingDoc("instructorsMenu");
      legacyColorMap = instructorsResult.exists
        ? getSubjectColorMapFromSettings(instructorsResult.data)
        : {};
    }
    const managedSubjects = collectManagedSubjectNames({
      offlineClassCatalog: offlineClassCatalogStored,
      timetableCatalog: timetableCatalogStored,
    });
    subjectColorMap = ensureSubjectColorMap(managedSubjects, {
      ...legacyColorMap,
      ...persistedOfflineSubjectColorMap,
    });
    offlineSubjectColorSourceMap = { ...subjectColorMap };
  } catch (err) {
    console.warn("[offline-classes] catalog settings load failed:", err);
    timetableCatalogStored = {};
    offlineClassCatalogStored = {};
    offlineSubjectColorSourceMap = mergeSubjectColorMap({});
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
  const schoolValues =
    formOptions.schools !== undefined
      ? formOptions.schools
      : (formOptions.school !== undefined ? [formOptions.school] : resolveSchoolsFromControls());
  populateClassFormSelects(subjectValue, gradeValue, schoolValues);
  renderOfflineCatalogPanel();
}

function renderOfflineCatalogPanel() {
  subjectColorMap = ensureSubjectColorMap(catalogDraft.subjects, subjectColorMap);
  Object.keys(CATALOG_FIELD_META).forEach((field) => {
    const host = document.querySelector(`[data-catalog-tags="${field}"]`);
    if (host) {
      host.innerHTML = renderStringCatalogTagsHtml(catalogDraft[field], field, escapeHtml);
      if (field === "subjects") {
        host.querySelectorAll("[data-catalog-inline-input]").forEach((input) => {
          const colorStyle = getSubjectColorStyle(input.dataset.catalogValue || "", subjectColorMap);
          const tag = input.closest(".admin-catalog-tag");
          if (tag && colorStyle) {
            tag.classList.add("has-subject-color");
            tag.setAttribute("style", colorStyle);
          }
        });
      }
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
  offlineClassesCurrentPage = 1;
  renderTable();
}

function populateClassFormSelects(subjectValue = "", gradeValue = "", schoolValues = []) {
  const subjectEl = $("#classSubject");
  const gradeEl = $("#classGrade");
  const subjectCustomEl = $("#classSubjectCustom");
  const gradeCustomEl = $("#classGradeCustom");
  const schoolEl = $("#classSchool");
  const schoolCustomEl = $("#classSchoolCustom");
  if (subjectEl) {
    subjectEl.innerHTML = buildSubjectSelectHtml(catalogSubjects, {
      selected: "",
      emptyLabel: "선택",
      allowCustom: true
    });
    applySubjectSelectValue(subjectEl, subjectCustomEl, subjectValue, catalogSubjects);
    syncSubjectCustomField(subjectEl, subjectCustomEl, catalogSubjects);
    const subjectColorStyle = getSubjectColorStyle(subjectValue, subjectColorMap);
    subjectEl.classList.toggle("has-subject-color", Boolean(subjectColorStyle));
    if (subjectColorStyle) subjectEl.setAttribute("style", subjectColorStyle);
    else subjectEl.removeAttribute("style");
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
    const selectedSchools = normalizeSchoolList(schoolValues);
    const customSchools = selectedSchools.filter((school) => !catalogSchools.includes(school));
    const schoolChoices = [
      ...catalogSchools.map((school) => ({ school, custom: false })),
      ...customSchools.map((school) => ({ school, custom: true }))
    ];
    schoolEl.innerHTML = schoolChoices.length
      ? schoolChoices.map(({ school, custom }) => `
        <label class="admin-multi-choice">
          <input type="checkbox" value="${escapeHtml(school)}"${selectedSchools.includes(school) ? " checked" : ""}>
          <span>${escapeHtml(school)}${custom ? " (직접 입력)" : ""}</span>
        </label>`).join("")
      : '<p class="admin-multi-choice-empty">등록된 학교가 없습니다. 아래에 직접 입력하세요.</p>';
    if (schoolCustomEl) {
      schoolCustomEl.hidden = false;
      schoolCustomEl.required = false;
      schoolCustomEl.value = "";
    }
  }
}

function splitSchoolInput(value) {
  return String(value || "")
    .split(/[\n,，]/)
    .map((school) => school.trim())
    .filter(Boolean);
}

function resolveSchoolsFromControls() {
  const selected = Array.from(
    $("#classSchool")?.querySelectorAll('input[type="checkbox"]:checked') || []
  )
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
  return normalizeSchoolList([
    ...selected,
    ...splitSchoolInput($("#classSchoolCustom")?.value)
  ]);
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
  const saveButton = $("#offlineCatalogSaveBtn");

  try {
    if (saveButton) saveButton.disabled = true;
    const canonicalGroupCatalogs = {
      ...(offlineClassCatalogStored.groupCatalogs || {}),
      ...Object.fromEntries(
        Object.entries(groupCatalogEditsCache).map(([id, value]) => [
          id,
          {
            subjects: value.subjects || [],
            grades: value.grades || [],
            schools: value.schools || [],
          },
        ])
      ),
      [groupId]: fields,
    };
    const nextOfflineCatalog = { groupCatalogs: canonicalGroupCatalogs };
    const managedSubjects = collectManagedSubjectNames({
      offlineClassCatalog: nextOfflineCatalog,
    });
    const colorSettingsPayload = buildSubjectColorSettingsPayload(
      managedSubjects,
      offlineSubjectColorSourceMap
    );
    const shouldWriteSubjectColors = !areSubjectColorMapsEqual(
      colorSettingsPayload.subjectColorMap,
      persistedOfflineSubjectColorMap
    );
    const batch = writeBatch(db);
    // This settings document has one canonical shape. A full replacement keeps
    // legacy top-level arrays and literal dotted fields from surviving a save.
    batch.set(settingsRef, {
      groupCatalogs: canonicalGroupCatalogs,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
    if (shouldWriteSubjectColors) {
      batch.set(
        doc(db, "settings", SUBJECT_COLOR_SETTINGS_KEY),
        {
          ...colorSettingsPayload,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        },
        { merge: true }
      );
    }
    await batch.commit();
    subjectColorMap = colorSettingsPayload.subjectColorMap;
    offlineSubjectColorSourceMap = { ...colorSettingsPayload.subjectColorMap };
    if (shouldWriteSubjectColors) {
      persistedOfflineSubjectColorMap = { ...colorSettingsPayload.subjectColorMap };
      invalidateSetting(SUBJECT_COLOR_SETTINGS_KEY);
    }

    invalidateSetting("offlineClassCatalog");
    offlineClassCatalogStored = {
      groupCatalogs: canonicalGroupCatalogs,
      updatedBy: uid,
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
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function refreshOfflineClassesPage() {
  const button = $("#refreshBtn");
  if (button?.disabled) return;
  setAdminRefreshButtonState(button, true);
  try {
    await loadTimetableCatalogStored();
    await Promise.all([
      loadInstructors(),
      loadOfflineClasses(),
    ]);
    toast("최신 반 목록과 선택 목록을 불러왔습니다.");
  } catch (err) {
    console.error("[offline-classes] refresh failed:", err);
    toast("새로고침에 실패했습니다.", true);
  } finally {
    setAdminRefreshButtonState(button, false);
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
      opt.textContent = formatOfflineGrade(g);
      gradeEl.appendChild(opt);
    });
    gradeEl.value = cur;
  }
}

async function loadOfflineClasses() {
  const tbody = $("#tblOfflineClasses tbody");
  offlineClassesLoaded = false;
  setOfflineClassExportReady();
  try {
    const snap = await getDocs(collection(db, "offlineClasses"));
    allClasses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        String(a.className || "").localeCompare(String(b.className || ""), "ko")
      );
    offlineClassCounts.clear();
    offlineClassesCurrentPage = 1;
    renderScheduleGroupsUi();
    await renderTable();
    offlineClassesLoaded = true;
    setOfflineClassExportReady();
  } catch (err) {
    setOfflineClassExportReady();
    console.error("[offline-classes] load failed:", err);
    toast("목록을 불러오지 못했습니다: " + (err.message || err), true);
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="muted admin-table-empty">데이터를 불러오지 못했습니다.</td></tr>';
    }
  }
}

async function loadOfflineClassCounts(rows) {
  const uncachedRows = rows.filter((row) => !offlineClassCounts.has(row.id));
  if (!uncachedRows.length) return;
  const entries = await Promise.all(
    uncachedRows.map(async (row) => {
      const [sessionsResult, membersResult] = await Promise.allSettled([
        getCountFromServer(
          query(collection(db, "offlineClassSessions"), where("classId", "==", row.id))
        ),
        getCountFromServer(
          query(collection(db, "offlineClassMembers"), where("classId", "==", row.id))
        )
      ]);

      if (sessionsResult.status === "rejected" || membersResult.status === "rejected") {
        console.warn("[offline-classes] count load failed:", row.id, {
          sessions: sessionsResult.status === "rejected" ? sessionsResult.reason : null,
          members: membersResult.status === "rejected" ? membersResult.reason : null
        });
      }

      return [
        row.id,
        {
          sessionCount:
            sessionsResult.status === "fulfilled"
              ? sessionsResult.value.data().count
              : null,
          memberCount:
            membersResult.status === "fulfilled"
              ? membersResult.value.data().count
              : null
        }
      ];
    })
  );

  entries.forEach(([classId, counts]) => offlineClassCounts.set(classId, counts));
}

function updateOfflineClassCount(classId, field, count) {
  const current = offlineClassCounts.get(classId) || {
    sessionCount: null,
    memberCount: null
  };
  offlineClassCounts.set(classId, {
    ...current,
    [field]: count
  });
}

function formatOfflineClassCount(value) {
  return Number.isInteger(value) && value >= 0 ? String(value) : "-";
}

function getFilteredClasses() {
  const keyword = appliedOfflineClassKeyword;
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
      if (getInstructorSelectValues(row).length) return false;
    } else if (instructor) {
      const keys = getInstructorMatchKeys(instructor);
      const rowInstructorKeys = [
        row.instructorUid,
        row.instructorId,
        ...(Array.isArray(row.instructorUids) ? row.instructorUids : []),
        ...(Array.isArray(row.instructorIds) ? row.instructorIds : [])
      ].map((value) => String(value || "").trim()).filter(Boolean);
      if (!rowInstructorKeys.some((value) => keys.has(value))) return false;
    }
    if (keyword) {
      const hay = [
        row.className,
        row.subject,
        row.school,
        ...(Array.isArray(row.schools) ? row.schools : []),
        row.grade,
        formatOfflineGrade(row.grade),
        row.instructorName,
        ...(Array.isArray(row.instructorNames) ? row.instructorNames : []),
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

async function renderTable({ loadCounts = true } = {}) {
  setOfflineClassExportReady();
  const tbody = $("#tblOfflineClasses tbody");
  const meta = $("#offlineClassesMeta");
  if (!tbody) return;
  const renderToken = ++offlineClassesRenderToken;

  const rows = getFilteredClasses();
  const pageState = getListPageState(
    rows.length,
    offlineClassesCurrentPage,
    offlineClassesPageSize
  );
  offlineClassesCurrentPage = pageState.currentPage;
  const pageRows = rows.slice(pageState.startIndex, pageState.endIndex);
  if (meta) {
    meta.textContent = "";
    meta.hidden = true;
  }

  renderListPagination($("#offlineClassesPagination"), {
    currentPage: offlineClassesCurrentPage,
    itemLabel: "개",
    onPageChange: (nextPage) => {
      offlineClassesCurrentPage = nextPage;
      renderTable();
    },
    pageSize: offlineClassesPageSize,
    totalItems: rows.length,
  });

  if (!rows.length) {
    const emptyMessage = allClasses.length
      ? "조건에 맞는 오프라인 반이 없습니다."
      : "등록된 오프라인 반이 없습니다. 「반 추가」로 생성하세요.";
    if (meta) {
      meta.textContent = emptyMessage;
      meta.hidden = false;
    }
    tbody.innerHTML =
      `<tr><td colspan="8" class="muted admin-table-empty">${emptyMessage}</td></tr>`;
    return;
  }

  if (loadCounts) await loadOfflineClassCounts(pageRows);
  if (renderToken !== offlineClassesRenderToken) return;

  tbody.innerHTML = pageRows
    .map((row) => {
      const isArchived = row.status === "archived";
      const toggleLabel = isArchived ? "다시 활성화" : "보관";
      const toggleAction = isArchived ? "reactivate" : "archive";
      const counts = offlineClassCounts.get(row.id);
      const subjectValue = String(row.subject || "-").trim();
      const subjectColorStyle = getSubjectColorStyle(subjectValue, subjectColorMap);
      return `
      <tr data-id="${escapeHtml(row.id)}">
        <td><strong>${escapeHtml(row.className || "-")}</strong></td>
        <td><span class="admin-subject-badge${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>${escapeHtml(subjectValue)}</span></td>
        <td>${escapeHtml(formatSchoolGrade(row))}</td>
        <td>${escapeHtml(instructorDisplayName(row))}</td>
        <td class="offline-class-count">${formatOfflineClassCount(counts?.sessionCount)}</td>
        <td class="offline-class-count">${formatOfflineClassCount(counts?.memberCount)}</td>
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

function getSelectedInstructorFields() {
  const selectedInputs = Array.from(
    $("#classInstructorUid")?.querySelectorAll('input[type="checkbox"]:checked') || []
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

function readFormPayload() {
  const className = ($("#className")?.value || "").trim();
  const subject = resolveSubjectFromControls(
    $("#classSubject"),
    $("#classSubjectCustom"),
    catalogSubjects
  );
  if (!className) throw new Error("반명을 입력해주세요.");
  if (!subject) throw new Error("과목을 선택하거나 직접 입력해주세요.");
  validateScheduleTimeControls("#scheduleItemsList", "수업 일정");
  validateScheduleTimeControls("#clinicScheduleItemsList", "클리닉 일정");

  const editId = ($("#offlineClassEditId")?.value || "").trim();
  const existingClass = editId ? allClasses.find((c) => c.id === editId) : {};
  const instructorFields = getSelectedInstructorFields();
  const schoolFields = getSchoolSavePayload(resolveSchoolsFromControls());
  const scheduleItems = readScheduleItemsFromForm();
  const clinicScheduleItems = readScheduleItemsFromForm("#clinicScheduleItemsList");
  const legacySchedule = deriveLegacyScheduleFields(scheduleItems);

  return {
    className,
    subject,
    grade: resolveGradeFromControls($("#classGrade"), $("#classGradeCustom"), catalogGrades),
    ...schoolFields,
    groupId:
      ($("#offlineClassGroupId")?.value || "").trim() ||
      (editId ? resolveGroupId(existingClass) : selectedScheduleGroupId) ||
      REGULAR_SCHEDULE_GROUP_ID,
    ...instructorFields,
    scheduleItems,
    clinicScheduleItems,
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
  const instructorFields = getSelectedInstructorFields();
  const schoolFields = getSchoolSavePayload(resolveSchoolsFromControls());
  const scheduleItems = readScheduleItemsFromForm();
  const clinicScheduleItems = readScheduleItemsFromForm("#clinicScheduleItemsList");
  return {
    className: ($("#className")?.value || "").trim() || "반명 없음",
    subject: resolveSubjectFromControls($("#classSubject"), $("#classSubjectCustom"), catalogSubjects) || "-",
    ...schoolFields,
    grade: resolveGradeFromControls($("#classGrade"), $("#classGradeCustom"), catalogGrades),
    instructorName: instructorFields.instructorNames.join(", ") || "미배정",
    scheduleItems,
    clinicScheduleItems,
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
  const clinicScheduleLines = normalizeScheduleItems(data, "clinicScheduleItems")
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
    .map((item) => formatScheduleItemLine(item));
  const scheduleHtml = data.scheduleVisible === false
    ? '<li class="muted">학생/강사 화면에서는 일정 숨김</li>'
    : scheduleLines.length
      ? scheduleLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
      : '<li class="muted">일정 없음</li>';
  const clinicScheduleHtml = data.scheduleVisible === false
    ? '<li class="muted">학생/강사 화면에서는 일정 숨김</li>'
    : clinicScheduleLines.length
      ? clinicScheduleLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
      : '<li class="muted">일정 없음</li>';
  const desc = data.description
    ? `<p class="admin-offline-class-preview__desc">${escapeHtml(data.description.slice(0, 120))}${data.description.length > 120 ? "…" : ""}</p>`
    : '<p class="admin-offline-class-preview__desc muted">설명 없음</p>';
  const subjectColorStyle = getSubjectColorStyle(data.subject, subjectColorMap);
  preview.innerHTML = `
    <div class="admin-offline-class-preview__card">
      <p class="admin-offline-class-preview__label${subjectColorStyle ? " has-subject-color" : ""}"${subjectColorStyle ? ` style="${subjectColorStyle}"` : ""}>${escapeHtml(data.subject)}</p>
      <h4 class="admin-offline-class-preview__name">${escapeHtml(data.className)}</h4>
      <p class="admin-offline-class-preview__meta">${escapeHtml(formatSchoolGrade(data))}</p>
      <p class="admin-offline-class-preview__meta">담당: ${escapeHtml(data.instructorName)}</p>
      <p class="admin-offline-class-preview__meta"><strong>수업 일정:</strong></p>
      <ul class="admin-offline-class-preview__schedule">${scheduleHtml}</ul>
      <p class="admin-offline-class-preview__meta"><strong>클리닉:</strong></p>
      <ul class="admin-offline-class-preview__schedule">${clinicScheduleHtml}</ul>
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
}

function hideModal() {
  const modal = $("#offlineClassModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
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
  renderInstructorChoices($("#classInstructorUid"), []);
  renderScheduleItemsOnForm([]);
  setClinicScheduleItemsOnForm({});
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
    const instructorSelect = $("#classInstructorUid");
    if (instructorSelect) ensureInstructorSelectFallbacks(instructorSelect, row);
    setScheduleItemsOnForm(row);
    setClinicScheduleItemsOnForm(row);
    if ($("#classScheduleVisible")) $("#classScheduleVisible").checked = row.scheduleVisible !== false;
    $("#classDescription").value = row.description || "";
    $("#classStatus").value = row.status === "archived" ? "archived" : "active";
    const entryGroupId = resolveGroupId(row);
    loadCatalogForGroup(
      entryGroupId,
      { subject: row.subject || "", grade: row.grade || "", schools: getTimetableSchools(row) },
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
}

function closeModal() {
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
  const schools = resolveSchoolsFromControls();
  loadCatalogForGroup(groupId, { subject, grade, schools }, { syncTab: false });
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

async function setClassStatus(classId, status, triggerButton = null) {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    toast("로그인이 필요합니다.", true);
    return;
  }
  const row = allClasses.find((item) => item.id === classId);
  if (!row) {
    toast("상태를 변경할 반을 찾을 수 없습니다. (오류 코드: app/class-not-found)", true);
    return;
  }
  const previousLabel = triggerButton?.textContent || "";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "처리 중...";
  }
  try {
    await updateDoc(
      doc(db, "offlineClasses", classId),
      {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: uid
      }
    );
    row.status = status;
    renderTable();
    toast(status === "archived" ? "보관 처리되었습니다." : "운영 중으로 복원되었습니다.");
    await loadOfflineClasses();
  } catch (err) {
    console.error("[offline-classes] status update failed:", err);
    toast(formatOperationError("반 상태 변경 실패", err), true);
  } finally {
    if (triggerButton?.isConnected) {
      triggerButton.disabled = false;
      triggerButton.textContent = previousLabel;
    }
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
    updateOfflineClassCount(classId, "memberCount", classMembers.length);
    renderTable();
    renderMembersTable();
  } catch (err) {
    console.error("[offline-classes] members load failed:", err);
    showOperationError(
      "#offlineClassMembersAlert",
      "반 학생 목록을 불러오지 못했습니다",
      err
    );
    classMembers = [];
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="muted admin-table-empty">목록을 불러오지 못했습니다.</td></tr>';
    }
  }
}

function renderMembersTable() {
  const tbody = $("#tblOfflineClassMembers tbody");
  if (!tbody) return;

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
        <td>${escapeHtml(formatOfflineGrade(m.gradeSnapshot))}</td>
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

function getStudentPhoneLastFour(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function getStudentGradeLevel(grade) {
  const match = formatOfflineGrade(grade).match(/^[중고]([1-3])$/);
  return match?.[1] || "";
}

function matchesStudentSearchToken(student, token) {
  if (/^\d{4}$/.test(token)) {
    return getStudentPhoneLastFour(student.phone) === token;
  }
  const gradeLabel = formatOfflineGrade(student.grade).toLowerCase();
  const gradeLevel = getStudentGradeLevel(student.grade);
  if (/^[1-3]$/.test(token)) {
    return gradeLevel === token;
  }
  if (/^[중고][1-3]$/.test(token)) {
    return gradeLabel === token;
  }

  const textFields = [student.name, student.school]
    .map((value) => String(value || "").toLowerCase());
  const compactSchoolGrade = token.match(/^(.{2,})([1-3])$/);
  if (
    compactSchoolGrade &&
    gradeLevel === compactSchoolGrade[2] &&
    textFields.some((value) => value.includes(compactSchoolGrade[1]))
  ) {
    return true;
  }
  return [...textFields, gradeLabel].some((value) => value.includes(token));
}

function filterStudentsForSearch(keyword) {
  const tokens = keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  return allStudents
    .filter((student) =>
      tokens.every((token) => matchesStudentSearchToken(student, token))
    )
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

  const keyword = appliedOfflineStudentKeyword;
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
      const label = [s.name || "(이름 없음)", s.school, formatOfflineGrade(s.grade), s.phone]
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
}

function hideMembersModal() {
  const modal = $("#offlineClassMembersModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  membersClassId = "";
  selectedMemberStudentUids.clear();
  appliedOfflineStudentKeyword = "";
  classMembers = [];
  clearMembersAlert();
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
  clearMembersAlert();
  selectedMemberStudentUids.clear();
  appliedOfflineStudentKeyword = "";
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
    showOperationError(
      "#offlineClassMembersAlert",
      "학생 입반 실패",
      new Error("로그인 세션을 확인할 수 없습니다."),
      "unauthenticated"
    );
    return;
  }
  if (!membersClassId) {
    showOperationError(
      "#offlineClassMembersAlert",
      "학생 입반 실패",
      new Error("선택한 반 정보를 찾을 수 없습니다."),
      "app/class-not-found"
    );
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
    clearMembersAlert();
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
    appliedOfflineStudentKeyword = "";
    if ($("#offlineMemberStudentSearch")) $("#offlineMemberStudentSearch").value = "";
    await loadClassMembers(membersClassId);
    renderStudentSearchResults();
  } catch (err) {
    console.error("[offline-classes] add member failed:", err);
    showOperationError("#offlineClassMembersAlert", "입반 처리 실패", err);
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
  if (!t) return raw;
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
      <button type="button" class="btn sm danger session-video-remove-btn" data-action="remove-video" aria-label="영상 삭제">삭제</button>
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
    updateOfflineClassCount(classId, "sessionCount", classSessions.length);
    renderTable();
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
  if (!tbody) return;

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
        <td>${escapeHtml(formatSessionDateDisplay(row.sessionDate))}</td>
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
}

function hideSessionsModal() {
  const modal = $("#offlineClassSessionsModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
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

function closeSessionFormModal() {
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
      await addDoc(collection(db, "offlineClassSessions"), {
        ...payload,
        classId: sessionsClassId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid
      });
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
  const snap = await getDocs(
    query(collection(db, "offlineSessionAccess"), where("studentUid", "==", studentUid))
  );
  const refs = snap.docs
    .filter((row) => String(row.data()?.classId || "").trim() === classId)
    .map((row) => row.ref);
  await deleteDocsInBatches(refs);
  return refs.length;
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
  sessionAccessDocsByStudent = new Map();
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const studentUid = String(data.studentUid || "").trim();
    if (!studentUid) return;
    const row = { ...data, id: d.id, ref: d.ref };
    const rows = sessionAccessDocsByStudent.get(studentUid) || [];
    rows.push(row);
    sessionAccessDocsByStudent.set(studentUid, rows);
  });
  sessionAccessDocsByStudent.forEach((rows, studentUid) => {
    const sorted = rows.slice().sort((a, b) => {
      const manualDiff = Number(b.source === "manual") - Number(a.source === "manual");
      if (manualDiff) return manualDiff;
      const revokedDiff = Number(b.status === "revoked") - Number(a.status === "revoked");
      if (revokedDiff) return revokedDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
    sessionAccessByStudent.set(studentUid, sorted[0]);
  });
}

async function saveSessionAccessForStudent(studentUid, payload) {
  const existingRows = sessionAccessDocsByStudent.get(studentUid) || [];
  const canonicalId = sessionAccessDocId(accessSessionId, studentUid);
  const canonicalRef = doc(db, "offlineSessionAccess", canonicalId);
  const canonicalExists = existingRows.some((row) => row.id === canonicalId);
  const batch = writeBatch(db);
  batch.set(
    canonicalRef,
    canonicalExists ? payload : { ...payload, createdAt: serverTimestamp() },
    { merge: true }
  );
  existingRows.forEach((row) => {
    if (row.id === canonicalId) return;
    batch.delete(row.ref || doc(db, "offlineSessionAccess", row.id));
  });
  await batch.commit();
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
          ? `<button type="button" class="btn sm primary" data-access-action="grant" data-student-uid="${escapeHtml(studentUid)}">${state.key === "manualRevoke" ? "다시 허용" : "허용"}</button>`
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
        <td>${escapeHtml(formatOfflineGrade(member.gradeSnapshot))}</td>
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
  sessionAccessDocsByStudent = new Map();
  accessModalMembers = [];
  clearSessionAccessAlert();
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
  clearSessionAccessAlert();
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
    showOperationError(
      "#offlineSessionAccessAlert",
      "예외 권한 목록을 불러오지 못했습니다",
      err
    );
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="muted admin-table-empty">목록을 불러오지 못했습니다.</td></tr>';
    }
  }
}

async function grantSessionAccess(studentUid) {
  if (!auth.currentUser?.uid) {
    showOperationError(
      "#offlineSessionAccessAlert",
      "접근 허용 실패",
      new Error("로그인 세션을 확인할 수 없습니다."),
      "unauthenticated"
    );
    return;
  }
  if (!accessSessionId || !sessionsClassId || !studentUid) {
    showOperationError(
      "#offlineSessionAccessAlert",
      "접근 허용 실패",
      new Error("수업 또는 학생 정보를 찾을 수 없습니다."),
      "app/access-context-missing"
    );
    return;
  }

  try {
    clearSessionAccessAlert();
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
    await saveSessionAccessForStudent(studentUid, payload);
    toast("수동 허용이 저장되었습니다.");
    await loadSessionAccess(accessSessionId);
    renderSessionAccessTable();
  } catch (err) {
    console.error("[offline-classes] grant access failed:", err);
    showOperationError("#offlineSessionAccessAlert", "접근 허용 실패", err);
  }
}

async function revokeSessionAccess(studentUid) {
  if (!auth.currentUser?.uid) {
    showOperationError(
      "#offlineSessionAccessAlert",
      "접근 차단 실패",
      new Error("로그인 세션을 확인할 수 없습니다."),
      "unauthenticated"
    );
    return;
  }
  if (!accessSessionId || !sessionsClassId || !studentUid) {
    showOperationError(
      "#offlineSessionAccessAlert",
      "접근 차단 실패",
      new Error("수업 또는 학생 정보를 찾을 수 없습니다."),
      "app/access-context-missing"
    );
    return;
  }

  try {
    clearSessionAccessAlert();
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
    await saveSessionAccessForStudent(studentUid, payload);
    toast("수동 차단이 저장되었습니다.");
    await loadSessionAccess(accessSessionId);
    renderSessionAccessTable();
  } catch (err) {
    console.error("[offline-classes] revoke access failed:", err);
    showOperationError("#offlineSessionAccessAlert", "접근 차단 실패", err);
  }
}

async function removeMember(studentUid, triggerButton = null) {
  if (!auth.currentUser?.uid) {
    showOperationError(
      "#offlineClassMembersAlert",
      "학생 제거 실패",
      new Error("로그인 세션을 확인할 수 없습니다."),
      "unauthenticated"
    );
    return;
  }
  if (!membersClassId || !studentUid) {
    showOperationError(
      "#offlineClassMembersAlert",
      "학생 제거 실패",
      new Error("반 또는 학생 정보를 찾을 수 없습니다."),
      "app/member-context-missing"
    );
    return;
  }

  const member = classMembers.find((m) => m.studentUid === studentUid);
  if (!member) {
    showOperationError(
      "#offlineClassMembersAlert",
      "학생 제거 실패",
      new Error("배정된 학생 문서를 찾을 수 없습니다. 목록을 새로고침해 주세요."),
      "app/member-not-found"
    );
    return;
  }

  const previousLabel = triggerButton?.textContent || "";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "처리 중...";
  }
  try {
    clearMembersAlert();
    const memberId = String(member.id || "").trim();
    if (!memberId) {
      throw Object.assign(new Error("배정 문서 ID를 확인할 수 없습니다."), {
        code: "app/member-document-id-missing"
      });
    }
    const accessSnap = await getDocs(
      query(collection(db, "offlineSessionAccess"), where("studentUid", "==", studentUid))
    );
    const batch = writeBatch(db);
    batch.delete(doc(db, "offlineClassMembers", memberId));
    accessSnap.docs.forEach((row) => {
      if (String(row.data()?.classId || "").trim() === membersClassId) {
        batch.delete(row.ref);
      }
    });
    await batch.commit();
    toast("학생이 반에서 제거되었습니다.");
    await loadClassMembers(membersClassId);
    renderStudentSearchResults();
  } catch (err) {
    console.error("[offline-classes] remove member failed:", err);
    showOperationError("#offlineClassMembersAlert", "학생 제거 실패", err);
  } finally {
    if (triggerButton?.isConnected) {
      triggerButton.disabled = false;
      triggerButton.textContent = previousLabel;
    }
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
    const subjectEl = $("#classSubject");
    const subjectValue = resolveSubjectFromControls(subjectEl, $("#classSubjectCustom"), catalogSubjects);
    const subjectColorStyle = getSubjectColorStyle(subjectValue, subjectColorMap);
    subjectEl?.classList.toggle("has-subject-color", Boolean(subjectColorStyle));
    if (subjectEl && subjectColorStyle) subjectEl.setAttribute("style", subjectColorStyle);
    else subjectEl?.removeAttribute("style");
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

  $("#refreshBtn")?.addEventListener("click", refreshOfflineClassesPage);
  let offlineClassExportPending = false;
  $("#dlOfflineClasses")?.addEventListener("click", async () => {
    if (offlineClassExportPending) return;
    if (!offlineClassesLoaded) return toast("반 목록을 먼저 불러와 주세요.", true);
    const selected = getFilteredClasses();
    if (!selected.length) return toast(allClasses.length ? "선택 그룹과 필터에 맞는 반이 없습니다." : "등록된 반이 없습니다.", true);
    offlineClassExportPending = true;
    try {
      const proceed = await openAdminConfirm({
        title: "반 명단 다운로드",
        message: `선택한 반 ${selected.length}개의 학생 명단을 함께 불러와 엑셀로 저장합니다. 계속하시겠습니까?`,
        confirmLabel: "다운로드",
      });
      if (!proceed) return;
      const memberships = await fetchScopedExportRows(db, "offlineClassMembers", "classId", selected.map((row) => row.id));
      const active = memberships.filter((row) => String(row.status || "active") === "active");
      const students = await fetchExportDocuments(db, "students", memberships.map((row) => row.studentUid));
      const classes = new Map(selected.map((row) => [row.id, row]));
      const activeStudentsByClass = new Map();
      active.forEach((item) => {
        if (!item.classId || !item.studentUid) return;
        if (!activeStudentsByClass.has(item.classId)) activeStudentsByClass.set(item.classId, new Set());
        activeStudentsByClass.get(item.classId).add(item.studentUid);
      });
      const rows = selected.map((row) => {
        const studentUids = activeStudentsByClass.get(row.id) || new Set();
        const names = [...studentUids].map((uid) => String(students.get(uid)?.name || "").trim()).filter(Boolean);
        const nameLines = [];
        for (let index = 0; index < names.length; index += 8) nameLines.push(names.slice(index, index + 8).join(", "));
        return {
          반명: row.className || "",
          그룹: resolveScheduleGroupLabel(row.groupId || selectedScheduleGroupId, scheduleGroupsDraft),
          과목: row.subject || "",
          "학교/학년": formatSchoolGrade(row),
          "담당 강사": instructorDisplayName(row),
          강의실: row.room || "",
          "수업 일정": Array.isArray(row.scheduleItems) ? row.scheduleItems.map(formatScheduleItemLine).join("; ") : "",
          상태: row.status === "archived" ? "보관" : "운영 중",
          "활성 입반 학생": studentUids.size,
          "재원 학생명": nameLines.join("\n"),
        };
      });
      const rosterRows = memberships.map((item) => {
        const student = students.get(item.studentUid) || {
          name: item.studentNameSnapshot,
          school: item.schoolSnapshot,
          grade: item.gradeSnapshot,
          phone: item.phoneSnapshot,
        };
        return {
          반UID: item.classId || "", 반명: classes.get(item.classId)?.className || "",
          학생UID: item.studentUid || "", 학생명: student.name || "확인 불가",
          학교: student.school || "", 학년: formatGrade(student.grade),
          연락처: student.phone || "",
          학생정보출처: students.has(item.studentUid) ? "현재 프로필" : (item.studentNameSnapshot ? "배정 시 스냅샷" : "확인 불가"),
          배정상태: item.status || "active",
          입반일: formatTimestamp(item.joinedAt || item.createdAt),
        };
      });
      const group = resolveScheduleGroupLabel(selectedScheduleGroupId, scheduleGroupsDraft);
      const filtered = !!(appliedOfflineClassKeyword || ["filterSubject", "filterGrade", "filterInstructor", "filterStatus"].some((id) => $(`#${id}`)?.value));
      const done = await writeAdminXlsx(XLSX, {
        sheets: [
          { name: "오프라인 반", rows },
          { name: "입반 학생", rows: rosterRows },
        ], button: $("#dlOfflineClasses"),
        filename: adminXlsxFilename("반목록", rows.length, `${group}_${filtered ? "필터결과" : "전체"}`),
      });
      if (done) toast(`${group} 반 ${rows.length}개 엑셀 파일을 다운로드했습니다.`);
    } catch (error) {
      console.error("[offline-classes] export failed", error);
      toast(`엑셀 다운로드에 실패했습니다. ${error.message || "다시 시도해 주세요."}`, true);
    } finally {
      offlineClassExportPending = false;
    }
  });
  $("#offlineClassModalClose")?.addEventListener("click", closeModal);
  $("#offlineClassFormCancel")?.addEventListener("click", closeModal);
  $("#offlineClassForm")?.addEventListener("submit", saveClassFromForm);

  bindCommittedSearch($("#filterSearch"), $("#offlineClassSearchButton"), (keyword) => {
    appliedOfflineClassKeyword = keyword;
    offlineClassesCurrentPage = 1;
    renderTable({ loadCounts: false });
  });
  ["filterSubject", "filterGrade", "filterInstructor", "filterStatus"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", () => {
      offlineClassesCurrentPage = 1;
      renderTable({ loadCounts: false });
    });
  });
  $("#offlineClassesPageSize")?.addEventListener("change", (event) => {
    offlineClassesPageSize = normalizeListPageSize(event.target.value);
    offlineClassesCurrentPage = 1;
    renderTable();
  });

  $("#tblOfflineClasses")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "sessions") openSessionsModal(id);
    else if (action === "members") openMembersModal(id);
    else if (action === "edit") openModal("edit", id);
    else if (action === "archive") setClassStatus(id, "archived", btn);
    else if (action === "reactivate") setClassStatus(id, "active", btn);
    else if (action === "delete-permanent") permanentDeleteClass(id);
  });

  $("#offlineClassMembersModalClose")?.addEventListener("click", closeMembersModal);
  bindCommittedSearch(
    $("#offlineMemberStudentSearch"),
    $("#offlineMemberStudentSearchButton"),
    (keyword) => {
      appliedOfflineStudentKeyword = keyword;
      selectedMemberStudentUids.clear();
      renderStudentSearchResults();
    }
  );
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
    if (btn.dataset.memberAction === "remove") removeMember(studentUid, btn);
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
  const bindScheduleEditor = ({
    listSelector,
    addButtonSelector,
    emptyLabel,
    timeInputMode = "segmented"
  }) => {
    $(addButtonSelector)?.addEventListener("click", () =>
      addScheduleItemRow({ listSelector, emptyLabel, timeInputMode })
    );
    $(listSelector)?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='remove-schedule-item']");
      if (!btn) return;
      const row = btn.closest(".schedule-item-row");
      if (!row) return;
      const current = readScheduleItemsFromForm(listSelector);
      const index = Number.parseInt(row.dataset.index || "-1", 10);
      if (index >= 0 && index < current.length) current.splice(index, 1);
      renderScheduleItemsOnForm(current, { listSelector, emptyLabel, timeInputMode });
      updateClassPreview();
    });
  };
  bindScheduleEditor({
    listSelector: "#scheduleItemsList",
    addButtonSelector: "#scheduleItemAddBtn",
    emptyLabel: "수업 일정"
  });
  bindScheduleEditor({
    listSelector: "#clinicScheduleItemsList",
    addButtonSelector: "#clinicScheduleItemAddBtn",
    emptyLabel: "클리닉 일정",
    timeInputMode: "segmented"
  });
  $("#offlineSessionAccessModalClose")?.addEventListener("click", closeSessionAccessModal);
  $("#tblSessionAccess")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-access-action]");
    if (!btn || btn.disabled) return;
    const studentUid = btn.dataset.studentUid || "";
    const action = btn.dataset.accessAction;
    const previousLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "처리 중...";
    const operation = action === "grant"
      ? grantSessionAccess(studentUid)
      : action === "revoke"
        ? revokeSessionAccess(studentUid)
        : Promise.resolve();
    Promise.resolve(operation).finally(() => {
      if (!btn.isConnected) return;
      btn.disabled = false;
      btn.textContent = previousLabel;
    });
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
