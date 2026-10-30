#!/usr/bin/env node
"use strict";

/*
 * Consolidate subject colors into settings/subjectColors and remove the old
 * subject-color fields from the page-specific settings documents.
 *
 * Dry-run by default:
 *   node scripts/migrate-subject-colors.js
 *
 * Apply updates explicitly:
 *   node scripts/migrate-subject-colors.js --write
 *   node scripts/migrate-subject-colors.js --project gritedu-lms --write
 */

const path = require("path");
const { createRequire } = require("module");

const requireFromWorkspace = createRequire(path.join(process.cwd(), "package.json"));

const SETTINGS_IDS = Object.freeze([
  "subjectColors",
  "instructorsMenu",
  "courseCatalog",
  "offlineClassCatalog",
  "timetableCatalog",
]);

const DEFAULT_COLORS = Object.freeze({
  "국어": "#e95045",
  "영어": "#2f7ae5",
  "수학": "#34a853",
  "과학": "#f6c445",
  "수리논술": "#0e7490",
  "약술형논술": "#6610f2",
  "컨설팅": "#8e44ad",
});

const BOOTSTRAP_PALETTE = Object.freeze([
  "#d63384",
  "#6610f2",
  "#20c997",
  "#0dcaf0",
  "#dc3545",
  "#0d6efd",
  "#198754",
  "#6f42c1",
  "#6c757d",
  "#ffc107",
  "#212529",
]);

const RESERVED_SUBJECTS = new Set([
  "전체",
  "all",
  "선택",
  "직접 입력",
  "목록에 없음",
  "__custom__",
]);

const RESERVED_BRAND_COLORS = new Set(["#fd7e14", "#f68b1f", "#ff7a00"]);

const SUBJECT_ALIASES = Object.freeze({
  "논술": "수리논술",
});

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
Consolidate settings subject colors and remove legacy fields.

Usage:
  node scripts/migrate-subject-colors.js [options]

Options:
  --write           Apply Firestore updates
  --dry-run         Preview only (default)
  --project <id>    Firebase project id (default: gritedu-lms or GOOGLE_CLOUD_PROJECT)
  --help            Show this help
`);
}

function normalizeHexColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return "";
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return color;
}

function normalizeColorMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([rawSubject, rawColor]) => {
    const subject = String(rawSubject || "").trim();
    const colorSource = rawColor && typeof rawColor === "object"
      ? rawColor.color || rawColor.background || rawColor.hex
      : rawColor;
    const color = normalizeHexColor(colorSource);
    if (subject && color && !RESERVED_BRAND_COLORS.has(color)) result[subject] = color;
  });
  return result;
}

function addSubject(target, value) {
  const subject = String(value || "").trim();
  if (!subject || RESERVED_SUBJECTS.has(subject) || RESERVED_SUBJECTS.has(subject.toLowerCase())) return;
  target.add(subject);
}

function addSubjectList(target, values) {
  (Array.isArray(values) ? values : []).forEach((value) => {
    addSubject(target, value && typeof value === "object" ? value.label || value.value : value);
  });
}

function addOfflineSubjects(target, catalog = {}) {
  addSubjectList(target, catalog.subjects);
  const groups = catalog.groupCatalogs && typeof catalog.groupCatalogs === "object"
    ? catalog.groupCatalogs
    : {};
  Object.values(groups).forEach((group) => addSubjectList(target, group?.subjects));
  Object.entries(catalog).forEach(([key, group]) => {
    if (key.startsWith("groupCatalogs.")) addSubjectList(target, group?.subjects);
  });
}

function collectSubjects(settings) {
  const subjects = new Set();
  const instructorsMenu = settings.instructorsMenu || {};
  const courseCatalog = settings.courseCatalog || {};

  addSubjectList(subjects, instructorsMenu.subjects || instructorsMenu.subjectOptions);
  const courseSubjectGroup = (Array.isArray(courseCatalog.chipGroups) ? courseCatalog.chipGroups : [])
    .find((group) => group?.key === "subject");
  addSubjectList(subjects, courseSubjectGroup?.options);
  addOfflineSubjects(subjects, settings.offlineClassCatalog || {});
  addOfflineSubjects(subjects, settings.timetableCatalog || {});
  return Array.from(subjects);
}

function numberToHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function hslToHex(hue, saturation = 62, lightness = 46) {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb = [0, 0, 0];

  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return `#${rgb.map((channel) => numberToHex((channel + m) * 255)).join("")}`;
}

function ensureColors(subjects, storedMap) {
  const result = { ...DEFAULT_COLORS, ...normalizeColorMap(storedMap) };
  Object.entries(SUBJECT_ALIASES).forEach(([alias, canonical]) => {
    if (result[canonical]) result[alias] = result[canonical];
  });
  const used = new Set(Object.values(result).map((color) => color.toLowerCase()));
  let overflowIndex = 0;

  subjects.forEach((subject) => {
    if (result[subject]) return;
    let color = BOOTSTRAP_PALETTE.find((candidate) => !used.has(candidate.toLowerCase()));
    while (!color) {
      const candidate = hslToHex(overflowIndex * 137.508);
      overflowIndex += 1;
      if (!used.has(candidate)) color = candidate;
    }
    result[subject] = color;
    used.add(color.toLowerCase());
  });
  return result;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function getLegacyFields(documentId, data) {
  const fields = [];
  if (hasOwn(data, "subjectColorMap")) fields.push("subjectColorMap");
  if (hasOwn(data, "subjectMeta")) fields.push("subjectMeta");
  if (documentId === "courseCatalog" && hasOwn(data, "instructorSubjectChips")) {
    fields.push("instructorSubjectChips");
  }
  return fields;
}

function getFirebaseCliSession() {
  try {
    const cliAuth = requireFromWorkspace("firebase-tools/lib/auth");
    const account = cliAuth.getGlobalDefaultAccount();
    const refreshToken = account?.tokens?.refresh_token;
    if (!refreshToken) return null;

    return {
      async getAccessToken() {
        const token = await cliAuth.getAccessToken(refreshToken, account.tokens.scopes);
        return token.access_token;
      },
    };
  } catch (_error) {
    return null;
  }
}

function decodeFirestoreValue(value = {}) {
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if (value.mapValue) return decodeFirestoreFields(value.mapValue.fields || {});
  return undefined;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  return { mapValue: { fields: encodeFirestoreFields(value) } };
}

function encodeFirestoreFields(value = {}) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, encodeFirestoreValue(entry)])
  );
}

function getFirestoreRestBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)`;
}

function getFirestoreDocumentRoot(projectId) {
  return `projects/${projectId}/databases/(default)/documents`;
}

async function fetchFirestoreJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST ${response.status}: ${body}`);
  }
  return response.json();
}

async function readSettingsViaRest(projectId, cliSession) {
  const accessToken = await cliSession.getAccessToken();
  const base = getFirestoreRestBase(projectId);
  const documents = await Promise.all(SETTINGS_IDS.map((id) => (
    fetchFirestoreJson(`${base}/documents/settings/${encodeURIComponent(id)}`, accessToken)
  )));
  return Object.fromEntries(documents.map((document, index) => [
    SETTINGS_IDS[index],
    document ? decodeFirestoreFields(document.fields || {}) : {},
  ]));
}

async function writeSettingsViaRest(projectId, cliSession, subjectColorMap, cleanup) {
  const accessToken = await cliSession.getAccessToken();
  const base = getFirestoreRestBase(projectId);
  // Firestore commit write names are resource names, not REST URLs.
  const documentRoot = getFirestoreDocumentRoot(projectId);
  const writes = [{
    update: {
      name: `${documentRoot}/settings/subjectColors`,
      fields: {
        subjectColorMap: encodeFirestoreValue(subjectColorMap),
        version: encodeFirestoreValue(1),
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    },
    updateMask: { fieldPaths: ["subjectColorMap", "version", "updatedAt"] },
  }];

  cleanup.forEach(({ id, fields }) => {
    writes.push({
      update: {
        name: `${documentRoot}/settings/${id}`,
        fields: {},
      },
      updateMask: { fieldPaths: fields },
      currentDocument: { exists: true },
    });
  });

  await fetchFirestoreJson(`${base}/documents:commit`, accessToken, {
    method: "POST",
    body: JSON.stringify({ writes }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const projectId = args.projectId
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || "gritedu-lms";
  const cliSession = getFirebaseCliSession();
  let admin = null;
  let db = null;
  let settings = {};

  if (cliSession) {
    settings = await readSettingsViaRest(projectId, cliSession);
  } else {
    const requireFromFunctions = createRequire(path.join(process.cwd(), "functions", "package.json"));
    admin = requireFromFunctions("firebase-admin");
    if (!admin.apps.length) admin.initializeApp({ projectId });
    db = admin.firestore();
    const snapshots = await Promise.all(SETTINGS_IDS.map((id) => db.doc(`settings/${id}`).get()));
    settings = Object.fromEntries(
      snapshots.map((snapshot, index) => [SETTINGS_IDS[index], snapshot.exists ? snapshot.data() || {} : {}])
    );
  }

  const subjects = collectSubjects(settings);
  const storedColors = {
    ...normalizeColorMap(settings.instructorsMenu.subjectColorMap),
    ...normalizeColorMap(settings.courseCatalog.subjectColorMap),
    ...normalizeColorMap(settings.offlineClassCatalog.subjectColorMap),
    ...normalizeColorMap(settings.timetableCatalog.subjectColorMap),
    ...normalizeColorMap(settings.subjectColors.subjectColorMap),
  };
  const subjectColorMap = ensureColors(subjects, storedColors);
  const cleanup = SETTINGS_IDS
    .filter((id) => id !== "subjectColors")
    .map((id) => ({ id, fields: getLegacyFields(id, settings[id]) }))
    .filter((entry) => entry.fields.length);

  console.log(`${args.dryRun ? "[dry-run] " : ""}settings/subjectColors migration:`);
  console.log(`  - managed subjects: ${subjects.length}`);
  console.log(`  - stored colors after merge: ${Object.keys(subjectColorMap).length}`);
  subjects.forEach((subject) => console.log(`  - ${subject}: ${subjectColorMap[subject]}`));
  cleanup.forEach(({ id, fields }) => console.log(`  - clean settings/${id}: ${fields.join(", ")}`));

  if (args.dryRun) {
    console.log("\nDry-run only. Re-run with --write to apply.");
    return;
  }

  if (cliSession) {
    await writeSettingsViaRest(projectId, cliSession, subjectColorMap, cleanup);
  } else {
    const { FieldValue } = admin.firestore;
    const batch = db.batch();
    batch.set(db.doc("settings/subjectColors"), {
      subjectColorMap,
      version: 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    cleanup.forEach(({ id, fields }) => {
      const payload = Object.fromEntries(fields.map((field) => [field, FieldValue.delete()]));
      batch.set(db.doc(`settings/${id}`), payload, { merge: true });
    });
    await batch.commit();
  }
  console.log("\nMigration and cleanup applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
