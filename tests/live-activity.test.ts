import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  activityFor,
  readActivity,
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

test("活动写进 store，超时后读成空（App 就不显示陈旧状态）", async () => {
  const now = Date.now();
  await recordActivity(
    db,
    "local-user",
    activityFor("search_web", { query: "上海 天气" }, { at: new Date(now).toISOString() }),
  );
  const fresh = await readActivity(db, "local-user", { now });
  assert.equal(fresh?.text, "正在搜索网页");
  assert.equal(fresh?.detail, "上海 天气");
  // 4 分钟前的不再显示
  const stale = await readActivity(db, "local-user", { now: now + 4 * 60_000 });
  assert.equal(stale, null);
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
  const activity = await readActivity(db, "local-user");
  assert.equal(activity?.tool, "search_web");
  assert.equal(activity?.threadId, "local-main");
});
