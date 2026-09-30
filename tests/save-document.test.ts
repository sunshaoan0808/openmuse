import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

/**
 * 用户要"一份 MD 文件"，智能体只把内容打在聊天里 —— 根因有两条：
 *   1) 聊天的工具集里根本没有"写文件"的工具
 *   2) files 服务只放行 PDF 与图片（字节魔数嗅探），markdown 无处可存
 * 这条测试锁住修好之后的行为：文本能存成文件、出现在工作区文件列表里、内容可取回。
 */
let app: Awaited<ReturnType<typeof createApp>>["app"];
let agent: Awaited<ReturnType<typeof createApp>>["agent"];
let db: Store;
let token = "";
let directory = "";
const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-doc-"));
  db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-...nt",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  ({ app, agent } = await createApp(db, config));
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

test("markdown 文本能存成文件，并出现在工作区文件列表里", async () => {
  const file = await agent.files.importText(
    "local-user",
    "广元三天旅游攻略.md",
    "# 攻略\n\n第一天……",
    "Written by your agent",
  );
  assert.equal(file.mimeType, "text/markdown");
  assert.equal(file.name, "广元三天旅游攻略.md");
  assert.ok(file.url.includes("/api/files/"));
  const workspace = await app.request("/api/workspace", { headers: auth() });
  const body = (await workspace.json()) as { files: { id: string; name: string }[] };
  assert.ok(
    body.files.some((f) => f.id === file.id && f.name === "广元三天旅游攻略.md"),
    "新文件应出现在工作区 files 里",
  );
  const content = await app.request(`/api/files/${file.id}/content`, { headers: auth() });
  assert.equal(content.status, 200);
  assert.match(await content.text(), /第一天/);
});

test("没写扩展名时默认 .md；同名内容重复调用只产生一个文件（幂等）", async () => {
  const one = await agent.files.importText(
    "local-user",
    "报告",
    "内容",
    "Written by your agent",
    "same-key",
  );
  const two = await agent.files.importText(
    "local-user",
    "报告",
    "内容",
    "Written by your agent",
    "same-key",
  );
  assert.equal(one.name, "报告.md");
  assert.equal(one.id, two.id);
});
