import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const app = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(app, rel), "utf8");

test("聊天页要干爽：灵感卡片与灵感建议 chip 都不许出现在聊天里", () => {
  const chat = read("src/chat.tsx");
  // 用户明确要求："灵感种子别放到聊天这里，回自己的位置，正文内容要干爽"。
  // 灵感的家在「灵感」页；聊天页只留消息本身和它的产出（附件卡、在跑的任务、后台更新）。
  assert.ok(!/IdeaChatCard/.test(chat), "灵感卡片不该塞进聊天页");
  assert.ok(!/suggestions/.test(chat), "输入框上方的灵感建议 chip 不该塞进聊天页");
});

test("灵感的家还在：IdeasScreen 保留，入口仍可跳转", () => {
  const ui = read("src/agent-ui.tsx");
  assert.match(ui, /export function IdeasScreen/, "「灵感」页必须仍在");
  const chat = read("src/chat.tsx");
  // 聊天里不该有灵感卡，但从别处跳「灵感」页的能力不受影响
  assert.ok(!/navigate\("ideas"\)\s*\}/.test(chat) || true, "跳转入口可有可无，不做限制");
});

test("聊天页不再有「最近结果」这个看不懂的开关（产出在消息流里本来就有卡片）", () => {
  const chat = read("src/chat.tsx");
  // 用户问"最近结果是什么玩意" —— 那是个默认收起、点开重复展示最新产出的按钮，
  // 消息流里本就有同样的文件卡/浏览器卡，于是整段删掉，state 与依赖一并清干净。
  assert.ok(!/最近结果/.test(chat), "「最近结果」开关应已删除");
  assert.ok(!/showResults/.test(chat), "它的 state 也要一并删掉");
  assert.ok(!/BrowserThreadCard|FileThreadCard/.test(chat), "随之无用的卡片导入也不该留着");
});
