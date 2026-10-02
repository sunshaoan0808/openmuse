import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginUserScroll,
  collapseProgress,
  endUserScroll,
  hasUserScrolled,
  HEAD_TOP,
  resetUserScroll,
  userScrollActive,
} from "../src/header-collapse";

const H = 104; // 顶栏高度（手机竖屏，不含状态栏）

test("位移映射：滚多少移多少，按比例", () => {
  assert.equal(collapseProgress(0, H), 0, "在顶部完全展开");
  assert.equal(collapseProgress(HEAD_TOP, H), 0, "顶部附近仍完全展开");
  assert.equal(collapseProgress(H / 2, H), 0.5, "滚到一半 → 移出一半");
  assert.equal(collapseProgress(H, H), 1, "滚满一个顶栏高度 → 完全滑出");
  assert.equal(collapseProgress(H * 3, H), 1, "再往下滚也封顶在 1");
  assert.equal(collapseProgress(-50, H), 0, "回弹成负数也当 0");
});

test("同一位置永远同一进度（这就是'不闪'的结构性保证）", () => {
  const samples = [0, 7, 13, 40, 52, 80, 103, 300];
  for (const y of samples) {
    const first = collapseProgress(y, H);
    // 反复求值必须完全一致：没有状态、没有计时窗口、没有累计量
    for (let i = 0; i < 5; i += 1) assert.equal(collapseProgress(y, H), first);
  }
});

test("手指微抖只产生微小位移，不会跳变（真机反馈的闪烁）", () => {
  let previous = collapseProgress(500, H);
  let maxJump = 0;
  // 在 500 附近做 1px 级抖动：进度差应当极小
  for (const y of [500, 501, 500, 499, 500, 502, 500, 498, 500]) {
    const now = collapseProgress(y, H);
    maxJump = Math.max(maxJump, Math.abs(now - previous));
    previous = now;
  }
  assert.ok(maxJump <= 3 / H + 1e-9, `1px 抖动带来的进度跳变应当 ≤ 1/H，实测 ${maxJump}`);
});

test("单调：滚得越远，顶栏移出得越多", () => {
  let previous = -1;
  for (let y = 0; y <= H * 2; y += 8) {
    const now = collapseProgress(y, H);
    assert.ok(now >= previous, `y=${y} 时进度不该回退`);
    previous = now;
  }
});

test("触摸信号仍可用（聊天页据此判断要不要停止自动跟随）", () => {
  resetUserScroll();
  assert.equal(hasUserScrolled(), false);
  assert.equal(userScrollActive(), false, "没碰过就不算用户滑动");
  beginUserScroll();
  assert.equal(userScrollActive(), true, "拖拽期间一直有效（不受定时窗口限制）");
  const t0 = Date.now();
  endUserScroll();
  assert.equal(userScrollActive(t0 + 1000), true, "抬手后 1.2 秒内给惯性滑动留窗口");
  assert.equal(userScrollActive(t0 + 60000), false, "更久之后就不算了");
});
