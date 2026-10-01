/**
 * 顶栏收起的**决策**部分（纯函数，刻意不引 react-native，好让 node 直接单测）。
 *
 * 规则：手指往上滑（往下翻页）收起；手指往下滑（往回翻）立刻展开；回到顶部附近一律展开。
 * 按"方向"而不是"滚了多远"：在列表深处往回翻一屏，顶栏应该马上回来，而不是非要滚回顶部。
 */

/** 顶部这么多像素以内一律展开 */
export const HEAD_TOP = 12;
/** 方向死区：手指微抖（1-2px 抖动）不该让顶栏来回抽 */
export const DEAD_ZONE = 2;

/**
 * 只有**用户真的拖动过**之后才允许收起。
 * 原因：进对话页会自动滚到最新消息，那是一次程序化滚动 —— 不设这道闸，页面一打开顶栏就是收起的。
 */
let userScrolled = false;
export function markUserScroll() {
  userScrolled = true;
}
export function resetUserScroll() {
  userScrolled = false;
}
export function hasUserScrolled() {
  return userScrolled;
}

export function nextCollapse(y: number, delta: number, collapsed: boolean): boolean {
  if (!userScrolled) return false;
  if (y <= HEAD_TOP) return false;
  if (delta > DEAD_ZONE) return true;
  if (delta < -DEAD_ZONE) return false;
  return collapsed;
}
