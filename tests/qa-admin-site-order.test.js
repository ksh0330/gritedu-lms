const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/pages/admin-site.js'), 'utf8');
const start = source.indexOf('// 강사진 순서 관리');
const end = source.indexOf('// 드래그 앤 드롭 활성화', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const writes = [];
  const notices = [];
  const list = { children: ['b', 'a'].map(id => ({ getAttribute: () => id })) };
  const context = vm.createContext({
    window: {},
    $: selector => selector === '#instructorOrderList' ? list : null,
    db: {},
    doc: () => ({}),
    setDoc: async (_ref, data) => { writes.push(data); },
    serverTimestamp: () => 'now',
    invalidateSetting: () => {},
    toast: (message, error) => notices.push({ message, error }),
    console: { error: () => {} },
    confirm: () => true,
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('renderInstructorList = () => {}; updateInstructorPreview = () => {}; homeOrder = ["a", "b"]; homeHidden = [];', context);
  return { context, list, writes, notices };
}

test('visibility writes only the active hidden field and preserves draft order', async () => {
  const { context, writes, notices } = setup();
  await context.window.toggleInstructorVisibility('a');
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['homeHidden', 'updatedAt']);
  assert.deepEqual(Array.from(writes[0].homeHidden), ['a']);
  assert.deepEqual(Array.from(vm.runInContext('homeOrder', context)), ['b', 'a']);
  assert.equal(notices.at(-1).message, '강사 표시 상태가 변경되었습니다.');
});

test('failed visibility write restores hidden state without saving order', async () => {
  const { context, notices } = setup();
  context.setDoc = async () => { throw Error('offline'); };
  await context.window.toggleInstructorVisibility('a');
  assert.deepEqual(Array.from(vm.runInContext('homeHidden', context)), []);
  assert.deepEqual(Array.from(vm.runInContext('homeOrder', context)), ['b', 'a']);
  assert.match(notices.at(-1).message, /강사 표시 상태 저장 실패/);
});

test('order save writes only the selected page order field', async () => {
  const { context, writes, notices } = setup();
  await context.window.saveInstructorOrder();
  assert.deepEqual(Object.keys(writes[0]).sort(), ['homeOrder', 'updatedAt']);
  assert.deepEqual(Array.from(writes[0].homeOrder), ['b', 'a']);
  assert.match(notices.at(-1).message, /메인홈 강사진 순서가 저장/);
});

test('page switch retains the home draft and writes instructor visibility separately', async () => {
  const { context, writes } = setup();
  context.window.switchInstructorPageType('instructors');
  assert.deepEqual(Array.from(vm.runInContext('homeOrder', context)), ['b', 'a']);
  await context.window.toggleInstructorVisibility('b');
  assert.deepEqual(Object.keys(writes[0]).sort(), ['instructorsHidden', 'updatedAt']);
  assert.deepEqual(Array.from(vm.runInContext('homeOrder', context)), ['b', 'a']);
});

test('cleanup removes invalid persisted IDs without saving a different draft order', async () => {
  const { context, writes } = setup();
  vm.runInContext('homeOrder = ["b", "a"]; persistedHomeOrder = ["a", "missing", "b"]; allInstructorsList = [{id:"a"},{id:"b"}];', context);
  await context.window.cleanupInstructorOrder();
  assert.deepEqual(Array.from(writes[0].homeOrder), ['a', 'b']);
  assert.deepEqual(Array.from(vm.runInContext('homeOrder', context)), ['b', 'a']);
  assert.equal('instructorsOrder' in writes[0], false);
});
