const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/utils/approval-enrollment-search.js'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/js/pages/admin-courses.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'members/admin/courses.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/css/pages/admin-courses.css'), 'utf8');

async function loadModule() {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('name and email search require a committed, bounded query', async () => {
  const { classifyEnrollmentSearch, MANUAL_ENROLLMENT_SEARCH_LIMIT } = await loadModule();
  assert.equal(classifyEnrollmentSearch('김'), null);
  assert.deepEqual(classifyEnrollmentSearch(' 김 민 '), { field: 'name', value: '김 민' });
  assert.deepEqual(classifyEnrollmentSearch('qa@example.com'), { field: 'email', value: 'qa@example.com' });
  assert.equal(MANUAL_ENROLLMENT_SEARCH_LIMIT, 20);
  assert.match(script, /where\("name", ">=", term\.value\)/);
  assert.match(script, /where\("email", "==", term\.value\)/);
  assert.match(script, /limit\(MANUAL_ENROLLMENT_SEARCH_LIMIT\)/);
  assert.match(script, /event\.target\.id !== "manualApprovalSearchForm"/);
  assert.match(script, /searchManualEnrollment\(activeEnrollmentCourseId/);
});

test('same-name candidates remain separate by UID and type; parent cannot be selected', async () => {
  const { toEnrollmentCandidates, getSelectedEnrollmentCandidate } = await loadModule();
  const candidates = toEnrollmentCandidates(
    [{ id: 'student-1', data: { name: '김민수', email: 'student@example.com', school: 'A고', type: 'spoofed' } }],
    [
      { id: 'member-1', data: { name: '김민수', email: 'member@example.com', memberPurpose: 'general' } },
      { id: 'parent-1', data: { name: '김민수', email: 'parent@example.com', memberPurpose: 'parent' } },
    ]
  );
  assert.equal(candidates.length, 3);
  assert.equal(getSelectedEnrollmentCandidate(candidates, 'student', 'student-1').type, 'student');
  assert.equal(getSelectedEnrollmentCandidate(candidates, 'member', 'member-1').email, 'member@example.com');
  assert.equal(getSelectedEnrollmentCandidate(candidates, 'member', 'parent-1'), null);
  assert.equal(getSelectedEnrollmentCandidate(candidates, 'member', 'student-1'), null);
  assert.equal(getSelectedEnrollmentCandidate(candidates, '', ''), null);
});

test('registration stays separate from Enter search and retains enrollment policy', () => {
  assert.match(script, /data-register-manual="1"/);
  assert.match(script, /if \(!selected\) \{[\s\S]*?등록할 계정을 선택/);
  assert.match(script, /await grantApprovalEnrollment\(courseId, uid, type\)/);
  assert.match(script, /이미 수강 중인 계정입니다/);
  assert.match(script, /profile\.memberPurpose !== "general"/);
  assert.match(script, /enrollmentSnap\.exists\(\) \? approved : \{ \.\.\.approved, progress: 0/);
  assert.doesNotMatch(script, /manualApprovalEnrollmentForm|manualApprovalEmail/);
});

test('administrator labels and input styles remain distinct from learner labels', () => {
  assert.match(html, /<option value="public">공개<\/option>/);
  assert.match(html, /<option value="memberOnly">회원 전용<\/option>/);
  assert.match(html, /<option value="approvalRequired">회원 전용\(유료\)<\/option>/);
  assert.match(html, /신청 후 관리자 승인 또는 직접 등록으로 수강/);
  assert.match(script, /if \(raw === "approvalRequired"\) return "회원 전용\(유료\)"/);
  assert.match(css, /#manualApprovalSearchForm input \{[\s\S]*?border-radius: 8px/);
  assert.match(css, /\.admin-courses-manual-results \{[\s\S]*?overflow-y: auto/);
});

test('search failure shows loading then a distinct lookup error', async () => {
  const { classifyEnrollmentSearch } = await loadModule();
  const start = script.indexOf('async function searchManualEnrollment(');
  const end = script.indexOf('\nfunction renderEnrollmentTable(', start);
  assert.ok(start >= 0 && end > start);
  const statuses = [];
  const context = {
    manualEnrollmentSearchRequestId: 0,
    manualEnrollmentSearchTerm: '',
    manualEnrollmentSearch: {},
    activeEnrollmentCourseId: 'course-1',
    classifyEnrollmentSearch,
    MANUAL_ENROLLMENT_SEARCH_LIMIT: 20,
    updateManualEnrollmentSection: () => statuses.push(context.manualEnrollmentSearch.status),
    $: () => null,
    where: () => ({}), limit: () => ({}), collection: () => ({}), query: () => ({}),
    getDocs: async () => { throw new Error('mock lookup failure'); },
    db: {},
    console: { error: () => {} },
  };
  const search = vm.runInNewContext(`${script.slice(start, end)}\nsearchManualEnrollment`, context);
  await search('course-1', '김민수');
  assert.deepEqual(statuses, ['loading', 'search-error']);
  assert.equal(context.manualEnrollmentSearch.selectedKey, '');
});

test('registration requires selection and distinguishes duplicate, failure, and success', async () => {
  const { getSelectedEnrollmentCandidate } = await loadModule();
  const start = script.indexOf('async function manuallyEnrollApproval(');
  const end = script.indexOf('\n$("#courseEnrollmentsBody")?.addEventListener("click"', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const candidate = { id: 'student-1', type: 'student', name: '동명이인', email: 'student@example.test' };
  const context = {
    manualEnrollmentSearch: { results: [candidate], selectedKey: '', status: 'ready', message: '' },
    parseManualCandidateKey: (key) => key ? key.split(':') : ['', ''],
    getSelectedEnrollmentCandidate,
    approvalActionInProgress: false,
    updateManualEnrollmentSection: () => {},
    window: { confirm: () => true },
    grantApprovalEnrollment: async (...args) => calls.push(args),
    toast: () => {},
    refreshAfterApprovalWrite: async () => {},
  };
  const register = vm.runInNewContext(`${script.slice(start, end)}\nmanuallyEnrollApproval`, context);
  await register('course-1');
  assert.equal(context.manualEnrollmentSearch.status, 'selection-error');
  assert.equal(calls.length, 0);

  context.manualEnrollmentSearch.selectedKey = 'student:student-1';
  context.grantApprovalEnrollment = async () => { throw new Error('이미 수강 중인 계정입니다.'); };
  await register('course-1');
  assert.equal(context.manualEnrollmentSearch.status, 'duplicate');

  context.grantApprovalEnrollment = async () => { throw new Error('mock save failure'); };
  await register('course-1');
  assert.equal(context.manualEnrollmentSearch.status, 'save-error');
  assert.equal(context.manualEnrollmentSearch.message, 'mock save failure');

  context.grantApprovalEnrollment = async (...args) => calls.push(args);
  await register('course-1');
  assert.equal(context.manualEnrollmentSearch.status, 'success');
  assert.equal(context.manualEnrollmentSearch.selectedKey, '');
  assert.deepEqual(calls, [['course-1', 'student-1', 'student']]);
});
