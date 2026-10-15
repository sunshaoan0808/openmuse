/**
 * 授权 / 审批的落库接线（P1b）。
 *
 * 为什么需要这个中间层？咽喉（`tool-executor.ts`）只允许结构类型依赖，不 import `db.ts`
 * （免得与接线处形成运行时环），所以它拿不到 Store 的方法 —— 这里把 Store 包成一个
 * `ApprovalBackend` 交给它。REST 层（`app.ts`）要做的批准 / 拒绝 / 列表也走这里，
 * 保证「咽喉判定」与「REST 操作」用的是**同一套实例标识和时钟**。
 *
 * 优雅降级与 P1a 同级：`attachApprovalStore` 起不来、或接线抛错，服务照常起，
 * 只是审批回到「直接拒批」—— 那行 `[audit] …` 本来就有（tool-executor.ts 里一字未改）。
 *
 * 并发与原子性（单子 §1 的红线）：`once` 授权的消费走 Store 里的**条件 UPDATE**
 * （`data @> '{"consumedAt": null}'`），不是 read-then-write —— 两个并发调用只有一个能抢到。
 */
import { randomBytes } from "node:crypto";
import type { Store } from "../db.ts";
import {
  type ApprovalRecord,
  type ApprovalService,
  approvalRecordId,
  type GrantQuery,
  type GrantRecord,
  grantApplies,
  grantExpiresAt,
  type GrantScope,
  normalizeApproval,
} from "./approvals.ts";
import {
  type AuditEvent,
  auditEventId,
  persistAudit,
  setApprovalBackend,
} from "./tool-executor.ts";

// ---------------------------------------------------------------------------
// 运行时单例：进程实例标识 + 可注入时钟。
// `session` 授权靠 instanceId 判定「服务重启过没有」；`24h` 靠 now() 算过期。
// 测试可注入假值（单子 §4.3：靠可注入的实例标识/时钟，不 sleep、不真等 24 小时）。
// ---------------------------------------------------------------------------

let runtime: { instanceId: string; now: () => number } = {
  instanceId: randomBytes(8).toString("hex"),
  now: () => Date.now(),
};

/** 注入运行时（测试用），返回「恢复原状」的函数。 */
export function setApprovalRuntime(override: Partial<typeof runtime>): () => void {
  const previous = runtime;
  runtime = { ...runtime, ...override };
  return () => {
    runtime = previous;
  };
}

/** 当前运行时（只读快照）—— REST 层要写审计行时用它取时间戳。 */
export function getApprovalRuntime(): { instanceId: string; now: () => number } {
  return { ...runtime };
}

/** 把一次判定需要的时钟快照取出来（可注入 → 测试不 sleep）。 */
function clock(): Pick<GrantQuery, "nowMs" | "instanceId"> {
  return { nowMs: runtime.now(), instanceId: runtime.instanceId };
}

/** 用 Store 造出完整的服务（咽喉只用到 acquireGrant / registerApproval）。 */
export function createApprovalService(store: Store): ApprovalService {
  return {
    async acquireGrant({ owner, tool, threadId }) {
      // 候选按更新时间倒序（最近的在前）；有效性判定交给纯函数 grantApplies。
      const candidates = await store.listGrants(owner, tool, 50);
      for (const grant of candidates) {
        if (!grantApplies(grant, { owner, tool, threadId, ...clock() })) continue;
        if (grant.scope !== "once") return grant; // session / 24h：不消耗
        // once：原子消耗。拿到 null = 别的并发者先抢到，继续找下一个候选。
        const consumed = await store.consumeGrant(
          owner,
          grant.id,
          new Date(runtime.now()).toISOString(),
        );
        if (consumed) return consumed;
      }
      return null;
    },

    async registerApproval(request) {
      const at = new Date(runtime.now()).toISOString();
      const approval: ApprovalRecord = {
        id: approvalRecordId(at),
        tool: request.tool,
        owner: request.owner,
        threadId: request.threadId ?? null,
        risk: request.risk,
        reason: request.reason,
        args: request.args,
        requestedAt: at,
        status: "pending",
        scope: null,
        decidedAt: null,
        denyReason: null,
        grantId: null,
      };
      try {
        return await store.putApproval(approval);
      } catch (error) {
        // 登记失败只留一行日志；咽喉会退回「直接拒批」，工具语义不变（与 P1a 同级契约）。
        console.error(
          `[approval] 待审批登记失败 tool=${request.tool}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }
    },

    list(owner, options) {
      return store.listApprovals(owner, options);
    },

    get(owner, id) {
      return store.getApproval(owner, id);
    },

    async approve(owner, id, scope) {
      const pending = await store.getApproval(owner, id);
      // 只认「本人的 + 待决的」：别人的 id 与不存在的 id 在这里都变成 null（REST 回 404）。
      if (!pending || pending.status !== "pending") return null;
      const at = new Date(runtime.now());
      const grant: GrantRecord = {
        id: approvalRecordId(at.toISOString()),
        owner,
        tool: pending.tool,
        scope,
        // `24h` 是 owner 名下任意线程放行，按契约（approvals.ts）恒不绑会话；
        // `once` / `session` 才继承批准时的那次会话。
        threadId: scope === "24h" ? null : (pending.threadId ?? null),
        createdAt: at.toISOString(),
        expiresAt: grantExpiresAt(scope, at.getTime()),
        consumedAt: null,
        instanceId: runtime.instanceId,
        approvalId: pending.id,
      };
      // 先原子地把审批从 pending 翻掉（防并发双批），成功后才落 grant。
      // 条件 UPDATE 带 `status:'pending'`，两个并发批准只有一个能赢。
      const approved = await store.compareAndSwap<ApprovalRecord>(
        owner,
        "approvals",
        id,
        { status: "pending" },
        { status: "approved", scope, decidedAt: at.toISOString(), grantId: grant.id },
      );
      if (!approved) return null; // 别人已经批过/拒过了
      await store.putGrant(grant);
      return { approval: normalizeApproval(approved), grant };
    },

    async deny(owner, id, reason) {
      const at = new Date(runtime.now()).toISOString();
      // 条件同样带 status='pending'：已处理过的审批不会被改第二次。
      const denied = await store.compareAndSwap<ApprovalRecord>(
        owner,
        "approvals",
        id,
        { status: "pending" },
        { status: "denied", decidedAt: at, denyReason: reason ?? null },
      );
      return denied ? normalizeApproval(denied) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// 服务注册表：REST 层（app.ts）通过它拿服务，咽喉通过 setApprovalBackend 拿同一个对象。
// 两者必须是**同一个实例** —— 否则批准写出的 `session` 授权会带着另一个 instanceId，
// 咽喉永远判它「服务重启过」而失效。
// ---------------------------------------------------------------------------

let service: ApprovalService | null = null;

/** 装/摘服务（`attachApprovalStore` 装，`setApprovalService(null)` 摘）。 */
export function setApprovalService(next: ApprovalService | null): void {
  service = next;
}

/** 当前服务。没装上时为 null —— REST 层据此回 503，咽喉退回 P0 的直接拒批。 */
export function getApprovalService(): ApprovalService | null {
  return service;
}

/**
 * 用户批准 / 拒绝时各写一行审计（单子 §2.5 的最后一句）。
 *
 * 走的是与工具调用**同一个审计出口**（`persistAudit`），所以复盘时审批决定与工具判定在一条时间线上。
 * `outcome` 记的是「那条被拦的调用现在的处境」：批准 = 变成 `ok`（已获授权），拒绝 = 仍是 `blocked`；
 * 具体动作看 `decision`（`approval_approved` / `approval_denied`）。工具本身**没有**在这里执行。
 *
 * 落库失败只会被咽喉记一行日志，绝不影响 REST 的返回值（与 P1a 同级契约）。
 */
export function recordApprovalDecision(
  owner: string,
  decision: "approval_approved" | "approval_denied",
  approval: ApprovalRecord,
): void {
  const at = new Date(runtime.now()).toISOString();
  const event: AuditEvent = {
    id: auditEventId(at),
    at,
    tool: approval.tool,
    owner,
    threadId: approval.threadId,
    risk: approval.risk,
    outcome: decision === "approval_approved" ? "ok" : "blocked",
    decision,
    target: null,
    egress: "none",
    egressTarget: null,
    summary: approval.reason,
    reason:
      decision === "approval_approved"
        ? `用户已批准（scope=${approval.scope ?? "-"}），下一次匹配调用将直接放行`
        : approval.denyReason
          ? `用户已拒绝：${approval.denyReason}`
          : "用户已拒绝这次调用",
    durationMs: 0,
    args: approval.args ?? null,
    result: null,
  };
  // 控制台那一行与工具调用同一个通道（线上日志习惯不变）。
  console.log(
    `[audit] tool=${event.tool} owner=${owner} thread=${approval.threadId ?? "-"} risk=${event.risk} outcome=${event.outcome} decision=${decision} approval=${approval.id}`,
  );
  persistAudit(event);
}

/**
 * 接线：把 Store 包成 ApprovalService 并装到咽喉。失败吞掉并返回 false，
 * 调用方据此打一行日志即可 —— 不让授权可用性决定服务起不起来。
 */
export function attachApprovalStore(store: Store): boolean {
  try {
    const created = createApprovalService(store);
    service = created;
    setApprovalBackend(created);
    return true;
  } catch (error) {
    service = null;
    setApprovalBackend(null);
    console.error(
      `[approval] 审批往返未启用，退回直接拒批：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}