/**
 * Canonical student profile: students/{uid}
 */

import { db } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { normalizeGrade } from "/assets/js/utils/grade.js";
import { CONSENT_SOURCE_SETTINGS, LEGAL_POLICY_VERSION } from "/assets/js/utils/legal-policy.js";

const MARKETING_CONSENT_DAILY_LIMIT = 3;
const MARKETING_CONSENT_LIMIT_MESSAGE = "광고성 정보 수신 설정은 하루 최대 3회까지 변경할 수 있습니다. 필요하면 학원으로 문의해 주세요.";

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isMarketingConsentEnabled(consent = {}) {
  return consent?.sms === true && consent?.email === true;
}

function createMarketingConsentUpdate(checked, currentConsent = {}) {
  const now = serverTimestamp();
  return {
    sms: checked,
    email: checked,
    agreedAt: checked ? now : currentConsent.agreedAt || null,
    updatedAt: now,
    withdrawnAt: checked ? null : now,
    source: CONSENT_SOURCE_SETTINGS,
    policyVersion: LEGAL_POLICY_VERSION
  };
}

function createMarketingLimitError() {
  const error = new Error(MARKETING_CONSENT_LIMIT_MESSAGE);
  error.code = "marketing-consent-limit";
  return error;
}

export async function loadStudentProfile(uid) {
  if (!uid) return null;

  try {
    const studentDoc = await getDoc(doc(db, "students", uid));
    if (!studentDoc.exists()) return null;

    const profile = { uid, ...(studentDoc.data() || {}) };
    profile.grade = normalizeGrade(profile.grade);
    return profile;
  } catch (error) {
    console.warn("[student-profile] students/{uid} read failed:", error);
    return null;
  }
}

/**
 * @param {string} uid
 * @param {{ name?: string, phone?: string, grade?: string, email?: string, gradeManualOverride?: boolean }} profile
 */
export async function saveStudentProfile(uid, profile) {
  if (!uid || !profile) {
    throw new Error("학생 프로필 저장에 필요한 정보가 없습니다.");
  }

  const name = String(profile.name || "").trim();
  const phone = String(profile.phone || "").trim();
  const grade = normalizeGrade(profile.grade);
  const email = String(profile.email || "").trim();

  const canonicalPayload = {
    name,
    phone,
    grade,
    updatedAt: serverTimestamp()
  };
  if (email) canonicalPayload.email = email;
  if (profile.gradeManualOverride) canonicalPayload.gradeManualOverride = true;

  await setDoc(doc(db, "students", uid), canonicalPayload, { merge: true });

  return { name, phone, grade, email };
}

export async function saveStudentMarketingConsent(uid, checked) {
  if (!uid) {
    throw new Error("학생 정보를 찾을 수 없습니다.");
  }

  const studentRef = doc(db, "students", uid);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(studentRef);
    if (!snap.exists()) {
      throw new Error("학생 정보를 찾을 수 없습니다.");
    }

    const currentData = snap.data() || {};
    const currentConsent = currentData.marketingConsent || {};
    const currentMarketingEnabled = isMarketingConsentEnabled(currentConsent);
    const nextMarketingEnabled = checked === true;

    if (currentMarketingEnabled === nextMarketingEnabled) {
      return { changed: false };
    }

    const today = getLocalDateKey();
    const currentDate = String(currentData.marketingConsentChangeDate || "");
    const currentCount = Number(currentData.marketingConsentChangeCount || 0);
    const nextCount = currentDate === today ? currentCount + 1 : 1;

    if (currentDate === today && currentCount >= MARKETING_CONSENT_DAILY_LIMIT) {
      throw createMarketingLimitError();
    }

    transaction.update(studentRef, {
      marketingConsent: createMarketingConsentUpdate(nextMarketingEnabled, currentConsent),
      marketingConsentChangeDate: today,
      marketingConsentChangeCount: nextCount,
      updatedAt: serverTimestamp()
    });

    return { changed: true };
  });
}

/**
 * Batch-load student profiles for display from students/{uid}.
 * @param {string[]} uids
 * @returns {Promise<Map<string, object>>}
 */
export async function loadStudentProfilesMap(uids) {
  const map = new Map();
  const ids = [...new Set((uids || []).filter(Boolean))];
  if (ids.length === 0) return map;

  await Promise.all(
    ids.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "students", id));
        if (snap.exists()) {
          const data = snap.data() || {};
          map.set(id, { ...data, grade: normalizeGrade(data.grade) });
          return;
        }
      } catch (_error) {
      }
    })
  );

  return map;
}
