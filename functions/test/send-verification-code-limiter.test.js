const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// Handler-order regression for sendVerificationCode. firebase-admin, nodemailer
// and dotenv are replaced in require.cache so no network, Firestore, Auth or
// mail call leaves the process. The fake runs transaction bodies one at a time
// (assumed serial execution); it does not model Firestore query-range locking,
// so it proves the handler order, not production concurrency behavior.

const functionsDir = path.join(__dirname, "..");
const IP = "203.0.113.7";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const state = {
  nowMillis: Date.UTC(2026, 9, 30, 3, 0, 0),
  collections: new Map(),
  authEmails: new Set(),
  authLookups: 0,
  transactionQueryReads: 0,
  outsideAttemptQueryReads: 0,
  sentMails: [],
  failMail: false,
};

class FakeTimestamp {
  constructor(millis) {
    this.millis = millis;
  }
  toMillis() {
    return this.millis;
  }
  static now() {
    return new FakeTimestamp(state.nowMillis);
  }
  static fromMillis(millis) {
    return new FakeTimestamp(millis);
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
let autoId = 0;

function rowsOf(collectionName) {
  if (!state.collections.has(collectionName)) {
    state.collections.set(collectionName, new Map());
  }
  return state.collections.get(collectionName);
}

function snapshotOf(collectionName, id) {
  const data = rowsOf(collectionName).get(id);
  return {exists: data !== undefined, id, data: () => (data === undefined ? undefined : {...data})};
}

function fakeQuery(collectionName, filters = [], max = Infinity) {
  return {
    kind: "query",
    where(field, op, value) {
      assert.equal(op, "==");
      return fakeQuery(collectionName, [...filters, [field, value]], max);
    },
    limit(count) {
      return fakeQuery(collectionName, filters, count);
    },
    run() {
      const docs = [...rowsOf(collectionName).entries()]
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .slice(0, max)
        .map(([id, data]) => ({id, data: () => ({...data})}));
      return {empty: docs.length === 0, docs};
    },
    async get() {
      await tick();
      if (collectionName === "signupAttempts") state.outsideAttemptQueryReads += 1;
      return this.run();
    },
  };
}

function fakeDocRef(collectionName, id) {
  return {
    kind: "doc",
    collectionName,
    id,
    async get() {
      await tick();
      return snapshotOf(collectionName, id);
    },
  };
}

let transactionChain = Promise.resolve();
const fakeDb = {
  collection(name) {
    return {
      doc: (id) => fakeDocRef(name, id ?? `auto_${++autoId}`),
      where: (field, op, value) => fakeQuery(name).where(field, op, value),
      async add(data) {
        await tick();
        const ref = fakeDocRef(name, `auto_${++autoId}`);
        rowsOf(name).set(ref.id, {...data});
        return ref;
      },
    };
  },
  runTransaction(updateFunction) {
    const run = transactionChain.then(async () => {
      const writes = [];
      const transaction = {
        async get(target) {
          // Firestore rejects transactional reads after a write.
          if (writes.length) throw new Error("read after write in transaction");
          await tick();
          if (target.kind === "doc") return snapshotOf(target.collectionName, target.id);
          state.transactionQueryReads += 1;
          return target.run();
        },
        set(ref, data, options = {}) {
          writes.push({type: "set", ref, data, merge: options.merge === true});
        },
        create(ref, data) {
          writes.push({type: "create", ref, data});
        },
      };
      const result = await updateFunction(transaction);
      for (const write of writes) {
        const rows = rowsOf(write.ref.collectionName);
        if (write.type === "create" && rows.has(write.ref.id)) throw new Error("already exists");
        const base = write.merge ? (rows.get(write.ref.id) || {}) : {};
        rows.set(write.ref.id, {...base, ...write.data});
      }
      return result;
    });
    transactionChain = run.catch(() => {});
    return run;
  },
};

const fakeAdmin = {
  apps: [],
  initializeApp() {
    fakeAdmin.apps.push({});
  },
  firestore: Object.assign(() => fakeDb, {Timestamp: FakeTimestamp}),
  auth: () => ({
    async getUserByEmail(email) {
      state.authLookups += 1;
      await tick();
      if (state.authEmails.has(email)) return {uid: "registered"};
      const error = new Error("not found");
      error.code = "auth/user-not-found";
      throw error;
    },
  }),
};

const fakeNodemailer = {
  createTransport: () => ({
    async sendMail(options) {
      await tick();
      if (state.failMail) throw new Error("smtp down");
      state.sentMails.push(options.to);
    },
    close() {},
  }),
};

function mockModule(name, exportsValue) {
  const resolved = require.resolve(name, {paths: [functionsDir]});
  const mocked = new Module(resolved);
  mocked.filename = resolved;
  mocked.loaded = true;
  mocked.exports = exportsValue;
  require.cache[resolved] = mocked;
}

mockModule("firebase-admin", fakeAdmin);
mockModule("nodemailer", fakeNodemailer);
mockModule("dotenv", {config() {}});
process.env.EMAIL_USER = "sender-placeholder";
process.env.EMAIL_PASS = "password-placeholder";

const {sendVerificationCode} = require("../index");

function reset() {
  state.collections = new Map();
  state.authEmails = new Set();
  state.authLookups = 0;
  state.transactionQueryReads = 0;
  state.outsideAttemptQueryReads = 0;
  state.sentMails = [];
  state.failMail = false;
}

function send(email, {ip = IP, signupType = "student"} = {}) {
  return sendVerificationCode.run({email, signupType}, {rawRequest: {ip, headers: {}}});
}

function attempts() {
  return [...rowsOf("signupAttempts").values()];
}

function seedIpAttempts(count) {
  for (let index = 0; index < count; index += 1) {
    rowsOf("signupAttempts").set(`seed_${index}`, {
      email: `seed${index}@example.com`,
      ip: IP,
      timestamp: FakeTimestamp.fromMillis(state.nowMillis - (index + 1) * 60 * 1000),
      cleanupAt: FakeTimestamp.fromMillis(state.nowMillis + DAY_MS),
    });
  }
}

test("cooldown-rejected retries do not consume the hourly email quota", async () => {
  reset();
  const start = state.nowMillis;
  for (let round = 0; round < 5; round += 1) {
    state.nowMillis = start + round * 61 * 1000;
    assert.equal((await send("learner@example.com")).success, true);
    if (round === 4) break;
    for (let retry = 1; retry <= 4; retry += 1) {
      state.nowMillis = start + round * 61 * 1000 + retry * 10 * 1000;
      await assert.rejects(send("learner@example.com"), (error) =>
        error.code === "resource-exhausted" && /1분 간격/.test(error.message)
      );
    }
  }
  assert.equal(attempts().length, 5);
  assert.equal(state.sentMails.length, 5);
  // Email + IP window reads inside the transaction only for the 5 accepted
  // sends; the 16 cooldown rejections stop before the limiter re-check.
  assert.equal(state.transactionQueryReads, 10);
  assert.equal(state.outsideAttemptQueryReads, 0);

  state.nowMillis = start + 5 * 61 * 1000;
  await assert.rejects(send("learner@example.com"), (error) =>
    error.code === "resource-exhausted" &&
    error.details?.reason === "too-many-attempts-per-email-hourly" &&
    /이 이메일의 인증번호 발송 요청이 많습니다/.test(error.message)
  );
  assert.equal(attempts().length, 5);
  state.nowMillis = start;
});

test("serialized mock transactions recheck the IP threshold (not a production concurrency proof)", async () => {
  reset();
  seedIpAttempts(29);
  const results = await Promise.allSettled([
    send("first@example.com"),
    send("second@example.com"),
  ]);
  const accepted = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "resource-exhausted");
  assert.equal(rejected[0].reason.details?.reason, "too-many-attempts-per-ip-hourly");
  assert.match(rejected[0].reason.message, /현재 네트워크의 인증번호 발송 요청이 많습니다/);
  assert.equal(attempts().filter((attempt) => attempt.ip === IP).length, 30);
  assert.equal(state.sentMails.length, 1);
});

test("accepted send stores only the four event fields with one-day cleanupAt", async () => {
  reset();
  const response = await send("Mixed.Case@Example.com");
  assert.equal(response.success, true);
  assert.equal(typeof response.verificationSessionToken, "string");
  assert.equal(state.transactionQueryReads, 2);
  const [event] = attempts();
  assert.deepEqual(Object.keys(event).sort(), ["cleanupAt", "email", "ip", "timestamp"]);
  assert.equal(event.email, "mixed.case@example.com");
  assert.equal(event.ip, IP);
  assert.equal(event.timestamp.toMillis(), state.nowMillis);
  assert.equal(event.cleanupAt.toMillis() - event.timestamp.toMillis(), DAY_MS);
  const verification = rowsOf("emailVerifications").get("mixed.case@example.com");
  assert.equal(verification.used, false);
  assert.equal(verification.signupType, "student");
});

test("registered email keeps already-exists and is not recorded while the window has room", async () => {
  reset();
  state.authEmails.add("taken@example.com");
  await assert.rejects(send("taken@example.com"), (error) =>
    error.code === "already-exists" && /이미 가입된 이메일입니다/.test(error.message)
  );
  assert.equal(attempts().length, 0);
  assert.equal(state.sentMails.length, 0);
});

test("registered-email rejection does not add attempt-window reads even with a full IP window", async () => {
  reset();
  seedIpAttempts(30);
  state.authEmails.add("taken@example.com");
  await assert.rejects(send("taken@example.com"), (error) =>
    error.code === "already-exists"
  );
  assert.equal(state.authLookups, 1);
  assert.equal(state.transactionQueryReads, 0);
  assert.equal(state.outsideAttemptQueryReads, 0);
  assert.equal(attempts().length, 30);
});

test("mail failure keeps the accepted event and invalidates the code as before", async () => {
  reset();
  state.failMail = true;
  await assert.rejects(send("mailfail@example.com"), (error) => error.code === "unavailable");
  assert.equal(attempts().length, 1);
  const verification = rowsOf("emailVerifications").get("mailfail@example.com");
  assert.equal(verification.used, true);
  assert.equal(verification.invalidationReason, "email-send-failed");
});

test("unknown IP never blocks on the IP window", async () => {
  reset();
  seedIpAttempts(30);
  const response = await sendVerificationCode.run(
    {email: "noip@example.com", signupType: "member"},
    {rawRequest: {headers: {}}}
  );
  assert.equal(response.success, true);
  assert.equal(state.transactionQueryReads, 1);
  assert.equal(attempts().find((attempt) => attempt.email === "noip@example.com").ip, "unknown");
});
