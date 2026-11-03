import { auth, db } from "/assets/js/firebase-init.js";
import { collection, getDoc, getDocs, doc, query, where } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getSettingDoc } from "/assets/js/utils/settings-cache.js";
import { createCourseLabelMaps } from "/assets/js/utils/course-readonly.js";
import {
  getSubjectColorMapFromSettings,
  mergeSubjectColorMap,
} from "/assets/js/utils/subject-colors.js";
import { dom, state } from "/assets/js/pages/instructor-dashboard/context.js";

const instructorAccountReads = new Map();
const instructorProfileByUidReads = new Map();

function loadInstructorAccount(uid) {
  const key = String(uid || "").trim();
  if (!key) return Promise.resolve(null);
  if (!instructorAccountReads.has(key)) {
    instructorAccountReads.set(key, getDoc(doc(db, "instructorAccounts", key)));
  }
  return instructorAccountReads.get(key);
}

function findInstructorProfileByUid(uid) {
  const key = String(uid || "").trim();
  if (!key) return Promise.resolve(null);
  if (!instructorProfileByUidReads.has(key)) {
    instructorProfileByUidReads.set(
      key,
      getDocs(query(collection(db, "instructors"), where("uid", "==", key)))
        .then((snapshot) => snapshot.docs[0] || null)
    );
  }
  return instructorProfileByUidReads.get(key);
}

export async function loadDashboardSettings() {
  try {
    const [catalogResult, coursesMenuResult, instructorsMenuResult, subjectColorsResult, instructorAccountResult] = await Promise.all([
      getSettingDoc("courseCatalog"),
      getSettingDoc("coursesMenu"),
      getSettingDoc("instructorsMenu"),
      getSettingDoc("subjectColors"),
      loadInstructorAccount(state.user?.uid)
    ]);
    state.labelMaps = createCourseLabelMaps(catalogResult.exists ? catalogResult.data : {});
    state.subjectColorMap = mergeSubjectColorMap(
      {
        ...getSubjectColorMapFromSettings(instructorsMenuResult.exists ? instructorsMenuResult.data : {}),
        ...getSubjectColorMapFromSettings(subjectColorsResult.exists ? subjectColorsResult.data : {}),
      }
    );
    const hiddenList = coursesMenuResult.exists ? coursesMenuResult.data?.hidden : [];
    state.hiddenCourseIds = new Set(Array.isArray(hiddenList) ? hiddenList : []);
    state.instructorsByUid = {};
    const accountData = instructorAccountResult?.exists?.() ? (instructorAccountResult.data() || {}) : {};
    state.instructorProfileId = String(accountData.instructorId || "").trim();

    if (!state.instructorProfileId && state.user?.uid) {
      const profile = await findInstructorProfileByUid(state.user.uid);
      if (profile) {
        state.instructorProfileId = String(profile.data()?.instructorId || profile.id || "").trim();
      }
    }
  } catch (_error) {
    state.labelMaps = createCourseLabelMaps({});
    state.hiddenCourseIds = new Set();
    state.instructorsByUid = {};
    state.subjectColorMap = mergeSubjectColorMap({});
    state.instructorProfileId = "";
  }
}

export async function loadStudentNamesMap(studentIds) {
  const names = new Map();
  studentIds.forEach((id) => names.set(id, state.studentNamesCache.get(id) || "정보 없음"));
  return names;
}

export async function setInstructorInfo() {
  if (!dom.instructorInfo) return;
  const currentUser = state.user || auth.currentUser;
  if (!currentUser) {
    dom.instructorInfo.textContent = "강사 LMS";
    return;
  }

  let resolvedName = "";
  try {
    const accountDoc = await loadInstructorAccount(currentUser.uid);
    let instructorId = "";
    if (accountDoc.exists()) {
      const accountData = accountDoc.data() || {};
      instructorId = String(accountData.instructorId || "").trim();
      resolvedName = accountData.name || "";
    }
    if (instructorId) {
      const profileDoc = await getDoc(doc(db, "instructors", instructorId));
      if (profileDoc.exists()) {
        resolvedName = profileDoc.data()?.name || resolvedName;
      }
    }
    if (!resolvedName) {
      const byUidProfile = await findInstructorProfileByUid(currentUser.uid);
      if (byUidProfile) {
        resolvedName = byUidProfile.data()?.name || "";
      }
    }
  } catch (_error) {
  }

  const displayName = resolvedName || currentUser.name?.split("@")[0] || "강사";
  dom.instructorInfo.textContent = `${displayName}님, 환영합니다.`;
}
