const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function extractFunction(file, signature) {
  const code = source(file);
  const start = code.indexOf(signature);
  assert.notEqual(start, -1, `${file}: ${signature} not found`);
  const end = code.slice(start).search(/\r?\n\}(\r?\n|$)/);
  assert.notEqual(end, -1, `${file}: end of ${signature} not found`);
  const name = signature.match(/function (\w+)\(/)[1];
  return vm.runInNewContext(`(${code.slice(start, start + end)}\n})`, {}, { filename: `${file}#${name}` });
}

// 브라우저 HTML 파서가 이 문자열을 텍스트로 읽을 때와 같은 결과를 내는 최소 decoder.
function decodeHtmlText(html) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#039": "'", nbsp: " " };
  return html.replace(/&(amp|lt|gt|quot|#39|#039|nbsp);/g, (_, name) => entities[name]);
}

// 이전 구현(div.textContent → div.innerHTML)의 텍스트 노드 직렬화 규칙.
function legacyTextNodeSerialize(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/ /g, "&nbsp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SAMPLES = [
  "홍길동",
  "a\"b'c<d>&e",
  "1\" data-x=\"y",
  "' onmouseover='alert(1)",
  "<img src=x onerror=alert(1)>",
  "&amp; already",
  "공백 포함",
  "줄바꿈\n두 줄",
  "😀 이모지",
];

const FALSY_EMPTY_COPIES = [
  ["assets/js/utils/html.js", "function escapeHtml("],
  ["assets/js/utils/error-handler.js", "function escapeHtml("],
];

const NULLISH_EMPTY_COPIES = [
  ["assets/js/pages/course-detail.js", "function escapeHtml("],
  ["assets/js/pages/courses.js", "function escapeHtml("],
  ["assets/js/pages/member-dashboard.js", "function escapeHtml("],
  ["assets/js/pages/student-dashboard/context.js", "function escapeHtml("],
  ["assets/js/pages/instructors.js", "function escapeFilterHtml("],
];

test("shared escapeHtml escapes quotes and works without a DOM", async () => {
  const { escapeHtml } = await import("../assets/js/utils/html.js");
  assert.equal(escapeHtml("a\"b'c<d>&e"), "a&quot;b&#39;c&lt;d&gt;&amp;e");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml(0), "");
  assert.equal(escapeHtml(12), "12");
  assert.equal(escapeHtml(["a", "b"]), "a,b");
});

for (const [file, signature] of [...FALSY_EMPTY_COPIES, ...NULLISH_EMPTY_COPIES]) {
  test(`${file} ${signature.slice(9, -1)} cannot break out of quoted attributes and keeps text identical`, () => {
    const escape = extractFunction(file, signature);
    for (const sample of SAMPLES) {
      const escaped = escape(sample);
      assert.doesNotMatch(escaped, /["'<>]/, `${file}: raw special character left in ${JSON.stringify(sample)}`);
      assert.equal(decodeHtmlText(escaped), sample, `${file}: text changed for ${JSON.stringify(sample)}`);
      assert.equal(decodeHtmlText(escaped), decodeHtmlText(legacyTextNodeSerialize(sample)));
    }
  });
}

for (const [file, signature] of FALSY_EMPTY_COPIES) {
  test(`${file} keeps the falsy-to-empty contract`, () => {
    const escape = extractFunction(file, signature);
    for (const value of [null, undefined, "", 0, false]) assert.equal(escape(value), "");
    assert.equal(escape(7), "7");
  });
}

for (const [file, signature] of NULLISH_EMPTY_COPIES) {
  test(`${file} keeps the nullish-to-empty contract`, () => {
    const escape = extractFunction(file, signature);
    assert.equal(escape(null), "");
    assert.equal(escape(undefined), "");
    assert.equal(escape(0), "0");
    assert.equal(escape(""), "");
  });
}

test("existing post-escape quote replacement stays harmless", async () => {
  const { escapeHtml } = await import("../assets/js/utils/html.js");
  const value = "주차 \"1\" & 'A'";
  const attribute = escapeHtml(value).replace(/"/g, "&quot;");
  assert.equal(attribute, escapeHtml(value));
  assert.equal(decodeHtmlText(attribute), value);
});
