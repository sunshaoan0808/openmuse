/**
 * 顶栏收起的**决策**部分（纯函数，刻意不引 react-native，好让 node 直接单测）。
 *
 * 规则：手指往上滑（往下翻页）收起；手指往下滑（往回翻）展开；回到顶部附近一律展开。
 * 按"方向"而不是"滚了多远"：在列表深处往回翻一屏，顶栏应该马上回来，而不是非要滚回顶部。
 *
 * 为什么是**累计 + 迟滞**而不是逐帧判方向：
 * 慢速滑动每帧只走 1-2px，方向会随手指微抖反复变号。逐帧判的话顶栏会一秒内抽十几下
 * （真机反馈：慢速上滑时顶栏不停闪烁且不隐藏 —— 每次翻转都把动画重置回起点，永远收不完）。
 * 所以：朝一个方向**累计**够 COLLAPSE_AT 才收起、累计够 EXPAND_AT 才展开；方向一变计数清零。
 * 展开阈值比收起大，形成迟滞，抖不回去。
 */
/** 顶部这么多像素以内一律展开 */
export const HEAD_TOP = 12;
/** 累计向上（往下翻页）这么多 → 收起 */
export const COLLAPSE_AT = 10;
/** 累计向下（往回翻）这么多 → 展开（比收起大，形成迟滞） */
export const EXPAND_AT = 20;
/** 单帧位移超过这个数就不当"拖动"，而是换页/程序化滚动造成的跳变：不参与累计 */
export const JUMP_PX = 200;

/**
 * 只有**用户真的拖动过**之后才允许收起。
 * 原因：进对话页会自动滚到最新消息，那是一次程序化滚动 —— 不设这道闸，页面一打开顶栏就是收起的。
 */
let userScrolled = false;
let pullUp = 0;
let pullDown = 0;

export function markUserScroll() {
  userScrolled = true;
}
export function resetUserScroll() {
  userScrolled = false;
  pullUp = 0;
  pullDown = 0;
}
export function hasUserScrolled() {
  return userScrolled;
}

export function nextCollapse(y: number, delta: number, collapsed: boolean): boolean {
  if (!userScrolled) return false;
  if (y <= HEAD_TOP) {
    pullUp = 0;
    pullDown = 0;
    return false;
  }
  // 跳变（切换页面、程序化滚到最新）不是手指拖动，别拿它改变顶栏状态
  if (Math.abs(delta) > JUMP_PX) {
    pullUp = 0;
    pullDown = 0;
    return collapsed;
  }
  if (delta > 0) {
    pullUp += delta;
  } else if (delta < 0) {
    pullDown += -delta;
  }
  // 净值口径：往回的位移**抵扣**往前的累计，而不是把它清零。
  // 清零的话，慢速上滑里每两帧夹一次 1px 抖动就永远攒不够阈值 —— 顶栏照样不隐藏。
  if (pullUp > 0 && pullDown > 0) {
    const eaten = Math.min(pullUp, pullDown);
    pullUp -= eaten;
    pullDown -= eaten;
  }
  if (!collapsed && pullUp >= COLLAPSE_AT) {
    pullUp = 0;
    return true;
  }
  if (collapsed && pullDown >= EXPAND_AT) {
    pullDown = 0;
    return false;
  }
  return collapsed;
}
