import type { Store } from "./db.ts";

/**
 * 「智能体此刻在干什么」。
 *
 * 上游 App 的动态页只会显示任务的静态状态（等确认 / 还缺信息），看不出它现在究竟在做什么；
 * Muse 是一边干活一边把当前动作显示出来。这里在每次工具调用时把一条中文活动写进 store，
 * App 轮询 /api/agent 就能显示「正在搜索网页 · 金球奖 今年 得主」这样的实时状态。
 */
export type LiveActivity = {
  id: string;
  tool: string;
  text: string;
  detail: string;
  threadId?: string;
  at: string;
};

/** 工具名 → 说人话的当前动作。 */
const ACTIVITY_TEXT: Record<string, string> = {
  search_web: "正在搜索网页",
  read_pages: "正在读网页",
  browse_web: "正在打开网页",
  page_elements: "正在看页面结构",
  page_act: "正在操作网页",
  look_page: "正在看页面截图",
  read_image: "正在看图",
  read_mail_thread: "正在读邮件",
  search_mail: "正在翻邮件",
  delegate_task: "正在派活给后台",
  watch_page: "正在设置网页监控",
  create_goal: "正在定目标",
  remember_fact: "正在记下这条",
  agent_status: "正在看自己的状态",
};

/** 参数里最能说明"在干什么"的那个：查询词、网址、动作。 */
function detailOf(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  for (const key of ["query", "url", "urls", "action", "message", "title", "text", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim())
      return value.replace(/\s+/g, " ").trim().slice(0, 80);
    if (Array.isArray(value) && value.length) return `${value.length} 个地址`.slice(0, 80);
  }
  return "";
}

/** 一次工具调用对应的中文活动（纯函数，便于单测）。 */
export function activityFor(
  tool: string,
  args: unknown,
  options: { threadId?: string; at?: string } = {},
): LiveActivity {
  return {
    id: "current",
    tool,
    text: ACTIVITY_TEXT[tool] ?? `正在使用 ${tool}`,
    detail: detailOf(args),
    threadId: options.threadId,
    at: options.at ?? new Date().toISOString(),
  };
}

/** 写进 store（单条记录，后写覆盖前写）。失败不打扰这一轮对话。 */
export async function recordActivity(
  db: Store | undefined,
  owner: string,
  activity: LiveActivity,
): Promise<void> {
  if (!db) return;
  try {
    await db.put(owner, "live", activity);
  } catch {
    // 状态展示失败不影响干活
  }
}

/** App 读当前活动；超过 maxAgeMs 没更新就当成"空闲"不显示。 */
export async function readActivity(
  db: Store,
  owner: string,
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<LiveActivity | null> {
  const activity = await db.get<LiveActivity>(owner, "live", "current");
  if (!activity?.at) return null;
  const age = (options.now ?? Date.now()) - Date.parse(activity.at);
  if (!Number.isFinite(age) || age > (options.maxAgeMs ?? 3 * 60_000)) return null;
  return activity;
}

/**
 * 给一批中性工具套上"上报当前动作"的外壳：放在 chat-tools 里统一做，
 * 两条引擎（自带 / Mastra）都能拿到，不必在每个工具里各写一遍。
 */
export function withActivity<
  T extends { name: string; execute: (args: never) => Promise<unknown> },
>(context: { service: { db: Store }; owner: string; threadId: string }, tools: readonly T[]): T[] {
  return tools.map((tool) => {
    const wrapped = {
      ...tool,
      execute: async (args: never) => {
        void recordActivity(
          context.service?.db,
          context.owner,
          activityFor(tool.name, args, { threadId: context.threadId }),
        );
        return tool.execute(args);
      },
    };
    // 只换了 execute 的实现，schema 与描述原样保留
    return wrapped as T;
  });
}
