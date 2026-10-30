// /assets/js/pages/admin-user-add.js
// 사용자 관리 페이지
import { app, db, requireRole } from "/assets/js/firebase-init.js";
import {
  doc, getDoc, getDocs, setDoc, deleteField, serverTimestamp, collection, writeBatch, query, where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getSettingDoc, invalidateSetting } from "/assets/js/utils/settings-cache.js";
import { setAdminRefreshButtonState } from "/assets/js/utils/admin-refresh.js";
import {
  getAuth, createUserWithEmailAndPassword, deleteUser as deleteAuthUser, setPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { initializeApp as initApp2 } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { adminXlsxFilename, writeAdminXlsx } from "/assets/js/utils/admin-xlsx.js";
import { showAdminToast } from "/assets/js/utils/admin-toast.js";
import { formatGrade, normalizeGrade } from "/assets/js/utils/grade.js";
import { validatePhone } from "/assets/js/utils/validation.js";
import { CONSENT_SOURCE_ADMIN, LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";
import {
  buildInstructorAccountCleanupPreview,
  executeInstructorAccountCleanup,
  executeInstructorAccountUnlink
} from "/assets/js/utils/instructor-account-cleanup.js";
import {
  getInstructorSubjects,
  loadInstructorMenuSubjects,
  normalizeSubjectList
} from "/assets/js/utils/instructor-subjects.js";
import { requestPhraseConfirmation } from "/assets/js/utils/confirm-phrase-modal.js";
import { mergeInstructorPrivate, privateInstructorData, publicInstructorData, selectInstructorProfileForAccount } from "/assets/js/utils/instructor-privacy.js";
import { setupPasswordVisibilityToggles } from "/assets/js/utils/password-visibility.js";
import {
  bindCommittedSearch,
  normalizeListPageSize,
  renderListPagination,
} from "/assets/js/utils/list-controls.js";

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

const DELETABLE_ROLES = ["student", "instructor", "admin"];

async function getRefsByField(collectionName, fieldName, value) {
  const snap = await getDocs(query(collection(db, collectionName), where(fieldName, "==", value)));
  return snap.docs.map((item) => item.ref);
}

async function getAccountTransientCleanupRefs(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { emailVerifications: [], signupAttempts: [] };
  }

  const verificationRef = doc(db, "emailVerifications", normalizedEmail);
  const [verificationSnap, signupAttemptRefs] = await Promise.all([
    getDoc(verificationRef),
    getRefsByField("signupAttempts", "email", normalizedEmail)
  ]);

  return {
    emailVerifications: verificationSnap.exists() ? [verificationRef] : [],
    signupAttempts: signupAttemptRefs
  };
}

function createCleanupOperatorError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.isOperatorSafe = true;
  return error;
}

function isBlockingStudentParentLink(docSnap) {
  return String(docSnap.data()?.status || "active").trim() !== "revoked";
}

async function loadStudentCleanupData(uid, fallbackUser = {}) {
  const studentRef = doc(db, "students", uid);
  const [
    studentSnap,
    enrollmentRefs,
    classMemberRefs,
    sessionAccessRefs,
    parentLinksSnap,
    childLinkAttemptRefs
  ] = await Promise.all([
    getDoc(studentRef),
    getRefsByField("enrollments", "userId", uid),
    getRefsByField("offlineClassMembers", "studentUid", uid),
    getRefsByField("offlineSessionAccess", "studentUid", uid),
    getDocs(query(collection(db, "studentParentLinks"), where("studentUid", "==", uid))),
    getRefsByField("memberChildLinkAttempts", "matchedStudentUid", uid)
  ]);
  const student = studentSnap.exists() ? (studentSnap.data() || {}) : fallbackUser;
  const transientRefs = await getAccountTransientCleanupRefs(student.email || fallbackUser.email);
  const parentLinkDocs = parentLinksSnap.docs;
  const blockingParentLinks = parentLinkDocs.filter(isBlockingStudentParentLink);

  return {
    studentRef: studentSnap.exists() ? studentRef : null,
    student,
    enrollmentRefs,
    classMemberRefs,
    sessionAccessRefs,
    parentLinkRefs: parentLinkDocs.map((item) => item.ref),
    blockingParentLinks,
    childLinkAttemptRefs,
    transientRefs
  };
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

async function deleteUserFirestoreData(uid, role, fallbackUser = {}) {
  if (!DELETABLE_ROLES.includes(role)) {
    throw new Error("알 수 없는 사용자 역할입니다.");
  }
  if (role === "admin") {
    throw new Error("관리자 권한 관리는 현재 수동으로 처리합니다.");
  }

  const refsToDelete = [];

  if (role === "student") {
    const cleanupData = await loadStudentCleanupData(uid, fallbackUser);
    if (cleanupData.blockingParentLinks.length > 0) {
      throw createCleanupOperatorError(
        "active-parent-link",
        "활성 자녀 연결이 남아 있습니다. 회원 관리에서 연결을 먼저 해제한 뒤 다시 시도해 주세요."
      );
    }

    refsToDelete.push(
      ...cleanupData.enrollmentRefs,
      ...cleanupData.classMemberRefs,
      ...cleanupData.sessionAccessRefs,
      ...cleanupData.parentLinkRefs,
      ...cleanupData.childLinkAttemptRefs,
      ...cleanupData.transientRefs.signupAttempts,
      ...cleanupData.transientRefs.emailVerifications,
      cleanupData.studentRef
    );
  } else if (role === "instructor") {
    throw new Error("강사 데이터 정리는 미리보기 확인 후 실행해야 합니다.");
  }

  const deletedCount = await deleteRefsInBatches(refsToDelete.filter(Boolean));
  return { deletedCount };
}

function sanitizeInstructorVideos(videos) {
  if (!Array.isArray(videos)) return [];
  return videos.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const rest = { ...item };
    delete rest.youtube_url;
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
    subjects: getInstructorSubjects(data),
    bio: data.bio || "",
    brief: data.brief || "",
    photo,
    videos: sanitizeInstructorVideos(data.videos),
    curriculumImageUrl,
    curriculumImageUrls,
    instructorId,
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

async function loadInstructorProfilesWithPrivate() {
  const [profiles, privateSnap, accountsSnap] = await Promise.all([
    getDocs(collection(db, "instructors")),
    getDocs(collection(db, "instructorPrivate")),
    getDocs(collection(db, "instructorAccounts"))
  ]);
  const privateById = new Map(privateSnap.docs.map((snap) => [snap.id, snap.data() || {}]));
  const accountByProfileId = new Map(accountsSnap.docs.map((snap) => [
    String(snap.data()?.instructorId || "").trim(), { ...(snap.data() || {}), uid: snap.id }
  ]));
  return profiles.docs.map((snap) => ({
    ...mergeInstructorPrivate(
      snap.data() || {},
      privateById.get(snap.id),
      accountByProfileId.get(snap.id) || accountByProfileId.get(String(snap.data()?.instructorId || "").trim())
    ),
    id: snap.id,
    instructorId: snap.id
  }));
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
  showAdminToast(msg, err);
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

async function findInstructorProfileForAccount(userData, emailLower) {
  const profiles = await loadInstructorProfilesWithPrivate();
  return selectInstructorProfileForAccount(profiles, { ...userData, emailLower });
}

function buildInstructorAccountPayload({ uid, instructorId, name, email, emailLower, subject, subjects }) {
  return {
    uid,
    instructorId,
    name,
    email,
    emailLower,
    subject,
    subjects: normalizeSubjectList(subjects),
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
  userData.subjects = normalizeSubjectList(userData.subjects || userData.subject);
  userData.subject = userData.subjects[0] || "";
  if (userData.role === 'instructor' && userData.subjects.length === 0) {
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
    const finalName = normalizeText(userData.name);

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
    const subjects = existingInstructor
      ? getInstructorSubjects(existingInstructor)
      : normalizeSubjectList(userData.subjects);
    const subject = subjects[0] || "";
    const phone = normalizeText(userData.phone || existingInstructor?.phone);

    const profilePayload = publicInstructorData(buildPublicInstructorProfile({
        ...(existingInstructor || {}),
        name,
        email: instructorEmail,
        subject,
        subjects,
        phone,
        pending: false
      }, instructorId));

    const instructorBatch = writeBatch(db);
    instructorBatch.set(doc(db, "instructors", instructorId), profilePayload, { merge: true });
    instructorBatch.set(doc(db, "instructorPrivate", instructorId), {
      ...privateInstructorData({ ...(existingInstructor || {}), uid: newUserId, email: instructorEmail,
        phone, note: userData.note || existingInstructor?.note, pending: false }),
      createdAt: existingInstructor?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    instructorBatch.set(doc(db, "instructorAccounts", newUserId), buildInstructorAccountPayload({
      uid: newUserId,
      instructorId,
      name,
      email: instructorEmail,
      emailLower: instructorEmailLower,
      subject,
      subjects
    }), { merge: true });
    await instructorBatch.commit();
  }
  } catch (error) {
    let rollbackFailed = false;
    try {
      await deleteAuthUser(userCredential.user);
    } catch (rollbackError) {
      rollbackFailed = true;
      console.warn("인증 계정 롤백 실패:", rollbackError);
    }
    if (userData.role === "instructor") {
      if (rollbackFailed) {
        throw new Error("강사 정보 저장과 인증 계정 되돌리기가 모두 실패했습니다. 같은 이메일로 다시 생성하지 말고, 입력한 이메일의 Auth 계정과 강사 프로필·연결 문서를 관리자에게 확인받으세요.");
      }
      throw new Error("강사 정보 저장에 실패해 새 인증 계정을 되돌렸습니다. 입력 내용과 권한을 확인한 뒤 다시 시도할 수 있습니다.");
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
    setupPasswordVisibilityToggles(form);
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

    // 초기 상태에서 모든 역할별 required 필드의 required 제거 (기본값)
    const userSubjectChoices = $("#userSubjectChoices");
    const userChildGrade = $("#userChildGrade");
    const userPhone = $("#userPhone");
    if (userSubjectChoices) {
      const subjects = await loadInstructorMenuSubjects(getSettingDoc);
      userSubjectChoices.innerHTML = subjects.map((subject, index) => `
        <label class="subject-choice-chip" for="userSubject${index}">
          <input type="checkbox" id="userSubject${index}" name="subjects" value="${escapeHtml(subject)}">
          <span>${escapeHtml(subject)}</span>
        </label>
      `).join("");
      userSubjectChoices.addEventListener("change", (event) => {
        const checkbox = event.target.closest('input[type="checkbox"]');
        if (checkbox) checkbox.closest(".subject-choice-chip")?.classList.toggle("is-checked", checkbox.checked);
      });
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
      const userChildGrade = $("#userChildGrade");
      const userPhone = $("#userPhone");
      const memberPurpose = $("#memberPurpose");
      const memberPhone = $("#memberPhone");
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
      const userChildGrade = $("#userChildGrade");
      const userPhone = $("#userPhone");
      
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
      data.subjects = formData.getAll("subjects");

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
          subjects: data.subjects,
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
        toast(data.role === "instructor" ? "강사가 성공적으로 추가되었습니다." : `${roleText}이 성공적으로 추가되었습니다.`);
        form.reset();
        userSubjectChoices?.querySelectorAll(".subject-choice-chip").forEach((chip) => {
          chip.classList.remove("is-checked");
        });
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
const searchInput = $("#searchUsers");
const roleFilterInput = $("#roleFilterUsers");
let allUsers = [];
let filteredUsers = [];
let currentPage = 1;
let itemsPerPage = 10;
let appliedUserKeyword = "";
let currentSort = { field: 'createdAt', direction: 'desc' };
let usersLoaded = false;
let instructorPrivateExportById = new Map();

function setUsersExportReady() {
  const button = $("#dlUsers");
  if (!button) return;
  button.disabled = !usersLoaded || !filteredUsers.length;
  button.title = !usersLoaded
    ? "사용자 목록을 불러온 뒤 다운로드할 수 있습니다"
    : (filteredUsers.length ? "현재 필터 결과 전체를 엑셀로 다운로드" : "다운로드할 사용자가 없습니다");
}

function setUsersReadyState() {
  const tbodyElement = $("#tblUsers")?.querySelector('tbody');
  if (tbodyElement) {
    tbodyElement.innerHTML = '<tr><td colspan="8" class="muted">새로고침을 눌러 사용자 목록을 확인하세요.</td></tr>';
  }
  const paginationContainer = $("#paginationContainer");
  if (paginationContainer) paginationContainer.innerHTML = "";
  allUsers = [];
  filteredUsers = [];
  updateUserStats([]);
  setUsersExportReady();
}

// 모든 사용자 데이터 단발 조회 (onSnapshot 제거)
async function loadUsers() {
  const refreshBtn = $("#refreshBtn");
  usersLoaded = false;
  setUsersExportReady();
  instructorPrivateExportById = new Map();
  setAdminRefreshButtonState(refreshBtn, true);
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
    const [studentsSnap, membersSnap, instructorAccountsSnap, instructorsSnap, instructorPrivateSnap, adminsSnap] = await Promise.all([
      getDocs(collection(db, "students")),
      getDocs(collection(db, "members")),
      getDocs(collection(db, "instructorAccounts")),
      getDocs(collection(db, "instructors")),
      getDocs(collection(db, "instructorPrivate")),
      getDocs(collection(db, "admins"))
    ]);

    users.students = studentsSnap.docs
      .map(d => ({ uid: d.id, role: 'student', ...d.data() }))
      .map((student) => ({ ...student, grade: normalizeGrade(student.grade) }));

    users.members = membersSnap.docs.map(d => ({ uid: d.id, role: 'member', ...d.data() }));

    const instructorPrivateById = new Map(instructorPrivateSnap.docs.map((d) => [d.id, d.data() || {}]));
    instructorPrivateExportById = instructorPrivateById;
    const instructorProfileMap = new Map(instructorsSnap.docs.map((profileDoc) => [
      profileDoc.id,
      { ...mergeInstructorPrivate(profileDoc.data() || {}, instructorPrivateById.get(profileDoc.id)),
        id: profileDoc.id, instructorId: profileDoc.id }
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
        note: profile.note || ""
      });
    });

    users.parents = [];

    users.admins = adminsSnap.docs.map(d => ({ uid: d.id, role: 'admin', ...d.data() }));

    usersLoaded = true;
    checkAndUpdate();
  } catch (err) {
    if (err.code !== 'permission-denied') console.error("사용자 로드 오류:", err);
    toast("사용자 목록을 불러오지 못했습니다. 다시 시도해 주세요.", true);
  } finally {
    setAdminRefreshButtonState(refreshBtn, false);
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

const SAFE_ACTION_ARG_PATTERN = /^[A-Za-z0-9_-]+$/;

// 기존 ID도 보존한다. JS 문자열 직렬화 후 HTML 속성 이스케이프를 적용한다.
function buildActionClickAttr(handlerName, args) {
  const isSafe = args.every((arg) => typeof arg === "string" && SAFE_ACTION_ARG_PATTERN.test(arg));
  if (!isSafe) {
    if (!args.every((arg) => typeof arg === "string" && arg.length > 0)) return "disabled";
    return `onclick="${escapeHtml(`${handlerName}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`)}"`;
  }
  return `onclick="${handlerName}(${args.map((arg) => `'${arg}'`).join(", ")})"`;
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
  setUsersExportReady();
  
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
    const schoolOrSubject = isInstructor
      ? (getInstructorSubjects(user).join(", ") || "-")
      : (user.school || (user.role === "member" ? getMemberPurposeLabel(user.memberPurpose) : user.childSchool) || "-");
    const actionHtml = isAdmin
      ? `<span class="manual-management-badge">수동 관리</span>`
      : isMember
        ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn warning sm" ${buildActionClickAttr("deleteUser", [user.uid, user.role])} title="사이트 데이터 정리" style="display:flex;align-items:center;gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
            </button>
          </div>`
        : isInstructor
          ? (instructorStatus === "profileOnly"
            ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="btn warning sm" ${buildActionClickAttr("deleteUser", [user.instructorId, user.role])} title="미연동 강사 프로필과 배정 데이터 정리" style="display:flex;align-items:center;gap:4px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
                </button>
              </div>`
            : instructorStatus === "linked"
              ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="btn warning sm" type="button" disabled title="먼저 강사 계정을 미연동해야 데이터 정리를 할 수 있습니다." style="display:flex;align-items:center;gap:4px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
                </button>
                <button class="btn sm" ${buildActionClickAttr("unlinkInstructorAccount", [user.uid])} title="강사 계정 연동 해제">강사 계정 미연동</button>
              </div>`
              : `<button class="btn warning sm" ${buildActionClickAttr("deleteUser", [user.uid, user.role])} title="미연동 강사 데이터 정리">데이터 정리</button>`)
        : `<div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button class="btn warning sm" ${buildActionClickAttr("deleteUser", [user.uid, user.role])} title="사이트 데이터 정리" style="display:flex;align-items:center;gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>데이터 정리
            </button>
          </div>`;

    return `
      <tr>
        <td><span class="pill">${escapeHtml(roleText)}</span>${instructorStatusHtml}</td>
        <td>${escapeHtml(user.name || '-')}</td>
        <td>${escapeHtml(user.email || '-')}</td>
        <td>${escapeHtml(schoolOrSubject)}</td>
        <td>${escapeHtml(user.role === 'student' ? formatGrade(user.grade) : (user.role === 'member' ? '-' : (user.childGrade || '-')))}</td>
        <td>${escapeHtml(createdAt)}</td>
        <td class="muted" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(user.note || '')}">${escapeHtml(user.note || '-')}</td>
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
  const state = renderListPagination($("#paginationContainer"), {
    currentPage,
    itemLabel: "명",
    onPageChange: (page) => window.goToPage(page),
    pageSize: itemsPerPage,
    totalItems,
  });
  currentPage = state.currentPage;
}

// 페이지 이동 함수
window.goToPage = (page) => {
  currentPage = page;
  renderUsers(filteredUsers);
};

bindCommittedSearch(searchInput, $("#accountSearchButton"), (keyword) => {
  appliedUserKeyword = keyword;
  filterUsers();
});

if (roleFilterInput) {
  roleFilterInput.addEventListener('change', () => {
    filterUsers();
  });
}

$("#accountsPageSize")?.addEventListener("change", (event) => {
  itemsPerPage = normalizeListPageSize(event.target.value);
  filterUsers();
});

function filterUsers(resetPage = true) {
  if (!usersLoaded) {
    setUsersReadyState();
    return;
  }

  const keyword = appliedUserKeyword;
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
      <div class="cleanup-dialog__header">
        <div>
          <h2 id="${labelId}">${escapeHtml(title)}</h2>
          <p>정리 전 미리보기를 확인한 뒤 확인 문구를 입력해 주세요.</p>
        </div>
        <button type="button" class="modal-close admin-modal-close cleanup-dialog__close" data-cleanup-close aria-label="닫기">×</button>
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
  if (error?.isOperatorSafe === true && error?.message) {
    return error.message;
  }
  const text = String(error?.code || error?.message || error || "").toLowerCase();
  if (text.includes("permission") || text.includes("권한") || text.includes("insufficient")) {
    return "권한 또는 규칙 설정을 확인해 주세요.";
  }
  return "데이터 정리 중 문제가 발생했습니다. 다시 확인해 주세요.";
}

async function buildStudentCleanupPreview(uid) {
  const user = allUsers.find((item) => item.uid === uid && item.role === "student") || {};
  const cleanupData = await loadStudentCleanupData(uid, user);
  const student = cleanupData.student;
  const activeParentLinks = cleanupData.blockingParentLinks.length;

  return {
    uid,
    hasBlockingParentLinks: activeParentLinks > 0,
    profile: {
      name: student.name || user.name || "",
      email: student.email || user.email || "",
      phone: student.phone || user.phone || "",
      school: student.school || user.school || "",
      grade: student.grade || user.grade || ""
    },
    counts: {
      profile: cleanupData.studentRef ? 1 : 0,
      enrollments: cleanupData.enrollmentRefs.length,
      offlineClassMembers: cleanupData.classMemberRefs.length,
      offlineSessionAccess: cleanupData.sessionAccessRefs.length,
      activeParentLinks,
      revokedParentLinks: cleanupData.parentLinkRefs.length - activeParentLinks,
      childLinkAttempts: cleanupData.childLinkAttemptRefs.length,
      signupAttempts: cleanupData.transientRefs.signupAttempts.length,
      emailVerifications: cleanupData.transientRefs.emailVerifications.length
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
  if (executeButton) executeButton.disabled = preview.hasBlockingParentLinks;

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
          { label: "오프라인 수업 접근 기록", count: counts.offlineSessionAccess },
          { label: "활성 학부모 연결", count: counts.activeParentLinks },
          { label: "해제된 학부모 연결 기록", count: counts.revokedParentLinks },
          { label: "자녀 연결 시도 기록", count: counts.childLinkAttempts },
          { label: "임시 가입/인증 기록", count: counts.signupAttempts + counts.emailVerifications }
        ])}
      </section>
      ${preview.hasBlockingParentLinks ? `
        <div class="cleanup-feedback" data-type="error">
          활성 학부모 연결이 남아 있어 정리를 실행할 수 없습니다. 회원 관리에서 연결을 먼저 해제해 회원의 자녀 수를 정상 반영한 뒤 다시 확인해 주세요.
        </div>
      ` : ""}
      <div class="cleanup-two-column">
      <section class="cleanup-card">
        <h3>정리되는 항목</h3>
        ${renderCleanupSummaryList(["학생 프로필", "학생 온라인 수강 기록", "오프라인 반 배정/접근 기록", "해제된 학부모 연결 기록", "자녀 연결 시도 기록", "임시 가입/인증 기록"])}
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
    await deleteUserFirestoreData(
      activeStudentCleanupPreview.uid,
      "student",
      activeStudentCleanupPreview.profile
    );
    completed = true;
    setCleanupFeedback("studentCleanupModal", "데이터 정리가 완료되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.", "success");
    scheduleCleanupModalClose("studentCleanupModal", closeStudentCleanupModal);
    await loadUsers();
  } catch (error) {
    console.error("학생 데이터 정리 실패:", error);
    if (error?.code === "active-parent-link" && activeStudentCleanupPreview) {
      activeStudentCleanupPreview.hasBlockingParentLinks = true;
    }
    setCleanupFeedback("studentCleanupModal", getCleanupErrorMessage(error), "error");
  } finally {
    if (executeButton) executeButton.textContent = completed ? "완료" : "데이터 정리 실행";
    if (completed) {
      setStudentCleanupCompleted();
    } else {
      setStudentCleanupActionsDisabled(false);
      if (activeStudentCleanupPreview?.hasBlockingParentLinks && executeButton) {
        executeButton.disabled = true;
      }
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

async function loadMemberCleanupData(uid, fallbackUser = {}) {
  const memberRef = doc(db, "members", uid);
  const [memberSnap, enrollmentsSnap, childLinksSnap, childLinkAttemptsSnap] = await Promise.all([
    getDoc(memberRef),
    getDocs(query(collection(db, "enrollments"), where("userId", "==", uid))),
    getDocs(query(collection(db, "studentParentLinks"), where("memberUid", "==", uid))),
    getDocs(query(collection(db, "memberChildLinkAttempts"), where("memberUid", "==", uid)))
  ]);
  const profile = getMemberCleanupProfile(memberSnap, fallbackUser);
  const transientRefs = await getAccountTransientCleanupRefs(profile.email);

  return {
    profile,
    refs: {
      member: memberSnap.exists() ? memberRef : null,
      enrollments: enrollmentsSnap.docs.map((item) => item.ref),
      childLinks: childLinksSnap.docs.map((item) => item.ref),
      childLinkAttempts: childLinkAttemptsSnap.docs.map((item) => item.ref),
      signupAttempts: transientRefs.signupAttempts,
      emailVerifications: transientRefs.emailVerifications
    },
    docs: {
      enrollments: enrollmentsSnap.docs,
      childLinks: childLinksSnap.docs
    }
  };
}

async function buildMemberCleanupPreview(uid) {
  const user = allUsers.find((item) => item.uid === uid && item.role === "member") || {};
  const cleanupData = await loadMemberCleanupData(uid, user);
  const enrollmentDocs = cleanupData.docs.enrollments;
  const childLinkDocs = cleanupData.docs.childLinks;
  const enrollmentSamples = await Promise.all(enrollmentDocs.slice(0, MEMBER_CLEANUP_SAMPLE_LIMIT).map(async (docSnap) => {
    const row = docSnap.data() || {};
    return {
      courseTitle: await getCourseTitle(row.courseId),
      status: row.status || "active"
    };
  }));

  return {
    uid,
    profile: cleanupData.profile,
    counts: {
      memberProfile: cleanupData.refs.member ? 1 : 0,
      enrollments: cleanupData.refs.enrollments.length,
      childLinks: cleanupData.refs.childLinks.length,
      childLinkAttempts: cleanupData.refs.childLinkAttempts.length,
      signupAttempts: cleanupData.refs.signupAttempts.length,
      emailVerifications: cleanupData.refs.emailVerifications.length
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
        { label: "자녀 연결 시도 기록", count: counts.childLinkAttempts },
        { label: "임시 가입/인증 기록", count: counts.signupAttempts + counts.emailVerifications }
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
        ${renderCleanupSummaryList(["회원 프로필", "온라인 수강 기록", "자녀 연결 기록", "자녀 연결 시도 기록", "임시 가입/인증 기록"])}
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
    const cleanupData = await loadMemberCleanupData(
      activeMemberCleanupPreview.uid,
      activeMemberCleanupPreview.profile
    );
    const refsToDelete = [
      ...cleanupData.refs.enrollments,
      ...cleanupData.refs.childLinks,
      ...cleanupData.refs.childLinkAttempts,
      ...cleanupData.refs.signupAttempts,
      ...cleanupData.refs.emailVerifications,
      cleanupData.refs.member
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
    executeId: "instructorCleanupExecute"
  });
  document.body.appendChild(modal);

  modal.querySelector("#instructorCleanupCancel")?.addEventListener("click", closeInstructorCleanupModal);
  modal.querySelector("[data-cleanup-close]")?.addEventListener("click", closeInstructorCleanupModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeInstructorCleanupModal();
  });
  modal.querySelector("#instructorCleanupExecute")?.addEventListener("click", executeActiveInstructorCleanup);
  modal.querySelector("#instructorCleanupConfirmInput")?.addEventListener("input", () => {
    clearCleanupFeedback(modal);
  });

  return modal;
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
      <h3>수동 확인 항목</h3>
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
  const cancelButton = document.getElementById("instructorCleanupCancel");
  if (executeButton) executeButton.disabled = disabled;
  if (cancelButton) cancelButton.disabled = disabled;
}

function setInstructorCleanupCompleted() {
  const executeButton = document.getElementById("instructorCleanupExecute");
  const cancelButton = document.getElementById("instructorCleanupCancel");
  if (executeButton) executeButton.disabled = true;
  if (cancelButton) cancelButton.disabled = false;
}

async function openInstructorCleanupPreview(uid) {
  const user = allUsers.find((item) => (
    item.role === "instructor" &&
    (item.uid === uid || item.instructorId === uid)
  )) || {};
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
    message: "연동을 해제하면 강사 계정 정보가 삭제되어 계정/사용자 목록에서 사라지고, 이 계정으로 강사 기능을 사용할 수 없습니다. 강사 프로필과 과목·강좌·반·시간표 배정 정보는 그대로 보존되며, 이후 같은 강사명과 과목으로 새 계정을 생성하면 기존 프로필에 다시 연결됩니다. Firebase Auth 계정은 삭제되지 않으므로 Firebase Console에서 직접 삭제해야 합니다.",
    phrase: "연동 해제",
    confirmLabel: "연동 해제",
    pendingMessage: "강사 계정 연동을 해제하는 중입니다.",
    notifyError: (message) => {
      setCleanupFeedback("instructorCleanupModal", message, "error");
      toast(message, true);
    },
  });
  if (!confirmationModal) return;
  setInstructorCleanupActionsDisabled(true);
  setCleanupFeedback("instructorCleanupModal", "강사 계정 연동을 해제하는 중입니다.", "info");

  let completed = false;
  try {
    await executeInstructorAccountUnlink(activeInstructorCleanupPreview);
    completed = true;
    const successMessage = "강사 계정 연동이 해제되어 사용자 목록에서 제거되었습니다. Firebase Auth 계정은 Firebase Console에서 직접 삭제해 주세요.";
    setCleanupFeedback("instructorCleanupModal", successMessage, "success");
    confirmationModal.success("강사 계정 연동이 해제되었습니다.");
    toast(successMessage);
    await loadUsers();
  } catch (error) {
    console.error("강사 계정 연동 해제 실패:", error);
    const errorMessage = getCleanupErrorMessage(error);
    setCleanupFeedback("instructorCleanupModal", errorMessage, "error");
    confirmationModal.error(errorMessage);
    toast(errorMessage, true);
  } finally {
    if (completed) {
      setInstructorCleanupCompleted();
    } else {
      setInstructorCleanupActionsDisabled(false);
    }
  }
}

window.unlinkInstructorAccount = async (uid) => {
  try {
    const preview = await buildInstructorAccountCleanupPreview(uid);
    if (!preview.unlink?.canUnlink) {
      throw new Error(preview.unlink?.error || "강사 계정 연동 해제 대상을 확인할 수 없습니다.");
    }
    activeInstructorCleanupPreview = preview;
    await executeActiveInstructorUnlink();
  } catch (error) {
    console.error("강사 계정 연동 해제 준비 실패:", error);
    toast(getCleanupErrorMessage(error), true);
  } finally {
    activeInstructorCleanupPreview = null;
  }
};

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
    const instructorUser = allUsers.find((item) => item.uid === uid && item.role === "instructor");
    if (instructorUser && getInstructorLinkStatus(instructorUser) === "linked") {
      toast("연결된 강사는 데이터 정리를 할 수 없습니다. 먼저 강사 계정을 미연동해 주세요.", true);
      return;
    }
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

  const message = "이 작업은 사이트에 저장된 사용자 정보와 연결 데이터를 정리합니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요.\n\n사용자 사이트 데이터를 정리할까요?";
  if (!confirm(message)) return;

  // 삭제 중 표시
  toast("사이트 데이터 정리 중...", false);
  
  try {
    const result = await deleteUserFirestoreData(uid, role);
    
    // 성공 메시지
    toast(`데이터 정리가 완료되었습니다. Auth 계정 삭제는 Firebase Console에서 별도로 처리하세요. (${result.deletedCount}개 문서 정리)`, false);
    
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
  const refreshBtn = document.querySelector("#refreshBtn");
  const dlBtn = document.querySelector("#dlUsers");
  
  if (tabId === 'signup') {
    // 회원가입 설정 탭으로 전환 시 설정 로드
    loadSignupSettings();
  } else if (tabId === 'users') {
    if (refreshBtn) refreshBtn.style.display = 'inline-flex';
    if (dlBtn) dlBtn.style.display = 'inline-block';
  }
});

// 새로고침
$("#refreshBtn")?.addEventListener("click", async () => {
  await loadUsers();
  if (usersLoaded) toast("새로고침되었습니다.");
});


// 엑셀 다운로드 (비밀번호/초기 비밀번호는 포함하지 않음)
$("#dlUsers")?.addEventListener("click", async () => {
  if (!usersLoaded) return toast("사용자 목록을 먼저 불러와 주세요.", true);
  if (!filteredUsers.length) return toast(allUsers.length ? "필터 결과에 사용자가 없습니다." : "등록된 사용자가 없습니다.", true);
  try {
    const rows = filteredUsers.map(u => {
      if (u.role === 'student') {
        return {
          역할: '학생',
          이름: u.name || "",
          이메일: u.email || "",
          학교: u.school || "",
          학년: formatGrade(u.grade),
          전화번호: u.phone || "",
          상태: String(u.status || "active") === "active" ? "활성" : "비활성",
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
        const privateData = instructorPrivateExportById.get(u.instructorId) || {};
        return {
          역할: '강사',
          이름: u.name || "",
          이메일: privateData.email || "",
          과목: u.subject || "",
          전화번호: privateData.phone || "",
          상태: u.status || "확인 불가",
          생성일: formatCreatedAt(getUserCreatedAtValue(u)),
          비고: privateData.note || ""
        };
      } else {
        return {
          역할: '관리자',
          이름: u.name || "",
          이메일: u.email || "",
          상태: u.status || "확인 불가",
          생성일: formatCreatedAt(getUserCreatedAtValue(u)),
          비고: u.note || ""
        };
      }
    });

    const filtered = !!(appliedUserKeyword || roleFilterInput?.value);
    const done = await writeAdminXlsx(XLSX, {
      rows, sheetName: "사용자", button: $("#dlUsers"),
      filename: adminXlsxFilename("사용자목록", rows.length, filtered ? "필터결과" : "전체"),
    });
    if (done) toast(`사용자 ${rows.length}명 엑셀 파일을 다운로드했습니다.`);
  } catch (error) {
    console.error("엑셀 다운로드 실패:", error);
    toast("엑셀 다운로드 실패: " + (error.message || error), true);
  }
});

// 초기 탭 버튼 표시 설정 (DOM 로드 후)
function initTabButtons() {
  const refreshBtn = $("#refreshBtn");
  const dlBtn = $("#dlUsers");
  setUsersReadyState();
  if (refreshBtn) {
    refreshBtn.style.display = 'inline-flex';
    setAdminRefreshButtonState(refreshBtn, false);
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
