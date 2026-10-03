/**
 * 顶栏收起的**决策**（纯函数，刻意不引 react-native，好让 node 直接单测）。
 *
 * 2026-10-02 改版：不再"检测滑动方向再隐藏"——改成**跟着滚动位移走**：
 *   进度 = clamp(滚动距离 / 顶栏高度, 0, 1)
 * 手指往下翻多少，顶栏就按比例上移多少；往回滚就按比例回来；到顶自然全在。
 *
 * 为什么换掉旧逻辑：旧的是"累计方向位移 + 迟滞 + 触摸窗口"，状态机里有计时窗口、
 * 有累计量，慢速长拖时窗口会过期、累计被清零 → 顶栏不收；而真机上各种自动滚动
 * （流式回复自动跟随、重排）又会喂进位移 → 抖动/闪烁。位移映射没有这些状态：
 * **同一个滚动位置永远得到同一个进度**，闪烁在结构上不可能发生。
 *
 * 触摸信号（begin/end/mark）保留：聊天页用它判断"是不是用户在滑动"，
 * 从而决定要不要停止自动跟随最新消息（那件事与顶栏无关，独立有用）。
 */

/** 顶部这么多像素以内一律完全展开 */
export const HEAD_TOP = 12;

/**
 * 顶栏收起进度：0 = 完全展开，1 = 完全滑出视野。
 * 纯函数、无状态 —— 这是"不闪"的结构性保证。
 */
export function collapseProgress(y: number, height: number): number {
  const h = Math.max(1, height);
  if (!Number.isFinite(y) || y <= HEAD_TOP) return 0;
  return Math.max(0, Math.min(1, y / h));
}

/**
 * 顶栏位移（像素，负值向上）：同一 scroll offset **永远**得到同一位移——
 * 位移映射无状态、无计时窗口、无累计量，"慢滑闪烁"的反馈环在数学上不可能发生。
 * 生产里的 headerTranslateY（Animated interpolate）与它是同一个映射；这个纯函数版本
 * 供单测钉死（也供 Web 验收台 scripts/accept-topbar.mjs 的判据 B 对照）。
 */
export function headerTranslateFor(y: number, height: number): number {
  const translate = -collapseProgress(y, height) * Math.max(1, height);
  return translate === 0 ? 0 : translate; // 归一化 -0：0 像素位移不该有符号
}

let userScrolled = false;
let dragActive = false;
let touchUntil = 0;

/** 手指真的碰到/拖过屏幕时调用（onTouchStart / onScrollBeginDrag）。 */
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
}
export function hasUserScrolled() {
  return userScrolled;
}
/** 此刻是否处于"用户手指造成的滚动"窗口内（聊天页用它判断该不该继续自动跟随） */
export function userScrollActive(now: number = Date.now()) {
  return userScrolled && (dragActive || now <= touchUntil);
}

// 仅 Web（验收环境）注册：APK 里 typeof window 为 "undefined"，这段不执行。
if (typeof window !== "undefined") {
  (globalThis as unknown as Record<string, unknown>).__omCollapseState = () => ({
    userScrolled,
    dragActive,
    sinceTouchMs: touchUntil - Date.now(),
  });
}
