import { Animated } from "react-native";

/**
 * 顶栏磨砂强度跟着滚动走（照 Muse 的 ScrimScrollConnection / ScrimConfig）。
 *
 * 停在顶部时几乎透明，一滚就把遮罩加厚——不是固定的一块磨砂。
 * 做法：顶栏不依赖模糊（Android 上 BlurView 会退化成白色实底），只用一层画布色遮罩，
 * 只动它的 opacity —— 静止时透明（内容从控件后面滚过去），滚动时加厚。
 * （opacity 能走原生驱动，代价最低）。
 */
export const headerScrollY = new Animated.Value(0);

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
