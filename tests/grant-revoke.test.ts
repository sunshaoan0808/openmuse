/**
 * P2b §2.4：已授权限的**列表与撤销**（REST），以及 §2.3 的 410/404 分流。
 *
 * 会话令牌对应的 owner 是 `local-user`（与 P1b 的 `/approvals` 用例同一口径）。
 * 越权一律 403 / 删不到 —— 撤销接口绝不能变成"拿别人的 id 删别人的授权"。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { attachAuditStore } from "../apps/server/src/engine/audit-store.ts";
import {
  attachApprovalStore,
  getApprovalService,
  setApprovalRuntime,
} from "../apps/server/src/engine/approval-store.ts";
import { APPROVAL_TTL_MS, type GrantRecord } from "../apps/server/src/engine/approvals.ts";

const T0 = Date.parse("2026-03-01T08:00:00.000Z");
const INSTANCE = "p2b-rest-instance";
const OWNER = "local-user";

let clockNow = T0;
let restoreRuntime = () => {};
let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-grants-"));
  db = await createStore();
  attachAuditStore(db);
  assert.equal(attachApprovalStore(db), true);
  restoreRuntime = setApprovalRuntime({ instanceId: INSTANCE, now: () => clockNow });

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
  restoreRuntime();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

afterEach(() => {
  attachApprovalStore(db);
  clockNow = T0;
});

const authed = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const del = (path: string, headers: Record<string, string> = authed()) =>
  app.request(path, { method: "DELETE", headers });

/** 走完整的"登记 → 批准"路径造一条真实授权（与线上同一条链路）。 */
async function issueGrant(
  owner: string,
  tool: string,
  scope: "once" | "session" | "24h",
  targets: string[] = [],
): Promise<GrantRecord> {
  const service = getApprovalService();
  assert.ok(service);
  const record = await service.registerApproval({
    tool,
    owner,
    threadId: "t-rest",
    risk: "sensitive",
    reason: "需要你先批准这一次调用",
    args: {},
    targets,
  });
  assert.ok(record, "登记应当成功");
  const outcome = await service.approveChecked(owner, record.id, scope);
  assert.equal(outcome.ok, true, "批准应当成功");
  if (!outcome.ok) throw new Error("unreachable");
  return outcome.grant;
}

// ---------------------------------------------------------------------------
// §2.4 列表
// ---------------------------------------------------------------------------

test("§2.4 GET /api/grants：只列本 owner 的授权，且带 target / scope / expiresAt", async () => {
  clockNow = T0;
  const grant = await issueGrant(OWNER, "web_fetch", "24h", ["example.com"]);
  await issueGrant("p2b-other-owner", "web_fetch", "once", ["evil.example"]);

  const response = await app.request("/api/grants", { headers: authed() });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { grants: GrantRecord[] };
  assert.ok(body.grants.some((row) => row.id === grant.id), "本人的授权应当在列表里");
  assert.ok(
    body.grants.every((row) => row.owner === OWNER),
    "列表必须只含本人的授权（不许串号）",
  );
  const mine = body.grants.find((row) => row.id === grant.id);
  assert.equal(mine?.target, "example.com", "列表要带 target —— 用户才知道这条限定在哪");
  assert.equal(mine?.scope, "24h");
  assert.ok(mine?.expiresAt, "24h 授权要带过期时刻");
});

test("§2.4 GET /api/grants?owner=别人 → 403；写自己 → 200（同一套取数口径）", async () => {
  assert.equal((await app.request("/api/grants?owner=p2b-other-owner", { headers: authed() })).status, 403);
  assert.equal((await app.request(`/api/grants?owner=${OWNER}`, { headers: authed() })).status, 200);
});

test("§2.4 裸路径 /grants 与 /api/grants 行为一致", async () => {
  const viaApi = (await (await app.request("/api/grants", { headers: authed() })).json()) as {
    grants: GrantRecord[];
  };
  const viaBare = (await (await app.request("/grants", { headers: authed() })).json()) as {
    grants: GrantRecord[];
  };
  assert.deepEqual(
    viaBare.grants.map((row) => row.id),
    viaApi.grants.map((row) => row.id),
  );
});

// ---------------------------------------------------------------------------
// §2.4 撤销
// ---------------------------------------------------------------------------

test("§2.4 DELETE /api/grants/:id：撤销后这条授权**真的不再命中**", async () => {
  clockNow = T0;
  const service = getApprovalService();
  assert.ok(service);
  const grant = await issueGrant(OWNER, "send_mail", "session");
  assert.ok(
    await service.acquireGrant({ owner: OWNER, tool: "send_mail", threadId: "t-rest" }),
    "撤销前应当命中",
  );

  const response = await del(`/api/grants/${grant.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true, removed: true });

  assert.equal(
    await service.acquireGrant({ owner: OWNER, tool: "send_mail", threadId: "t-rest" }),
    null,
    "撤销之后不许再命中",
  );
});

test("§2.4 撤销是幂等的：删第二次仍 200，但 removed=false", async () => {
  clockNow = T0;
  const grant = await issueGrant(OWNER, "git_push", "once");
  assert.deepEqual(await (await del(`/api/grants/${grant.id}`)).json(), { revoked: true, removed: true });
  const second = await del(`/api/grants/${grant.id}`);
  assert.equal(second.status, 200, "幂等：第二次也算成功（调用方只想知道它不再生效）");
  assert.deepEqual(await second.json(), { revoked: true, removed: false });
});

test("§2.4 别人的授权删不掉，而且那条授权**还在**（撤销不许变成越权后门）", async () => {
  clockNow = T0;
  const foreign = await issueGrant("p2b-other-owner", "git_push", "session");
  const response = await del(`/api/grants/${foreign.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true, removed: false }, "删不到就是没删到");

  const rows = await db.listGrants("p2b-other-owner", "git_push", 50);
  assert.ok(
    rows.some((row) => row.id === foreign.id),
    "别人的授权必须原样还在",
  );
});

test("§2.4 不存在的 id：200 + removed=false（幂等，不报错）", async () => {
  const response = await del("/api/grants/根本不存在的-id");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true, removed: false });
});

test("§2.4 没令牌一律 401（列表与撤销都要鉴权，裸路径也不例外）", async () => {
  assert.equal((await app.request("/grants")).status, 401);
  assert.equal((await app.request("/api/grants")).status, 401);
  assert.equal((await del("/grants/x", {})).status, 401);
  assert.equal((await del("/api/grants/x", {})).status, 401);
});

// ---------------------------------------------------------------------------
// §2.3 REST 侧：410 与 404 要分得开
// ---------------------------------------------------------------------------

test("§2.3 过期的待审批 → 410 Gone（与「找不到」的 404 分开）", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await service.registerApproval({
    tool: "send_payment",
    owner: OWNER,
    threadId: "t-rest",
    risk: "sensitive",
    reason: "该能力是敏感能力，需要你先批准这一次调用",
    args: {},
  });
  assert.ok(record);

  clockNow = T0 + APPROVAL_TTL_MS + 1;
  const response = await app.request(`/api/approvals/${record.id}/approve`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ scope: "once" }),
  });
  assert.equal(response.status, 410, "超时作废要回 410，客户端才知道该重新发起");
});

test("§2.3 不存在的审批仍然 404（既有语义不许被 410 抢走）", async () => {
  const response = await app.request("/api/approvals/根本没有这条/approve", {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ scope: "once" }),
  });
  assert.equal(response.status, 404);
});

test("§2.4 批准响应里带 downgraded，且授权真的落在库里（可被列表看到）", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await service.registerApproval({
    tool: "send_payment",
    owner: OWNER,
    threadId: "t-rest",
    risk: "sensitive",
    reason: "该能力是敏感能力，需要你先批准这一次调用",
    args: {},
    warnings: ["涉及支付，永不记住"],
  });
  assert.ok(record);

  const response = await app.request(`/api/approvals/${record.id}/approve`, {
    method: "POST",
    headers: authed(),
    body: JSON.stringify({ scope: "24h" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { downgraded: boolean; grant: GrantRecord };
  assert.equal(body.downgraded, true, "带警告被降档要如实回给客户端");
  assert.equal(body.grant.scope, "once");

  const listed = (await (await app.request("/api/grants", { headers: authed() })).json()) as {
    grants: GrantRecord[];
  };
  const found = listed.grants.find((row) => row.id === body.grant.id);
  assert.ok(found, "批准写出的授权必须出现在列表里（用户要能撤销它）");
  assert.equal(found?.scope, "once");
});
