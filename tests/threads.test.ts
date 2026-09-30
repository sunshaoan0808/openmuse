import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { mergeThread, type SavedThread, titleFromMessages } from "../apps/server/src/threads.ts";

let db: Store, app: Awaited<ReturnType<typeof createApp>>["app"], token: string, directory: string;
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const listThreads = async (): Promise<SavedThread[]> =>
  (await (await app.request("/api/threads", { headers: headers() })).json()).threads;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-threads-"));
  db = await createStore();
  // 不带 intelligenceApiKey：走本地会话模式（App 里也会因此拿到 richThreads=false）
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  ({ app } = await createApp(db, config));
  token = (
    await (
      await app.request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json()
  ).token;
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("会话列表自带主会话，且能力上报不再谎称云富线程", async () => {
  const workspace = await (await app.request("/api/workspace", { headers: headers() })).json();
  assert.equal(workspace.runtime.richThreads, false, "没有 Intelligence 就不能说支持云富线程");
  assert.equal(workspace.runtime.savedThreads, true, "本地已保存会话应当是开着的");
  const threads = await listThreads();
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, "local-main");
  assert.equal(threads[0].name, "新会话");
});

test("新建会话：改名、归档、恢复、删除都落在自己库里", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const renamed = await app.request(`/api/threads/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ name: "东京行程" }),
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).thread.name, "东京行程");

  await app.request(`/api/threads/${id}/archive`, { method: "POST", headers: headers() });
  let saved = (await listThreads()).find((thread) => thread.id === id);
  assert.equal(saved?.archived, true);

  await app.request(`/api/threads/${id}/unarchive`, { method: "POST", headers: headers() });
  saved = (await listThreads()).find((thread) => thread.id === id);
  assert.equal(saved?.archived, false);

  const removed = await app.request(`/api/threads/${id}`, { method: "DELETE", headers: headers() });
  assert.equal(removed.status, 200);
  assert.equal(
    (await listThreads()).some((thread) => thread.id === id),
    false,
  );
});

test("主会话不允许删除", async () => {
  const response = await app.request("/api/threads/local-main", {
    method: "DELETE",
    headers: headers(),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /主会话/);
});

test("每条会话各存各的历史，主会话沿用老记录不丢历史", async () => {
  const side = "99999999-8888-4777-8666-555555555555";
  const message = {
    id: "m-1",
    role: "user",
    content: "帮我看一下水族馆的票",
  };
  await app.request(`/api/conversation?threadId=${side}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ messages: [message] }),
  });
  const sideHistory = await (
    await app.request(`/api/conversation?threadId=${side}`, { headers: headers() })
  ).json();
  assert.equal(sideHistory.messages.length, 1);
  assert.equal(sideHistory.messages[0].content, "帮我看一下水族馆的票");
  // 会话名自动来自第一条用户消息
  const saved = (await listThreads()).find((thread) => thread.id === side);
  assert.equal(saved?.name, "帮我看一下水族馆的票");
  assert.equal(saved?.messageCount, 1);

  // 另一条会话读到的必须是空的
  const other = await (
    await app.request("/api/conversation?threadId=other-thread", { headers: headers() })
  ).json();
  assert.deepEqual(other.messages, []);

  // 不带 threadId（老 App 行为）与主会话是同一条记录
  await app.request("/api/conversation", {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ messages: [{ id: "m-2", role: "user", content: "主线消息" }] }),
  });
  const main = await (
    await app.request("/api/conversation?threadId=local-main", { headers: headers() })
  ).json();
  assert.equal(main.messages[0].content, "主线消息");
});

test("改名不会被自动标题覆盖，未命名才会自动起名", () => {
  const now = "2026-09-30T00:00:00.000Z";
  const named = mergeThread(
    {
      id: "t",
      name: "我的会话",
      archived: false,
      agentId: "default",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    },
    "t",
    { now, autoTitle: "别覆盖我" },
  );
  assert.equal(named.name, "我的会话");
  const fresh = mergeThread(undefined, "t2", { now, autoTitle: "东京行程" });
  assert.equal(fresh.name, "东京行程");
  assert.equal(fresh.archived, false);
  assert.equal(fresh.messageCount, 0);
});

test("标题从第一条用户文本里取，压平空白并截断", () => {
  assert.equal(
    titleFromMessages([
      { role: "assistant", content: "你好" },
      { role: "user", content: [{ text: "  周末去  东京  " }] },
    ]),
    "周末去 东京",
  );
  assert.equal(titleFromMessages("不是数组"), undefined);
  const long = titleFromMessages([{ role: "user", content: "东".repeat(80) }], 10);
  assert.equal(long?.length, 11);
  assert.ok(long?.endsWith("…"));
});
