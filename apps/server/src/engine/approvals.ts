/**
 * 授权（grant）语义与审批（approval）登记 —— P1b「审批往返（服务端）」的纯逻辑层。
 *
 * **为什么单独一个文件**：咽喉（`tool-executor.ts`）只允许依赖结构类型，不能为了审批
 * 去 import `db.ts`（会与接线处形成运行时环）。所以「授权怎么算有效」「失效条件是什么」
 * 这类**纯函数**留在这里，由 `tool-executor.ts` 与 REST 层共用；落库的知识在
 * `approval-store.ts` + `db.ts`。本文件只依赖 `node:crypto`，不 import 仓库里任何模块。
 *
 * ## 三种 scope 的语义与失效条件（单子 §1，逐条对齐）
 *
 * | scope | 放行范围 | 失效条件 |
 * | --- | --- | --- |
 * | `once` | **下一次**该工具的调用（同 owner + 同 thread） | 用掉即失效（消耗型，原子消耗） |
 * | `session` | 同一 `threadId` 内一直放行 | 线程换掉，或**服务重启**（按进程实例界定） |
 * | `24h` | 该 owner 名下任意线程放行 | `expiresAt = 授权时刻 + 24h` |
 *
 * 「服务重启」靠 `instanceId` 界定：授权在创建时记下当时的进程实例号，
 * 判定时 instance 对不上（= 换了一次进程）就当它失效。instanceId 由接线处注入，
 * 测试可换成假值 —— 单子 §4.3 要求「不 sleep、靠可注入的实例标识/时钟」。
 */
import { randomBytes } from "node:crypto";

/** 风险档位。与 `tool-executor.ts` 的 `ToolRisk` 同形，在那里由本类型重命名而来。 */
export type RiskLevel = "safe" | "moderate" | "sensitive";

/** 授权的时效档位（单子 §1 的三行，逐字对应）。 */
export type GrantScope = "once" | "session" | "24h";

export const GRANT_SCOPES: readonly GrantScope[] = ["once", "session", "24h"];

/** `24h` 档的存活时长：授权时刻 + 24 小时。 */
export const GRANT_24H_MS = 24 * 60 * 60 * 1000;

/** 窄化一个来路不明的字符串；非法的一律 false（REST 层据此回 400）。 */
export function isGrantScope(value: unknown): value is GrantScope {
  return typeof value === "string" && (GRANT_SCOPES as readonly string[]).includes(value);
}

/**
 * 落库的一条授权（`records` 表，`kind='grants'`）。字段与单子 §1 对齐，
 * 未发生的一律写 `null` 不省略 —— 查询方不用到处判空（与 P1a 的审计行同一套规矩）。
 */
export interface GrantRecord {
  /** `<17位时间戳>-<8位随机十六进制>`：字典序 == 时间序，与审计行同一形态。 */
  id: string;
  owner: string;
  /** 只对**这一个工具**生效，不做前缀/通配匹配。 */
  tool: string;
  scope: GrantScope;
  /** `once` / `session` 绑定的那次会话；`24h` 恒为 null（owner 内任意线程放行）。 */
  threadId: string | null;
  createdAt: string;
  /** 仅 `24h` 有值 = `createdAt + 24h`；其余两档为 null。 */
  expiresAt: string | null;
  /** `once` 用掉时写这里（原子消耗的落点）；其余为 null。 */
  consumedAt: string | null;
  /** `session` 绑定的**进程实例**；换实例（= 重启）即失效。 */
  instanceId: string;
  /** 这条授权是哪次批准写出来的（可回溯到那条审批）。 */
  approvalId: string;
}

export type ApprovalStatus = "pending" | "approved" | "denied";

/** 落库的一条审批（`records` 表，`kind='approvals'`）。 */
export interface ApprovalRecord {
  id: string;
  tool: string;
  owner: string;
  threadId: string | null;
  risk: RiskLevel;
  /** 人话理由：为什么这次要人来批。与审计行的 `reason` 同一套措辞。 */
  reason: string;
  /** 参数摘要（**已按评估结论脱敏 + 截断**），不是原始入参。 */
  args: unknown;
  requestedAt: string;
  status: ApprovalStatus;
  /** 批准时用户选的时效；未决 / 被拒为 null。 */
  scope: GrantScope | null;
  /** 批准/拒绝的时刻；还挂着为 null。 */
  decidedAt: string | null;
  /** 拒绝理由（用户填的）；其它为 null。 */
  denyReason: string | null;
  /** 批准时写出的那条 grant；其它为 null。 */
  grantId: string | null;
}

/** 咽喉登记一条待审批时递进来的东西。 */
export interface ApprovalRequest {
  tool: string;
  owner: string;
  threadId: string | null;
  risk: RiskLevel;
  reason: string;
  /** 参数摘要（咽喉已经打好码、截断过了）。 */
  args: unknown;
}

/** 判定一次授权是否还有效时需要的东西。 */
export interface GrantQuery {
  owner: string;
  tool: string;
  threadId: string | null;
  /** 本次判定的时刻（毫秒）。时钟可注入，测试不必 sleep。 */
  nowMs: number;
  /** 当前进程实例标识。 */
  instanceId: string;
}

/** 查询审批列表的过滤条件。 */
export interface ApprovalQuery {
  /** `pending` 只看待决的；`all` 全要。默认 `pending`。 */
  status?: "pending" | "all";
  limit?: number;
}

export const APPROVAL_DEFAULT_LIMIT = 50;
export const APPROVAL_MAX_LIMIT = 200;

/** 记录 id：时间戳（可读、可排序）+ 随机短串（同毫秒内不撞），与审计行同形态。 */
export function approvalRecordId(at: string): string {
  return `${at.replace(/[-:.TZ]/g, "")}-${randomBytes(4).toString("hex")}`;
}

/** `expiresAt`：只有 `24h` 档有过期时刻，其余两档是 null（用掉 / 换实例 才失效）。 */
export function grantExpiresAt(scope: GrantScope, createdAtMs: number): string | null {
  return scope === "24h" ? new Date(createdAtMs + GRANT_24H_MS).toISOString() : null;
}

/**
 * 一条授权对这次调用**还有效吗**（纯函数，最要紧的一条判定）。
 *
 * 逐条对应单子 §1 的失效条件：
 *   - `consumedAt` 非空 → `once` 已用掉，失效；
 *   - `expiresAt` 已过 → 失效（只可能来自 `24h`）；
 *   - `once` / `session` 的 `threadId` 与这次不一致 → 失效（换了会话就不算数）；
 *   - `session` 的 `instanceId` 与当前进程不一致 → 失效（服务重启过）；
 *   - `24h` 不看 threadId、不看 instanceId，只要 owner 对上就一直放行到过期。
 */
export function grantApplies(grant: GrantRecord, query: GrantQuery): boolean {
  if (grant.owner !== query.owner) return false;
  if (grant.tool !== query.tool) return false;
  if (grant.consumedAt) return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= query.nowMs) return false;
  // 24h：owner 名下任意线程放行 —— 上面已经校验过 owner / 工具 / 未过期。
  if (grant.scope === "24h") return true;
  if ((grant.threadId ?? null) !== query.threadId) return false;
  // session：线程对上了，还得是同一个进程实例（重启即失效）。
  if (grant.scope === "session" && grant.instanceId !== query.instanceId) return false;
  return true;
}

/**
 * 登记待审批时写进审计 / 审批记录的人话理由。
 * 与 P0 的 `blockedReason` 刻意区分：那时候**根本没有审批入口**，现在有了 ——
 * 所以这里说的是「需要你批这一次」，不再是「没有入口」。
 * 措辞里保留了 P0 的关键词（`敏感能力` / `带出本机` / `先看一眼`），便于复盘时对照。
 */
export function pendingReason(assessment: {
  risk?: RiskLevel;
  egress?: "none" | "allow" | "review";
  warnings?: string[];
}): string {
  if (assessment.risk === "sensitive") return "该能力是敏感能力，需要你先批准这一次调用";
  if (assessment.egress === "review") return "该调用会把结果带出本机，需要你先批准这一次调用";
  const first = assessment.warnings?.[0];
  return first ? `这次调用需要你先看一眼：${first}` : "这次调用需要你先确认后才能执行";
}

/**
 * 回灌给模型的「等待审批」文案（单子 §2.4，三件事一件都不能少）：
 *   1. **别重试同一个调用** —— 否则模型会拿同一个调用反复撞墙（nanoMuse 机制的要点）；
 *   2. **已通知用户**（确实登记了一条待审批，撒谎就等于教模型撒谎）；
 *   3. **拿到授权后，同一个调用会成功** —— 否则模型会以为这条路彻底走不通。
 */
export function pendingApprovalMessage(name: string, reason: string): string {
  return (
    `Sentinel 拦下了「${name}」并已登记待审批：${reason}。` +
    `Do not retry the same call——已经通知用户，请把这件事直接告诉用户，别自己反复重试；` +
    `用户批准之后，同一个调用（同样的工具、同样的参数、同一个会话）会直接成功。`
  );
}

// ---------------------------------------------------------------------------
// 咽喉与 REST 层共用的两个结构类型。
//
// 放在这里（纯叶子、不 import 任何仓库模块）是有意的：`tool-executor.ts` 只能 **类型** 依赖审批，
// `approval-store.ts` 在运行时 import 咽喉。类型放叶子 → 没有运行时环。
// ---------------------------------------------------------------------------

/** 咽喉热路径只需要这两个方法。 */
export interface ApprovalBackend {
  /**
   * 原子地找一条对这次调用有效的授权（`once` 在这里被消耗）；没有则返回 null。
   * `owner`/`tool`/`threadId` 由咽喉给，取数一律按 owner 分区。
   */
  acquireGrant(query: { owner: string; tool: string; threadId: string | null }): Promise<
    GrantRecord | null
  >;
  /** 登记一条待审批；写库失败返回 null（咽喉据此退回「直接拒批」，不影响工具语义）。 */
  registerApproval(request: ApprovalRequest): Promise<ApprovalRecord | null>;
}

/** 批准的结果（REST 层直接序列化返回）。 */
export interface ApproveResult {
  approval: ApprovalRecord;
  grant: GrantRecord;
}

/** REST 层用的完整服务：在咽喉那两个方法之外，再加查询与批准/拒绝。 */
export interface ApprovalService extends ApprovalBackend {
  /** 列该 owner 的审批，`status` 缺省只看待决，最近的在前。 */
  list(owner: string, options: { status?: "pending" | "all"; limit?: number }): Promise<
    ApprovalRecord[]
  >;
  /** 取一条审批（**别人的 / 不存在的都返回 null**，不泄露存在性）。 */
  get(owner: string, id: string): Promise<ApprovalRecord | null>;
  /** 批准：写 grant + 审批置 approved；审批不存在 / 不是待决 → 返回 null。 */
  approve(owner: string, id: string, scope: GrantScope): Promise<ApproveResult | null>;
  /** 拒绝：审批置 denied，**不产生任何放行**；审批不存在 / 不是待决 → 返回 null。 */
  deny(owner: string, id: string, reason?: string): Promise<ApprovalRecord | null>;
}

/**
 * 把库里可能残缺的授权行补齐成完整形状（与 `normalizeApproval` 同一套规矩）。
 * 咽喉的热路径会逐条跑它，所以**绝不能抛** —— 读到的残缺行宁可退化成「无效授权」，
 * 也不能让一次工具调用因为一条脏数据整体失败（`grantApplies` 会因为字段不对而判它失效）。
 */
export function normalizeGrant(row: Partial<GrantRecord> & { id: string }): GrantRecord {
  return {
    id: row.id,
    owner: typeof row.owner === "string" ? row.owner : "",
    tool: typeof row.tool === "string" ? row.tool : "",
    scope: isGrantScope(row.scope) ? row.scope : "once",
    threadId: typeof row.threadId === "string" ? row.threadId : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
    consumedAt: typeof row.consumedAt === "string" ? row.consumedAt : null,
    instanceId: typeof row.instanceId === "string" ? row.instanceId : "",
    approvalId: typeof row.approvalId === "string" ? row.approvalId : "",
  };
}

/** 把库里可能残缺的审批行补齐成完整形状，查询方不用到处判空（与 `normalizeAudit` 同一套）。 */
export function normalizeApproval(row: Partial<ApprovalRecord> & { id: string }): ApprovalRecord {
  return {
    id: row.id,
    tool: typeof row.tool === "string" ? row.tool : "",
    owner: typeof row.owner === "string" ? row.owner : "",
    threadId: typeof row.threadId === "string" ? row.threadId : null,
    risk: row.risk ?? "safe",
    reason: typeof row.reason === "string" ? row.reason : "",
    args: row.args ?? null,
    requestedAt: typeof row.requestedAt === "string" ? row.requestedAt : "",
    status: row.status ?? "pending",
    scope: isGrantScope(row.scope) ? row.scope : null,
    decidedAt: typeof row.decidedAt === "string" ? row.decidedAt : null,
    denyReason: typeof row.denyReason === "string" ? row.denyReason : null,
    grantId: typeof row.grantId === "string" ? row.grantId : null,
  };
}