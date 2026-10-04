import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPrivateHost,
  linkHost,
  metaFromHtml,
  previewableUrl,
} from "../packages/domain/src/link-preview.ts";

/**
 * 链接预览（对标 Muse 的 `HatchLinkPreviewKt$findPreviewableUrlRanges`）。
 * 这里钉两件容易出人命的事：**中文句读不该被吃进链接**、**内网地址必须被拦**。
 */

test("从正文里认出第一条链接，并剥掉尾部标点", () => {
  assert.equal(previewableUrl("看这个 https://example.com/a?b=1。"), "https://example.com/a?b=1");
  assert.equal(previewableUrl("（见 https://example.com/x）"), "https://example.com/x");
  assert.equal(previewableUrl("https://example.com/a),"), "https://example.com/a");
  assert.equal(previewableUrl("没有链接"), undefined);
  assert.equal(previewableUrl("ftp://example.com/a"), undefined, "只认 http/https");
  assert.equal(previewableUrl(""), undefined);
});

test("主机名去掉 www.", () => {
  assert.equal(linkHost("https://www.example.com/a/b"), "example.com");
  assert.equal(linkHost("https://news.ycombinator.com/item?id=1"), "news.ycombinator.com");
  assert.equal(linkHost("不是链接"), "");
});

test("内网 / 本机地址一律拒绝（这个端点等于 SSRF 跳板）", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.0.6",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // 云元数据服务
    "100.64.0.1", // CGNAT
    "::1",
    "fd00::1",
    "box.local",
  ])
    assert.equal(isPrivateHost(host), true, `${host} 必须被拦`);
  for (const host of ["example.com", "news.ycombinator.com", "172.32.0.1", "8.8.8.8"])
    assert.equal(isPrivateHost(host), false, `${host} 应该放行`);
});

test("从 HTML 抽标题与描述：og 优先，实体要还原，永不执行脚本", () => {
  const html = `<!doctype html><html><head>
    <title>兜底标题</title>
    <meta property="og:title" content="真标题 &amp; 副标题">
    <meta property="og:description" content="一句话描述
      跨了行">
    <script>alert(1)</script>
  </head><body>正文不该被当成描述</body></html>`;
  const meta = metaFromHtml(html);
  assert.equal(meta.title, "真标题 & 副标题");
  assert.equal(meta.description, "一句话描述 跨了行");
  assert.ok(!`${meta.title}${meta.description}`.includes("alert"), "脚本内容不能进结果");
});

test("缺少 og 标签时退回 <title>，啥都没有就返回空", () => {
  assert.equal(metaFromHtml("<title>只有标题</title>").title, "只有标题");
  assert.equal(metaFromHtml("<html></html>").title, undefined);
  assert.equal(metaFromHtml("<meta name='description' content='描述'>").description, "描述");
});
