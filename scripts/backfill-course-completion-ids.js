#!/usr/bin/env node
"use strict";
// Owner-run one-time backfill: courses.completionVideoIds (IDs only, no URLs) for approval-required courses,
// computed from coursePrivateContent with the same browser module students use. Dry-run by default.
// Writes only that field inside a per-course transaction. Output contains counts only.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const ROOT = path.resolve(__dirname, "..");
const PAGE_SIZE = 200;

function fail(message) { const error = new Error(message); error.safeMessage = message; throw error; }

function parseArgs(argv) {
  const args = { dryRun: true, projectId: "", confirmCount: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") args.dryRun = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--project" || arg === "--confirm-count") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) fail("Missing argument value.");
      if (arg === "--project") args.projectId = value.trim();
      else {
        if (!/^\d+$/.test(value)) fail("confirm-count must be a nonnegative integer.");
        args.confirmCount = Number(value);
      }
    } else fail("Unknown argument.");
  }
  return args;
}

const loadCompletion = () => import(pathToFileURL(path.join(ROOT, "assets/js/utils/course-completion.js")).href);
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// courses: [{id, data}], privateById: Map courseId -> private data|null, collect: (courseId, weeks) => ids
function buildCompletionIdPlan(courses, privateById, collect) {
  const totals = { approvalCourses: courses.length, toUpdate: 0, alreadyCurrent: 0, blockedMissingPrivate: 0, withoutVideos: 0 };
  const targets = [];
  courses.forEach(({ id, data }) => {
    const privateData = privateById.get(id);
    if (!privateData) { totals.blockedMissingPrivate += 1; return; }
    const ids = collect(id, privateData.weeks);
    if (!ids.length) totals.withoutVideos += 1;
    if (sameList(data.completionVideoIds, ids)) { totals.alreadyCurrent += 1; return; }
    totals.toUpdate += 1;
    targets.push(id);
  });
  return { totals, targets };
}

async function scanApprovalCourses(db, documentIdField) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("courses").where("accessType", "==", "approvalRequired").orderBy(documentIdField).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    snap.docs.forEach((d) => rows.push({ id: d.id, data: d.data() || {} }));
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function loadPrivate(db, ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db.getAll(...ids.slice(i, i + 100).map((id) => db.collection("coursePrivateContent").doc(id)));
    snaps.forEach((snap) => map.set(snap.id, snap.exists ? (snap.data() || {}) : null));
  }
  return map;
}

async function backfillCourse(db, courseId, collect) {
  const courseRef = db.collection("courses").doc(courseId);
  const privateRef = db.collection("coursePrivateContent").doc(courseId);
  return db.runTransaction(async (transaction) => {
    const [courseSnap, privateSnap] = await Promise.all([transaction.get(courseRef), transaction.get(privateRef)]);
    if (!courseSnap.exists || !privateSnap.exists) return "skipped";
    const course = courseSnap.data() || {};
    if (course.accessType !== "approvalRequired") return "skipped";
    const ids = collect(courseId, (privateSnap.data() || {}).weeks);
    if (sameList(course.completionVideoIds, ids)) return "skipped";
    transaction.update(courseRef, { completionVideoIds: ids });
    return "updated";
  });
}

function loadFirebaseAdmin() {
  try { return require("firebase-admin"); }
  catch { return createRequire(path.resolve(ROOT, "functions/package.json"))("firebase-admin"); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) fail("An explicit --project is required.");
  if (!args.dryRun && args.confirmCount == null) fail("Write requires --confirm-count from the dry-run.");
  const { collectCourseVideoIds } = await loadCompletion();
  const admin = loadFirebaseAdmin();
  admin.initializeApp({ projectId: args.projectId, credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const courses = await scanApprovalCourses(db, admin.firestore.FieldPath.documentId());
  const plan = buildCompletionIdPlan(courses, await loadPrivate(db, courses.map((c) => c.id)), collectCourseVideoIds);
  const t = plan.totals;
  if (args.dryRun) {
    console.log("[backfill-course-completion-ids] DRY RUN, no database writes.");
    console.log("  approval courses scanned: " + t.approvalCourses);
    console.log("  courses to update: " + t.toUpdate);
    console.log("  already current: " + t.alreadyCurrent);
    console.log("  blocked (protected content missing): " + t.blockedMissingPrivate);
    console.log("  courses with no videos (empty list): " + t.withoutVideos);
    console.log("  confirmed write target count: " + plan.targets.length);
    return;
  }
  if (plan.targets.length !== args.confirmCount) fail("Target count changed since the dry-run. Re-run the dry-run.");
  console.log("[backfill-course-completion-ids] WRITE mode.");
  let updated = 0;
  let skipped = 0;
  for (const courseId of plan.targets) {
    if ((await backfillCourse(db, courseId, collectCourseVideoIds)) === "updated") updated += 1; else skipped += 1;
  }
  console.log("  updated: " + updated + "; skipped (already current or no longer eligible): " + skipped);
}

if (require.main === module) main().catch((error) => {
  console.error("[backfill-course-completion-ids] failed:", error.safeMessage || "operation failed (code: " + (error.code || "unknown") + "); check ADC and permissions");
  process.exitCode = 1;
});

module.exports = { parseArgs, buildCompletionIdPlan, backfillCourse, loadCompletion };
