#!/usr/bin/env node
"use strict";

/*
 * Remove legacy instructor profile fields that are no longer written or read by the app.
 *
 * Dry-run by default:
 *   node scripts/cleanup-instructor-legacy-fields.js
 *
 * Apply updates explicitly:
 *   node scripts/cleanup-instructor-legacy-fields.js --write
 *   node scripts/cleanup-instructor-legacy-fields.js --project <projectId> --write
 */

const path = require("path");
const { createRequire } = require("module");

const fs = require("fs");

const LEGACY_TOP_LEVEL_FIELDS = [
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
  "imageUrl",
  "profileImageUrl",
  "avatar",
  "photoURL",
  "profileImage",
  "status",
  "sortOrder"
];

const COMPAT_MIRROR_FIELDS = ["profilePhoto", "youtube_url", "video"];

const LEGACY_VIDEO_ITEM_FIELDS = ["youtube_url"];

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
Remove legacy fields from instructors/* documents.

Usage:
  node scripts/cleanup-instructor-legacy-fields.js [options]

Options:
  --dry-run          Preview changes only. This is the default.
  --write            Apply field deletions and imageUrl migration.
  --project <id>     Firebase project id for Admin SDK initialization.
  --limit <number>   Limit processed document count.
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
      console.error("[cleanup-instructors] firebase-admin is not installed in root or functions dependencies.");
      process.exit(1);
    }
  }
}

function initializeAdmin(admin, projectId) {
  if (admin.apps.length > 0) return;

  const serviceAccountCandidates = [
    process.env.FIREBASE_SERVICE_ACCOUNT,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.resolve(__dirname, "../../service-account/gritedu-lms-adminsdk.json"),
    path.resolve(__dirname, "../serviceAccountKey.json")
  ].filter(Boolean);

  const options = {};
  if (projectId) {
    options.projectId = projectId;
  }

  const serviceAccountPath = serviceAccountCandidates.find((candidate) => fs.existsSync(candidate));
  if (serviceAccountPath) {
    options.credential = admin.credential.cert(require(serviceAccountPath));
  } else {
    options.credential = admin.credential.applicationDefault();
  }

  admin.initializeApp(options);
}

function hasOwn(data, field) {
  return Object.prototype.hasOwnProperty.call(data, field);
}

function stringValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sanitizeVideos(videos) {
  if (!Array.isArray(videos)) return { changed: false, value: videos };

  let changed = false;
  const next = videos.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }

    const cleaned = { ...item };
    let itemChanged = false;
    for (const field of LEGACY_VIDEO_ITEM_FIELDS) {
      if (hasOwn(cleaned, field)) {
        delete cleaned[field];
        itemChanged = true;
      }
    }

    if (itemChanged) {
      changed = true;
      return cleaned;
    }
    return item;
  });

  return { changed, value: next };
}

function buildCleanupPlan(docSnap, FieldValue) {
  const data = docSnap.data() || {};
  const update = {};
  const unset = {};
  const notes = [];

  for (const field of LEGACY_TOP_LEVEL_FIELDS) {
    if (!hasOwn(data, field)) continue;

    if (field === "imageUrl" && !stringValue(data.photo) && !stringValue(data.profilePhoto) && stringValue(data.imageUrl)) {
      update.photo = data.imageUrl.trim();
      notes.push("migrate imageUrl -> photo");
    }

    unset[field] = FieldValue.delete();
    notes.push(`delete ${field}`);
  }

  const videoResult = sanitizeVideos(data.videos);
  if (videoResult.changed) {
    update.videos = videoResult.value;
    notes.push("strip videos[].youtube_url");
  }

  for (const field of COMPAT_MIRROR_FIELDS) {
    if (!hasOwn(data, field)) continue;

    if (field === "profilePhoto" && !stringValue(data.photo) && stringValue(data.profilePhoto)) {
      update.photo = data.profilePhoto.trim();
      notes.push("migrate profilePhoto -> photo");
    }

    unset[field] = FieldValue.delete();
    notes.push(`delete ${field}`);
  }

  if (!Object.keys(unset).length && !Object.keys(update).length) {
    return null;
  }

  return {
    id: docSnap.id,
    notes,
    payload: { ...update, ...unset }
  };
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
  const FieldValue = admin.firestore.FieldValue;
  const snapshot = await db.collection("instructors").get();

  const plans = [];
  snapshot.forEach((docSnap) => {
    const plan = buildCleanupPlan(docSnap, FieldValue);
    if (plan) plans.push(plan);
  });

  const selected = args.limit > 0 ? plans.slice(0, args.limit) : plans;

  console.log("[cleanup-instructors] instructors scanned:", snapshot.size);
  console.log("[cleanup-instructors] documents needing cleanup:", plans.length);
  console.log(args.dryRun ? "[cleanup-instructors] DRY RUN mode, no writes." : "[cleanup-instructors] WRITE mode.");

  if (selected.length === 0) {
    console.log("[cleanup-instructors] nothing to do.");
    return;
  }

  selected.slice(0, 30).forEach((plan) => {
    console.log(`- instructors/${plan.id}: ${plan.notes.join(", ")}`);
  });
  if (selected.length > 30) {
    console.log(`...and ${selected.length - 30} more`);
  }

  if (args.dryRun) return;

  const BATCH_LIMIT = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const plan of selected) {
    batch.update(db.collection("instructors").doc(plan.id), plan.payload);
    batchCount += 1;

    if (batchCount >= BATCH_LIMIT) {
      await commitBatch(batch, false);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await commitBatch(batch, false);
  }

  console.log(`[cleanup-instructors] updated ${selected.length} document(s).`);
}

main().catch((error) => {
  console.error("[cleanup-instructors] failed.");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
