#!/usr/bin/env node
"use strict";

/*
 * Dry-run by default:
 *   node scripts/backfill-course-visibility.js
 *
 * Apply updates explicitly:
 *   node scripts/backfill-course-visibility.js --write
 *   node scripts/backfill-course-visibility.js --project <projectId> --write
 */

const path = require("path");
const { createRequire } = require("module");

function parseArgs(argv) {
  const args = {
    dryRun: true,
    projectId: "",
    limit: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      args.dryRun = false;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--project") {
      args.projectId = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(argv[index + 1] || "0", 10) || 0;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Backfill missing course visibility for clearly active published catalog courses.

Usage:
  node scripts/backfill-course-visibility.js [options]

Options:
  --dry-run          Preview changes only. This is the default.
  --write            Apply visibility: "public" updates.
  --project <id>     Firebase project id for Admin SDK initialization.
  --limit <number>   Limit processed candidate count.
`);
}

function loadFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch (rootError) {
    try {
      const functionsRequire = createRequire(path.resolve(__dirname, "../functions/package.json"));
      return functionsRequire("firebase-admin");
    } catch (functionsError) {
      console.error("[backfill] firebase-admin is not installed in root or functions dependencies.");
      console.error("[backfill] Run npm install in the functions directory, or install firebase-admin for this workspace.");
      process.exit(1);
    }
  }
}

function initializeAdmin(admin, projectId) {
  if (admin.apps.length > 0) return;
  const options = projectId ? { projectId } : undefined;
  admin.initializeApp(options);
}

function hasExplicitVisibility(course) {
  return Object.prototype.hasOwnProperty.call(course, "visibility") &&
    course.visibility != null &&
    String(course.visibility).trim() !== "";
}

function hasLegacyHiddenFlag(course) {
  return course.hidden === true ||
    course.isHidden === true ||
    course.deleted === true ||
    course.isDeleted === true ||
    course.blocked === true ||
    course.isBlocked === true;
}

function normalizeAccessType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "public") return "public";
  if (raw === "memberonly" || raw === "member_only" || raw === "member") return "memberOnly";
  return raw;
}

function isClearlyActiveCatalogCourse(course) {
  if (course.status !== "published") return false;
  if (hasLegacyHiddenFlag(course)) return false;

  const accessType = normalizeAccessType(course.accessType);
  return accessType === "public" || accessType === "memberOnly";
}

async function commitBatch(batch, dryRun) {
  if (dryRun) return;
  await batch.commit();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const admin = loadFirebaseAdmin();
  initializeAdmin(admin, args.projectId);

  const db = admin.firestore();
  const snapshot = await db.collection("courses").where("status", "==", "published").get();
  const candidates = [];
  let skippedWithVisibility = 0;
  let skippedInactive = 0;

  snapshot.forEach((docSnap) => {
    const course = docSnap.data() || {};
    if (hasExplicitVisibility(course)) {
      skippedWithVisibility += 1;
      return;
    }
    if (!isClearlyActiveCatalogCourse(course)) {
      skippedInactive += 1;
      return;
    }
    candidates.push(docSnap);
  });

  const selected = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;
  console.log("[backfill] published courses scanned:", snapshot.size);
  console.log("[backfill] skipped with explicit visibility:", skippedWithVisibility);
  console.log("[backfill] skipped inactive/hidden/unsupported:", skippedInactive);
  console.log("[backfill] candidates:", selected.length);
  console.log(args.dryRun ? "[backfill] DRY RUN mode, no writes." : "[backfill] WRITE mode.");

  if (selected.length === 0) return;

  if (args.dryRun) {
    selected.slice(0, 20).forEach((docSnap) => {
      console.log(`[dry-run] courses/${docSnap.id} -> visibility: "public"`);
    });
    if (selected.length > 20) {
      console.log(`[dry-run] ...and ${selected.length - 20} more`);
    }
    return;
  }

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  for (const docSnap of selected) {
    batch.update(docSnap.ref, {
      visibility: "public",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    pending += 1;
    written += 1;

    if (pending >= 450) {
      await commitBatch(batch, false);
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await commitBatch(batch, false);

  console.log("[backfill] updated:", written);
}

main().catch((error) => {
  console.error("[backfill] Fatal error:", error);
  process.exitCode = 1;
});
