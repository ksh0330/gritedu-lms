#!/usr/bin/env node
"use strict";
// Owner-run one-time backfill: members.linkedStudentUids from active studentParentLinks.
// Dry-run by default. Writes only that field, recomputed inside a per-member transaction.
// Output contains counts only (no UIDs, names or contact data).
const path = require("node:path");
const { createRequire } = require("node:module");
const ROOT = path.resolve(__dirname, "..");
const PAGE_SIZE = 200;
const MAX_RULES_CHILDREN = 5;

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

function activeChildUids(links) {
  const uids = [];
  links.forEach((link) => {
    const uid = String(link?.studentUid || "").trim();
    if (link?.status === "active" && uid && !uids.includes(uid)) uids.push(uid);
  });
  return uids;
}

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// links: [{id, data}] active link documents in document-id order; members: Map memberUid -> data|null.
function buildParentChildPlan(links, members) {
  const byMember = new Map();
  links.forEach(({ data }) => {
    const memberUid = String(data?.memberUid || "").trim();
    if (!memberUid) return;
    if (!byMember.has(memberUid)) byMember.set(memberUid, []);
    byMember.get(memberUid).push(data);
  });
  const totals = { activeLinks: links.length, parents: byMember.size, toUpdate: 0, alreadyCurrent: 0,
    blockedMissingMember: 0, blockedNotActiveParent: 0, countMismatch: 0, overRulesLimit: 0 };
  const targets = [];
  byMember.forEach((memberLinks, memberUid) => {
    const member = members.get(memberUid);
    if (!member) { totals.blockedMissingMember += 1; return; }
    if (member.memberPurpose !== "parent" || member.status !== "active") { totals.blockedNotActiveParent += 1; return; }
    const uids = activeChildUids(memberLinks);
    if (Number(member.linkedChildrenCount) !== uids.length) totals.countMismatch += 1;
    if (uids.length > MAX_RULES_CHILDREN) totals.overRulesLimit += 1;
    if (sameList(member.linkedStudentUids, uids)) { totals.alreadyCurrent += 1; return; }
    totals.toUpdate += 1;
    targets.push(memberUid);
  });
  return { totals, targets };
}

async function scanActiveLinks(db, documentIdField) {
  const rows = [];
  let last = null;
  for (;;) {
    let q = db.collection("studentParentLinks").where("status", "==", "active").orderBy(documentIdField).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    snap.docs.forEach((d) => rows.push({ id: d.id, data: d.data() || {} }));
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function loadMembers(db, memberUids) {
  const members = new Map();
  const ids = [...memberUids];
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((uid) => db.collection("members").doc(uid));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => members.set(snap.id, snap.exists ? (snap.data() || {}) : null));
  }
  return members;
}

async function buildPlan(db, documentIdField) {
  const links = await scanActiveLinks(db, documentIdField);
  const memberUids = new Set(links.map(({ data }) => String(data.memberUid || "").trim()).filter(Boolean));
  return buildParentChildPlan(links, await loadMembers(db, memberUids));
}

// Recomputes from the member's own links inside the transaction; never trusts the scan.
async function backfillMember(db, memberUid, documentIdField) {
  const memberRef = db.collection("members").doc(memberUid);
  return db.runTransaction(async (transaction) => {
    const [memberSnap, linksSnap] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(db.collection("studentParentLinks").where("memberUid", "==", memberUid).orderBy(documentIdField)),
    ]);
    if (!memberSnap.exists) return "skipped";
    const member = memberSnap.data() || {};
    if (member.memberPurpose !== "parent" || member.status !== "active") return "skipped";
    const uids = activeChildUids(linksSnap.docs.map((d) => d.data() || {}));
    if (sameList(member.linkedStudentUids, uids)) return "skipped";
    transaction.update(memberRef, { linkedStudentUids: uids });
    return "updated";
  });
}

function printTotals(t) {
  console.log("  active links scanned: " + t.activeLinks);
  console.log("  parents with active links: " + t.parents);
  console.log("  parents to update: " + t.toUpdate);
  console.log("  already current: " + t.alreadyCurrent);
  console.log("  blocked (member missing): " + t.blockedMissingMember);
  console.log("  blocked (not an active parent member): " + t.blockedNotActiveParent);
  console.log("  linkedChildrenCount differs from active links (report only, not repaired): " + t.countMismatch);
  console.log("  parents with more than " + MAX_RULES_CHILDREN + " children (class reads limited by Rules): " + t.overRulesLimit);
}

function loadFirebaseAdmin() {
  try { return require("firebase-admin"); }
  catch { return createRequire(path.resolve(ROOT, "functions/package.json"))("firebase-admin"); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) fail("An explicit --project is required.");
  if (!args.dryRun && args.confirmCount == null) fail("Write requires --confirm-count from the dry-run.");
  const admin = loadFirebaseAdmin();
  admin.initializeApp({ projectId: args.projectId, credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const documentIdField = admin.firestore.FieldPath.documentId();
  const plan = await buildPlan(db, documentIdField);
  if (args.dryRun) {
    console.log("[backfill-parent-linked-students] DRY RUN, no database writes.");
    printTotals(plan.totals);
    console.log("  confirmed write target count: " + plan.targets.length);
    return;
  }
  if (plan.targets.length !== args.confirmCount) fail("Target count changed since the dry-run. Re-run the dry-run.");
  console.log("[backfill-parent-linked-students] WRITE mode.");
  let updated = 0;
  let skipped = 0;
  for (const memberUid of plan.targets) {
    if ((await backfillMember(db, memberUid, documentIdField)) === "updated") updated += 1; else skipped += 1;
  }
  console.log("  updated: " + updated + "; skipped (already current or no longer eligible): " + skipped);
  console.log("  Complete. Deploy the Firestore Rules change only after this and the Function/static deploys.");
}

if (require.main === module) main().catch((error) => {
  console.error("[backfill-parent-linked-students] failed:", error.safeMessage || "operation failed (code: " + (error.code || "unknown") + "); check ADC and permissions");
  process.exitCode = 1;
});

module.exports = { parseArgs, activeChildUids, buildParentChildPlan, backfillMember, MAX_RULES_CHILDREN };
