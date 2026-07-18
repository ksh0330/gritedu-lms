import { auth, db } from "/assets/js/firebase-init.js";
import { getDoc, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getSettingDoc } from "/assets/js/utils/settings-cache.js";
import { createCourseLabelMaps } from "/assets/js/utils/course-readonly.js";
import { loadStudentProfile } from "/assets/js/utils/student-profile.js";
import { dom, state } from "/assets/js/pages/student-dashboard/context.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";

export { loadStudentProfile as loadStudentProfileCanonicalFirst };

function isEmailLike(value) {
  return String(value || "").trim().includes("@");
}

/** Firestore 학생 이름 우선, 이메일/계정 표시명은 보조 */
export async function resolveStudentDisplayName(uid, authUser = null) {
  try {
    const profile = await loadStudentProfile(uid);
    const name = String(profile?.name || "").trim();
    if (name) return name;
  } catch (error) {
    console.warn("[student-dashboard] 학생 이름 조회 실패:", error);
  }

  const authDisplayName = String(authUser?.displayName || "").trim();
  if (authDisplayName && !isEmailLike(authDisplayName)) return authDisplayName;

  return "";
}

export async function loadCourseReadOnlyContext() {
  try {
    const [catalogResult, coursesMenuResult] = await Promise.all([
      getSettingDoc("courseCatalog"),
      getSettingDoc("coursesMenu")
    ]);
    state.courseLabelMaps = createCourseLabelMaps(catalogResult.exists ? catalogResult.data : {});
    const hiddenList = coursesMenuResult.exists ? coursesMenuResult.data?.hidden : [];
    state.hiddenCourseIds = new Set(Array.isArray(hiddenList) ? hiddenList : []);
    state.instructorsByUid = {};
  } catch (error) {
    console.warn("[student-dashboard] failed to load course context", error);
    state.courseLabelMaps = createCourseLabelMaps({});
    state.hiddenCourseIds = new Set();
    state.instructorsByUid = {};
  }
}

export async function setWelcomeMessage() {
  if (!dom.welcomeMsg) return;
  let currentUser = state.user;
  if (!currentUser?.uid) {
    if (!auth.currentUser) return;
    currentUser = auth.currentUser;
  }

  const displayName = await resolveStudentDisplayName(currentUser.uid, currentUser);
  const label = displayName || "회원";

  if (displayName) {
    const messages = [`${label}님, 환영합니다.`, `${label}님, 오늘도 화이팅입니다.`];
    dom.welcomeMsg.textContent = messages[Math.floor(Math.random() * messages.length)];
    return;
  }
  dom.welcomeMsg.textContent = `${label}님, 환영합니다.`;
}

export async function updateGradeIfNeeded() {
  if (!state.user?.uid) return;
  try {
    const studentDoc = await getDoc(doc(db, "students", state.user.uid));
    if (!studentDoc.exists()) return;

    const studentData = studentDoc.data();
    if (studentData.gradeManualOverride === true) return;

    const currentGrade = normalizeGrade(studentData.grade);
    if (!currentGrade) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    if (currentMonth < 0 || (currentMonth === 0 && currentDay < 1)) return;

    const createdAt = studentData.createdAt;
    let createdDate = null;
    if (createdAt?.toDate) createdDate = createdAt.toDate();
    else if (createdAt instanceof Date) createdDate = createdAt;
    else if (createdAt?.seconds) createdDate = new Date(createdAt.seconds * 1000);
    if (!createdDate) return;

    const thisYearJan1 = new Date(currentYear, 0, 1);
    const createdDateObj = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
    if (createdDateObj >= thisYearJan1) return;

    const gradeNumber = parseInt(currentGrade, 10);
    const newGrade = gradeNumber >= 1 && gradeNumber < 7 ? String(gradeNumber + 1) : "";
    if (!newGrade || newGrade === currentGrade) return;

    const updateData = { grade: newGrade, updatedAt: serverTimestamp() };

    await updateDoc(doc(db, "students", state.user.uid), updateData);
  } catch (error) {
    console.error("학년 업데이트 실패:", error);
  }
}
