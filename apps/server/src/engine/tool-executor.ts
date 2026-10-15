/**
 * 工具执行咽喉（Sentinel 式收口，P0 只做机制骨架）。
 *
 * 固定顺序，不许绕：
 *   拒绝名单 → 评估（静态 risk + 逐次 assess）→ 判定要拦就拦（拒批 + 人话理由）→ 放行 → 执行 → 结果脱敏 → 审计
 *
 * **最关键的一条**：没声明 `risk` / `assess` 的工具，执行路径的可见行为必须与改造前**逐字一致**——
 * 返回值原样返回、抛错原样抛出（本模块**不 catch 工具的错**）。仓库里工具靠 `throw` 表达失败
 * （见 chat-tools.ts:`创建账户需要同时提供 site…`），把抛错吞成 `{error}` 会改掉契约，
 * tests/site-accounts.test.ts 正是这么断言的。
 *
 * 本模块只依赖结构类型，不 import tool-kit.ts —— 免得与接线处形成运行时环。
 */
import { readToolDenyList } from "../config.ts";

/** 静态风险档位：`moderate` 放行但一定进审计；`sensitive` 默认不放行（P0 没有审批入口）。 */
export type ToolRisk = "safe" | "moderate" | "sensitive";

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

  // 1) 拒绝名单
  const denied = decideDeny(tool.name, deps.denyList);
  if (denied) {
    line("outcome=denied");
    throw new Error(
      blockedMessage(tool.name, denied, "改用一个在允许范围内的工具，或者把这件活交给用户自己决定。"),
    );
  }

  // 2) 评估：静态 risk + 逐次 assess 合并（assess 说的算）
  let assessment: ToolAssessment = { risk: tool.risk ?? "safe" };
  if (tool.assess) {
    try {
      const perCall = await tool.assess(args);
      assessment = { ...assessment, ...perCall, risk: perCall.risk ?? assessment.risk };
    } catch (error) {
      // 评估自己坏了 → fail closed，不赌
      line(`outcome=assess_failed error=${error instanceof Error ? error.message : String(error)}`);
      throw new Error(
        blockedMessage(
          tool.name,
          "对这次调用的评估失败了，宁可拦住也不放行",
          "把要说的话直接写给用户，或者稍后再试。",
        ),
      );
    }
  }

  // 3) 要拦就拦：敏感能力 / 结果外流 / 声明了要人先看的警告（P0 一律拒批）
  if (needsApproval(assessment)) {
    line(`outcome=refused ${where(assessment)} summary=${assessment.summary ?? "-"}`);
    throw new Error(
      blockedMessage(
        tool.name,
        blockedReason(assessment),
        "不要换个说法再发同一个调用；请把这个动作留给用户自己确认。",
      ),
    );
  }

  // 4) 放行 → 执行（工具自己的错误原样抛出，本模块不吞）
  try {
    const raw = await tool.execute(args as never);
    line(`outcome=ok ${where(assessment)} summary=${assessment.summary ?? "-"}`);
    return redactResult(raw, assessment);
  } catch (error) {
    line(
      `outcome=error ${where(assessment)} error=${
        error instanceof Error ? error.message.slice(0, 160) : String(error)
      }`,
    );
    throw error;
  }
}
