// /functions/index.js
// Production Cloud Functions surface: signup email verification and member child linking.

const functions = require("firebase-functions/v1");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

const EMAIL_USER = defineSecret("EMAIL_USER");
const EMAIL_PASS = defineSecret("EMAIL_PASS");

if (process.env.NODE_ENV !== "production" && !process.env.FIREBASE_CONFIG) {
  try {
    require("dotenv").config();
  } catch (_error) {
    // dotenv is optional for local development.
  }
}

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const { runRecordCleanup } = require("./record-cleanup");
const {
  SIGNUP_RATE_LIMIT_POLICY,
  evaluateSignupRateLimit,
} = require("./signup-rate-limit-policy");
const {
  EMAIL_VERIFICATION_POLICY,
  evaluateEmailVerificationAttempt,
  generateVerificationCode,
  generateVerificationSessionToken,
  hashVerificationSessionToken,
} = require("./email-verification-policy");
const {
  LEGACY_STUDENT_NAME_FALLBACK_LIMIT,
  evaluateMemberChildLinkRateLimit,
  getMemberChildAttemptRetentionDays,
  getStudentNameFallbackPrefixes,
  normalizeStudentName,
  studentNamesMatch,
} = require("./member-child-link-policy");

const MEMBER_CHILD_LINK_FAILURE_MESSAGE = "입력한 학생 정보를 확인해 주세요.";

const MEMBER_CHILD_RELATION_LABELS = {
  father: "부",
  mother: "모",
  guardian: "보호자",
};

function resolveRequestIp(context) {
  const requestIp = context?.rawRequest?.ip;
  if (typeof requestIp === "string" && requestIp.trim()) {
    return requestIp.trim();
  }

  const forwardedFor = context?.rawRequest?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return "unknown";
}

function isHttpsError(error) {
  return error instanceof functions.https.HttpsError;
}

function getErrorCode(error) {
  return error?.code || error?.errorInfo?.code || "";
}

function toLoggableError(error) {
  return {
    resolvedCode: getErrorCode(error),
    code: error?.code,
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
  };
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function getPhoneLast4(value) {
  const digits = normalizePhoneDigits(value);
  return digits ? digits.slice(-4) : "";
}

function normalizeGrade(value) {
  const compact = String(value || "").trim().replace(/\s+/g, "");
  if (/^[1-7]$/.test(compact)) return compact;

  const directMap = {
    중1: "1",
    중등1: "1",
    중학교1학년: "1",
    중1학년: "1",
    중2: "2",
    중등2: "2",
    중학교2학년: "2",
    중2학년: "2",
    중3: "3",
    중등3: "3",
    중학교3학년: "3",
    중3학년: "3",
    고1: "4",
    고등1: "4",
    고등학교1학년: "4",
    고1학년: "4",
    고2: "5",
    고등2: "5",
    고등학교2학년: "5",
    고2학년: "5",
    고3: "6",
    고등3: "6",
    고등학교3학년: "6",
    고3학년: "6",
    졸업: "7",
    N수: "7",
    졸업N수: "7",
  };

  return directMap[compact] || compact;
}

function getSafeAttemptInput(data = {}) {
  const relationLabel = String(data?.relationLabel || "").trim();
  return {
    providedFields: [
      normalizeStudentName(data?.studentName) ? "studentName" : "",
      normalizeText(data?.school) ? "school" : "",
      normalizeGrade(data?.grade) ? "grade" : "",
      normalizePhoneDigits(data?.studentPhone) ? "studentPhone" : "",
      relationLabel ? "relationLabel" : "",
    ].filter(Boolean),
  };
}

function getSubmittedMemberChildInput(data = {}) {
  return {
    studentName: normalizeStudentName(data?.studentName),
    school: normalizeText(data?.school),
    grade: normalizeGrade(data?.grade),
    studentPhone: normalizePhoneDigits(data?.studentPhone),
    relationLabel: String(data?.relationLabel || "").trim(),
  };
}

function getInvalidMemberChildInputFields(data = {}) {
  const invalidFields = [];
  const relationLabel = String(data?.relationLabel || "").trim();
  if (!normalizeStudentName(data?.studentName)) invalidFields.push("studentName");
  if (!normalizeText(data?.school)) invalidFields.push("school");
  if (!/^[1-7]$/.test(normalizeGrade(data?.grade))) invalidFields.push("grade");
  if (normalizePhoneDigits(data?.studentPhone).length < 7) {
    invalidFields.push("studentPhone");
  }
  if (!Object.prototype.hasOwnProperty.call(MEMBER_CHILD_RELATION_LABELS, relationLabel)) {
    invalidFields.push("relationLabel");
  }
  return invalidFields;
}

function validateMemberChildLinkInput(data = {}) {
  const studentName = normalizeStudentName(data?.studentName);
  const school = normalizeText(data?.school);
  const grade = normalizeGrade(data?.grade);
  const studentPhoneDigits = normalizePhoneDigits(data?.studentPhone);
  const relationLabel = String(data?.relationLabel || "").trim();

  if (
    !studentName ||
    !school ||
    !/^[1-7]$/.test(grade) ||
    studentPhoneDigits.length < 7 ||
    !Object.prototype.hasOwnProperty.call(MEMBER_CHILD_RELATION_LABELS, relationLabel)
  ) {
    return null;
  }

  return {
    studentName,
    school,
    grade,
    studentPhoneDigits,
    phoneLast4: studentPhoneDigits.slice(-4),
    relationLabel,
    relationDisplay: MEMBER_CHILD_RELATION_LABELS[relationLabel],
  };
}

function buildSafeStudentSnapshot(student = {}) {
  return {
    name: normalizeStudentName(student.name),
    school: normalizeText(student.school),
    grade: normalizeGrade(student.grade),
    phoneLast4: getPhoneLast4(student.phone),
  };
}

function buildSafeMemberSnapshot(member = {}) {
  return {
    name: normalizeText(member.name),
    email: normalizeText(member.email),
    phone: normalizeText(member.phone),
  };
}

async function recordMemberChildLinkAttempt({
  memberUid,
  result,
  matchCount = 0,
  matchedStudentUid = null,
  linkId = null,
  submittedInput = null,
  diagnostics = null,
}) {
  if (!memberUid) return;
  const createdAt = admin.firestore.Timestamp.now();
  const retentionDays = getMemberChildAttemptRetentionDays(result);
  const attempt = {
    memberUid,
    result,
    matchCount,
    createdAt,
    cleanupAt: admin.firestore.Timestamp.fromMillis(
      createdAt.toMillis() + retentionDays * 24 * 60 * 60 * 1000
    ),
  };

  if (matchedStudentUid) {
    attempt.matchedStudentUid = matchedStudentUid;
  }

  if (linkId) {
    attempt.linkId = linkId;
  }

  if (submittedInput && typeof submittedInput === "object") {
    attempt.submittedInput = submittedInput;
  }

  if (diagnostics && typeof diagnostics === "object") {
    attempt.diagnostics = diagnostics;
  }

  try {
    await db.collection("memberChildLinkAttempts").add(attempt);
  } catch (error) {
    console.warn("memberChildLinkAttempts 기록 실패:", toLoggableError(error));
  }
}

async function enforceMemberChildLinkRateLimit(memberUid) {
  const now = admin.firestore.Timestamp.now();
  const attemptsSnap = await db
    .collection("memberChildLinkAttempts")
    .where("memberUid", "==", memberUid)
    .get();
  return evaluateMemberChildLinkRateLimit({
    attempts: attemptsSnap.docs.map((attemptDoc) => attemptDoc.data() || {}),
    nowMillis: now.toMillis(),
  });
}

function matchStudentCandidates(studentDocs, input) {
  const candidates = studentDocs.map((studentDoc) => {
    const student = studentDoc.data() || {};
    return {
      row: {
        ...student,
        uid: studentDoc.id,
        id: studentDoc.id,
      },
      name: normalizeStudentName(student.name),
      school: normalizeText(student.school),
      grade: normalizeGrade(student.grade),
      phone: normalizePhoneDigits(student.phone),
    };
  });

  let remaining = candidates.filter((candidate) =>
    studentNamesMatch(candidate.name, input.studentName)
  );
  if (!remaining.length) {
    return {matches: [], mismatchFields: ["studentName"]};
  }

  const checks = [
    ["school", input.school],
    ["grade", input.grade],
    ["studentPhone", input.studentPhoneDigits, "phone"],
  ];

  for (const [field, expected, candidateField = field] of checks) {
    const matched = remaining.filter((candidate) =>
      candidate[candidateField] === expected
    );
    if (!matched.length) {
      return {matches: [], mismatchFields: [field]};
    }
    remaining = matched;
  }

  return {matches: remaining.map((candidate) => candidate.row), mismatchFields: []};
}

async function findMatchingStudents(input) {
  const studentsRef = db.collection("students");
  const exactSnap = await studentsRef
    .where("name", "==", input.studentName)
    .get();
  const exactResult = matchStudentCandidates(exactSnap.docs, input);
  if (exactResult.matches.length) return exactResult;

  const fallbackSnaps = await Promise.all(
    getStudentNameFallbackPrefixes(input.studentName).map((prefix) =>
      studentsRef
        .where("name", ">=", prefix)
        .where("name", "<=", `${prefix}\uf8ff`)
        .limit(LEGACY_STUDENT_NAME_FALLBACK_LIMIT)
        .get()
    )
  );
  const candidateDocsById = new Map();
  exactSnap.docs.forEach((studentDoc) => {
    candidateDocsById.set(studentDoc.id, studentDoc);
  });
  fallbackSnaps.forEach((snapshot) => {
    snapshot.docs.forEach((studentDoc) => {
      candidateDocsById.set(studentDoc.id, studentDoc);
    });
  });
  return matchStudentCandidates([...candidateDocsById.values()], input);
}

function getEmailCandidates(rawEmail, normalizedEmail) {
  return [...new Set(
    [normalizedEmail, rawEmail]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

async function assertEmailNotInCanonicalCollection(collectionName, emailCandidates) {
  for (const candidate of emailCandidates) {
    const snap = await db
      .collection(collectionName)
      .where("email", "==", candidate)
      .limit(1)
      .get();

    if (!snap.empty) {
      throw new functions.https.HttpsError(
        "already-exists",
        "이미 가입된 이메일입니다. 로그인하거나 학원으로 문의해 주세요."
      );
    }
  }
}

async function assertSignupEmailAvailable(rawEmail, normalizedEmail) {
  // Keep Firebase Auth as the primary duplicate check. If the runtime service
  // account cannot read Auth, fall back to canonical Firestore profile docs.
  try {
    await admin.auth().getUserByEmail(normalizedEmail);
    throw new functions.https.HttpsError(
      "already-exists",
      "이미 가입된 이메일입니다. 로그인하거나 학원으로 문의해 주세요."
    );
  } catch (authErr) {
    if (isHttpsError(authErr)) {
      throw authErr;
    }
    const authCode = getErrorCode(authErr);
    if (authCode === "auth/user-not-found") {
      // Continue with canonical Firestore duplicate checks below.
    } else if (authCode === "auth/insufficient-permission") {
      console.warn("Auth 이메일 중복 확인 권한 부족 - canonical Firestore 확인으로 대체:", {
        code: authCode,
        message: authErr.message,
      });
    } else {
      console.error("sendVerificationCode getUserByEmail:", {
        code: authCode,
        message: authErr?.message,
      });
      throw new functions.https.HttpsError("internal", "이메일 확인 중 오류가 발생했습니다.");
    }
  }

  const emailCandidates = getEmailCandidates(rawEmail, normalizedEmail);
  try {
    // Canonical role/profile collections only. Do not use legacy users/* aggregates.
    await assertEmailNotInCanonicalCollection("students", emailCandidates);
    await assertEmailNotInCanonicalCollection("members", emailCandidates);
    await assertEmailNotInCanonicalCollection("instructorAccounts", emailCandidates);
    await assertEmailNotInCanonicalCollection("admins", emailCandidates);
  } catch (error) {
    if (isHttpsError(error)) {
      throw error;
    }
    console.error("canonical 이메일 중복 확인 실패:", {
      code: getErrorCode(error),
      message: error?.message,
    });
    throw new functions.https.HttpsError("internal", "이메일 확인 중 오류가 발생했습니다.");
  }
}

function normalizeSignupType(value) {
  const signupType = String(value || "").trim();
  if (signupType === "student") return "student";
  if (signupType === "member" || signupType === "parent" || signupType === "general") return "member";

  throw new functions.https.HttpsError(
    "invalid-argument",
    "회원가입 유형을 다시 선택해 주세요."
  );
}

async function assertSignupTypeEnabled(signupType) {
  const signupSettingsSnap = await db.collection("settings").doc("signup").get();
  const settings = signupSettingsSnap.exists ? (signupSettingsSnap.data() || {}) : {};

  if (settings.enabled === false) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "현재 회원가입이 일시 중단되어 있습니다."
    );
  }

  if (signupType === "student" && settings.studentEnabled === false) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "현재 학생 회원가입이 일시 중단되어 있습니다."
    );
  }

  if (signupType === "member" && settings.memberEnabled === false) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "현재 학부모/일반 회원가입이 일시 중단되어 있습니다."
    );
  }
}

async function enforceSignupSendRateLimit({email, ip}) {
  const normalizedEmail = String(email || "").toLowerCase().trim();
  const normalizedIp = String(ip || "unknown").trim() || "unknown";

  if (!normalizedEmail) {
    throw new functions.https.HttpsError("invalid-argument", "email 필드는 필수입니다.");
  }

  const now = admin.firestore.Timestamp.now();
  const signupAttemptsRef = db.collection("signupAttempts");

  // Use single-field queries and filter the rolling window in memory to
  // avoid requiring composite indexes during signup.
  const emailAttempts = await signupAttemptsRef
    .where("email", "==", normalizedEmail)
    .get();

  let ipAttempts = {docs: []};
  if (normalizedIp !== "unknown") {
    ipAttempts = await signupAttemptsRef
      .where("ip", "==", normalizedIp)
      .get();
  }

  const decision = evaluateSignupRateLimit({
    emailAttempts: emailAttempts.docs.map((attemptDoc) =>
      attemptDoc.data() || {}
    ),
    ipAttempts: ipAttempts.docs.map((attemptDoc) => attemptDoc.data() || {}),
    nowMillis: now.toMillis(),
    hasUsableIp: normalizedIp !== "unknown",
  });

  if (!decision.allowed) {
    const retryMinutes = Math.max(
      1,
      Math.ceil(Number(decision.retryAfterSeconds || 60) / 60)
    );
    const message = decision.reason === "too-many-attempts-per-ip-hourly"
      ? `현재 네트워크의 인증번호 발송 요청이 많습니다. 약 ${retryMinutes}분 후 다시 시도해 주세요. 공용 Wi-Fi라면 다른 네트워크를 이용해 주세요.`
      : `이 이메일의 인증번호 발송 요청이 많습니다. 약 ${retryMinutes}분 후 다시 시도해 주세요.`;
    throw new functions.https.HttpsError(
      "resource-exhausted",
      message,
      {
        reason: decision.reason,
        retryAfterSeconds: decision.retryAfterSeconds,
      }
    );
  }

  await signupAttemptsRef.add({
    email: normalizedEmail,
    ip: normalizedIp,
    timestamp: now,
    cleanupAt: admin.firestore.Timestamp.fromMillis(
      now.toMillis() + SIGNUP_RATE_LIMIT_POLICY.attemptRetentionMs
    ),
  });
}

exports.linkMemberChild = functions.https.onCall(async (data, context) => {
  const memberUid = context.auth?.uid || "";
  if (!memberUid) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const attemptInput = getSafeAttemptInput(data);
  const submittedInput = getSubmittedMemberChildInput(data);

  try {
    const memberRef = db.collection("members").doc(memberUid);
    const rateLimit = await enforceMemberChildLinkRateLimit(memberUid);
    if (!rateLimit.allowed) {
      const retryMinutes = Math.max(
        1,
        Math.ceil(Number(rateLimit.retryAfterSeconds || 60) / 60)
      );
      const retryLabel = retryMinutes >= 60
        ? `약 ${Math.ceil(retryMinutes / 60)}시간 후`
        : `약 ${retryMinutes}분 후`;
      return {
        ok: false,
        success: false,
        code: "rateLimited",
        result: "rateLimited",
        message: `연동 시도 횟수가 많습니다. ${retryLabel} 다시 시도해 주세요.`,
        rateLimitReason: rateLimit.reason,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      };
    }

    const memberSnap = await memberRef.get();
    const member = memberSnap.exists ? (memberSnap.data() || {}) : null;
    const memberStatus = String(member?.status || "").trim();
    const memberPurpose = String(member?.memberPurpose || "").trim();

    if (!member) {
      await recordMemberChildLinkAttempt({
        memberUid,
        result: "notMember",
        matchCount: 0,
      });
      return {
        ok: false,
        success: false,
        code: "notMember",
        result: "notMember",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    if (memberStatus && memberStatus !== "active") {
      await recordMemberChildLinkAttempt({
        memberUid,
        result: "inactiveMember",
        matchCount: 0,
        diagnostics: {memberStatus: memberStatus || "missing"},
      });
      return {
        ok: false,
        success: false,
        code: "inactiveMember",
        result: "inactiveMember",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    if (memberPurpose !== "parent") {
      await recordMemberChildLinkAttempt({
        memberUid,
        result: "notParent",
        matchCount: 0,
        diagnostics: {
          memberStatus: memberStatus || "missing",
          memberPurpose: memberPurpose || "missing",
        },
      });
      return {
        ok: false,
        success: false,
        code: "notParent",
        result: "notParent",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    const input = validateMemberChildLinkInput(data);
    if (!input) {
      await recordMemberChildLinkAttempt({
        memberUid,
        result: "invalidInput",
        matchCount: 0,
        submittedInput,
        diagnostics: {
          ...attemptInput,
          mismatchFields: getInvalidMemberChildInputFields(data),
        },
      });
      return {
        ok: false,
        success: false,
        code: "invalidInput",
        result: "invalidInput",
        message: "입력 형식을 확인해 주세요. 이름·학교·학년·전화번호와 관계를 모두 입력해야 합니다.",
      };
    }

    const {matches, mismatchFields} = await findMatchingStudents(input);
    if (matches.length === 0) {
      await recordMemberChildLinkAttempt({
        memberUid,
        result: "notFound",
        matchCount: 0,
        submittedInput,
        diagnostics: {mismatchFields},
      });
      return {
        ok: false,
        success: false,
        code: "notFound",
        result: "notFound",
        message: "일치하는 학생 정보를 찾지 못했습니다. 학생의 등록 정보와 입력값을 다시 확인해 주세요.",
      };
    }

    if (matches.length > 1) {
      await recordMemberChildLinkAttempt({
        memberUid,
        result: "ambiguous",
        matchCount: matches.length,
        submittedInput,
        diagnostics: {mismatchFields: []},
      });
      return {
        ok: false,
        success: false,
        code: "ambiguous",
        result: "ambiguous",
        message: "같은 정보의 학생이 여러 명 확인됩니다. 안전한 연동을 위해 학원으로 문의해 주세요.",
      };
    }

    const student = matches[0];
    const studentUid = student.uid || student.id;
    const linkId = `${studentUid}_${memberUid}`;
    const linkRef = db.collection("studentParentLinks").doc(linkId);
    const now = admin.firestore.Timestamp.now();
    const studentSnapshot = buildSafeStudentSnapshot(student);
    let alreadyLinked = false;
    let linkedChildrenCount = 0;

    await db.runTransaction(async (transaction) => {
      const [transactionMemberSnap, memberLinksSnap] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(
          db.collection("studentParentLinks").where("memberUid", "==", memberUid)
        ),
      ]);
      const transactionMember = transactionMemberSnap.exists
        ? (transactionMemberSnap.data() || {})
        : null;
      if (!transactionMember) {
        throw new functions.https.HttpsError("failed-precondition", MEMBER_CHILD_LINK_FAILURE_MESSAGE);
      }
      if (
        String(transactionMember.status || "").trim() !== "active" ||
        String(transactionMember.memberPurpose || "").trim() !== "parent"
      ) {
        throw new functions.https.HttpsError("failed-precondition", MEMBER_CHILD_LINK_FAILURE_MESSAGE);
      }

      const currentLinkSnap = memberLinksSnap.docs.find(
        (linkDoc) => linkDoc.id === linkId
      );
      const currentLink = currentLinkSnap ? (currentLinkSnap.data() || {}) : null;
      alreadyLinked = currentLink?.status === "active";
      linkedChildrenCount = memberLinksSnap.docs.reduce((count, linkDoc) =>
        (linkDoc.data() || {}).status === "active" ? count + 1 : count, 0
      );

      if (alreadyLinked) {
        transaction.set(memberRef, {
          hasLinkedChildren: true,
          linkedChildrenCount,
          updatedAt: now,
        }, { merge: true });
        return;
      }

      linkedChildrenCount += 1;

      transaction.set(linkRef, {
        studentUid,
        memberUid,
        status: "active",
        relationLabel: input.relationLabel,
        relationDisplay: input.relationDisplay,
        linkedBy: "autoMatch",
        matchMethod: "name_school_grade_phone",
        studentSnapshot,
        memberSnapshot: buildSafeMemberSnapshot(transactionMember),
        createdAt: currentLink?.createdAt || now,
        updatedAt: now,
        revokedAt: null,
      }, { merge: true });

      transaction.set(memberRef, {
        hasLinkedChildren: true,
        linkedChildrenCount,
        updatedAt: now,
      }, { merge: true });
    });

    const result = alreadyLinked ? "alreadyLinked" : "linked";
    await recordMemberChildLinkAttempt({
      memberUid,
      result,
      matchCount: 1,
      matchedStudentUid: studentUid,
      linkId,
      submittedInput,
    });

    return {
      ok: true,
      success: true,
      code: result,
      result,
      message: alreadyLinked ? "이미 연동된 학생입니다." : "자녀 계정이 연동되었습니다.",
      linkedChildrenCount,
      child: {
        ...studentSnapshot,
        relationLabel: input.relationLabel,
        relationDisplay: input.relationDisplay,
      },
    };
  } catch (error) {
    console.error("linkMemberChild 오류:", toLoggableError(error));
    if (isHttpsError(error)) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", "자녀 연동 처리 중 오류가 발생했습니다.");
  }
});

exports.sendVerificationCode = functions
  .runWith({ secrets: [EMAIL_USER, EMAIL_PASS] })
  .https.onCall(async (data, context) => {
    let emailUser;
    let emailPass;
    let secretError = null;
    let currentStage = "start";

    try {
      emailUser = EMAIL_USER.value();
      emailPass = EMAIL_PASS.value();
    } catch (err) {
      secretError = err;
      console.error("Secret 로드 실패:", err);

      emailUser = process.env.EMAIL_USER;
      emailPass = process.env.EMAIL_PASS;
    }

    if (!emailUser || !emailPass) {
      console.error("EMAIL_USER/EMAIL_PASS 설정 누락", {
        hasEmailUser: !!emailUser,
        hasEmailPass: !!emailPass,
        secretError: secretError?.message || "N/A",
      });
      throw new functions.https.HttpsError(
        "failed-precondition",
        "현재 인증 이메일을 발송할 수 없습니다. 학원으로 문의해 주세요."
      );
    }
    currentStage = "secrets-loaded";

    try {
      const rawEmail = data?.email ? String(data.email).trim() : "";
      const email = rawEmail.toLowerCase();
      const signupType = normalizeSignupType(data?.signupType);

      if (!email) {
        throw new functions.https.HttpsError("invalid-argument", "email 필드는 필수입니다.");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new functions.https.HttpsError("invalid-argument", "올바른 이메일 형식이 아닙니다.");
      }
      currentStage = "payload-validated";

      currentStage = "signup-settings-check-start";
      await assertSignupTypeEnabled(signupType);
      currentStage = "signup-settings-check-passed";

      currentStage = "signup-email-availability-check-start";
      await assertSignupEmailAvailable(rawEmail, email);
      currentStage = "signup-email-availability-check-passed";

      currentStage = "rate-limit-check-start";
      await enforceSignupSendRateLimit({
        email,
        ip: resolveRequestIp(context),
      });
      currentStage = "rate-limit-check-passed";

      const colRef = db.collection("emailVerifications");
      const verificationDocRef = colRef.doc(email);
      const now = admin.firestore.Timestamp.now();
      const verificationSessionToken = generateVerificationSessionToken();
      const sessionTokenHash = hashVerificationSessionToken(
        verificationSessionToken
      );
      let code;

      try {
        currentStage = "verification-doc-transaction-start";
        code = await db.runTransaction(async (transaction) => {
          const existingDocSnap = await transaction.get(verificationDocRef);
          const existingData = existingDocSnap.exists
            ? (existingDocSnap.data() || {})
            : {};
          const createdAtMs = existingData.createdAt?.toMillis?.();
          const isUsed = existingData.used === true;
          if (!isUsed && createdAtMs) {
            const elapsedMs = now.toMillis() - createdAtMs;
            const cooldownMs = 60 * 1000;
            if (elapsedMs < cooldownMs) {
              const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
              throw new functions.https.HttpsError(
                "resource-exhausted",
                `인증번호 재발송은 1분 간격으로 가능합니다. ${remainingSeconds}초 후 다시 시도해 주세요.`
              );
            }
          }

          const nextCode = generateVerificationCode(existingData.code);
          const expiresAt = admin.firestore.Timestamp.fromMillis(
            now.toMillis() + EMAIL_VERIFICATION_POLICY.codeTtlMs
          );
          const cleanupAt = admin.firestore.Timestamp.fromMillis(
            expiresAt.toMillis() + EMAIL_VERIFICATION_POLICY.cleanupGraceMs
          );
          transaction.set(verificationDocRef, {
            email,
            signupType,
            code: nextCode,
            sessionTokenHash,
            createdAt: now,
            expiresAt,
            cleanupAt,
            used: false,
            failedAttempts: 0,
            lastFailedAt: null,
          }, { merge: false });
          return nextCode;
        });
        currentStage = "verification-doc-transaction-end";
      } catch (firestoreError) {
        if (isHttpsError(firestoreError)) throw firestoreError;
        console.error("Firestore 저장 실패:", {
          code: getErrorCode(firestoreError),
          message: firestoreError?.message,
        });
        throw new functions.https.HttpsError("internal", "인증번호 저장 중 오류가 발생했습니다.");
      }

      currentStage = "nodemailer-transporter-creation";
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      });

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Malgun Gothic', '맑은 고딕', Arial, sans-serif; line-height: 1.8; color: #333333; font-size: 16px; margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 40px auto; padding: 0; background-color: #ffffff;">
    <div style="padding: 40px 30px;">
      <div style="font-size: 18px; margin-bottom: 20px;">안녕하세요.</div>
      <div style="font-size: 16px; margin-bottom: 30px; line-height: 1.8;">그릿에듀 회원가입을 위한 인증번호를 안내드립니다.</div>
      <div style="font-size: 20px; font-weight: bold; margin-bottom: 15px; text-align: center;">인증번호</div>
      <div style="background-color: #f8f9fa; border: 2px solid #ff7a00; border-radius: 8px; padding: 30px 20px; text-align: center; margin: 25px 0 30px 0;">
        <div style="font-size: 56px; font-weight: bold; color: #ff7a00; letter-spacing: 10px; line-height: 1.2; font-family: 'Malgun Gothic', '맑은 고딕', Arial, sans-serif;"><strong>${code}</strong></div>
      </div>
      <div style="font-size: 16px; margin: 20px 0; line-height: 1.8;">해당 코드는 발송 시점부터 5분간 유효합니다.</div>
      <div style="color: #d32f2f; font-weight: bold; margin-top: 25px; font-size: 16px; line-height: 1.8;">보안을 위해 인증번호는 타인과 공유하지 마십시오.</div>
      <div style="margin-top: 40px; padding-top: 25px; border-top: 1px solid #e0e0e0; font-size: 14px; color: #666666; line-height: 1.8;">
        <div>본 이메일은 발신 전용입니다.</div>
        <div style="margin-top: 10px;">문의 사항이 있으시면 <strong>02-809-0611</strong>로 연락해 주세요.</div>
        <div style="margin-top: 20px; font-size: 16px; font-weight: bold;">감사합니다.<br>그릿에듀 드림</div>
      </div>
    </div>
  </div>
</body>
</html>
      `;

      const textContent = `안녕하세요.

그릿에듀 회원가입을 위한 인증번호를 안내드립니다.

인증번호

${code}

해당 코드는 발송 시점부터 5분간 유효합니다.

보안을 위해 인증번호는 타인과 공유하지 마십시오.

본 이메일은 발신 전용입니다.

문의 사항이 있으시면 02-809-0611로 연락해 주세요.

감사합니다.

그릿에듀 드림`;

      const mailOptions = {
        from: `"그릿에듀" <${emailUser}>`,
        to: email,
        subject: "[그릿에듀] 회원가입 이메일 인증번호",
        text: textContent,
        html: htmlContent,
      };

      try {
        currentStage = "email-send-start";
        await transporter.sendMail(mailOptions);
        currentStage = "email-send-success";
        return {success: true, verificationSessionToken};
      } catch (mailError) {
        currentStage = "email-send-failure";
        console.error("이메일 전송 실패:", {
          resolvedCode: getErrorCode(mailError),
          code: mailError?.code,
          command: mailError?.command,
          responseCode: mailError?.responseCode,
          response: mailError?.response,
          message: mailError?.message,
        });
        try {
          await db.runTransaction(async (transaction) => {
            const currentSnap = await transaction.get(verificationDocRef);
            const currentData = currentSnap.exists ? (currentSnap.data() || {}) : {};
            if (currentData.sessionTokenHash !== sessionTokenHash) return;
            transaction.set(verificationDocRef, {
              used: true,
              invalidatedAt: admin.firestore.Timestamp.now(),
              invalidationReason: "email-send-failed",
            }, {merge: true});
          });
        } catch (invalidateError) {
          console.error("인증코드 무효화 실패:", invalidateError);
        }
        throw new functions.https.HttpsError(
          "unavailable",
          "인증번호 이메일 전송에 실패했습니다. 잠시 후 다시 시도해 주세요."
        );
      } finally {
        transporter.close();
      }
    } catch (error) {
      console.error("sendVerificationCode 오류:", {
        stage: currentStage,
        ...toLoggableError(error),
      });
      if (isHttpsError(error)) {
        throw error;
      }
      throw new functions.https.HttpsError("internal", "이메일 인증번호 발송 실패");
    }
  });

exports.verifyEmailCode = functions.https.onCall(async (data, _context) => {
  try {
    const rawEmail = data?.email ? String(data.email).trim() : "";
    const email = rawEmail.toLowerCase();
    const code = data?.code ? String(data.code).trim() : "";
    const verificationSessionToken = data?.verificationSessionToken
      ? String(data.verificationSessionToken).trim()
      : "";

    if (!email || !code || !verificationSessionToken) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "email, code, verificationSessionToken은 필수입니다."
      );
    }

    if (!/^\d{6}$/.test(code)) {
      throw new functions.https.HttpsError("invalid-argument", "인증번호는 6자리 숫자여야 합니다.");
    }

    if (!/^[a-f0-9]{64}$/i.test(verificationSessionToken)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "인증 세션이 올바르지 않습니다. 인증번호를 다시 발송해 주세요."
      );
    }

    const now = admin.firestore.Timestamp.now();
    const docRef = db.collection("emailVerifications").doc(email);
    const outcome = await db.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (!docSnap.exists) return {status: "not-found"};

      const verification = docSnap.data() || {};
      const evaluation = evaluateEmailVerificationAttempt({
        verification,
        submittedCode: code,
        verificationSessionToken,
        nowMillis: now.toMillis(),
      });

      if (evaluation.status === "expired") {
        transaction.update(docRef, {
          used: true,
          invalidatedAt: now,
          invalidationReason: "expired",
        });
      } else if (evaluation.status === "wrong-code") {
        transaction.update(docRef, {
          failedAttempts: evaluation.failedAttempts,
          lastFailedAt: now,
        });
      } else if (evaluation.status === "too-many-failures") {
        transaction.update(docRef, {
          used: true,
          failedAttempts: evaluation.failedAttempts,
          lastFailedAt: now,
          invalidatedAt: now,
          invalidationReason: "too-many-invalid-code-attempts",
        });
      } else if (evaluation.status === "verified") {
        transaction.update(docRef, {
          used: true,
          verifiedAt: now,
          failedAttempts: evaluation.failedAttempts,
        });
      }

      return evaluation;
    });

    if (outcome.status === "not-found") {
      throw new functions.https.HttpsError(
        "not-found",
        "인증번호를 찾을 수 없습니다. 다시 발송해 주세요."
      );
    }
    if (outcome.status === "invalid-session") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "인증 세션이 올바르지 않습니다. 인증번호를 다시 발송해 주세요."
      );
    }
    if (outcome.status === "used") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "인증번호가 이미 사용되었거나 무효화되었습니다. 다시 발송해 주세요."
      );
    }
    if (outcome.status === "expired") {
      throw new functions.https.HttpsError(
        "deadline-exceeded",
        "인증번호가 만료되었습니다. 다시 발송해 주세요."
      );
    }
    if (outcome.status === "too-many-failures") {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "인증번호 입력 오류가 5회 누적되었습니다. 보안을 위해 인증번호를 다시 발송해 주세요."
      );
    }
    if (outcome.status === "wrong-code") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `인증번호가 일치하지 않습니다. ${outcome.remainingAttempts}회 더 시도할 수 있습니다.`
      );
    }

    return {success: true};
  } catch (error) {
    console.error("verifyEmailCode 오류:", toLoggableError(error));
    if (isHttpsError(error)) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", "인증번호 검증 실패");
  }
});

exports.scheduledRecordCleanup = functions.pubsub
  .schedule("0 3 * * *")
  .timeZone("Asia/Seoul")
  .onRun(async () => {
    const { results, totalDeleted, hasMore } = await runRecordCleanup(db, {
      perCollectionLimit: 500,
    });
    await db.collection("settings").doc("retentionPolicy").set({
      recordCleanupLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      recordCleanupLastRunSummary: {
        totalDeleted,
        hasMore,
        results: results.map((result) => ({
          collectionName: result.collectionName,
          scannedCount: result.scannedCount,
          targetCount: result.targetCount,
          deletedCount: result.deletedCount,
        })),
      },
    }, { merge: true });
    console.log("[scheduledRecordCleanup] 운영 기록 정리 완료", {
      totalDeleted,
      hasMore,
      results: results.map((result) => ({
        collectionName: result.collectionName,
        scannedCount: result.scannedCount,
        targetCount: result.targetCount,
        deletedCount: result.deletedCount
      }))
    });
    return null;
  });
