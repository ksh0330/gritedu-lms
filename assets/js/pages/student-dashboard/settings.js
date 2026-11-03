import { auth, db } from "/assets/js/firebase-init.js";
import { doc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getSettingDoc } from "/assets/js/utils/settings-cache.js";
import { createCourseLabelMaps } from "/assets/js/utils/course-readonly.js";
import { loadStudentProfile } from "/assets/js/utils/student-profile.js?v=20260913-grade-tracking";
import { dom, state } from "/assets/js/pages/student-dashboard/context.js";
import { getAutomaticGradePromotion } from "/assets/js/utils/grade.js?v=20260913-grade-tracking";
import {
  getSubjectColorMapFromSettings,
  mergeSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";

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
    const [catalogResult, coursesMenuResult, instructorsMenuResult, subjectColorsResult] = await Promise.all([
      getSettingDoc("courseCatalog"),
      getSettingDoc("coursesMenu"),
      getSettingDoc("instructorsMenu"),
      getSettingDoc("subjectColors")
    ]);
    state.courseLabelMaps = createCourseLabelMaps(catalogResult.exists ? catalogResult.data : {});
    const hiddenList = coursesMenuResult.exists ? coursesMenuResult.data?.hidden : [];
    state.hiddenCourseIds = new Set(Array.isArray(hiddenList) ? hiddenList : []);
    state.instructorsByUid = {};
    state.subjectColorMap = mergeSubjectColorMap({
      ...getSubjectColorMapFromSettings(instructorsMenuResult.exists ? instructorsMenuResult.data : {}),
      ...getSubjectColorMapFromSettings(subjectColorsResult.exists ? subjectColorsResult.data : {}),
    });
  } catch (error) {
    console.warn("[student-dashboard] failed to load course context", error);
    state.courseLabelMaps = createCourseLabelMaps({});
    state.hiddenCourseIds = new Set();
    state.instructorsByUid = {};
    state.subjectColorMap = mergeSubjectColorMap({});
  }
}

export async function setWelcomeMessage(studentProfile = undefined) {
  if (!dom.welcomeMsg) return;
  let currentUser = state.user;
  if (!currentUser?.uid) {
    if (!auth.currentUser) return;
    currentUser = auth.currentUser;
  }

  let displayName = "";
  if (studentProfile !== undefined) {
    displayName = String(studentProfile?.name || "").trim();
    const authDisplayName = String(currentUser.displayName || "").trim();
    if (!displayName && authDisplayName && !isEmailLike(authDisplayName)) {
      displayName = authDisplayName;
    }
  } else {
    displayName = await resolveStudentDisplayName(currentUser.uid, currentUser);
  }
  const label = displayName || "회원";

  if (displayName) {
    const messages = [`${label}님, 환영합니다.`, `${label}님, 오늘도 화이팅입니다.`];
    dom.welcomeMsg.textContent = messages[Math.floor(Math.random() * messages.length)];
    return;
  }
  dom.welcomeMsg.textContent = `${label}님, 환영합니다.`;
}

export async function updateGradeIfNeeded() {
  if (!state.user?.uid) return null;
  try {
    const studentRef = doc(db, "students", state.user.uid);
    const currentYear = new Date().getFullYear();

    return await runTransaction(db, async (transaction) => {
      const studentDoc = await transaction.get(studentRef);
      if (!studentDoc.exists()) return null;

      const studentData = studentDoc.data();
      const profile = { uid: studentDoc.id, ...studentData };

      const createdAt = studentData.createdAt;
      let createdDate = null;
      if (createdAt?.toDate) createdDate = createdAt.toDate();
      else if (createdAt instanceof Date) createdDate = createdAt;
      else if (createdAt?.seconds) createdDate = new Date(createdAt.seconds * 1000);

      const promotion = getAutomaticGradePromotion({
        grade: studentData.grade,
        createdYear: createdDate?.getFullYear(),
        lastPromotionYear: studentData.lastAutoPromotionYear,
        currentYear,
      });
      if (!promotion.shouldPromote && !promotion.shouldInitialize) return profile;

      const updateData = {
        lastAutoPromotionYear: promotion.promotionYear,
        updatedAt: serverTimestamp(),
      };
      if (promotion.shouldPromote) updateData.grade = promotion.grade;
      if (studentData.gradeManualOverride === true) updateData.gradeManualOverride = false;

      transaction.update(studentRef, updateData);
      return {
        ...profile,
        ...(promotion.shouldPromote ? { grade: promotion.grade } : {}),
        lastAutoPromotionYear: promotion.promotionYear,
      };
    });
  } catch (error) {
    console.error("학년 업데이트 실패:", error);
    return null;
  }
}
