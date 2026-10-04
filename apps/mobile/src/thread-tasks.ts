import type { AgentTask } from "../../../packages/domain/src/agent";

/**
 * 哪些后台任务该显示在当前会话里（Muse 那边是 activeSubAgents / SubAgentRow）。
 * 规则与审批卡一致：标了会话的只在本会话显示；没标的留在主聊天，避免漏掉。
 */
export function visibleTasks(
  tasks: readonly AgentTask[],
  options: { threadId: string; mainId: string; threadsEnabled: boolean },
): AgentTask[] {
  return tasks
    .filter((task) => !["succeeded", "failed", "cancelled"].includes(task.status))
    .filter((task) =>
      task.threadId
        ? task.threadId === options.threadId
        : !options.threadsEnabled || options.threadId === options.mainId,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** 一个任务的进度：已完成步数 / 总步数。 */
export function taskProgress(task: AgentTask) {
  const steps = Array.isArray(task.plan) ? task.plan : [];
  const done = steps.filter((step) => step.status === "succeeded").length;
  return { done, total: steps.length };
}

/** 算「在跑」的状态集合：头部文案与「已 X 秒」的起点判定共用同一份，避免两处漂移。 */
const RUNNING_STATUSES: readonly string[] = ["running", "queued", "scheduled"];

/** 头部文案：几个在跑、几个在等、几个已完成（Muse 用 activeSubAgentCount/completedSubAgents 表达同一件事）。 */
export function taskSummary(tasks: readonly AgentTask[]) {
  const running = tasks.filter((task) => RUNNING_STATUSES.includes(task.status)).length;
  const waiting = tasks.filter((task) =>
    ["waiting_input", "waiting_approval"].includes(task.status),
  ).length;
  const done = tasks.filter((task) => task.status === "succeeded").length;
  return { running, waiting, done, total: tasks.length };
}

/**
 * 跑动中的任务里**最早**的那个开始时间（毫秒）。
 *
 * 给「已 X 秒」的活数字当起点：有多个在跑时，取最早的那个才对应"我从什么时候开始等的"。
 * `createdAt` 是 ISO 串；解析不出来就返回 undefined —— 宁可不显示秒数，也不假装有个数字。
 */
export function runningStartMs(tasks: readonly AgentTask[]): number | undefined {
  const times = tasks
    .filter((task) => RUNNING_STATUSES.includes(task.status))
    .map((task) => Date.parse(task.createdAt))
    .filter((ms) => Number.isFinite(ms));
  return times.length ? Math.min(...times) : undefined;
}
