/**
 * P2b §2.3：待审批**超时即作废**。
 *
 * 方向是最要紧的一条：过期只意味着「不许再放行」，**绝不**意味着「那就放行吧」。
 * 全部用例不 sleep —— 时钟与实例标识都由 `setApprovalRuntime` 注入（与 P1b 同一套）。
 */
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { attachAuditStore } from "../apps/server/src/engine/audit-store.ts";
import {
  attachApprovalStore,
  getApprovalService,
  setApprovalRuntime,
} from "../apps/server/src/engine/approval-store.ts";
import {
  APPROVAL_TTL_MS,
  approvalExpiresAt,
  type ApprovalRecord,
  isApprovalExpired,
} from "../apps/server/src/engine/approvals.ts";

const T0 = Date.parse("2026-03-01T08:00:00.000Z");
const INSTANCE = "p2b-expiry-instance";

let clockNow = T0;
let restoreRuntime = () => {};
let db: Store;

before(async () => {
  db = await createStore();
  attachAuditStore(db);
  assert.equal(attachApprovalStore(db), true);
  restoreRuntime = setApprovalRuntime({ instanceId: INSTANCE, now: () => clockNow });
});

after(async () => {
  restoreRuntime();
  await db.close();
});

afterEach(() => {
  attachApprovalStore(db);
  clockNow = T0;
});

/** 造一条待审批（走服务端登记路径，好把 expiresAt 一起验）。 */
async function pending(owner: string, tool = "send_payment"): Promise<ApprovalRecord> {
  const service = getApprovalService();
  assert.ok(service);
  const record = await service.registerApproval({
    tool,
    owner,
    threadId: "t-exp",
    risk: "sensitive",
    reason: "需要你先批准这一次调用",
    args: { amount: 10 },
  });
  assert.ok(record, "登记待审批应当成功");
  return record;
}

// ---------------------------------------------------------------------------
// 纯函数：isApprovalExpired 的边界
// ---------------------------------------------------------------------------

test("§2.3 isApprovalExpired：没有 expiresAt 的旧记录一律不算过期（兼容）", () => {
  assert.equal(isApprovalExpired({ expiresAt: null }, T0), false);
});

test("§2.3 isApprovalExpired：差 1ms 未到点 → 还没过期", () => {
  const at = approvalExpiresAt(T0);
  assert.equal(isApprovalExpired({ expiresAt: at }, Date.parse(at) - 1), false);
});

test("§2.3 isApprovalExpired：正好到点 → 已过期（边界含等号）", () => {
  const at = approvalExpiresAt(T0);
  assert.equal(isApprovalExpired({ expiresAt: at }, Date.parse(at)), true);
});

test("§2.3 approvalExpiresAt：登记时刻 + 1 小时", () => {
  assert.equal(Date.parse(approvalExpiresAt(T0)) - T0, APPROVAL_TTL_MS);
  assert.equal(APPROVAL_TTL_MS, 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// 登记时写入失效时刻
// ---------------------------------------------------------------------------

test("§2.3 登记待审批时落库的 expiresAt = 登记时刻 + 1h（时钟可注入，不真等）", async () => {
  clockNow = T0;
  const record = await pending("p2b-exp-a");
  assert.equal(Date.parse(record.expiresAt as string) - T0, APPROVAL_TTL_MS);
});

// ---------------------------------------------------------------------------
// 过期后不许放行
// ---------------------------------------------------------------------------

test("§2.3 过期后 approve 被拒（null），**状态仍是 pending 且不产生任何 grant**", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-exp-b");

  clockNow = T0 + APPROVAL_TTL_MS + 1; // 拨过失效点
  const result = await service.approve(record.owner, record.id, "once");
  assert.equal(result, null, "过期的待审批绝不能被批准");

  const after = await db.getApproval(record.owner, record.id);
  assert.equal(after?.status, "pending", "过期不等于被处理 —— 状态不许被偷偷改成 approved");
  const grants = await db.listGrants(record.owner, record.tool, 50);
  assert.equal(grants.length, 0, "过期路径一个 grant 都不该写出来");
});

test("§2.3 approveChecked 把三种情况分开：missing / not_pending / expired", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-exp-c");

  const missing = await service.approveChecked(record.owner, "不存在的-id", "once");
  assert.deepEqual(missing, { ok: false, reason: "missing" });

  clockNow = T0 + APPROVAL_TTL_MS + 1;
  const expired = await service.approveChecked(record.owner, record.id, "once");
  assert.deepEqual(expired, { ok: false, reason: "expired" });

  clockNow = T0;
  const fresh = await pending("p2b-exp-c", "send_mail");
  const approved = await service.approveChecked(fresh.owner, fresh.id, "once");
  assert.equal(approved.ok, true);
  const again = await service.approveChecked(fresh.owner, fresh.id, "once");
  assert.deepEqual(again, { ok: false, reason: "not_pending" }, "已批准过的不许再批一次");
});

test("§2.3 未过期时批准照常：到期时刻就是失效时刻", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-exp-d");
  clockNow = T0 + APPROVAL_TTL_MS - 1; // 差 1ms 到点
  const result = await service.approve(record.owner, record.id, "24h");
  assert.ok(result, "还没到点就该能批");
  assert.equal(result.grant.scope, "24h");
  assert.equal(Date.parse(result.grant.expiresAt as string) - clockNow, 24 * 60 * 60 * 1000);
});

test("§2.3 过期判定用的是**审批自己的** expiresAt，与授权过期无关", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-exp-e");
  // 先把时钟推到 25 小时后（授权的 24h 早已过期），审批 1 小时窗口更早就作废了
  clockNow = T0 + 25 * 60 * 60 * 1000;
  assert.equal(await service.approve(record.owner, record.id, "once"), null);
});

test("§2.3 别人的审批依旧批不到（过期检查不许改变越权语义）", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-exp-f");
  const other = await service.approveChecked("p2b-someone-else", record.id, "once");
  assert.deepEqual(other, { ok: false, reason: "missing" }, "别人的 id 一律当不存在");
});
