import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginUserScroll,
  collapseProgress,
  endUserScroll,
  HEAD_TOP,
  hasUserScrolled,
  headerTranslateFor,
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

test("顶栏位移（像素）是 scroll offset 的纯函数：同一 y 永远同一位移、交错求值不串状态", () => {
  // 慢滑闪烁的根因（已修复）是位移触发布局重排 → 钉回逻辑被每帧触发 → 反馈环。
  // 这里钉死数学面：位移映射无状态——同一 offset 交错、反复求值必须逐位一致。
  const samples = [0, 12, 13, 26, 52, 78, 104, 160, 300];
  const firstPass = samples.map((y) => headerTranslateFor(y, H));
  for (let round = 0; round < 3; round += 1) {
    // 交错求值（先大后小再回头）：任何隐藏状态/hysteresis 都会让结果漂移
    const interleaved = [...samples]
      .reverse()
      .map((y) => headerTranslateFor(y, H))
      .reverse();
    assert.deepEqual(interleaved, firstPass, `第 ${round + 1} 轮交错求值出现漂移`);
  }
  for (let i = 0; i < samples.length; i += 1) {
    for (let repeat = 0; repeat < 5; repeat += 1)
      assert.equal(headerTranslateFor(samples[i], H), firstPass[i]);
  }
  // 与 collapseProgress 同一映射：translate = -progress × height
  for (const y of samples) assert.equal(headerTranslateFor(y, H), -collapseProgress(y, H) * H || 0);
  // 端点与 clamp
  assert.equal(headerTranslateFor(0, H), 0, "在顶部位移为 0");
  assert.equal(headerTranslateFor(HEAD_TOP, H), 0);
  assert.equal(headerTranslateFor(H, H), -H, "滚满一个顶栏高度 → 完全滑出（-height）");
  assert.equal(headerTranslateFor(H * 5, H), -H, "继续滚也封顶在 -height");
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
