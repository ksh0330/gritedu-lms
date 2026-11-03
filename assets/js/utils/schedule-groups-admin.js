// Shared admin UI for settings/timetableCatalog.scheduleGroups

import { escapeHtml } from "/assets/js/utils/html.js";
import {
  MAX_SCHEDULE_GROUPS,
  REGULAR_SCHEDULE_GROUP_ID,
  cloneScheduleGroupsDraft,
  getActiveScheduleGroups,
  getScheduleGroups,
  normalizeScheduleGroupId,
  normalizeScheduleGroupItem,
  resolveScheduleGroupLabel,
  resolveGroupId,
} from "/assets/js/utils/timetable-catalog.js";

/**
 * @param {HTMLElement | null | undefined} container
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} groups
 * @param {string} selectedId
 */
export function renderAdminScheduleGroupTabs(container, groups, selectedId, { retainedGroupIds = [] } = {}) {
  if (!container) return;
  const active = getActiveScheduleGroups(groups);
  // 관리자 반 목록에서만 기존 반의 숨김/미등록 그룹을 유지한다. 공개·선택 목록은 기본 동작 그대로다.
  const known = getScheduleGroups(groups);
  for (const groupId of new Set(retainedGroupIds.map((id) => resolveGroupId({ groupId: id })))) {
    if (active.some((group) => group.id === groupId)) continue;
    const group = known.find((item) => item.id === groupId);
    active.push({ id: groupId, label: group ? `${group.label} (숨김)` : `미등록 그룹 (${groupId})` });
  }

  const showRetainedChoice = retainedGroupIds.length > 0 && active.length === 1 && active[0].id !== selectedId;
  if (active.length <= 1 && !showRetainedChoice) {
    container.innerHTML =
      active.length === 1
        ? `<p class="admin-schedule-group-tabs__single muted" aria-live="polite">${escapeHtml(active[0].label)}</p>`
        : "";
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.innerHTML = active
    .map((group) => {
      const isOn = group.id === selectedId;
      return `<button type="button" class="admin-schedule-group-tab${isOn ? " on" : ""}" data-schedule-group-id="${escapeHtml(group.id)}" role="tab" aria-selected="${isOn ? "true" : "false"}">${escapeHtml(group.label)}</button>`;
    })
    .join("");
}

/**
 * @param {HTMLElement | null | undefined} container
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} draft
 * @param {{ entryCounts?: Record<string, number> }} [options]
 */
export function renderScheduleGroupsEditor(container, draft, options = {}) {
  if (!container) return;
  const groups = getScheduleGroups(draft);
  const entryCounts = options.entryCounts || {};
  const canAdd = groups.length < MAX_SCHEDULE_GROUPS;

  const rows = groups
    .map((group, index) => {
      const isRegular = group.id === REGULAR_SCHEDULE_GROUP_ID;
      const isFirst = index === 0;
      const isLast = index === groups.length - 1;
      const count = entryCounts[group.id] || 0;
      const countNote =
        count > 0 ? `<span class="muted admin-schedule-group-row__count">${count}개</span>` : "";
      const active = group.active !== false;
      const name = escapeHtml(group.label);
      return `
        <div class="admin-schedule-group-row admin-catalog-row admin-catalog-row--wrap" data-group-id="${escapeHtml(group.id)}">
          <span class="admin-catalog-row__index" aria-hidden="true">${index + 1}</span>
          <input type="text" class="admin-catalog-field__input admin-schedule-group-row__name admin-catalog-row__input" data-group-field="label" value="${name}" placeholder="그룹 이름" autocomplete="off" aria-label="${name} 그룹 이름">
          <div class="admin-schedule-group-row__visibility" role="group" aria-label="${name} 노출 여부">
            <button type="button" class="admin-schedule-group-visibility-btn${active ? " on" : ""}" data-group-field="active" data-active-value="true" aria-pressed="${active ? "true" : "false"}">노출</button>
            <button type="button" class="admin-schedule-group-visibility-btn${active ? "" : " on"}" data-group-field="active" data-active-value="false" aria-pressed="${active ? "false" : "true"}">숨김</button>
          </div>
          <div class="admin-schedule-group-row__order admin-catalog-row__moves">
            <button type="button" class="admin-catalog-tag__move admin-schedule-group-order-btn" data-group-action="move-up" data-group-id="${escapeHtml(group.id)}"${isFirst ? " disabled" : ""} aria-label="${name} 위로" title="위로">↑</button>
            <button type="button" class="admin-catalog-tag__move admin-schedule-group-order-btn" data-group-action="move-down" data-group-id="${escapeHtml(group.id)}"${isLast ? " disabled" : ""} aria-label="${name} 아래로" title="아래로">↓</button>
          </div>
          <div class="admin-schedule-group-row__meta">
            ${countNote}
            ${
              isRegular
                ? '<button type="button" class="admin-catalog-tag__remove admin-catalog-row__remove" disabled aria-label="정규 그룹은 삭제할 수 없습니다" title="정규 그룹은 삭제할 수 없습니다">&times;</button>'
                : `<button type="button" class="admin-catalog-tag__remove admin-catalog-row__remove admin-catalog-row__remove--danger admin-schedule-group-row__delete" data-group-action="delete" data-group-id="${escapeHtml(group.id)}" aria-label="${name} 그룹 삭제" title="그룹 삭제">&times;</button>`
            }
          </div>
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="admin-schedule-groups-editor">
      <p class="muted admin-schedule-groups-editor__lead">정규·윈터·썸머처럼 시간표와 오프라인 반을 구분합니다. 최대 ${MAX_SCHEDULE_GROUPS}개까지 등록할 수 있습니다.</p>
      <div class="admin-schedule-groups-editor__list">${rows || '<p class="muted">등록된 그룹이 없습니다.</p>'}</div>
      <div class="admin-schedule-groups-editor__actions admin-catalog-field__row">
        <input type="text" class="admin-catalog-field__input" id="scheduleGroupAddInput" placeholder="새 그룹 이름" maxlength="20" autocomplete="off"${canAdd ? "" : " disabled"}>
        <button type="button" class="btn sm" id="scheduleGroupAddBtn"${canAdd ? "" : " disabled"}>추가</button>
      </div>
    </div>`;
}

/**
 * @param {HTMLElement} row
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup} previous
 * @returns {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup | null}
 */
export function readScheduleGroupRow(row, previous) {
  if (!row) return null;
  const label = String(row.querySelector('[data-group-field="label"]')?.value || "").trim();
  const activeBtn = row.querySelector('.admin-schedule-group-visibility-btn.on[data-group-field="active"]');
  const active = activeBtn?.getAttribute("data-active-value") !== "false";

  return normalizeScheduleGroupItem(
    {
      id: previous.id,
      label,
      type: previous.id === REGULAR_SCHEDULE_GROUP_ID ? "regular" : "seasonal",
      active,
      sortOrder: previous.sortOrder,
      startDate: previous.startDate,
      endDate: previous.endDate,
    },
    previous.sortOrder
  );
}

/**
 * @param {HTMLElement | null | undefined} container
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} draft
 * @returns {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]}
 */
export function readScheduleGroupsFromEditor(container, draft) {
  const previous = getScheduleGroups(draft);
  if (!container) return cloneScheduleGroupsDraft(previous);

  return previous
    .map((group) => {
      const row = container.querySelector(`.admin-schedule-group-row[data-group-id="${group.id}"]`);
      if (!row) return group;
      return readScheduleGroupRow(row, group);
    })
    .filter(Boolean);
}

/**
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} draft
 * @param {string} label
 */
export function addScheduleGroupToDraft(draft, label) {
  const groups = cloneScheduleGroupsDraft(draft);
  if (groups.length >= MAX_SCHEDULE_GROUPS) {
    return { ok: false, message: `시간표 그룹은 최대 ${MAX_SCHEDULE_GROUPS}개까지 등록할 수 있습니다.` };
  }

  const trimmedLabel = String(label || "").trim();
  if (!trimmedLabel) {
    return { ok: false, message: "그룹 이름을 입력해주세요." };
  }

  const id = normalizeScheduleGroupId("", trimmedLabel);
  if (groups.some((group) => group.id === id)) {
    return { ok: false, message: "이미 사용 중인 그룹입니다. 다른 이름을 입력해주세요." };
  }

  groups.push({
    id,
    label: trimmedLabel,
    type: "seasonal",
    active: true,
    sortOrder: groups.length,
  });

  return { ok: true, groups };
}

/**
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} draft
 * @param {string} groupId
 * @param {"up"|"down"} direction
 */
export function moveScheduleGroupInDraft(draft, groupId, direction) {
  const groups = cloneScheduleGroupsDraft(draft);
  const index = groups.findIndex((group) => group.id === groupId);
  if (index < 0) return { ok: false, message: "그룹을 찾을 수 없습니다." };

  const offset = direction === "up" ? -1 : 1;
  const nextIndex = index + offset;
  if (nextIndex < 0) return { ok: false, message: "이미 맨 위입니다." };
  if (nextIndex >= groups.length) return { ok: false, message: "이미 맨 아래입니다." };

  [groups[index], groups[nextIndex]] = [groups[nextIndex], groups[index]];
  return {
    ok: true,
    groups: groups.map((group, sortOrder) => ({ ...group, sortOrder })),
  };
}

/**
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} draft
 * @param {string} groupId
 * @param {Record<string, number>} entryCounts
 */
export function removeScheduleGroupFromDraft(draft, groupId, entryCounts = {}) {
  if (groupId === REGULAR_SCHEDULE_GROUP_ID) {
    return { ok: false, message: "정규 그룹은 삭제할 수 없습니다." };
  }

  const count = entryCounts[groupId] || 0;
  if (count > 0) {
    return {
      ok: false,
      message: `이 그룹에 등록된 항목이 ${count}개 있습니다. 항목을 옮기거나 삭제한 뒤 다시 시도해주세요.`,
    };
  }

  const groups = cloneScheduleGroupsDraft(draft).filter((group) => group.id !== groupId);
  return { ok: true, groups: groups.map((group, sortOrder) => ({ ...group, sortOrder })) };
}

/**
 * @param {HTMLElement | null | undefined} selectEl
 * @param {import("/assets/js/utils/timetable-catalog.js").ScheduleGroup[]} groups
 * @param {string} selectedId
 */
export function populateScheduleGroupSelect(selectEl, groups, selectedId, { preserveMissing = false } = {}) {
  if (!selectEl) return;
  const list = getScheduleGroups(groups);
  if (preserveMissing && selectedId && !list.some((group) => group.id === selectedId)) {
    list.push({ id: selectedId, label: `미등록 그룹 (${selectedId})` });
  }
  selectEl.innerHTML = list
    .map(
      (group) =>
        `<option value="${escapeHtml(group.id)}"${group.id === selectedId ? " selected" : ""}>${escapeHtml(group.label)}</option>`
    )
    .join("");
}

export { resolveScheduleGroupLabel, REGULAR_SCHEDULE_GROUP_ID };
