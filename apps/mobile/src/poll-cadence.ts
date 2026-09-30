import type { AgentWorkspace } from "../../../packages/domain/src/agent";

/** 干活时的轮询间隔（毫秒）。 */
export const BUSY_POLL_MS = 3000;
/** 空闲时的轮询间隔：链路跨境外时 3 秒一次太费，空转没必要。 */
export const IDLE_POLL_MS = 12000;

const ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "scheduled",
  "waiting_approval",
  "waiting_input",
]);

/** 有没有正在动的东西：在跑的任务，或本会话刚上报过的实时活动。 */
export function hasActiveWork(data?: AgentWorkspace): boolean {
  if (!data) return true;
  const tasks = data.tasks ?? [];
  if (tasks.some((task) => ACTIVE_STATUSES.has(String(task.status)))) return true;
  const live = (data as { live?: unknown[] }).live;
  return Array.isArray(live) && live.length > 0;
}

/** 下一次轮询等多久：有活干就跟得紧，闲着就放宽。 */
export function nextPollDelay(data?: AgentWorkspace): number {
  return hasActiveWork(data) ? BUSY_POLL_MS : IDLE_POLL_MS;
}
