const HEADERS = ["이름", "과목", "이메일", "연락처", "내부 메모", "계정 연결", "온라인 강좌", "오프라인 반"];

function csvCell(value) {
  let text = String(value ?? "");
  // Spreadsheet programs interpret these prefixes as formulas even in CSV files.
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildInstructorAdminCsv(instructors = []) {
  const rows = instructors.map((instructor) => [
    instructor.name,
    Array.isArray(instructor.subjects) && instructor.subjects.length
      ? instructor.subjects.join(", ") : instructor.subject,
    instructor.email,
    instructor.phone,
    instructor.note,
    instructor.hasAccount ? "계정 연결됨" : "프로필만 등록됨",
    instructor.onlineCourseCount ?? 0,
    instructor.offlineClassCount ?? 0
  ]);
  return `\uFEFF${[HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
