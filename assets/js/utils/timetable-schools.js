export function normalizeSchoolList(values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const result = [];

  source.forEach((value) => {
    const school = String(value || "").trim();
    if (!school || seen.has(school)) return;
    seen.add(school);
    result.push(school);
  });

  return result;
}

function splitSchoolText(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  if (/[,，]/.test(text)) {
    return text.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  }
  return [text];
}

/** schools 배열 우선, 없으면 school 단일값 fallback */
export function getTimetableSchools(entry = {}) {
  if (Array.isArray(entry.schools) && entry.schools.length > 0) {
    return normalizeSchoolList(entry.schools);
  }
  return normalizeSchoolList(splitSchoolText(entry.school));
}

export function deriveSchoolsFromEntries(entries = []) {
  if (!Array.isArray(entries)) return [];
  return normalizeSchoolList(entries.flatMap((entry) => getTimetableSchools(entry)));
}

export function mergeSchoolLists(...lists) {
  return normalizeSchoolList(lists.flat());
}

export function formatTimetableSchoolsLabel(entry = {}, separator = " ") {
  return getTimetableSchools(entry).join(separator);
}

export function entryMatchesSchoolFilter(entry, schoolFilter) {
  const filter = String(schoolFilter || "").trim();
  if (!filter) return true;
  return getTimetableSchools(entry).some((school) => school === filter);
}

export function getSchoolSavePayload(selectedSchools, fallbackSchool = "") {
  const schools = normalizeSchoolList(selectedSchools);
  const school = schools[0] || String(fallbackSchool || "").trim();
  return {
    school,
    schools: schools.length ? schools : (school ? [school] : [])
  };
}
