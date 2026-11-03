const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DAY_MS,
  RECORD_CLEANUP_COLLECTIONS,
  isEmailVerificationTarget,
  isMemberChildLinkAttemptTarget,
  isSignupAttemptTarget,
  runRecordCleanup,
} = require("../record-cleanup");

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  return new Date(value).getTime();
}

function makeSnapshot(rows, versions, collectionName) {
  const docs = rows.map(([id, data]) => ({
    id,
    data: () => data,
    updateTime: versions.get(`${collectionName}/${id}`),
  }));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach(callback) {
      docs.forEach(callback);
    },
  };
}

class FakeQuery {
  constructor(db, collectionName) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = [];
    this.orderField = null;
    this.queryLimit = null;
  }

  where(field, operator, value) {
    this.filters.push({field, operator, value});
    return this;
  }

  orderBy(field) {
    this.orderField = field;
    return this;
  }

  limit(value) {
    this.queryLimit = value;
    return this;
  }

  doc(id) {
    return {collectionName: this.collectionName, id};
  }

  async get() {
    this.db.reads.push({
      collectionName: this.collectionName,
      filters: this.filters.map((filter) => ({...filter})),
      orderField: this.orderField,
      limit: this.queryLimit,
    });

    if (this.db.failReads.has(this.collectionName)) {
      throw new Error(`read failed: ${this.collectionName}`);
    }

    let rows = [...(this.db.rows.get(this.collectionName) || new Map()).entries()];
    for (const filter of this.filters) {
      if (filter.operator !== "<=") throw new Error("Unsupported fake operator");
      rows = rows.filter(([, data]) =>
        toMillis(data[filter.field]) <= toMillis(filter.value)
      );
    }

    if (this.orderField) {
      rows.sort((left, right) =>
        toMillis(left[1][this.orderField]) - toMillis(right[1][this.orderField])
      );
    }
    if (Number.isFinite(this.queryLimit)) rows = rows.slice(0, this.queryLimit);
    return makeSnapshot(rows, this.db.versions, this.collectionName);
  }
}

class FakeFirestore {
  constructor(initialRows = {}, failReads = []) {
    this.rows = new Map(
      Object.entries(initialRows).map(([collectionName, rows]) => [
        collectionName,
        new Map(Object.entries(rows)),
      ])
    );
    this.failReads = new Set(failReads);
    this.reads = [];
    this.deleteCommits = [];
    this.versions = new Map();
    this.beforeFirstCommit = null;
    this.hasStartedCommit = false;
    this.rows.forEach((rows, collectionName) => {
      rows.forEach((data, id) => {
        this.versions.set(`${collectionName}/${id}`, {version: 1});
      });
    });
  }

  collection(collectionName) {
    return new FakeQuery(this, collectionName);
  }

  batch() {
    const deletes = [];
    return {
      delete(ref, precondition) {
        deletes.push({ref, precondition});
      },
      commit: async () => {
        if (!this.hasStartedCommit) {
          this.hasStartedCommit = true;
          await this.beforeFirstCommit?.();
        }
        deletes.forEach(({ref, precondition}) => {
          const currentVersion = this.versions.get(`${ref.collectionName}/${ref.id}`);
          if (precondition?.lastUpdateTime !== currentVersion) {
            throw new Error(`precondition failed: ${ref.collectionName}/${ref.id}`);
          }
        });
        this.deleteCommits.push(deletes.map(({ref}) => ({...ref})));
        deletes.forEach(({ref}) => {
          this.rows.get(ref.collectionName)?.delete(ref.id);
          this.versions.delete(`${ref.collectionName}/${ref.id}`);
        });
      },
    };
  }

  update(collectionName, id, data) {
    const rows = this.rows.get(collectionName) || new Map();
    rows.set(id, data);
    this.rows.set(collectionName, rows);
    const key = `${collectionName}/${id}`;
    const previous = this.versions.get(key)?.version || 0;
    this.versions.set(key, {version: previous + 1});
  }
}

test("stored cleanupAt is the only automatic deletion source of truth", () => {
  const now = Date.now();
  assert.equal(isEmailVerificationTarget({
    cleanupAt: new Date(now),
    expiresAt: new Date(now + DAY_MS),
  }, now), true);
  assert.equal(isSignupAttemptTarget({
    cleanupAt: new Date(now - 1),
    blockedUntil: new Date(now + DAY_MS),
  }, now), true);
  assert.equal(isMemberChildLinkAttemptTarget({
    cleanupAt: new Date(now - 1),
    result: "linked",
    createdAt: new Date(now),
  }, now), true);
});

test("future cleanupAt and legacy records without cleanupAt are preserved", async () => {
  const now = Date.now();
  assert.equal(isEmailVerificationTarget({
    cleanupAt: new Date(now + 1),
    expiresAt: new Date(now - DAY_MS),
  }, now), false);
  assert.equal(isSignupAttemptTarget({
    timestamp: new Date(now - 31 * DAY_MS),
  }, now), false);
  assert.equal(isMemberChildLinkAttemptTarget({
    result: "failed",
    createdAt: new Date(now - 365 * DAY_MS),
  }, now), false);

  const future = new Date(now + DAY_MS);
  const db = new FakeFirestore({
    emailVerifications: {
      future: {cleanupAt: future, expiresAt: new Date(now - DAY_MS)},
      legacy: {expiresAt: new Date(now - DAY_MS)},
    },
    signupAttempts: {
      future: {cleanupAt: future, timestamp: new Date(now - 31 * DAY_MS)},
      legacy: {timestamp: new Date(now - 31 * DAY_MS)},
    },
    memberChildLinkAttempts: {
      future: {
        cleanupAt: future,
        result: "failed",
        createdAt: new Date(now - 365 * DAY_MS),
      },
      legacy: {result: "linked", createdAt: new Date(now - 365 * DAY_MS)},
    },
  });

  const result = await runRecordCleanup(db);
  assert.equal(result.totalDeleted, 0);
  assert.equal(db.deleteCommits.length, 0);
});

test("the automatic cleanup allowlist contains only transient collections", () => {
  const targets = RECORD_CLEANUP_COLLECTIONS.map((entry) => entry.collectionName);
  assert.deepEqual(targets, [
    "emailVerifications",
    "signupAttempts",
    "memberChildLinkAttempts",
  ]);

  const protectedCollections = [
    "admins",
    "students",
    "members",
    "instructors",
    "courses",
    "enrollments",
    "offlineClasses",
    "offlineClassMembers",
    "offlineClassSessions",
    "offlineSessionAccess",
    "studentParentLinks",
    "pages",
    "settings",
  ];
  protectedCollections.forEach((collectionName) => {
    assert.equal(targets.includes(collectionName), false);
  });

  const indexSource = fs.readFileSync(
    path.join(__dirname, "..", "index.js"),
    "utf8"
  );
  const schedulerSource = indexSource.slice(indexSource.indexOf(
    "exports.scheduledRecordCleanup"
  ));
  assert.doesNotMatch(schedulerSource, /offlineClassSessions|offlineSessionAccess/);
  assert.doesNotMatch(schedulerSource, /runOfflineSessionCleanup/);
});

test("cleanup never reads or deletes outside the allowlist", async () => {
  const due = new Date(Date.now() - DAY_MS);
  const db = new FakeFirestore({
    students: {protected: {cleanupAt: due}},
    studentParentLinks: {protected: {cleanupAt: due}},
  });

  await runRecordCleanup(db);
  assert.deepEqual(
    db.reads.map((read) => read.collectionName),
    ["emailVerifications", "signupAttempts", "memberChildLinkAttempts"]
  );
  assert.equal(db.rows.get("students").has("protected"), true);
  assert.equal(db.rows.get("studentParentLinks").has("protected"), true);
});

test("a prerequisite read failure prevents every cleanup delete", async () => {
  const now = Date.now();
  const due = new Date(now - DAY_MS);
  const db = new FakeFirestore({
    emailVerifications: {
      expired: {cleanupAt: due, expiresAt: due},
    },
  }, ["signupAttempts"]);

  await assert.rejects(() => runRecordCleanup(db), /read failed: signupAttempts/);
  assert.equal(db.deleteCommits.length, 0);
  assert.equal(db.rows.get("emailVerifications").has("expired"), true);
});

test("a verification resent after preflight is never deleted as the stale version", async () => {
  const now = Date.now();
  const due = new Date(now - DAY_MS);
  const db = new FakeFirestore({
    emailVerifications: {
      "parent@example.com": {cleanupAt: due, expiresAt: due},
    },
  });
  db.beforeFirstCommit = () => {
    db.update("emailVerifications", "parent@example.com", {
      cleanupAt: new Date(now + DAY_MS),
      expiresAt: new Date(now + 5 * 60 * 1000),
      used: false,
    });
  };

  await assert.rejects(
    () => runRecordCleanup(db),
    /precondition failed: emailVerifications\/parent@example.com/
  );
  assert.equal(
    db.rows.get("emailVerifications").has("parent@example.com"),
    true
  );
  assert.equal(db.deleteCommits.length, 0);
});

test("running cleanup twice is idempotent", async () => {
  const now = Date.now();
  const due = new Date(now - DAY_MS);
  const db = new FakeFirestore({
    emailVerifications: {
      expired: {cleanupAt: due, expiresAt: due},
    },
    signupAttempts: {
      stale: {cleanupAt: due, timestamp: new Date(now - 31 * DAY_MS)},
    },
    memberChildLinkAttempts: {
      failed: {
        cleanupAt: due,
        result: "failed",
        createdAt: new Date(now - 91 * DAY_MS),
      },
    },
  });

  const first = await runRecordCleanup(db);
  const second = await runRecordCleanup(db);
  assert.equal(first.totalDeleted, 3);
  assert.equal(second.totalDeleted, 0);
  assert.equal(second.hasMore, false);
});

test("every automatic cleanup read is bounded by cleanupAt and limit", async () => {
  const db = new FakeFirestore();
  await runRecordCleanup(db, {perCollectionLimit: 5000});

  assert.equal(db.reads.length, 3);
  db.reads.forEach((read) => {
    assert.equal(read.limit, 500);
    assert.equal(read.orderField, "cleanupAt");
    assert.deepEqual(
      read.filters.map(({field, operator}) => ({field, operator})),
      [{field: "cleanupAt", operator: "<="}]
    );
  });
});
