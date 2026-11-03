// 입력란 길이 제한: 화면 maxlength 가 Rules/Functions 한도보다 넓지 않은지 확인한다(DB 없음).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// 서버 기준값: firestore.rules isBoundedText, functions MEMBER_CHILD_INPUT_LIMITS.
const LIMIT = { name: 100, email: 254, school: 100, phone: 30, note: 1000, signupSourceOther: 200, childName: 50, childSchool: 100, childPhone: 30, gradeCustom: 20 };

const FIELDS = {
  "members/signup.html": { email: "email", studentName: "name", studentSchool: "school", studentPhone: "phone", studentEmail: "email", memberName: "name", memberPhone: "phone", memberSignupSourceOther: "signupSourceOther", memberEmail: "email", schoolSearchInput: "school" },
  "members/login.html": { email: "email" },
  "members/students/dashboard.html": { editName: "name", editPhone: "phone" },
  "members/member/dashboard.html": { childStudentName: "childName", childSchool: "childSchool", childStudentPhone: "childPhone", memberNameInput: "name", memberPhoneInput: "phone" },
  "members/admin/users/add.html": { userName: "name", userEmail: "email", userSchool: "school", userPhone: "phone", memberPhone: "phone", memberSignupSourceOther: "signupSourceOther", userMemo: "note", userMemoInstructor: "note" },
  "members/admin/users/students.html": { editUserName: "name", editUserSchool: "school", editUserPhone: "phone", editUserSignupSourceOther: "signupSourceOther", editUserNote: "note" },
  "members/admin/users/instructors.html": { addInstructorInfoName: "name", addInstructorInfoEmail: "email", addInstructorInfoNote: "note", editInstructorName: "name", editInstructorEmail: "email", editInstructorNote: "note" },
  "members/admin/offline-classes.html": { offlineCatalogSchoolInput: "school", classSchoolCustom: "school", offlineCatalogGradeInput: "gradeCustom", classGradeCustom: "gradeCustom" },
  "members/admin/courses.html": { courseCatalogGradeInput: "gradeCustom" },
  "members/admin/site.html": { footerSettingPhone: "phone" },
};

function maxlengthOf(html, id) {
  const tag = html.match(new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(tag, `입력란 #${id} 이 있어야 한다`);
  const m = tag[0].match(/\bmaxlength="(\d+)"/);
  return m ? Number(m[1]) : null;
}

test("서버 한도(기준값)가 Rules/Functions 와 같다", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /isBoundedText\(data\.name, 1, 100\)/);
  assert.match(rules, /isBoundedText\(data\.email, 1, 254\)/);
  assert.match(rules, /isBoundedText\(data\.school, 0, 100\)/);
  assert.match(rules, /isBoundedText\(data\.phone, 0, 30\)/);
  assert.match(rules, /isBoundedText\(data\.note, 0, 1000\)/);
  assert.match(rules, /isBoundedText\(data\.signupSourceOther, 1, 200\)/);
  const { MEMBER_CHILD_INPUT_LIMITS } = require("../functions/member-child-link-policy");
  assert.equal(MEMBER_CHILD_INPUT_LIMITS.studentName, LIMIT.childName);
  assert.equal(MEMBER_CHILD_INPUT_LIMITS.school, LIMIT.childSchool);
  assert.equal(MEMBER_CHILD_INPUT_LIMITS.studentPhone, LIMIT.childPhone);
});

test("학생·회원·관리자 입력란 maxlength 가 서버 한도와 같다(넓으면 저장 시 거부)", () => {
  for (const [rel, fields] of Object.entries(FIELDS)) {
    const html = read(rel);
    for (const [id, kind] of Object.entries(fields)) {
      assert.equal(maxlengthOf(html, id), LIMIT[kind], `${rel} #${id} maxlength`);
    }
  }
});

test("가입 화면 자녀 정보 입력란(JS 템플릿)도 자녀 연동 한도를 따른다", () => {
  const source = read("assets/js/features/signup/children-form.js");
  assert.match(source, /class="child-name-input" maxlength="50"/);
  assert.match(source, /class="child-school-input" maxlength="100"/);
  assert.match(source, /class="child-phone-input" maxlength="30"/);
});
