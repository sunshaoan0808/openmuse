import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { type StoredCredential, taskSecrets } from "../apps/server/src/credentials.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { AgentService } from "../apps/server/src/engine/service.ts";

let db: Store, agent: AgentService, directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-taskcred-"));
  db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-intelligence",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  ({ agent } = await createApp(db, config));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("派任务时带上 credentials：服务端铸好、只把 id 记进 state、绑定到这个任务", async () => {
  const task = await agent.createTask("local-user", {
    title: "带凭据的任务",
    prompt: "用中文回答：一加一等于几？只回数字。",
    credentials: [{ label: "临时 git", kind: "git", scopes: ["repo:write"], ttlMs: 600_000 }],
  });
  const ids = (task.state as { credentialIds?: string[] }).credentialIds ?? [];
  assert.equal(ids.length, 1, "应该铸了一把并把 id 放进 state");

  const record = await db.get<StoredCredential>("local-user", "credentials", ids[0]);
  assert.ok(record, "库里应该有这条凭据");
  assert.equal(record?.taskId, task.id, "必须绑定到这个任务（终态才会被吊销）");
  assert.equal(typeof record?.secret, "string");
  assert.ok((record?.secret ?? "").length > 20, "明文在库里（工具要用）");
  // state 里只放 id —— 明文绝不进 state
  assert.equal(
    JSON.stringify(task.state).includes(record?.secret ?? "x"),
    false,
    "state 里不能有明文",
  );
});

test("工具侧的 secrets 访问器：能取到明文，redact 能把明文换成后 6 位", async () => {
  const task = await agent.createTask("local-user", {
    title: "redact 检查",
    prompt: "随便",
    credentials: [{ label: "临时 api", kind: "api" }],
  });
  const secrets = await taskSecrets(db, "local-user", task);
  assert.equal(secrets.ids.length, 1);
  const secret = await secrets.get(secrets.ids[0]);
  assert.ok(secret.length > 20);
  assert.equal(secrets.has(secrets.ids[0]), true);

  // 脱敏护栏：日志/事件里带上明文，过一遍 redact 就必须只剩后 6 位
  const logLine = `[tool] 调用外部接口 Authorization: Bearer ${secret} → 200`;
  const safe = secrets.redact(logLine);
  assert.equal(safe.includes(secret), false, "明文不该出现在日志里");
  assert.match(safe, new RegExp(`…${secret.slice(-6)}`), "应该换成后 6 位");
});

test("吊销是**真销毁**：落库的明文被擦掉，但后 6 位仍可展示；取明文给可续接的提示", async () => {
  const task = await agent.createTask("local-user", {
    title: "销毁检查",
    prompt: "随便",
    credentials: [{ label: "临时 ssh", kind: "ssh" }],
  });
  const id = (task.state as { credentialIds: string[] }).credentialIds[0];
  const before = await db.get<StoredCredential>("local-user", "credentials", id);
  const tail = before?.secretTail ?? "";
  assert.ok(tail.startsWith("…"), "后 6 位单独存着");

  await agent.revokeCredential("local-user", id, "manual");
  const afterRevoke = await db.get<StoredCredential>("local-user", "credentials", id);
  assert.equal(afterRevoke?.secret, "", "吊销后库里的明文必须被擦掉");
  assert.equal(afterRevoke?.secretTail, tail, "后 6 位保留下来供展示");
  // 契约说明：脱敏靠的是**当时还存在的明文**。库里擦掉之后谁也拿不到它了 ——
  // 所以正确用法是"用的时候顺手 redact"（那时明文还在，测试 2 覆盖）；这里断言取明文被拒。
  const secrets = await taskSecrets(db, "local-user", task);
  await assert.rejects(() => secrets.get(id), /已被吊销/);
  assert.equal(secrets.has(id), true, "id 仍留在任务的凭据清单里（便于界面显示「已销毁」）");
  assert.equal(before?.secretTail, afterRevoke?.secretTail, "展示用的后 6 位不受影响");
});
