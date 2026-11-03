// 강의 목록 페이지 라벨/과목 칩 기본값 — settings/courseCatalog 와 병합

import { isReservedCatalogValue } from "/assets/js/utils/catalog-select-helpers.js";

export const DEFAULT_COURSE_CATALOG = {
  chipGroups: [
    {
      key: "grade",
      label: "학년",
      options: [
        { value: "G1", label: "1학년" },
        { value: "G2", label: "2학년" },
        { value: "G3", label: "3학년" }
      ]
    },
    {
      key: "subject",
      label: "과목",
      options: [
        { value: "KOR", label: "국어" },
        { value: "MATH", label: "수학" },
        { value: "ENG", label: "영어" },
        { value: "SCI", label: "과학" },
        { value: "ESSAY", label: "수리논술" },
        { value: "ETC", label: "기타" }
      ]
    },
    {
      key: "year",
      label: "연도",
      options: [
        { value: "2026", label: "2026" },
        { value: "2025", label: "2025" }
      ]
    }
  ]
};

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function normalizeCatalogOption(opt) {
  if (!opt || opt.value === undefined || opt.value === null) return null;
  const value = String(opt.value).trim();
  const label = String(typeof opt.label === "string" ? opt.label : opt.value).trim();
  if (!value || !label) return null;
  if (isReservedCatalogValue(value) || isReservedCatalogValue(label)) return null;
  return { value, label };
}

function normalizeCatalogOptions(options) {
  const seen = new Set();
  const result = [];
  (options || []).forEach((opt) => {
    const normalized = normalizeCatalogOption(opt);
    if (!normalized || seen.has(normalized.value)) return;
    seen.add(normalized.value);
    result.push(normalized);
  });
  return result;
}

export function mergeCourseCatalog(stored) {
  const base = JSON.parse(JSON.stringify(DEFAULT_COURSE_CATALOG));
  if (!isObj(stored)) return base;

  if (Array.isArray(stored.chipGroups) && stored.chipGroups.length > 0) {
    base.chipGroups = stored.chipGroups
      .filter((g) => g && typeof g.key === "string" && Array.isArray(g.options))
      .map((g) => ({
        key: g.key,
        label: typeof g.label === "string" ? g.label : g.key,
        options: normalizeCatalogOptions(g.options)
      }));
  }
  return base;
}

/** chipGroups에서 key별 value→label 맵 (카드 칩 표시용) */
export function buildLabelMaps(catalog) {
  const maps = {};
  for (const g of catalog.chipGroups || []) {
    maps[g.key] = {};
    for (const o of g.options || []) {
      maps[g.key][o.value] = o.label;
    }
  }
  return maps;
}

export const DEFAULT_COURSE_GRADE_LABELS = ["중1", "중2", "중3", "고1", "고2", "고3", "졸업/N수"];

export const DEFAULT_COURSE_YEAR_LABELS = ["2026", "2025"];

/** courseCatalog.chipGroups.subject → { value, label }[] (all 제외) */
export function getCourseSubjectOptions(catalog) {
  const subjectGroup = (catalog?.chipGroups || []).find((group) => group.key === "subject");
  const options = (subjectGroup?.options || [])
    .map(normalizeCatalogOption)
    .filter(Boolean);

  if (options.length) return options;

  const fallbackGroup = (DEFAULT_COURSE_CATALOG.chipGroups || []).find((group) => group.key === "subject");
  return (fallbackGroup?.options || [])
    .map(normalizeCatalogOption)
    .filter(Boolean);
}

/** courseCatalog.chipGroups.grade → 표시용 학년 문자열[] (all 제외) */
export function getCourseGradeLabels(catalog) {
  const gradeGroup = (catalog?.chipGroups || []).find((group) => group.key === "grade");
  const labels = (gradeGroup?.options || [])
    .filter((opt) => opt && !isReservedCatalogValue(opt.value) && !isReservedCatalogValue(opt.label))
    .map((opt) => String(opt.label || opt.value).trim())
    .filter(Boolean);

  return labels.length ? labels : DEFAULT_COURSE_GRADE_LABELS.slice();
}

/** courseCatalog.chipGroups.year → 표시용 연도 문자열[] (all 제외) */
export function getCourseYearLabels(catalog) {
  const yearGroup = (catalog?.chipGroups || []).find((group) => group.key === "year");
  const labels = (yearGroup?.options || [])
    .filter((opt) => opt && !isReservedCatalogValue(opt.value) && !isReservedCatalogValue(opt.label))
    .map((opt) => String(opt.label || opt.value).trim())
    .filter(Boolean);

  return labels.length ? labels : DEFAULT_COURSE_YEAR_LABELS.slice();
}

/** courseCatalog.chipGroups.year → { value, label }[] (all 제외) */
export function getCourseYearOptions(catalog) {
  const yearGroup = (catalog?.chipGroups || []).find((group) => group.key === "year");
  const options = (yearGroup?.options || [])
    .map(normalizeCatalogOption)
    .filter(Boolean);

  if (options.length) return options;

  return DEFAULT_COURSE_YEAR_LABELS.map((label) => ({ value: label, label }));
}

export const PROTECTED_COURSE_SUBJECT_CODES = new Set();

const COURSE_SUBJECT_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

export function validateCourseSubjectCode(code) {
  return COURSE_SUBJECT_CODE_RE.test(String(code || "").trim());
}

export function generateNextCustomSubjectCode(existingCodes = []) {
  const used = new Set(
    (existingCodes || [])
      .map((code) => String(code || "").trim().toUpperCase())
      .filter(Boolean)
  );
  let index = 1;
  while (index < 1000) {
    const candidate = `CUSTOM_${String(index).padStart(3, "0")}`;
    if (!used.has(candidate)) return candidate;
    index += 1;
  }
  return `CUSTOM_${Date.now()}`;
}

export function cloneCourseCatalogState(catalog) {
  return mergeCourseCatalog(catalog || {});
}

export function buildChipGroupWithAll(options, allLabel = "전체") {
  return [{ value: "all", label: allLabel }, ...buildChipGroupOptions(options)];
}

export function buildChipGroupOptions(options) {
  return normalizeCatalogOptions(options);
}

export function getCourseCatalogSubjectDraft(catalog) {
  return getCourseSubjectOptions(catalog).map((opt) => ({ ...opt }));
}

export function getCourseCatalogGradeDraft(catalog) {
  const gradeGroup = (catalog?.chipGroups || []).find((group) => group.key === "grade");
  const options = (gradeGroup?.options || [])
    .filter((opt) => opt && !isReservedCatalogValue(opt.value) && !isReservedCatalogValue(opt.label))
    .map((opt) => ({
      value: String(opt.label || opt.value).trim(),
      label: String(opt.label || opt.value).trim()
    }))
    .filter((opt) => opt.value);
  if (options.length) return options;
  return DEFAULT_COURSE_GRADE_LABELS.map((label) => ({ value: label, label }));
}

export function getCourseCatalogYearDraft(catalog) {
  const yearGroup = (catalog?.chipGroups || []).find((group) => group.key === "year");
  const options = (yearGroup?.options || [])
    .filter((opt) => opt && !isReservedCatalogValue(opt.value) && !isReservedCatalogValue(opt.label))
    .map((opt) => ({
      value: String(opt.label || opt.value).trim(),
      label: String(opt.label || opt.value).trim()
    }))
    .filter((opt) => opt.value);
  if (options.length) return options;
  return DEFAULT_COURSE_YEAR_LABELS.map((label) => ({ value: label, label }));
}

export function applyCourseCatalogDraft(catalog, subjectOptions, gradeOptions, yearOptions) {
  const next = cloneCourseCatalogState(catalog);
  const subjectGroup = (next.chipGroups || []).find((group) => group.key === "subject") || {
    key: "subject",
    label: "과목",
    options: []
  };
  const gradeGroup = (next.chipGroups || []).find((group) => group.key === "grade") || {
    key: "grade",
    label: "학년",
    options: []
  };
  const yearGroup = (next.chipGroups || []).find((group) => group.key === "year") || {
    key: "year",
    label: "연도",
    options: []
  };
  subjectGroup.options = buildChipGroupOptions(subjectOptions);
  gradeGroup.options = buildChipGroupOptions(
    gradeOptions.map((opt) => ({
      value: String(opt.value || opt.label).trim(),
      label: String(opt.label || opt.value).trim()
    }))
  );
  yearGroup.options = buildChipGroupOptions(
    (yearOptions || []).map((opt) => ({
      value: String(opt.value || opt.label).trim(),
      label: String(opt.label || opt.value).trim()
    }))
  );
  const others = (next.chipGroups || []).filter(
    (group) => group.key !== "subject" && group.key !== "grade" && group.key !== "year"
  );
  next.chipGroups = [...others, subjectGroup, gradeGroup, yearGroup];
  return next;
}
