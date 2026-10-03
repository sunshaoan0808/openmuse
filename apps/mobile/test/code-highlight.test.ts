import assert from "node:assert/strict";
import { test } from "node:test";
import { codeLanguageOf, highlightCode } from "../src/code-highlight.ts";

test("ts 代码切出关键字/字符串/注释", () => {
  const tokens = highlightCode('const a = "hi"; // note', "ts");
  assert.ok(tokens.some((t) => t.kind === "keyword" && t.text === "const"));
  assert.ok(tokens.some((t) => t.kind === "string" && t.text === '"hi"'));
  assert.ok(tokens.some((t) => t.kind === "comment" && t.text === "// note"));
});

test("round-trip：token 拼回原样恒等于输入（不上色也不能改坏代码）", () => {
  const samples = [
    'def f(x):\n    # 中文注释\n    return f"{x}!"',
    '{"a": 1, "b": [2.5, 0x1f]}',
    "SELECT id FROM t WHERE a > 10; -- 查询",
    "git commit -m 'feat: x' # done",
    "",
  ];
  for (const sample of samples) {
    for (const lang of ["ts", "py", "json", "sql", ""]) {
      const tokens = highlightCode(sample, lang);
      assert.equal(tokens.map((t) => t.text).join(""), sample, `lang=${lang} sample=${sample}`);
    }
  }
});

test("按语言家族判注释：CSS 的 #fff 不是注释，Python 的 # 是", () => {
  const css = highlightCode("color: #fff; /* reset */", "css");
  assert.ok(!css.some((t) => t.kind === "comment" && t.text.startsWith("#")));
  assert.ok(css.some((t) => t.kind === "comment" && t.text.startsWith("/*")));
  const py = highlightCode("x = '#fff'", "py");
  // 字符串里的 # 不是注释
  assert.ok(!py.some((t) => t.kind === "comment"));
  assert.ok(py.some((t) => t.kind === "string" && t.text === "'#fff'"));
});

test("SQL 的 -- 行注释与 JSON 无注释", () => {
  const sql = highlightCode("SELECT 1 --two", "sql");
  assert.ok(sql.some((t) => t.kind === "comment" && t.text === "--two"));
  const json = highlightCode('{"a": 1} // not a comment in json', "json");
  assert.ok(!json.some((t) => t.kind === "comment"));
});

test("跨行反引号模板串成段保留；未闭合行内引号到行尾为止", () => {
  const template = highlightCode("const s = `a\nb`;", "ts");
  assert.ok(template.some((t) => t.kind === "string" && t.text.includes("\n")));
  const unclosed = highlightCode('const s = "abc\ndef";', "ts");
  const joined = unclosed.map((t) => t.text).join("");
  assert.equal(joined, 'const s = "abc\ndef";');
});

test("语言标签取 fence 信息串的第一个词并小写", () => {
  assert.equal(codeLanguageOf("TypeScript title=x"), "typescript");
  assert.equal(codeLanguageOf("  TS  "), "ts");
  assert.equal(codeLanguageOf(""), "");
});
