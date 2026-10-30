const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RESERVED_BRAND_COLORS = new Set(["#fd7e14", "#f68b1f", "#ff7a00"]);

export const SUBJECT_COLOR_SETTINGS_KEY = "subjectColors";
export const SUBJECT_COLOR_MAP_FIELD = "subjectColorMap";
export const SUBJECT_COLOR_SETTINGS_VERSION = 1;

const RESERVED_SUBJECT_NAMES = new Set([
  "전체",
  "all",
  "선택",
  "직접 입력",
  "목록에 없음",
  "__custom__",
]);

/**
 * Existing production colors. These are also used as a safe fallback until an
 * administrator saves them to settings/subjectColors.subjectColorMap.
 */
export const DEFAULT_SUBJECT_COLOR_MAP = Object.freeze({
  "국어": "#e95045",
  "영어": "#2f7ae5",
  "수학": "#34a853",
  "과학": "#f6c445",
  "수리논술": "#0e7490",
  "약술형논술": "#6610f2",
  "컨설팅": "#8e44ad",
});

/** Bootstrap 5.3 base palette, ordered for visibly distinct new assignments. */
export const BOOTSTRAP_SUBJECT_COLOR_PALETTE = Object.freeze([
  "#d63384", // pink
  "#6610f2", // indigo
  "#20c997", // teal
  "#0dcaf0", // cyan
  "#dc3545", // danger
  "#0d6efd", // primary
  "#198754", // success
  "#6f42c1", // purple
  "#6c757d", // secondary
  "#ffc107", // warning
  "#212529", // dark
]);

const SUBJECT_CODE_LABELS = Object.freeze({
  KOR: "국어",
  ENG: "영어",
  MATH: "수학",
  SCI: "과학",
  ESSAY: "수리논술",
  CONSULT: "컨설팅",
});

const SUBJECT_LABEL_ALIASES = Object.freeze({
  "\uB17C\uC220": "\uC218\uB9AC\uB17C\uC220",
});

function normalizeHexColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(color)) return "";
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return color;
}

export function normalizeSubjectColorMap(rawMap = {}) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return {};

  const result = {};
  Object.entries(rawMap).forEach(([rawSubject, rawColor]) => {
    const subject = String(rawSubject || "").trim();
    const colorValue = rawColor && typeof rawColor === "object"
      ? (rawColor.color || rawColor.background || rawColor.hex)
      : rawColor;
    const color = normalizeHexColor(colorValue);
    if (subject && color && !RESERVED_BRAND_COLORS.has(color)) result[subject] = color;
  });
  return result;
}

export function mergeSubjectColorMap(rawMap = {}) {
  const merged = {
    ...DEFAULT_SUBJECT_COLOR_MAP,
    ...normalizeSubjectColorMap(rawMap),
  };
  Object.entries(SUBJECT_LABEL_ALIASES).forEach(([alias, canonical]) => {
    if (merged[canonical]) merged[alias] = merged[canonical];
  });
  return merged;
}

export function getSubjectColorMapFromSettings(data = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return normalizeSubjectColorMap(data[SUBJECT_COLOR_MAP_FIELD] || data.colors || {});
}

export function areSubjectColorMapsEqual(left = {}, right = {}) {
  const leftEntries = Object.entries(normalizeSubjectColorMap(left)).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(normalizeSubjectColorMap(right)).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function addSubjectName(target, value) {
  const subject = String(value || "").trim();
  if (!subject || RESERVED_SUBJECT_NAMES.has(subject) || RESERVED_SUBJECT_NAMES.has(subject.toLowerCase())) return;
  target.add(subject);
}

function addSubjectList(target, values) {
  (Array.isArray(values) ? values : []).forEach((value) => {
    if (value && typeof value === "object") {
      addSubjectName(target, value.label || value.value);
    } else {
      addSubjectName(target, value);
    }
  });
}

function addOfflineCatalogSubjects(target, catalog = {}) {
  addSubjectList(target, catalog.subjects);
  const groupCatalogs = catalog.groupCatalogs && typeof catalog.groupCatalogs === "object"
    ? catalog.groupCatalogs
    : {};
  Object.values(groupCatalogs).forEach((group) => addSubjectList(target, group?.subjects));
  Object.entries(catalog).forEach(([key, group]) => {
    if (key.startsWith("groupCatalogs.")) addSubjectList(target, group?.subjects);
  });
}

/** Collects display names from the three independently managed subject catalogs. */
export function collectManagedSubjectNames({
  instructorsMenu = {},
  courseCatalog = {},
  offlineClassCatalog = {},
  timetableCatalog = {},
  additionalSubjects = [],
} = {}) {
  const subjects = new Set();
  addSubjectList(subjects, instructorsMenu.subjects || instructorsMenu.subjectOptions);

  const subjectGroup = (Array.isArray(courseCatalog.chipGroups) ? courseCatalog.chipGroups : [])
    .find((group) => group?.key === "subject");
  addSubjectList(subjects, subjectGroup?.options);

  addOfflineCatalogSubjects(subjects, offlineClassCatalog);
  addOfflineCatalogSubjects(subjects, timetableCatalog);
  addSubjectList(subjects, additionalSubjects);
  return Array.from(subjects);
}

export function buildSubjectColorSettingsPayload(subjects = [], storedMap = {}) {
  return {
    [SUBJECT_COLOR_MAP_FIELD]: ensureSubjectColorMap(subjects, storedMap),
    version: SUBJECT_COLOR_SETTINGS_VERSION,
  };
}

/**
 * Loads the canonical settings/subjectColors map. Until the first catalog save
 * migrates old data, settings/instructorsMenu.subjectColorMap is a read fallback.
 */
export async function loadSharedSubjectColorMap(getSettingDoc, fallbackSettingsData = null) {
  try {
    const canonical = await getSettingDoc(SUBJECT_COLOR_SETTINGS_KEY);
    const canonicalMap = canonical?.exists ? getSubjectColorMapFromSettings(canonical.data) : {};
    if (Object.keys(canonicalMap).length) return mergeSubjectColorMap(canonicalMap);
  } catch (error) {
    console.warn("[subject-colors] canonical color settings load failed", error);
  }

  if (fallbackSettingsData) {
    return mergeSubjectColorMap(getSubjectColorMapFromSettings(fallbackSettingsData));
  }

  try {
    const legacy = await getSettingDoc("instructorsMenu");
    return mergeSubjectColorMap(legacy?.exists ? getSubjectColorMapFromSettings(legacy.data) : {});
  } catch (error) {
    console.warn("[subject-colors] legacy color settings load failed", error);
    return mergeSubjectColorMap({});
  }
}

function numberToHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function hslToHex(hue, saturation = 62, lightness = 46) {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb = [0, 0, 0];

  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return `#${rgb.map((channel) => numberToHex((channel + m) * 255)).join("")}`;
}

function createOverflowColor(usedColors, seedIndex) {
  let attempt = 0;
  while (attempt < 360) {
    const color = hslToHex((seedIndex * 137.508 + attempt * 29) % 360);
    if (!usedColors.has(color)) return color;
    attempt += 1;
  }
  return "#495057";
}

/**
 * Keeps every stored color (including removed subjects for legacy records),
 * preserves the established defaults, and assigns a unique color to new names.
 */
export function ensureSubjectColorMap(subjects = [], storedMap = {}) {
  const result = mergeSubjectColorMap(storedMap);
  const usedColors = new Set(Object.values(result).map((color) => color.toLowerCase()));
  let overflowIndex = 0;

  (Array.isArray(subjects) ? subjects : [subjects]).forEach((rawSubject) => {
    const subject = String(rawSubject || "").trim();
    if (!subject || result[subject]) return;

    const paletteColor = BOOTSTRAP_SUBJECT_COLOR_PALETTE.find(
      (color) => !usedColors.has(color.toLowerCase())
    );
    const color = paletteColor || createOverflowColor(usedColors, overflowIndex++);
    result[subject] = color;
    usedColors.add(color.toLowerCase());
  });

  return result;
}

export function getSubjectColor(subject, colorMap = {}) {
  const raw = String(subject || "").trim();
  if (!raw) return "";
  const codeResolvedSubject = SUBJECT_CODE_LABELS[raw.toUpperCase()] || raw;
  const compactSubject = codeResolvedSubject.replace(/\s+/g, "");
  const resolvedSubject = SUBJECT_LABEL_ALIASES[compactSubject] || codeResolvedSubject;
  const merged = mergeSubjectColorMap(colorMap);
  return merged[resolvedSubject] || merged[codeResolvedSubject] || merged[compactSubject] || merged[raw] || "";
}

export function getSubjectContrastColor(color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) return "#ffffff";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance >= 160 ? "#202225" : "#ffffff";
}

export function getSubjectColorStyle(subject, colorMap = {}) {
  const color = getSubjectColor(subject, colorMap);
  if (!color) return "";
  const contrast = getSubjectContrastColor(color);
  return `--subject-color:${color};--subject-contrast:${contrast};`;
}
