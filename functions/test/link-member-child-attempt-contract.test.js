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
  assert.match(submittedInputBlock, /studentName: normalizeStudentName/);
  assert.match(submittedInputBlock, /school: normalizeText/);
  assert.match(submittedInputBlock, /grade: normalizeGrade/);
  assert.match(submittedInputBlock, /studentPhone: normalizePhoneDigits/);
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
