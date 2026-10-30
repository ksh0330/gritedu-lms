export function canRequestApprovalCourse(role, memberPurpose) {
  return role === "student" || (role === "member" && memberPurpose === "general");
}

export function filterApprovalRequests(rows, search) {
  const term = String(search || "").trim().toLocaleLowerCase();
  if (!term) return rows;
  return rows.filter((row) => [row.userId, row.profile?.name, row.profile?.email]
    .some((value) => String(value || "").toLocaleLowerCase().includes(term)));
}

export function toApprovalPublicCourse(payload) {
  const publicFields = { ...payload };
  for (const field of ["lectureContent", "learningContent", "videoUrl", "curriculumWeeks", "previewUrl"]) delete publicFields[field];
  return {
    ...publicFields,
    weeks: [],
    previewVideoUrl: null
  };
}
