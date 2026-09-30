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
  // 派活（任务引擎）用的工具
  set_plan: "正在排计划",
  read_workspace: "正在读工作区",
  import_pdf: "正在导入 PDF",
  inspect_pdf: "正在检查表单字段",
  fill_pdf: "正在填写 PDF",
  read_web: "正在读网页",
  save_artifact: "正在保存产物",
  prepare_email: "正在准备邮件",
  prepare_event: "正在准备日程",
  ask_user: "正在向你提问",
  finish_task: "正在交付结果",
  // 智能体电脑（沙箱）工具
  computer_status: "正在看电脑状态",
  write_computer_file: "正在电脑上写文件",
  read_computer_file: "正在读电脑上的文件",
  list_computer_files: "正在列电脑上的文件",
  run_computer_command: "正在电脑上执行命令",
};

/**
 * 任务时间线里的一步：标题=中文动作名，细节=参数里最能说明问题的那段。
 * 之前 model.ts 直接把工具的**英文描述**当标题写进事件（"Search the public web and get
 * ranked results with title, URL and snippet…"），于是任务详情里每一步都不可读。
 */
export function stepEventFor(
  tool: string,
  args: unknown,
  fallbackTitle?: string,
): { title: string; detail: string } {
  const live = ACTIVITY_TEXT[tool] ?? fallbackTitle ?? `使用工具 ${tool}`;
  return {
    // 时间线里是"已经发生的一步"，不是"此刻正在做"：把进行时的"正在"去掉
    title: live.startsWith("正在") ? live.slice(2) : live,
    detail: detailOf(args),
  };
}

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
    id: options.threadId || "current",
    tool,
    text: ACTIVITY_TEXT[tool] ?? `正在使用 ${tool}`,
    detail: detailOf(args),
    threadId: options.threadId,
    at: options.at ?? new Date().toISOString(),
  };
}

/**
 * 写进 store，**每条会话一条记录**（id 用会话号）。
 * 之前是全局一条：A 会话的"正在搜索…"会串到 B 会话的界面上（用户就撞到过这个）。
 */
export async function recordActivity(
  db: Store | undefined,
  owner: string,
  activity: LiveActivity,
): Promise<void> {
  if (!db) return;
  const id = activity.threadId || activity.id || "current";
  try {
    await db.put(owner, "live", { ...activity, id });
  } catch {
    // 状态展示失败不影响干活
  }
}

/**
 * App 读各会话的当前活动（新的在前）。超过 maxAgeMs 没更新的直接丢掉——
 * 时间窗要短（默认 90 秒），否则一轮跑完很久了界面还在说"正在搜索"。
 */
export async function readActivities(
  db: Store,
  owner: string,
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<LiveActivity[]> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 90_000;
  const records = await db.list<LiveActivity>(owner, "live");
  return records
    .filter((activity) => {
      const age = now - Date.parse(activity?.at ?? "");
      return Number.isFinite(age) && age <= maxAgeMs;
    })
    .sort((left, right) => right.at.localeCompare(left.at));
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
