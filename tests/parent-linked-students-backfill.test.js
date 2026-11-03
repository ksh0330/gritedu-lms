// 학부모 자녀 목록 보정 스크립트: 합성 데이터만 사용한다(운영 DB 없음).
const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs, activeChildUids, buildParentChildPlan, backfillMember, MAX_RULES_CHILDREN } = require("../scripts/backfill-parent-linked-students.js");

const link = (studentUid, memberUid, status = "active") => ({ id: `${studentUid}_${memberUid}`, data: { studentUid, memberUid, status } });
const parent = (extra = {}) => ({ memberPurpose: "parent", status: "active", linkedChildrenCount: 1, ...extra });

test("인자: 기본은 dry-run, 쓰기는 명시 플래그와 숫자 확인값만 받는다", () => {
  assert.deepEqual(parseArgs(["--project", "p"]), { dryRun: true, projectId: "p", confirmCount: null });
  assert.deepEqual(parseArgs(["--project", "p", "--write", "--confirm-count", "3"]), { dryRun: false, projectId: "p", confirmCount: 3 });
  assert.throws(() => parseArgs(["--confirm-count", "x"]), /nonnegative integer/);
  assert.throws(() => parseArgs(["--force"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--project"]), /Missing argument value/);
});

test("활성 자녀만 중복 없이 순서대로 모은다", () => {
  assert.deepEqual(activeChildUids([
    { studentUid: "s1", status: "active" }, { studentUid: "s2", status: "revoked" },
    { studentUid: "s1", status: "active" }, { studentUid: "s3", status: "active" },
  ]), ["s1", "s3"]);
});

test("대상 계산: 최신 목록은 건너뛰고, 회원 없음·비학부모는 막고, 수 불일치와 한도 초과는 보고만 한다", () => {
  const links = [
    link("s1", "p-new"), link("s2", "p-new"),
    link("s1", "p-current"),
    link("s1", "p-missing"),
    link("s1", "p-general"),
    ...["a", "b", "c", "d", "e", "f"].map((s) => link(s, "p-many")),
  ];
  const members = new Map([
    ["p-new", parent({ linkedChildrenCount: 3 })],
    ["p-current", parent({ linkedStudentUids: ["s1"] })],
    ["p-missing", null],
    ["p-general", { memberPurpose: "general", status: "active", linkedChildrenCount: 1 }],
    ["p-many", parent({ linkedChildrenCount: 6 })],
  ]);
  const { totals, targets } = buildParentChildPlan(links, members);
  assert.deepEqual(targets.sort(), ["p-many", "p-new"]);
  assert.equal(totals.activeLinks, links.length);
  assert.equal(totals.parents, 5);
  assert.equal(totals.toUpdate, 2);
  assert.equal(totals.alreadyCurrent, 1);
  assert.equal(totals.blockedMissingMember, 1);
  assert.equal(totals.blockedNotActiveParent, 1);
  assert.equal(totals.countMismatch, 1);
  assert.equal(totals.overRulesLimit, 1);
  assert.equal(MAX_RULES_CHILDREN, 5);
});

function fakeDb({ member, links }) {
  const writes = [];
  const memberRef = { id: "p1" };
  return {
    writes,
    collection(name) {
      if (name === "members") return { doc: () => memberRef };
      return { where: () => ({ orderBy: () => ({ kind: "links" }) }) };
    },
    async runTransaction(fn) {
      return fn({
        get: async (target) => target === memberRef
          ? { exists: member != null, data: () => member }
          : { docs: links.map((data) => ({ data: () => data })) },
        update: (ref, data) => writes.push(data),
      });
    },
  };
}

test("쓰기: 트랜잭션 안에서 연동 문서로 다시 계산하고, 이미 같거나 자격이 없으면 쓰지 않는다", async () => {
  const links = [{ studentUid: "s1", status: "active" }, { studentUid: "s2", status: "revoked" }];
  const db = fakeDb({ member: parent(), links });
  assert.equal(await backfillMember(db, "p1", "__name__"), "updated");
  assert.deepEqual(db.writes, [{ linkedStudentUids: ["s1"] }]);

  const current = fakeDb({ member: parent({ linkedStudentUids: ["s1"] }), links });
  assert.equal(await backfillMember(current, "p1", "__name__"), "skipped");
  assert.equal(current.writes.length, 0);

  const general = fakeDb({ member: { memberPurpose: "general", status: "active" }, links });
  assert.equal(await backfillMember(general, "p1", "__name__"), "skipped");
  assert.equal(general.writes.length, 0);

  const missing = fakeDb({ member: null, links });
  assert.equal(await backfillMember(missing, "p1", "__name__"), "skipped");
});
