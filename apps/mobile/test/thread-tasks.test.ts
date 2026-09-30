import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTask } from "../../../packages/domain/src/agent";
import { taskProgress, taskSummary, visibleTasks } from "../src/thread-tasks";

const task = (partial: Partial<AgentTask> & { id: string }): AgentTask =>
  ({
    title: partial.id,
    status: "running",
    kind: "agent",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    plan: [],
    ...partial,
  }) as AgentTask;

test("只显示没结束的任务，且按会话归属过滤", () => {
  const tasks = [
    task({ id: "a", threadId: "t1", status: "running" }),
    task({ id: "b", threadId: "t2", status: "running" }),
    task({ id: "c", status: "running" }), // 没标会话 → 留在主聊天
    task({ id: "d", threadId: "t1", status: "succeeded" }),
    task({ id: "e", threadId: "t1", status: "cancelled" }),
  ];
  const inMain = visibleTasks(tasks, { threadId: "main", mainId: "main", threadsEnabled: true });
  assert.deepEqual(side(inMain), ["c"], "主聊天只看到没标会话的那条");
  const inSide = visibleTasks(tasks, { threadId: "t1", mainId: "main", threadsEnabled: true });
  assert.deepEqual(side(inSide), ["a"], "侧会话只看到自己的，已完成/取消的不显示");
});

function side(tasks: AgentTask[]) {
  return tasks.map((item) => item.id).sort();
}

test("进度与汇总", () => {
  const running = task({
    id: "r",
    status: "running",
    plan: [
      { id: "s1", title: "一", status: "succeeded" },
      { id: "s2", title: "二", status: "succeeded" },
      { id: "s3", title: "三", status: "running" },
    ] as AgentTask["plan"],
  });
  assert.deepEqual(taskProgress(running), { done: 2, total: 3 });
  const waiting = task({ id: "w", status: "waiting_input" });
  const done = task({ id: "d", status: "succeeded" });
  assert.deepEqual(taskSummary([running, waiting, done]), {
    running: 1,
    waiting: 1,
    done: 1,
    total: 3,
  });
});
