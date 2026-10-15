/**
 * 工具执行咽喉（Sentinel 式收口，P0 机制骨架 + P1b 审批往返）。
 *
 * 固定顺序，不许绕（P1b §2，**顺序本身是硬要求**）：
 *   1. 拒绝名单（**最高优先级：命中就不放行，哪怕用户已经批准过、有 grant 也不放行**）
 *   2. 有效 grant 命中 → 直接放行，审计记 `granted:<scope>`；`once` 在这里被原子消耗
 *   3. 评估（静态 risk + 逐次 assess，P0 语义一字未改）
 *   4. 要拦但没有 grant → 登记一条待审批 + 回灌「等待审批」文案（别重试 / 已通知用户 / 批了就会成功）
 *   5. 放行 → 执行 → 结果脱敏 → 审计
 *
 * 没有审批后端（`setApprovalBackend(null)`，服务没接上库）时，第 2/4 步整体退化为 P0 行为：
 * 直接拒批 + 「当前没有可用的审批入口」。**已声明 risk/assess 的工具因此不会看到新文案。**
 *
 * **最关键的一条**：没声明 `risk` / `assess` 的工具，执行路径的可见行为必须与改造前**逐字一致**——
 * 返回值原样返回、抛错原样抛出（本模块**不 catch 工具的错**）。仓库里工具靠 `throw` 表达失败
 * （见 chat-tools.ts:`创建账户需要同时提供 site…`），把抛错吞成 `{error}` 会改掉契约，
 * tests/site-accounts.test.ts 正是这么断言的。
 *
 * 本模块只依赖结构类型，不 import tool-kit.ts —— 免得与接线处形成运行时环。
 */
import { randomBytes } from "node:crypto";
import { readToolDenyList } from "../config.ts";
import {
  type ApprovalBackend,
  type GrantRecord,
  pendingApprovalMessage,
  pendingReason,
  type RiskLevel,
} from "./approvals.ts";

/** 静态风险档位：`moderate` 放行但一定进审计；`sensitive` 需要审批（授权后可放行）。 */
export type ToolRisk = RiskLevel;

/** 一次调用的评估结果：静态声明与逐次评估合并后的观点。 */
export interface ToolAssessment {
  risk?: ToolRisk;
  /** 这次到底对谁动手（站点 / 账号 / 路径 / URL），进审计用。 */
  target?: string;
  /** 结果是否流出本机：`none` 不过网、`allow` 允许、`review` 需要人看（P0 拒批）。 */
  egress?: "none" | "allow" | "review";
  /** 流出目标（域名/主机），进审计用。 */
  egressTarget?: string;
  /** 一句话讲清这次要干什么，进审计用（模型看不到）。 */
  summary?: string;
  /** 这次调用有问题要先让人看见 —— 声明了就必须拦（单子 §2 测试清单第 3 条）。 */
  warnings?: string[];
  /** 结果里出现疑似凭据时是否打码。默认 false —— 不打码才与改造前一致。 */
  redact?: boolean;
}

/** 能过咽喉的最小工具形状（与 tool-kit.ts 的 NeutralTool 结构兼容）。 */
export interface ToolPolicy {
  name: string;
  risk?: ToolRisk;
  assess?: (args: unknown) => ToolAssessment | Promise<ToolAssessment>;
  execute: (args: never) => Promise<unknown>;
}

/** 工具调用上下文：给审计用；两个引擎手里都有的东西就这些。 */
export interface ToolCallContext {
  owner?: string;
  threadId?: string;
}

export interface ExecutorDeps {
  /** 拒绝名单：默认读配置（`TOOL_DENY_LIST`，逗号分隔）。 */
  denyList?: readonly string[];
  /** 审计出口：默认 console.log，与 tool-kit.ts 既有的 `[tool] …` 留痕同一通道。 */
  audit?: (line: string) => void;
}

const defaultAudit = (line: string) => console.log(line);

// ---------------------------------------------------------------------------
// 审计落库（P1a）：上面那行 `[audit] …` 控制台输出**一字不改**（线上日志依赖它），
// 这里在同一条咽喉上**另开一条出口**把结构化事件送出去，落 Postgres 的 records 表。
//
// 硬契约（与 P0 的行为契约同级）：落库失败**绝不**影响工具的返回值 / 抛错实例 /
// 错误形状 / 耗时语义 —— 同步抛错接住，异步失败自己吞掉，只留一行日志。
// 因此 `persistAudit` 是 fire-and-forget：调用方**不 await**，工具的耗时不含写库时间。
// ---------------------------------------------------------------------------

/** 落库的判定结果：放行 / 被拦 / 工具自己出错。（控制台行仍用 denied/refused/… 的细粒度词） */
export type AuditOutcome = "ok" | "blocked" | "error";

/** 落库的一行审计。字段与单子 §1 对齐；未发生的一律写 `null`，不省略，便于查询。 */
export interface AuditEvent {
  /** 时间有序、可读：`<17位时间戳>-<8位随机十六进制>`。字典序 == 时间序。 */
  id: string;
  /** ISO 时间戳。 */
  at: string;
  tool: string;
  owner: string;
  threadId: string | null;
  risk: ToolRisk;
  outcome: AuditOutcome;
  /** 控制台行的细粒度判定（`denied`/`refused`/`assess_failed`/`ok`/`error`），排障时看它。 */
  decision: string;
  target: string | null;
  egress: "none" | "allow" | "review";
  egressTarget: string | null;
  summary: string | null;
  /** 被拦时才有人话理由；放行/出错时为 null。 */
  reason: string | null;
  durationMs: number;
  /** 本次调用的参数摘要（**已按评估结论脱敏**）。 */
  args: unknown;
  /** 工具结果摘要（**已按评估结论脱敏**，且已截断）。 */
  result: unknown;
}

/** 审计出口。允许返回 Promise，但调用方不 await（见上面的硬契约）。 */
export type AuditSink = (event: AuditEvent) => void | Promise<void>;

/** 缺 owner 时用的占位 owner，与 Auth.session() 落库的 `local-user` 保持一致。 */
export const AUDIT_FALLBACK_OWNER = "local-user";

let auditSink: AuditSink | null = null;
/** 在途的落库 promise，只为关停时兜底；热路径不 await 它。 */
const inFlight = new Set<Promise<void>>();

/** 接上审计出口（服务启动时调用）；传 null 摘掉，退回「只留控制台那行」。 */
export function setAuditSink(sink: AuditSink | null): void {
  auditSink = sink;
}

/** 当前挂着的审计出口（没接时为 null）。 */
export function getAuditSink(): AuditSink | null {
  return auditSink;
}

/**
 * 关停兜底：等服务退出前把在途的落库写完，避免最后一两条审计随进程一起消失。
 * 只在 shutdown 里 await —— 工具热路径永远不碰它。
 */
export async function flushAuditSink(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}

/** 审计事件 id：时间戳（可读、可排序）+ 随机短串（同毫秒内不撞）。 */
export function auditEventId(at: string): string {
  return `${at.replace(/[-:.TZ]/g, "")}-${randomBytes(4).toString("hex")}`;
}

const AUDIT_MAX_TEXT = 200;
const AUDIT_MAX_KEYS = 8;
const AUDIT_MAX_ITEMS = 3;
const AUDIT_MAX_DEPTH = 3;

/**
 * 落库前的结构摘要：限制深度/键数/条数/文本长度，免得一行工具结果把库撑爆、
 * 也不至于把整页正文抄进审计表。**脱敏必须在这之前做完**（调用方传进来的就是脱敏后的值）。
 */
function auditSnapshot(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string")
    return value.length > AUDIT_MAX_TEXT ? `${value.slice(0, AUDIT_MAX_TEXT)}…` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value))
    return depth >= AUDIT_MAX_DEPTH
      ? `[array:${value.length}]`
      : value.slice(0, AUDIT_MAX_ITEMS).map((item) => auditSnapshot(item, depth + 1));
  if (depth >= AUDIT_MAX_DEPTH) return `{keys:${Object.keys(value as object).length}}`;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
    0,
    AUDIT_MAX_KEYS,
  ))
    out[key] = auditSnapshot(item, depth + 1);
  return out;
}

/** 给外部（测试/其它模块）复用的摘要器。 */
export const summarizeAuditValue = auditSnapshot;

/**
 * 送一条审计出去 —— **绝不影响调用方**。
 * 同步抛错接住、异步 reject 接住，各留一行 `[audit-persist]` 日志；成功则不记日志（免得刷屏）。
 * 注意这里**不 await 返回的 promise**：工具耗时不因写库而变，这是本模块的硬契约。
 */
export function persistAudit(event: AuditEvent): void {
  const sink = auditSink;
  if (!sink) return;
  try {
    const settled = Promise.resolve(sink(event)).catch((error: unknown) => {
      console.error(
        `[audit-persist] 审计写入失败 id=${event.id} tool=${event.tool}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    inFlight.add(settled);
    void settled.finally(() => inFlight.delete(settled));
  } catch (error) {
    console.error(
      `[audit-persist] 审计出口抛错 id=${event.id} tool=${event.tool}：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// 审批后端（P1b）：与上面的审计出口同一套接法 —— 启动时装上，没装就退回 P0 的「直接拒批」。
//
// **降级同样是硬要求**：后端没接上（或登记待审批失败）时，被拦的工具仍然被拦，
// 只是抛出的 Error 回到 P0 的那句「当前没有可用的审批入口」。绝不让审批的可用性
// 决定工具能不能跑。
// ---------------------------------------------------------------------------

let approvalBackend: ApprovalBackend | null = null;

/** 接上审批后端（服务启动时调用）；传 null 摘掉，退回 P0 的「直接拒批」。 */
export function setApprovalBackend(backend: ApprovalBackend | null): void {
  approvalBackend = backend;
}

/** 当前挂着的审批后端（没接时为 null）。REST 层用它判断审批入口是否可用。 */
export function getApprovalBackend(): ApprovalBackend | null {
  return approvalBackend;
}

/**
 * 「等待审批」错误：与咽喉自己的「拦下」错误分开，好让调用方一眼分清
 * 「这个工具被永久否决了」还是「它在等用户点头」（live-activity / 未来客户端要靠它分文案）。
 *
 * 消息由 `pendingApprovalMessage` 生成，三件事必须都在：**别重试同一调用 / 已通知用户 /
 * 拿到授权后同一调用会成功**（单子 §2.4）。
 */
export class ToolApprovalPendingError extends Error {
  constructor(
    readonly tool: string,
    /** 登记成功的那条待审批的 id（没登记上就没有）。 */
    readonly approvalId: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ToolApprovalPendingError";
  }
}

/**
 * 拒绝名单：命中的工具**一律不发**，连执行都不执行。
 * 纯函数，便于单测直接钉。
 */
export function decideDeny(name: string, denyList: readonly string[] = readToolDenyList()): string | null {
  const needle = name.trim().toLowerCase();
  const hit = denyList.find((entry) => entry.trim().toLowerCase() === needle);
  return hit ? `工具「${name}」在拒绝名单里` : null;
}

/**
 * 拦住时回灌给模型的文案。必须让模型知道**别重试同一个调用**、并说明它该改做什么——
 * 「不要重试」这半句是 nanoMuse 机制的要点之一（否则模型会拿同一个调用反复撞墙）。
 */
export function blockedMessage(name: string, reason: string, next: string): string {
  return `Sentinel 拦下了「${name}」：${reason}。Do not retry the same call——${next}`;
}

/** 判定是否要拦：敏感能力、结果要流出本机、或本次声明了必须先给人看的警告。 */
export function needsApproval(assessment: ToolAssessment): boolean {
  if (assessment.risk === "sensitive") return true;
  if (assessment.egress === "review") return true;
  return (assessment.warnings?.length ?? 0) > 0;
}

/** 拦住时的人话理由（照单子：P0 没有审批入口，一律拒批并说明原因）。 */
export function blockedReason(assessment: ToolAssessment): string {
  if (assessment.risk === "sensitive") return "该能力是敏感能力，当前没有可用的审批入口";
  if (assessment.egress === "review") return "该调用会把结果带出本机，当前没有可用的审批入口";
  const first = assessment.warnings?.[0];
  return first
    ? `这次调用需要你先看一眼：${first}`
    : "这次调用需要人先确认，当前没有可用的审批入口";
}

const SECRET_KEY =
  /(pass(word|phrase)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credential)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|[A-Fa-f0-9]{32,})\b/g;

/**
 * 结果打码：只在评估明确要求（`redact: true`）时动手，**默认一字不改**（与改造前一致）。
 * 打码规则：键名像凭据的、或值本身像凭据的，替换成 `[REDACTED]`；其余原样。
 */
export function redactResult(result: unknown, assessment: ToolAssessment): unknown {
  if (assessment.redact !== true) return result;
  return redactValue(result);
}

function redactValue(value: unknown, keyHint = ""): unknown {
  if (typeof value === "string") {
    if (SECRET_KEY.test(keyHint)) return "[REDACTED]";
    return value.replace(SECRET_VALUE, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keyHint));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(item, key);
    }
    return out;
  }
  return value;
}

/**
 * 咽喉本体。**唯一的工具执行出口**（`grep -rn "\.execute(" apps/server/src` 除本模块外不应再有工具执行点）。
 *
 * 错误语义：本模块只抛自己产生的拦下错误；工具自身的错误**原样向上抛**（不包装、不替换）。
 */
export async function runToolCall(
  tool: ToolPolicy,
  args: unknown,
  ctx: ToolCallContext = {},
  deps: ExecutorDeps = {},
): Promise<unknown> {
  const audit = deps.audit ?? defaultAudit;
  const started = Date.now();
  const line = (extra: string) =>
    audit(
      `[audit] tool=${tool.name} owner=${ctx.owner ?? "-"} thread=${ctx.threadId ?? "-"} risk=${
        tool.risk ?? "safe"
      } ${extra} (${Date.now() - started}ms)`,
    );
  const where = (assessment: ToolAssessment) =>
    `target=${assessment.target ?? "-"} egress=${assessment.egress ?? "none"} egress_target=${
      assessment.egressTarget ?? "-"
    }`;

  /**
   * 送一条落库审计（结构化，与上面那行控制台输出并行，两条出口互不影响）。
   * `redacted` 传的是**已经按评估结论打码过**的值 —— 落库内容必须与模型看到的一致。
   */
  const emit = (
    outcome: AuditOutcome,
    decision: string,
    assessment: ToolAssessment,
    extra: { reason?: string | null; args?: unknown; result?: unknown } = {},
  ) => {
    const at = new Date().toISOString();
    persistAudit({
      id: auditEventId(at),
      at,
      tool: tool.name,
      owner: ctx.owner ?? AUDIT_FALLBACK_OWNER,
      threadId: ctx.threadId ?? null,
      risk: assessment.risk ?? tool.risk ?? "safe",
      outcome,
      decision,
      target: assessment.target ?? null,
      egress: assessment.egress ?? "none",
      egressTarget: assessment.egressTarget ?? null,
      summary: assessment.summary ?? null,
      reason: extra.reason ?? null,
      durationMs: Date.now() - started,
      args: auditSnapshot(redactResult(args, assessment)),
      result: auditSnapshot(extra.result ?? null),
    });
  };

  // 1) 拒绝名单 —— **最高优先级**。
  //    命中就不放行，**哪怕用户已经批准过、哪怕有一条有效 grant**：
  //    拒绝名单是运维侧的「这个能力在本部署上不存在」，授权是用户侧的「这次我同意」，
  //    前者不能被后者覆盖。注意这里在 grant 查询**之前**返回（顺序即优先级）。
  const denied = decideDeny(tool.name, deps.denyList);
  if (denied) {
    line("outcome=denied");
    emit("blocked", "denied", { risk: tool.risk ?? "safe" }, { reason: denied, args });
    throw new Error(
      blockedMessage(tool.name, denied, "改用一个在允许范围内的工具，或者把这件活交给用户自己决定。"),
    );
  }

  const owner = ctx.owner ?? AUDIT_FALLBACK_OWNER;
  const threadId = ctx.threadId ?? null;

  // 2) 有效 grant 命中 → 直接放行（P1b）。`once` 在这里被**原子**消耗，并发下只能过一个。
  //    grant 命中时**跳过第 3 步的评估** —— 判定顺序是硬要求，第 3 步排在这个命中之后。
  const backend = getApprovalBackend();
  const granted: GrantRecord | null = backend
    ? await backend.acquireGrant({ owner, tool: tool.name, threadId })
    : null;

  // 3) 评估：静态 risk + 逐次 assess 合并（assess 说的算）。P0 语义一字未改。
  let assessment: ToolAssessment = { risk: tool.risk ?? "safe" };
  if (!granted && tool.assess) {
    try {
      const perCall = await tool.assess(args);
      assessment = { ...assessment, ...perCall, risk: perCall.risk ?? assessment.risk };
    } catch (error) {
      // 评估自己坏了 → fail closed，不赌
      line(`outcome=assess_failed error=${error instanceof Error ? error.message : String(error)}`);
      emit("blocked", "assess_failed", { risk: tool.risk ?? "safe" }, {
        reason: "对这次调用的评估失败了，宁可拦住也不放行",
        args,
      });
      throw new Error(
        blockedMessage(
          tool.name,
          "对这次调用的评估失败了，宁可拦住也不放行",
          "把要说的话直接写给用户，或者稍后再试。",
        ),
      );
    }
  }

  // 4) 要拦就拦：敏感能力 / 结果外流 / 声明了要人先看的警告。
  //    有 grant 的调用走不到这里（P1b 第 2 步已放行）；没 grant → **登记一条待审批**，
  //    再回灌「等待审批」文案（别重试 / 已通知用户 / 批了同一个调用就会成功）。
  //
  //    `!granted` 是承重的一环：第 2 步命中授权时必须真的**放行**（单子 §2.2 判定顺序的第 2 条）。
  //    少了它，`needsApproval` 照样成立 —— 用户批准了还是被拦，而那条 `once` 授权
  //    已经在第 2 步被消耗掉，等于批准了个寂寞（这正是本用例钉住的那条）。
  if (!granted && needsApproval(assessment)) {
    const reason = pendingReason(assessment);
    if (backend) {
      // 登记的参数摘要**已经按评估结论脱敏 + 截断**，与审计行、与模型看到的内容一致。
      const approval = await backend.registerApproval({
        tool: tool.name,
        owner,
        threadId,
        risk: assessment.risk ?? tool.risk ?? "safe",
        reason,
        args: auditSnapshot(redactResult(args, assessment)),
      });
      if (approval) {
        line(
          `outcome=awaiting_approval approval=${approval.id} ${where(assessment)} summary=${
            assessment.summary ?? "-"
          }`,
        );
        emit("blocked", "awaiting_approval", assessment, { reason, args });
        throw new ToolApprovalPendingError(
          tool.name,
          approval.id,
          pendingApprovalMessage(tool.name, reason),
        );
      }
    }
    // 没有审批后端（或登记失败）→ P0 语义：直接拒批，理由仍是那句「没有可用的审批入口」。
    line(`outcome=refused ${where(assessment)} summary=${assessment.summary ?? "-"}`);
    emit("blocked", "refused", assessment, { reason: blockedReason(assessment), args });
    throw new Error(
      blockedMessage(
        tool.name,
        blockedReason(assessment),
        "不要换个说法再发同一个调用；请把这个动作留给用户自己确认。",
      ),
    );
  }

  // 5) 放行 → 执行（工具自己的错误原样抛出，本模块不吞）
  //    审计的 decision 记 `granted:<scope>`，所以复盘时一眼分得出「靠授权放的」还是「本来就能放」。
  const decision = granted ? `granted:${granted.scope}` : "ok";
  try {
    const raw = await tool.execute(args as never);
    line(`outcome=${decision} ${where(assessment)} summary=${assessment.summary ?? "-"}`);
    const redacted = redactResult(raw, assessment);
    emit("ok", decision, assessment, { args, result: redacted });
    return redacted;
  } catch (error) {
    line(
      `outcome=error ${where(assessment)} error=${
        error instanceof Error ? error.message.slice(0, 160) : String(error)
      }`,
    );
    emit("error", granted ? decision : "error", assessment, {
      reason: error instanceof Error ? error.message : String(error),
      args,
    });
    throw error;
  }
}
