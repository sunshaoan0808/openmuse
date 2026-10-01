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
  assert.equal(await published.text(), "公开内容：西安 120 东京 86", "内容要逐字节一致");
  assert.equal(published.headers.get("cache-control"), "no-store");
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
