// 관리자 select/datalist용 순수 helper — Firestore settings 문서와 무관

import { escapeHtml } from "/assets/js/utils/html.js";

const CUSTOM_SUBJECT_VALUE = "__custom__";

export const DEFAULT_GRADE_LABELS = ["중1", "중2", "중3", "고1", "고2", "고3", "졸업/N수"];

const RESERVED_CATALOG_VALUE_KEYS = new Set([
  "all",
  "__all__",
  "__custom__",
  "전체",
  "전체 과목",
  "전체 학년",
  "전체 연도",
  "전체 학교",
  "전체 강의실",
  "전체 강사",
  "선택",
  "선택하세요",
  "과목 선택",
  "학년 선택",
  "연도 선택",
  "강사 선택",
  "오프라인 반 선택",
  "직접 입력",
  "목록에 없음",
  "기타 직접 입력"
]);

function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function reservedCatalogValueKey(value) {
  return asText(value)
    .replace(/^\+\s*/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isReservedCatalogValue(value) {
  const key = reservedCatalogValueKey(value);
  return Boolean(key && RESERVED_CATALOG_VALUE_KEYS.has(key));
}

function listItemToText(item) {
  if (isObj(item)) {
    return asText(item.label || item.value || item.key || item.name || item.title);
  }
  return asText(item);
}

export function normalizeList(values, options = {}) {
  return normalizeListValues(values, options);
}

export function normalizeListValues(values, options = {}) {
  const { allowDuplicates = false } = options;
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  values.forEach((item) => {
    const text = listItemToText(item);
    if (!text) return;
    if (!allowDuplicates && seen.has(text)) return;
    if (!allowDuplicates) seen.add(text);
    result.push(text);
  });
  return result;
}

export function normalizeCatalogList(values, options = {}) {
  return normalizeListValues(values, options).filter((value) => !isReservedCatalogValue(value));
}

export function normalizeGradeLabel(label) {
  const text = asText(label);
  if (text === "졸업" || text === "N수") return "졸업/N수";
  return text;
}

export function gradeLabelsMatch(a, b) {
  return normalizeGradeLabel(a) === normalizeGradeLabel(b);
}

/** 저장된 학년 목록에 기본 7개 학년이 누락되지 않게 병합 */
export function mergeGradeLabelsWithDefaults(storedGrades) {
  const result = DEFAULT_GRADE_LABELS.slice();
  const seen = new Set(result);

  normalizeCatalogList(storedGrades).forEach((grade) => {
    const normalized = normalizeGradeLabel(grade);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

export function withStringListFallback(values, selectedValue) {
  const selected = String(selectedValue || "").trim();
  const list = Array.isArray(values) ? values.slice() : [];
  if (!selected || list.includes(selected)) return list;
  return [...list, selected];
}

export function getCustomSubjectValue() {
  return CUSTOM_SUBJECT_VALUE;
}

export function buildSubjectSelectHtml(subjects, options = {}) {
  const {
    selected = "",
    emptyLabel = "선택하세요",
    includeEmpty = true,
    allowCustom = true,
    emptyValue = ""
  } = options;

  const normalizedSelected = String(selected || "").trim();
  const known = withStringListFallback(normalizeList(subjects), normalizedSelected);
  const isCustomSelected = normalizedSelected && !known.includes(normalizedSelected);

  const parts = [];
  if (includeEmpty) {
    parts.push(`<option value="${escapeHtml(emptyValue)}">${escapeHtml(emptyLabel)}</option>`);
  }

  known.forEach((subject) => {
    const isSelected = subject === normalizedSelected;
    parts.push(
      `<option value="${escapeHtml(subject)}"${isSelected ? " selected" : ""}>${escapeHtml(subject)}</option>`
    );
  });

  if (allowCustom) {
    parts.push(
      `<option value="${CUSTOM_SUBJECT_VALUE}"${isCustomSelected ? " selected" : ""}>+ 직접 입력</option>`
    );
  }

  return parts.join("");
}

export function buildGradeSelectHtml(grades, options = {}) {
  const {
    selected = "",
    emptyLabel = "선택",
    includeEmpty = true,
    allowCustom = false,
    emptyValue = ""
  } = options;

  const normalizedSelected = normalizeGradeLabel(String(selected || "").trim());
  const known = [...new Set(
    withStringListFallback(normalizeList(grades), normalizedSelected).map(normalizeGradeLabel)
  )];
  const isCustomSelected = normalizedSelected && !known.includes(normalizedSelected);

  const parts = [];
  if (includeEmpty) {
    parts.push(`<option value="${escapeHtml(emptyValue)}">${escapeHtml(emptyLabel)}</option>`);
  }

  known.forEach((grade) => {
    const isSelected = gradeLabelsMatch(grade, normalizedSelected);
    parts.push(
      `<option value="${escapeHtml(grade)}"${isSelected ? " selected" : ""}>${escapeHtml(grade)}</option>`
    );
  });

  if (allowCustom) {
    parts.push(
      `<option value="__custom__"${isCustomSelected ? " selected" : ""}>+ 직접 입력</option>`
    );
  }

  return parts.join("");
}

const COURSE_SUBJECT_CUSTOM_VALUE = "__custom__";

export function getCourseSubjectCustomValue() {
  return COURSE_SUBJECT_CUSTOM_VALUE;
}

export function buildCourseSubjectSelectHtml(courseSubjects, options = {}) {
  const {
    selected = "",
    emptyLabel = "과목 선택",
    includeEmpty = true,
    allowCustom = true
  } = options;

  const normalizedSelected = String(selected || "").trim();
  const items = withCourseSubjectFallback(courseSubjects, normalizedSelected);
  const knownCodes = items
    .map((item) => String(item?.value || "").trim())
    .filter((value) => value && !isReservedCatalogValue(value));
  const isCustomSelected = normalizedSelected && !knownCodes.includes(normalizedSelected);

  const parts = [];
  if (includeEmpty) {
    parts.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
  }

  items.forEach((item) => {
    const value = String(item?.value || "").trim();
    const label = String(item?.label || value).trim();
    if (!value || isReservedCatalogValue(value) || isReservedCatalogValue(label)) return;
    const isSelected = !isCustomSelected && value === normalizedSelected;
    parts.push(
      `<option value="${escapeHtml(value)}"${isSelected ? " selected" : ""}>${escapeHtml(label)}</option>`
    );
  });

  if (allowCustom) {
    parts.push(
      `<option value="${COURSE_SUBJECT_CUSTOM_VALUE}"${isCustomSelected ? " selected" : ""}>직접 입력</option>`
    );
  }

  return parts.join("");
}

export function syncCourseSubjectCustomField(quickEl, inputEl) {
  if (!quickEl || !inputEl) return;
  const showCustom = String(quickEl.value || "").trim() === COURSE_SUBJECT_CUSTOM_VALUE;
  inputEl.hidden = !showCustom;
  inputEl.required = showCustom;
  if (!showCustom && String(quickEl.value || "").trim() !== COURSE_SUBJECT_CUSTOM_VALUE) {
    inputEl.value = String(quickEl.value || "").trim();
  }
}

export function resolveCourseSubjectFromControls(quickEl, inputEl, subjectOptions = []) {
  const quickValue = String(quickEl?.value || "").trim();
  if (!quickValue) return "";
  if (quickValue === COURSE_SUBJECT_CUSTOM_VALUE) {
    return String(inputEl?.value || "").trim();
  }
  const known = (subjectOptions || [])
    .map((item) => String(item?.value || "").trim())
    .filter(Boolean);
  if (known.includes(quickValue)) return quickValue;
  return quickValue;
}

export function applyCourseSubjectSelectValue(quickEl, inputEl, value, subjectOptions = []) {
  if (!quickEl) return;

  const normalized = String(value || "").trim();
  const items = withCourseSubjectFallback(subjectOptions, normalized);
  const knownCodes = items
    .map((item) => String(item?.value || "").trim())
    .filter((code) => code && !isReservedCatalogValue(code));

  if (!normalized) {
    quickEl.value = "";
    if (inputEl) {
      inputEl.value = "";
      inputEl.hidden = true;
    }
    syncCourseSubjectCustomField(quickEl, inputEl);
    return;
  }

  if (knownCodes.includes(normalized)) {
    quickEl.value = normalized;
    if (inputEl) {
      inputEl.value = normalized;
      inputEl.hidden = true;
    }
  } else {
    quickEl.value = COURSE_SUBJECT_CUSTOM_VALUE;
    if (inputEl) {
      inputEl.value = normalized;
      inputEl.hidden = false;
    }
  }

  syncCourseSubjectCustomField(quickEl, inputEl);
}

export function withCourseSubjectFallback(options, selectedValue) {
  const selected = String(selectedValue || "").trim();
  const list = Array.isArray(options) ? options.slice() : [];
  if (!selected || list.some((opt) => String(opt?.value || "") === selected)) return list;
  return [...list, { value: selected, label: selected }];
}

export function syncSubjectCustomField(selectEl, customEl, subjects = []) {
  if (!selectEl || !customEl) return;

  const selected = String(selectEl.value || "").trim();
  const known = normalizeList(subjects);
  const showCustom = selected === CUSTOM_SUBJECT_VALUE;

  customEl.hidden = !showCustom;
  customEl.required = showCustom;

  if (showCustom && !String(customEl.value || "").trim()) {
    customEl.placeholder = "과목명을 입력하세요";
  }

  if (!showCustom && known.includes(selected)) {
    customEl.value = "";
  }
}

export function resolveSubjectFromControls(selectEl, customEl, subjects = []) {
  const selected = String(selectEl?.value || "").trim();
  if (!selected) return "";

  if (selected === CUSTOM_SUBJECT_VALUE) {
    return String(customEl?.value || "").trim();
  }

  const known = normalizeList(subjects);
  if (known.includes(selected)) return selected;
  return selected;
}

export function applySubjectSelectValue(selectEl, customEl, value, subjects = []) {
  if (!selectEl) return;

  const normalized = String(value || "").trim();
  const known = normalizeList(subjects);

  if (!normalized) {
    selectEl.value = "";
    if (customEl) customEl.value = "";
    syncSubjectCustomField(selectEl, customEl, subjects);
    return;
  }

  if (known.includes(normalized)) {
    selectEl.value = normalized;
    if (customEl) customEl.value = "";
  } else {
    selectEl.value = CUSTOM_SUBJECT_VALUE;
    if (customEl) customEl.value = normalized;
  }

  syncSubjectCustomField(selectEl, customEl, subjects);
}

export function sortCatalogLabels(list) {
  return normalizeList(list).slice().sort((a, b) => a.localeCompare(b, "ko"));
}

export function addUniqueCatalogItem(list, rawValue, options = {}) {
  const { sort = false } = options;
  const value = asText(rawValue);
  if (!value) return { ok: false, message: "값을 입력해주세요." };
  if (isReservedCatalogValue(value)) {
    return { ok: false, message: "전체, 선택, 직접 입력은 기준값으로 저장할 수 없습니다." };
  }
  const current = normalizeList(list);
  if (current.includes(value)) return { ok: false, message: "이미 등록된 값입니다." };
  const next = [...current, value];
  return { ok: true, list: sort ? sortCatalogLabels(next) : next };
}

export function removeCatalogItem(list, value, options = {}) {
  const { minItems = 0, label = "항목" } = options;
  const target = asText(value);
  const current = normalizeList(list);
  const next = current.filter((item) => item !== target);
  if (next.length < minItems) {
    return { ok: false, message: `${label}은(는) 최소 ${minItems}개 이상 유지해야 합니다.` };
  }
  return { ok: true, list: next };
}

export function renameCatalogItem(list, oldValue, rawNewValue, options = {}) {
  const { sort = false } = options;
  const from = asText(oldValue);
  const to = asText(rawNewValue);
  if (!to) return { ok: false, message: "값을 입력해주세요." };
  if (isReservedCatalogValue(to)) {
    return { ok: false, message: "전체, 선택, 직접 입력은 기준값으로 저장할 수 없습니다." };
  }
  const current = normalizeList(list);
  if (!current.includes(from)) return { ok: false, message: "항목을 찾을 수 없습니다." };
  if (from !== to && current.includes(to)) return { ok: false, message: "이미 등록된 값입니다." };
  const next = current.map((item) => (item === from ? to : item));
  return { ok: true, list: sort ? sortCatalogLabels(next) : next };
}

export function moveCatalogItem(list, value, direction) {
  const target = asText(value);
  const current = normalizeList(list);
  const index = current.indexOf(target);
  if (index < 0) return { ok: false, message: "항목을 찾을 수 없습니다." };
  const offset = direction === "up" ? -1 : 1;
  const nextIndex = index + offset;
  if (nextIndex < 0) return { ok: false, message: "이미 맨 위입니다." };
  if (nextIndex >= current.length) return { ok: false, message: "이미 맨 아래입니다." };
  const next = current.slice();
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return { ok: true, list: next };
}

const GRADE_CUSTOM_VALUE = "__custom__";

export function resolveGradeFromControls(selectEl, customEl, grades = []) {
  const selected = String(selectEl?.value || "").trim();
  if (!selected) return "";
  if (selected === GRADE_CUSTOM_VALUE) {
    return String(customEl?.value || "").trim();
  }
  const known = normalizeList(grades);
  if (known.includes(selected)) return selected;
  return selected;
}

export function applyGradeSelectValue(selectEl, customEl, value, grades = []) {
  if (!selectEl) return;

  const normalized = normalizeGradeLabel(String(value || "").trim());
  const known = normalizeList(grades).map(normalizeGradeLabel);

  if (!normalized) {
    selectEl.value = "";
    if (customEl) {
      customEl.value = "";
      customEl.hidden = true;
    }
    return;
  }

  if (known.includes(normalized)) {
    selectEl.value = normalized;
    if (customEl) {
      customEl.value = "";
      customEl.hidden = true;
    }
    return;
  }

  selectEl.value = GRADE_CUSTOM_VALUE;
  if (customEl) {
    customEl.value = normalized;
    customEl.hidden = false;
  }
}

export function syncGradeCustomField(selectEl, customEl) {
  if (!selectEl || !customEl) return;
  const showCustom = String(selectEl.value || "").trim() === GRADE_CUSTOM_VALUE;
  customEl.hidden = !showCustom;
  customEl.required = showCustom;
  if (!showCustom) customEl.value = "";
}

export function renderStringCatalogTagsHtml(values, field, escapeHtmlFn) {
  const list = normalizeCatalogList(values);
  if (!list.length) {
    return '<span class="admin-catalog-tags-empty muted">등록된 값이 없습니다.</span>';
  }
  return list
    .map(
      (value, index) => `
    <span class="admin-catalog-tag">
      <span class="admin-catalog-tag__moves">
        <button type="button" class="admin-catalog-tag__move" data-catalog-move="up" data-catalog-field="${escapeHtmlFn(field)}" data-catalog-value="${escapeHtmlFn(value)}"${index === 0 ? " disabled" : ""} aria-label="${escapeHtmlFn(value)} 위로" title="위로">↑</button>
        <button type="button" class="admin-catalog-tag__move" data-catalog-move="down" data-catalog-field="${escapeHtmlFn(field)}" data-catalog-value="${escapeHtmlFn(value)}"${index === list.length - 1 ? " disabled" : ""} aria-label="${escapeHtmlFn(value)} 아래로" title="아래로">↓</button>
      </span>
      <input class="admin-catalog-tag__input" data-catalog-inline-input data-catalog-field="${escapeHtmlFn(field)}" data-catalog-value="${escapeHtmlFn(value)}" value="${escapeHtmlFn(value)}" aria-label="${escapeHtmlFn(value)} 이름">
      <button type="button" class="admin-catalog-tag__remove" data-catalog-field="${escapeHtmlFn(field)}" data-catalog-value="${escapeHtmlFn(value)}" aria-label="${escapeHtmlFn(value)} 삭제" title="삭제">&times;</button>
    </span>`
    )
    .join("");
}
