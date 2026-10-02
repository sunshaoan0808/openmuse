import { foldActivity, type RunActivity } from "../../../../packages/domain/src/activity.ts";
import type { RunEvent } from "../../../../packages/domain/src/agent.ts";

/**
 * 把一个任务的运行事件折成任务流（与 App 聊天页用的是**同一个** foldActivity）。
 *
 * 为什么放在服务端：任务引擎的步骤本来就在 run-events 里（step 事件带 tool），
 * 折一次就能直接下发；这样"任务流"不再是客户端各写一份的东西。
 * 纯粹的输入输出，便于单测。
 */
export function activityForTask(
  task: { id: string; status: string },
  events: readonly RunEvent[],
): RunActivity {
  const steps = events
    .filter((event) => event.taskId === task.id && event.kind === "step")
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = steps[0];
  const last = steps[steps.length - 1];
  const running = task.status === "queued" || task.status === "running";
  return foldActivity({
    steps: steps.map((event) => ({ name: event.tool ?? event.title })),
    running,
    startedAtMs: first ? Date.parse(first.date) : undefined,
    // 还在跑就不给终点，用时由调用方按当下算
    endedAtMs: !running && last ? Date.parse(last.date) : undefined,
  });
}
