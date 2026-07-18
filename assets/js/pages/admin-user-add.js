// /assets/js/pages/admin-user-add.js
// 사용자 관리 페이지
import { app, db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteField, serverTimestamp, collection, writeBatch, query, where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
import {
  getAuth, createUserWithEmailAndPassword, deleteUser as deleteAuthUser, setPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { initializeApp as initApp2 } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs";
import { formatGrade, normalizeGrade } from "/assets/js/utils/grade.js";
import { validatePhone } from "/assets/js/utils/validation.js";
import { CONSENT_SOURCE_ADMIN, LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";
import {
  buildInstructorAccountCleanupPreview,
  executeInstructorAccountCleanup,
  executeInstructorAccountUnlink
} from "/assets/js/utils/instructor-account-cleanup.js";
import {
  buildSubjectSelectHtml,
} from "/assets/js/utils/catalog-select-helpers.js";
import { loadInstructorMenuSubjects } from "/assets/js/utils/instructor-subjects.js";
import { requestPhraseConfirmation } from "/assets/js/utils/confirm-phrase-modal.js";

// 역할 가드: 관리자만 접근 가능
(async () => {
  try {
    await requireRole("admin", "/members/login.html");
  } catch (err) {
    // requireRole에서 이미 리다이렉션 처리됨
  }
})();

// Secondary auth for creating users (manage.js와 동일한 방식)
const secondaryApp = initApp2(app.options, "admin-secondary");
const secondaryAuth = getAuth(secondaryApp);
(async () => {
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
  } catch (error) {
    console.warn('[admin-user-add] setPersistence 실패:', error);
  }
})();

const $ = (s, r = document) => r.querySelector(s);
function normalizeRole(role) {
  return role === "parent" ? "" : role;
}

const ACTIVE_STUDENT_GRADE_VALUES = ["1", "2", "3", "4", "5", "6", "7"];
const MEMBER_PURPOSE_VALUES = ["parent", "general"];
const MEMBER_SIGNUP_SOURCE_VALUES = ["search", "friend", "sns", "ad", "other"];
const CLEANUP_CONFIRMATION = "데이터 정리";
const MEMBER_CLEANUP_SAMPLE_LIMIT = 5;
const CLEANUP_SUCCESS_CLOSE_DELAY_MS = 1000;

function normalizeSignupSource(value) {
  const raw = String(value || "").trim();
  const sourceMap = {
    "": "",
    search: "search",
    "인터넷 검색": "search",
    "검색": "search",
    friend: "friend",
    "지인 소개": "friend",
    "지인 추천": "friend",
    sns: "sns",
    SNS: "sns",
    ad: "ad",
    "광고, 홍보": "ad",
    "광고": "ad",
    "홍보": "ad",
    other: "other",
    "기타": "other"
  };
  return sourceMap[raw] ?? "";
}

function getMemberPurposeLabel(value) {
  if (value === "parent") return "학부모 회원";
  if (value === "general") return "일반 회원";
  return value || "-";
}

function getInstructorLinkStatus(user = {}) {
  if (user.role !== "instructor") return "";
  if (user.instructorLinkStatus === "profileOnly") return "profileOnly";
  if (user.instructorLinkStatus === "unlinked") return "unlinked";
  return user.instructorId ? "linked" : "unlinked";
}

function getInstructorLinkStatusLabel(status) {
  return {
    linked: "계정 연동됨",
    unlinked: "연동 해제됨",
    profileOnly: "프로필만 있음"
  }[status] || "";
}

function requiresMemberSignupSource(memberPurpose) {
  return MEMBER_PURPOSE_VALUES.includes(memberPurpose);
}

function buildMarketingConsent(source = CONSENT_SOURCE_ADMIN) {
  return {
    sms: false,
    email: false,
    agreedAt: null,
    updatedAt: serverTimestamp(),
    withdrawnAt: null,
    source,
    policyVersion: LEGAL_POLICY_VERSION
  };
}

function formatCreatedAt(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR");
}

function getConsentStatusLabel(value) {
  return value === true ? "동의" : "미동의/미기록";
}

function getConsentSourceLabel(value) {
  const source = String(value || "").trim();
  const labels = {
    signup: "온라인 가입",
    admin: "관리자 등록",
    settings: "설정 변경"
  };
  return labels[source] || source || "미기록";
}

function getMarketingConsent(user = {}) {
  return user.marketingConsent && typeof user.marketingConsent === "object"
    ? user.marketingConsent
    : {};
}

function getMarketingConsentStatusLabel(consent = {}) {
  const sms = consent.sms === true;
  const email = consent.email === true;
  if (sms && email) return "동의";
  if (!sms && !email) return "미동의";
  return "일부 동의";
}

function getUserCreatedAtValue(user = {}) {
  return user.createdAt || user.registeredAt || user.joinedAt || user.signupAt || null;
}

function getCreatedAtMillis(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

const DELETABLE_ROLES = ["student", "instructor", "parent", "admin"];
const LEGACY_USER_DOC_IDS = {
  parent: "parents"
};

async function getRefsByField(collectionName, fieldName, value) {
  const snap = await getDocs(query(collection(db, collectionName), where(fieldName, "==", value)));
  return snap.docs.map((item) => item.ref);
}

async function deleteRefsInBatches(refs) {
  let batch = writeBatch(db);
  let pending = 0;
  let deletedCount = 0;

  for (const ref of refs) {
    batch.delete(ref);
    pending++;
    deletedCount++;

    if (pending >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }

  return deletedCount;
}

async function deleteUserMirrorEntry(uid, role) {
  const roleDocId = LEGACY_USER_DOC_IDS[role];
  if (!roleDocId) return false;

  const usersRef = doc(db, "users", roleDocId);
  const usersDoc = await getDoc(usersRef);
  if (!usersDoc.exists() || usersDoc.data()?.[uid] == null) return false;

  await updateDoc(usersRef, { [uid]: deleteField() });
  return true;
}

async function deleteUserFirestoreData(uid, role) {
  if (!DELETABLE_ROLES.includes(role)) {
    throw new Error("알 수 없는 사용자 역할입니다.");
  }
  if (role === "admin") {
    throw new Error("관리자 권한 관리는 현재 수동으로 처리합니다.");
  }

  const refsToDelete = [];

  if (role === "student") {
    const [enrollmentRefs, classMemberRefs, sessionAccessRefs] = await Promise.all([
      getRefsByField("enrollments", "userId", uid),
      getRefsByField("offlineClassMembers", "studentUid", uid),
      getRefsByField("offlineSessionAccess", "studentUid", uid)
    ]);

    refsToDelete.push(
      ...enrollmentRefs,
      ...classMemberRefs,
      ...sessionAccessRefs,
      doc(db, "students", uid)
    );
  } else if (role === "instructor") {
    throw new Error("강사 데이터 정리는 미리보기 확인 후 실행해야 합니다.");
  } else if (role === "parent") {
    refsToDelete.push(doc(db, "parents", uid));
  }

  const deletedCount = await deleteRefsInBatches(refsToDelete);
  const deletedFieldCount = await deleteUserMirrorEntry(uid, role) ? 1 : 0;

  return { deletedCount, deletedFieldCount };
}

function sanitizeInstructorVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const { youtube_url, ...rest } = item;
    return rest;
  });
}

function buildPublicInstructorProfile(data = {}, instructorId = "") {
  const curriculumImageUrls = Array.isArray(data.curriculumImageUrls) ? data.curriculumImageUrls : [];
  const curriculumImageUrl = data.curriculumImageUrl || curriculumImageUrls[0] || "";
  const photo = String(data.photo || data.profilePhoto || data.imageUrl || "").trim();

  return {
    name: data.name || "",
    subject: data.subject || "",
    email: data.email || "",
    emailLower: normalizeEmail(data.emailLower || data.email),
    note: data.note || "",
    bio: data.bio || "",
    brief: data.brief || "",
    photo,
    videos: sanitizeInstructorVideos(data.videos),
    curriculumImageUrl,
    curriculumImageUrls,
    instructorId,
    pending: data.pending === true,
    createdAt: data.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function hasLinkedUid(data = {}) {
  return typeof data.uid === "string" && data.uid.trim() !== "";
}

function getProfileEmailLower(data = {}) {
  return normalizeEmail(data.emailLower || data.email);
}

function toInstructorProfileResult(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    instructorId: docSnap.id,
    ...data
  };
}

async function assertInstructorAccountEmailAvailable(email, emailLower) {
  const checks = [];
  if (emailLower) {
    checks.push(getDocs(query(collection(db, "instructorAccounts"), where("emailLower", "==", emailLower))));
  }
  if (email) {
    checks.push(getDocs(query(collection(db, "instructorAccounts"), where("email", "==", email))));
  }

  const snaps = await Promise.all(checks);
  if (snaps.some((snap) => !snap.empty)) {
    throw new Error("이미 등록된 강사 계정 이메일입니다.");
  }
}

async function hasAnyDocsForEmail(collectionName, fieldName, emailValue) {
  const value = String(emailValue || "").trim();
  if (!value) return false;
  const snap = await getDocs(query(collection(db, collectionName), where(fieldName, "==", value)));
  return !snap.empty;
}

async function assertCanonicalEmailAvailable(email) {
  const rawEmail = String(email || "").trim();
  const emailLower = normalizeEmail(rawEmail);
  if (!emailLower) throw new Error("이메일을 입력해주세요.");

  const checks = await Promise.all([
    hasAnyDocsForEmail("students", "email", rawEmail),
    rawEmail !== emailLower ? hasAnyDocsForEmail("students", "email", emailLower) : Promise.resolve(false),
    hasAnyDocsForEmail("members", "emailLower", emailLower),
    hasAnyDocsForEmail("members", "email", rawEmail),
    rawEmail !== emailLower ? hasAnyDocsForEmail("members", "email", emailLower) : Promise.resolve(false),
    hasAnyDocsForEmail("instructorAccounts", "emailLower", emailLower),
    hasAnyDocsForEmail("instructorAccounts", "email", rawEmail),
    rawEmail !== emailLower ? hasAnyDocsForEmail("instructorAccounts", "email", emailLower) : Promise.resolve(false),
    hasAnyDocsForEmail("admins", "email", rawEmail),
    rawEmail !== emailLower ? hasAnyDocsForEmail("admins", "email", emailLower) : Promise.resolve(false)
  ]);

  if (checks.some(Boolean)) {
    throw new Error("이미 등록된 이메일입니다.");
  }
}

// 학년 자동 설정 함수 (생성일 기준)
// 생성일이 1월 1일 이후면 자동으로 다음 학년으로 변경
function calculateGrade(selectedGrade, createdAt) {
  const gradeCode = normalizeGrade(selectedGrade);
  if (!gradeCode || !createdAt) return gradeCode;

  let createdDate;
  if (createdAt.toDate) {
    createdDate = createdAt.toDate();
  } else if (createdAt instanceof Date) {
    createdDate = createdAt;
  } else {
    return gradeCode;
  }

  const now = new Date();
  const shouldAdvance = createdDate.getFullYear() < now.getFullYear();
  const gradeNumber = parseInt(gradeCode, 10);
  return shouldAdvance && gradeNumber < 7 ? String(gradeNumber + 1) : gradeCode;
}

function toast(msg, err = false) {
  const statusMsg = $("#statusMsg");
  if (statusMsg) {
    // 메시지 내용 설정
    statusMsg.textContent = msg;
    statusMsg.style.color = err ? "var(--error-color)" : "var(--success-color)";
    statusMsg.style.background = err ? "var(--error-bg)" : "var(--success-bg)";
    statusMsg.style.padding = "12px";
    statusMsg.style.borderRadius = "8px";
    statusMsg.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    
    // 표시 (opacity와 pointer-events 변경)
    statusMsg.style.opacity = "1";
    statusMsg.style.pointerEvents = "auto";
    
    setTimeout(() => {
      if (statusMsg.textContent === msg) {
        // 숨김 (내용만 제거하고 위치는 유지)
        statusMsg.style.opacity = "0";
        statusMsg.style.pointerEvents = "none";
        setTimeout(() => {
          if (statusMsg.textContent === msg) {
            statusMsg.textContent = "";
            statusMsg.style.background = "";
            statusMsg.style.boxShadow = "";
          }
        }, 300); // 페이드아웃 애니메이션 시간
      }
    }, 3000);
  }
}

// DOM 요소를 찾을 때까지 기다리는 함수
function waitForElement(selector, maxRetries = 50, interval = 100) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const checkElement = () => {
      const element = $(selector);
      if (element) {
        resolve(element);
      } else if (retries < maxRetries) {
        retries++;
        setTimeout(checkElement, interval);
      } else {
        reject(new Error(`요소를 찾을 수 없습니다: ${selector}`));
      }
    };
    checkElement();
  });
}

// 이름과 과목으로 기존 강사 정보 찾기 (instructors 컬렉션에서)
async function findInstructorByNameAndSubject(name, subject) {
  try {
    const instructorsSnap = await getDocs(collection(db, "instructors"));
    const matches = instructorsSnap.docs.filter(doc => {
      const data = doc.data();
      return data.pending &&
             !hasLinkedUid(data) &&
             data.name === name &&
             data.subject === subject;
    });

    if (matches.length > 1) {
      throw new Error("이름과 과목이 같은 미연결 강사 프로필이 여러 개 있습니다. 강사 관리에서 먼저 정리해주세요.");
    }

    if (matches.length === 1) {
      return toInstructorProfileResult(matches[0]);
    }
    return null;
  } catch (error) {
    console.error("강사 정보 검색 실패:", error);
    throw error;
  }
}

async function findInstructorProfileForAccount(userData, emailLower) {
  const instructorsSnap = await getDocs(collection(db, "instructors"));
  const emailMatches = [];
  const linkedEmailMatches = [];

  instructorsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!emailLower || getProfileEmailLower(data) !== emailLower) return;
    if (hasLinkedUid(data)) {
      linkedEmailMatches.push(toInstructorProfileResult(docSnap));
    } else {
      emailMatches.push(toInstructorProfileResult(docSnap));
    }
  });

  if (linkedEmailMatches.length) {
    throw new Error("이미 계정에 연결된 강사 프로필 이메일입니다.");
  }
  if (emailMatches.length > 1) {
    throw new Error("이메일이 같은 미연결 강사 프로필이 여러 개 있습니다. 강사 관리에서 먼저 정리해주세요.");
  }
  if (emailMatches.length === 1) {
    return emailMatches[0];
  }

  return findInstructorByNameAndSubject(
    normalizeText(userData.name),
    normalizeText(userData.subject)
  );
}

function buildInstructorAccountPayload({ uid, instructorId, name, email, emailLower, subject }) {
  return {
    uid,
    instructorId,
    name,
    email,
    emailLower,
    subject,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function syncMemberSignupSourceFields() {
  const roleValue = normalizeRole($("#roleSelect")?.value);
  const isMember = roleValue === "member";
  const purpose = String($("#memberPurpose")?.value || "").trim();
  const signupSource = String($("#memberSignupSource")?.value || "").trim();
  const needsSignupSource = isMember && requiresMemberSignupSource(purpose);
  const needsSignupSourceOther = needsSignupSource && signupSource === "other";
  const sourceGroup = $("#memberSignupSourceGroup");
  const otherGroup = $("#memberSignupSourceOtherGroup");
  const sourceInput = $("#memberSignupSource");
  const otherInput = $("#memberSignupSourceOther");

  if (sourceGroup) sourceGroup.style.display = needsSignupSource ? "flex" : "none";
  if (otherGroup) otherGroup.style.display = needsSignupSourceOther ? "flex" : "none";

  if (sourceInput) {
    if (needsSignupSource) sourceInput.setAttribute("required", "required");
    else {
      sourceInput.removeAttribute("required");
      sourceInput.value = "";
    }
  }

  if (otherInput) {
    if (needsSignupSourceOther) otherInput.setAttribute("required", "required");
    else {
      otherInput.removeAttribute("required");
      otherInput.value = "";
    }
  }
}

// 사용자 추가 함수 (재사용 가능하도록 분리)
async function addSingleUser(userData) {
  userData.role = normalizeRole(userData.role);
  if (userData.role === "parent") {
    throw new Error("학부모 계정 생성은 지원하지 않습니다.");
  }
  if (!["student", "instructor", "member"].includes(userData.role)) {
    throw new Error("학생, 강사, 일반/학부모 회원 중에서 역할을 선택해주세요.");
  }

  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%&*_;:,.\/?])[A-Za-z\d!@#$%&*_;:,.\/?]{8,}$/;
  if (!passwordRegex.test(userData.password)) {
    throw new Error("비밀번호는 영문, 숫자, 특수문자를 각각 포함하여 8자 이상이어야 합니다.");
  }
  if (userData.role === 'instructor' && (!userData.subject || !userData.subject.trim())) {
    throw new Error("과목을 입력해주세요.");
  }
  if (userData.role === "student") {
    const gradeCode = normalizeGrade(userData.grade);
    if (userData.grade && !ACTIVE_STUDENT_GRADE_VALUES.includes(gradeCode)) {
      throw new Error("신규 학생 학년은 중1~졸업 중에서 선택해주세요.");
    }
    userData.grade = gradeCode;
    const phoneRaw = String(userData.phone || "").trim();
    if (!phoneRaw) {
      throw new Error("학생 전화번호를 입력해주세요.");
    }
    const phoneValidation = validatePhone(phoneRaw);
    if (!phoneValidation.valid) {
      throw new Error("올바른 전화번호를 입력해주세요.");
    }
    userData.phone = phoneValidation.normalized || phoneRaw;
    userData.signupSource = normalizeSignupSource(userData.signupSource);
    if (!MEMBER_SIGNUP_SOURCE_VALUES.includes(userData.signupSource)) {
      throw new Error("가입 경로를 선택해 주세요.");
    }
  }
  if (userData.role === "member") {
    const phoneRaw = String(userData.phone || "").trim();
    if (!phoneRaw) {
      throw new Error("회원 전화번호를 입력해주세요.");
    }
    const phoneValidation = validatePhone(phoneRaw);
    if (!phoneValidation.valid) {
      throw new Error("올바른 전화번호를 입력해주세요.");
    }
    userData.phone = phoneValidation.normalized || phoneRaw;
    userData.memberPurpose = String(userData.memberPurpose || "").trim();
    if (!MEMBER_PURPOSE_VALUES.includes(userData.memberPurpose)) {
      throw new Error("회원 유형을 선택해주세요.");
    }
    userData.signupSource = normalizeSignupSource(userData.signupSource);
    userData.signupSourceOther = normalizeText(userData.signupSourceOther);
    if (requiresMemberSignupSource(userData.memberPurpose) && !MEMBER_SIGNUP_SOURCE_VALUES.includes(userData.signupSource)) {
      throw new Error("가입 경로를 선택해 주세요.");
    }
    if (requiresMemberSignupSource(userData.memberPurpose) && userData.signupSource === "other" && !userData.signupSourceOther) {
      throw new Error("기타 가입 경로를 입력해 주세요.");
    }
  }

  await assertCanonicalEmailAvailable(userData.email);

  let matchedInstructorProfile = null;
  let instructorEmail = "";
  let instructorEmailLower = "";
  if (userData.role === "instructor") {
    instructorEmail = String(userData.email || "").trim();
    instructorEmailLower = normalizeEmail(instructorEmail);
    await assertInstructorAccountEmailAvailable(instructorEmail, instructorEmailLower);
    matchedInstructorProfile = await findInstructorProfileForAccount(userData, instructorEmailLower);
  }

  // Firebase Auth에 사용자 생성
  const userCredential = await createUserWithEmailAndPassword(
    secondaryAuth,
    userData.email,
    userData.password
  );
  const newUserId = userCredential.user.uid;

  try {
  if (userData.role === 'student') {
    // 학년 자동 설정 (생성일 기준)
    const createdAt = serverTimestamp();
    const finalGrade = calculateGrade(userData.grade, createdAt);
    let finalName = userData.name;

    // students 컬렉션에 개별 문서로 저장 (회원가입과 일관성 유지)
    const studentData = {
      name: finalName,
      email: userData.email,
      school: userData.school || '',
      grade: finalGrade,
      phone: userData.phone,
      note: userData.note || '',
      ...(userData.signupSource ? { signupSource: userData.signupSource } : {}),
      termsAgreed: true,
      privacyAgreed: true,
      termsAgreedAt: serverTimestamp(),
      privacyAgreedAt: serverTimestamp(),
      consentSource: CONSENT_SOURCE_ADMIN,
      policyVersion: LEGAL_POLICY_VERSION,
      marketingConsent: buildMarketingConsent(),
      createdAt: createdAt,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "students", newUserId), studentData);

  // PATCH: 학부모 기능 OFF - parent role 추가 로직 제거
  // } else if (userData.role === 'parent') { ... } 제거됨

  } else if (userData.role === 'member') {
    const email = String(userData.email || "").trim();
    const memberData = {
      uid: newUserId,
      role: "member",
      name: normalizeText(userData.name),
      email,
      emailLower: normalizeEmail(email),
      phone: userData.phone,
      memberPurpose: userData.memberPurpose,
      status: "active",
      hasLinkedChildren: false,
      linkedChildrenCount: 0,
      termsAgreed: true,
      privacyAgreed: true,
      termsAgreedAt: serverTimestamp(),
      privacyAgreedAt: serverTimestamp(),
      consentSource: CONSENT_SOURCE_ADMIN,
      policyVersion: LEGAL_POLICY_VERSION,
      marketingConsent: buildMarketingConsent(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (requiresMemberSignupSource(userData.memberPurpose)) {
      memberData.signupSource = userData.signupSource;
      if (userData.signupSource === "other") {
        memberData.signupSourceOther = userData.signupSourceOther;
      }
    }

    await setDoc(doc(db, "members", newUserId), memberData);
  } else if (userData.role === 'instructor') {
    const existingInstructor = matchedInstructorProfile;
    const instructorId = existingInstructor?.id || `inst_${Date.now()}`;
    const name = normalizeText(existingInstructor?.name || userData.name);
    const subject = normalizeText(existingInstructor?.subject || userData.subject);
    const phone = normalizeText(userData.phone || existingInstructor?.phone);

    const profilePayload = {
      ...buildPublicInstructorProfile({
        ...(existingInstructor || {}),
        name,
        email: instructorEmail,
        subject,
        phone,
        pending: false
      }, instructorId),
      uid: newUserId,
      instructorId,
      name,
      email: instructorEmail,
      emailLower: instructorEmailLower,
      subject,
      ...(phone ? { phone } : {}),
      pending: false,
      updatedAt: serverTimestamp()
    };

    const instructorBatch = writeBatch(db);
    instructorBatch.set(doc(db, "instructors", instructorId), profilePayload, { merge: true });
    instructorBatch.set(doc(db, "instructorAccounts", newUserId), buildInstructorAccountPayload({
      uid: newUserId,
      instructorId,
      name,
      email: instructorEmail,
      emailLower: instructorEmailLower,
      subject
    }), { merge: true });
    await instructorBatch.commit();
  }
  } catch (error) {
    try {
      await deleteAuthUser(userCredential.user);
    } catch (rollbackError) {
      console.warn("인증 계정 롤백 실패:", rollbackError);
    }
    throw error;
  }

  return { success: true, uid: newUserId, name: userData.name };
}

// 사용자 추가 폼 초기화 함수 (계속)
async function initUserAddForm() {
  try {
    // DOM 요소들이 준비될 때까지 기다림
    const form = await waitForElement("#userAddForm");
    const roleSelect = await waitForElement("#roleSelect");
    const studentFields = $("#studentFields");
    const studentFields2 = $("#studentFields2");
    const instructorFields = $("#instructorFields");
    const instructorFields2 = $("#instructorFields2");
    const memberFields = $("#memberFields");
    const memberPurpose = $("#memberPurpose");
    const memberPhone = $("#memberPhone");
    const memberSignupSource = $("#memberSignupSource");
    const memberSignupSourceOther = $("#memberSignupSourceOther");
    const memberSignupSourceGroup = $("#memberSignupSourceGroup");
    const memberSignupSourceOtherGroup = $("#memberSignupSourceOtherGroup");

    // 초기 상태에서 모든 역할별 required 필드의 required 제거 (기본값)
    const userSubject = $("#userSubject");
    const userChildGrade = $("#userChildGrade");
    const userPhone = $("#userPhone");
    if (userSubject) {
      const subjects = await loadInstructorMenuSubjects(getSettingDoc);
      userSubject.innerHTML = buildSubjectSelectHtml(subjects, {
        emptyLabel: "선택하세요",
        allowCustom: false
      });
      userSubject.removeAttribute("required");
    }
    if (userChildGrade) userChildGrade.removeAttribute('required');
    if (userPhone) userPhone.removeAttribute('required');
    if (memberPurpose) memberPurpose.removeAttribute('required');
    if (memberPhone) memberPhone.removeAttribute('required');
    if (memberSignupSource) memberSignupSource.removeAttribute('required');
    if (memberSignupSourceOther) memberSignupSourceOther.removeAttribute('required');

    // URL 쿼리 파라미터에서 역할 읽기
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    // parents feature disabled (policy OFF, 2024-12-19) - parent 제거
    if (roleParam && roleSelect && ['student', 'instructor', 'member'].includes(roleParam)) {
      roleSelect.value = normalizeRole(roleParam);
      // change 이벤트를 수동으로 트리거하여 필드 표시/숨김 처리
      const changeEvent = new Event('change', { bubbles: true });
      roleSelect.dispatchEvent(changeEvent);
    } else {
      // 역할이 선택되지 않은 경우에도 초기 상태 설정
      const changeEvent = new Event('change', { bubbles: true });
      roleSelect.dispatchEvent(changeEvent);
    }

    // 역할 선택에 따라 필드 표시/숨김 및 required 속성 관리
    roleSelect?.addEventListener('change', async (e) => {
      const roleValue = normalizeRole(e.target.value);
      const isStudent = roleValue === 'student';
      const isInstructor = roleValue === 'instructor';
      const isMember = roleValue === 'member';
      const isParent = roleValue === 'parent';
      
      // 학생 필드 표시/숨김
      if (studentFields) studentFields.style.display = isStudent ? 'block' : 'none';
      if (studentFields2) studentFields2.style.display = isStudent ? 'block' : 'none';
      
      // 강사 필드 표시/숨김
      if (instructorFields) instructorFields.style.display = isInstructor ? 'block' : 'none';
      if (instructorFields2) instructorFields2.style.display = isInstructor ? 'block' : 'none';

      if (memberFields) memberFields.style.display = isMember ? 'grid' : 'none';
      
      // parents feature disabled (policy OFF, 2024-12-19) - parent 필드 숨김 처리
      const parentFields = $("#parentFields");
      const parentFields1 = $("#parentFields1");
      const parentFields2 = $("#parentFields2");
      const parentFields3 = $("#parentFields3");
      if (parentFields) parentFields.style.display = 'none';
      if (parentFields1) parentFields1.style.display = 'none';
      if (parentFields2) parentFields2.style.display = 'none';
      if (parentFields3) parentFields3.style.display = 'none';
      
      // required 속성 관리: 숨겨진 필드의 required 제거, 표시된 필드만 required 유지
      const userSubject = $("#userSubject");
      const userChildGrade = $("#userChildGrade");
      const userPhone = $("#userPhone");
      const memberPurpose = $("#memberPurpose");
      const memberPhone = $("#memberPhone");
      const memberSignupSource = $("#memberSignupSource");
      const memberSignupSourceOther = $("#memberSignupSourceOther");
      
      // 강사 과목 필드: 강사일 때만 required
      if (userSubject) {
        if (isInstructor) {
          userSubject.setAttribute('required', 'required');
        } else {
          userSubject.removeAttribute('required');
        }
      }

      if (userPhone) {
        if (isStudent) {
          userPhone.setAttribute('required', 'required');
        } else {
          userPhone.removeAttribute('required');
        }
      }

      if (memberPurpose) {
        if (isMember) memberPurpose.setAttribute('required', 'required');
        else memberPurpose.removeAttribute('required');
      }
      if (memberPhone) {
        if (isMember) memberPhone.setAttribute('required', 'required');
        else memberPhone.removeAttribute('required');
      }
      syncMemberSignupSourceFields();
      
      // 학부모 자녀 학년 필드: 학부모일 때만 required
      if (userChildGrade) {
        if (isParent) {
          userChildGrade.setAttribute('required', 'required');
        } else {
          userChildGrade.removeAttribute('required');
        }
      }
    });

    memberPurpose?.addEventListener('change', syncMemberSignupSourceFields);
    memberSignupSource?.addEventListener('change', syncMemberSignupSourceFields);
    roleSelect?.dispatchEvent(new Event('change', { bubbles: true }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // 숨겨진 필드의 required 속성 제거 (HTML5 검증 오류 방지)
      const currentRole = normalizeRole(roleSelect?.value);
      const userSubject = $("#userSubject");
      const userChildGrade = $("#userChildGrade");
      const userPhone = $("#userPhone");
      
      if (currentRole !== 'instructor' && userSubject) {
        userSubject.removeAttribute('required');
      }
      if (currentRole !== 'parent' && userChildGrade) {
        userChildGrade.removeAttribute('required');
      }
      if (currentRole !== 'student' && userPhone) {
        userPhone.removeAttribute('required');
      }
      if (currentRole !== 'member') {
        $("#memberPurpose")?.removeAttribute('required');
        $("#memberPhone")?.removeAttribute('required');
        $("#memberSignupSource")?.removeAttribute('required');
        $("#memberSignupSourceOther")?.removeAttribute('required');
      }
      
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      data.role = normalizeRole(data.role);

      // 비고 필드 직접 읽기 (학생/강사/학부모 필드가 같은 name을 사용하므로)
      const memoInput = $("#userMemo");
      const memoInstructorInput = $("#userMemoInstructor");
      const memoParentInput = $("#userMemoParent");
      const memoValue = (memoInput && memoInput.value) || (memoInstructorInput && memoInstructorInput.value) || (memoParentInput && memoParentInput.value) || '';

      // 비밀번호 검증: 영문/숫자/특수문자 각각 필수 8자 이상 (일반적인 특수문자만 허용, 괄호 및 수식 제외)
      const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%&*_;:,.\/?])[A-Za-z\d!@#$%&*_;:,.\/?]{8,}$/;
      if (!passwordRegex.test(data.password)) {
        toast("비밀번호는 영문, 숫자, 특수문자를 각각 포함하여 8자 이상이어야 합니다.\n사용 가능한 특수문자: ! @ # $ % & * _ ; : , . \\ / ?", true);
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "계정 생성";
        }
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "추가 중...";
      }

      try {
        await addSingleUser({
          role: data.role,
          name: data.name,
          email: data.email,
          password: data.password,
          school: data.school || '',
          grade: data.grade || '',
          subject: data.subject || '',
          phone: data.role === "member" ? (data.memberPhone || '') : (data.phone || ''),
          signupSource: data.role === "member" ? (data.memberSignupSource || '') : (data.signupSource || ''),
          signupSourceOther: data.memberSignupSourceOther || '',
          memberPurpose: data.memberPurpose || '',
          childName: data.childName || '',
          childSchool: data.childSchool || '',
          childGrade: data.childGrade || '',
          note: memoValue
        });

        // PATCH: role 정규화 - instructor로 통일 (2024-12-19)
        const roleText = data.role === "student" ? "학생" : data.role === "member" ? "회원" : "강사";
        toast(`${roleText}이 성공적으로 추가되었습니다.`);
        form.reset();
        roleSelect?.dispatchEvent(new Event('change', { bubbles: true }));
        if (studentFields) studentFields.style.display = 'none';
        if (studentFields2) studentFields2.style.display = 'none';
        if (instructorFields) instructorFields.style.display = 'none';
        if (instructorFields2) instructorFields2.style.display = 'none';
        if (memberFields) memberFields.style.display = 'none';
        const parentFields = $("#parentFields");
        const parentFields2 = $("#parentFields2");
        const parentFields3 = $("#parentFields3");
        const parentFields1 = $("#parentFields1");
        if (parentFields) parentFields.style.display = 'none';
        if (parentFields1) parentFields1.style.display = 'none';
        if (parentFields2) parentFields2.style.display = 'none';
        if (parentFields3) parentFields3.style.display = 'none';
        
        // 실시간 감시가 자동으로 업데이트하므로 loadUsers() 호출 불필요

      } catch (error) {
        console.error("계정 생성 실패:", error);
        toast("계정 생성 실패: " + (error.message || error), true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "계정 생성";
        }
      }
    });
  } catch (error) {
    console.error("사용자 추가 폼 초기화 실패:", error);
  }
}

// 초기화 실행
initUserAddForm();

// ================== 사용자 목록 실시간 표시 ==================
const tbody = $("#tblUsers")?.querySelector('tbody');
const searchInput = $("#searchUsers");
const roleFilterInput = $("#roleFilterUsers");
let allUsers = [];
let filteredUsers = [];
let currentPage = 1;
const itemsPerPage = 10;
let currentSort = { field: 'createdAt', direction: 'desc' };
let usersLoaded = false;

function setUsersReadyState() {
  const tbodyElement = $("#tblUsers")?.querySelector('tbody');
  if (tbodyElement) {
    tbodyElement.innerHTML = '<tr><td colspan="8" class="muted">현황 불러오기를 눌러 사용자 목록을 확인하세요.</td></tr>';
  }
  const paginationContainer = $("#paginationContainer");
  if (paginationContainer) paginationContainer.innerHTML = "";
  allUsers = [];
  filteredUsers = [];
  updateUserStats([]);
}

// 모든 사용자 데이터 단발 조회 (onSnapshot 제거)
async function loadUsers() {
  const refreshBtn = $("#refreshUsers");
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = usersLoaded ? "새로고침 중..." : "불러오는 중...";
  }
  const users = { students: [], members: [], instructors: [], parents: [], admins: [] };

  function checkAndUpdate() {
    const userMap = new Map();
    [...users.students, ...users.members, ...users.instructors, ...users.parents, ...users.admins].forEach(user => {
      if (!userMap.has(user.uid)) userMap.set(user.uid, user);
      else userMap.set(user.uid, { ...userMap.get(user.uid), ...user });
    });
    allUsers = Array.from(userMap.values());
    filterUsers(false);
  }

  try {
    const [studentsSnap, membersSnap, instructorAccountsSnap, instructorsSnap, adminsSnap] = await Promise.all([
      getDocs(collection(db, "students")),
      getDocs(collection(db, "members")),
      getDocs(collection(db, "instructorAccounts")),
      getDocs(collection(db, "instructors")),
      getDocs(collection(db, "admins"))
    ]);

    users.students = studentsSnap.docs
      .map(d => ({ uid: d.id, role: 'student', ...d.data() }))
      .map((student) => ({ ...student, grade: normalizeGrade(student.grade) }));

    users.members = membersSnap.docs.map(d => ({ uid: d.id, role: 'member', ...d.data() }));

    const instructorProfileMap = new Map(instructorsSnap.docs.map((profileDoc) => [
      profileDoc.id,
      { id: profileDoc.id, instructorId: profileDoc.id, ...(profileDoc.data() || {}) }
    ]));
    const linkedProfileIds = new Set();

    users.instructors = instructorAccountsSnap.docs.map((accountDoc) => {
      const account = accountDoc.data() || {};
      const uid = account.uid || accountDoc.id;
      const instructorId = String(account.instructorId || "").trim();
      let profile = {};
      let hasProfile = false;

      if (instructorId) {
        const cachedProfile = instructorProfileMap.get(instructorId);
        if (cachedProfile) {
          profile = cachedProfile;
          hasProfile = true;
        }
      }

      if (instructorId) linkedProfileIds.add(instructorId);

      return {
        role: "instructor",
        ...account,
        ...profile,
        uid,
        instructorId: instructorId || profile.instructorId || "",
        instructorLinkStatus: instructorId && hasProfile ? "linked" : "unlinked",
        name: profile.name || account.name || "",
        email: account.email || profile.email || "",
        emailLower: account.emailLower || profile.emailLower || normalizeEmail(account.email || profile.email),
        subject: profile.subject || account.subject || "",
        createdAt: account.createdAt || profile.createdAt || null,
        updatedAt: account.updatedAt || profile.updatedAt || null,
        note: account.note || profile.note || ""
      };
    });

    instructorProfileMap.forEach((profile, profileId) => {
      if (linkedProfileIds.has(profileId)) return;
      users.instructors.push({
        ...profile,
        role: "instructor",
        uid: `profile_${profileId}`,
        instructorId: profileId,
        instructorLinkStatus: "profileOnly",
        name: profile.name || "",
        email: profile.email || "",
        emailLower: profile.emailLower || normalizeEmail(profile.email),
        subject: profile.subject || "",
        createdAt: profile.createdAt || null,
        updatedAt: profile.updatedAt || null,
        note: "강사 프로필만 있음"
      });
    });

    users.parents = [];

    users.admins = adminsSnap.docs.map(d => ({ uid: d.id, role: 'admin', ...d.data() }));

    usersLoaded = true;
    checkAndUpdate();
  } catch (err) {
    if (err.code !== 'permission-denied') console.error("사용자 로드 오류:", err);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = usersLoaded ? "새로고침" : "현황 불러오기";
    }
  }
}

// 사용자 정렬 함수
function sortUsers(users, sortField, sortDirection) {
  const sorted = [...users];
  
  sorted.sort((a, b) => {
    let aVal, bVal;
    
    if (sortField === 'name') {
      aVal = (a.name || '').toLowerCase();
      bVal = (b.name || '').toLowerCase();
    } else if (sortField === 'email') {
      aVal = (a.email || '').toLowerCase();
      bVal = (b.email || '').toLowerCase();
    } else if (sortField === 'createdAt') {
      aVal = getCreatedAtMillis(getUserCreatedAtValue(a));
      bVal = getCreatedAtMillis(getUserCreatedAtValue(b));
    } else if (sortField === 'role') {
      const roleOrder = { 'student': 1, 'member': 2, 'parent': 3, 'instructor': 4, 'admin': 5 };
      aVal = roleOrder[a.role] || 0;
      bVal = roleOrder[b.role] || 0;
    } else {
      return 0;
    }
    
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
  
  return sorted;
}

// 통계 업데이트
function updateUserStats(users) {
  const total = users.length;
  const students = users.filter(u => u.role === 'student').length;
  const members = users.filter(u => u.role === 'member').length;
  const parents = users.filter(u => u.role === 'parent').length;
  // PATCH: role 정규화 - instructor로 통일 (2024-12-19)
  const instructors = users.filter(u => u.role === 'instructor').length;
  const admins = users.filter(u => u.role === 'admin').length;
  
  const statTotal = $("#statTotal");
  const statStudents = $("#statStudents");
  const statMembers = $("#statMembers");
  const statParents = $("#statParents");
  const statInstructors = $("#statInstructors");
  const statAdmins = $("#statAdmins");
  
  if (statTotal) statTotal.textContent = total;
  if (statStudents) statStudents.textContent = students;
  if (statMembers) statMembers.textContent = members;
  if (statParents) statParents.textContent = parents;
  // PATCH: role 정규화 - instructor로 통일 (2024-12-19)
  if (statInstructors) statInstructors.textContent = instructors;
  if (statAdmins) statAdmins.textContent = admins;
}

// 사용자 목록 렌더링 (페이지네이션 포함)
function renderUsers(users) {
  // tbody를 다시 찾기 (탭이 숨겨져 있을 때를 대비)
  const tbodyElement = $("#tblUsers")?.querySelector('tbody');
  if (!tbodyElement) {
    console.warn("tbody를 찾을 수 없습니다.");
    return;
  }

  // 유효한 사용자만 필터링 (uid가 있고, 역할이 있는 사용자만)
  let validUsers = users.filter(user => user && user.uid && user.role);
  
  // 정렬 적용
  validUsers = sortUsers(validUsers, currentSort.field, currentSort.direction);
  
  // 필터링된 사용자 목록 저장
  filteredUsers = validUsers;
  
  // 통계 업데이트
  updateUserStats(allUsers);

  if (validUsers.length === 0) {
    tbodyElement.innerHTML = '<tr><td colspan="8" class="muted">등록된 사용자가 없습니다.</td></tr>';
    renderPagination(0);
    return;
  }

  // 페이지네이션 계산
  const totalPages = Math.ceil(validUsers.length / itemsPerPage);
  
  // 현재 페이지가 유효한 범위인지 확인
  if (currentPage > totalPages) {
    currentPage = totalPages || 1;
  }
  if (currentPage < 1) {
    currentPage = 1;
  }

  // 현재 페이지에 표시할 사용자 추출
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const usersToShow = validUsers.slice(startIndex, endIndex);

  const rows = usersToShow.map(user => {
    // PATCH: role 정규화 - instructor로 통일 (2024-12-19)
    const roleText = {
      'student': '학생',
      'member': '일반/학부모 회원',
      'parent': '학부모',
      'instructor': '강사',
      'admin': '관리자'
    }[user.role] || user.role;

    const createdAt = formatCreatedAt(getUserCreatedAtValue(user)) || '-';
    
    const isAdmin = user.role === "admin";
    const isMember = user.role === "member";
    const isInstructor = user.role === "instructor";
    const instructorStatus = getInstructorLinkStatus(user);
    const instructorStatusHtml = isInstructor
      ? `<span class="instructor-link-chip instructor-link-chip--${instructorStatus}">${getInstructorLinkStatusLabel(instructorStatus)}</span>`
      : "";
    const actionHtml = isAdmin
      ? `<span class="manual-management-badge">수동 관리</span>`
      : isMember
        ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn warning sm" onclick="deleteUser('${user.uid}', '${user.role}')" title="사이트 데이터 정리" style="display:flex;align-items:center;gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
            </button>
          </div>`
        : isInstructor
          ? (instructorStatus === "profileOnly"
            ? `<span class="manual-management-badge">수동 관리</span>`
            : `<div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="btn warning sm" onclick="deleteUser('${user.uid}', '${user.role}')" title="사이트 데이터 정리" style="display:flex;align-items:center;gap:4px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
                </button>
                ${instructorStatus === "linked" ? `<button class="btn sm" onclick="deleteUser('${user.uid}', '${user.role}')" title="강사 계정 연동 해제">강사 계정 미연동</button>` : ""}
              </div>`)
        : `<div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn warning sm" onclick="deleteUser('${user.uid}', '${user.role}')" title="사이트 데이터 정리" style="display:flex;align-items:center;gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
            </button>
          </div>`;

    return `
      <tr>
        <td><span class="pill">${roleText}</span>${instructorStatusHtml}</td>
        <td>${user.name || '-'}</td>
        <td>${user.email || '-'}</td>
        <td>${user.school || user.subject || (user.role === 'member' ? getMemberPurposeLabel(user.memberPurpose) : user.childSchool) || '-'}</td>
        <td>${user.role === 'student' ? formatGrade(user.grade) : (user.role === 'member' ? '-' : (user.childGrade || '-'))}</td>
        <td>${createdAt}</td>
        <td class="muted" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${user.note || ''}">${user.note || '-'}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }).join('');

  tbodyElement.innerHTML = rows;
  
  // 페이지네이션 UI 렌더링
  renderPagination(validUsers.length);
}

// 페이지네이션 UI 렌더링
function renderPagination(totalItems) {
  const paginationContainer = $("#paginationContainer");
  if (!paginationContainer) return;

  if (totalItems === 0) {
    paginationContainer.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (totalPages <= 1) {
    paginationContainer.innerHTML = '';
    return;
  }

  let paginationHTML = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:20px;flex-wrap:wrap;">';
  
  // 이전 페이지 버튼
  if (currentPage > 1) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(${currentPage - 1})" style="padding:6px 12px;">이전</button>`;
  } else {
    paginationHTML += `<button class="btn sm" disabled style="padding:6px 12px;opacity:0.5;cursor:not-allowed;">이전</button>`;
  }

  // 페이지 번호 버튼들
  const maxVisiblePages = 10;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // 시작 페이지 조정
  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // 첫 페이지
  if (startPage > 1) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(1)" style="padding:6px 12px;">1</button>`;
    if (startPage > 2) {
      paginationHTML += `<span style="padding:6px 4px;color:var(--muted);">...</span>`;
    }
  }

  // 페이지 번호들
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      paginationHTML += `<button class="btn sm" style="padding:6px 12px;background:var(--brand);color:#fff;border-color:var(--brand);" disabled>${i}</button>`;
    } else {
      paginationHTML += `<button class="btn sm" onclick="goToPage(${i})" style="padding:6px 12px;">${i}</button>`;
    }
  }

  // 마지막 페이지
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      paginationHTML += `<span style="padding:6px 4px;color:var(--muted);">...</span>`;
    }
    paginationHTML += `<button class="btn sm" onclick="goToPage(${totalPages})" style="padding:6px 12px;">${totalPages}</button>`;
  }

  // 다음 페이지 버튼
  if (currentPage < totalPages) {
    paginationHTML += `<button class="btn sm" onclick="goToPage(${currentPage + 1})" style="padding:6px 12px;">다음</button>`;
  } else {
    paginationHTML += `<button class="btn sm" disabled style="padding:6px 12px;opacity:0.5;cursor:not-allowed;">다음</button>`;
  }

  // 페이지 정보 표시
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  paginationHTML += `<span style="margin-left:16px;color:var(--muted);font-size:13px;">${startItem}-${endItem} / 총 ${totalItems}명</span>`;

  paginationHTML += '</div>';
  paginationContainer.innerHTML = paginationHTML;
}

// 페이지 이동 함수
window.goToPage = (page) => {
  currentPage = page;
  renderUsers(filteredUsers);
  
  // 페이지 상단으로 스크롤
  const table = $("#tblUsers");
  if (table) {
    table.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// 검색
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    filterUsers();
  });
}

if (roleFilterInput) {
  roleFilterInput.addEventListener('change', () => {
    filterUsers();
  });
}

function filterUsers(resetPage = true) {
  if (!usersLoaded) {
    setUsersReadyState();
    return;
  }

  const keyword = searchInput?.value.trim().toLowerCase() || '';
  const roleFilter = roleFilterInput?.value || '';

  let filtered = allUsers;

  if (roleFilter) {
    filtered = filtered.filter(user => {
      if (roleFilter === "member") return user.role === "member" || user.role === "parent";
      return user.role === roleFilter;
    });
  }

  // 검색 필터
  if (keyword) {
    filtered = filtered.filter(user => {
      const name = (user.name || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const phone = [
        user.phone,
        user.parentPhone,
        user.contact,
        user.contactPhone
      ].map(value => String(value || '').toLowerCase()).join(' ');
      return name.includes(keyword) || email.includes(keyword) || phone.includes(keyword);
    });
  }

  // 필터링 시 첫 페이지로 리셋 (사용자가 검색/필터를 변경한 경우)
  if (resetPage) {
    currentPage = 1;
  }
  renderUsers(filtered);
}

let activeStudentCleanupPreview = null;
let activeInstructorCleanupPreview = null;
let activeMemberCleanupPreview = null;
const cleanupCloseTimers = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildCleanupDialogHtml({
  labelId,
  title,
  bodyId,
  confirmId,
  cancelId,
  executeId,
  executeLabel = "데이터 정리 실행",
  extraFooter = ""
}) {
  return `
    <div class="cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="${labelId}">
      <button type="button" class="modal-close cleanup-dialog__close" data-cleanup-close aria-label="닫기">×</button>
      <div class="cleanup-dialog__header">
        <h2 id="${labelId}">${escapeHtml(title)}</h2>
        <p>정리 전 미리보기를 확인한 뒤 확인 문구를 입력해 주세요.</p>
      </div>
      <div id="${bodyId}"></div>
      <div class="cleanup-confirm">
        <div class="cleanup-feedback" data-cleanup-feedback hidden></div>
        <label for="${confirmId}">
          확인 문구 입력
          <strong>${CLEANUP_CONFIRMATION}</strong>
        </label>
        <input type="text" id="${confirmId}" autocomplete="off" placeholder="${CLEANUP_CONFIRMATION}">
      </div>
      <div class="cleanup-dialog__footer">
        <button type="button" class="btn" id="${cancelId}">취소</button>
        ${extraFooter}
        <button type="button" class="btn danger" id="${executeId}">${escapeHtml(executeLabel)}</button>
      </div>
    </div>
  `;
}

function renderCleanupSummaryList(items = []) {
  return `<div class="cleanup-chip-list">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderCleanupTargetCard({ role, name, email, info }) {
  return `
    <section class="cleanup-card cleanup-target-card">
      <span class="cleanup-role-badge">${escapeHtml(role)}</span>
      <div>
        <strong>${escapeHtml(name || "-")}</strong>
        <span>${escapeHtml(email || "-")}</span>
        ${info ? `<span>${escapeHtml(info)}</span>` : ""}
      </div>
    </section>
  `;
}

function renderCleanupCountRows(rows = []) {
  return `
    <div class="cleanup-count-grid">
      ${rows.map((row) => `
        <div class="cleanup-count-row">
          <span>${escapeHtml(row.label)}</span>
          <strong>${Number(row.count || 0).toLocaleString("ko-KR")}건</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function getConfirmationMessage(value) {
  const input = String(value || "").trim();
  if (!input) return "확인 문구를 입력해 주세요.";
  if (input !== CLEANUP_CONFIRMATION) return "확인 문구가 일치하지 않습니다.";
  return "";
}

function setCleanupFeedback(modal, message, type = "error") {
  const root = typeof modal === "string" ? document.getElementById(modal) : modal;
  const feedback = root?.querySelector("[data-cleanup-feedback]");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.type = type;
  feedback.hidden = !message;
  if (message) {
    feedback.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function clearCleanupFeedback(modal) {
  setCleanupFeedback(modal, "", "info");
}

function clearScheduledCleanupClose(modalId) {
  const timer = cleanupCloseTimers.get(modalId);
  if (!timer) return;
  window.clearTimeout(timer);
  cleanupCloseTimers.delete(modalId);
}

function scheduleCleanupModalClose(modalId, closeFn) {
  clearScheduledCleanupClose(modalId);
  const timer = window.setTimeout(() => {
    cleanupCloseTimers.delete(modalId);
    closeFn();
  }, CLEANUP_SUCCESS_CLOSE_DELAY_MS);
  cleanupCloseTimers.set(modalId, timer);
}

function getCleanupErrorMessage(error) {
  const text = String(error?.code || error?.message || error || "").toLowerCase();
  if (text.includes("permission") || text.includes("권한") || text.includes("insufficient")) {
    return "권한 또는 규칙 설정을 확인해 주세요.";
  }
  return "데이터 정리 중 문제가 발생했습니다. 다시 확인해 주세요.";
}

async function buildStudentCleanupPreview(uid) {
  const user = allUsers.find((item) => item.uid === uid && item.role === "student") || {};
  const studentRef = doc(db, "students", uid);
  const [studentSnap, enrollmentRefs, classMemberRefs, sessionAccessRefs] = await Promise.all([
    getDoc(studentRef),
    getRefsByField("enrollments", "userId", uid),
    getRefsByField("offlineClassMembers", "studentUid", uid),
    getRefsByField("offlineSessionAccess", "studentUid", uid)
  ]);
  const student = studentSnap.exists() ? (studentSnap.data() || {}) : user;

  return {
    uid,
    profile: {
      name: student.name || user.name || "",
      email: student.email || user.email || "",
      phone: student.phone || user.phone || "",
      school: student.school || user.school || "",
      grade: student.grade || user.grade || ""
    },
    counts: {
      profile: studentSnap.exists() ? 1 : 0,
      enrollments: enrollmentRefs.length,
      offlineClassMembers: classMemberRefs.length,
      offlineSessionAccess: sessionAccessRefs.length
    }
  };
}

function ensureStudentCleanupModal() {
  let modal = document.getElementById("studentCleanupModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "studentCleanupModal";
  modal.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10000",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "padding:20px",
    "background:rgba(15,23,42,0.55)"
  ].join(";");
  modal.innerHTML = buildCleanupDialogHtml({
    labelId: "studentCleanupTitle",
    title: "데이터 정리",
    bodyId: "studentCleanupBody",
    confirmId: "studentCleanupConfirmInput",
    cancelId: "studentCleanupCancel",
    executeId: "studentCleanupExecute"
  });
  document.body.appendChild(modal);

  modal.querySelector("#studentCleanupCancel")?.addEventListener("click", closeStudentCleanupModal);
  modal.querySelector("[data-cleanup-close]")?.addEventListener("click", closeStudentCleanupModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeStudentCleanupModal();
  });
  modal.querySelector("#studentCleanupExecute")?.addEventListener("click", executeActiveStudentCleanup);
  modal.querySelector("#studentCleanupConfirmInput")?.addEventListener("input", () => {
    clearCleanupFeedback(modal);
  });

  return modal;
}

function renderStudentCleanupModal(preview) {
  activeStudentCleanupPreview = preview;
  const modal = ensureStudentCleanupModal();
  clearScheduledCleanupClose("studentCleanupModal");
  clearCleanupFeedback(modal);
  const body = modal.querySelector("#studentCleanupBody");
  const confirmInput = modal.querySelector("#studentCleanupConfirmInput");
  const executeButton = modal.querySelector("#studentCleanupExecute");
  const profile = preview.profile || {};
  const counts = preview.counts || {};

  if (confirmInput) confirmInput.value = "";
  if (executeButton) executeButton.disabled = false;

  if (body) {
    body.innerHTML = `
      ${renderCleanupTargetCard({
        role: "학생",
        name: profile.name,
        email: profile.email,
        info: `${profile.school || "-"} / ${formatGrade(profile.grade) || "-"}`
      })}
      <section class="cleanup-card">
        <h3>정리 대상</h3>
        ${renderCleanupCountRows([
          { label: "학생 프로필", count: counts.profile },
          { label: "학생 온라인 수강 기록", count: counts.enrollments },
          { label: "오프라인 반 배정 기록", count: counts.offlineClassMembers },
          { label: "오프라인 수업 접근 기록", count: counts.offlineSessionAccess }
        ])}
      </section>
      <div class="cleanup-two-column">
      <section class="cleanup-card">
        <h3>정리되는 항목</h3>
        ${renderCleanupSummaryList(["학생 프로필", "학생 온라인 수강 기록", "오프라인 반 배정/접근 기록"])}
      </section>
      <section class="cleanup-card">
        <h3>유지되는 항목</h3>
        ${renderCleanupSummaryList(["Auth 계정", "강좌 문서", "강사/회원/관리자 계정"])}
      </section>
      </div>
    `;
  }

  modal.style.display = "flex";
  document.body.classList.add("modal-open");
}

function closeStudentCleanupModal() {
  clearScheduledCleanupClose("studentCleanupModal");
  const modal = document.getElementById("studentCleanupModal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
  activeStudentCleanupPreview = null;
}

function setStudentCleanupActionsDisabled(disabled) {
  const executeButton = document.getElementById("studentCleanupExecute");
  const cancelButton = document.getElementById("studentCleanupCancel");
  if (executeButton) executeButton.disabled = disabled;
  if (cancelButton) cancelButton.disabled = disabled;
}

function setStudentCleanupCompleted() {
  const executeButton = document.getElementById("studentCleanupExecute");
  const cancelButton = document.getElementById("studentCleanupCancel");
  if (executeButton) executeButton.disabled = true;
  if (cancelButton) cancelButton.disabled = false;
}

async function openStudentCleanupPreview(uid) {
  const preview = await buildStudentCleanupPreview(uid);
  renderStudentCleanupModal(preview);
}

async function executeActiveStudentCleanup() {
  if (!activeStudentCleanupPreview) return;
  const confirmInput = document.getElementById("studentCleanupConfirmInput");
  const executeButton = document.getElementById("studentCleanupExecute");
  const confirmationError = getConfirmationMessage(confirmInput?.value);
  if (confirmationError) {
    setCleanupFeedback("studentCleanupModal", confirmationError, "error");
    toast(confirmationError, true);
    return;
  }
  clearCleanupFeedback("studentCleanupModal");

  if (executeButton) executeButton.textContent = "정리 중...";
  setStudentCleanupActionsDisabled(true);
  setCleanupFeedback("studentCleanupModal", "데이터를 정리하는 중입니다.", "info");

  let completed = false;
  try {
    await deleteUserFirestoreData(activeStudentCleanupPreview.uid, "student");
    completed = true;
    setCleanupFeedback("studentCleanupModal", "데이터 정리가 완료되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.", "success");
    scheduleCleanupModalClose("studentCleanupModal", closeStudentCleanupModal);
    await loadUsers();
  } catch (error) {
    console.error("학생 데이터 정리 실패:", error);
    setCleanupFeedback("studentCleanupModal", getCleanupErrorMessage(error), "error");
  } finally {
    if (executeButton) executeButton.textContent = completed ? "완료" : "데이터 정리 실행";
    if (completed) {
      setStudentCleanupCompleted();
    } else {
      setStudentCleanupActionsDisabled(false);
    }
  }
}

async function getCourseTitle(courseId) {
  const id = String(courseId || "").trim();
  if (!id) return "제목 없는 강좌";

  try {
    const courseSnap = await getDoc(doc(db, "courses", id));
    if (!courseSnap.exists()) return "제목 없는 강좌";
    const course = courseSnap.data() || {};
    return course.title || course.courseTitle || course.name || "제목 없는 강좌";
  } catch (error) {
    console.warn("[admin-user-add] 회원 정리 강좌명 조회 실패:", id, error);
    return "제목 없는 강좌";
  }
}

function getMemberCleanupProfile(memberSnap, user = {}) {
  const data = memberSnap.exists() ? (memberSnap.data() || {}) : user;
  return {
    exists: memberSnap.exists(),
    name: data.name || user.name || "",
    email: data.email || user.email || "",
    phone: data.phone || user.phone || "",
    memberPurpose: data.memberPurpose || user.memberPurpose || ""
  };
}

async function buildMemberCleanupPreview(uid) {
  const user = allUsers.find((item) => item.uid === uid && item.role === "member") || {};
  const memberRef = doc(db, "members", uid);
  const [memberSnap, enrollmentsSnap, childLinksSnap, childLinkAttemptsSnap] = await Promise.all([
    getDoc(memberRef),
    getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
    getDocs(query(collection(db, "studentParentLinks"), where("memberUid", "==", uid))),
    getDocs(query(collection(db, "memberChildLinkAttempts"), where("memberUid", "==", uid)))
  ]);

  const enrollmentDocs = enrollmentsSnap.docs;
  const childLinkDocs = childLinksSnap.docs;
  const childLinkAttemptDocs = childLinkAttemptsSnap.docs;
  const enrollmentSamples = await Promise.all(enrollmentDocs.slice(0, MEMBER_CLEANUP_SAMPLE_LIMIT).map(async (docSnap) => {
    const row = docSnap.data() || {};
    return {
      courseTitle: await getCourseTitle(row.courseId),
      status: row.status || "active"
    };
  }));

  return {
    uid,
    profile: getMemberCleanupProfile(memberSnap, user),
    refs: {
      member: memberSnap.exists() ? memberRef : null,
      enrollments: enrollmentDocs.map((item) => item.ref),
      childLinks: childLinkDocs.map((item) => item.ref),
      childLinkAttempts: childLinkAttemptDocs.map((item) => item.ref)
    },
    counts: {
      memberProfile: memberSnap.exists() ? 1 : 0,
      enrollments: enrollmentDocs.length,
      childLinks: childLinkDocs.length,
      childLinkAttempts: childLinkAttemptDocs.length
    },
    samples: {
      enrollments: enrollmentSamples,
      childLinks: childLinkDocs.slice(0, MEMBER_CLEANUP_SAMPLE_LIMIT).map((docSnap) => {
        const row = docSnap.data() || {};
        const snapshot = row.studentSnapshot || {};
        return {
          name: snapshot.name || "이름 없음",
          school: snapshot.school || "",
          grade: snapshot.grade || "",
          relation: row.relationDisplay || row.relationLabel || ""
        };
      })
    }
  };
}

function ensureMemberCleanupModal() {
  let modal = document.getElementById("memberCleanupModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "memberCleanupModal";
  modal.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10000",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "padding:20px",
    "background:rgba(15,23,42,0.55)"
  ].join(";");
  modal.innerHTML = buildCleanupDialogHtml({
    labelId: "memberCleanupTitle",
    title: "데이터 정리",
    bodyId: "memberCleanupBody",
    confirmId: "memberCleanupConfirmInput",
    cancelId: "memberCleanupCancel",
    executeId: "memberCleanupExecute"
  });
  document.body.appendChild(modal);

  modal.querySelector("#memberCleanupCancel")?.addEventListener("click", closeMemberCleanupModal);
  modal.querySelector("[data-cleanup-close]")?.addEventListener("click", closeMemberCleanupModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeMemberCleanupModal();
  });
  modal.querySelector("#memberCleanupExecute")?.addEventListener("click", executeActiveMemberCleanup);
  modal.querySelector("#memberCleanupConfirmInput")?.addEventListener("input", () => {
    clearCleanupFeedback(modal);
  });

  return modal;
}

function renderMemberCleanupModal(preview) {
  activeMemberCleanupPreview = preview;
  const modal = ensureMemberCleanupModal();
  clearScheduledCleanupClose("memberCleanupModal");
  clearCleanupFeedback(modal);
  const body = modal.querySelector("#memberCleanupBody");
  const confirmInput = modal.querySelector("#memberCleanupConfirmInput");
  const executeButton = modal.querySelector("#memberCleanupExecute");
  const profile = preview.profile || {};
  const counts = preview.counts || {};
  const enrollmentSamples = preview.samples?.enrollments || [];
  const childLinkSamples = preview.samples?.childLinks || [];

  if (confirmInput) confirmInput.value = "";
  if (executeButton) executeButton.disabled = false;

  if (body) {
    body.innerHTML = `
      ${renderCleanupTargetCard({
        role: getMemberPurposeLabel(profile.memberPurpose),
        name: profile.name,
        email: profile.email,
        info: profile.phone || ""
      })}
      <section class="cleanup-card">
      <h3>정리 대상</h3>
      ${renderCleanupCountRows([
        { label: "회원 프로필", count: counts.memberProfile },
        { label: "온라인 수강 기록", count: counts.enrollments },
        { label: "자녀 연결 기록", count: counts.childLinks },
        { label: "자녀 연결 시도 기록", count: counts.childLinkAttempts }
      ])}
      </section>
      <section class="cleanup-card">
      <h3>온라인 수강 기록</h3>
      ${enrollmentSamples.length ? `
        <div class="cleanup-chip-list">
          ${enrollmentSamples.map((item) => `<span>${escapeHtml(item.courseTitle)} / ${escapeHtml(item.status || "active")}</span>`).join("")}
        </div>
      ` : '<p class="muted" style="margin:0;">온라인 수강 기록이 없습니다.</p>'}
      </section>
      <section class="cleanup-card">
      <h3>자녀 연결 기록</h3>
      ${childLinkSamples.length ? `
        <div class="cleanup-chip-list">
          ${childLinkSamples.map((item) => `<span>${escapeHtml(item.name)}${item.school ? ` / ${escapeHtml(item.school)}` : ""}${item.grade ? ` / ${escapeHtml(formatGrade(item.grade))}` : ""}${item.relation ? ` / 관계 ${escapeHtml(item.relation)}` : ""}</span>`).join("")}
        </div>
      ` : '<p class="muted" style="margin:0;">자녀 연결 기록이 없습니다.</p>'}
      </section>
      <div class="cleanup-two-column">
      <section class="cleanup-card">
        <h3>정리되는 항목</h3>
        ${renderCleanupSummaryList(["회원 프로필", "온라인 수강 기록", "자녀 연결 기록", "자녀 연결 시도 기록"])}
      </section>
      <section class="cleanup-card">
        <h3>유지되는 항목</h3>
        ${renderCleanupSummaryList(["Auth 계정", "연결된 학생 계정", "강좌", "오프라인 반/수업/영상/접근 권한"])}
      </section>
      </div>
    `;
  }

  modal.style.display = "flex";
  document.body.classList.add("modal-open");
}

function closeMemberCleanupModal() {
  clearScheduledCleanupClose("memberCleanupModal");
  const modal = document.getElementById("memberCleanupModal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
  activeMemberCleanupPreview = null;
}

function setMemberCleanupActionsDisabled(disabled) {
  const executeButton = document.getElementById("memberCleanupExecute");
  const cancelButton = document.getElementById("memberCleanupCancel");
  if (executeButton) executeButton.disabled = disabled;
  if (cancelButton) cancelButton.disabled = disabled;
}

function setMemberCleanupCompleted() {
  const executeButton = document.getElementById("memberCleanupExecute");
  const cancelButton = document.getElementById("memberCleanupCancel");
  if (executeButton) executeButton.disabled = true;
  if (cancelButton) cancelButton.disabled = false;
}

async function openMemberCleanupPreview(uid) {
  const preview = await buildMemberCleanupPreview(uid);
  renderMemberCleanupModal(preview);
}

async function executeActiveMemberCleanup() {
  if (!activeMemberCleanupPreview) return;
  const confirmInput = document.getElementById("memberCleanupConfirmInput");
  const executeButton = document.getElementById("memberCleanupExecute");
  const confirmationError = getConfirmationMessage(confirmInput?.value);
  if (confirmationError) {
    setCleanupFeedback("memberCleanupModal", confirmationError, "error");
    toast(confirmationError, true);
    return;
  }
  clearCleanupFeedback("memberCleanupModal");

  if (executeButton) executeButton.textContent = "정리 중...";
  setMemberCleanupActionsDisabled(true);
  setCleanupFeedback("memberCleanupModal", "데이터를 정리하는 중입니다.", "info");

  let completed = false;
  try {
    const refsToDelete = [
      activeMemberCleanupPreview.refs.member,
      ...activeMemberCleanupPreview.refs.enrollments,
      ...activeMemberCleanupPreview.refs.childLinks,
      ...activeMemberCleanupPreview.refs.childLinkAttempts
    ].filter(Boolean);
    await deleteRefsInBatches(refsToDelete);
    completed = true;
    setCleanupFeedback("memberCleanupModal", "데이터 정리가 완료되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.", "success");
    scheduleCleanupModalClose("memberCleanupModal", closeMemberCleanupModal);
    await loadUsers();
  } catch (error) {
    console.error("데이터 정리 실패:", error);
    setCleanupFeedback("memberCleanupModal", getCleanupErrorMessage(error), "error");
  } finally {
    if (executeButton) executeButton.textContent = completed ? "완료" : "데이터 정리 실행";
    if (completed) {
      setMemberCleanupCompleted();
    } else {
      setMemberCleanupActionsDisabled(false);
    }
  }
}

function ensureInstructorCleanupModal() {
  let modal = document.getElementById("instructorCleanupModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "instructorCleanupModal";
  modal.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10000",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "padding:20px",
    "background:rgba(15,23,42,0.55)"
  ].join(";");
  modal.innerHTML = buildCleanupDialogHtml({
    labelId: "instructorCleanupTitle",
    title: "데이터 정리",
    bodyId: "instructorCleanupBody",
    confirmId: "instructorCleanupConfirmInput",
    cancelId: "instructorCleanupCancel",
    executeId: "instructorCleanupExecute",
    extraFooter: '<button type="button" class="btn" id="instructorCleanupUnlink">강사 계정 연동 해제</button>'
  });
  document.body.appendChild(modal);

  modal.querySelector("#instructorCleanupCancel")?.addEventListener("click", closeInstructorCleanupModal);
  modal.querySelector("[data-cleanup-close]")?.addEventListener("click", closeInstructorCleanupModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeInstructorCleanupModal();
  });
  modal.querySelector("#instructorCleanupExecute")?.addEventListener("click", executeActiveInstructorCleanup);
  modal.querySelector("#instructorCleanupUnlink")?.addEventListener("click", executeActiveInstructorUnlink);
  modal.querySelector("#instructorCleanupConfirmInput")?.addEventListener("input", () => {
    clearCleanupFeedback(modal);
  });

  return modal;
}

function countLine(label, count) {
  return `<li><strong>${escapeHtml(label)}:</strong> ${Number(count || 0).toLocaleString("ko-KR")}개</li>`;
}

function renderInstructorCleanupModal(preview, user = {}) {
  activeInstructorCleanupPreview = preview;
  const modal = ensureInstructorCleanupModal();
  clearScheduledCleanupClose("instructorCleanupModal");
  clearCleanupFeedback(modal);
  const body = modal.querySelector("#instructorCleanupBody");
  const confirmInput = modal.querySelector("#instructorCleanupConfirmInput");
  const executeButton = modal.querySelector("#instructorCleanupExecute");
  const counts = preview.counts || {};
  const unlink = preview.unlink || {};
  const manualReviewCount =
    (counts.nameOnlyCourses || 0) +
    (counts.nameOnlyOfflineClasses || 0) +
    (counts.nameOnlyPublicTimetableEntries || 0);

  if (confirmInput) confirmInput.value = "";
  if (executeButton) executeButton.disabled = false;

  if (body) {
    body.innerHTML = `
      ${renderCleanupTargetCard({
        role: "강사",
        name: user.name,
        email: user.email,
        info: user.subject || ""
      })}
      <section class="cleanup-card">
      <h3>정리 대상</h3>
      ${renderCleanupCountRows([
        { label: "온라인 강좌 배정 해제", count: counts.courses },
        { label: "오프라인 반 배정 해제", count: counts.offlineClasses },
        { label: "공개 시간표 배정 해제", count: counts.publicTimetableEntries },
        { label: "강사 프로필 문서 삭제", count: (preview.profileDocIds || []).length },
        { label: "강사 계정 정보", count: 1 }
      ])}
      </section>
      <div class="cleanup-two-column">
      <section class="cleanup-card">
        <h3>정리되는 항목</h3>
        ${renderCleanupSummaryList(["강사 프로필/계정 관련 사이트 데이터", "강좌/반/시간표의 강사 배정 정보"])}
      </section>
      <section class="cleanup-card">
        <h3>유지되는 항목</h3>
        ${renderCleanupSummaryList(["Auth 계정", "온라인 강좌 문서", "오프라인 반/수업/접근 권한 기록", "공개 시간표 항목"])}
      </section>
      </div>
      <section class="cleanup-card">
      <h3>${unlink.canUnlink ? "강사 계정 미연동" : "연동된 강사 정보 없음"}</h3>
      <p style="margin:0 0 12px;">${unlink.canUnlink ? "강사 계정 연동을 해제하면 프로필/배정 정보는 보존하거나 다시 연결할 수 있습니다." : "이미 연동 해제된 계정이거나 자동으로 해제할 강사 연결을 찾을 수 없습니다."}</p>
      <p class="muted" style="margin:0 0 12px;">Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.</p>
      ${unlink.canUnlink ? "" : `
        <div style="padding:12px;border-radius:12px;background:var(--danger-bg, #fee2e2);color:var(--danger-color, #991b1b);margin-bottom:14px;">
          강사 계정 연동 해제를 자동 실행할 수 없습니다. ${escapeHtml(unlink.error || "보존할 강사 프로필을 확정할 수 없습니다.")}
        </div>
      `}
      ${manualReviewCount ? `
        <div style="padding:12px;border-radius:12px;background:var(--info-bg, #eff6ff);color:var(--info-color, #1d4ed8);">
          이름만 일치하는 수동 확인 후보가 ${manualReviewCount.toLocaleString("ko-KR")}개 있습니다.
          이름만 일치하는 항목은 자동 정리하지 않고, 아래 자동 정리 개수에도 포함하지 않습니다.
        </div>
        ${renderCleanupCountRows([
          { label: "온라인 강좌 이름-only 후보", count: counts.nameOnlyCourses },
          { label: "오프라인 반 이름-only 후보", count: counts.nameOnlyOfflineClasses },
          { label: "공개 시간표 이름-only 후보", count: counts.nameOnlyPublicTimetableEntries }
        ])}
      ` : '<p class="muted" style="margin:0;">이름만 일치하는 수동 확인 후보는 없습니다.</p>'}
      </section>
    `;
  }

  const unlinkButton = modal.querySelector("#instructorCleanupUnlink");
  if (unlinkButton) {
    unlinkButton.hidden = !unlink.canUnlink;
    unlinkButton.disabled = !unlink.canUnlink;
    unlinkButton.title = unlink.canUnlink ? "" : (unlink.error || "강사 계정 연동 해제를 자동 실행할 수 없습니다.");
    unlinkButton.textContent = "강사 계정 미연동";
  }

  modal.style.display = "flex";
  document.body.classList.add("modal-open");
}

function closeInstructorCleanupModal() {
  clearScheduledCleanupClose("instructorCleanupModal");
  const modal = document.getElementById("instructorCleanupModal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
  activeInstructorCleanupPreview = null;
}

function setInstructorCleanupActionsDisabled(disabled) {
  const executeButton = document.getElementById("instructorCleanupExecute");
  const unlinkButton = document.getElementById("instructorCleanupUnlink");
  const cancelButton = document.getElementById("instructorCleanupCancel");
  if (executeButton) executeButton.disabled = disabled;
  if (unlinkButton && !unlinkButton.hidden) unlinkButton.disabled = disabled || !(activeInstructorCleanupPreview?.unlink?.canUnlink);
  if (cancelButton) cancelButton.disabled = disabled;
}

function setInstructorCleanupCompleted() {
  const executeButton = document.getElementById("instructorCleanupExecute");
  const unlinkButton = document.getElementById("instructorCleanupUnlink");
  const cancelButton = document.getElementById("instructorCleanupCancel");
  if (executeButton) executeButton.disabled = true;
  if (unlinkButton && !unlinkButton.hidden) unlinkButton.disabled = true;
  if (cancelButton) cancelButton.disabled = false;
}

async function openInstructorCleanupPreview(uid) {
  const user = allUsers.find((item) => item.uid === uid && item.role === "instructor") || {};
  const preview = await buildInstructorAccountCleanupPreview(uid);
  renderInstructorCleanupModal(preview, user);
}

async function executeActiveInstructorCleanup() {
  if (!activeInstructorCleanupPreview) return;
  const confirmInput = document.getElementById("instructorCleanupConfirmInput");
  const executeButton = document.getElementById("instructorCleanupExecute");
  const confirmationError = getConfirmationMessage(confirmInput?.value);
  if (confirmationError) {
    setCleanupFeedback("instructorCleanupModal", confirmationError, "error");
    toast(confirmationError, true);
    return;
  }
  clearCleanupFeedback("instructorCleanupModal");

  if (executeButton) {
    executeButton.textContent = "정리 중...";
  }
  setInstructorCleanupActionsDisabled(true);
  setCleanupFeedback("instructorCleanupModal", "데이터를 정리하는 중입니다.", "info");

  let completed = false;
  try {
    await executeInstructorAccountCleanup(activeInstructorCleanupPreview);
    completed = true;
    setCleanupFeedback("instructorCleanupModal", "데이터 정리가 완료되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.", "success");
    scheduleCleanupModalClose("instructorCleanupModal", closeInstructorCleanupModal);
    await loadUsers();
  } catch (error) {
    console.error("강사 데이터 정리 실패:", error);
    setCleanupFeedback("instructorCleanupModal", getCleanupErrorMessage(error), "error");
  } finally {
    if (executeButton) {
      executeButton.textContent = completed ? "완료" : "데이터 정리 실행";
    }
    if (completed) {
      setInstructorCleanupCompleted();
    } else {
      setInstructorCleanupActionsDisabled(false);
    }
  }
}

async function executeActiveInstructorUnlink() {
  if (!activeInstructorCleanupPreview) return;
  const confirmationModal = await requestPhraseConfirmation({
    title: "강사 계정 연동 해제",
    message: "강사 로그인 계정과 프로필의 연결을 해제합니다. Auth 계정은 삭제되지 않습니다.",
    phrase: "연동 해제",
    confirmLabel: "연동 해제",
    pendingMessage: "강사 계정 연동을 해제하는 중입니다.",
    notifyError: (message) => {
      setCleanupFeedback("instructorCleanupModal", message, "error");
      toast(message, true);
    },
  });
  if (!confirmationModal) return;
  const unlinkButton = document.getElementById("instructorCleanupUnlink");
  if (unlinkButton) {
    unlinkButton.textContent = "연동 해제 중...";
  }
  setInstructorCleanupActionsDisabled(true);
  setCleanupFeedback("instructorCleanupModal", "데이터를 정리하는 중입니다.", "info");

  let completed = false;
  try {
    await executeInstructorAccountUnlink(activeInstructorCleanupPreview);
    completed = true;
    const successMessage = "강사 계정 연동이 해제되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.";
    setCleanupFeedback("instructorCleanupModal", successMessage, "success");
    confirmationModal.success("강사 계정 연동이 해제되었습니다.");
    toast("강사 계정 연동이 해제되었습니다.");
    await loadUsers();
  } catch (error) {
    console.error("강사 계정 연동 해제 실패:", error);
    const errorMessage = getCleanupErrorMessage(error);
    setCleanupFeedback("instructorCleanupModal", errorMessage, "error");
    confirmationModal.error(errorMessage);
    toast(errorMessage, true);
  } finally {
    if (unlinkButton) {
      unlinkButton.textContent = completed ? "완료" : "강사 계정 미연동";
    }
    if (completed) {
      setInstructorCleanupCompleted();
    } else {
      setInstructorCleanupActionsDisabled(false);
    }
  }
}

// 사용자 삭제 (Firestore 관련 데이터 정리)
window.deleteUser = async (uid, role) => {
  if (role === "admin") {
    toast("관리자 계정/권한 변경은 현재 수동으로 처리합니다.", true);
    return;
  }

  if (role === "student") {
    try {
      await openStudentCleanupPreview(uid);
    } catch (error) {
      console.error("학생 데이터 정리 미리보기 실패:", error);
      toast("데이터 정리 대상을 확인하지 못했습니다. 다시 확인해 주세요.", true);
    }
    return;
  }

  if (role === "instructor") {
    try {
      await openInstructorCleanupPreview(uid);
    } catch (error) {
      console.error("강사 데이터 정리 미리보기 실패:", error);
      toast("데이터 정리 대상을 확인하지 못했습니다. 다시 확인해 주세요.", true);
    }
    return;
  }

  if (role === "member") {
    try {
      await openMemberCleanupPreview(uid);
    } catch (error) {
      console.error("데이터 정리 미리보기 실패:", error);
      toast("데이터 정리 대상을 확인하지 못했습니다. 다시 확인해 주세요.", true);
    }
    return;
  }

  const roleText = role === "student" ? "학생" : role === "instructor" ? "강사" : "사용자";
  const cleanupDetails = role === "student"
    ? "\n\n학생 데이터 정리 범위:\n- 학생 프로필\n- 온라인 수강 기록\n- 오프라인 반 배정 기록\n- 오프라인 수업 접근 기록\n- 호환용 사용자 정보"
    : role === "instructor"
      ? "\n\n강사 데이터 정리 범위:\n- 강사 프로필/계정 관련 사이트 데이터\n- 호환용 사용자 정보\n\n담당 강좌/반 연결 상태는 별도 확인이 필요할 수 있습니다."
      : "";
  const message = `이 작업은 사이트에 저장된 사용자 정보와 연결 데이터를 정리합니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.${cleanupDetails}\n\n${roleText} 사이트 데이터를 정리할까요?`;
  if (!confirm(message)) return;

  // 삭제 중 표시
  toast("사이트 데이터 정리 중...", false);
  
  try {
    const result = await deleteUserFirestoreData(uid, role);
    
    // 성공 메시지
    toast(`데이터 정리가 완료되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요. (${result.deletedCount}개 문서, ${result.deletedFieldCount}개 필드 정리)`, false);
    
    // 페이지 새로고침 (목록 업데이트)
    setTimeout(() => {
      loadUsers();
    }, 1500);
  } catch (error) {
    console.error("사이트 데이터 정리 실패:", error);
    toast(getCleanupErrorMessage(error), true);
  }
};

// 메인 탭 전환 (이벤트 위임 사용)
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tab-main-btn');
  if (!tabBtn) return;
  
  e.preventDefault();
  const tabId = tabBtn.dataset.tab;
  if (!tabId) return;
  
  
  // 모든 탭 버튼 비활성화
  document.querySelectorAll('.tab-main-btn').forEach(b => {
    b.classList.remove('active');
    b.style.color = 'var(--muted)';
    b.style.borderBottom = '3px solid transparent';
  });
  
  // 선택한 탭 버튼 활성화
  tabBtn.classList.add('active');
  tabBtn.style.color = 'var(--text)';
  tabBtn.style.borderBottom = '3px solid var(--brand)';
  
  // 모든 탭 콘텐츠 숨기기
  document.querySelectorAll('.tab-main-content').forEach(c => {
    c.style.display = 'none';
  });
  
  // 선택한 탭 콘텐츠 표시
  const targetTab = document.querySelector(`#tab-${tabId}`);
  if (targetTab) {
    targetTab.style.display = 'block';
  } else {
    console.error('탭을 찾을 수 없음:', `#tab-${tabId}`);
  }
  
  // 버튼 표시/숨김
  const refreshBtn = document.querySelector("#refreshUsers");
  const dlBtn = document.querySelector("#dlUsers");
  
  if (tabId === 'signup') {
    // 회원가입 설정 탭으로 전환 시 설정 로드
    loadSignupSettings();
  } else if (tabId === 'users') {
    if (refreshBtn) refreshBtn.style.display = 'inline-block';
    if (dlBtn) dlBtn.style.display = 'inline-block';
  }
});

// 새로고침
$("#refreshUsers")?.addEventListener("click", () => {
  loadUsers();
  if (usersLoaded) toast("새로고침되었습니다.");
});


// 엑셀 다운로드 (비밀번호/초기 비밀번호는 포함하지 않음)
$("#dlUsers")?.addEventListener("click", async () => {
  try {
    const rows = allUsers.map(u => {
      if (u.role === 'student') {
        return {
          역할: '학생',
          이름: u.name || "",
          이메일: u.email || "",
          학교: u.school || "",
          학년: formatGrade(u.grade),
          전화번호: u.phone || "",
          이용약관동의: getConsentStatusLabel(u.termsAgreed),
          개인정보동의: getConsentStatusLabel(u.privacyAgreed),
          동의출처: getConsentSourceLabel(u.consentSource),
          적용버전: u.policyVersion || "",
          광고성정보수신동의: getMarketingConsentStatusLabel(getMarketingConsent(u)),
          마케팅동의일: formatCreatedAt(getMarketingConsent(u).agreedAt),
          마케팅수정일: formatCreatedAt(getMarketingConsent(u).updatedAt),
          마케팅철회일: formatCreatedAt(getMarketingConsent(u).withdrawnAt),
          생성일: formatCreatedAt(getUserCreatedAtValue(u)),
          비고: u.note || ""
        };
      } else if (u.role === 'member') {
        return {
          역할: '회원',
          이름: u.name || "",
          이메일: u.email || "",
          회원유형: getMemberPurposeLabel(u.memberPurpose),
          전화번호: u.phone || "",
          상태: u.status || "active",
          이용약관동의: getConsentStatusLabel(u.termsAgreed),
          개인정보동의: getConsentStatusLabel(u.privacyAgreed),
          동의출처: getConsentSourceLabel(u.consentSource),
          적용버전: u.policyVersion || "",
          광고성정보수신동의: getMarketingConsentStatusLabel(getMarketingConsent(u)),
          마케팅동의일: formatCreatedAt(getMarketingConsent(u).agreedAt),
          마케팅수정일: formatCreatedAt(getMarketingConsent(u).updatedAt),
          마케팅철회일: formatCreatedAt(getMarketingConsent(u).withdrawnAt),
          생성일: formatCreatedAt(getUserCreatedAtValue(u)),
          비고: u.note || ""
        };
      // PATCH: role 정규화 - instructor로 통일 (2024-12-19)
      } else if (u.role === 'instructor') {
        return {
          역할: '강사',
          이름: u.name || "",
          이메일: u.email || "",
          과목: u.subject || "",
          생성일: formatCreatedAt(getUserCreatedAtValue(u)),
          비고: u.note || ""
        };
      } else {
        return {
          역할: '관리자',
          이름: u.name || "",
          이메일: u.email || "",
          생성일: formatCreatedAt(getUserCreatedAtValue(u)),
          비고: u.note || ""
        };
      }
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "사용자");
    XLSX.writeFile(wb, "그릿에듀_사용자목록.xlsx");
    toast("엑셀 파일이 다운로드되었습니다.");
  } catch (error) {
    console.error("엑셀 다운로드 실패:", error);
    toast("엑셀 다운로드 실패: " + (error.message || error), true);
  }
});

// 초기 탭 버튼 표시 설정 (DOM 로드 후)
function initTabButtons() {
  const refreshBtn = $("#refreshUsers");
  const dlBtn = $("#dlUsers");
  setUsersReadyState();
  if (refreshBtn) {
    refreshBtn.style.display = 'flex';
    refreshBtn.textContent = "현황 불러오기";
  }
  if (dlBtn) dlBtn.style.display = 'flex';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTabButtons);
} else {
  initTabButtons();
}

// 회원가입 설정 관리
const signupSettingsRef = doc(db, "settings", "signup");

function normalizeSignupSettings(raw = {}) {
  let enabled = raw.enabled !== false;
  let studentEnabled = raw.studentEnabled !== false;
  let memberEnabled = raw.memberEnabled !== false;

  if (!enabled) {
    studentEnabled = false;
    memberEnabled = false;
  } else if (!studentEnabled && !memberEnabled) {
    enabled = false;
  }

  return {
    ...raw,
    enabled,
    studentEnabled,
    memberEnabled
  };
}

function applySignupSettingChange(currentSettings, field, value) {
  const normalizedField = field === "parentEnabled" ? "memberEnabled" : field;
  const nextSettings = {
    ...currentSettings,
    enabled: currentSettings.enabled !== false,
    studentEnabled: currentSettings.studentEnabled !== false,
    memberEnabled: currentSettings.memberEnabled !== false
  };

  if (normalizedField === "enabled") {
    nextSettings.enabled = value;
    if (!value) {
      nextSettings.studentEnabled = false;
      nextSettings.memberEnabled = false;
    } else if (!nextSettings.studentEnabled && !nextSettings.memberEnabled) {
      nextSettings.studentEnabled = true;
      nextSettings.memberEnabled = true;
    }
  } else if (normalizedField === "studentEnabled" || normalizedField === "memberEnabled") {
    nextSettings[normalizedField] = value;
    if (value) {
      nextSettings.enabled = true;
    } else if (!nextSettings.studentEnabled && !nextSettings.memberEnabled) {
      nextSettings.enabled = false;
    }
  }

  return nextSettings;
}

// 회원가입 설정 로드
async function loadSignupSettings() {
  try {
    const result = await getSettingDoc("signup");
    const settings = normalizeSignupSettings(result.exists ? result.data : {
      enabled: true,
      studentEnabled: true,
      memberEnabled: true
    });

    // 토글 상태 업데이트
    const signupToggle = document.getElementById("signupEnabledToggle");
    const studentToggle = document.getElementById("studentSignupToggle");
    const memberToggle = document.getElementById("memberSignupToggle");

    if (signupToggle) signupToggle.checked = settings.enabled;
    if (studentToggle) studentToggle.checked = settings.studentEnabled;
    if (memberToggle) memberToggle.checked = settings.memberEnabled;

    // 토글 비활성화 상태 업데이트
    updateToggleStates(settings);
  } catch (error) {
    console.error("회원가입 설정 로드 실패:", error);
    toast("회원가입 설정을 불러오는데 실패했습니다.", true);
  }
}

// 회원가입 설정 업데이트
window.updateSignupSetting = async function(field, value) {
  try {
    const currentResult = await getSettingDoc("signup");
    const currentSettings = normalizeSignupSettings(currentResult.exists ? currentResult.data : {
      enabled: true,
      studentEnabled: true,
      memberEnabled: true
    });

    const newSettings = applySignupSettingChange(currentSettings, field, value);
    newSettings.parentEnabled = deleteField();
    newSettings.updatedAt = serverTimestamp();

    await setDoc(signupSettingsRef, newSettings, { merge: true });
    invalidateSetting("signup");

    // 토글 상태 업데이트
    const signupToggle = document.getElementById("signupEnabledToggle");
    const studentToggle = document.getElementById("studentSignupToggle");
    const memberToggle = document.getElementById("memberSignupToggle");

    if (signupToggle) signupToggle.checked = newSettings.enabled;
    if (studentToggle) studentToggle.checked = newSettings.studentEnabled;
    if (memberToggle) memberToggle.checked = newSettings.memberEnabled;

    // 토글 비활성화 상태 업데이트
    updateToggleStates(newSettings);

    toast(`✅ 회원가입 설정이 업데이트되었습니다.`, false);
  } catch (error) {
    console.error("회원가입 설정 업데이트 실패:", error);
    toast("❌ 설정 업데이트 실패: " + error.message, true);
    
    // 실패 시 원래 상태로 복구
    await loadSignupSettings();
  }
};

// 토글 비활성화 상태 업데이트
function updateToggleStates(settings) {
  const signupToggle = document.getElementById("signupEnabledToggle");
  const studentToggle = document.getElementById("studentSignupToggle");
  const memberToggle = document.getElementById("memberSignupToggle");

  if (signupToggle && studentToggle && memberToggle) {
    signupToggle.checked = settings.enabled !== false;
    studentToggle.checked = settings.studentEnabled !== false;
    memberToggle.checked = settings.memberEnabled !== false;
    studentToggle.disabled = false;
    memberToggle.disabled = false;
    studentToggle.parentElement.style.opacity = "1";
    memberToggle.parentElement.style.opacity = "1";
  }
}
