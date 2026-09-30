import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  activityFor,
  readActivities,
  recordActivity,
  withActivity,
} from "../apps/server/src/live-activity.ts";

let db: Store, directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-live-"));
  db = await createStore({ dataDir: directory });
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("工具调用翻译成人话，并带上最有信息量的参数", () => {
  assert.deepEqual(
    {
      text: activityFor("search_web", { query: "金球奖  今年 得主", count: 5 }).text,
      detail: activityFor("search_web", { query: "金球奖  今年 得主" }).detail,
    },
    { text: "正在搜索网页", detail: "金球奖 今年 得主" },
  );
  assert.equal(
    activityFor("browse_web", { url: "https://example.com/a" }).detail,
    "https://example.com/a",
  );
  assert.equal(activityFor("read_pages", { urls: ["a", "b"] }).detail, "2 个地址");
  assert.equal(activityFor("没见过的工具", {}).text, "正在使用 没见过的工具");
});

test("活动按会话分开存，超时后不再显示（不会串到别的会话）", async () => {
  const now = Date.now();
  await recordActivity(
    db,
    "local-user",
    activityFor(
      "search_web",
      { query: "上海 天气" },
      { at: new Date(now).toISOString(), threadId: "thread-a" },
    ),
  );
  await recordActivity(
    db,
    "local-user",
    activityFor(
      "browse_web",
      { url: "https://example.com" },
      { at: new Date(now).toISOString(), threadId: "thread-b" },
    ),
  );
  const fresh = await readActivities(db, "local-user", { now });
  assert.equal(fresh.length, 2, "两条会话各自一条");
  assert.equal(fresh.find((activity) => activity.threadId === "thread-a")?.detail, "上海 天气");
  assert.equal(fresh.find((activity) => activity.threadId === "thread-b")?.text, "正在打开网页");
  // 90 秒之后不再显示（界面不能一直说"正在搜索"）
  const stale = await readActivities(db, "local-user", { now: now + 2 * 60_000 });
  assert.deepEqual(stale, []);
});

test("withActivity 包住的工具照常执行，同时上报当前动作", async () => {
  const calls: string[] = [];
  const tools = [
    {
      name: "search_web",
      execute: async (args: { query: string }) => {
        calls.push(args.query);
        return { results: [] };
      },
    },
  ];
  const wrapped = withActivity(
    { service: { db }, owner: "local-user", threadId: "local-main" },
    tools,
  );
  const run = wrapped[0].execute as (args: { query: string }) => Promise<unknown>;
  const result = await run({ query: "水族馆 门票" });
  assert.deepEqual(result, { results: [] });
  assert.deepEqual(calls, ["水族馆 门票"]);
  const activity = (await readActivities(db, "local-user")).find(
    (item) => item.threadId === "local-main",
  );
  assert.equal(activity?.tool, "search_web");
  assert.equal(activity?.threadId, "local-main");
});
