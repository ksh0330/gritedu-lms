const ROSTER_ACCESS_TYPES = new Set(["memberOnly", "approvalRequired", "paid"]);

export function hasInstructorRoster(accessType) {
  return ROSTER_ACCESS_TYPES.has(accessType);
}

export function isActiveCourseEnrollment(enrollment) {
  return String(enrollment?.status || "active").trim() === "active";
}
