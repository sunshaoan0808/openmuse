import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLLAPSE_AT,
  JUMP_PX,
  EXPAND_AT,
  HEAD_TOP,
  hasUserScrolled,
  markUserScroll,
  nextCollapse,
  resetUserScroll,
} from "../src/header-collapse";

test("快速单向滑动：往下翻页收起，往回翻立刻展开", () => {
  resetUserScroll();
  markUserScroll();
  assert.equal(nextCollapse(300, 24, false, Date.now()), true, "往下翻页要收起");
  assert.equal(nextCollapse(300, -24, true, Date.now()), false, "往回翻要展开");
});

test("没拖动过（程序化滚动）永不收起", () => {
  resetUserScroll();
  assert.equal(hasUserScrolled(), false);
  assert.equal(nextCollapse(300, 60, false), false);
});

test("顶部附近一律展开", () => {
  resetUserScroll();
  markUserScroll();
  assert.equal(nextCollapse(HEAD_TOP, 60, false), false, "已经在顶部就展开");
  assert.equal(nextCollapse(0, 60, true), false);
});

test("慢速上滑：累计够了就收起（不能永远不隐藏）", () => {
  resetUserScroll();
  markUserScroll();
  let collapsed = false;
  // 每帧只走 2px 的慢滑，累计 10px 就该收起
  for (let i = 0; i < COLLAPSE_AT / 2; i += 1) collapsed = nextCollapse(600, 2, collapsed);
  assert.equal(collapsed, true, "慢速上滑也必须能收起 —— 原来就是这里收不起来");
});

test("手指微抖不会让顶栏闪烁（真机反馈的那个 bug）", () => {
  resetUserScroll();
  markUserScroll();
  let collapsed = false;
  let flips = 0;
  // 慢速上滑 + 每两帧一次 1-2px 的反向抖动：状态最多只该翻转一次
  for (let i = 0; i < 40; i += 1) {
    const delta = i % 2 === 0 ? 2 : -1;
    const next = nextCollapse(700, delta, collapsed);
    if (next !== collapsed) flips += 1;
    collapsed = next;
  }
  assert.ok(flips <= 1, `抖动过程中状态翻转了 ${flips} 次，会看到闪烁`);
  assert.equal(collapsed, true, "抖动之后仍然应该收起");
});

test("收起后往回翻：要累计够 EXPAND_AT 才展开（迟滞）", () => {
  resetUserScroll();
  markUserScroll();
  let collapsed = nextCollapse(800, COLLAPSE_AT, false);
  assert.equal(collapsed, true);
  assert.equal(nextCollapse(700, -3, collapsed), true, "往回挪一点点不该立刻展开");
  let total = 3;
  while (total < EXPAND_AT) {
    total += 3;
    collapsed = nextCollapse(700, -3, collapsed);
  }
  assert.equal(collapsed, false, "累计够了才展开");
});

test("换页/程序化滚动的大跳变不改变顶栏状态（也不污染累计）", () => {
  resetUserScroll();
  markUserScroll();
  assert.equal(nextCollapse(5000, JUMP_PX + 1, false), false, "跳变不该让它收起");
  assert.equal(nextCollapse(800, -(JUMP_PX + 1), true), true, "跳变也不该让它展开");
  // 跳变之后，正常的慢速上滑依然能正常收起
  let collapsed = false;
  for (let i = 0; i < COLLAPSE_AT / 2; i += 1) collapsed = nextCollapse(600, 2, collapsed);
  assert.equal(collapsed, true);
});

test("非手指造成的滚动（自动跟随/重排）不改变顶栏，也不污染累计", () => {
  resetUserScroll();
  markUserScroll();
  const t0 = Date.now();
  // 窗口内：正常参与
  assert.equal(nextCollapse(600, 4, false, t0), false, "还没到阈值");
  // 窗口外（1.2 秒之后）：一次大位移也不该把它收起 —— 这就是"一直闪"的来源
  const late = t0 + 5000;
  assert.equal(nextCollapse(600, 120, false, late), false, "窗口外的位移不算拖动");
  assert.equal(nextCollapse(600, -120, true, late), true, "窗口外也不该被推着展开");
  // 重新触摸后恢复正常
  markUserScroll();
  let collapsed = false;
  for (let i = 0; i < COLLAPSE_AT / 2; i += 1) collapsed = nextCollapse(600, 2, collapsed, Date.now());
  assert.equal(collapsed, true);
});
