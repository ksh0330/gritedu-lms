#!/usr/bin/env node
/**
 * One-time migration: exam_contents -> courses
 *
 * - Reads all docs from `exam_contents`
 * - Writes mapped docs to `courses` using the same doc ID
 * - Never modifies or deletes source docs
 * - Safe by default: skips destination docs that already exist
 *
 * Usage (from /functions):
 *   node scripts/migrate-exam-contents-to-courses.js
 *
 * Optional:
 *   node scripts/migrate-exam-contents-to-courses.js --project <projectId>
 *   node scripts/migrate-exam-contents-to-courses.js --dry-run
 *   node scripts/migrate-exam-contents-to-courses.js --verbose
 */

const admin = require("firebase-admin");

const SOURCE_COLLECTION = "exam_contents";
const DEST_COLLECTION = "courses";

function parseArgs(argv) {
  const out = {
    projectId: null,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project") {
      out.projectId = argv[i + 1] || null;
      i++;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--verbose") {
      out.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
One-time migration: exam_contents -> courses

Usage:
  node scripts/migrate-exam-contents-to-courses.js [options]

Options:
  --project <id>   Explicit Firebase project ID
  --dry-run        Read + map only, do not write
  --verbose        Log per-document skip/error details
  -h, --help       Show this help
`);
}

function initFirebase(projectId) {
  if (admin.apps.length > 0) return admin.app();

  const options = {};
  if (projectId) options.projectId = projectId;

  return admin.initializeApp(options);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function buildMappedCourse(sourceData) {
  const mapped = { ...sourceData };

  // Primary mapped fields
  if (hasOwn(sourceData, "title")) mapped.title = sourceData.title;
  if (hasOwn(sourceData, "subject")) mapped.subject = sourceData.subject;
  if (hasOwn(sourceData, "grade")) mapped.grade = sourceData.grade;
  if (hasOwn(sourceData, "status")) mapped.status = sourceData.status;
  if (hasOwn(sourceData, "createdAt")) mapped.createdAt = sourceData.createdAt;
  if (hasOwn(sourceData, "updatedAt")) mapped.updatedAt = sourceData.updatedAt;

  if (hasOwn(sourceData, "body")) {
    mapped.description = sourceData.body;
  } else if (!hasOwn(sourceData, "description")) {
    mapped.description = "";
  }

  if (hasOwn(sourceData, "instructor")) {
    mapped.instructorName = sourceData.instructor;
  } else if (!hasOwn(sourceData, "instructorName")) {
    mapped.instructorName = null;
  }

  // Defaults for unified courses model
  if (!hasOwn(sourceData, "accessType") || sourceData.accessType == null || sourceData.accessType === "") {
    mapped.accessType = "public";
  }

  const mappedVideoUrl = hasOwn(sourceData, "videoUrl") && sourceData.videoUrl
    ? sourceData.videoUrl
    : null;

  if (!Array.isArray(sourceData.weeks) || sourceData.weeks.length === 0) {
    mapped.weeks = mappedVideoUrl
      ? [{ title: "1강", videoUrl: mappedVideoUrl }]
      : [];
  } else {
    mapped.weeks = sourceData.weeks;
  }

  // Keep legacy compatibility fields explicitly when present
  const legacyFields = ["body", "instructor", "videoUrl", "year", "month", "kind", "schoolYear"];
  for (const field of legacyFields) {
    if (hasOwn(sourceData, field)) {
      mapped[field] = sourceData[field];
    }
  }

  return mapped;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  initFirebase(args.projectId);

  const db = admin.firestore();
  const sourceRef = db.collection(SOURCE_COLLECTION);
  const destRef = db.collection(DEST_COLLECTION);

  console.log("[migration] Starting exam_contents -> courses");
  if (args.projectId) console.log(`[migration] projectId=${args.projectId}`);
  if (args.dryRun) console.log("[migration] DRY RUN mode (no writes)");

  const sourceSnap = await sourceRef.get();
  const total = sourceSnap.size;

  let migrated = 0;
  let skipped = 0;
  let errorCount = 0;
  const errors = [];

  console.log(`[migration] Total documents found: ${total}`);

  for (const docSnap of sourceSnap.docs) {
    const docId = docSnap.id;
    const sourceData = docSnap.data() || {};
    const payload = buildMappedCourse(sourceData);
    const targetDocRef = destRef.doc(docId);

    if (args.dryRun) {
      const exists = (await targetDocRef.get()).exists;
      if (exists) {
        skipped++;
        if (args.verbose) console.log(`[skip] ${docId} (already exists in courses)`);
      } else {
        migrated++;
        if (args.verbose) console.log(`[dry-run migrate] ${docId}`);
      }
      continue;
    }

    try {
      await targetDocRef.create(payload);
      migrated++;
      if (args.verbose) console.log(`[migrated] ${docId}`);
    } catch (err) {
      // Firestore ALREADY_EXISTS
      if (err && (err.code === 6 || err.code === "already-exists")) {
        skipped++;
        if (args.verbose) console.log(`[skip] ${docId} (already exists in courses)`);
      } else {
        errorCount++;
        const msg = err && err.message ? err.message : String(err);
        errors.push({ id: docId, error: msg });
        console.error(`[error] ${docId}: ${msg}`);
      }
    }
  }

  console.log("\n[migration] Done");
  console.log(`[migration] migrated count: ${migrated}`);
  console.log(`[migration] skipped count: ${skipped}`);
  console.log(`[migration] errors: ${errorCount}`);

  if (errors.length > 0) {
    console.log("[migration] Error details:");
    for (const e of errors) {
      console.log(`  - ${e.id}: ${e.error}`);
    }
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("[migration] Fatal error:", err);
  process.exit(1);
});

