/**
 * P2b §2.2：带 warning 的调用**只给 once**。
 *
 * 语义（照 nanoMuse 的"支付与密码永不记住"）：批准时服务端说了算，**只降不升** ——
 * 客户端传 24h 也不放宽；而没带警告的调用不许被过度收紧（传 24h 就得是 24h）。
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
  type ApprovalRecord,
  downgradeScope,
  type GrantScope,
} from "../apps/server/src/engine/approvals.ts";
import {
  getApprovalBackend,
  runToolCall,
  setApprovalBackend,
  ToolApprovalPendingError,
  type ToolPolicy,
} from "../apps/server/src/engine/tool-executor.ts";

const T0 = Date.parse("2026-03-01T08:00:00.000Z");
const INSTANCE = "p2b-downgrade-instance";
const quiet = { denyList: [] as string[], audit: () => {} };

let clockNow = T0;
let restoreRuntime = () => {};
let realBackend: ReturnType<typeof getApprovalBackend>;
let db: Store;

before(async () => {
  db = await createStore();
  attachAuditStore(db);
  assert.equal(attachApprovalStore(db), true);
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

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test("§2.2 downgradeScope：带警告一律降成 once（请求什么档都降）", () => {
  for (const scope of ["once", "session", "24h"] as const) {
    assert.equal(downgradeScope(scope, ["这是一条危险命令"]), "once");
  }
});

test("§2.2 downgradeScope：没有警告就不动（只降不升，也不许莫名收紧）", () => {
  assert.equal(downgradeScope("24h", []), "24h");
  assert.equal(downgradeScope("24h", undefined), "24h");
  assert.equal(downgradeScope("24h", null), "24h");
  assert.equal(downgradeScope("session", []), "session");
});

// ---------------------------------------------------------------------------
// 批准路径：实际生效的档位写回审批记录
// ---------------------------------------------------------------------------

async function pending(owner: string, warnings: string[]): Promise<ApprovalRecord> {
  const service = getApprovalService();
  assert.ok(service);
  const record = await service.registerApproval({
    tool: "send_payment",
    owner,
    threadId: "t-dg",
    risk: "sensitive",
    reason: "该能力是敏感能力，需要你先批准这一次调用",
    args: { amount: 10 },
    warnings,
  });
  assert.ok(record, "登记待审批应当成功");
  return record;
}

test("§2.2 带警告的调用申请 24h → 实际生效 once，且审批记录里写回的是 once", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-dg-a", ["这条命令会删除文件"]);
  const outcome = await service.approveChecked(record.owner, record.id, "24h");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.grant.scope, "once", "带警告只给 once");
  assert.equal(outcome.approval.scope, "once", "写回审批记录的必须是**实际生效**的档位");
  assert.equal(outcome.downgraded, true, "要明确告诉客户端它被降档了");
  assert.equal(outcome.grant.expiresAt, null, "once 没有 24h 那种过期时刻");
});

test("§2.2 没带警告的调用申请 24h → 仍是 24h，且不许标记降档", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-dg-b", []);
  const outcome = await service.approveChecked(record.owner, record.id, "24h");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.grant.scope, "24h", "无警告不该被收紧");
  assert.equal(outcome.downgraded, false);
  assert.equal(Date.parse(outcome.grant.expiresAt as string) - T0, 24 * 60 * 60 * 1000);
});

test("§2.2 降档后的授权是消耗型：只放行一次，第二次仍被拦", async () => {
  const service = getApprovalService();
  assert.ok(service);
  clockNow = T0;
  const record = await pending("p2b-dg-c", ["涉及支付"]);
  const outcome = await service.approveChecked(record.owner, record.id, "24h");
  assert.equal(outcome.ok, true, "批准应当成功（只是被降成 once）");

  const tool: ToolPolicy = {
    name: "send_payment",
    risk: "sensitive",
    execute: async () => "paid",
  };
  // 第一次：靠刚批下来的 once 放行
  assert.equal(await runToolCall(tool, { amount: 10 }, { owner: "p2b-dg-c", threadId: "t-dg" }, quiet), "paid");
  // 第二次：once 已被消耗 → 重新登记一条新的 pending
  await assert.rejects(
    () => runToolCall(tool, { amount: 10 }, { owner: "p2b-dg-c", threadId: "t-dg" }, quiet),
    (error: unknown) => {
      assert.ok(error instanceof ToolApprovalPendingError, `第二次应当重新等审批，实际：${String(error)}`);
      return true;
    },
  );
});

test("§2.2 咽喉登记时把 assessment 的 warnings 带进审批记录（批准时才有据可依）", async () => {
  const captured: { warnings?: string[] }[] = [];
  setApprovalBackend({
    async acquireGrant() {
      return null;
    },
    async registerApproval(request) {
      captured.push({ warnings: request.warnings });
      return null; // 登记失败 → 咽喉退回直接拒批，本用例只看字段有没有传下来
    },
  });
  const tool: ToolPolicy = {
    name: "risky_shell",
    assess: () => ({ risk: "moderate", warnings: ["会删除文件"] }),
    execute: async () => "done",
  };
  await assert.rejects(() => runToolCall(tool, {}, { owner: "p2b-dg-d" }, quiet));
  assert.deepEqual(captured[0]?.warnings, ["会删除文件"], "warnings 必须随审批一起落库");
});

test("§2.2 没有 warnings 的工具：登记时带的是空数组（不是 undefined）", async () => {
  const captured: { warnings?: string[] }[] = [];
  setApprovalBackend({
    async acquireGrant() {
      return null;
    },
    async registerApproval(request) {
      captured.push({ warnings: request.warnings });
      return null;
    },
  });
  const tool: ToolPolicy = { name: "plain_sensitive", risk: "sensitive", execute: async () => "done" };
  await assert.rejects(() => runToolCall(tool, {}, { owner: "p2b-dg-e" }, quiet));
  assert.deepEqual(captured[0]?.warnings, [], "没警告就是空数组，别让下游判空");
});
