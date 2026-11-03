const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {createPreviewServer} = require("../scripts/serve-local");
test("preview serves only built pages with clean URLs, no internal files or writes", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"grit-preview-"));
  const server=await createPreviewServer(root);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(path.join(root,"index.html"),"<h1>preview</h1>");
  await fs.writeFile(path.join(root,"course.html"),"course");
  await fs.writeFile(path.join(root,"build-report.json"),"private report");
  await fs.writeFile(path.join(root,".env.qa.local"),"placeholder");
  await fs.writeFile(path.join(root,"serviceAccountKey-test.json"),"placeholder");
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base+"/")).text(),"<h1>preview</h1>");
  const clean=await fetch(base+"/course?v=1");assert.equal(clean.status,200);assert.equal(await clean.text(),"course");
  for(const url of ["/.env.qa.local","/build-report.json","/BUILD-REPORT.JSON","/build-report.json::$DATA","/serviceAccountKey-test.json::$DATA","/build-report.json.","/serviceAccountKey-test.json","/functions/index.js","/%2eenv","/x.map","/missing","/%5c..%5csecret"]) assert.equal((await fetch(base+url)).status,404,url);
  await t.test("resolved alias cannot expose internal report", async child => {
    try { await fs.symlink(path.join(root,"build-report.json"),path.join(root,"alias.json"),"file"); }
    catch (error) { if (["EPERM","EACCES"].includes(error.code)) { child.skip("OS does not permit test symlink"); return; } throw error; }
    assert.equal((await fetch(base+"/alias.json")).status,404);
  });
  assert.equal((await fetch(base+"/",{method:"POST"})).status,405);
  assert.equal(await (await fetch(base+"/",{method:"HEAD"})).text(),"");
  assert.equal((await fetch(base+"/")).headers.get("cache-control"),"no-store");
});
