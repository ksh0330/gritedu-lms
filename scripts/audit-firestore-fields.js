#!/usr/bin/env node

"use strict";

/**
 * Dry-run Firestore field census.
 *
 * This script scans known LMS collections and reports counts/sample document IDs
 * for legacy, compatibility, privacy-risk, and retention-cleanup candidate fields.
 *
 * Safety:
 * - Requires an explicit confirmation flag before connecting.
 * - Uses read-only Firestore APIs only.
 * - Prints counts and capped sample IDs; it does not modify data.
 * - Uses document-id pagination to avoid loading full collections at once.
 *
 * Usage:
 *   npm run audit:firestore-fields -- --confirm-read --project=YOUR_PROJECT_ID
 *
 * Authentication:
 *   Use Application Default Credentials, GOOGLE_APPLICATION_CREDENTIALS, or
 *   FIREBASE_SERVICE_ACCOUNT_JSON. If the root project does not have
 *   firebase-admin installed, this script will also try functions/node_modules.
 */

const fs = require("fs");
const path = require("path");

const SAMPLE_LIMIT = 10;
const DEFAULT_PAGE_SIZE = 300;
const LARGE_PAYLOAD_BYTES = 100 * 1024;

const args = process.argv.slice(2);
const confirmed = args.includes("--confirm-read") || process.env.FIRESTORE_FIELD_AUDIT_CONFIRM === "1";
const projectArg = args.find((arg) => arg.startsWith("--project="));
const pageSizeArg = args.find((arg) => arg.startsWith("--page-size="));
const projectId = projectArg ? projectArg.split("=").slice(1).join("=").trim() : process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const pageSize = Math.max(1, Number.parseInt(pageSizeArg ? pageSizeArg.split("=").slice(1).join("=") : "", 10) || DEFAULT_PAGE_SIZE);

if (!confirmed) {
  console.error("Refusing to connect without explicit dry-run confirmation.");
  console.error("Run with --confirm-read or set FIRESTORE_FIELD_AUDIT_CONFIRM=1.");
  process.exit(1);
}

const admin = loadFirebaseAdmin();
initializeAdmin(admin, projectId);

const db = admin.firestore();
const FieldPath = admin.firestore.FieldPath;

const report = {
  totals: Object.create(null),
  groups: Object.create(null),
  settingsDocs: Object.create(null),
  rangeInfo: Object.create(null),
};

const courseAccessById = Object.create(null);
const instructorAccountByUid = Object.create(null);
const linkedInstructorIds = Object.create(null);
const instructorDocIds = Object.create(null);
const deferredInstructorAccountChecks = [];

main().catch((error) => {
  console.error("Firestore field census failed.");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

async function main() {
  printHeader();

  await scanInstructorAccounts();
  await scanCourses();
  await scanEnrollments();
  await scanInstructors();
  finalizeInstructorAccountChecks();
  await scanOfflineClasses();
  await scanOfflineClassMembers();
  await scanOfflineClassSessions();
  await scanOfflineSessionAccess();
  await scanPublicTimetableEntries();
  await scanSettings();
  await scanPages();
  await scanChangeHistory();
  await scanEmailVerifications();
  await scanSignupAttempts();

  printReport();
  console.log("");
  console.log("No writes performed.");
}

function loadFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch (rootError) {
    try {
      return require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));
    } catch (functionsError) {
      console.error("Unable to load firebase-admin from root node_modules or functions/node_modules.");
      console.error("Install project dependencies first, then rerun this dry-run audit.");
      throw functionsError;
    }
  }
}

function initializeAdmin(firebaseAdmin, requestedProjectId) {
  if (firebaseAdmin.apps.length) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const options = {};

  if (requestedProjectId) {
    options.projectId = requestedProjectId;
  }

  if (serviceAccountJson) {
    options.credential = firebaseAdmin.credential.cert(JSON.parse(serviceAccountJson));
  } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    options.credential = firebaseAdmin.credential.cert(require(path.resolve(serviceAccountPath)));
  } else {
    options.credential = firebaseAdmin.credential.applicationDefault();
  }

  firebaseAdmin.initializeApp(options);
}

function printHeader() {
  console.log("Firestore Field Census Dry Run");
  console.log("==============================");
  console.log(`Project: ${projectId || "(from credentials/default app)"}`);
  console.log(`Page size: ${pageSize}`);
  console.log("Mode: read-only field census");
  console.log("");
}

async function scanCollection(collectionName, onDoc) {
  let scanned = 0;
  let lastDoc = null;

  for (;;) {
    let query = db.collection(collectionName).orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      scanned += 1;
      await onDoc(doc);
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
  }

  report.totals[collectionName] = scanned;
}

async function scanInstructorAccounts() {
  await scanCollection("instructorAccounts", (doc) => {
    const data = doc.data() || {};
    instructorAccountByUid[doc.id] = data;
    if (stringValue(data.instructorId)) {
      linkedInstructorIds[data.instructorId] = true;
    }

    if (!stringValue(data.instructorId)) record("instructorAccounts", "missing instructorId", doc.id);
    if (!stringValue(data.emailLower)) record("instructorAccounts", "missing emailLower", doc.id);
    if (stringValue(data.instructorId)) {
      deferredInstructorAccountChecks.push({
        id: doc.id,
        instructorId: data.instructorId,
      });
    }
  });
}

async function scanCourses() {
  await scanCollection("courses", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;

    if (data.accessType === "public") courseAccessById[id] = "public";

    for (const field of ["classId", "classIds", "classes", "examContents", "exam_contents", "thumbnail", "coverImage", "image"]) {
      if (hasOwn(data, field)) record("courses", `${field} present`, id);
    }

    if (data.accessType === "paid") record("courses", "paid accessType", id);
    if (data.courseFormat === "weekly") record("courses", "weekly courseFormat", id);
    if (!hasOwn(data, "visibility")) record("courses", "missing visibility", id);
    if (!hasOwn(data, "status")) record("courses", "missing status", id);
    if (hasOwn(data, "instructorUids")) record("courses", "instructorUids present", id);

    const displayFields = ["title", "shortDescription", "description", "subject", "grade"];
    if (displayFields.some((field) => !stringValue(data[field]))) {
      record("courses", "missing student-safe required display fields", id);
    }
  });
}

async function scanEnrollments() {
  await scanCollection("enrollments", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;
    const expectedId = stringValue(data.userId) && stringValue(data.courseId) ? `${data.userId}_${data.courseId}` : null;

    if (expectedId && id !== expectedId) record("enrollments", "document ID not matching {userId}_{courseId}", id);
    if (!stringValue(data.userId)) record("enrollments", "missing userId", id);
    if (!stringValue(data.courseId)) record("enrollments", "missing courseId", id);
    if (!plainObject(data.studentSnapshot)) record("enrollments", "missing studentSnapshot", id);
    if (stringValue(data.courseId) && courseAccessById[data.courseId] === "public") record("enrollments", "public-course enrollment", id);
    if (hasOwn(data, "classId")) record("enrollments", "classId field present", id);
  });
}

async function scanInstructors() {
  await scanCollection("instructors", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;
    instructorDocIds[id] = true;
    if (stringValue(data.instructorId)) instructorDocIds[data.instructorId] = true;

    for (const field of ["email", "emailLower", "phone", "note"]) {
      if (hasOwn(data, field)) record("instructors", `${field} present`, id);
    }

    for (const field of [
      "intro",
      "introDetail",
      "intro_detail",
      "content_html",
      "poster",
      "posters",
      "postersEnabled",
      "textbooks",
      "classes",
      "order",
      "highlights",
      "youtube_id",
      "status",
      "sortOrder"
    ]) {
      if (hasOwn(data, field)) record("instructors", `legacy ${field} present`, id);
    }

    for (const field of ["photo", "imageUrl", "avatar", "photoURL", "profileImage", "profileImageUrl"]) {
      if (hasOwn(data, field)) record("instructors", `${field} image alias present`, id);
    }

    if (Array.isArray(data.videos) && data.videos.some((item) => item && typeof item === "object" && hasOwn(item, "youtube_url"))) {
      record("instructors", "videos[].youtube_url present", id);
    }

    for (const field of ["video", "youtube_url"]) {
      if (hasOwn(data, field)) record("instructors", `${field} scalar video field present`, id);
    }

    if (!stringValue(data.instructorId)) record("instructors", "missing instructorId", id);
    if (linkedInstructorIds[id] && !stringValue(data.uid)) record("instructors", "linked profile missing uid", id);
    if (stringValue(data.uid) && !instructorAccountByUid[data.uid]) record("instructors", "uid present but no matching instructorAccounts doc", id);
  });
}

function finalizeInstructorAccountChecks() {
  for (const check of deferredInstructorAccountChecks) {
    if (!instructorDocIds[check.instructorId]) {
      record("instructorAccounts", "account points to missing instructors/{instructorId}", check.id);
    }
  }
}

async function scanOfflineClasses() {
  await scanCollection("offlineClasses", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;

    if (!Array.isArray(data.scheduleItems) || data.scheduleItems.length === 0) record("offlineClasses", "scheduleItems missing", id);
    for (const field of ["scheduleDays", "startTime", "endTime", "room"]) {
      if (hasOwn(data, field)) record("offlineClasses", `${field} schedule summary field present`, id);
    }
    if (hasOwn(data, "instructorUids")) record("offlineClasses", "instructorUids present", id);
    if (!stringValue(data.instructorId) && stringValue(data.instructorUid)) record("offlineClasses", "missing instructorId while instructorUid exists", id);
    if (!stringValue(data.instructorUid) && stringValue(data.instructorId)) record("offlineClasses", "missing instructorUid while instructorId exists", id);
  });
}

async function scanOfflineClassMembers() {
  await scanCollection("offlineClassMembers", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;

    for (const field of ["studentNameSnapshot", "schoolSnapshot", "gradeSnapshot", "phoneSnapshot"]) {
      if (!stringValue(data[field])) record("offlineClassMembers", `missing ${field}`, id);
    }
    for (const field of ["name", "studentName", "school", "grade", "phone"]) {
      if (hasOwn(data, field)) record("offlineClassMembers", `${field} legacy fallback field present`, id);
    }
  });
}

async function scanOfflineClassSessions() {
  await scanCollection("offlineClassSessions", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;
    const videos = Array.isArray(data.videos) ? data.videos : [];

    if (hasOwn(data, "videoUrl") && stringValue(data.videoUrl)) record("offlineClassSessions", "videoUrl present", id);
    if (data.hasVideo === true && videos.length === 0) record("offlineClassSessions", "videos missing or empty while hasVideo true", id);
    if (data.hasVideo === false && videos.length > 0) record("offlineClassSessions", "hasVideo false but videos non-empty", id);
    if (data.status === "draft") record("offlineClassSessions", "status draft", id);
    if (!stringValue(data.sessionDate)) record("offlineClassSessions", "missing sessionDate", id);
    if (!stringValue(data.classId)) record("offlineClassSessions", "missing classId", id);
  });
}

async function scanOfflineSessionAccess() {
  await scanCollection("offlineSessionAccess", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;

    if (data.source === "auto") record("offlineSessionAccess", "source auto", id);
    if (!stringValue(data.type)) record("offlineSessionAccess", "missing type", id);
    if (!stringValue(data.status)) record("offlineSessionAccess", "missing status", id);
    for (const field of ["classId", "sessionId", "studentUid"]) {
      if (!stringValue(data[field])) record("offlineSessionAccess", `missing ${field}`, id);
    }
    if (hasOwn(data, "grantedBy") && stringValue(data.grantedBy)) record("offlineSessionAccess", "grantedBy present", id);
    if (hasOwn(data, "revokedBy") && stringValue(data.revokedBy)) record("offlineSessionAccess", "revokedBy present", id);
    if ((data.type === "manualGrant" || data.status === "active" || hasOwn(data, "grantedAt")) && !stringValue(data.grantedBy)) {
      record("offlineSessionAccess", "grantedBy missing where granted state exists", id);
    }
    if ((data.type === "manualRevoke" || data.status === "revoked" || hasOwn(data, "revokedAt")) && !stringValue(data.revokedBy)) {
      record("offlineSessionAccess", "revokedBy missing where revoked state exists", id);
    }
  });
}

async function scanPublicTimetableEntries() {
  await scanCollection("publicTimetableEntries", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;

    for (const field of ["timetableImageUrl", "title", "memo", "sourceType", "sourceOfflineClassId"]) {
      if (hasOwn(data, field)) record("publicTimetableEntries", `${field} present`, id);
    }
    if (!hasOwn(data, "visible")) record("publicTimetableEntries", "visible missing", id);
    if (!stringValue(data.className)) record("publicTimetableEntries", "missing className", id);
    if (!Array.isArray(data.scheduleItems) || data.scheduleItems.length === 0) record("publicTimetableEntries", "missing scheduleItems", id);
  });
}

async function scanSettings() {
  const docIds = ["signup", "instructorsMenu", "courseCatalog", "operationCatalog", "coursesMenu", "timetableCatalog", "popups"];

  for (const docId of docIds) {
    const snapshot = await db.collection("settings").doc(docId).get();
    report.settingsDocs[docId] = snapshot.exists;
    if (!snapshot.exists) {
      record("settings", `${docId} doc missing`, docId);
      continue;
    }

    record("settings", `${docId} doc exists`, docId);
    if (docId === "popups") {
      const data = snapshot.data() || {};
      if (Array.isArray(data.popups)) {
        recordBy("settings", "popups shape: popups array", docId, data.popups.length);
      } else {
        record("settings", "popups shape: missing/non-array popups", docId);
      }
    }
  }
}

async function scanPages() {
  await scanCollection("pages", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;

    if (hasOwn(data, "body")) record("pages", "body present", id);
    if (hasOwn(data, "content")) record("pages", "content present", id);
    if (hasOwn(data, "structure")) record("pages", "structure present", id);
    if (!hasOwn(data, "content") && !hasOwn(data, "structure")) record("pages", "docs missing content and structure", id);
  });
}

async function scanChangeHistory() {
  await scanCollection("changeHistory", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;
    const timestamp = toDate(data.timestamp);
    updateRange("changeHistory timestamp", id, timestamp);

    const size = approximateJsonBytes(data);
    if (size >= LARGE_PAYLOAD_BYTES) record("changeHistory", `large payload >= ${LARGE_PAYLOAD_BYTES} bytes`, id);
  });
}

async function scanEmailVerifications() {
  const now = new Date();
  const sevenDaysAgo = daysAgo(7);
  const thirtyDaysAgo = daysAgo(30);

  await scanCollection("emailVerifications", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;
    const expiresAt = toDate(data.expiresAt);
    const createdAt = toDate(data.createdAt);

    if (expiresAt && expiresAt < now) record("emailVerifications", "expired docs based on expiresAt", id);
    if (data.used === true) record("emailVerifications", "used docs", id);
    if (hasOwn(data, "invalidatedAt") || hasOwn(data, "invalidationReason")) record("emailVerifications", "invalidated docs", id);
    if (createdAt && createdAt < sevenDaysAgo) record("emailVerifications", "old docs older than 7 days", id);
    if (createdAt && createdAt < thirtyDaysAgo) record("emailVerifications", "old docs older than 30 days", id);
  });
}

async function scanSignupAttempts() {
  const sevenDaysAgo = daysAgo(7);
  const thirtyDaysAgo = daysAgo(30);

  await scanCollection("signupAttempts", (doc) => {
    const data = doc.data() || {};
    const id = doc.id;
    const timestamp = toDate(data.timestamp);

    if (timestamp && timestamp < sevenDaysAgo) record("signupAttempts", "docs older than 7 days", id);
    if (timestamp && timestamp < thirtyDaysAgo) record("signupAttempts", "docs older than 30 days", id);
    if (hasOwn(data, "blockedUntil")) record("signupAttempts", "docs with blockedUntil", id);
    if (!timestamp) record("signupAttempts", "docs missing timestamp", id);
  });
}

function record(groupName, findingName, docId) {
  recordBy(groupName, findingName, docId, 1);
}

function recordBy(groupName, findingName, docId, amount) {
  if (!report.groups[groupName]) {
    report.groups[groupName] = Object.create(null);
  }

  const group = report.groups[groupName];
  if (!group[findingName]) {
    group[findingName] = { count: 0, samples: [] };
  }

  const finding = group[findingName];
  finding.count += amount;
  if (docId && finding.samples.length < SAMPLE_LIMIT && !finding.samples.includes(docId)) {
    finding.samples.push(docId);
  }
}

function updateRange(name, docId, value) {
  if (!value) return;

  if (!report.rangeInfo[name]) {
    report.rangeInfo[name] = {
      oldest: { value, docId },
      newest: { value, docId },
    };
    return;
  }

  const range = report.rangeInfo[name];
  if (value < range.oldest.value) range.oldest = { value, docId };
  if (value > range.newest.value) range.newest = { value, docId };
}

function printReport() {
  console.log("Collection Totals");
  console.log("-----------------");
  for (const [collectionName, count] of Object.entries(report.totals)) {
    console.log(`${collectionName}: ${count}`);
  }

  if (Object.keys(report.settingsDocs).length) {
    console.log("");
    console.log("Settings Document Presence");
    console.log("--------------------------");
    for (const [docId, exists] of Object.entries(report.settingsDocs)) {
      console.log(`settings/${docId}: ${exists ? "present" : "missing"}`);
    }
  }

  if (Object.keys(report.rangeInfo).length) {
    console.log("");
    console.log("Timestamp Ranges");
    console.log("----------------");
    for (const [name, range] of Object.entries(report.rangeInfo)) {
      console.log(`${name}:`);
      console.log(`  oldest: ${range.oldest.value.toISOString()} (${range.oldest.docId})`);
      console.log(`  newest: ${range.newest.value.toISOString()} (${range.newest.docId})`);
    }
  }

  console.log("");
  console.log("Findings");
  console.log("--------");
  for (const [groupName, findings] of Object.entries(report.groups)) {
    console.log("");
    console.log(`[${groupName}]`);
    for (const [findingName, finding] of Object.entries(findings)) {
      const samples = finding.samples.length ? finding.samples.join(", ") : "-";
      console.log(`- ${findingName}: ${finding.count}`);
      console.log(`  samples: ${samples}`);
    }
  }
}

function hasOwn(data, field) {
  return Object.prototype.hasOwnProperty.call(data, field);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function approximateJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch (error) {
    return 0;
  }
}
