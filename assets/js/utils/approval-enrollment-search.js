export const MANUAL_ENROLLMENT_SEARCH_LIMIT = 20;

export function classifyEnrollmentSearch(raw) {
  const value = String(raw || "").trim();
  if (value.includes("@")) return value.length >= 3 ? { field: "email", value } : null;
  return value.length >= 2 ? { field: "name", value } : null;
}

export function toEnrollmentCandidates(studentDocs, memberDocs) {
  const candidates = [
    ...studentDocs.map(({ id, data }) => ({ ...data, id, type: "student" })),
    ...memberDocs.map(({ id, data }) => ({ ...data, id, type: "member" }))
  ];
  return candidates.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "ko") ||
    String(a.email || "").localeCompare(String(b.email || ""), "ko") ||
    a.id.localeCompare(b.id));
}

export function getSelectedEnrollmentCandidate(candidates, type, id) {
  if (!id || !["student", "member"].includes(type)) return null;
  const selected = candidates.find((candidate) => candidate.id === id && candidate.type === type);
  if (!selected || (selected.type === "member" && selected.memberPurpose !== "general")) return null;
  return selected;
}
