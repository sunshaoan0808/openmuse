import { Animated } from "react-native";

/**
 * 顶栏磨砂强度跟着滚动走（照 Muse 的 ScrimScrollConnection / ScrimConfig）。
 *
 * 停在顶部时几乎透明，一滚就把遮罩加厚——不是固定的一块磨砂。
 * 做法：BlurView 强度固定，另外叠一层画布色遮罩，只动它的 opacity
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
  return Animated.event([{ nativeEvent: { contentOffset: { y: headerScrollY } } }], {
    useNativeDriver: true,
    listener,
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
