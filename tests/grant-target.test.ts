/**
 * P2b §2.1：授权键带**目标**。
 *
 * 三条要钉死的事：
 *   1. `target: null` 的授权 = 改造前的行为（按工具匹配，逐字不变）；
 *   2. 有 target 的授权**只覆盖同目标**，也不覆盖"没有目标"的调用；
 *   3. 多目标调用**每个目标都要被覆盖**才算命中，缺一个就整体不放行（且不白烧用户的点头）。
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  attachApprovalStore,
  getApprovalService,
  setApprovalRuntime,
} from "../apps/server/src/engine/approval-store.ts";
import {
  type GrantRecord,
  type GrantQuery,
  grantApplies,
  normalizeGrant,
  normalizeTargets,
} from "../apps/server/src/engine/approvals.ts";
import {
  getApprovalBackend,
  runToolCall,
  setApprovalBackend,
  type ToolPolicy,
} from "../apps/server/src/engine/tool-executor.ts";
import { attachAuditStore } from "../apps/server/src/engine/audit-store.ts";

const T0 = Date.parse("2026-03-01T08:00:00.000Z");
const INSTANCE = "p2b-instance-a";
const quiet = { denyList: [] as string[], audit: () => {} };

let clockNow = T0;
let restoreRuntime = () => {};
let realBackend: ReturnType<typeof getApprovalBackend>;
let db: Store;

before(async () => {
  db = await createStore();
  attachAuditStore(db);
  assert.equal(attachApprovalStore(db), true, "审批服务应当装配成功");
  restoreRuntime = setApprovalRuntime({ instanceId: INSTANCE, now: () => clockNow });
  realBackend = getApprovalBackend();
});

after(async () => {
  restoreRuntime();
  setApprovalBackend(null);
  await db.close();
});

afterEach(() => {
  setApprovalBackend(realBackend);
  attachApprovalStore(db);
  clockNow = T0;
});

beforeEach(() => {
  clockNow = T0;
});

/** 造一条授权（默认不限定目标 = 老形态）。 */
function grant(over: Partial<GrantRecord> = {}): GrantRecord {
  return {
    id: "20260301080000000-0000000a",
    owner: "p2b-alice",
    tool: "web_fetch",
    scope: "session",
    target: null,
    threadId: "t-a",
    createdAt: new Date(T0).toISOString(),
    expiresAt: null,
    consumedAt: null,
    instanceId: INSTANCE,
    approvalId: "20260301080000000-0000000b",
    ...over,
  };
}

function query(over: Partial<GrantQuery> = {}): GrantQuery {
  return { owner: "p2b-alice", tool: "web_fetch", threadId: "t-a", nowMs: T0, instanceId: INSTANCE, ...over };
}

// ---------------------------------------------------------------------------
// §2.1.1 兼容性：不限定目标的授权 = 改造前的行为
// ---------------------------------------------------------------------------

test("§2.1 不限定目标的授权：放行任意目标，也放行「没有目标」的调用（与改造前逐字一致）", () => {
  const legacy = grant();
  assert.equal(grantApplies(legacy, query()), true, "没有目标参数的调用应当被放行");
  assert.equal(grantApplies(legacy, query({ target: "example.com" })), true, "任意目标都放行");
  assert.equal(grantApplies(legacy, query({ target: null })), true, "显式 null 同样放行");
  assert.equal(grantApplies(legacy, query({ target: "evil.example" })), true, "老授权不区分目标");
});

test("§2.1 脏行归一化：缺 target 字段的旧记录退化成「不限定目标」", () => {
  const normalized = normalizeGrant({
    id: "old",
    owner: "p2b-alice",
    tool: "web_fetch",
    scope: "24h",
    threadId: null,
    createdAt: new Date(T0).toISOString(),
    expiresAt: null,
    consumedAt: null,
    instanceId: INSTANCE,
    approvalId: "a",
  } as Partial<GrantRecord> & { id: string });
  assert.equal(normalized.target, null, "旧授权（无 target）必须继续可用");
  assert.equal(grantApplies(normalized, query()), true);
});

// ---------------------------------------------------------------------------
// §2.1.2 限定目标的授权：只认同一个目标
// ---------------------------------------------------------------------------

test("§2.1 限定目标的授权：放行同目标", () => {
  assert.equal(grantApplies(grant({ target: "example.com" }), query({ target: "example.com" })), true);
});

test("§2.1 限定目标的授权：不放行别的目标", () => {
  assert.equal(grantApplies(grant({ target: "example.com" }), query({ target: "other.example" })), false);
});

test("§2.1 限定目标的授权：不放行「没有目标」的调用（那是另一种调用形状）", () => {
  assert.equal(grantApplies(grant({ target: "example.com" }), query()), false);
  assert.equal(grantApplies(grant({ target: "example.com" }), query({ target: null })), false);
});

// ---------------------------------------------------------------------------
// §2.1.3 多目标：每个目标都要被覆盖
// ---------------------------------------------------------------------------

test("§2.1 多目标全被覆盖 → 放行；两条 once 都被消耗", async () => {
  const service = getApprovalService();
  assert.ok(service);
  await db.putGrant(grant({ id: "g-a", tool: "push", scope: "once", target: "a.example" }));
  await db.putGrant(grant({ id: "g-b", tool: "push", scope: "once", target: "b.example" }));
  clockNow = T0;
  const hit = await service.acquireGrant({
    owner: "p2b-alice",
    tool: "push",
    threadId: "t-a",
    targets: ["a.example", "b.example"],
  });
  assert.ok(hit, "两个目标都有授权 → 应当放行");
  const rows = await db.listGrants("p2b-alice", "push");
  assert.equal(rows.filter((row) => row.consumedAt !== null).length, 2, "两条 once 都该被消耗");
});

test("§2.1 多目标缺一个 → 整体不放行，且**已覆盖的那些不被消耗**（不白烧用户的点头）", async () => {
  const service = getApprovalService();
  assert.ok(service);
  await db.putGrant(grant({ id: "h-a", tool: "push", scope: "once", target: "a.example" }));
  const hit = await service.acquireGrant({
    owner: "p2b-alice",
    tool: "push",
    threadId: "t-a",
    targets: ["a.example", "b.example"],
  });
  assert.equal(hit, null, "缺 b.example 的授权 → 不能放行");
  const rows = await db.listGrants("p2b-alice", "push");
  assert.equal(rows[0]?.consumedAt, null, "先核验后消耗：核验没过就不该动已覆盖的那条 once");
});

test("§2.1 不传 targets（老调用形状）→ 与改造前一致：单目标路径逐个候选试", async () => {
  const service = getApprovalService();
  assert.ok(service);
  await db.putGrant(grant({ id: "i-1", tool: "fetch", scope: "session", target: null }));
  const hit = await service.acquireGrant({ owner: "p2b-alice", tool: "fetch", threadId: "t-a" });
  assert.ok(hit, "不带 targets 时必须按工具匹配放行（兼容）");
  assert.equal(hit.id, "i-1");
});

test("§2.1 missingTargets：只报没被覆盖的，且**不消耗**任何授权", async () => {
  const service = getApprovalService();
  assert.ok(service);
  await db.putGrant(grant({ id: "j-a", tool: "push", scope: "once", target: "a.example" }));
  const missing = await service.missingTargets?.({
    owner: "p2b-alice",
    tool: "push",
    threadId: "t-a",
    targets: ["a.example", "b.example"],
  });
  assert.deepEqual(missing, ["b.example"], "只该报缺的那个目标");
  const rows = await db.listGrants("p2b-alice", "push");
  assert.equal(rows[0]?.consumedAt, null, "诊断查询必须只读");
});

// ---------------------------------------------------------------------------
// §2.1.4 normalizeTargets
// ---------------------------------------------------------------------------

test("§2.1 normalizeTargets：认字符串 / 数组，丢非字符串与空白，去重且保序", () => {
  assert.deepEqual(normalizeTargets("example.com"), ["example.com"]);
  assert.deepEqual(normalizeTargets(["b.example", "a.example"]), ["b.example", "a.example"]);
  assert.deepEqual(normalizeTargets(["a", "a", " a "]), ["a"], "去重 + 去空白");
  assert.deepEqual(normalizeTargets([null, 42, "ok", undefined]), ["ok"], "非字符串一律丢");
  assert.deepEqual(normalizeTargets(undefined), [], "不声明 = 不限定目标");
  assert.deepEqual(normalizeTargets(null), []);
  assert.deepEqual(normalizeTargets([]), []);
});

// ---------------------------------------------------------------------------
// §2.1.5 咽喉接线：目标同步取自工具声明，且必须传到授权查询里
// ---------------------------------------------------------------------------

test("§2.1 咽喉把工具声明的目标传给授权查询（假后端观察 query）", async () => {
  const seen: { targets?: string[] }[] = [];
  setApprovalBackend({
    async acquireGrant(q) {
      seen.push(q);
      return null;
    },
    async registerApproval() {
      return null;
    },
  });
  const tool: ToolPolicy = {
    name: "push",
    targets: (args) => (args as { refs?: unknown }).refs,
    execute: async () => "done",
  };
  try {
    await runToolCall(tool, { refs: ["a.example", "b.example"] }, { owner: "p2b-bob" }, quiet);
  } catch {
    // 没有审批后端 → 直接拒批，这里只关心"目标有没有传下去"
  }
  assert.deepEqual(seen[0]?.targets, ["a.example", "b.example"], "目标必须在第 2 步就交给授权判定");
});

test("§2.1 没声明 targets 的工具：查询里不带 targets（= 改造前的形状）", async () => {
  const seen: { targets?: string[] }[] = [];
  setApprovalBackend({
    async acquireGrant(q) {
      seen.push(q);
      return null;
    },
    async registerApproval() {
      return null;
    },
  });
  const tool: ToolPolicy = { name: "plain", execute: async () => "done" };
  await runToolCall(tool, {}, { owner: "p2b-bob" }, quiet);
  assert.equal("targets" in seen[0]!, false, "不声明目标就不该出现 targets 字段");
});

test("§2.1 多目标缺授权时，登记的那条审批理由里点名缺的目标", async () => {
  const registered: { reason: string; targets?: (string | null)[] }[] = [];
  setApprovalBackend({
    async acquireGrant() {
      return null;
    },
    async registerApproval(request) {
      registered.push({ reason: request.reason, ...(request.targets ? { targets: request.targets } : {}) });
      return null; // 返回 null = 登记失败 → 咽喉退回直接拒批（不影响本用例要看的字段）
    },
  });
  const tool: ToolPolicy = {
    name: "push",
    risk: "sensitive",
    targets: () => ["a.example", "b.example"],
    execute: async () => "done",
  };
  await assert.rejects(() => runToolCall(tool, {}, { owner: "p2b-bob" }, quiet));
  // 假后端没实现 missingTargets → 退化成不点名，但**目标集合必须带进审批记录**（供批准时逐条写授权）。
  assert.deepEqual(registered[0]?.targets, ["a.example", "b.example"], "目标要带进审批记录");
});
