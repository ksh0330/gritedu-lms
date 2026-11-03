const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const functionsSource = fs.readFileSync(
  path.join(__dirname, "..", "index.js"),
  "utf8"
);

const successAttemptBlock = functionsSource.match(
  /const result = alreadyLinked \? "alreadyLinked" : "linked";[\s\S]*?await recordMemberChildLinkAttempt\(\{[\s\S]*?\n\s{4}\}\);/
)?.[0] || "";

for (const result of ["linked", "alreadyLinked"]) {
  test(`${result} attempts save the normalized submitted input`, () => {
    assert.match(
      successAttemptBlock,
      /const result = alreadyLinked \? "alreadyLinked" : "linked";/
    );
    assert.match(successAttemptBlock, /result,[\s\S]*?submittedInput,/);
  });
}

test("submitted child input keeps all normalized fields and full phone digits", () => {
  const submittedInputBlock = functionsSource.match(
    /function getSubmittedMemberChildInput[\s\S]*?\n\}/
  )?.[0] || "";
  assert.match(submittedInputBlock, /studentName: truncateMemberChildInput\("studentName", normalizeStudentName/);
  assert.match(submittedInputBlock, /school: truncateMemberChildInput\("school", normalizeText/);
  assert.match(submittedInputBlock, /grade: truncateMemberChildInput\("grade", normalizeGrade/);
  assert.match(submittedInputBlock, /studentPhone: truncateMemberChildInput\("studentPhone", normalizePhoneDigits/);
  assert.match(submittedInputBlock, /relationLabel:/);
  assert.doesNotMatch(submittedInputBlock, /slice\(-4\)|phoneLast4/);
});

test("attempt retention remains one day for successes and seven days for failures", () => {
  const {
    getMemberChildAttemptRetentionDays,
  } = require("../member-child-link-policy");
  assert.equal(getMemberChildAttemptRetentionDays("linked"), 1);
  assert.equal(getMemberChildAttemptRetentionDays("alreadyLinked"), 1);
  assert.equal(getMemberChildAttemptRetentionDays("notFound"), 7);
  assert.equal(getMemberChildAttemptRetentionDays("invalidInput"), 7);
  assert.equal(getMemberChildAttemptRetentionDays("ambiguous"), 7);
});

test("production Function exports remain exactly the approved four", () => {
  const exportedNames = Array.from(
    functionsSource.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g),
    (match) => match[1]
  ).sort();
  assert.deepEqual(exportedNames, [
    "linkMemberChild",
    "scheduledRecordCleanup",
    "sendVerificationCode",
    "verifyEmailCode",
  ]);
});

test("submitted child identity is not passed to console logging", () => {
  assert.doesNotMatch(
    functionsSource,
    /console\.(?:log|warn|error)\([^)]*(?:submittedInput|studentPhone)/s
  );
});

test("input limits reject oversized or non-text fields and keep diagnostics small enough to store", () => {
  const {
    MEMBER_CHILD_INPUT_LIMITS,
    getOversizedOrInvalidMemberChildFields,
    truncateMemberChildInput,
  } = require("../member-child-link-policy");
  const valid = {
    studentName: "홍길동",
    school: "가나고등학교",
    grade: "4",
    studentPhone: "010-1234-5678",
    relationLabel: "mother",
  };
  assert.deepEqual(getOversizedOrInvalidMemberChildFields(valid), []);
  assert.deepEqual(getOversizedOrInvalidMemberChildFields({...valid, grade: 4}), []);
  assert.deepEqual(getOversizedOrInvalidMemberChildFields({...valid, school: "가".repeat(400000)}), ["school"]);
  assert.deepEqual(getOversizedOrInvalidMemberChildFields({...valid, studentName: {a: 1}}), ["studentName"]);
  assert.deepEqual(getOversizedOrInvalidMemberChildFields({...valid, studentPhone: 1012345678}), ["studentPhone"]);
  assert.equal(truncateMemberChildInput("school", "가".repeat(400000)).length, MEMBER_CHILD_INPUT_LIMITS.school);
  assert.match(functionsSource, /function validateMemberChildLinkInput[\s\S]*?getOversizedOrInvalidMemberChildFields\(data\)\.length\) return null/);
});

test("rate limit decision and attempt reservation share one transaction", () => {
  assert.doesNotMatch(functionsSource, /enforceMemberChildLinkRateLimit/);
  assert.match(functionsSource, /reserveMemberChildLinkAttempt\(\{\s*db,\s*memberUid,/);
  const callCount = (functionsSource.match(/await recordMemberChildLinkAttempt\(\{/g) || []).length;
  const passedRef = (functionsSource.match(/await recordMemberChildLinkAttempt\(\{\s*attemptRef,/g) || []).length;
  assert.ok(callCount > 0);
  assert.equal(passedRef, callCount, "every result replaces the reserved pending attempt");
});
