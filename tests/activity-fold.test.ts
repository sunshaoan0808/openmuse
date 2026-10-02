import assert from "node:assert/strict";
import { test } from "node:test";
import { activityForTask } from "../apps/server/src/engine/activity-fold.ts";

const ev = (taskId: string, date: string, tool: string, title = "正在搜索网页") => ({
  id: `${taskId}-${date}`,
  taskId,
  date,
  kind: "step" as const,
  title,
  detail: "",
  tool,
});

test("任务的运行事件折成任务流：连续的同类工具合成一个任务", () => {
  const activity = activityForTask(
    { id: "t1", status: "succeeded" },
    [
      ev("t1", "2026-10-02T01:00:00.000Z", "search_web"),
      ev("t1", "2026-10-02T01:00:20.000Z", "read_pages"),
      ev("t1", "2026-10-02T01:00:40.000Z", "read_pages"),
      ev("t1", "2026-10-02T01:01:00.000Z", "git_commit"),
    ],
  );
  assert.equal(activity.status, "COMPLETED");
  assert.deepEqual(
    activity.tasks.map((task) => [task.title, task.count, task.isDone]),
    [
      ["查网页", 3, true],
      ["提交代码", 1, true],
    ],
  );
  assert.equal(activity.durationMs, 60_000, "用时取首末两步的时间差");
});

test("还在跑的任务：最后一个任务未完成，且不给用时", () => {
  const activity = activityForTask(
    { id: "t2", status: "running" },
    [ev("t2", "2026-10-02T02:00:00.000Z", "save_document")],
  );
  assert.equal(activity.status, "ACTIVE");
  assert.deepEqual(activity.tasks.map((task) => task.isDone), [false]);
  assert.equal(activity.durationMs, undefined);
});

test("只看自己任务的事件，且按时间排序（事件在库里未必有序）", () => {
  const activity = activityForTask(
    { id: "t3", status: "succeeded" },
    [
      ev("t3", "2026-10-02T03:00:30.000Z", "git_commit"),
      ev("其他任务", "2026-10-02T03:00:10.000Z", "search_web"),
      ev("t3", "2026-10-02T03:00:00.000Z", "search_web"),
    ],
  );
  assert.deepEqual(
    activity.tasks.map((task) => task.title),
    ["查网页", "提交代码"],
    "别的任务的事件不能混进来，乱序要理顺",
  );
});
