import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { elapsedLabel, elapsedSeconds } from "../src/elapsed";

/**
 * 「已 X 秒」的活数字（对标 Muse 的子任务行 `…工作中 · N秒`）。
 * 静态数字答不了用户唯一的疑问——"它到底在动，还是卡住了"，所以这里既钉格式化，
 * 也钉住"它真的是每秒在动"这件事本身。
 */

test("秒数按整秒四舍五入，且不会出现负数", () => {
  assert.equal(elapsedSeconds(1_000, 6_400), 5);
  assert.equal(elapsedSeconds(1_000, 6_600), 6, "5.6 秒要进位到 6");
  assert.equal(elapsedSeconds(5_000, 4_000), 0, "时钟回拨时显示 0，不是 -1 秒");
});

test("用时文案复用全仓统一的人话格式", () => {
  assert.equal(elapsedLabel(0, 12_000), "已 12 秒");
  assert.equal(elapsedLabel(0, 80_000), "已 1 分 20 秒");
  assert.equal(elapsedLabel(0, 0), "已 0 秒");
});

const read = (name: string) => readFileSync(join(import.meta.dirname, "..", "src", name), "utf8");

test("计时器是 1 秒一跳（把它改成静态数字就失去了意义）", () => {
  assert.match(read("elapsed.ts"), /setInterval\(.*,\s*1000\)/, "必须是 1 秒的定时器");
});

test("聊天里的子任务行与跑动卡片都接上了活数字", () => {
  assert.match(read("running-tasks.tsx"), /useElapsedMs\(/, "子任务行要显示「已 X 秒」");
  assert.match(read("activity-card.tsx"), /useElapsedMs\(/, "跑动中卡片的用时也要在动");
});

test("代码块有「复制代码」，且复制前剥掉零宽字符", () => {
  const assistant = read("assistant-response.tsx");
  assert.match(assistant, /复制代码/, "代码块要有复制入口（Muse 是 HatchCodeBlock 的复制代码）");
  assert.match(
    assistant,
    /Clipboard\.setStringAsync\(code\.replace\(\/\\u200B\/g, ""\)\)/,
    "复制要剥零宽字符，否则粘贴回去带看不见的脏字符",
  );
});
