import { normalizeCatalogList } from "/assets/js/utils/catalog-select-helpers.js";

export function normalizeSubjectList(values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const result = [];

  source.forEach((value) => {
    const subject = String(value || "").trim();
    if (!subject || seen.has(subject)) return;
    seen.add(subject);
    result.push(subject);
  });

  return result;
}

/** subjects 배열 우선, 없으면 subject/category 단일값 fallback */
export function getInstructorSubjects(instructor = {}) {
  if (Array.isArray(instructor.subjects) && instructor.subjects.length > 0) {
    return normalizeSubjectList(instructor.subjects);
  }
  return normalizeSubjectList([instructor.subject, instructor.category]);
}

export function instructorMatchesSubject(instructor, subject) {
  const activeSubject = String(subject || "").trim();
  if (!activeSubject || activeSubject === "all") return true;
  return getInstructorSubjects(instructor).includes(activeSubject);
}

/** 필터 맥락: 전체는 전 과목, 과목별 필터는 해당 과목만 */
export function getInstructorSubjectDisplayList(instructor = {}, activeSubject = "all") {
  const subjects = getInstructorSubjects(instructor);
  const filter = String(activeSubject || "").trim();
  if (!filter || filter === "all") return subjects;
  return subjects.includes(filter) ? [filter] : subjects;
}

export function formatInstructorSubjectsLabel(instructor = {}, options = {}) {
  const { activeSubject = "all", separator = " | " } = options;
  return getInstructorSubjectDisplayList(instructor, activeSubject).join(separator);
}

export function renderInstructorSubjectBadgesHtml(instructor, activeSubject, escapeHtml) {
  const subjects = getInstructorSubjectDisplayList(instructor, activeSubject);
  if (!subjects.length) return "";

  const renderBadge = (subject) =>
    `<span class="inst-subject-badge" data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</span>`;

  if (subjects.length === 1) return renderBadge(subjects[0]);

  const parts = subjects.map((subject, index) => {
    const badge = renderBadge(subject);
    return index === 0
      ? badge
      : `<span class="inst-subject-badge-sep" aria-hidden="true">|</span>${badge}`;
  });

  return `<div class="inst-subject-badges">${parts.join("")}</div>`;
}

export const DEFAULT_INSTRUCTOR_MENU_SUBJECTS = [
  "국어",
  "영어",
  "수학",
  "과학",
  "수리논술",
  "컨설팅"
];

/** settings/instructorsMenu.subjects (또는 subjectOptions) 로드 */
export async function loadInstructorMenuSubjects(getSettingDoc) {
  try {
    const result = await getSettingDoc("instructorsMenu");
    if (!result.exists || !result.data) {
      return DEFAULT_INSTRUCTOR_MENU_SUBJECTS.slice();
    }

    const data = result.data;
    const raw = Array.isArray(data.subjects)
      ? data.subjects
      : (Array.isArray(data.subjectOptions) ? data.subjectOptions : []);
    const subjects = normalizeCatalogList(raw);
    return subjects.length ? subjects : DEFAULT_INSTRUCTOR_MENU_SUBJECTS.slice();
  } catch (error) {
    console.warn("[instructor-subjects] instructorsMenu load failed, using defaults", error);
    return DEFAULT_INSTRUCTOR_MENU_SUBJECTS.slice();
  }
}

export function cloneInstructorMenuSubjects(subjects) {
  return normalizeCatalogList(subjects);
}

export function buildInstructorMenuSubjectsPayload(subjects) {
  const list = normalizeCatalogList(subjects);
  return {
    subjects: list,
    subjectOptions: list
  };
}
