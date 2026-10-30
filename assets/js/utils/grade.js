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

export function getAutomaticGradePromotion({
  grade,
  createdYear,
  lastPromotionYear,
  currentYear,
} = {}) {
  const normalizedGrade = normalizeGrade(grade);
  const gradeNumber = Number.parseInt(normalizedGrade, 10);
  const accountCreatedYear = Number.parseInt(createdYear, 10);
  const recordedPromotionYear = Number.parseInt(lastPromotionYear, 10);
  const targetYear = Number.parseInt(currentYear, 10);

  const canTrackPromotion =
    Number.isInteger(targetYear) &&
    gradeNumber >= 1 &&
    gradeNumber < 7;

  if (!canTrackPromotion) {
    return { shouldPromote: false, grade: normalizedGrade };
  }

  if (!Number.isInteger(recordedPromotionYear)) {
    return {
      shouldPromote: false,
      shouldInitialize: true,
      grade: normalizedGrade,
      promotionYear: targetYear,
    };
  }

  const canPromote =
    Number.isInteger(accountCreatedYear) &&
    accountCreatedYear < targetYear &&
    recordedPromotionYear < targetYear;

  if (!canPromote) {
    return { shouldPromote: false, grade: normalizedGrade };
  }

  return {
    shouldPromote: true,
    grade: String(gradeNumber + 1),
    promotionYear: targetYear,
  };
}
