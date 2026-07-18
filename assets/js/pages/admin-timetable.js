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
import { ensureAdminToastHost } from "/assets/js/utils/admin-modal-alert.js";
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

function toast(message, isError = false) {
  const host = $("#statusMsg");
  if (!host) return;
  ensureAdminToastHost(host);
  host.textContent = message;
  host.classList.toggle("is-error", isError);
  host.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => host.classList.remove("is-visible"), 3200);
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
        <div class="admin-schedule-group-row" data-division-key="${escapeHtml(item.key)}">
          <input type="text" class="admin-catalog-field__input admin-schedule-group-row__name" data-division-field="label" value="${escapeHtml(item.label)}" maxlength="20" aria-label="학교급 이름">
          <div class="admin-schedule-group-row__visibility" role="group" aria-label="노출 여부">
            <button type="button" class="admin-schedule-group-visibility-btn${item.active !== false ? " on" : ""}" data-division-active="true">노출</button>
            <button type="button" class="admin-schedule-group-visibility-btn${item.active === false ? " on" : ""}" data-division-active="false">숨김</button>
          </div>
          <div class="admin-schedule-group-row__order">
            <button type="button" class="btn sm" data-division-action="up"${index === 0 ? " disabled" : ""}>↑</button>
            <button type="button" class="btn sm" data-division-action="down"${index === scheduleDivisionsDraft.length - 1 ? " disabled" : ""}>↓</button>
          </div>
          <div class="admin-schedule-group-row__meta">
            ${counts[item.key] ? `<span class="muted admin-schedule-group-row__count">이미지 ${counts[item.key]}개</span>` : ""}
            <button type="button" class="btn sm danger" data-division-action="delete"${counts[item.key] ? " disabled" : ""}>삭제</button>
          </div>
        </div>`).join("")}
    </div>
    <div class="admin-schedule-groups-editor__actions">
      <input type="text" class="admin-catalog-field__input" data-division-add-input placeholder="새 학교급 이름" maxlength="20" autocomplete="off"${scheduleDivisionsDraft.length >= MAX_SCHEDULE_DIVISIONS ? " disabled" : ""}>
      <button type="button" class="btn sm" data-division-action="add"${scheduleDivisionsDraft.length >= MAX_SCHEDULE_DIVISIONS ? " disabled" : ""}>+ 학교급 추가</button>
    </div>`;
}

function renderDivisionOptions() {
  const options = scheduleDivisionsDraft.map((item) =>
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
  if (button?.disabled) return;
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

  button.disabled = true;
  try {
    const payload = applyLegacyTimetableCatalogFieldRemovals({
      ...serializeScheduleGroupsPayload(validated.groups),
      scheduleDivisions: divisions,
      groupCatalogs,
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
    imageGroupId = selectedGroupId;
    renderGroups();
    toast("시간표 그룹이 저장되었습니다.");
  } catch (error) {
    console.error("[admin-timetable] group save failed:", error);
    toast("시간표 그룹 저장에 실패했습니다.", true);
  } finally {
    button.disabled = false;
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
  const division = scheduleDivisionsDraft.some((item) => item.key === rawDivision)
    ? rawDivision
    : scheduleDivisionsDraft[0]?.key || "high";
  return { ok: true, list: [...scheduleImagesDraft, { name, url: checked.url, division }] };
}

function moveImage(url, direction) {
  const index = scheduleImagesDraft.findIndex((item) => item.url === url);
  const nextIndex = index + (direction === "up" ? -1 : 1);
  if (index < 0 || nextIndex < 0 || nextIndex >= scheduleImagesDraft.length) return;
  const next = scheduleImagesDraft.slice();
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  scheduleImagesDraft = next;
}

function editImage(url) {
  const item = scheduleImagesDraft.find((entry) => entry.url === url);
  if (!item) return;
  $("#scheduleImageEditOriginalUrl").value = item.url;
  $("#scheduleImageEditName").value = item.name;
  $("#scheduleImageEditUrl").value = item.url;
  const modal = $("#scheduleImageEditModal");
  modal.hidden = false;
  modal.classList.add("is-open");
  document.body.classList.add("modal-open");
  $("#scheduleImageEditName").focus();
}

function closeImageEditModal() {
  const modal = $("#scheduleImageEditModal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function submitImageEdit() {
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
  scheduleImagesDraft = scheduleImagesDraft.map((entry) =>
    entry.url === url ? { ...entry, name: String(name).trim(), url: checked.url } : entry
  );
  renderImages();
  await saveImages();
  closeImageEditModal();
}

function renderImages() {
  const host = $("#scheduleImageList");
  if (!host) return;
  if (!scheduleImagesDraft.length) {
    host.innerHTML = '<p class="muted admin-schedule-image-list__empty">등록된 시간표 이미지가 없습니다.</p>';
    return;
  }
  host.innerHTML = scheduleImagesDraft.map((item, index) => `
    <article class="admin-schedule-image-item" data-image-url="${escapeHtml(item.url)}">
      <div class="admin-schedule-image-item__thumb-wrap">
        <img src="${escapeHtml(item.url)}" alt="" class="admin-schedule-image-item__thumb" loading="lazy">
      </div>
      <div class="admin-schedule-image-item__body">
        <strong class="admin-schedule-image-item__name">${escapeHtml(item.name)}</strong>
        <label class="admin-schedule-image-item__division-label">
          <span>구분</span>
          <select class="admin-schedule-image-item__division" data-image-division>
            ${scheduleDivisionsDraft.map((division) => `<option value="${escapeHtml(division.key)}"${item.division === division.key ? " selected" : ""}>${escapeHtml(division.label)}</option>`).join("")}
          </select>
        </label>
        <p class="muted admin-schedule-image-item__url">${escapeHtml(item.url)}</p>
        <div class="admin-schedule-image-item__actions">
          <button type="button" class="btn sm" data-image-move="up"${index === 0 ? " disabled" : ""}>위로</button>
          <button type="button" class="btn sm" data-image-move="down"${index === scheduleImagesDraft.length - 1 ? " disabled" : ""}>아래로</button>
          <button type="button" class="btn sm" data-image-edit>수정</button>
          <button type="button" class="btn sm" data-image-remove>삭제</button>
        </div>
      </div>
    </article>`).join("");
}

function loadImagesForGroup(groupId) {
  imageGroupId = resolveGroupId({ groupId });
  scheduleImagesDraft = cloneScheduleImagesDraft(getExactGroupScheduleImages(storedCatalog, imageGroupId));
  populateScheduleGroupSelect($("#scheduleImageGroupId"), scheduleGroupsDraft, imageGroupId);
  const label = resolveScheduleGroupLabel(imageGroupId, scheduleGroupsDraft);
  $("#scheduleImageGroupLabel").textContent = label;
  $("#scheduleImageStorageHint").textContent = `저장 위치: settings/timetableCatalog.groupCatalogs.${imageGroupId}.scheduleImages`;
  setImageAlert();
  renderImages();
}

async function saveImages() {
  const payload = serializeScheduleImagesPayload(scheduleImagesDraft);
  if (payload.some((item) => !item.name || !validateScheduleImageUrl(item.url).ok)) {
    setImageAlert("모든 이미지의 이름과 URL을 확인해주세요.", true);
    return;
  }
  const button = $("#scheduleImageSaveBtn");
  button.disabled = true;
  try {
    const ref = doc(db, "settings", "timetableCatalog");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const updates = {
        [`groupCatalogs.${imageGroupId}.scheduleImages`]: payload,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      };
      if (imageGroupId === REGULAR_SCHEDULE_GROUP_ID) updates.scheduleImages = payload;
      applyLegacyTimetableCatalogFieldRemovals(updates, deleteField);
      await updateDoc(ref, updates);
    } else {
      await setDoc(ref, {
        ...serializeScheduleGroupsPayload(scheduleGroupsDraft),
        groupCatalogs: { [imageGroupId]: { scheduleImages: payload } },
        ...(imageGroupId === REGULAR_SCHEDULE_GROUP_ID ? { scheduleImages: payload } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || "",
      });
    }
    invalidateSetting("timetableCatalog");
    const confirmed = await getDocFromServer(ref);
    storedCatalog = confirmed.exists() ? { ...confirmed.data() } : {};
    scheduleImagesDraft = cloneScheduleImagesDraft(getExactGroupScheduleImages(storedCatalog, imageGroupId));
    renderImages();
    toast("시간표 이미지가 저장되었습니다.");
  } catch (error) {
    console.error("[admin-timetable] image save failed:", error);
    setImageAlert("시간표 이미지 저장에 실패했습니다.", true);
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  $("#btnRefresh")?.addEventListener("click", async () => {
    await loadCatalog();
    toast("최신 설정을 불러왔습니다.");
  });
  $("#scheduleGroupsSaveBtn")?.addEventListener("click", saveGroups);
  $("#scheduleImageSaveBtn")?.addEventListener("click", saveImages);
  $("#scheduleImageGroupId")?.addEventListener("change", (event) => loadImagesForGroup(event.currentTarget.value));
  $("#scheduleImageAddBtn")?.addEventListener("click", () => {
    const result = addImage(
      $("#scheduleImageNameInput")?.value,
      $("#scheduleImageUrlInput")?.value,
      $("#scheduleImageDivisionInput")?.value
    );
    if (!result.ok) {
      setImageAlert(result.message, true);
      return;
    }
    scheduleImagesDraft = result.list;
    $("#scheduleImageNameInput").value = "";
    $("#scheduleImageUrlInput").value = "";
    setImageAlert();
    renderImages();
  });
  $("#scheduleImageList")?.addEventListener("click", async (event) => {
    const item = event.target.closest(".admin-schedule-image-item");
    const url = item?.dataset.imageUrl || "";
    if (event.target.closest("[data-image-move]")) moveImage(url, event.target.closest("[data-image-move]").dataset.imageMove);
    else if (event.target.closest("[data-image-edit]")) {
      editImage(url);
      return;
    }
    else if (event.target.closest("[data-image-remove]")) scheduleImagesDraft = scheduleImagesDraft.filter((entry) => entry.url !== url);
    else return;
    renderImages();
  });
  $("#scheduleImageEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitImageEdit();
  });
  $("#scheduleImageEditModal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget || event.target.closest("[data-image-edit-close]")) closeImageEditModal();
  });
  $("#scheduleImageList")?.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-image-division]");
    if (!select) return;
    const item = select.closest(".admin-schedule-image-item");
    const url = item?.dataset.imageUrl || "";
    scheduleImagesDraft = scheduleImagesDraft.map((entry) =>
      entry.url === url ? { ...entry, division: select.value } : entry
    );
    await saveImages();
  });
  $("#adminScheduleGroupTabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-schedule-group-id]");
    if (!tab) return;
    selectedGroupId = tab.dataset.scheduleGroupId || REGULAR_SCHEDULE_GROUP_ID;
    renderGroups();
    loadImagesForGroup(selectedGroupId);
  });
  $("#scheduleDivisionsEditor")?.addEventListener("click", (event) => {
    const activeButton = event.target.closest("[data-division-active]");
    if (activeButton) {
      activeButton.parentElement.querySelectorAll("[data-division-active]").forEach((button) => button.classList.remove("on"));
      activeButton.classList.add("on");
      return;
    }
    scheduleDivisionsDraft = readDivisionLabels();
    scheduleGroupsDraft = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
    const actionButton = event.target.closest("[data-division-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.divisionAction;
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
      }
    }
    scheduleDivisionsDraft = serializeScheduleDivisions(scheduleDivisionsDraft);
    renderGroups();
  });
  $("#scheduleGroupsEditor")?.addEventListener("click", (event) => {
    const visibility = event.target.closest("[data-group-field='active']");
    if (visibility) {
      visibility.parentElement.querySelectorAll("[data-group-field='active']").forEach((button) => button.classList.remove("on"));
      visibility.classList.add("on");
      return;
    }
    scheduleDivisionsDraft = readDivisionLabels();
    const current = readScheduleGroupsFromEditor($("#scheduleGroupsEditor"), scheduleGroupsDraft);
    const move = event.target.closest("[data-group-action^='move-']");
    if (move) {
      const result = moveScheduleGroupInDraft(current, move.dataset.groupId, move.dataset.groupAction === "move-up" ? "up" : "down");
      if (!result.ok) return toast(result.message, true);
      scheduleGroupsDraft = result.groups;
      return renderGroups();
    }
    const remove = event.target.closest("[data-group-action='delete']");
    if (remove) {
      if (!confirm("이 그룹과 그룹에 연결된 이미지 설정을 삭제하시겠습니까?")) return;
      const result = removeScheduleGroupFromDraft(current, remove.dataset.groupId, {});
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
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
