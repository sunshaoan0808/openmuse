import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const details = readFileSync(join(import.meta.dirname, "..", "src", "details.tsx"), "utf8");
// 文件判定与分享映射在 P1-9 抽到了 file-actions.ts（对话文件卡菜单与详情页共用同一份），
// 这些断言跟着代码走：函数定义与映射钉 file-actions.ts，渲染分支顺序仍钉 details.tsx。
const actions = readFileSync(join(import.meta.dirname, "..", "src", "file-actions.ts"), "utf8");
/** 断言前先剥注释：文件里写着"以前掉进 Office 渲染器"之类的说明，注释会误导匹配 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * 用户报过"图片不能预览"：文件面板原来只有 PDF / 文本 / 其它→Office 三条路，
 * 图片（服务端一直认得 png/jpg/webp/gif）掉进 Office 渲染器 ⇒ 等于不能预览。
 * 这组测试钉住：图片必须自己有一条分支，且在 Office 兜底**之前**。
 */
test("图片有独立的预览分支，且排在 Office 兜底之前", () => {
  const body = strip(details);
  const image = body.indexOf("isImage(f) ? (");
  assert.ok(image > 0, "预览区里应该有 isImage(f) 的分支");
  const office = body.indexOf("<OfficeReader");
  assert.ok(office > 0, "应该还有 Office 兜底");
  assert.ok(image < office, "图片分支必须在 Office 兜底之前，否则图片又会被丢给 Office 渲染器");
});

test("图片用 Image + Authorization 头取图（与 PdfReader 同一套鉴权）", () => {
  const body = strip(details);
  const start = body.indexOf("isImage(f) ? (");
  const branch = body.slice(start, start + 900);
  assert.match(branch, /<Image/, "图片分支里应该用 Image 组件");
  assert.match(branch, /Authorization: `Bearer \$\{api\.token\}`/, "取图必须带令牌");
  assert.match(branch, /resizeMode="contain"/, "图片应该按 contain 缩放，不裁切");
});

test("图片不会被当成 PDF/文本处理，也不会显示“N pages”", () => {
  const defined = strip(actions);
  assert.match(defined, /function isImageFile/, "应该定义了 isImage（file-actions，两处共用）");
  // 副标题里图片不该显示页数（仍在详情页的渲染分支里）
  assert.match(
    strip(details),
    /isText\(f\) \|\| isImage\(f\)[\s\S]{0,40}\? "" : `\$\{f\.pageCount\} pages/,
    "副标题里图片不该显示页数",
  );
  // 分享时要跟着图片的真实格式走，不能再一律 .pdf（映射在 file-actions，两个调用方共用）
  assert.match(
    defined,
    /if \(isImageFile\(file\)\) return imageExtensionFor\(file\)/,
    "分享的扩展名要走 imageExtension",
  );
  assert.match(defined, /"public\.image"/, "分享的 UTI 要区分图片");
});

test("文本型不再只有 md/txt：csv / json / 源码也进文本预览，且只有 markdown 走富文本", () => {
  assert.match(strip(actions), /csv/, "isText 应认识 csv");
  assert.match(
    strip(actions),
    /function isMarkdownFile/,
    "应该区分 markdown 与其它文本（file-actions，两处共用）",
  );
  const body = strip(details);
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

test("音视频有独立分支（排在 Office 之前），交给 MediaPlayer 播", () => {
  const defined = strip(actions);
  assert.match(defined, /function isMediaFile/, "应该定义了 isMedia（file-actions，两处共用）");
  const body = strip(details);
  const media = body.indexOf("isMedia(f) ? (");
  const office = body.indexOf("<OfficeReader");
  assert.ok(media > 0, "预览区里应该有 isMedia(f) 的分支");
  assert.ok(media < office, "音视频分支必须排在 Office 兜底之前");
  assert.match(body, /<MediaPlayer url=\{url\}/, "音视频应交给 MediaPlayer");
  // 分享也要跟着媒体走：扩展名、MIME、UTI 都不能再落到 pdf（映射在 file-actions）
  assert.match(
    defined,
    /if \(isMediaFile\(file\)\) return mediaExtensionFor\(file\)/,
    "分享扩展名要走 mediaExtension",
  );
  assert.match(defined, /"public\.movie"|"public\.audio"/, "分享 UTI 要区分音视频");
  // 副标题不该给音视频显示页数
  assert.match(body, /isText\(f\) \|\| isImage\(f\) \|\| isMedia\(f\) \? ""/, "音视频不该显示页数");
});

/**
 * 用户报过「文件点开后，整个页面在滑，md 的内容不滑」：文档被套在一层
 * `maxHeight: 460` 的内层 ScrollView 里，与外层面板的 ScrollView 形成**嵌套滚动**，
 * 真机上外层抢走竖向手势 → 盒子被裁在 460，以下内容够不到。
 * 这组测试钉住修法：正文不再自建滚动层（全面板只有一个滚动容器）。
 */
test("文本/文档预览不再自建内层滚动盒（避免嵌套滚动导致滑不动）", () => {
  const body = strip(details);
  assert.doesNotMatch(body, /maxHeight:\s*460/, "预览里不该再有 maxHeight:460 的内层盒子");
  assert.doesNotMatch(body, /<ScrollView/, "预览正文不该再套 ScrollView（滚动交给面板自己）");
  // 文档仍要走 markdown 渲染，别把内容丢了
  assert.match(body, /isMarkdown\(f\) \? \(/, "markdown 分支必须还在");
  assert.match(body, /<AssistantResponse/, "markdown 仍交给 AssistantResponse 渲染");
});

/**
 * 面板正文自己就是滚动容器，而 PDF/HTML/Office/音视频是自滚动子视图
 * （react-native-pdf / WebView）。必须开嵌套滚动协商，否则外层会抢手势。
 */
test("详情面板正文开启嵌套滚动，让自滚动子视图先吃手势", () => {
  const sheet = strip(readFileSync(join(import.meta.dirname, "..", "src", "ui.tsx"), "utf8"));
  assert.match(sheet, /nestedScrollEnabled/, "Sheet 正文的 ScrollView 应开启 nestedScrollEnabled");
  for (const viewer of [
    "HtmlReader.native.tsx",
    "OfficeReader.native.tsx",
    "MediaPlayer.native.tsx",
    "BrowserConsole.native.tsx",
  ]) {
    const src = strip(readFileSync(join(import.meta.dirname, "..", "src", viewer), "utf8"));
    assert.match(src, /<WebView[\s\S]*?nestedScrollEnabled/, `${viewer} 的 WebView 应开启 nestedScrollEnabled`);
  }
});
