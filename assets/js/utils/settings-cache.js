import { db } from "/assets/js/firebase-init.js";
import { doc, getDoc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const VALID_KEYS = ["coursesMenu", "instructorsMenu", "signup", "popups", "courseCatalog", "timetableCatalog", "offlineClassCatalog"];
const SESSION_CACHE_KEYS = new Set(["coursesMenu", "instructorsMenu", "courseCatalog", "timetableCatalog", "offlineClassCatalog"]);
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_CACHE_PREFIX = "grit-settings-cache:";
const cache = new Map();

function getSessionCacheKey(key) {
  return `${SESSION_CACHE_PREFIX}${key}`;
}

function readSessionCachedSetting(key) {
  if (!SESSION_CACHE_KEYS.has(key) || typeof sessionStorage === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(getSessionCacheKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(getSessionCacheKey(key));
      return null;
    }
    const data = parsed.data && typeof parsed.data === "object" ? parsed.data : {};
    return { exists: parsed.exists === true, data };
  } catch (_error) {
    return null;
  }
}

function writeSessionCachedSetting(key, result) {
  if (!SESSION_CACHE_KEYS.has(key) || typeof sessionStorage === "undefined") return;

  try {
    sessionStorage.setItem(getSessionCacheKey(key), JSON.stringify({
      exists: result.exists === true,
      data: result.data || {},
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS
    }));
  } catch (_error) {
    // Storage can be disabled or full; in-memory cache still applies.
  }
}

function snapExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
}

function snapData(snap) {
  if (!snapExists(snap) || typeof snap.data !== "function") return {};
  const d = snap.data();
  return d && typeof d === "object" ? d : {};
}

export async function getSettingDoc(key) {
  if (!VALID_KEYS.includes(key)) throw new Error(`Invalid settings key: ${key}`);
  if (cache.has(key)) return cache.get(key);

  const sessionCached = readSessionCachedSetting(key);
  if (sessionCached) {
    cache.set(key, sessionCached);
    return sessionCached;
  }

  const snap = await getDoc(doc(db, "settings", key));
  const exists = snapExists(snap);
  const result = { exists, data: exists ? snapData(snap) : {} };
  cache.set(key, result);
  writeSessionCachedSetting(key, result);
  return result;
}

/**
 * Public pages: always read latest CMS settings from Firestore server (no session/in-memory cache).
 * @param {string} key
 * @returns {Promise<{ exists: boolean, data: Record<string, unknown> }>}
 */
export async function getPublicSettingDoc(key) {
  if (!VALID_KEYS.includes(key)) throw new Error(`Invalid settings key: ${key}`);
  const snap = await getDocFromServer(doc(db, "settings", key));
  const exists = snapExists(snap);
  return { exists, data: exists ? snapData(snap) : {} };
}

/**
 * Admin CMS: always read the latest Firestore server value (skip in-memory/session cache).
 * @param {string} key
 * @returns {Promise<{ exists: boolean, data: Record<string, unknown> }>}
 */
export async function getAdminSettingDoc(key) {
  if (!VALID_KEYS.includes(key)) throw new Error(`Invalid settings key: ${key}`);
  invalidateSetting(key);
  const snap = await getDocFromServer(doc(db, "settings", key));
  const exists = snapExists(snap);
  const result = { exists, data: exists ? snapData(snap) : {} };
  cache.set(key, result);
  writeSessionCachedSetting(key, result);
  return result;
}

export function invalidateSetting(key) {
  if (!VALID_KEYS.includes(key)) return;
  cache.delete(key);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(getSessionCacheKey(key));
  }
}

export function invalidateAllSettings() {
  cache.clear();
  if (typeof sessionStorage === "undefined") return;
  SESSION_CACHE_KEYS.forEach((key) => {
    sessionStorage.removeItem(getSessionCacheKey(key));
  });
}
