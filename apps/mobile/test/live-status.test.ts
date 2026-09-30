import assert from "node:assert/strict";
import { test } from "node:test";
import { actionDetail, agentActionLabel, relativeTime } from "../src/labels";

test("工具名说成人话", () => {
  assert.equal(agentActionLabel("search_web"), "正在搜索网页");
  assert.equal(agentActionLabel("browse_web"), "正在打开网页");
  assert.equal(agentActionLabel("未知工具"), "正在使用 未知工具");
});

test("从参数里挑最有信息量的那个值", () => {
  assert.equal(actionDetail({ query: "  金球奖   今年 得主 " }), "金球奖 今年 得主");
  assert.equal(actionDetail({ urls: ["a", "b", "c"] }), "3 个地址");
  assert.equal(actionDetail({}), "");
  assert.equal(actionDetail("字符串不是参数"), "");
  const long = actionDetail({ query: "东".repeat(120) }, 10);
  assert.equal(long.length, 11);
  assert.ok(long.endsWith("…"));
});

test("相对时间有刚刚/秒/分钟/小时", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  assert.equal(relativeTime("2026-09-30T12:00:00.000Z", now), "刚刚");
  assert.equal(relativeTime("2026-09-30T11:59:40.000Z", now), "20 秒前");
  assert.equal(relativeTime("2026-09-30T11:55:00.000Z", now), "5 分钟前");
  assert.equal(relativeTime("2026-09-30T09:00:00.000Z", now), "3 小时前");
  assert.equal(relativeTime("不是时间", now), "");
});
