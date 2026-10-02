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
let dragActive = false;
let touchUntil = 0;
let pullUp = 0;
let pullDown = 0;

/**
 * 手指真的碰到/拖过屏幕时调用（onTouchStart / onScrollBeginDrag / onScrollEndDrag）。
 * 开一个窗口：**只有**窗口内的位移才当作"用户的拖动"参与判定。
 *
 * 为什么必须这样做：界面自己也会让列表滚动 —— 流式回复时自动跟随最新消息、每 12 秒轮询
 * 重渲染带来的重排，都会产生和手指一样的滚动事件。只用一个"碰过没有"的布尔闸门（原来那样）
 * 一旦置真就永远为真，这些自动位移就会被当成拖动，把顶栏推着来回抽（真机反馈：
 * "有顶栏的时候慢速滑动会一直闪，顶栏隐藏了之后才正常" —— 因为收起来之后它没得可抽了）。
 * 窗口给 1.2 秒：抬手后的惯性滑动仍然算数，而随后的程序化滚动就不算。
 */
export function markUserScroll() {
  userScrolled = true;
  touchUntil = Date.now() + 1200;
}
/** 手指按下/开始拖动：拖拽期间**一直**有效（慢速长拖可以超过 1 秒，不能靠过期时间）。 */
export function beginUserScroll() {
  userScrolled = true;
  dragActive = true;
  touchUntil = Date.now() + 1200;
}
/** 手指抬起：留给惯性滑动一段窗口 */
export function endUserScroll() {
  dragActive = false;
  touchUntil = Date.now() + 1200;
}
export function resetUserScroll() {
  userScrolled = false;
  dragActive = false;
  touchUntil = 0;
  pullUp = 0;
  pullDown = 0;
}
export function hasUserScrolled() {
  return userScrolled;
}
/** 此刻是否处于"用户手指造成的滚动"窗口内（聊天页用它判断该不该继续自动跟随） */
export function userScrollActive(now: number = Date.now()) {
  return userScrolled && (dragActive || now <= touchUntil);
}

export function nextCollapse(
  y: number,
  delta: number,
  collapsed: boolean,
  now: number = Date.now(),
): boolean {
  if (!userScrolled) return false;
  // 不是手指造成的滚动（自动跟随最新消息、重排、换页）：不参与判定，也不污染累计
  if (now > touchUntil) {
    pullUp = 0;
    pullDown = 0;
    return collapsed;
  }
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

// 仅 dev 构建：把判定内部状态挂到全局，验收环境（patchright）可以直接读，
// 免得靠猜哪一项卡住。生产构建里 __DEV__ 为 false，这段会被去掉。
// 只在 Web（验收环境）注册：APK 里 Platform.OS 是 android/ios，这段不会执行。
// （最初写的是 __DEV__，但在 Web 上它没成立，钩子被静默跳过，白查了一轮。）
if (typeof window !== "undefined") {
  (globalThis as unknown as Record<string, unknown>).__omCollapse = () => ({
    userScrolled,
    dragActive,
    pullUp,
    pullDown,
    touchUntil,
    sinceTouchMs: touchUntil - Date.now(),
  });
}
