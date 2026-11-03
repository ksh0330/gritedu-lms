const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../assets/js/pages/admin-popup.js"),"utf8");
function setup(write) {
  const calls=[];let caches=0;
  const context={window:{},db:{},doc:()=>({}),serverTimestamp:()=>"now",setDoc:async(_,payload)=>{calls.push(JSON.parse(JSON.stringify(payload)));await write?.();},invalidateSetting(){caches++;},clearHomePopupCache(){},toast(){},loadPopups:async()=>{},renderPopupList(){},confirm:()=>true,console:{error(){}}};
  vm.createContext(context);
  const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  vm.runInContext('let isPopupSaving=false,popupListMutationInFlight=false;let allPopups=[{id:"A",enabled:false},{id:"B",enabled:false},{id:"C",enabled:true}];'+slice('async function savePopupOrder(', '// 팝업 목록 드래그')+slice('// 팝업 활성화','// ESC 키로'),context);
  return {context,calls,rows:()=>JSON.parse(vm.runInContext('JSON.stringify(allPopups)',context)),cacheCount:()=>caches};
}
test("failed deletion cannot shift indices or leak into the next successful toggle",async()=>{
  let fail=true;const s=setup(async()=>{if(fail)throw Error("offline");});
  await s.context.window.deletePopup(0);
  assert.deepEqual(s.rows().map(x=>x.id),["A","B","C"]);assert.equal(s.cacheCount(),0);
  fail=false;await s.context.window.togglePopupEnabled(1,false);
  assert.deepEqual(s.calls[1].popups.map(x=>x.id),["A","B","C"]);
  assert.equal(s.calls[1].popups[1].enabled,true);assert.equal(s.calls[1].popups[0].enabled,false);
});
test("failed toggle leaves the committed in-memory values unchanged",async()=>{
  const s=setup(async()=>{throw Error("permission-denied");});await s.context.window.togglePopupEnabled(0,false);
  assert.equal(s.rows()[0].enabled,false);assert.equal(s.cacheCount(),0);
});
test("failed reorder preserves the list and successful retry commits just the order",async()=>{
  let fail=true;const s=setup(async()=>{if(fail)throw Error("offline");});await s.context.window.movePopup(0,1);
  assert.deepEqual(s.rows().map(x=>x.id),["A","B","C"]);fail=false;await s.context.window.movePopup(0,1);
  assert.deepEqual(s.rows().map(x=>x.id),["B","A","C"]);
});
test("pending list write prevents overlapping mutation and releases the guard afterward",async()=>{
  let finish;const s=setup(()=>new Promise(resolve=>{finish=resolve;}));const pending=s.context.window.togglePopupEnabled(0,false);
  await s.context.window.deletePopup(1);assert.equal(s.calls.length,1);assert.equal(s.rows()[0].enabled,false);
  finish();await pending;assert.equal(s.rows()[0].enabled,true);
  s.context.confirm=()=>false;await s.context.window.deletePopup(1);assert.equal(s.calls.length,1);
});
