#!/usr/bin/env node
"use strict";

/*
 * Remove unused legacy fields from settings/timetableCatalog and prune orphan groupCatalogs keys.
 *
 * Dry-run by default:
 *   node scripts/cleanup-timetable-catalog-legacy.js
 *
 * Apply updates explicitly:
 *   node scripts/cleanup-timetable-catalog-legacy.js --write
 *   node scripts/cleanup-timetable-catalog-legacy.js --project gritedu-lms --write
 */

const path = require("path");
const { createRequire } = require("module");

const LEGACY_TOP_LEVEL_FIELDS = ["subjectMeta", "subjectColorMap", "version"];

function parseArgs(argv) {
  const args = { dryRun: true, projectId: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") args.dryRun = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--project") {
      args.projectId = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Remove legacy fields from settings/timetableCatalog.

Usage:
  node scripts/cleanup-timetable-catalog-legacy.js [options]

Options:
  --write           Apply Firestore updates
  --dry-run         Preview only (default)
  --project <id>    Firebase project id (default: gritedu-lms or GOOGLE_CLOUD_PROJECT)
  --help            Show this help
`);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function buildCleanupPlan(data, FieldValue) {
  const unset = {};
  const notes = [];

  for (const field of LEGACY_TOP_LEVEL_FIELDS) {
    if (!hasOwn(data, field)) continue;
    unset[field] = FieldValue.delete();
    notes.push(`delete ${field}`);
  }

  const scheduleGroups = Array.isArray(data.scheduleGroups) ? data.scheduleGroups : [];
  const activeIds = new Set(
    scheduleGroups.map((group) => String(group?.id || "").trim()).filter(Boolean)
  );
  activeIds.add("regular");

  const groupCatalogs =
    data.groupCatalogs && typeof data.groupCatalogs === "object" && !Array.isArray(data.groupCatalogs)
      ? data.groupCatalogs
      : {};
  const prunedGroupCatalogs = {};
  Object.entries(groupCatalogs).forEach(([id, entry]) => {
    if (activeIds.has(id)) prunedGroupCatalogs[id] = entry;
    else notes.push(`prune groupCatalogs.${id}`);
  });

  if (JSON.stringify(prunedGroupCatalogs) !== JSON.stringify(groupCatalogs)) {
    unset.groupCatalogs = prunedGroupCatalogs;
  }

  if (!Object.keys(unset).length) return null;
  return { notes, payload: unset };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const requireFromFunctions = createRequire(path.join(process.cwd(), "functions", "package.json"));
  const admin = requireFromFunctions("firebase-admin");
  const { FieldValue } = admin.firestore;

  if (!admin.apps.length) {
    const projectId =
      args.projectId ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "gritedu-lms";
    admin.initializeApp({ projectId });
  }

  const ref = admin.firestore().doc("settings/timetableCatalog");
  const snap = await ref.get();
  if (!snap.exists) {
    console.log("settings/timetableCatalog does not exist. Nothing to clean.");
    return;
  }

  const plan = buildCleanupPlan(snap.data() || {}, FieldValue);
  if (!plan) {
    console.log("No legacy timetableCatalog fields to clean.");
    return;
  }

  console.log(`${args.dryRun ? "[dry-run] " : ""}settings/timetableCatalog cleanup:`);
  plan.notes.forEach((note) => console.log(`  - ${note}`));

  if (args.dryRun) {
    console.log("\nDry-run only. Re-run with --write to apply.");
    return;
  }

  await ref.update(plan.payload);
  console.log("\nCleanup applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
