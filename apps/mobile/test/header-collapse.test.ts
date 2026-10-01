import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEAD_ZONE,
  HEAD_TOP,
  markUserScroll,
  nextCollapse,
  resetUserScroll,
} from "../src/header-collapse";

test("往上翻页收起，往回翻立刻展开（不管翻到多深）", () => {
  markUserScroll(); // 收起只对用户拖动生效，见最后一条用例
  // 手指往上滑 = 页面往下翻 = y 在变大
  assert.equal(nextCollapse(300, 24, false), true, "往下翻页要收起");
  // 在很深的列表里往回翻一屏：也必须立刻展开，不是非要滚回顶部
  assert.equal(nextCollapse(4000, -24, true), false, "往回翻要立刻展开");
});

test("回到顶部附近一律展开", () => {
  markUserScroll();
  assert.equal(nextCollapse(HEAD_TOP, 60, true), false, "已经在顶部就该展开");
  assert.equal(nextCollapse(0, 0, true), false);
});

test("方向死区内保持原状：手指微抖不该让顶栏来回抽", () => {
  markUserScroll();
  assert.equal(nextCollapse(500, DEAD_ZONE, false), false);
  assert.equal(nextCollapse(500, -DEAD_ZONE, true), true);
  assert.equal(nextCollapse(500, 0, true), true);
  assert.equal(nextCollapse(500, 1, false), false);
});

test("用户还没拖过时不许收起（页面打开时的程序化滚动不算）", () => {
  resetUserScroll();
  assert.equal(nextCollapse(4000, 50, false), false, "自动滚动到最新不该把顶栏收掉");
  markUserScroll();
  assert.equal(nextCollapse(4000, 50, false), true, "用户拖动之后才按方向收起");
  resetUserScroll();
});
