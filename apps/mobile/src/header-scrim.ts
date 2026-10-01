import { Animated } from "react-native";
import { markUserScroll, nextCollapse } from "./header-collapse";

/**
 * 顶栏磨砂强度跟着滚动走（照 Muse 的 ScrimScrollConnection / ScrimConfig）。
 *
 * 停在顶部时几乎透明，一滚就把遮罩加厚——不是固定的一块磨砂。
 * 做法：顶栏不依赖模糊（Android 上 BlurView 会退化成白色实底），只用一层画布色遮罩，
 * 只动它的 opacity —— 静止时透明（内容从控件后面滚过去），滚动时加厚。
 * （opacity 能走原生驱动，代价最低）。
 */
/**
 * 顶栏总高度（含状态栏那条）。外壳用它算内容内边距与收起位移，对话页也用它 —— 共用一个函数，
 * 免得两边各算一份、改了一处忘了另一处。
 */
export function chromeHeight(desktop: boolean, insetTop: number) {
  return (desktop ? 124 : 104) + insetTop;
}

export const headerScrollY = new Animated.Value(0);

/**
 * 顶栏的收起程度：0 = 完全展开，1 = 完全滑出视野。
 *
 * 为什么按**方向**而不是按"滚了多远"（照 Muse 的 ScrimScrollState：它也是攒一个量、
 * threshold 到了才算满，而不是位置映射）：在列表深处往回翻一屏，顶栏应该立刻回来，
 * 而不是非要滚回顶部才出现。判定里留 2px 死区，免得手指微抖就来回抽。
 */
export const headerCollapse = new Animated.Value(0);
let lastOffset = 0;
let collapsed = false;

/** 传给各屏的 onScroll：往上翻页收起顶栏，往回翻或回到顶部就展开 */
export { markUserScroll } from "./header-collapse";

export function trackHeaderCollapse(event: { nativeEvent: { contentOffset: { y: number } } }) {
  const y = Math.max(0, event.nativeEvent.contentOffset.y);
  const delta = y - lastOffset;
  lastOffset = y;
  const want = nextCollapse(y, delta, collapsed);
  if (want === collapsed) return;
  collapsed = want;
  // 走 JS 驱动：动画的是 marginTop（布局属性，原生驱动不支持它）。
  // 这里必须是布局而不是 transform —— transform 只是视觉位移，顶栏原来的位置仍然占着，
  // 正文便不会被顶下去，滑走时也不会补上来（用户实测："白条压住了正文导致遮挡"）。
  Animated.timing(headerCollapse, {
    toValue: want ? 1 : 0,
    duration: want ? 180 : 140,
    useNativeDriver: false,
  }).start();
}

/**
 * 顶栏收起时的 marginTop：0 → -height。用**负外边距**而不是 transform，这样顶栏真的让出位置，
 * 正文会顶上来（transform 只动画面、不动排版）。
 */
export function headerMarginTop(height: number) {
  return headerCollapse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -height],
    extrapolate: "clamp",
  });
}

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

/** 遮罩不透明度：0 → 0.92（48px 之内渐变完）。 */
export function headerScrimOpacity() {
  return headerScrollY.interpolate({
    inputRange: [0, 48],
    outputRange: [0, 0.92],
    extrapolate: "clamp",
  });
}
