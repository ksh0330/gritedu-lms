// settings/timetableCatalog — 오프라인 반/시간표 관리 기준값

import {
  mergeGradeLabelsWithDefaults,
  normalizeCatalogList,
} from "/assets/js/utils/catalog-select-helpers.js";

export const DEFAULT_TIMETABLE_SUBJECTS = ["국어", "영어", "수학", "과학", "수리논술", "컨설팅"];

export const DEFAULT_TIMETABLE_CATALOG = {
  subjects: DEFAULT_TIMETABLE_SUBJECTS.slice(),
  grades: mergeGradeLabelsWithDefaults([]),
  schools: [],
  classrooms: []
};

function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function mergeTimetableCatalog(stored) {
  const base = JSON.parse(JSON.stringify(DEFAULT_TIMETABLE_CATALOG));

  if (!isObj(stored)) {
    base.grades = mergeGradeLabelsWithDefaults([]);
    return base;
  }

  if (Array.isArray(stored.subjects) && stored.subjects.length) {
    base.subjects = normalizeCatalogList(stored.subjects);
  }
  if (Array.isArray(stored.grades) && stored.grades.length) {
    base.grades = mergeGradeLabelsWithDefaults(stored.grades);
  } else {
    base.grades = mergeGradeLabelsWithDefaults([]);
  }
  if (Array.isArray(stored.schools)) {
    base.schools = normalizeCatalogList(stored.schools);
  }
  if (Array.isArray(stored.classrooms)) {
    base.classrooms = normalizeCatalogList(stored.classrooms);
  }

  return base;
}

export async function loadTimetableCatalog(getSettingDoc) {
  try {
    const result = await getSettingDoc("timetableCatalog");
    const merged = mergeTimetableCatalog(result.exists ? result.data : {});
    return {
      catalog: {
        subjects: merged.subjects,
        grades: merged.grades,
        schools: merged.schools
      },
      classrooms: merged.classrooms
    };
  } catch (error) {
    console.warn("[timetable-catalog] load failed, using defaults", error);
    const merged = mergeTimetableCatalog({});
    return {
      catalog: {
        subjects: merged.subjects,
        grades: merged.grades,
        schools: merged.schools
      },
      classrooms: merged.classrooms
    };
  }
}

export function cloneTimetableCatalogDraft(catalog, classrooms = []) {
  return {
    subjects: normalizeCatalogList(catalog?.subjects),
    grades: normalizeCatalogList(catalog?.grades),
    schools: normalizeCatalogList(catalog?.schools),
    classrooms: normalizeCatalogList(classrooms)
  };
}

export function serializeTimetableCatalogPayload(draft) {
  return {
    subjects: normalizeCatalogList(draft.subjects),
    grades: normalizeCatalogList(draft.grades),
    schools: normalizeCatalogList(draft.schools),
    classrooms: normalizeCatalogList(draft.classrooms)
  };
}

export const SCHEDULE_IMAGE_URL_PREFIX = "https://assets.gritedu.kr/public/schedule/";
export const DEFAULT_SCHEDULE_DIVISIONS = [
  { key: "high", label: "고등부", active: true, sortOrder: 0 },
  { key: "middle", label: "중등부", active: true, sortOrder: 1 },
];
export const MAX_SCHEDULE_DIVISIONS = 8;

function normalizeScheduleDivision(item, index) {
  const key = String(item?.key || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const label = String(item?.label || "").trim();
  if (!key || !label) return null;
  return { key, label, active: item?.active !== false, sortOrder: index };
}

export function getScheduleDivisions(stored) {
  const source = Array.isArray(stored?.scheduleDivisions) ? stored.scheduleDivisions : [];
  const normalized = source
    .map(normalizeScheduleDivision)
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((other) => other.key === item.key) === index)
    .slice(0, MAX_SCHEDULE_DIVISIONS);
  return normalized.length ? normalized : DEFAULT_SCHEDULE_DIVISIONS.map((item) => ({ ...item }));
}

export function serializeScheduleDivisions(divisions) {
  return getScheduleDivisions({ scheduleDivisions: divisions }).map((item, sortOrder) => ({ ...item, sortOrder }));
}

const SCHEDULE_IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

export function validateScheduleImageUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return { ok: false, message: "이미지 URL을 입력해주세요." };
  if (/^(data:|blob:)/i.test(url)) {
    return { ok: false, message: "허용되지 않는 URL 형식입니다." };
  }
  if (url.includes("?") || url.includes("#")) {
    return { ok: false, message: "URL에 쿼리 문자열이나 해시를 포함할 수 없습니다." };
  }
  if (!url.startsWith(SCHEDULE_IMAGE_URL_PREFIX)) {
    return { ok: false, message: `허용 경로: ${SCHEDULE_IMAGE_URL_PREFIX}` };
  }
  const path = url.slice(SCHEDULE_IMAGE_URL_PREFIX.length);
  if (!path || path.includes("..") || path.startsWith("/")) {
    return { ok: false, message: "올바른 이미지 경로가 아닙니다." };
  }
  if (!SCHEDULE_IMAGE_EXT_RE.test(path)) {
    return { ok: false, message: "jpg, jpeg, png, webp, gif 이미지만 등록할 수 있습니다." };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { ok: false, message: "https URL만 허용됩니다." };
    }
    if (parsed.hostname !== "assets.gritedu.kr") {
      return { ok: false, message: "허용된 도메인이 아닙니다." };
    }
    if (parsed.search || parsed.hash) {
      return { ok: false, message: "URL에 쿼리 문자열이나 해시를 포함할 수 없습니다." };
    }
  } catch {
    return { ok: false, message: "올바른 URL 형식이 아닙니다." };
  }
  return { ok: true, url };
}

export function normalizeScheduleImageItem(item) {
  const name = String(item?.name || "").trim();
  const urlResult = validateScheduleImageUrl(item?.url);
  if (!name || !urlResult.ok) return null;
  const division = String(item?.division || "high").trim() || "high";
  return { name, url: urlResult.url, division };
}

export function parseScheduleImagesFromStored(stored) {
  if (!stored || typeof stored !== "object") return [];
  if (!Array.isArray(stored.scheduleImages)) return [];
  return stored.scheduleImages.map(normalizeScheduleImageItem).filter(Boolean);
}

export function cloneScheduleImagesDraft(images) {
  return (images || [])
    .map((item) => normalizeScheduleImageItem(item))
    .filter(Boolean)
    .map((item) => ({ name: item.name, url: item.url, division: item.division }));
}

export function serializeScheduleImagesPayload(images) {
  return cloneScheduleImagesDraft(images);
}

/** @typedef {{ id: string, label: string, type: "regular" | "seasonal", active: boolean, sortOrder: number, startDate?: string, endDate?: string }} ScheduleGroup */

export const REGULAR_SCHEDULE_GROUP_ID = "regular";
export const MAX_SCHEDULE_GROUPS = 3;

const SCHEDULE_GROUP_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

const SCHEDULE_GROUP_LABEL_ROMAN = {
  정규: "regular",
  윈터: "winter",
  겨울: "winter",
  썸머: "summer",
  여름: "summer",
};

/** @type {ScheduleGroup[]} */
export const DEFAULT_SCHEDULE_GROUPS = [
  {
    id: REGULAR_SCHEDULE_GROUP_ID,
    label: "정규",
    type: "regular",
    active: true,
    sortOrder: 0,
  },
];

function normalizeOptionalDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
}

export function normalizeScheduleGroupId(raw, fallbackLabel = "") {
  let id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!id || !SCHEDULE_GROUP_ID_RE.test(id)) {
    const label = String(fallbackLabel || "").trim();
    const mapped = SCHEDULE_GROUP_LABEL_ROMAN[label];
    if (mapped && SCHEDULE_GROUP_ID_RE.test(mapped)) {
      id = mapped;
    } else {
      id = `seasonal-${Date.now().toString(36).slice(-6)}`;
    }
  }

  return id.slice(0, 32);
}

/**
 * @param {unknown} item
 * @param {number} index
 * @returns {ScheduleGroup | null}
 */
export function normalizeScheduleGroupItem(item, index = 0) {
  if (!item || typeof item !== "object") return null;

  const label = String(item.label || "").trim();
  if (!label) return null;

  const requestedId = String(item.id || "").trim();
  const id =
    requestedId === REGULAR_SCHEDULE_GROUP_ID
      ? REGULAR_SCHEDULE_GROUP_ID
      : normalizeScheduleGroupId(requestedId, label);

  const type =
    id === REGULAR_SCHEDULE_GROUP_ID || item.type === "regular" ? "regular" : "seasonal";

  const sortOrder = Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index;

  /** @type {ScheduleGroup} */
  const group = {
    id,
    label,
    type,
    active: item.active !== false,
    sortOrder,
  };

  const startDate = normalizeOptionalDate(item.startDate);
  const endDate = normalizeOptionalDate(item.endDate);
  if (startDate) group.startDate = startDate;
  if (endDate) group.endDate = endDate;

  return group;
}

/**
 * @param {unknown} stored
 * @returns {ScheduleGroup[]}
 */
export function normalizeScheduleGroups(stored) {
  if (!Array.isArray(stored) || !stored.length) {
    return cloneScheduleGroupsDraft(DEFAULT_SCHEDULE_GROUPS);
  }

  const seen = new Set();
  const groups = stored
    .map((item, index) => normalizeScheduleGroupItem(item, index))
    .filter(Boolean)
    .filter((group) => {
      if (seen.has(group.id)) return false;
      seen.add(group.id);
      return true;
    });

  if (!groups.some((group) => group.id === REGULAR_SCHEDULE_GROUP_ID)) {
    groups.unshift({ ...DEFAULT_SCHEDULE_GROUPS[0] });
  }

  const regular = groups.find((group) => group.id === REGULAR_SCHEDULE_GROUP_ID);
  if (regular) {
    regular.type = "regular";
    regular.label = regular.label || "정규";
    regular.active = regular.active !== false;
    regular.sortOrder = 0;
  }

  return groups
    .slice(0, MAX_SCHEDULE_GROUPS)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "ko"));
}

/**
 * @param {unknown} catalogOrStored
 * @returns {ScheduleGroup[]}
 */
export function getScheduleGroups(catalogOrStored) {
  if (Array.isArray(catalogOrStored)) {
    return normalizeScheduleGroups(catalogOrStored);
  }
  if (catalogOrStored && typeof catalogOrStored === "object") {
    return normalizeScheduleGroups(catalogOrStored.scheduleGroups);
  }
  return cloneScheduleGroupsDraft(DEFAULT_SCHEDULE_GROUPS);
}

/**
 * @param {ScheduleGroup[] | unknown} groups
 * @returns {ScheduleGroup[]}
 */
export function getActiveScheduleGroups(groups) {
  return getScheduleGroups(groups).filter((group) => group.active !== false);
}

/**
 * @param {{ groupId?: unknown } | null | undefined} doc
 * @returns {string}
 */
export function resolveGroupId(doc) {
  const id = String(doc?.groupId || "").trim();
  return id || REGULAR_SCHEDULE_GROUP_ID;
}

/**
 * @param {string} groupId
 * @param {ScheduleGroup[] | unknown} groups
 * @returns {string}
 */
export function resolveScheduleGroupLabel(groupId, groups) {
  const id = resolveGroupId({ groupId });
  const match = getScheduleGroups(groups).find((group) => group.id === id);
  return match?.label || (id === REGULAR_SCHEDULE_GROUP_ID ? "정규" : id);
}

/**
 * @param {ScheduleGroup[] | unknown} groups
 * @param {{ entryCounts?: Record<string, number> }} [options]
 * @returns {{ ok: true, groups: ScheduleGroup[] } | { ok: false, message: string }}
 */
export function validateScheduleGroups(groups, options = {}) {
  const normalized = normalizeScheduleGroups(groups);
  const entryCounts = options.entryCounts || {};

  if (!normalized.length) {
    return { ok: false, message: "시간표 그룹이 1개 이상 필요합니다." };
  }
  if (normalized.length > MAX_SCHEDULE_GROUPS) {
    return { ok: false, message: `시간표 그룹은 최대 ${MAX_SCHEDULE_GROUPS}개까지 등록할 수 있습니다.` };
  }

  const regular = normalized.find((group) => group.id === REGULAR_SCHEDULE_GROUP_ID);
  if (!regular) {
    return { ok: false, message: "정규(regular) 그룹은 반드시 포함되어야 합니다." };
  }
  if (regular.type !== "regular") {
    return { ok: false, message: "regular 그룹의 type은 regular여야 합니다." };
  }

  const ids = new Set();
  for (const group of normalized) {
    if (!group.label) {
      return { ok: false, message: "그룹 이름을 입력해주세요." };
    }
    if (!SCHEDULE_GROUP_ID_RE.test(group.id)) {
      return { ok: false, message: `그룹 ID 형식이 올바르지 않습니다: ${group.id}` };
    }
    if (ids.has(group.id)) {
      return { ok: false, message: `중복된 그룹 ID입니다: ${group.id}` };
    }
    ids.add(group.id);
  }

  return { ok: true, groups: normalized };
}

/**
 * @param {ScheduleGroup[] | unknown} groups
 * @returns {ScheduleGroup[]}
 */
export function cloneScheduleGroupsDraft(groups) {
  return getScheduleGroups(groups).map((group) => {
    /** @type {ScheduleGroup} */
    const copy = {
      id: group.id,
      label: group.label,
      type: group.type,
      active: group.active !== false,
      sortOrder: Number(group.sortOrder) || 0,
    };
    if (group.startDate) copy.startDate = group.startDate;
    if (group.endDate) copy.endDate = group.endDate;
    return copy;
  });
}

/**
 * @param {ScheduleGroup[] | unknown} groups
 * @returns {{ scheduleGroups: ScheduleGroup[] }}
 */
export function serializeScheduleGroupsPayload(groups) {
  const validated = validateScheduleGroups(groups);
  if (!validated.ok) {
    return { scheduleGroups: cloneScheduleGroupsDraft(DEFAULT_SCHEDULE_GROUPS) };
  }
  return {
    scheduleGroups: validated.groups.map((group, index) => {
      /** @type {ScheduleGroup} */
      const item = {
        id: group.id,
        label: group.label,
        type: group.type,
        active: group.active !== false,
        sortOrder: index,
      };
      if (group.startDate) item.startDate = group.startDate;
      if (group.endDate) item.endDate = group.endDate;
      return item;
    }),
  };
}

/**
 * @param {Array<{ groupId?: unknown }>} items
 * @returns {Record<string, number>}
 */
export function countItemsByGroupId(items) {
  /** @type {Record<string, number>} */
  const counts = {};
  (items || []).forEach((item) => {
    const id = resolveGroupId(item);
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

/** @typedef {{ subjects: string[], grades: string[], schools: string[], classrooms: string[], scheduleImages: Array<{ name: string, url: string }> }} GroupCatalog */

export function normalizeGroupCatalog(stored) {
  const merged = mergeTimetableCatalog(stored);
  return {
    subjects: merged.subjects,
    grades: merged.grades,
    schools: merged.schools,
    classrooms: merged.classrooms,
    scheduleImages: parseScheduleImagesFromStored(stored),
  };
}

export function cloneGroupCatalogDraft(catalog) {
  const base = normalizeGroupCatalog(catalog || {});
  return {
    subjects: normalizeCatalogList(base.subjects),
    grades: normalizeCatalogList(base.grades),
    schools: normalizeCatalogList(base.schools),
    classrooms: normalizeCatalogList(base.classrooms),
    scheduleImages: cloneScheduleImagesDraft(base.scheduleImages),
  };
}

export function hasOwnGroupCatalogEntry(stored, groupId) {
  const id = resolveGroupId({ groupId });
  if (!isObj(stored?.groupCatalogs)) return false;
  return Object.prototype.hasOwnProperty.call(stored.groupCatalogs, id);
}

/**
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} groupId
 * @returns {GroupCatalog}
 */
export function getGroupCatalog(stored, groupId) {
  const id = resolveGroupId({ groupId });
  const groupCatalogs = isObj(stored?.groupCatalogs) ? stored.groupCatalogs : {};

  if (hasOwnGroupCatalogEntry(stored, id)) {
    return normalizeGroupCatalog(groupCatalogs[id]);
  }
  if (
    id !== REGULAR_SCHEDULE_GROUP_ID &&
    hasOwnGroupCatalogEntry(stored, REGULAR_SCHEDULE_GROUP_ID)
  ) {
    return normalizeGroupCatalog(groupCatalogs[REGULAR_SCHEDULE_GROUP_ID]);
  }
  return normalizeGroupCatalog(stored);
}

/**
 * Exact group scheduleImages only. No cross-group fallback except regular legacy top-level.
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} groupId
 * @returns {Array<{ name: string, url: string }>}
 */
export function getExactGroupScheduleImages(stored, groupId) {
  const id = resolveGroupId({ groupId });
  const groupCatalogs = isObj(stored?.groupCatalogs) ? stored.groupCatalogs : {};

  if (hasOwnGroupCatalogEntry(stored, id)) {
    const entry = groupCatalogs[id];
    if (entry && typeof entry === "object" && Array.isArray(entry.scheduleImages)) {
      return parseScheduleImagesFromStored(entry);
    }
    if (id === REGULAR_SCHEDULE_GROUP_ID) {
      return parseScheduleImagesFromStored(stored);
    }
    return [];
  }

  if (id === REGULAR_SCHEDULE_GROUP_ID) {
    return parseScheduleImagesFromStored(stored);
  }

  return [];
}

/**
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} groupId
 * @returns {Array<{ name: string, url: string }>}
 */
export function getGroupScheduleImages(stored, groupId) {
  return getExactGroupScheduleImages(stored, groupId);
}

/**
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} queryGroupId
 * @returns {string}
 */
export function resolveScheduleGroupQuery(stored, queryGroupId) {
  const raw = String(queryGroupId || "").trim();
  if (!raw) return REGULAR_SCHEDULE_GROUP_ID;
  const groups = getScheduleGroups(stored);
  if (groups.some((group) => group.id === raw)) return raw;
  return REGULAR_SCHEDULE_GROUP_ID;
}

/**
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} groupId
 * @returns {GroupCatalog}
 */
export function getStoredGroupCatalogEntry(stored, groupId) {
  const id = resolveGroupId({ groupId });
  if (hasOwnGroupCatalogEntry(stored, id)) {
    return normalizeGroupCatalog(stored.groupCatalogs[id]);
  }
  if (id === REGULAR_SCHEDULE_GROUP_ID) {
    return normalizeGroupCatalog(stored);
  }
  return normalizeGroupCatalog({});
}

/**
 * Exact group catalog for admin/public UI. No cross-group fallback except regular legacy top-level.
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} groupId
 * @returns {GroupCatalog}
 */
export function getExactGroupCatalog(stored, groupId) {
  return getStoredGroupCatalogEntry(stored, groupId);
}

export function serializeGroupCatalogFields(draft) {
  return {
    subjects: normalizeCatalogList(draft?.subjects),
    grades: normalizeCatalogList(draft?.grades),
    schools: normalizeCatalogList(draft?.schools),
    classrooms: normalizeCatalogList(draft?.classrooms),
    scheduleImages: serializeScheduleImagesPayload(draft?.scheduleImages || []),
  };
}

/**
 * @param {Record<string, unknown>} existingGroupCatalogs
 * @param {string} groupId
 * @param {GroupCatalog} draft
 */
export function mergeGroupCatalogIntoStore(existingGroupCatalogs, groupId, draft) {
  const id = resolveGroupId({ groupId });
  const fields = serializeGroupCatalogFields(draft);
  return {
    groupCatalogs: {
      ...(isObj(existingGroupCatalogs) ? existingGroupCatalogs : {}),
      [id]: fields,
    },
    fields,
    groupId: id,
  };
}

/** Unused legacy keys written outside the current CMS; removed on admin save. */
export const LEGACY_TIMETABLE_CATALOG_FIELD_KEYS = ["subjectMeta", "subjectColorMap", "version"];

/**
 * @param {Record<string, unknown>} payload
 * @param {() => unknown} deleteFieldFn
 */
export function applyLegacyTimetableCatalogFieldRemovals(payload, deleteFieldFn) {
  if (!payload || typeof deleteFieldFn !== "function") return payload;
  LEGACY_TIMETABLE_CATALOG_FIELD_KEYS.forEach((key) => {
    payload[key] = deleteFieldFn();
  });
  return payload;
}

/**
 * @param {{
 *   groupCatalogs: Record<string, unknown>,
 *   groupId: string,
 *   fields: ReturnType<typeof serializeGroupCatalogFields>,
 *   updatedBy: string,
 *   deleteFieldFn?: () => unknown,
 * }} options
 */
export function buildTimetableCatalogSavePayload({ groupCatalogs, groupId, fields, updatedBy, deleteFieldFn }) {
  /** @type {Record<string, unknown>} */
  const payload = {
    groupCatalogs,
    updatedBy,
  };

  if (groupId === REGULAR_SCHEDULE_GROUP_ID) {
    payload.subjects = fields.subjects;
    payload.grades = fields.grades;
    payload.schools = fields.schools;
    payload.classrooms = fields.classrooms;
    payload.scheduleImages = fields.scheduleImages;
  }

  applyLegacyTimetableCatalogFieldRemovals(payload, deleteFieldFn);
  return payload;
}

/**
 * @param {Record<string, unknown>} stored
 * @param {ReturnType<typeof mergeGroupCatalogIntoStore>} merged
 */
export function applyTimetableCatalogMergeToStored(stored, merged) {
  const next = {
    ...(isObj(stored) ? stored : {}),
    groupCatalogs: merged.groupCatalogs,
  };
  if (merged.groupId === REGULAR_SCHEDULE_GROUP_ID) {
    next.subjects = merged.fields.subjects;
    next.grades = merged.fields.grades;
    next.schools = merged.fields.schools;
    next.classrooms = merged.fields.classrooms;
    next.scheduleImages = merged.fields.scheduleImages;
  }
  LEGACY_TIMETABLE_CATALOG_FIELD_KEYS.forEach((key) => {
    delete next[key];
  });
  return next;
}

/**
 * Baseline catalog fields from the admin UI draft. Preserves existing scheduleImages.
 * @param {{ subjects?: unknown, grades?: unknown, schools?: unknown, classrooms?: unknown }} catalogDraft
 * @param {Record<string, unknown> | null | undefined} stored
 * @param {string} groupId
 */
export function buildCatalogBaselineFieldsFromDraft(catalogDraft, stored, groupId) {
  const id = resolveGroupId({ groupId });
  return serializeGroupCatalogFields({
    subjects: catalogDraft?.subjects,
    grades: catalogDraft?.grades,
    schools: catalogDraft?.schools,
    classrooms: catalogDraft?.classrooms,
    scheduleImages: getExactGroupScheduleImages(stored, id),
  });
}

/**
 * Firestore updateDoc payload for one group's baseline catalog (dot-path groupCatalogs).
 * @param {string} groupId
 * @param {ReturnType<typeof serializeGroupCatalogFields>} fields
 * @param {{ updatedBy: string, deleteFieldFn?: () => unknown }} options
 */
export function buildTimetableCatalogBaselineUpdateFields(groupId, fields, { updatedBy, deleteFieldFn }) {
  const id = resolveGroupId({ groupId });
  /** @type {Record<string, unknown>} */
  const updates = {
    [`groupCatalogs.${id}`]: fields,
    updatedBy,
  };

  if (id === REGULAR_SCHEDULE_GROUP_ID) {
    updates.subjects = fields.subjects;
    updates.grades = fields.grades;
    updates.schools = fields.schools;
    updates.classrooms = fields.classrooms;
    updates.scheduleImages = fields.scheduleImages;
  }

  applyLegacyTimetableCatalogFieldRemovals(updates, deleteFieldFn);
  return updates;
}

/**
 * Initial create payload when settings/timetableCatalog does not exist yet.
 * @param {string} groupId
 * @param {ReturnType<typeof serializeGroupCatalogFields>} fields
 * @param {ScheduleGroup[]} scheduleGroups
 */
export function buildTimetableCatalogBaselineCreatePayload(groupId, fields, scheduleGroups) {
  const id = resolveGroupId({ groupId });
  /** @type {Record<string, unknown>} */
  const payload = {
    scheduleGroups: serializeScheduleGroupsPayload(scheduleGroups).scheduleGroups,
    groupCatalogs: {
      [id]: fields,
    },
  };

  if (id === REGULAR_SCHEDULE_GROUP_ID) {
    payload.subjects = fields.subjects;
    payload.grades = fields.grades;
    payload.schools = fields.schools;
    payload.classrooms = fields.classrooms;
    payload.scheduleImages = fields.scheduleImages;
  }

  return payload;
}
