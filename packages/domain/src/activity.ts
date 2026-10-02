/**
 * 一次跑动（run）的任务流折叠 —— 与 Muse 的 `SubAgentActivityState` / `SubAgentTaskInfo` 对齐。
 *
 * 为什么要有这一层：我们原来把**工具调用**一对一渲染成卡片，用户看到的是"它调了啥"；
 * Muse 展示的是**任务**（`title` + `subtitle` + `isDone`）串成的时间线，用户看到的是"它在干什么"。
 * 折叠规则就一条：**连续的同类步骤算同一个任务**（换了类目才开新任务），和人的读法一致。
 *
 * 纯函数：输入是这一步的列表，输出是可直接渲染的任务流；没有 IO，两边（App / 服务端）都能用。
 */

/** 折叠的输入：一次跑动里按顺序发生的工具调用 */
export interface ActivityStep {
  /** 工具名，例如 search_web / write_computer_file */
  name: string;
  /** 这一步成功了吗；未传按"已发生"处理 */
  ok?: boolean;
}

/** 渲染用的任务行（对应 Muse 的 SubAgentTaskInfo） */
export interface ActivityTask {
  /** 同类步骤共用的 key（稳定的，便于做动画与去重） */
  key: string;
  title: string;
  /** 人话的一行状态，例如 "读网页 ×3" */
  subtitle: string;
  isDone: boolean;
  /** 这一步合并了几次工具调用 */
  count: number;
}

export type ActivityStatus = "ACTIVE" | "COMPLETED";

/** 折叠结果（对应 Muse 的 SubAgentActivityState：状态 + 任务表 + 起始时间） */
export interface RunActivity {
  status: ActivityStatus;
  /** 这一步合并了几次工具调用 */
  tasks: ActivityTask[];
  startedAtMs?: number;
  durationMs?: number;
}

/**
 * 工具名 → 任务类目。
 *
 * 类目划分照"人怎么记事"：查网页 / 操作网页 是两件事，翻邮件和准备邮件是一件事，
 * 写文件、跑命令都归"在电脑上干活"。没列到的工具**各自成一类**（key 用工具名本身），
 * 宁可多一行，也不要把不相干的步骤糊成一坨。
 */
const FAMILIES: { key: string; title: string; tools: readonly string[] }[] = [
  { key: "web-read", title: "查网页", tools: ["search_web", "read_pages", "read_web"] },
  {
    key: "web-act",
    title: "操作网页",
    tools: ["browse_web", "page_elements", "page_act", "look_page", "watch_page"],
  },
  { key: "mail", title: "处理邮件", tools: ["search_mail", "read_mail_thread", "prepare_email"] },
  { key: "image", title: "看图", tools: ["read_image"] },
  { key: "plan", title: "排计划", tools: ["set_plan"] },
  { key: "delegate", title: "派活", tools: ["delegate_task"] },
  {
    key: "context",
    title: "整理上下文",
    tools: ["create_goal", "read_workspace", "remember_fact", "agent_status"],
  },
  {
    key: "artifact",
    title: "产出文件",
    tools: ["import_pdf", "inspect_pdf", "fill_pdf", "save_artifact", "finish_task"],
  },
  {
    key: "computer",
    title: "在电脑上干活",
    tools: [
      "computer_status",
      "write_computer_file",
      "read_computer_file",
      "list_computer_files",
      "run_computer_command",
    ],
  },
  { key: "git", title: "提交代码", tools: ["git_commit", "git_push"] },
  { key: "ask", title: "问你", tools: ["ask_user", "present_choices"] },
];

const FAMILY_OF = new Map<string, { key: string; title: string }>();
for (const family of FAMILIES) {
  for (const tool of family.tools) FAMILY_OF.set(tool, { key: family.key, title: family.title });
}

/** 工具名 → 类目（未登记的工具各自成一类） */
export function familyOf(name: string, label = name): { key: string; title: string } {
  return FAMILY_OF.get(name) ?? { key: `tool:${name}`, title: label };
}

/**
 * 把一次跑动的步骤折成任务流。
 *
 * 规则（与 Muse 的读法一致）：
 * - 连续的同类步骤 → 同一个任务，`count` 累加，`subtitle` 反映最近一次；
 * - 类目一变 → 上一个任务收尾（isDone = true），新任务开始；
 * - 跑动还在进行时，**最后一个任务**是未完成的（isDone = false），其余都已完成；
 *   跑动结束时全部置为已完成 —— 状态只有 ACTIVE / COMPLETED 两态，不把工具的 loading 混进来。
 */
export function foldActivity(input: {
  steps: readonly ActivityStep[];
  running: boolean;
  startedAtMs?: number;
  endedAtMs?: number;
  /** 把工具名换成人话（App 传自己的标签函数；不传就用工具名） */
  labelFor?: (name: string) => string;
}): RunActivity {
  const labelFor = input.labelFor ?? ((name: string) => name);
  const tasks: ActivityTask[] = [];
  for (const step of input.steps) {
    const family = familyOf(step.name, labelFor(step.name));
    const last = tasks[tasks.length - 1];
    if (last && last.key === family.key) {
      last.count += 1;
      last.subtitle = `${family.title} ×${last.count}`;
      continue;
    }
    tasks.push({
      key: family.key,
      title: family.title,
      subtitle: family.title,
      isDone: true,
      count: 1,
    });
  }
  // 还在跑：最后一个任务标成未完成（前面的一律算完成）
  if (input.running && tasks.length) {
    const last = tasks[tasks.length - 1];
    if (last) last.isDone = false;
  }
  const ended = input.endedAtMs;
  return {
    status: input.running ? "ACTIVE" : "COMPLETED",
    tasks,
    startedAtMs: input.startedAtMs,
    durationMs:
      input.startedAtMs !== undefined && ended !== undefined
        ? Math.max(0, ended - input.startedAtMs)
        : undefined,
  };
}

/**
 * 从一次对话的步骤里取"当前这一段跑动"：最后一条用户消息之后的所有步骤。
 * 一次用户提问 = 一次跑动，这和 Muse 的 activity 边界一致（也是人理解的边界）。
 */
export function stepsOfCurrentRun(
  messages: readonly { role: string; toolCalls?: readonly unknown[] }[],
): ActivityStep[] {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      start = i;
      break;
    }
  }
  const steps: ActivityStep[] = [];
  for (const message of messages.slice(start)) {
    for (const call of message.toolCalls ?? []) {
      const name = toolNameOf(call);
      if (name) steps.push({ name });
    }
  }
  return steps;
}

/**
 * 工具名要认两种形状，别只看一种（这里踩过一次真坑）：
 * - `{ name }`               —— AG-UI 直出的形状
 * - `{ function: { name } }` —— OpenAI / CopilotKit 客户端给的形状（App 里就是这个）
 */
export function toolNameOf(call: unknown): string {
  const shaped = call as { name?: unknown; function?: { name?: unknown } } | null | undefined;
  const nested = typeof shaped?.function?.name === "string" ? shaped.function.name : "";
  const flat = typeof shaped?.name === "string" ? shaped.name : "";
  return nested || flat;
}

/** 用时的人话格式：12 秒 / 1 分 20 秒 / 1 小时 2 分（不显示毫秒，秒以下四舍五入到秒） */
export function formatDurationMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
}
