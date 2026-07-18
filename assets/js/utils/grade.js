export const GRADE_OPTIONS = [
  { value: "1", label: "중1" },
  { value: "2", label: "중2" },
  { value: "3", label: "중3" },
  { value: "4", label: "고1" },
  { value: "5", label: "고2" },
  { value: "6", label: "고3" },
  { value: "7", label: "졸업/N수" }
];

const GRADE_LABEL_TO_CODE = GRADE_OPTIONS.reduce((map, option) => {
  map[option.label] = option.value;
  return map;
}, {});

const GRADE_CODE_TO_LABEL = GRADE_OPTIONS.reduce((map, option) => {
  map[option.value] = option.label;
  return map;
}, {});

export function normalizeGrade(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(GRADE_CODE_TO_LABEL, raw)) return raw;
  return GRADE_LABEL_TO_CODE[raw] || "";
}

export function formatGrade(value) {
  const code = normalizeGrade(value);
  return code ? GRADE_CODE_TO_LABEL[code] : "-";
}
