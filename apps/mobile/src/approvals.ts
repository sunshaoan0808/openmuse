/**
 * 审批（P1b 服务端）在 App 侧的可测逻辑：过滤、摘要、档位、请求体。
 *
 * 组件只负责画；判定与兜底都放这里，`apps/mobile/test/approvals.test.ts` 直接钉。
 * 原则：服务端返回什么都不能让界面崩 —— 坏行丢弃、字段缺失给兜底，不抛错。
 */

export type ApprovalScope = "once" | "session" | "24h";

export interface PendingApproval {
  id: string;
  tool: string;
  reason: string | null;
  risk: string | null;
  threadId: string | null;
  requestedAt: string | null;
}

/** 三档顺序固定：一次 → 本会话 → 24 小时（界面按此顺序排按钮，别按后端口径另排一套）。 */
export const APPROVAL_SCOPES: readonly ApprovalScope[] = ["once", "session", "24h"];

export function isApprovalScope(value: unknown): value is ApprovalScope {
  return typeof value === "string" && (APPROVAL_SCOPES as readonly string[]).includes(value);
}

/** 档位的人话标签（与单子 §1.3 的措辞一致）。 */
export function scopeLabel(scope: ApprovalScope): string {
  if (scope === "once") return "只允许这一次";
  if (scope === "session") return "本会话内";
  return "24 小时内";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 从 `GET /approvals` 的返回体里取出待审批列表：只留 `pending`、按请求时间倒序、坏行丢弃。
 * 返回体不是对象、`approvals` 不是数组、行里缺 id/tool —— 一律当作「没有待审批」，绝不抛错。
 */
export function parseApprovals(payload: unknown): PendingApproval[] {
  const rows = (payload as { approvals?: unknown } | null)?.approvals;
  if (!Array.isArray(rows)) return [];
  const out: PendingApproval[] = [];
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>;
    if (text(r.status) !== "pending") continue;
    const id = text(r.id);
    const tool = text(r.tool);
    if (!id || !tool) continue;
    out.push({
      id,
      tool,
      reason: text(r.reason),
      risk: text(r.risk),
      threadId: text(r.threadId),
      requestedAt: text(r.requestedAt),
    });
  }
  return out.sort((a, b) =>
    String(b.requestedAt ?? "").localeCompare(String(a.requestedAt ?? "")),
  );
}

/** 一行可读摘要：服务端给了理由就用它，没有就退回「<工具> 需要你确认」。 */
export function approvalSummary(approval: PendingApproval): string {
  return approval.reason ?? `${approval.tool} 需要你确认后才能执行`;
}

/**
 * 批准请求体。**非法/未知档位在这里就被拦下**（返回 null），不发请求 ——
 * 服务端对非法 scope 返回 400，本地先挡一道，界面也不必为它准备错误态。
 */
export function approveBody(scope: unknown): { scope: ApprovalScope } | null {
  return isApprovalScope(scope) ? { scope } : null;
}

/** 拒绝请求体：理由空白就不带字段（别塞空字符串，服务端会当成一条无意义理由）。 */
export function denyBody(reason?: string): { reason?: string } {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed ? { reason: trimmed } : {};
}

/** 幂等键：同一条审批 + 同一档位只生效一次，链路抖动重发不会重复写授权。 */
export function approveIdempotencyKey(id: string, scope: ApprovalScope): string {
  return `approval-${id}-${scope}`;
}

export function denyIdempotencyKey(id: string): string {
  return `approval-deny-${id}`;
}
