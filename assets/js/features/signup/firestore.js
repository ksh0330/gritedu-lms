/**
 * Firestore read/write helpers for signup flow.
 */

import { db, auth } from "/assets/js/firebase-init.js";
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";
import { CONSENT_SOURCE_SIGNUP, LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";

function buildMarketingConsent(data = {}, source = CONSENT_SOURCE_SIGNUP) {
  const sms = data.sms === true;
  const email = data.email === true;
  return {
    sms,
    email,
    agreedAt: sms || email ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
    withdrawnAt: null,
    source,
    policyVersion: LEGAL_POLICY_VERSION
  };
}

/**
 * Check duplicate student by name/school/grade.
 * @returns {Promise<Array<{uid:string,name:string,school:string,grade:string,note:string}>>}
 */
export async function checkDuplicateStudent(name, school, grade) {
  try {
    const nameTrimmed = name.trim();
    const schoolTrimmed = school.trim();
    const gradeTrimmed = normalizeGrade(grade);

    const studentsRef = collection(db, "students");
    const q = query(
      studentsRef,
      where("name", "==", nameTrimmed),
      where("school", "==", schoolTrimmed),
      where("grade", "==", gradeTrimmed)
    );
    const snap = await getDocs(q);

    const duplicates = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      duplicates.push({
        uid: docSnap.id,
        name: data.name || "",
        school: data.school || "",
        grade: data.grade || "",
        note: data.note || ""
      });
    });

    return duplicates;
  } catch (error) {
    console.error("중복 학생 체크 실패:", error);
    return [];
  }
}

/**
 * Parent feature is disabled.
 */
export async function checkDuplicateParent(_childName, _childSchool, _childGrade) {
  throw new Error("Parents feature is currently disabled (policy OFF).");
}

/**
 * Generate next duplicate note number (0001, 0002, ...)
 */
export async function generateDuplicateNote(duplicates) {
  try {
    const notes = duplicates
      .map((d) => d.note || "")
      .filter((note) => note && /^\d{4}$/.test(note.trim()))
      .map((note) => parseInt(note.trim(), 10))
      .filter((num) => !isNaN(num))
      .sort((a, b) => b - a);

    const nextNumber = notes.length > 0 ? notes[0] + 1 : 1;
    return String(nextNumber).padStart(4, "0");
  } catch (error) {
    console.error("동명인 번호 생성 실패:", error);
    return "";
  }
}

/**
 * Save student profile.
 * Canonical: students/{uid}
 *
 * @returns {Promise<{canonicalSaved: boolean}>}
 */
export async function saveStudent(uid, data) {
  const createdAt = serverTimestamp();
  const grade = normalizeGrade(data.grade);
  const studentData = {
    name: data.name,
    email: data.email,
    school: data.school,
    grade,
    phone: data.phone,
    note: data.note || "",
    termsAgreed: data.termsAgreed === true,
    privacyAgreed: data.privacyAgreed === true,
    termsAgreedAt: serverTimestamp(),
    privacyAgreedAt: serverTimestamp(),
    consentSource: CONSENT_SOURCE_SIGNUP,
    policyVersion: LEGAL_POLICY_VERSION,
    marketingConsent: buildMarketingConsent(data.marketingConsent, CONSENT_SOURCE_SIGNUP),
    createdAt,
    updatedAt: serverTimestamp()
  };

  if (data.signupSource) {
    studentData.signupSource = String(data.signupSource).trim();
  }

  try {
    const studentRef = doc(db, "students", uid);
    await setDoc(studentRef, studentData, { merge: true });
  } catch (error) {
    console.error("students/{uid} 저장 실패:", error);
    if (error.code === "permission-denied" || error.code?.includes("permission")) {
      console.error("권한 오류 상세:", {
        code: error.code,
        message: error.message,
        uid,
        email: data.email,
        authState: auth?.currentUser?.uid
      });
    }
    throw error;
  }

  return {
    canonicalSaved: true
  };
}

/**
 * Save general member profile.
 * Canonical: members/{uid}
 *
 * @returns {Promise<{canonicalSaved: boolean}>}
 */
export async function saveMember(uid, data) {
  const memberPurpose = String(data.memberPurpose || "").trim();
  const email = String(data.email || "").trim();
  const signupSource = data.signupSource ? String(data.signupSource).trim() : "";
  const signupSourceOther = data.signupSourceOther ? String(data.signupSourceOther).trim() : "";
  const memberData = {
    uid,
    role: "member",
    name: data.name,
    email,
    emailLower: email.toLowerCase(),
    phone: data.phone,
    memberPurpose,
    status: "active",
    hasLinkedChildren: false,
    linkedChildrenCount: 0,
    termsAgreed: data.termsAgreed === true,
    privacyAgreed: data.privacyAgreed === true,
    termsAgreedAt: serverTimestamp(),
    privacyAgreedAt: serverTimestamp(),
    consentSource: CONSENT_SOURCE_SIGNUP,
    policyVersion: LEGAL_POLICY_VERSION,
    marketingConsent: buildMarketingConsent(data.marketingConsent, CONSENT_SOURCE_SIGNUP),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (memberPurpose === "general") {
    memberData.signupSource = signupSource;
    if (signupSource === "other") {
      memberData.signupSourceOther = signupSourceOther;
    }
  }

  try {
    const memberRef = doc(db, "members", uid);
    await setDoc(memberRef, memberData, { merge: true });
  } catch (error) {
    console.error("members/{uid} 저장 실패:", error);
    if (error.code === "permission-denied" || error.code?.includes("permission")) {
      console.error("권한 오류 상세:", {
        code: error.code,
        message: error.message,
        uid,
        email: data.email,
        authState: auth?.currentUser?.uid
      });
    }
    throw error;
  }

  return {
    canonicalSaved: true
  };
}

/**
 * Parent feature is disabled.
 */
export async function saveParent(_uid, _data) {
  throw new Error("Parents feature is currently disabled (policy OFF).");
}
