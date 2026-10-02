import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { familyOf, foldActivity, stepsOfCurrentRun } from "../packages/domain/src/activity.ts";

test("连续的同类步骤合成一个任务（这是与 Muse 对齐的核心规则）", () => {
  const activity = foldActivity({
    steps: [{ name: "search_web" }, { name: "read_pages" }, { name: "read_pages" }],
    running: false,
  });
  assert.equal(activity.tasks.length, 1, "查网页的三步应该是一个任务");
  assert.equal(activity.tasks[0]?.title, "查网页");
  assert.equal(activity.tasks[0]?.count, 3);
  assert.equal(activity.tasks[0]?.subtitle, "查网页 ×3");
});

test("换类目才开新任务，且上一个任务自动收尾", () => {
  const activity = foldActivity({
    steps: [{ name: "search_web" }, { name: "write_computer_file" }, { name: "git_commit" }],
    running: false,
  });
  assert.deepEqual(
    activity.tasks.map((task) => [task.title, task.isDone]),
    [
      ["查网页", true],
      ["在电脑上干活", true],
      ["提交代码", true],
    ],
  );
});

test("还在跑时只有最后一个任务未完成（状态只有两态，不掺工具的 loading）", () => {
  const activity = foldActivity({
    steps: [{ name: "search_web" }, { name: "save_artifact" }],
    running: true,
  });
  assert.equal(activity.status, "ACTIVE");
  assert.deepEqual(
    activity.tasks.map((task) => task.isDone),
    [true, false],
  );
  // 跑完了就全部收尾
  const done = foldActivity({ steps: [{ name: "search_web" }, { name: "save_artifact" }], running: false });
  assert.equal(done.status, "COMPLETED");
  assert.deepEqual(
    done.tasks.map((task) => task.isDone),
    [true, true],
  );
});

test("没登记过的工具各自成一类，不糊在一起", () => {
  const activity = foldActivity({
    steps: [{ name: "some_new_tool" }, { name: "another_new_tool" }, { name: "some_new_tool" }],
    running: false,
    labelFor: (name) => `使用 ${name}`,
  });
  assert.deepEqual(
    activity.tasks.map((task) => task.title),
    ["使用 some_new_tool", "使用 another_new_tool", "使用 some_new_tool"],
  );
});

test("一次跑动 = 最后一条用户消息之后的所有步骤", () => {
  const steps = stepsOfCurrentRun([
    { role: "user" },
    { role: "assistant", toolCalls: [{ name: "search_web" }] },
    { role: "user" },
    { role: "assistant", toolCalls: [{ name: "save_artifact" }, { name: "git_commit" }] },
  ]);
  assert.deepEqual(
    steps.map((step) => step.name),
    ["save_artifact", "git_commit"],
    "只算最后一轮提问之后的步骤",
  );
});

test("用时只在给了起止时间时才算", () => {
  assert.equal(foldActivity({ steps: [{ name: "search_web" }], running: true }).durationMs, undefined);
  assert.equal(
    foldActivity({
      steps: [{ name: "search_web" }],
      running: false,
      startedAtMs: 1000,
      endedAtMs: 4500,
    }).durationMs,
    3500,
  );
  // 时钟回拨也不该出现负数
  assert.equal(
    foldActivity({ steps: [], running: false, startedAtMs: 5000, endedAtMs: 4000 }).durationMs,
    0,
  );
});

test("空跑动是合法的：没有任务、状态仍然明确", () => {
  const activity = foldActivity({ steps: [], running: true });
  assert.equal(activity.tasks.length, 0);
  assert.equal(activity.status, "ACTIVE");
});

test("工具名的两种形状都要认（App 用的是 {function:{name}}，踩过一次真坑）", () => {
  const steps = stepsOfCurrentRun([
    { role: "user" },
    {
      role: "assistant",
      toolCalls: [
        { function: { name: "search_web", arguments: "{}" } },
        { name: "read_pages" },
        { function: {} },
        {},
      ],
    },
  ]);
  assert.deepEqual(
    steps.map((step) => step.name),
    ["search_web", "read_pages"],
    "两种形状都认，取不到名字的跳过而不是塞一个 undefined",
  );
});

test("服务端每个真实工具名都要落到中文类目上（不许把英文工具名直接摆到界面）", () => {
  const sources = [
    "apps/server/src/engine/chat-tools.ts",
    "apps/server/src/engine/tool-kit.ts",
    "apps/server/src/computer-tools.ts",
    "apps/server/src/jev/tools.ts",
  ];
  const names = new Set<string>();
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/name: "([a-z][a-z_]*)"/g)) names.add(match[1] as string);
  }
  assert.ok(names.size >= 15, `只抓到 ${names.size} 个工具名，说明抓取方式坏了`);
  const unmapped = [...names].filter((name) => familyOf(name).title === name);
  assert.deepEqual(
    unmapped,
    [],
    `这些工具还没登记中文类目（界面会直接显示英文名）: ${unmapped.join(", ")}`,
  );
});
