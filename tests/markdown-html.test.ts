import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownToHtml, wrapHtmlDocument } from "../apps/server/src/markdown-html.ts";

test("常见 Markdown 语法都能转成 HTML", () => {
  const html = markdownToHtml(
    [
      "# 标题",
      "",
      "正文有 **粗体**、*斜体* 和 `代码`，还有[链接](https://example.com)。",
      "",
      "- 第一项",
      "- 第二项",
      "",
      "1. 有序一",
      "2. 有序二",
      "",
      "> 引用一行",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "| 城市 | 销量 |",
      "| --- | --- |",
      "| 西安 | 120 |",
    ].join("\n"),
  );
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com">链接<\/a>/);
  assert.match(html, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
  assert.match(html, /<ol><li>有序一<\/li><li>有序二<\/li><\/ol>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code class="language-ts">const a = 1;<\/code><\/pre>/);
  assert.match(html, /<th>城市<\/th>/);
  assert.match(html, /<td>西安<\/td>/);
});

test("内容里的 HTML 必须是纯文本（导出前不让它变成可执行结构）", () => {
  const html = markdownToHtml('# <script>alert("x")</script> 标题\n\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes("<script"), "尖括号不能被当成 HTML");
  assert.ok(!html.includes("<img src=x"), "图片标签也必须转义");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("行内代码里的星号不会被当成强调符号", () => {
  const html = markdownToHtml("用 `a * b` 表示乘号，不是 *斜体*");
  assert.match(html, /<code>a \* b<\/code>/);
  assert.match(html, /<em>斜体<\/em>/);
});

test("包出来的文档带标题与字符集（中文不乱码）", () => {
  const document = wrapHtmlDocument("月报.md", "<p>正文</p>");
  assert.match(document, /^<!doctype html>/);
  assert.match(document, /<meta charset="utf-8" \/>/);
  assert.match(document, /<title>月报\.md<\/title>/);
  assert.match(document, /<p>正文<\/p><\/body>/);
});

test("文档带分享元数据，且元数据里同样转义（双引号不能逃出属性）", () => {
  const document = wrapHtmlDocument('月报 "引号" .md', "<p>正文</p>", '摘要里有 "引号" 和 <标签>');
  assert.match(document, /<meta property="og:title" content="月报 &quot;引号&quot; \.md" \/>/);
  assert.match(
    document,
    /<meta property="og:description" content="摘要里有 &quot;引号&quot; 和 &lt;标签&gt;" \/>/,
  );
  assert.match(document, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/);
  assert.ok(
    !/content="[^"]*"[^>]*"/.test(document.split("<style>")[0].replace(/<meta[^>]*>/g, "")),
    "不该有多余引号逃逸",
  );
  // 不传摘要时不产生空的 og:description
  assert.ok(!wrapHtmlDocument("x.md", "<p>y</p>").includes("og:description"));
});
