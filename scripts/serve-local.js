"use strict";
// Static preview only. Firebase configuration in dist is unchanged.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const TYPES = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml", ".png":"image/png", ".webp":"image/webp", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".ico":"image/x-icon", ".csv":"text/csv", ".txt":"text/plain", ".xml":"application/xml", ".webmanifest":"application/manifest+json", ".woff2":"font/woff2", ".woff":"font/woff", ".mp4":"video/mp4"};
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
function isDenied(relative) {
  const normalized = relative.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("\\") || normalized.includes("\0") || normalized.includes(":") || normalized.endsWith(".map") ||
    normalized.split("/").some(part => part.startsWith(".") || part.endsWith(".") || part.endsWith(" ") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/.test(part) || /^(serviceaccountkey.*\.json)$/.test(part) ||
      ["functions", "scripts", "node_modules", "docs", "md", "build-report.json", "firebase.json", "firestore.rules", "_headers", "_redirects"].includes(part));
}
async function createPreviewServer(root) {
  const base = await fs.realpath(root);
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, {Allow:"GET, HEAD"}); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      if (pathname.includes("\\") || isDenied(pathname)) {
        res.writeHead(404); res.end(); return;
      }
      const relative = /^\/schedule-images\//.test(pathname) ? "/schedule-images.html" : pathname;
      const target = path.resolve(base, "." + relative);
      if (!inside(base, target)) { res.writeHead(404); res.end(); return; }
      const candidates = relative.endsWith("/") ? [path.join(target,"index.html")] : [target, target+".html", path.join(target,"index.html")];
      for (const candidate of candidates) {
        try {
          const real = await fs.realpath(candidate);
          if (!inside(base, real) || isDenied(path.relative(base, real)) || !(await fs.stat(real)).isFile()) continue;
          const data = await fs.readFile(real);
          res.writeHead(200, {"Content-Type": (TYPES[path.extname(real)] || "application/octet-stream"), "Content-Length":data.length});
          res.end(req.method === "HEAD" ? undefined : data); return;
        } catch (error) { if (!["ENOENT","ENOTDIR","EACCES","EPERM"].includes(error.code)) throw error; }
      }
      res.writeHead(404); res.end();
    } catch (error) { res.writeHead(error instanceof URIError ? 400 : 500); res.end(); }
  });
}
async function main() {
  const root = path.resolve(__dirname,"..","dist");
  try { await fs.access(path.join(root,"index.html")); }
  catch { throw new Error("dist/index.html이 없습니다. npm run local로 빌드 후 실행하세요."); }
  const port = Number(process.env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT는 1~65535 정수여야 합니다.");
  const server = await createPreviewServer(root);
  server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `포트 ${port} 사용 중입니다. 기존 서버를 종료하거나 PORT를 변경하세요.` : error.message); process.exitCode=1; });
  server.listen(port,"127.0.0.1",()=> {
    console.log(`로컬 미리보기: http://127.0.0.1:${port}`);
    console.log("정적 파일만 로컬입니다. Firebase Auth/Firestore/Functions는 기존 설정(운영 gritedu-lms)에 연결됩니다.");
    console.log("로그인/현황 불러오기는 운영 조회를 유발할 수 있습니다. 승인되지 않은 저장·삭제·발송은 실행하지 마세요.");
    console.log("종료: Ctrl+C. 변경 반영: 서버 종료 후 npm run local 재실행. Firebase/Google CLI 로그인은 필요 없습니다.");
  });
}
if (require.main === module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={createPreviewServer};
