// 시간표 관리자: 그룹과 그룹별 이미지 전용
import { auth, db, requireRole } from "/assets/js/firebase-init.js";
import {
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { escapeHtml } from "/assets/js/utils/html.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";
import { setAdminRefreshButtonState } from "/assets/js/utils/admin-refresh.js";
import { confirmDiscardIfDirty, createFormDirtyTracker, openAdminConfirm } from "/assets/js/utils/admin-dialog.js";
import { initCatalogDrawer, setCatalogPanelSaving } from "/assets/js/utils/admin-catalog-drawer.js";
import {
  describeDraftSummary,
  diffOrderedList,
  renderDraftSummary,
  summarizeDraftSections,
} from "/assets/js/utils/admin-draft-summary.js";
import {
  announceOrderChange,
  applyOrderMoveFeedback,
  clearOrderStatus,
  describeOrderMove,
  flashMovedRow,
  focusAfterRowRemoved,
  isListDirty,
  restoreMoveFocus,
} from "/assets/js/utils/admin-order-feedback.js";
import { getAdminSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
import {
  applyLegacyTimetableCatalogFieldRemovals,
  cloneScheduleImagesDraft,
  getExactGroupScheduleImages,
  getScheduleDivisions,
  MAX_SCHEDULE_DIVISIONS,
  getScheduleGroups,
  REGULAR_SCHEDULE_GROUP_ID,
  resolveGroupId,
  resolveScheduleGroupLabel,
  serializeScheduleGroupsPayload,
  serializeScheduleDivisions,
  serializeScheduleImagesPayload,
  validateScheduleGroups,
  validateScheduleImageUrl,
} from "/assets/js/utils/timetable-catalog.js";
import {
  addScheduleGroupToDraft,
  moveScheduleGroupInDraft,
  populateScheduleGroupSelect,
  readScheduleGroupsFromEditor,
  removeScheduleGroupFromDraft,
  renderAdminScheduleGroupTabs,
  renderScheduleGroupsEditor,
} from "/assets/js/utils/schedule-groups-admin.js";

const $ = (selector, root = document) => root.querySelector(selector);

let storedCatalog = {};
let scheduleGroupsDraft = [];
let selectedGroupId = REGULAR_SCHEDULE_GROUP_ID;
let imageGroupId = REGULAR_SCHEDULE_GROUP_ID;
let scheduleImagesDraft = [];
let scheduleDivisionsDraft = [];
let catalogLoaded = false;
let imageSaving = false;
let groupsSaving = false;
let imageEditTrigger = null;
let imageEditTracker = null;
let imageFilter = "all";

const GROUPS_SAVE_HINT = "‘기준값 저장’을 눌러야 반영됩니다.";

// 저장된 값(storedCatalog)과 화면의 초안을 순서까지 포함해 비교한다. DB 조회 없이 페이지 메모리와 이미 그려진 입력값만 읽는다.
const groupSignature = (group) => [group.id, group.label, group.active !== false];
const divisionSignature = (division) => [division.key, division.label, division.active !== false];

function isCatalogDraftDirty() {
  const groups = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
  return isListDirty(groups, getScheduleGroups(storedCatalog), groupSignature)
    || isListDirty(readDivisionLabels(), getScheduleDivisions(storedCatalog), divisionSignature);
}

const stateLabel = (item) => (item.active !== false ? "노출" : "숨김");

function buildGroupsSummary() {
  return summarizeDraftSections([
    {
      title: "시간표 그룹",
      diff: diffOrderedList({
        saved: getScheduleGroups(storedCatalog),
        current: readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft),
        keyOf: (group) => group.id,
        labelOf: (group) => group.label,
        stateOf: stateLabel,
      }),
    },
    {
      title: "학교급",
      diff: diffOrderedList({
        saved: getScheduleDivisions(storedCatalog),
        current: readDivisionLabels(),
        keyOf: (division) => division.key,
        labelOf: (division) => division.label,
        stateOf: stateLabel,
      }),
    },
  ]);
}

function updateGroupsDraftBadge() {
  renderDraftSummary({
    host: $("#scheduleGroupsDraftSummary"),
    badges: [{ el: $("#scheduleGroupsTriggerBadge"), text: "저장 전" }],
    resetButton: $("#scheduleGroupsResetBtn"),
    summary: buildGroupsSummary(),
  });
}

function confirmDraftReset(summary, extra = "") {
  return openAdminConfirm({
    title: "변경 취소",
    message: `${describeDraftSummary(summary)}을 취소하고 저장된 값으로 되돌립니다.${extra} 이미 저장된 데이터는 바뀌지 않습니다.`,
    cancelLabel: "계속 편집",
    confirmLabel: "변경 취소",
    danger: true,
  });
}

function findRow(host, selector, attribute, value) {
  return Array.from(host?.querySelectorAll(selector) || []).find((row) => row.getAttribute(attribute) === value) || null;
}

function reportOrderMove({ row, label, index, total, direction, selectors, statusEl, saveHint = "", persisted = false }) {
  const other = direction === "up" ? "down" : "up";
  applyOrderMoveFeedback({
    row,
    message: describeOrderMove({ label, index, total, saveHint, persisted }),
    statusEl,
    focusSelectors: [selectors(direction), selectors(other)],
  });
}

function toast(message, isError = false) {
  showAdminToast(message, isError);
}

/**
 * 저장이 진행 중이면 true. 저장이 끝나면 목록이 서버 값으로 교체되므로, 그 사이의 변경·그룹 전환·새로고침을
 * 받으면 변경이 사라지거나 다른 그룹 이미지로 바뀐다. 끝날 때까지 받지 않는다.
 */
function isCatalogBusy() {
  if (!imageSaving && !groupsSaving) return false;
  toast("저장하는 중입니다. 저장이 끝난 뒤 다시 시도해주세요.", true);
  return true;
}

/** 불러오지 못한 빈 값으로 저장본을 덮어쓰지 않는다. */
function isCatalogUnavailable() {
  if (catalogLoaded) return false;
  toast("시간표 설정을 불러오지 못해 저장할 수 없습니다. ‘새로고침’으로 다시 불러와주세요.", true);
  return true;
}

function setImageAlert(message = "", isError = false) {
  const alert = $("#scheduleImageModalAlert");
  if (!alert) return;
  alert.textContent = message;
  alert.hidden = !message;
  alert.classList.toggle("is-error", isError);
}

function renderGroups() {
  renderScheduleGroupsEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
  renderAdminScheduleGroupTabs($("#adminScheduleGroupTabs"), scheduleGroupsDraft, selectedGroupId);
  populateScheduleGroupSelect($("#scheduleImageGroupId"), scheduleGroupsDraft, imageGroupId);
  renderDivisionsEditor();
  renderDivisionOptions();
  updateGroupsDraftBadge();
}

function renderDivisionsEditor() {
  const host = $("#scheduleDivisionsEditor");
  if (!host) return;
  const counts = {};
  const catalogs = Object.values(storedCatalog.groupCatalogs || {});
  (catalogs.length ? catalogs : [storedCatalog]).forEach((catalog) => {
    (catalog?.scheduleImages || []).forEach((image) => { counts[image.division || "high"] = (counts[image.division || "high"] || 0) + 1; });
  });
  host.innerHTML = `
    <div class="admin-schedule-groups-editor__list">
      ${scheduleDivisionsDraft.map((item, index) => `
        <div class="admin-schedule-group-row admin-catalog-row admin-catalog-row--wrap" data-division-key="${escapeHtml(item.key)}">
          <span class="admin-catalog-row__index" aria-hidden="true">${index + 1}</span>
          <input type="text" class="admin-catalog-field__input admin-schedule-group-row__name admin-catalog-row__input" data-division-field="label" value="${escapeHtml(item.label)}" maxlength="20" aria-label="${escapeHtml(item.label)} 학교급 이름">
          <div class="admin-schedule-group-row__visibility" role="group" aria-label="${escapeHtml(item.label)} 노출 여부">
            <button type="button" class="admin-schedule-group-visibility-btn${item.active !== false ? " on" : ""}" data-division-active="true" aria-pressed="${item.active !== false ? "true" : "false"}">노출</button>
            <button type="button" class="admin-schedule-group-visibility-btn${item.active === false ? " on" : ""}" data-division-active="false" aria-pressed="${item.active === false ? "true" : "false"}">숨김</button>
          </div>
          <div class="admin-schedule-group-row__order admin-catalog-row__moves">
            <button type="button" class="admin-catalog-tag__move" data-division-action="up"${index === 0 ? " disabled" : ""} aria-label="${escapeHtml(item.label)} 위로" title="위로">↑</button>
            <button type="button" class="admin-catalog-tag__move" data-division-action="down"${index === scheduleDivisionsDraft.length - 1 ? " disabled" : ""} aria-label="${escapeHtml(item.label)} 아래로" title="아래로">↓</button>
          </div>
          <div class="admin-schedule-group-row__meta">
            ${counts[item.key] ? `<span class="muted admin-schedule-group-row__count">이미지 ${counts[item.key]}개</span>` : ""}
            <button type="button" class="admin-catalog-tag__remove admin-catalog-row__remove" data-division-action="delete"${counts[item.key] ? " disabled" : ""} aria-label="${counts[item.key] ? `${escapeHtml(item.label)}: 이미지가 연결되어 제거할 수 없음` : `${escapeHtml(item.label)} 목록에서 제거`}" title="${counts[item.key] ? "이미지가 연결되어 제거할 수 없습니다" : "목록에서 제거"}">&times;</button>
          </div>
        </div>`).join("")}
    </div>
    <div class="admin-schedule-groups-editor__actions admin-catalog-field__row">
      <input type="text" class="admin-catalog-field__input" data-division-add-input placeholder="새 학교급 이름" maxlength="20" autocomplete="off"${scheduleDivisionsDraft.length >= MAX_SCHEDULE_DIVISIONS ? " disabled" : ""}>
      <button type="button" class="btn sm" data-division-action="add"${scheduleDivisionsDraft.length >= MAX_SCHEDULE_DIVISIONS ? " disabled" : ""}>추가</button>
    </div>`;
}

function renderDivisionOptions() {
  const options = getScheduleDivisions(storedCatalog).map((item) =>
    `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`
  ).join("");
  const addSelect = $("#scheduleImageDivisionInput");
  const selected = addSelect?.value || "high";
  if (addSelect) {
    addSelect.innerHTML = options;
    addSelect.value = selected;
  }
}

function readDivisionLabels() {
  const host = $("#scheduleDivisionsEditor");
  return serializeScheduleDivisions(scheduleDivisionsDraft.map((item) => {
    const row = host?.querySelector(`[data-division-key="${item.key}"]`);
    return {
      ...item,
      label: row?.querySelector('[data-division-field="label"]')?.value || item.label,
      active: row?.querySelector('[data-division-active].on')?.dataset.divisionActive !== "false",
    };
  }));
}

async function loadCatalog() {
  const { exists, data } = await getAdminSettingDoc("timetableCatalog");
  storedCatalog = exists && data ? { ...data } : {};
  catalogLoaded = true;
  scheduleGroupsDraft = getScheduleGroups(storedCatalog);
  scheduleDivisionsDraft = getScheduleDivisions(storedCatalog);
  if (!scheduleGroupsDraft.some((group) => group.id === selectedGroupId)) {
    selectedGroupId = scheduleGroupsDraft[0]?.id || REGULAR_SCHEDULE_GROUP_ID;
  }
  imageGroupId = selectedGroupId;
  renderGroups();
}

async function saveGroups() {
  const button = $("#scheduleGroupsSaveBtn");
  if (button?.disabled || isCatalogUnavailable() || isCatalogBusy()) return;
  const groups = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
  const emptyDivisionLabel = Array.from($("#scheduleDivisionsEditor")?.querySelectorAll('[data-division-field="label"]') || [])
    .some((input) => !String(input.value || "").trim());
  if (emptyDivisionLabel) {
    toast("학교급 이름을 모두 입력해주세요.", true);
    return;
  }
  const divisions = readDivisionLabels();
  if (!divisions.some((item) => item.active !== false)) {
    toast("학교급 기준값은 1개 이상 노출해야 합니다.", true);
    return;
  }
  const validated = validateScheduleGroups(groups);
  if (!validated.ok) {
    toast(validated.message, true);
    return;
  }

  const activeIds = new Set(validated.groups.map((group) => group.id));
  const existingCatalogs = storedCatalog.groupCatalogs && typeof storedCatalog.groupCatalogs === "object"
    ? storedCatalog.groupCatalogs
    : {};
  const groupCatalogs = Object.fromEntries(
    Object.entries(existingCatalogs).filter(([groupId]) => activeIds.has(groupId))
  );
  // merge 저장은 빠진 키를 지우지 않는다. 이 화면에서 삭제한 그룹의 이미지만 명시적으로 지운다(목록에 없던 값은 건드리지 않는다).
  const removedCatalogFields = Object.fromEntries(
    getScheduleGroups(storedCatalog)
      .filter((group) => !activeIds.has(group.id) && Object.prototype.hasOwnProperty.call(existingCatalogs, group.id))
      .map((group) => [group.id, deleteField()])
  );

  button.disabled = true;
  groupsSaving = true;
  setCatalogPanelSaving($("#scheduleGroupsPanel"), true);
  try {
    const payload = applyLegacyTimetableCatalogFieldRemovals({
      ...serializeScheduleGroupsPayload(validated.groups),
      scheduleDivisions: divisions,
      // 유지하는 그룹의 이미지는 다시 쓰지 않는다. 빈 map도 보내지 않는다.
      ...(Object.keys(removedCatalogFields).length ? { groupCatalogs: removedCatalogFields } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || "",
    }, deleteField);
    await setDoc(doc(db, "settings", "timetableCatalog"), payload, { merge: true });
    invalidateSetting("timetableCatalog");
    storedCatalog = { ...storedCatalog, scheduleGroups: validated.groups, scheduleDivisions: divisions, groupCatalogs };
    scheduleGroupsDraft = validated.groups;
    scheduleDivisionsDraft = divisions;
    if (!scheduleGroupsDraft.some((group) => group.id === selectedGroupId)) {
      selectedGroupId = scheduleGroupsDraft[0]?.id || REGULAR_SCHEDULE_GROUP_ID;
    }
    const imageGroupChanged = imageGroupId !== selectedGroupId;
    imageGroupId = selectedGroupId;
    renderGroups();
    // 보던 그룹이 삭제되어 다른 그룹으로 옮겨 가면 삭제된 그룹의 이미지가 새 그룹에 저장되지 않도록 새 그룹 값으로 바꾼다.
    if (imageGroupChanged) loadImagesForGroup(imageGroupId);
    else renderImages();
    clearOrderStatus($("#scheduleGroupsOrderStatus"));
    toast("시간표 그룹이 저장되었습니다.");
  } catch (error) {
    console.error("[admin-timetable] group save failed:", error);
    toast("시간표 그룹 저장에 실패했습니다.", true);
  } finally {
    groupsSaving = false;
    button.disabled = false;
    setCatalogPanelSaving($("#scheduleGroupsPanel"), false, button);
  }
}

function addImage(rawName, rawUrl, rawDivision) {
  const name = String(rawName || "").trim();
  const checked = validateScheduleImageUrl(rawUrl);
  if (!name) return { ok: false, message: "이미지 이름을 입력해주세요." };
  if (!checked.ok) return checked;
  if (scheduleImagesDraft.some((item) => item.url === checked.url)) {
    return { ok: false, message: "이미 등록된 URL입니다." };
  }
  const division = rawDivision || getScheduleDivisions(storedCatalog)[0]?.key || "high";
  return { ok: true, list: [...scheduleImagesDraft, { name, url: checked.url, division }] };
}

function getVisibleImages() {
  return imageFilter === "all"
    ? scheduleImagesDraft
    : scheduleImagesDraft.filter((item) => item.division === imageFilter);
}

/**
 * 보이는 목록에서 바로 옆 항목과 자리를 바꾼다. 공개 시간표의 필터도 저장 순서를 그대로 쓰므로,
 * 학교급 필터 안에서의 이동이 공개 화면에 같은 순서로 나타나고 다른 학교급의 상대 순서는 바뀌지 않는다.
 */
function buildImageMove(url, direction) {
  const visible = getVisibleImages();
  const index = visible.findIndex((item) => item.url === url);
  const nextIndex = index + (direction === "up" ? -1 : 1);
  if (index < 0 || nextIndex < 0 || nextIndex >= visible.length) return null;
  const list = scheduleImagesDraft.slice();
  const from = list.indexOf(visible[index]);
  const to = list.indexOf(visible[nextIndex]);
  [list[from], list[to]] = [list[to], list[from]];
  return { list, label: visible[index].name, index: nextIndex, total: visible.length };
}

function findImageItem(url) {
  return findRow($("#scheduleImageList"), ".admin-schedule-image-item", "data-image-url", url);
}

function editImage(url) {
  const item = scheduleImagesDraft.find((entry) => entry.url === url);
  if (!item) return;
  imageEditTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $("#scheduleImageEditOriginalUrl").value = item.url;
  $("#scheduleImageEditName").value = item.name;
  $("#scheduleImageEditUrl").value = item.url;
  const modal = $("#scheduleImageEditModal");
  modal.hidden = false;
  modal.classList.add("is-open");
  document.body.classList.add("modal-open");
  imageEditTracker = createFormDirtyTracker($("#scheduleImageEditForm"));
  imageEditTracker.capture();
  $("#scheduleImageEditName").focus();
}

function closeImageEditModal({ focusUrl = "" } = {}) {
  const modal = $("#scheduleImageEditModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  // 목록이 다시 그려지면 처음 누른 버튼이 사라질 수 있으므로 같은 이미지의 '수정' 버튼으로 돌아간다.
  const target = findImageItem(focusUrl)?.querySelector("[data-image-edit]")
    || (imageEditTrigger?.isConnected ? imageEditTrigger : null)
    || $("#scheduleImageAddBtn");
  imageEditTrigger = null;
  imageEditTracker = null;
  target?.focus?.();
}

/** X·취소·바깥 클릭·Escape 공통 진입점. 저장 중에는 닫지 않고, 입력을 바꿨다면 버릴지 확인한다. */
async function requestCloseImageEditModal() {
  if (imageSaving) return;
  if (!(await confirmDiscardIfDirty(imageEditTracker))) return;
  closeImageEditModal({ focusUrl: $("#scheduleImageEditOriginalUrl")?.value || "" });
}

function onImageEditKeydown(event) {
  const modal = $("#scheduleImageEditModal");
  if (!modal || modal.hidden || document.querySelector(".admin-confirm-modal")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    requestCloseImageEditModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(modal.querySelectorAll("input:not([type='hidden']), button, select, textarea, a[href]"))
    .filter((control) => !control.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const outside = !modal.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

async function submitImageEdit() {
  if (imageSaving) return;
  const url = $("#scheduleImageEditOriginalUrl")?.value || "";
  const name = $("#scheduleImageEditName")?.value || "";
  const nextUrl = $("#scheduleImageEditUrl")?.value || "";
  const checked = validateScheduleImageUrl(nextUrl);
  if (!String(name).trim() || !checked.ok) {
    toast(checked.message || "이미지 이름과 URL을 확인해주세요.", true);
    return;
  }
  if (checked.url !== url && scheduleImagesDraft.some((entry) => entry.url === checked.url)) {
    toast("이미 등록된 URL입니다.", true);
    return;
  }
  const candidate = scheduleImagesDraft.map((entry) =>
    entry.url === url ? { ...entry, name: String(name).trim(), url: checked.url } : entry
  );
  // 목록은 저장이 성공한 뒤에만 바뀐다. 실패하면 수정창을 열어 둔 채 다시 시도할 수 있다.
  if (!(await saveImages(candidate))) {
    toast("이미지 수정을 저장하지 못했습니다. 입력한 내용은 수정창에 그대로 있으니 다시 시도해주세요.", true);
    return;
  }
  closeImageEditModal({ focusUrl: checked.url });
}

/** 공개 시간표와 같은 필터(전체 + 노출 학교급). 숨긴 학교급은 이미지가 있을 때만 관리용으로 함께 보여준다. */
function getImageFilters() {
  const countOf = (key) => scheduleImagesDraft.filter((item) => item.division === key).length;
  const filters = [{ key: "all", label: "전체", count: scheduleImagesDraft.length }];
  getScheduleDivisions(storedCatalog).forEach((division) => {
    const count = countOf(division.key);
    if (division.active !== false) filters.push({ key: division.key, label: division.label, count });
    else if (count) filters.push({ key: division.key, label: `${division.label} (숨김)`, count });
  });
  return filters;
}

function renderImageFilter() {
  const host = $("#scheduleImageDivisionFilter");
  const filters = getImageFilters();
  if (!filters.some((filter) => filter.key === imageFilter)) imageFilter = "all";
  if (!host) return;
  host.innerHTML = filters.map((filter) => `
    <button type="button" class="admin-schedule-image-filter__button${filter.key === imageFilter ? " on" : ""}" data-image-filter="${escapeHtml(filter.key)}" aria-pressed="${filter.key === imageFilter ? "true" : "false"}">${escapeHtml(filter.label)} <span class="admin-schedule-image-filter__count">${filter.count}</span></button>`).join("");
}

function renderImages() {
  const host = $("#scheduleImageList");
  if (!host) return;
  renderImageFilter();
  const visible = getVisibleImages();
  if (!visible.length) {
    host.innerHTML = `<p class="muted admin-schedule-image-list__empty">${imageFilter === "all" ? "등록된 시간표 이미지가 없습니다." : "이 학교급에 등록된 이미지가 없습니다."}</p>`;
    return;
  }
  const publicKeys = new Set(getScheduleDivisions(storedCatalog).filter((division) => division.active !== false).map((division) => division.key));
  host.innerHTML = visible.map((item, index) => `
    <article class="admin-schedule-image-item" data-image-url="${escapeHtml(item.url)}">
      <div class="admin-schedule-image-item__thumb-wrap">
        <img src="${escapeHtml(item.url)}" alt="" class="admin-schedule-image-item__thumb" loading="lazy">
      </div>
      <div class="admin-schedule-image-item__body">
        <strong class="admin-schedule-image-item__name"><span class="admin-schedule-image-item__order">${index + 1}</span> ${escapeHtml(item.name)}</strong>
        ${publicKeys.has(item.division) ? "" : '<span class="admin-schedule-image-item__hidden-note">공개 안 됨 (학교급 숨김)</span>'}
        <label class="admin-schedule-image-item__division-label">
          <span>구분</span>
          <select class="admin-catalog-field__input admin-schedule-image-item__division" data-image-division aria-label="${escapeHtml(item.name)} 구분(바로 저장)">
            ${getScheduleDivisions(storedCatalog).map((division) => `<option value="${escapeHtml(division.key)}"${item.division === division.key ? " selected" : ""}>${escapeHtml(division.label)}</option>`).join("")}
          </select>
        </label>
        <p class="muted admin-schedule-image-item__url">${escapeHtml(item.url)}</p>
      </div>
      <div class="admin-schedule-image-item__actions">
        <button type="button" class="btn sm admin-schedule-group-order-btn" data-image-move="up"${index === 0 ? " disabled" : ""} aria-label="${escapeHtml(item.name)} 위로(바로 저장)" title="위로">↑</button>
        <button type="button" class="btn sm admin-schedule-group-order-btn" data-image-move="down"${index === visible.length - 1 ? " disabled" : ""} aria-label="${escapeHtml(item.name)} 아래로(바로 저장)" title="아래로">↓</button>
        <button type="button" class="btn sm" data-image-edit aria-label="${escapeHtml(item.name)} 이름·URL 수정(바로 저장)">수정</button>
        <button type="button" class="btn sm danger" data-image-remove aria-label="${escapeHtml(item.name)} 제거(바로 저장)">제거</button>
      </div>
    </article>`).join("");
}

function loadImagesForGroup(groupId) {
  const nextGroupId = resolveGroupId({ groupId });
  if (nextGroupId !== imageGroupId) imageFilter = "all";
  imageGroupId = nextGroupId;
  scheduleImagesDraft = cloneScheduleImagesDraft(getExactGroupScheduleImages(storedCatalog, imageGroupId));
  populateScheduleGroupSelect($("#scheduleImageGroupId"), scheduleGroupsDraft, imageGroupId);
  const label = resolveScheduleGroupLabel(imageGroupId, scheduleGroupsDraft);
  $("#scheduleImageGroupLabel").textContent = label;
  $("#scheduleImageStorageHint").textContent = `${label} 그룹의 시간표 이미지를 편집하고 있습니다.`;
  setImageAlert();
  clearOrderStatus($("#scheduleImagesOrderStatus"));
  renderImages();
}

/** list 를 바로 저장한다. 성공하면 서버 확인값으로 목록을 교체하고 true, 아니면 false 이며 목록은 바뀌지 않는다. */
async function saveImages(list, { successMessage = "시간표 이미지가 저장되었습니다." } = {}) {
  if (isCatalogUnavailable() || isCatalogBusy()) return false;
  // 아직 저장하지 않은 새 그룹에 쓰면 '변경 취소' 뒤에 주인 없는 이미지가 남는다.
  if (!getScheduleGroups(storedCatalog).some((group) => group.id === imageGroupId)) {
    setImageAlert("새 그룹은 ‘기준값 저장’을 누른 뒤 이미지를 등록할 수 있습니다.", true);
    return false;
  }
  // 쓰기 경로는 시작 시점의 그룹으로 고정한다.
  const groupId = imageGroupId;
  const payload = serializeScheduleImagesPayload(list);
  if (payload.some((item) => !item.name || !validateScheduleImageUrl(item.url).ok)) {
    setImageAlert("모든 이미지의 이름과 URL을 확인해주세요.", true);
    return false;
  }
  const savedDivisionKeys = new Set(getScheduleDivisions(storedCatalog).map((item) => item.key));
  const savedImages = getExactGroupScheduleImages(storedCatalog, groupId);
  if (payload.some((item) => !savedDivisionKeys.has(item.division)
    && !savedImages.some((saved) => saved.division === item.division))) {
    setImageAlert("새 학교급은 ‘기준값 저장’을 누른 뒤 이미지에 적용할 수 있습니다.", true);
    return false;
  }
  const listEl = $("#scheduleImageList");
  imageSaving = true;
  listEl?.setAttribute("aria-busy", "true");
  try {
    const ref = doc(db, "settings", "timetableCatalog");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const updates = {
        [`groupCatalogs.${groupId}.scheduleImages`]: payload,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      };
      applyLegacyTimetableCatalogFieldRemovals(updates, deleteField);
      await updateDoc(ref, updates);
    } else {
      await setDoc(ref, {
        ...serializeScheduleGroupsPayload(scheduleGroupsDraft),
        groupCatalogs: { [groupId]: { scheduleImages: payload } },
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      });
    }
    invalidateSetting("timetableCatalog");
    // 쓰기는 이미 성공했다. 확인 읽기만 실패하면 저장 실패로 알리지 않고 쓴 값을 저장본으로 삼는다.
    try {
      const confirmed = await getDocFromServer(ref);
      storedCatalog = confirmed.exists() ? { ...confirmed.data() } : {};
    } catch (confirmError) {
      console.warn("[admin-timetable] image save confirm read failed:", confirmError);
      const catalogs = storedCatalog.groupCatalogs && typeof storedCatalog.groupCatalogs === "object" ? storedCatalog.groupCatalogs : {};
      storedCatalog = { ...storedCatalog, groupCatalogs: { ...catalogs, [groupId]: { ...catalogs[groupId], scheduleImages: payload } } };
    }
    scheduleImagesDraft = cloneScheduleImagesDraft(getExactGroupScheduleImages(storedCatalog, groupId));
    setImageAlert();
    clearOrderStatus($("#scheduleImagesOrderStatus"));
    renderImages();
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) {
    console.error("[admin-timetable] image save failed:", error);
    setImageAlert("시간표 이미지 저장에 실패했습니다. 목록은 바뀌지 않았습니다. 다시 시도해주세요.", true);
    return false;
  } finally {
    imageSaving = false;
    listEl?.removeAttribute("aria-busy");
  }
}

/** 그룹을 삭제하면 함께 사라지는 이미지를 학교급별 수량·이름으로 적는다. 연결이 없으면 빈 문자열. */
function describeGroupLinks(groupId) {
  const images = getExactGroupScheduleImages(storedCatalog, groupId);
  if (!images.length) return "";
  const divisions = getScheduleDivisions(storedCatalog);
  const byDivision = new Map();
  images.forEach((image) => byDivision.set(image.division, [...(byDivision.get(image.division) || []), image.name]));
  const lines = Array.from(byDivision, ([key, names]) => {
    const label = divisions.find((division) => division.key === key)?.label || key;
    return `· ${label} ${names.length}개: ${names.join(", ")}`;
  });
  return `연결된 학교급 ${byDivision.size}개, 이미지 ${images.length}개가 이 그룹에서 삭제됩니다.\n${lines.join("\n")}\n\n‘기준값 저장’을 누르면 실제로 삭제되며 되돌릴 수 없습니다. 다른 그룹에서도 쓰는 학교급 기준값은 남습니다.`;
}

function bindEvents() {
  $("#refreshBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled || isCatalogBusy()) return;
    // 새로고침은 저장된 기준값으로 그룹·학교급 초안을 덮어쓰므로 저장 전 변경이 있으면 먼저 확인한다.
    if (isCatalogDraftDirty() && !(await openAdminConfirm({
      title: "저장 전 변경이 사라집니다",
      message: "저장하지 않은 시간표 기준값 변경이 있습니다. 새로고침하면 저장된 값으로 되돌아갑니다.",
      cancelLabel: "계속 편집",
      confirmLabel: "새로고침",
      danger: true,
    }))) return;
    setAdminRefreshButtonState(button, true);
    try {
      await loadCatalog();
      clearOrderStatus($("#scheduleGroupsOrderStatus"));
      loadImagesForGroup(imageGroupId);
      toast("최신 설정을 불러왔습니다.");
    } catch (error) {
      console.error("[admin-timetable] refresh failed:", error);
      toast("최신 설정을 불러오지 못했습니다. 화면의 변경은 그대로 있으니 다시 시도해주세요.", true);
    } finally {
      setAdminRefreshButtonState(button, false);
    }
  });
  initCatalogDrawer({
    panel: $("#scheduleGroupsPanel"),
    openButton: $("#scheduleGroupsOpenBtn"),
    titleId: "scheduleGroupsDrawerTitle",
  });
  $("#scheduleGroupsResetBtn")?.addEventListener("click", async () => {
    const summary = buildGroupsSummary();
    if (!summary.total || isCatalogBusy() || !(await confirmDraftReset(summary))) return;
    scheduleGroupsDraft = getScheduleGroups(storedCatalog);
    scheduleDivisionsDraft = getScheduleDivisions(storedCatalog);
    // 저장 전에 추가한 그룹을 보고 있었다면 저장된 그룹으로 돌아간다.
    const selectedExists = scheduleGroupsDraft.some((group) => group.id === selectedGroupId);
    if (!selectedExists) selectedGroupId = scheduleGroupsDraft[0]?.id || REGULAR_SCHEDULE_GROUP_ID;
    renderGroups();
    if (!selectedExists) loadImagesForGroup(selectedGroupId);
    clearOrderStatus($("#scheduleGroupsOrderStatus"));
    $("#scheduleGroupsDrawerTitle")?.focus?.({ preventScroll: true });
    toast("저장 전 변경을 취소했습니다.");
  });
  $("#scheduleGroupsSaveBtn")?.addEventListener("click", saveGroups);
  $("#scheduleImageGroupId")?.addEventListener("change", (event) => loadImagesForGroup(event.currentTarget.value));
  // 저장 전 기준값 변경이나 수정창 입력이 있는 채로 페이지를 떠나면 조용히 사라지므로 브라우저 확인창을 띄운다.
  window.addEventListener("beforeunload", (event) => {
    if (!isCatalogDraftDirty() && !imageEditTracker?.isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("keydown", onImageEditKeydown);
  $("#scheduleGroupsEditor")?.addEventListener("input", updateGroupsDraftBadge);
  $("#scheduleDivisionsEditor")?.addEventListener("input", updateGroupsDraftBadge);
  $("#scheduleImageDivisionFilter")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-image-filter]");
    if (!button || button.dataset.imageFilter === imageFilter) return;
    imageFilter = button.dataset.imageFilter;
    renderImages();
    // 필터를 고르면 새 이미지의 구분도 같은 값으로 맞춘다.
    const addSelect = $("#scheduleImageDivisionInput");
    if (addSelect && imageFilter !== "all" && getScheduleDivisions(storedCatalog).some((division) => division.key === imageFilter)) addSelect.value = imageFilter;
    clearOrderStatus($("#scheduleImagesOrderStatus"));
    findRow($("#scheduleImageDivisionFilter"), "[data-image-filter]", "data-image-filter", imageFilter)?.focus?.({ preventScroll: true });
  });
  $("#scheduleImageAddBtn")?.addEventListener("click", async () => {
    if (isCatalogBusy()) return;
    const result = addImage(
      $("#scheduleImageNameInput")?.value,
      $("#scheduleImageUrlInput")?.value,
      $("#scheduleImageDivisionInput")?.value
    );
    if (!result.ok) {
      setImageAlert(result.message, true);
      return;
    }
    const added = result.list[result.list.length - 1];
    // 입력값은 저장에 성공한 뒤에만 비운다. 실패하면 그대로 다시 시도할 수 있다.
    if (!(await saveImages(result.list))) return;
    $("#scheduleImageNameInput").value = "";
    $("#scheduleImageUrlInput").value = "";
    if (imageFilter !== "all" && imageFilter !== added.division) {
      imageFilter = added.division;
      renderImages();
    }
    flashMovedRow(findImageItem(added.url));
    announceOrderChange(`‘${added.name}’ 이미지를 추가하고 저장했습니다.`, { statusEl: $("#scheduleImagesOrderStatus") });
  });
  $("#scheduleImageList")?.addEventListener("click", async (event) => {
    const item = event.target.closest(".admin-schedule-image-item");
    const url = item?.dataset.imageUrl || "";
    const moveButton = event.target.closest("[data-image-move]");
    const editButton = event.target.closest("[data-image-edit]");
    const removeButton = event.target.closest("[data-image-remove]");
    if (moveButton) {
      // 빠르게 연속으로 눌러도 오류로 알리지 않고, 저장이 끝난 뒤의 클릭만 받는다.
      if (imageSaving || groupsSaving) return;
      const direction = moveButton.dataset.imageMove;
      const move = buildImageMove(url, direction);
      if (!move) return;
      const saved = await saveImages(move.list, { successMessage: "" });
      const other = direction === "up" ? "down" : "up";
      if (!saved) {
        restoreMoveFocus(findImageItem(url), [`[data-image-move="${direction}"]`, `[data-image-move="${other}"]`]);
        return;
      }
      reportOrderMove({
        row: findImageItem(url),
        label: move.label,
        index: move.index,
        total: move.total,
        direction,
        selectors: (dir) => `[data-image-move="${dir}"]`,
        statusEl: $("#scheduleImagesOrderStatus"),
        persisted: true,
      });
      return;
    }
    if ((editButton || removeButton) && isCatalogBusy()) return;
    if (editButton) {
      editImage(url);
      return;
    }
    if (removeButton) {
      const label = scheduleImagesDraft.find((entry) => entry.url === url)?.name || "이미지";
      const removedIndex = getVisibleImages().findIndex((entry) => entry.url === url);
      // 되돌리는 버튼이 없으므로 바로 공개 시간표에 반영되기 전에 한 번 확인한다.
      const confirmed = await openAdminConfirm({
        title: "이미지 제거",
        message: `‘${label}’ 이미지를 제거합니다. 공개 시간표에 바로 반영됩니다. 업로드한 이미지 파일은 삭제되지 않습니다.`,
        cancelLabel: "취소",
        confirmLabel: "제거",
        danger: true,
      });
      if (!confirmed) return;
      if (!(await saveImages(scheduleImagesDraft.filter((entry) => entry.url !== url)))) return;
      focusAfterRowRemoved($("#scheduleImageList")?.querySelectorAll(".admin-schedule-image-item"), removedIndex, "[data-image-remove]", $("#scheduleImageNameInput"));
      announceOrderChange(`‘${label}’ 이미지를 제거하고 저장했습니다.`, { statusEl: $("#scheduleImagesOrderStatus") });
    }
  });
  $("#scheduleImageEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitImageEdit();
  });
  $("#scheduleImageEditModal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-image-edit-close]")) requestCloseImageEditModal();
  });
  $("#scheduleImageList")?.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-image-division]");
    if (!select) return;
    const item = select.closest(".admin-schedule-image-item");
    const url = item?.dataset.imageUrl || "";
    if (isCatalogBusy()) {
      renderImages();
      return;
    }
    const candidate = scheduleImagesDraft.map((entry) =>
      entry.url === url ? { ...entry, division: select.value } : entry
    );
    if (!(await saveImages(candidate))) renderImages();
  });
  $("#adminScheduleGroupTabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-schedule-group-id]");
    if (!tab) return;
    const nextGroupId = tab.dataset.scheduleGroupId || REGULAR_SCHEDULE_GROUP_ID;
    if (nextGroupId === selectedGroupId || isCatalogBusy()) return;
    // 기준값 패널에서 입력 중이던 그룹·학교급 초안은 다시 그리기 전에 화면 값으로 보존한다.
    scheduleGroupsDraft = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
    scheduleDivisionsDraft = readDivisionLabels();
    selectedGroupId = nextGroupId;
    renderGroups();
    loadImagesForGroup(selectedGroupId);
  });
  $("#scheduleDivisionsEditor")?.addEventListener("click", (event) => {
    const activeButton = event.target.closest("[data-division-active]");
    if (activeButton) {
      activeButton.parentElement.querySelectorAll("[data-division-active]").forEach((button) => {
        button.classList.remove("on");
        button.setAttribute("aria-pressed", "false");
      });
      activeButton.classList.add("on");
      activeButton.setAttribute("aria-pressed", "true");
      updateGroupsDraftBadge();
      return;
    }
    scheduleDivisionsDraft = readDivisionLabels();
    scheduleGroupsDraft = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
    const actionButton = event.target.closest("[data-division-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.divisionAction;
    let movedKey = "";
    if (action === "add") {
      const label = $("[data-division-add-input]")?.value || "";
      if (!String(label || "").trim()) return;
      scheduleDivisionsDraft.push({ key: `division-${Date.now().toString(36)}`, label: String(label).trim(), active: true, sortOrder: scheduleDivisionsDraft.length });
    } else {
      const row = actionButton.closest("[data-division-key]");
      const index = scheduleDivisionsDraft.findIndex((item) => item.key === row?.dataset.divisionKey);
      if (index < 0) return;
      if (action === "delete") {
        if (scheduleDivisionsDraft.length <= 1) return toast("학교급 기준값은 1개 이상 필요합니다.", true);
        scheduleDivisionsDraft.splice(index, 1);
      } else {
        const nextIndex = index + (action === "up" ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= scheduleDivisionsDraft.length) return;
        [scheduleDivisionsDraft[index], scheduleDivisionsDraft[nextIndex]] = [scheduleDivisionsDraft[nextIndex], scheduleDivisionsDraft[index]];
        movedKey = row.dataset.divisionKey;
      }
    }
    scheduleDivisionsDraft = serializeScheduleDivisions(scheduleDivisionsDraft);
    renderGroups();
    if (movedKey) {
      const movedIndex = scheduleDivisionsDraft.findIndex((item) => item.key === movedKey);
      reportOrderMove({
        row: findRow($("#scheduleDivisionsEditor"), "[data-division-key]", "data-division-key", movedKey),
        label: scheduleDivisionsDraft[movedIndex]?.label,
        index: movedIndex,
        total: scheduleDivisionsDraft.length,
        direction: action,
        selectors: (dir) => `[data-division-action="${dir}"]`,
        statusEl: $("#scheduleGroupsOrderStatus"),
        saveHint: GROUPS_SAVE_HINT,
      });
    }
  });
  $("#scheduleGroupsEditor")?.addEventListener("click", async (event) => {
    const visibility = event.target.closest("[data-group-field='active']");
    if (visibility) {
      visibility.parentElement.querySelectorAll("[data-group-field='active']").forEach((button) => {
        button.classList.remove("on");
        button.setAttribute("aria-pressed", "false");
      });
      visibility.classList.add("on");
      visibility.setAttribute("aria-pressed", "true");
      updateGroupsDraftBadge();
      return;
    }
    scheduleDivisionsDraft = readDivisionLabels();
    const current = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
    const move = event.target.closest("[data-group-action^='move-']");
    if (move) {
      const groupId = move.dataset.groupId;
      const direction = move.dataset.groupAction === "move-up" ? "up" : "down";
      const result = moveScheduleGroupInDraft(current, groupId, direction);
      if (!result.ok) return toast(result.message, true);
      scheduleGroupsDraft = result.groups;
      renderGroups();
      const movedIndex = scheduleGroupsDraft.findIndex((group) => group.id === groupId);
      reportOrderMove({
        row: findRow($("#scheduleGroupsEditor"), ".admin-schedule-group-row", "data-group-id", groupId),
        label: scheduleGroupsDraft[movedIndex]?.label,
        index: movedIndex,
        total: scheduleGroupsDraft.length,
        direction,
        selectors: (dir) => `[data-group-action="move-${dir}"]`,
        statusEl: $("#scheduleGroupsOrderStatus"),
        saveHint: GROUPS_SAVE_HINT,
      });
      return;
    }
    const remove = event.target.closest("[data-group-action='delete']");
    if (remove) {
      const groupId = remove.dataset.groupId;
      const label = current.find((group) => group.id === groupId)?.label || "";
      const links = describeGroupLinks(groupId);
      const confirmed = await openAdminConfirm({
        title: "그룹 삭제",
        message: `‘${label}’ 그룹을 삭제합니다. ‘기준값 저장’을 눌러야 반영됩니다.

${links || "연결된 시간표 이미지가 없습니다."}

오프라인 반과 공용 학교급, 업로드한 이미지 원본 파일은 삭제하지 않습니다. 기존 반은 관리 목록의 미등록 그룹 탭에서 계속 확인할 수 있습니다.`,
        cancelLabel: "취소",
        confirmLabel: "삭제",
        danger: true,
      });
      if (!confirmed) return;
      const result = removeScheduleGroupFromDraft(current, groupId, {});
      if (!result.ok) return toast(result.message, true);
      scheduleGroupsDraft = result.groups;
      return renderGroups();
    }
    if (event.target.closest("#scheduleGroupAddBtn")) {
      const label = $("#scheduleGroupAddInput")?.value || "";
      const result = addScheduleGroupToDraft(current, label);
      if (!result.ok) return toast(result.message, true);
      scheduleGroupsDraft = result.groups;
      renderGroups();
    }
  });
}

async function init() {
  try {
    await requireRole("admin", "/members/login.html");
    bindEvents();
    await loadCatalog();
    loadImagesForGroup(selectedGroupId);
  } catch (error) {
    console.error("[admin-timetable] init failed:", error);
    setImageAlert("시간표 설정을 불러오지 못했습니다. ‘새로고침’으로 다시 시도해주세요. 불러오기 전에는 저장할 수 없습니다.", true);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
