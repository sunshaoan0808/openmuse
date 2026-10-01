import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const code = readFileSync(join(import.meta.dirname, "..", "src", "details.tsx"), "utf8");
/** 断言前先剥注释：文件里写着"以前掉进 Office 渲染器"之类的说明，注释会误导匹配 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * 用户报过"图片不能预览"：文件面板原来只有 PDF / 文本 / 其它→Office 三条路，
 * 图片（服务端一直认得 png/jpg/webp/gif）掉进 Office 渲染器 ⇒ 等于不能预览。
 * 这组测试钉住：图片必须自己有一条分支，且在 Office 兜底**之前**。
 */
test("图片有独立的预览分支，且排在 Office 兜底之前", () => {
  const body = strip(code);
  const image = body.indexOf("isImage(f) ? (");
  assert.ok(image > 0, "预览区里应该有 isImage(f) 的分支");
  const office = body.indexOf("<OfficeReader");
  assert.ok(office > 0, "应该还有 Office 兜底");
  assert.ok(image < office, "图片分支必须在 Office 兜底之前，否则图片又会被丢给 Office 渲染器");
});

test("图片用 Image + Authorization 头取图（与 PdfReader 同一套鉴权）", () => {
  const body = strip(code);
  const start = body.indexOf("isImage(f) ? (");
  const branch = body.slice(start, start + 900);
  assert.match(branch, /<Image/, "图片分支里应该用 Image 组件");
  assert.match(branch, /Authorization: `Bearer \$\{api\.token\}`/, "取图必须带令牌");
  assert.match(branch, /resizeMode="contain"/, "图片应该按 contain 缩放，不裁切");
});

test("图片不会被当成 PDF/文本处理，也不会显示“N pages”", () => {
  const body = strip(code);
  assert.match(body, /function isImage/, "应该定义了 isImage");
  assert.match(
    body,
    /isText\(f\) \|\| isImage\(f\) \? "" : `\$\{f\.pageCount\} pages/,
    "副标题里图片不该显示页数",
  );
  // 分享时要跟着图片的真实格式走，不能再一律 .pdf
  assert.match(
    body,
    /isImage\(f\)\s*\n?\s*\?\s*imageExtension\(f\)/,
    "分享的扩展名要走 imageExtension",
  );
  assert.match(body, /UTI: isImage\(f\)/, "分享的 UTI 要区分图片");
});

test("文本型不再只有 md/txt：csv / json / 源码也进文本预览，且只有 markdown 走富文本", () => {
  const body = strip(code);
  assert.match(body, /csv/, "isText 应认识 csv");
  assert.match(body, /function isMarkdown/, "应该区分 markdown 与其它文本");
  const markdown = body.indexOf("isMarkdown(f) ? (");
  const plain = body.indexOf("{content}", markdown);
  const office = body.indexOf("<OfficeReader");
  assert.ok(
    markdown > 0 && plain > markdown && office > plain,
    "分支顺序应为 markdown → 纯文本 → 图片 → Office",
  );
  assert.match(
    body.slice(markdown, office),
    /monospace/,
    "非 markdown 文本要用等宽字体渲染，否则 csv 的表格与代码缩进会被吃掉",
  );
});
