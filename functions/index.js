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
const { runOfflineSessionCleanup } = require("./offline-session-cleanup");

const MEMBER_CHILD_LINK_FAILURE_MESSAGE = "입력한 학생 정보를 확인해 주세요.";

const MEMBER_CHILD_RELATION_LABELS = {
  father: "부",
  mother: "모",
  guardian: "보호자",
};

const MEMBER_CHILD_LINK_RATE_LIMIT_MESSAGE = "연동 시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요.";

function resolveRequestIp(data, context) {
  const forwardedFor = context?.rawRequest?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  const requestIp = context?.rawRequest?.ip;
  if (typeof requestIp === "string" && requestIp.trim()) {
    return requestIp.trim();
  }

  const fallbackIp = data?.ip;
  if (typeof fallbackIp === "string" && fallbackIp.trim()) {
    return fallbackIp.trim();
  }

  return "unknown";
}

function resolveUserAgent(data, context) {
  const forwardedUa = context?.rawRequest?.headers?.["user-agent"];
  if (typeof forwardedUa === "string" && forwardedUa.trim()) {
    return forwardedUa.trim();
  }

  const fallbackUa = data?.userAgent;
  if (typeof fallbackUa === "string" && fallbackUa.trim()) {
    return fallbackUa.trim();
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

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function latestBlockedUntilMillis(snapshot, nowMillis) {
  let latest = null;
  snapshot.docs.forEach((doc) => {
    const millis = timestampToMillis(doc.data()?.blockedUntil);
    if (millis != null && millis > nowMillis && (latest == null || millis > latest)) {
      latest = millis;
    }
  });
  return latest;
}

function countAttemptsSince(snapshot, cutoffMillis) {
  return snapshot.docs.reduce((count, doc) => {
    const millis = timestampToMillis(doc.data()?.timestamp);
    return millis != null && millis > cutoffMillis ? count + 1 : count;
  }, 0);
}

function countCreatedAttemptsSince(snapshot, cutoffMillis) {
  return snapshot.docs.reduce((count, doc) => {
    const millis = timestampToMillis(doc.data()?.createdAt);
    return millis != null && millis > cutoffMillis ? count + 1 : count;
  }, 0);
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
  if (/^[1-6]$/.test(compact)) return compact;

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
  };

  return directMap[compact] || compact;
}

function getSafeAttemptInput(data = {}) {
  const relationLabel = String(data?.relationLabel || "").trim();
  return {
    studentName: normalizeText(data?.studentName),
    school: normalizeText(data?.school),
    grade: normalizeGrade(data?.grade),
    phoneLast4: getPhoneLast4(data?.studentPhone),
    relationLabel: Object.prototype.hasOwnProperty.call(MEMBER_CHILD_RELATION_LABELS, relationLabel)
      ? relationLabel
      : relationLabel,
  };
}

function validateMemberChildLinkInput(data = {}) {
  const studentName = normalizeText(data?.studentName);
  const school = normalizeText(data?.school);
  const grade = normalizeGrade(data?.grade);
  const studentPhoneDigits = normalizePhoneDigits(data?.studentPhone);
  const relationLabel = String(data?.relationLabel || "").trim();

  if (
    !studentName ||
    !school ||
    !/^[1-6]$/.test(grade) ||
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
    name: normalizeText(student.name),
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
  input,
  result,
  matchCount = 0,
  matchedStudentUid = null,
  linkId = null,
  debug = null,
}) {
  if (!memberUid) return;
  const createdAt = admin.firestore.Timestamp.now();
  const successfulResults = new Set(["success", "linked", "alreadyLinked", "ok", "completed"]);
  const retentionDays = successfulResults.has(String(result || "")) ? 180 : 90;
  const attempt = {
    memberUid,
    input,
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

  if (debug && typeof debug === "object") {
    attempt.debug = debug;
  }

  try {
    await db.collection("memberChildLinkAttempts").add(attempt);
  } catch (error) {
    console.warn("memberChildLinkAttempts 기록 실패:", toLoggableError(error));
  }
}

async function enforceMemberChildLinkRateLimit(memberUid) {
  const now = admin.firestore.Timestamp.now();
  const tenMinutesAgoMillis = now.toMillis() - 10 * 60 * 1000;
  const oneDayAgoMillis = now.toMillis() - 24 * 60 * 60 * 1000;
  const attemptsSnap = await db
    .collection("memberChildLinkAttempts")
    .where("memberUid", "==", memberUid)
    .get();
  const tenMinuteCount = countCreatedAttemptsSince(attemptsSnap, tenMinutesAgoMillis);
  const oneDayCount = countCreatedAttemptsSince(attemptsSnap, oneDayAgoMillis);

  if (tenMinuteCount >= 3) {
    return {
      allowed: false,
      reason: "too-many-attempts-10m",
      tenMinuteCount,
      oneDayCount,
    };
  }

  if (oneDayCount >= 10) {
    return {
      allowed: false,
      reason: "too-many-attempts-24h",
      tenMinuteCount,
      oneDayCount,
    };
  }

  return {
    allowed: true,
    tenMinuteCount,
    oneDayCount,
  };
}

async function findMatchingStudents(input) {
  const studentsSnap = await db.collection("students").get();

  const matches = [];
  studentsSnap.forEach((studentDoc) => {
    const student = studentDoc.data() || {};
    const normalizedStudent = {
      name: normalizeText(student.name),
      school: normalizeText(student.school),
      grade: normalizeGrade(student.grade),
      phone: normalizePhoneDigits(student.phone),
    };

    if (
      normalizedStudent.name === input.studentName &&
      normalizedStudent.school === input.school &&
      normalizedStudent.grade === input.grade &&
      normalizedStudent.phone === input.studentPhoneDigits
    ) {
      matches.push({
        uid: studentDoc.id,
        id: studentDoc.id,
        ...student,
      });
    }
  });

  return matches;
}

async function recomputeMemberLinkedChildrenCount(memberUid) {
  const linksSnap = await db
    .collection("studentParentLinks")
    .where("memberUid", "==", memberUid)
    .get();
  let activeCount = 0;
  linksSnap.forEach((linkDoc) => {
    if ((linkDoc.data() || {}).status === "active") activeCount += 1;
  });

  await db.collection("members").doc(memberUid).set({
    hasLinkedChildren: activeCount > 0,
    linkedChildrenCount: activeCount,
    updatedAt: admin.firestore.Timestamp.now(),
  }, { merge: true });

  return activeCount;
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

async function enforceSignupSendRateLimit({ email, ip, userAgent }) {
  const normalizedEmail = String(email || "").toLowerCase().trim();
  const normalizedIp = String(ip || "unknown").trim() || "unknown";
  const normalizedUserAgent = String(userAgent || "unknown").trim() || "unknown";

  if (!normalizedEmail) {
    throw new functions.https.HttpsError("invalid-argument", "email 필드는 필수입니다.");
  }

  const now = admin.firestore.Timestamp.now();
  const oneHourAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 60 * 60 * 1000);
  const oneWeekAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000);
  const signupAttemptsRef = db.collection("signupAttempts");
  const nowMillis = now.toMillis();
  const oneHourAgoMillis = oneHourAgo.toMillis();
  const oneWeekAgoMillis = oneWeekAgo.toMillis();

  // Use single-field queries and filter timestamp/blockedUntil in memory to
  // avoid requiring composite indexes during signup.
  const emailAttempts = await signupAttemptsRef
    .where("email", "==", normalizedEmail)
    .get();

  const blockedEmailUntil = latestBlockedUntilMillis(emailAttempts, nowMillis);
  if (blockedEmailUntil != null) {
    const remainingMs = blockedEmailUntil - nowMillis;
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `요청이 너무 많아 ${remainingDays}일 동안 인증번호 발송이 제한되었습니다. 잠시 후 다시 시도해 주세요.`
    );
  }

  if (normalizedIp !== "unknown") {
    const ipAttempts = await signupAttemptsRef
      .where("ip", "==", normalizedIp)
      .get();

    const blockedIpUntil = latestBlockedUntilMillis(ipAttempts, nowMillis);
    if (blockedIpUntil != null) {
      const remainingMs = blockedIpUntil - nowMillis;
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      throw new functions.https.HttpsError(
        "resource-exhausted",
        `요청이 너무 많아 ${remainingDays}일 동안 인증번호 발송이 제한되었습니다. 잠시 후 다시 시도해 주세요.`
      );
    }

    const hourlyIpAttemptCount = countAttemptsSince(ipAttempts, oneHourAgoMillis);
    if (hourlyIpAttemptCount >= 5) {
      const blockedUntil = admin.firestore.Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);
      await signupAttemptsRef.add({
        email: normalizedEmail,
        ip: normalizedIp,
        timestamp: now,
        userAgent: normalizedUserAgent,
        blockedUntil,
        cleanupAt: admin.firestore.Timestamp.fromMillis(blockedUntil.toMillis() + 7 * 24 * 60 * 60 * 1000),
        reason: "too-many-attempts-per-ip-hourly",
      });
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "인증번호 요청이 너무 많습니다. 1주일 후 다시 시도해 주세요."
      );
    }

    const weeklyIpAttemptCount = countAttemptsSince(ipAttempts, oneWeekAgoMillis);
    if (weeklyIpAttemptCount >= 20) {
      const blockedUntil = admin.firestore.Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);
      await signupAttemptsRef.add({
        email: normalizedEmail,
        ip: normalizedIp,
        timestamp: now,
        userAgent: normalizedUserAgent,
        blockedUntil,
        cleanupAt: admin.firestore.Timestamp.fromMillis(blockedUntil.toMillis() + 7 * 24 * 60 * 60 * 1000),
        reason: "too-many-attempts-per-ip-weekly",
      });
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "인증번호 요청이 너무 많습니다. 1주일 후 다시 시도해 주세요."
      );
    }
  }

  const recentEmailAttemptCount = countAttemptsSince(emailAttempts, oneHourAgoMillis);
  if (recentEmailAttemptCount >= 3) {
    const blockedUntil = admin.firestore.Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);
    await signupAttemptsRef.add({
      email: normalizedEmail,
      ip: normalizedIp,
      timestamp: now,
      userAgent: normalizedUserAgent,
      blockedUntil,
      cleanupAt: admin.firestore.Timestamp.fromMillis(blockedUntil.toMillis() + 7 * 24 * 60 * 60 * 1000),
      reason: "too-many-attempts-per-email",
    });
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "인증번호 요청이 너무 많습니다. 1주일 후 다시 시도해 주세요."
    );
  }

  await signupAttemptsRef.add({
    email: normalizedEmail,
    ip: normalizedIp,
    timestamp: now,
    cleanupAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000),
    userAgent: normalizedUserAgent,
  });
}

exports.linkMemberChild = functions.https.onCall(async (data, context) => {
  const memberUid = context.auth?.uid || "";
  if (!memberUid) {
    throw new functions.https.HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const attemptInput = getSafeAttemptInput(data);

  try {
    const memberRef = db.collection("members").doc(memberUid);
    const memberSnap = await memberRef.get();
    const member = memberSnap.exists ? (memberSnap.data() || {}) : null;
    const memberStatus = String(member?.status || "").trim();
    const memberPurpose = String(member?.memberPurpose || "").trim();

    if (!member) {
      await recordMemberChildLinkAttempt({
        memberUid,
        input: attemptInput,
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
        input: attemptInput,
        result: "inactiveMember",
        matchCount: 0,
      });
      return {
        ok: false,
        success: false,
        code: "inactiveMember",
        result: "inactiveMember",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    const rateLimit = await enforceMemberChildLinkRateLimit(memberUid);
    if (!rateLimit.allowed) {
      await recordMemberChildLinkAttempt({
        memberUid,
        input: attemptInput,
        result: "rateLimited",
        matchCount: 0,
        debug: {
          reason: rateLimit.reason || "rate-limited",
          tenMinuteCount: rateLimit.tenMinuteCount || 0,
          oneDayCount: rateLimit.oneDayCount || 0,
          memberStatus: memberStatus || "missing",
          memberPurpose: memberPurpose || "missing",
        },
      });
      return {
        ok: false,
        success: false,
        code: "rateLimited",
        result: "rateLimited",
        message: MEMBER_CHILD_LINK_RATE_LIMIT_MESSAGE,
      };
    }

    if (memberPurpose !== "parent") {
      await recordMemberChildLinkAttempt({
        memberUid,
        input: attemptInput,
        result: "notParent",
        matchCount: 0,
        debug: {
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
        input: attemptInput,
        result: "invalidInput",
        matchCount: 0,
      });
      return {
        ok: false,
        success: false,
        code: "invalidInput",
        result: "invalidInput",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    const matches = await findMatchingStudents(input);
    if (matches.length === 0) {
      await recordMemberChildLinkAttempt({
        memberUid,
        input: {
          studentName: input.studentName,
          school: input.school,
          grade: input.grade,
          phoneLast4: input.phoneLast4,
          relationLabel: input.relationLabel,
        },
        result: "notFound",
        matchCount: 0,
      });
      return {
        ok: false,
        success: false,
        code: "notFound",
        result: "notFound",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    if (matches.length > 1) {
      await recordMemberChildLinkAttempt({
        memberUid,
        input: {
          studentName: input.studentName,
          school: input.school,
          grade: input.grade,
          phoneLast4: input.phoneLast4,
          relationLabel: input.relationLabel,
        },
        result: "ambiguous",
        matchCount: matches.length,
      });
      return {
        ok: false,
        success: false,
        code: "ambiguous",
        result: "ambiguous",
        message: MEMBER_CHILD_LINK_FAILURE_MESSAGE,
      };
    }

    const student = matches[0];
    const studentUid = student.uid || student.id;
    const linkId = `${studentUid}_${memberUid}`;
    const linkRef = db.collection("studentParentLinks").doc(linkId);
    const now = admin.firestore.Timestamp.now();
    const studentSnapshot = buildSafeStudentSnapshot(student);
    const memberSnapshot = buildSafeMemberSnapshot(member);
    let alreadyLinked = false;

    await db.runTransaction(async (transaction) => {
      const currentLinkSnap = await transaction.get(linkRef);
      const currentLink = currentLinkSnap.exists ? (currentLinkSnap.data() || {}) : null;
      alreadyLinked = currentLink?.status === "active";

      if (alreadyLinked) {
        transaction.set(memberRef, {
          hasLinkedChildren: true,
          updatedAt: now,
        }, { merge: true });
        return;
      }

      transaction.set(linkRef, {
        studentUid,
        memberUid,
        status: "active",
        relationLabel: input.relationLabel,
        relationDisplay: input.relationDisplay,
        linkedBy: "autoMatch",
        matchMethod: "name_school_grade_phone",
        studentSnapshot,
        memberSnapshot,
        createdAt: currentLink?.createdAt || now,
        updatedAt: now,
        revokedAt: null,
      }, { merge: true });

      transaction.set(memberRef, {
        hasLinkedChildren: true,
        updatedAt: now,
      }, { merge: true });
    });

    const linkedChildrenCount = await recomputeMemberLinkedChildrenCount(memberUid);
    const result = alreadyLinked ? "alreadyLinked" : "linked";
    await recordMemberChildLinkAttempt({
      memberUid,
      input: {
        studentName: input.studentName,
        school: input.school,
        grade: input.grade,
        phoneLast4: input.phoneLast4,
        relationLabel: input.relationLabel,
      },
      result,
      matchCount: 1,
      matchedStudentUid: studentUid,
      linkId,
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
        ip: resolveRequestIp(data, context),
        userAgent: resolveUserAgent(data, context),
      });
      currentStage = "rate-limit-check-passed";

      const colRef = db.collection("emailVerifications");
      const verificationDocRef = colRef.doc(email);
      const now = admin.firestore.Timestamp.now();

      currentStage = "verification-doc-cooldown-check-start";
      const existingDocSnap = await verificationDocRef.get();
      if (existingDocSnap.exists) {
        const existingData = existingDocSnap.data() || {};
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
      }
      currentStage = "verification-doc-cooldown-check-passed";

      currentStage = "previous-verification-invalidation-start";
      const existingSnap = await colRef
        .where("email", "==", email)
        .where("used", "==", false)
        .get();

      if (!existingSnap.empty) {
        const batch = db.batch();
        existingSnap.docs.forEach((doc) => {
          batch.update(doc.ref, { used: true, invalidatedAt: admin.firestore.Timestamp.now() });
        });
        await batch.commit();
      }
      currentStage = "previous-verification-invalidation-end";

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 5 * 60 * 1000);
      const cleanupAt = admin.firestore.Timestamp.fromMillis(expiresAt.toMillis() + 24 * 60 * 60 * 1000);

      try {
        currentStage = "verification-doc-write-start";
        await verificationDocRef.set({
          email,
          code,
          createdAt: now,
          expiresAt,
          cleanupAt,
          used: false,
          failedAttempts: 0,
          lastFailedAt: null,
        }, { merge: false });
        currentStage = "verification-doc-write-end";
      } catch (firestoreError) {
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
        return { success: true };
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
          await verificationDocRef.set(
            {
              used: true,
              invalidatedAt: admin.firestore.Timestamp.now(),
              invalidationReason: "email-send-failed",
            },
            { merge: true }
          );
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

    if (!email || !code) {
      throw new functions.https.HttpsError("invalid-argument", "email과 code는 필수입니다.");
    }

    if (!/^\d{6}$/.test(code)) {
      throw new functions.https.HttpsError("invalid-argument", "인증번호는 6자리 숫자여야 합니다.");
    }

    const now = admin.firestore.Timestamp.now();
    const docRef = db.collection("emailVerifications").doc(email);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "인증번호를 찾을 수 없습니다. 다시 발송해 주세요."
      );
    }

    const dataDoc = docSnap.data();

    if (dataDoc.used === true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "인증번호가 이미 사용되었거나 무효화되었습니다. 다시 발송해 주세요."
      );
    }

    if (!dataDoc.expiresAt || dataDoc.expiresAt.toMillis() < now.toMillis()) {
      await docRef.update({ used: true });
      throw new functions.https.HttpsError(
        "deadline-exceeded",
        "인증번호가 만료되었습니다. 다시 발송해 주세요."
      );
    }

    if (dataDoc.code !== code) {
      const currentFailedAttempts = Number.isFinite(dataDoc.failedAttempts)
        ? Number(dataDoc.failedAttempts)
        : 0;
      const nextFailedAttempts = currentFailedAttempts + 1;

      if (nextFailedAttempts >= 5) {
        await docRef.update({
          used: true,
          failedAttempts: nextFailedAttempts,
          lastFailedAt: now,
          invalidatedAt: now,
          invalidationReason: "too-many-invalid-code-attempts",
        });
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "인증번호 입력 오류가 5회 누적되었습니다. 보안을 위해 인증번호를 다시 발송해 주세요."
        );
      }

      await docRef.update({
        failedAttempts: nextFailedAttempts,
        lastFailedAt: now,
      });

      const remainingAttempts = 5 - nextFailedAttempts;
      throw new functions.https.HttpsError(
        "failed-precondition",
        `인증번호가 일치하지 않습니다. ${remainingAttempts}회 더 시도할 수 있습니다.`
      );
    }

    await docRef.update({
      used: true,
      verifiedAt: now,
      failedAttempts: dataDoc.failedAttempts || 0,
    });

    return { success: true };
  } catch (error) {
    console.error("verifyEmailCode 오류:", error);
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
    const seoulDay = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      day: "numeric",
    }).format(new Date()));
    const includeLegacy = seoulDay === 1;
    const { results, totalDeleted, hasMore } = await runRecordCleanup(db, {
      perCollectionLimit: 500,
      includeLegacy,
    });
    const offlineSummary = await runOfflineSessionCleanup(db);
    await db.collection("settings").doc("retentionPolicy").set({
      recordCleanupLastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      recordCleanupLastRunSummary: {
        totalDeleted,
        hasMore,
        includeLegacy,
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
    console.log("[scheduledRecordCleanup] 오프라인 수업 정리 완료", offlineSummary);
    return null;
  });
