// Public profiles keep their existing IDs. Private metadata uses the same ID.
export const PUBLIC_INSTRUCTOR_FIELDS = Object.freeze([
  "name", "subject", "subjects", "category", "bio", "brief", "photo", "videos",
  "curriculumImageUrl", "curriculumImageUrls", "instructorId", "order", "sortOrder",
  "createdAt", "updatedAt"
]);

export function publicInstructorData(data = {}) {
  return Object.fromEntries(PUBLIC_INSTRUCTOR_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
    .map((field) => [field, data[field]]));
}

export function privateInstructorData(data = {}) {
  return {
    uid: String(data.uid || "").trim(),
    email: String(data.email || "").trim(),
    emailLower: String(data.email || "").trim().toLowerCase(),
    phone: String(data.phone || "").trim(),
    note: String(data.note || "").trim(),
    pending: data.pending === true
  };
}

export function accountUidByInstructorId(accountDocs = []) {
  const byId = new Map();
  accountDocs.forEach((accountDoc) => {
    const instructorId = String(accountDoc.data()?.instructorId || "").trim();
    if (instructorId) byId.set(instructorId, accountDoc.id);
  });
  return byId;
}

function normalizedSubjects(data = {}) {
  const values = Array.isArray(data.subjects) && data.subjects.length
    ? data.subjects : [data.subject, data.category];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

// Keep the existing email-first, then name/subject matching order. Refuse an
// ambiguous identity before Auth creation instead of attaching the wrong ID.
export function selectInstructorProfileForAccount(profiles = [], user = {}) {
  const emailLower = String(user.emailLower || user.email || "").trim().toLowerCase();
  const name = String(user.name || "").trim();
  const selectedSubjects = new Set(normalizedSubjects(user));
  const matchesIdentity = (profile) => (
    String(profile.name || "").trim() === name &&
    normalizedSubjects(profile).some((subject) => selectedSubjects.has(subject))
  );
  const profileEmail = (profile) => String(profile.emailLower || profile.email || "").trim().toLowerCase();
  const hasAccount = (profile) => !!String(profile.uid || "").trim();
  const emailMatches = profiles.filter((profile) => emailLower && profileEmail(profile) === emailLower);
  if (emailMatches.some(hasAccount)) {
    throw new Error("이미 계정에 연결된 강사 프로필 이메일입니다.");
  }
  if (emailMatches.length > 1) {
    throw new Error("이메일이 같은 미연결 강사 프로필이 여러 개 있습니다. 강사 관리에서 먼저 정리해주세요.");
  }
  if (emailMatches.length === 1) {
    if (!matchesIdentity(emailMatches[0])) {
      throw new Error("이메일이 일치하는 강사 프로필의 이름 또는 과목이 다릅니다. 강사 정보를 확인해주세요.");
    }
    return emailMatches[0];
  }
  const nameMatches = profiles.filter((profile) => !hasAccount(profile) && matchesIdentity(profile));
  if (nameMatches.length > 1) {
    throw new Error("이름과 과목이 같은 미연결 강사 프로필이 여러 개 있습니다. 강사 관리에서 먼저 정리해주세요.");
  }
  if (nameMatches.length === 1) {
    if (profileEmail(nameMatches[0]) && profileEmail(nameMatches[0]) !== emailLower) {
      throw new Error("이름과 과목이 같은 강사 프로필의 이메일이 다릅니다. 강사 정보에서 이메일을 먼저 확인해주세요.");
    }
    return nameMatches[0];
  }
  return null;
}

export function mergeInstructorPrivate(profile = {}, privateData = null, account = {}) {
  const hasPrivate = privateData != null;
  const privateRecord = privateData || {};
  return {
    ...profile,
    uid: account.uid || (hasPrivate ? (privateRecord.uid || "") : (profile.uid || "")),
    email: account.email || (hasPrivate ? (privateRecord.email || "") : (profile.email || "")),
    emailLower: account.emailLower || (hasPrivate ? (privateRecord.emailLower || "") : (profile.emailLower || "")),
    phone: hasPrivate ? (privateRecord.phone || "") : (profile.phone || ""),
    note: hasPrivate ? (privateRecord.note || "") : (profile.note || ""),
    pending: account.uid ? false : (hasPrivate ? privateRecord.pending === true : profile.pending === true)
  };
}
