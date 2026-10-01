import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { Artifact } from "../packages/domain/src/index.ts";

let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-publish-"));
  db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-key",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  ({ app } = await createApp(db, config));
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = ((await session.json()) as { token: string }).token;
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const authed = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
/** 上传是 multipart：**不能**带 application/json（否则服务端按 JSON 解析直接 400） */
const uploadHeaders = () => ({ Authorization: `Bearer ${token}` });

async function upload(name: string, text: string) {
  const form = new FormData();
  form.set("file", new File([text], name, { type: "text/plain" }));
  const response = await app.request("/api/files", {
    method: "POST",
    body: form,
    headers: uploadHeaders(),
  });
  assert.equal(response.status, 201, "上传应该成功");
  return (await response.json()) as Artifact;
}

/** token 在链接里，取出来给公开请求用 */
const tokenOf = (url: string) => url.split("/p/")[1] ?? "";

test("发布：拿到一条公开链接，文件载荷里有 published 但没有 token", async () => {
  const file = await upload("发布测试.txt", "公开内容：西安 120 东京 86");
  const response = await app.request(`/api/files/${file.id}/publish`, {
    method: "POST",
    headers: authed(),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { url: string; file: Artifact };
  assert.match(
    body.url,
    /^http:\/\/localhost:8787\/p\/[\w-]{16,}$/,
    "链接应该是公网地址 + /p/ + token",
  );
  assert.equal(body.file.published, true);
  assert.equal(
    (body.file as unknown as Record<string, unknown>).publishToken,
    undefined,
    "token 不能跟着文件载荷漂",
  );
  // 公开取回：**不带任何令牌**
  const published = await app.request(`/p/${tokenOf(body.url)}`);
  assert.equal(published.status, 200, "公开链接必须不需要令牌就能打开");
  assert.match(published.headers.get("content-type") ?? "", /text\/html/, "文本文件按文档页面渲染");
  assert.match(await published.text(), /公开内容：西安 120 东京 86/, "内容要在页面里");
  assert.equal(published.headers.get("cache-control"), "no-store");
  // /raw 才是原始字节（下载/直链用）
  const rawResponse = await app.request(`/p/${tokenOf(body.url)}/raw`);
  assert.equal(await rawResponse.text(), "公开内容：西安 120 东京 86", "raw 要逐字节一致");
});

test("重复发布返回同一条链接（幂等），不会把已经分享出去的链接弄丢", async () => {
  const file = await upload("幂等.txt", "abc");
  const first = (await (
    await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() })
  ).json()) as { url: string };
  const second = (await (
    await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() })
  ).json()) as { url: string };
  assert.equal(first.url, second.url);
});

test("停止发布：同一个 token 立刻 404（真撤销，不是标记失效）", async () => {
  const file = await upload("撤销.txt", "bye");
  const { url } = (await (
    await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() })
  ).json()) as { url: string };
  const pub = tokenOf(url);
  assert.equal((await app.request(`/p/${pub}`)).status, 200);

  const stopped = await app.request(`/api/files/${file.id}/publish`, {
    method: "DELETE",
    headers: authed(),
  });
  assert.equal(stopped.status, 200);
  assert.equal(((await stopped.json()) as Artifact).published, false);

  const after = await app.request(`/p/${pub}`);
  assert.equal(after.status, 404, "撤销后同一个 token 必须立刻失效");
  // 撤销后重新发布：给一条**新的**链接（旧的不会复活）
  const again = (await (
    await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() })
  ).json()) as { url: string };
  assert.notEqual(tokenOf(again.url), pub);
  assert.equal((await app.request(`/p/${pub}`)).status, 404, "旧链接不会因为重新发布而复活");
});

test("乱猜或过短的 token 一律 404；公开入口不可写", async () => {
  assert.equal((await app.request("/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status, 404);
  assert.equal((await app.request("/p/short")).status, 404);
  assert.equal((await app.request("/p/short", { method: "POST" })).status, 404);
});

test("列表只暴露 published 布尔，不带 token", async () => {
  const file = await upload("列表.txt", "list");
  await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() });
  const workspace = await app.request("/api/workspace", { headers: authed() });
  const files = ((await workspace.json()) as { files: Artifact[] }).files;
  const found = files.find((entry) => entry.id === file.id);
  assert.equal(found?.published, true);
  assert.equal(
    files.some((entry) => (entry as unknown as Record<string, unknown>).publishToken !== undefined),
    false,
    "整份工作区快照里都不该出现 token",
  );
});

test("发布 Markdown：/p/ 渲染成网页，/p/raw 仍给原文", async () => {
  const file = await upload("月报.md", "# 标题\n\n正文有 **粗体** 和 `代码`。");
  const { url } = (await (
    await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() })
  ).json()) as { url: string };
  const pub = tokenOf(url);

  const page = await app.request(`/p/${pub}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.match(html, /<h1>标题<\/h1>/, "markdown 要渲染成标题");
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.ok(!html.includes("<strong>粗体</strong>\n"), "不该是把 markdown 原样塞进 pre");

  const raw = await app.request(`/p/${pub}/raw`);
  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), "# 标题\n\n正文有 **粗体** 和 `代码`。", "raw 必须是原文");
});

test("发布图片：/p/ 直接给字节（不是网页）", async () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwABAAH+GXcAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const form = new FormData();
  form.set("file", new File([png as BlobPart], "像素.png", { type: "image/png" }));
  const uploaded = await app.request("/api/files", {
    method: "POST",
    body: form,
    headers: uploadHeaders(),
  });
  assert.equal(uploaded.status, 201);
  const file = (await uploaded.json()) as Artifact;
  const { url } = (await (
    await app.request(`/api/files/${file.id}/publish`, { method: "POST", headers: authed() })
  ).json()) as { url: string };
  const response = await app.request(`/p/${tokenOf(url)}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png, "字节要一模一样");
});

test("导出 HTML：不依赖浏览器 worker，直接产出可打开的网页文件", async () => {
  const file = await upload("导出源.md", "## 小标题\n\n- 一\n- 二");
  const response = await app.request(`/api/files/${file.id}/export`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ format: "html" }),
  });
  assert.equal(response.status, 201);
  const exported = (await response.json()) as Artifact;
  assert.equal(exported.name, "导出源.html");
  assert.equal(exported.mimeType, "text/html", "扩展名与类型要认出是网页");
  const content = await app.request(`/api/files/${exported.id}/content`, { headers: authed() });
  const html = await content.text();
  assert.match(html, /<h2>小标题<\/h2>/);
  assert.match(html, /<li>一<\/li>/);
  assert.match(html, /<meta charset="utf-8" \/>/);
});
