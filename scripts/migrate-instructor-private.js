#!/usr/bin/env node
"use strict";

// One instructor per Firestore transaction. Dry-run is the default; never prints data or IDs.
const { createRequire } = require("node:module");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const INTERNAL = ["uid", "email", "emailLower", "phone", "note", "pending"];
const PUBLIC = ["name", "subject", "subjects", "category", "bio", "brief", "photo", "videos",
  "curriculumImageUrl", "curriculumImageUrls", "instructorId", "order", "sortOrder", "createdAt", "updatedAt"];
const EXPECTED = { instructors: 20, instructorAccounts: 20, courses: 16, offlineClasses: 79 };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (code) => { throw new Error(code); };

async function pages(db, name) {
  const result = [];
  let last;
  while (true) {
    let query = db.collection(name).orderBy("__name__").limit(50);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    result.push(...snap.docs);
    if (snap.size < 50) return result;
    if (result.length > 500) fail("COLLECTION_LIMIT_EXCEEDED");
    last = snap.docs[snap.docs.length - 1];
  }
}

function checkProfile(profile, privateData, account) {
  const publicData = profile.data();
  const keys = Object.keys(publicData);
  if (keys.some((key) => !PUBLIC.includes(key) && !INTERNAL.includes(key))) fail("UNKNOWN_PROFILE_FIELD");
  const internalKeys = INTERNAL.filter((key) => own(publicData, key));
  if (!internalKeys.length && !privateData) fail("MISSING_PRIVATE_SOURCE");
  if (internalKeys.length && !own(publicData, "uid")) fail("MISSING_SOURCE_UID");
  const uid = publicData.uid ?? privateData?.uid;
  if (typeof uid !== "string" || !uid || !account) fail("ACCOUNT_LINK_MISSING");
  const accountData = account.data();
  if (account.id !== uid || accountData.instructorId !== profile.id ||
      (own(accountData, "uid") && accountData.uid !== uid)) fail("ACCOUNT_LINK_MISMATCH");
  const emailLower = publicData.emailLower ?? privateData?.emailLower;
  if (typeof emailLower !== "string" || !emailLower ||
      String(accountData.emailLower || accountData.email || "").toLowerCase() !== emailLower.toLowerCase()) {
    fail("ACCOUNT_EMAIL_MISMATCH");
  }
  if (privateData) {
    for (const key of internalKeys) {
      if (!own(privateData, key) || !isDeepStrictEqual(privateData[key], publicData[key])) fail("PRIVATE_CONFLICT");
    }
  }
  return internalKeys;
}

function referenceState(docs) {
  return docs.map((snap) => {
    const data = snap.data();
    return [snap.id, data.instructorId, data.instructorUid, data.instructorIds, data.instructorUids];
  });
}

function checkReferences(docs, profileIds, accountById) {
  let linked = 0;
  const resolve = (value) => {
    if (typeof value !== "string" || !value) fail("INVALID_INSTRUCTOR_REFERENCE");
    if (profileIds.has(value)) return value;
    const account = accountById.get(value);
    if (account && profileIds.has(account.data().instructorId)) return account.data().instructorId;
    fail("UNRESOLVED_INSTRUCTOR_REFERENCE");
  };
  for (const snap of docs) {
    const data = snap.data();
    const ids = [data.instructorId, ...(data.instructorIds || [])].filter(Boolean).map(resolve);
    const uids = [data.instructorUid, ...(data.instructorUids || [])].filter(Boolean).map(resolve);
    if (ids.length || uids.length) linked += 1;
    if (ids.length && uids.length && !isDeepStrictEqual(new Set(ids), new Set(uids))) {
      fail("INSTRUCTOR_REFERENCE_MISMATCH");
    }
  }
  return linked;
}

async function inspect(db, expected = EXPECTED) {
  const [profiles, privates, accounts, courses, classes] = await Promise.all([
    pages(db, "instructors"), pages(db, "instructorPrivate"), pages(db, "instructorAccounts"),
    pages(db, "courses"), pages(db, "offlineClasses")
  ]);
  for (const [name, count] of Object.entries(expected)) {
    const actual = { instructors: profiles.length, instructorAccounts: accounts.length,
      courses: courses.length, offlineClasses: classes.length }[name];
    if (actual !== count) fail("EXPECTED_COUNT_CHANGED");
  }
  const profileIds = new Set(profiles.map((snap) => snap.id));
  const privateById = new Map(privates.map((snap) => [snap.id, snap.data()]));
  const accountById = new Map(accounts.map((snap) => [snap.id, snap]));
  if (privates.some((snap) => !profileIds.has(snap.id))) fail("ORPHAN_PRIVATE");
  const emailOwners = new Map();
  const summary = { profiles: profiles.length, accounts: accounts.length, private: privates.length,
    courses: courses.length, offlineClasses: classes.length, toMove: 0, alreadyMoved: 0,
    fields: Object.fromEntries(INTERNAL.map((key) => [key, 0])) };
  for (const profile of profiles) {
    const data = profile.data();
    const privateData = privateById.get(profile.id);
    const uid = data.uid ?? privateData?.uid;
    const keys = checkProfile(profile, privateData, accountById.get(uid));
    if (keys.length) summary.toMove += 1;
    else summary.alreadyMoved += 1;
    for (const key of keys) summary.fields[key] += 1;
    const email = (data.emailLower ?? privateData?.emailLower).toLowerCase();
    if (emailOwners.has(email)) fail("DUPLICATE_EMAIL");
    emailOwners.set(email, profile.id);
  }
  if (accounts.some((snap) => !profileIds.has(snap.data().instructorId))) fail("ORPHAN_ACCOUNT");
  summary.linkedCourses = checkReferences(courses, profileIds, accountById);
  summary.linkedOfflineClasses = checkReferences(classes, profileIds, accountById);
  return { profiles, summary, references: {
    courses: referenceState(courses), offlineClasses: referenceState(classes)
  } };
}

async function moveOne(db, profileId, FieldValue) {
  return db.runTransaction(async (tx) => {
    const publicRef = db.collection("instructors").doc(profileId);
    const privateRef = db.collection("instructorPrivate").doc(profileId);
    const [profile, privateSnap] = await Promise.all([tx.get(publicRef), tx.get(privateRef)]);
    if (!profile.exists) fail("PROFILE_DISAPPEARED");
    const publicData = profile.data();
    const privateData = privateSnap.exists ? privateSnap.data() : undefined;
    const uid = publicData.uid ?? privateData?.uid;
    if (typeof uid !== "string" || !uid) fail("MISSING_SOURCE_UID");
    const account = await tx.get(db.collection("instructorAccounts").doc(uid));
    const keys = checkProfile(profile, privateData, account.exists ? account : undefined);
    if (!keys.length) return "alreadyMoved";
    if (!privateData) tx.create(privateRef, Object.fromEntries(keys.map((key) => [key, publicData[key]])));
    tx.update(publicRef, Object.fromEntries(keys.map((key) => [key, FieldValue.delete()])));
    return "moved";
  });
}

async function migrate(db, FieldValue, { apply = false, expected = EXPECTED } = {}) {
  const before = await inspect(db, expected);
  if (!apply) return { mode: "DRY_RUN", ...before.summary };
  let moved = 0;
  for (const profile of before.profiles) {
    if (await moveOne(db, profile.id, FieldValue) === "moved") moved += 1;
  }
  const after = await inspect(db, expected);
  if (after.summary.toMove !== 0 || after.summary.private !== after.summary.profiles ||
      !isDeepStrictEqual(after.references, before.references)) fail("POSTCHECK_MISMATCH");
  return { mode: "APPLIED", moved, ...after.summary };
}

function adminSdk() {
  const requireFunctions = createRequire(path.resolve(__dirname, "../functions/package.json"));
  return requireFunctions("firebase-admin");
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/migrate-instructor-private.js --project gritedu-lms [--apply --confirm-count 20]\nDry-run by default. Existing Firebase Admin SDK credentials or ADC are required. No IDs or values are printed.");
    return;
  }
  const value = (flag) => argv[argv.indexOf(flag) + 1];
  const projectId = argv.includes("--project") ? value("--project") : "";
  const apply = argv.includes("--apply");
  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) fail("PROJECT_REQUIRED");
  if (apply && (projectId !== "gritedu-lms" || !argv.includes("--confirm-count") ||
      value("--confirm-count") !== "20")) fail("APPLY_GUARD_FAILED");
  if (apply && process.env.FIRESTORE_EMULATOR_HOST) fail("EMULATOR_HOST_SET");
  const admin = adminSdk();
  const app = admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId }, "instructor-private-migration");
  try {
    const result = await migrate(app.firestore(), admin.firestore.FieldValue, { apply });
    console.log(JSON.stringify(result));
  } finally {
    await app.delete();
  }
}

if (require.main === module) main().catch((error) => {
  // Never print SDK exceptions: they can contain paths, IDs, or document values.
  const safe = /^[A-Z_]+$/.test(error?.message || "") ? error.message : "FIRESTORE_OR_AUTH_ERROR";
  console.error(`[instructor-private-migration] ${safe}; stopped. No further documents attempted.`);
  process.exitCode = 1;
});

module.exports = { INTERNAL, PUBLIC, inspect, migrate, moveOne };
