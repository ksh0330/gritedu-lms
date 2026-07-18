import fs from "node:fs";

const path = new URL("../assets/js/pages/admin-site.js", import.meta.url);
const filePath = path.pathname.replace(/^\/([A-Za-z]:)/, "$1");
let src = fs.readFileSync(filePath, "utf8");

const start = src.indexOf("// 이야기 콘텐츠 로드 및 편집 필드 생성");
const end = src.indexOf("function contactTransportPlain(s)");
if (start === -1 || end === -1) {
  throw new Error(`markers not found: start=${start}, end=${end}`);
}

src = `${src.slice(0, start)}${src.slice(end)}`;
fs.writeFileSync(filePath, src);
console.log("Removed legacy story CMS block from admin-site.js");
