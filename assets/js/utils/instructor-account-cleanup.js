import { db } from "/assets/js/firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

const BATCH_LIMIT = 450;
const QUERY_CHUNK_SIZE = 10;

function normalizeKey(value) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function addValue(set, value) {
  const normalized = normalizeKey(value);
  if (normalized) set.add(normalized);
}

function chunk(values, size = QUERY_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function addInstructorData(identity, data = {}, profileDocId = "") {
  addValue(identity.keySet, data.uid);
  addValue(identity.keySet, data.instructorId);
  addValue(identity.keySet, profileDocId);
  addValue(identity.nameSet, data.name);
  addValue(identity.nameSet, data.instructorName);
  addValue(identity.profileDocIdCandidates, profileDocId);
  addValue(identity.profileDocIdCandidates, data.instructorId);
  addValue(identity.profileDocIds, profileDocId);
}

function collectProfile(profileMap, snapDoc) {
  if (!snapDoc?.exists?.()) return;
  if (!profileMap.has(snapDoc.id)) {
    profileMap.set(snapDoc.id, snapDoc.data() || {});
  }
}

async function getDocsByAnyValue(collectionName, fieldName, values) {
  const normalizedValues = [...new Set(values.map(normalizeKey).filter(Boolean))];
  if (!normalizedValues.length) return [];

  const docs = [];
  for (const valueChunk of chunk(normalizedValues)) {
    const constraint = valueChunk.length === 1
      ? where(fieldName, "==", valueChunk[0])
      : where(fieldName, "in", valueChunk);
    const snap = await getDocs(query(collection(db, collectionName), constraint));
    docs.push(...snap.docs);
  }
  return docs;
}

async function getDocsByArrayContainsAny(collectionName, fieldName, values) {
  const normalizedValues = [...new Set(values.map(normalizeKey).filter(Boolean))];
  if (!normalizedValues.length) return [];

  const docs = [];
  for (const valueChunk of chunk(normalizedValues)) {
    const snap = await getDocs(
      query(collection(db, collectionName), where(fieldName, "array-contains-any", valueChunk))
    );
    docs.push(...snap.docs);
  }
  return docs;
}

function collectDoc(docMap, collectionName, snapDoc, matchReason = "") {
  const key = `${collectionName}/${snapDoc.id}`;
  if (!docMap.has(key)) {
    docMap.set(key, {
      id: snapDoc.id,
      ref: snapDoc.ref,
      data: snapDoc.data() || {},
      matchReasons: new Set()
    });
  }
  if (matchReason) docMap.get(key).matchReasons.add(matchReason);
}

async function collectAssignmentDocs(collectionName, keySet, { includeInstructorUids = false } = {}) {
  const keys = [...keySet];
  const docMap = new Map();

  const [uidDocs, idDocs, uidsDocs] = await Promise.all([
    getDocsByAnyValue(collectionName, "instructorUid", keys),
    getDocsByAnyValue(collectionName, "instructorId", keys),
    includeInstructorUids ? getDocsByArrayContainsAny(collectionName, "instructorUids", keys) : Promise.resolve([])
  ]);

  uidDocs.forEach((snapDoc) => collectDoc(docMap, collectionName, snapDoc, "instructorUid"));
  idDocs.forEach((snapDoc) => collectDoc(docMap, collectionName, snapDoc, "instructorId"));
  uidsDocs.forEach((snapDoc) => collectDoc(docMap, collectionName, snapDoc, "instructorUids"));

  return [...docMap.values()];
}

async function collectNameOnlyDocs(collectionName, names, exactDocs) {
  const exactIds = new Set(exactDocs.map((item) => item.id));
  const docs = await getDocsByAnyValue(collectionName, "instructorName", [...names]);
  const docMap = new Map();

  docs.forEach((snapDoc) => {
    if (exactIds.has(snapDoc.id)) return;
    collectDoc(docMap, collectionName, snapDoc, "instructorName");
  });

  return [...docMap.values()];
}

function removeMatchingKeys(values, keySet) {
  if (!Array.isArray(values)) return values;
  return values.filter((value) => !keySet.has(normalizeKey(value)));
}

function createUnassignmentOperations(preview, keySet) {
  const operations = [];

  (preview.assignments?.courses || []).forEach((item) => {
    const payload = {
      instructorUid: null,
      instructorId: null,
      instructorName: null
    };
    if (Array.isArray(item.data?.instructorUids)) {
      payload.instructorUids = removeMatchingKeys(item.data.instructorUids, keySet);
    }
    operations.push({ type: "update", ref: item.ref, payload });
  });

  (preview.assignments?.offlineClasses || []).forEach((item) => {
    const payload = {
      instructorUid: "",
      instructorId: "",
      instructorName: ""
    };
    if (Array.isArray(item.data?.instructorUids)) {
      payload.instructorUids = removeMatchingKeys(item.data.instructorUids, keySet);
    }
    operations.push({ type: "update", ref: item.ref, payload });
  });

  (preview.assignments?.publicTimetableEntries || []).forEach((item) => {
    operations.push({
      type: "update",
      ref: item.ref,
      payload: {
        instructorUid: "",
        instructorId: "",
        instructorName: ""
      }
    });
  });

  return operations;
}

function buildUnlinkPlan({ uid, canonicalInstructorId, existingProfileDocIds }) {
  const normalizedUid = normalizeKey(uid);
  const normalizedCanonicalId = normalizeKey(canonicalInstructorId);
  const profileDocIds = [...new Set(existingProfileDocIds.map(normalizeKey).filter(Boolean))];
  const preserveProfileDocId = normalizedCanonicalId && profileDocIds.includes(normalizedCanonicalId)
    ? normalizedCanonicalId
    : (!normalizedCanonicalId && profileDocIds.length === 1 ? profileDocIds[0] : "");
  const uidDuplicateProfileDocIds = profileDocIds.filter((profileDocId) => (
    profileDocId === normalizedUid && profileDocId !== preserveProfileDocId
  ));
  const ambiguousProfileDocIds = profileDocIds.filter((profileDocId) => (
    profileDocId !== preserveProfileDocId && !uidDuplicateProfileDocIds.includes(profileDocId)
  ));
  let error = "";

  if (!preserveProfileDocId) {
    error = normalizedCanonicalId
      ? `보존할 강사 프로필 instructors/${normalizedCanonicalId} 문서를 찾을 수 없습니다.`
      : "보존할 canonical 강사 프로필을 확정할 수 없습니다.";
  } else if (ambiguousProfileDocIds.length > 0) {
    error = `삭제 여부가 불명확한 강사 프로필 문서가 있습니다: ${ambiguousProfileDocIds.join(", ")}`;
  }

  return {
    canUnlink: !error,
    error,
    canonicalInstructorId: normalizedCanonicalId || preserveProfileDocId,
    preserveProfileDocId,
    deleteProfileDocIds: uidDuplicateProfileDocIds,
    ambiguousProfileDocIds
  };
}

async function commitOperations(operations) {
  let batch = writeBatch(db);
  let pending = 0;

  for (const operation of operations) {
    if (operation.type === "update") {
      batch.update(operation.ref, operation.payload);
    } else if (operation.type === "delete") {
      batch.delete(operation.ref);
    }
    pending += 1;

    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }
}

async function getExistingInstructorProfileDocIds(values) {
  const normalizedValues = [...new Set(values.map(normalizeKey).filter(Boolean))];
  const existingIds = [];

  for (const profileDocId of normalizedValues) {
    const snap = await getDoc(doc(db, "instructors", profileDocId));
    if (snap.exists()) existingIds.push(profileDocId);
  }

  return existingIds;
}

export async function buildInstructorAccountCleanupPreview(uid) {
  const normalizedUid = normalizeKey(uid);
  if (!normalizedUid) {
    throw new Error("강사 UID가 없습니다.");
  }

  const identity = {
    uid: normalizedUid,
    keySet: new Set([normalizedUid]),
    profileDocIds: new Set(),
    profileDocIdCandidates: new Set([normalizedUid]),
    nameSet: new Set(),
    accountDocExists: false,
    canonicalInstructorId: ""
  };
  const profileMap = new Map();

  const [accountSnap, profileByUidSnap, profilesByUidSnap] = await Promise.all([
    getDoc(doc(db, "instructorAccounts", normalizedUid)),
    getDoc(doc(db, "instructors", normalizedUid)),
    getDocs(query(collection(db, "instructors"), where("uid", "==", normalizedUid)))
  ]);

  if (accountSnap.exists()) {
    identity.accountDocExists = true;
    const accountData = accountSnap.data() || {};
    identity.canonicalInstructorId = normalizeKey(accountData.instructorId);
    addInstructorData(identity, accountData);
  }

  if (profileByUidSnap.exists()) {
    collectProfile(profileMap, profileByUidSnap);
    addInstructorData(identity, profileByUidSnap.data(), profileByUidSnap.id);
  }

  profilesByUidSnap.docs.forEach((snapDoc) => {
    collectProfile(profileMap, snapDoc);
    addInstructorData(identity, snapDoc.data(), snapDoc.id);
  });

  if (!identity.canonicalInstructorId && profileMap.size === 1) {
    const [profileDocId, profileData] = [...profileMap.entries()][0];
    identity.canonicalInstructorId = normalizeKey(profileData.instructorId) || profileDocId;
  }

  const existingProfileDocIds = await getExistingInstructorProfileDocIds([...identity.profileDocIdCandidates]);
  existingProfileDocIds.forEach((profileDocId) => addValue(identity.profileDocIds, profileDocId));
  const unlink = buildUnlinkPlan({
    uid: normalizedUid,
    canonicalInstructorId: identity.canonicalInstructorId,
    existingProfileDocIds
  });

  const [courseDocs, offlineClassDocs, timetableDocs] = await Promise.all([
    collectAssignmentDocs("courses", identity.keySet, { includeInstructorUids: true }),
    collectAssignmentDocs("offlineClasses", identity.keySet, { includeInstructorUids: true }),
    collectAssignmentDocs("publicTimetableEntries", identity.keySet)
  ]);

  const [courseNameOnlyDocs, offlineClassNameOnlyDocs, timetableNameOnlyDocs] = await Promise.all([
    collectNameOnlyDocs("courses", identity.nameSet, courseDocs),
    collectNameOnlyDocs("offlineClasses", identity.nameSet, offlineClassDocs),
    collectNameOnlyDocs("publicTimetableEntries", identity.nameSet, timetableDocs)
  ]);

  return {
    uid: normalizedUid,
    keys: [...identity.keySet],
    profileDocIds: [...identity.profileDocIds],
    canonicalInstructorId: identity.canonicalInstructorId,
    unlink,
    names: [...identity.nameSet],
    accountDocExists: identity.accountDocExists,
    assignments: {
      courses: courseDocs,
      offlineClasses: offlineClassDocs,
      publicTimetableEntries: timetableDocs
    },
    nameOnlyMatches: {
      courses: courseNameOnlyDocs,
      offlineClasses: offlineClassNameOnlyDocs,
      publicTimetableEntries: timetableNameOnlyDocs
    },
    counts: {
      courses: courseDocs.length,
      offlineClasses: offlineClassDocs.length,
      publicTimetableEntries: timetableDocs.length,
      nameOnlyCourses: courseNameOnlyDocs.length,
      nameOnlyOfflineClasses: offlineClassNameOnlyDocs.length,
      nameOnlyPublicTimetableEntries: timetableNameOnlyDocs.length
    }
  };
}

export async function executeInstructorAccountCleanup(preview) {
  const uid = normalizeKey(preview?.uid);
  if (!uid) {
    throw new Error("강사 UID가 없습니다.");
  }

  const keySet = new Set((preview.keys || []).map(normalizeKey).filter(Boolean));
  keySet.add(uid);

  const operations = createUnassignmentOperations(preview, keySet);

  operations.push({ type: "delete", ref: doc(db, "instructorAccounts", uid) });

  const profileDocIds = [...new Set((preview.profileDocIds || []).map(normalizeKey).filter(Boolean))];
  profileDocIds.forEach((profileDocId) => {
    operations.push({ type: "delete", ref: doc(db, "instructors", profileDocId) });
  });

  await commitOperations(operations);

  return {
    updatedCourses: preview.assignments?.courses?.length || 0,
    updatedOfflineClasses: preview.assignments?.offlineClasses?.length || 0,
    updatedPublicTimetableEntries: preview.assignments?.publicTimetableEntries?.length || 0,
    deletedInstructorAccounts: 1,
    deletedInstructorProfiles: profileDocIds.length,
    removedUsersInstructorField: 0
  };
}

export async function executeInstructorAccountUnlink(preview) {
  const uid = normalizeKey(preview?.uid);
  if (!uid) {
    throw new Error("강사 UID가 없습니다.");
  }

  const unlink = preview?.unlink || {};
  const preserveProfileDocId = normalizeKey(unlink.preserveProfileDocId);
  if (!unlink.canUnlink || !preserveProfileDocId) {
    throw new Error(unlink.error || "강사 계정 연동 해제 대상을 확정할 수 없습니다.");
  }

  const keySet = new Set((preview.keys || []).map(normalizeKey).filter(Boolean));
  keySet.add(uid);

  const operations = createUnassignmentOperations(preview, keySet);
  operations.push({ type: "delete", ref: doc(db, "instructorAccounts", uid) });
  operations.push({
    type: "update",
    ref: doc(db, "instructors", preserveProfileDocId),
    payload: {
      uid: null,
      pending: true,
      email: "",
      emailLower: "",
      updatedAt: serverTimestamp()
    }
  });

  const duplicateProfileDocIds = [...new Set((unlink.deleteProfileDocIds || []).map(normalizeKey).filter(Boolean))]
    .filter((profileDocId) => profileDocId !== preserveProfileDocId);
  duplicateProfileDocIds.forEach((profileDocId) => {
    operations.push({ type: "delete", ref: doc(db, "instructors", profileDocId) });
  });

  await commitOperations(operations);

  return {
    updatedCourses: preview.assignments?.courses?.length || 0,
    updatedOfflineClasses: preview.assignments?.offlineClasses?.length || 0,
    updatedPublicTimetableEntries: preview.assignments?.publicTimetableEntries?.length || 0,
    deletedInstructorAccounts: 1,
    preservedInstructorProfile: preserveProfileDocId,
    deletedInstructorProfiles: duplicateProfileDocIds.length
  };
}
