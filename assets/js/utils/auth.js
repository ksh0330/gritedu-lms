// /assets/js/utils/auth.js
// 프로젝트의 단일 인증/권한 관리 모듈
// NOTE:
// students/{uid} is the canonical student profile path.
// members/{uid} is the canonical general member profile path.

import { auth, db } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";

const VALID_ROLES = ["admin", "instructor", "student", "member"];
const DASHBOARD_URLS = {
  admin: "/members/admin/dashboard.html",
  instructor: "/members/instructors/dashboard.html",
  student: "/members/students/dashboard.html",
  member: "/members/member/dashboard.html"
};

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function normalizeRoleList(roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  return list.map(normalizeRole).filter(Boolean);
}

function validateRoles(roles) {
  const invalidRoles = roles.filter(role => !VALID_ROLES.includes(role));
  if (invalidRoles.length > 0) {
    throw new Error(`유효하지 않은 역할: ${invalidRoles.join(", ")}`);
  }
}

function isIgnorablePermissionError(error) {
  return error && error.code === "permission-denied";
}

const ROLE_READ_RETRY_DELAY_MS = 150;
const ROLE_READ_MAX_ATTEMPTS = 3;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureAuthTokenReady(user, { forceRefresh = false } = {}) {
  if (!user?.getIdToken) return;
  await user.getIdToken(forceRefresh);
}

async function withRoleReadRetry(pathLabel, user, readFn) {
  let refreshedToken = false;

  for (let attempt = 0; attempt < ROLE_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await readFn();
    } catch (error) {
      if (!isIgnorablePermissionError(error)) {
        console.warn(`[getUserRole] ${pathLabel} 읽기 실패:`, error.code, error.message);
        return null;
      }

      console.warn(
        `[getUserRole] ${pathLabel} permission-denied (시도 ${attempt + 1}/${ROLE_READ_MAX_ATTEMPTS}):`,
        error.message
      );

      if (attempt >= ROLE_READ_MAX_ATTEMPTS - 1) {
        return null;
      }

      if (!refreshedToken) {
        await ensureAuthTokenReady(user, { forceRefresh: true });
        refreshedToken = true;
      }

      await delay(ROLE_READ_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return null;
}

export async function getCurrentUserWithWait(timeoutMs = 2000) {
  let user = auth.currentUser;
  if (user) return user;

  try {
    let timeoutId = null;
    user = await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, currentUser => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        unsubscribe();
        resolve(currentUser || null);
      });

      timeoutId = setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, timeoutMs);
    });
  } catch (_error) {
    user = null;
  }

  return user;
}

/**
 * 역할 확인 순서
 * 1. admins/{uid}
 * 2. instructorAccounts/{uid}
 * 3. students/{uid}
 * 4. members/{uid}
 * 5. instructors/{uid}
 * 6. instructors where uid == currentUser.uid
 */
export async function getUserRole(user = null) {
  const currentUser = user || auth.currentUser;
  if (!currentUser) {
    return null;
  }

  await ensureAuthTokenReady(currentUser);

  const uid = currentUser.uid;

  const adminSnap = await withRoleReadRetry(
    "admins/{uid}",
    currentUser,
    () => getDoc(doc(db, "admins", uid))
  );
  if (adminSnap?.exists()) {
    return "admin";
  }

  const instructorAccountSnap = await withRoleReadRetry(
    "instructorAccounts/{uid}",
    currentUser,
    () => getDoc(doc(db, "instructorAccounts", uid))
  );
  if (instructorAccountSnap?.exists()) {
    return "instructor";
  }

  // [CANONICAL-PATH] Normal student accounts resolve from students/{uid}.
  const studentSnap = await withRoleReadRetry(
    "students/{uid}",
    currentUser,
    () => getDoc(doc(db, "students", uid))
  );
  if (studentSnap?.exists()) {
    return "student";
  }

  const memberSnap = await withRoleReadRetry(
    "members/{uid}",
    currentUser,
    () => getDoc(doc(db, "members", uid))
  );
  if (memberSnap?.exists()) {
    return "member";
  }

  const instructorByDocIdSnap = await withRoleReadRetry(
    "instructors/{uid}",
    currentUser,
    () => getDoc(doc(db, "instructors", uid))
  );
  if (instructorByDocIdSnap?.exists()) {
    return "instructor";
  }

  // instructor 문서가 uid가 아닌 inst_* ID로 저장된 경우를 위한 fallback
  const instructorsByUidSnap = await withRoleReadRetry(
    "instructors where uid == auth.uid",
    currentUser,
    () => getDocs(query(collection(db, "instructors"), where("uid", "==", uid)))
  );
  if (instructorsByUidSnap && !instructorsByUidSnap.empty) {
    return "instructor";
  }

  return null;
}

export async function checkRole(user, allowedRoles) {
  const normalizedAllowedRoles = normalizeRoleList(allowedRoles);
  validateRoles(normalizedAllowedRoles);
  const role = await getUserRole(user);
  return Boolean(role && normalizedAllowedRoles.includes(role));
}

export async function isAdmin(user = null) {
  return checkRole(user, "admin");
}

export async function isInstructor(user = null) {
  return checkRole(user, "instructor");
}

export async function isStudent(user = null) {
  return checkRole(user, "student");
}

export async function isMember(user = null) {
  return checkRole(user, "member");
}

export function getDashboardUrl(role) {
  return DASHBOARD_URLS[normalizeRole(role)] || "/";
}

export async function requireRole(allowedRoles, redirectUrl = "/members/login.html") {
  const normalizedAllowedRoles = normalizeRoleList(allowedRoles);
  validateRoles(normalizedAllowedRoles);

  const user = await getCurrentUserWithWait();
  if (!user) {
    const nextUrl = encodeURIComponent(location.pathname + location.search);
    location.href = `/members/login.html?next=${nextUrl}`;
    throw new Error("로그인이 필요합니다.");
  }

  const role = await getUserRole(user);
  if (!role) {
    location.href = redirectUrl;
    throw new Error("역할이 설정되지 않았습니다.");
  }

  if (!normalizedAllowedRoles.includes(role)) {
    location.href = getDashboardUrl(role);
    throw new Error("접근 권한이 없습니다.");
  }

  return { user, role };
}

export async function guardPage(redirectUrl = "/members/login.html") {
  const user = await getCurrentUserWithWait();
  if (!user) {
    location.href = redirectUrl;
    throw new Error("로그인이 필요합니다.");
  }
  return user;
}
