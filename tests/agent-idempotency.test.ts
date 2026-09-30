import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

/**
 * 派活必须能安全重试：手机网络抖动时 App 会重发同一个请求（带同一个 Idempotency-Key），
 * 服务端只能产生一个任务——否则用户会看到两个一模一样的任务。
 */
let app: Awaited<ReturnType<typeof createApp>>["app"];
let db: Store;
let token = "";
let directory = "";
const headers = (extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  ...extra,
});

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-idem-"));
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
  ({ app } = await createApp(db, config));
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = ((await response.json()) as { token: string }).token;
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("同一 Idempotency-Key 的派活只创建一个任务", async () => {
  const body = JSON.stringify({
    title: "幂等测试",
    prompt: "用中文一句话说明：一加一为什么等于二。",
  });
  const key = { "Idempotency-Key": "test-key-1" };
  const first = await app.request("/api/agent/tasks", {
    method: "POST",
    headers: headers(key),
    body,
  });
  const second = await app.request("/api/agent/tasks", {
    method: "POST",
    headers: headers(key),
    body,
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const one = (await first.json()) as { id: string };
  const two = (await second.json()) as { id: string };
  assert.equal(one.id, two.id, "同一个 key 必须返回同一个任务");
});

test("没有幂等键时每次都是新任务（默认行为不变）", async () => {
  const body = JSON.stringify({
    title: "无键测试",
    prompt: "用中文一句话说明：二加二为什么等于四。",
  });
  const first = await app.request("/api/agent/tasks", { method: "POST", headers: headers(), body });
  const second = await app.request("/api/agent/tasks", {
    method: "POST",
    headers: headers(),
    body,
  });
  const one = (await first.json()) as { id: string };
  const two = (await second.json()) as { id: string };
  assert.notEqual(one.id, two.id);
});
