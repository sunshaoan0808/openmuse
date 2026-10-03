import { Animated } from "react-native";
import { collapseProgress } from "./header-collapse";

/**
 * 顶栏的位移与磨砂。
 *
 * 位移（2026-10-02 改版）：**跟着滚动位移走** —— 进度 = clamp(滚动距离 / 顶栏高度, 0, 1)，
 * 手指往下翻多少顶栏就按比例上移多少，往回滚就按比例回来。不再做"检测方向再隐藏"：
 * 那套状态机（累计量 + 迟滞 + 触摸窗口）在慢速长拖时会因为窗口过期而不收，还会被
 * 自动滚动喂进位移导致抖动。位移映射是 y 的纯函数，**同一位置永远同一进度**，闪不了。
 *
 * 磨砂：照 Muse 的 ScrimScrollConnection —— 顶栏不依赖模糊（Android 上 BlurView 会退化成
 * 白色实底），只用一层画布色遮罩并驱动它的 opacity（能走原生驱动，代价最低）。
 */
/** 顶栏总高度（含状态栏那条）。外壳与对话页共用同一个值：位移映射的尺度必须一致。 */
export function chromeHeight(desktop: boolean, insetTop: number) {
  return (desktop ? 124 : 104) + insetTop;
}
/** 当前顶栏高度（App 渲染时设置一次，对话页直接复用，免得两边各算一份） */
let chromeHeightPx = 104;
export function setChromeHeight(px: number) {
  if (Number.isFinite(px) && px > 0) chromeHeightPx = px;
}
export function getChromeHeight() {
  return chromeHeightPx;
}

export const headerScrollY = new Animated.Value(0);
/** 顶栏的位移进度：0 = 完全展开，1 = 完全滑出视野 */
export const headerCollapse = new Animated.Value(0);

/** 直接用这个作为 ScrollView 的 onScroll（原生驱动 + 保留自己的 JS 逻辑走 listener）。 */
export function headerScrollHandler(
  listener?: (event: {
    nativeEvent: {
      contentOffset: { y: number };
      contentSize: { height: number };
      layoutMeasurement: { height: number };
    };
  }) => void,
) {
  const handler = Animated.event([{ nativeEvent: { contentOffset: { y: headerScrollY } } }], {
    // 必须用 JS 驱动：useNativeDriver: true 时 Animated.event 返回的是 AnimatedEvent **对象**
    // （只有 Animated.ScrollView / createAnimatedComponent 会调它的 __getHandler 取出函数），
    // 而这里是普通 ScrollView，React 派发滚动事件时会直接把它当函数调用，
    // release 包里就是 TypeError: Object is not a function → 无提示闪退。
    useNativeDriver: false,
    listener,
  });
  // 兜底：万一以后有人把它改回原生驱动，这里也不会把对象交给 ScrollView
  return typeof handler === "function" ? handler : () => {};
}

/** 传给各屏的 onScroll：顶栏随滚动位移 */
export { markUserScroll } from "./header-collapse";
export function trackHeaderCollapse(event: { nativeEvent: { contentOffset: { y: number } } }) {
  const y = Math.max(0, event.nativeEvent.contentOffset.y);
  headerCollapse.setValue(collapseProgress(y, chromeHeightPx));
}

/**
 * 顶栏位移（Muse 模型）：用 transform: translateY 只动像素、**不触发布局**。
 * 为什么必须这样：之前用 marginTop 位移 → 每帧改内容区视口高度 → chat.tsx 的 onLayout
 * 里"视口一变就 scrollToOffset 钉回"每帧触发 → 与滚动互相拉扯 = 慢滑持续闪烁的反馈环。
 */
export function headerTranslateY(height: number) {
  return headerCollapse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -height],
    extrapolate: "clamp",
  });
}

/** 旧接口：负 marginTop（会改布局，已不用于顶栏，保留给非滚动场景） */
export function headerMarginTop(height: number) {
  return headerCollapse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -height],
    extrapolate: "clamp",
  });
}

/** 遮罩不透明度：0 → 0.92（48px 之内渐变完）。 */
export function headerScrimOpacity() {
  return headerScrollY.interpolate({
    inputRange: [0, 48],
    outputRange: [0, 0.92],
    extrapolate: "clamp",
  });
}
