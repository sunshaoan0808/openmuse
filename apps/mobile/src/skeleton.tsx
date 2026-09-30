import { useEffect, useRef, useState } from "react";
import { Animated, Easing, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { colors } from "./ui";

/**
 * 骨架屏（shimmer 微光）。
 *
 * 加载时先给出结构，而不是一个转圈 —— 这是"感觉快"和"感觉高级"里最便宜的一步。
 * 只用 RN 自带 Animated 做一条扫过的高光带，不引入渐变色库。
 */

const BAND_WIDTH = 130;
/** 稳定的占位行 id（不用数组下标做 key）。 */
const LINE_IDS = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10"];
const ROW_SHAPES = [
  { id: "r1", title: "74%", detail: "36%" },
  { id: "r2", title: "58%", detail: "46%" },
  { id: "r3", title: "68%", detail: "32%" },
  { id: "r4", title: "80%", detail: "42%" },
  { id: "r5", title: "62%", detail: "38%" },
  { id: "r6", title: "72%", detail: "44%" },
] as const;

function useBand(containerWidth: number) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (containerWidth <= 0) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1250,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [containerWidth, progress]);
  return progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-BAND_WIDTH, containerWidth],
  });
}

/** 一块会扫光的占位块。宽高既可props也可走 style。 */
export function Skeleton({
  width,
  height = 14,
  radius = 7,
  style,
}: {
  width?: ViewStyle["width"];
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [measured, setMeasured] = useState(0);
  const translateX = useBand(measured);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.line }, style]}
    >
      {measured > 0 && <Animated.View style={[styles.band, { transform: [{ translateX }] }]} />}
    </View>
  );
}

/** 多行文字占位，最后一行短一点更像真文本。 */
export function SkeletonText({
  lines = 3,
  height = 12,
  gap = 9,
  lastWidth = "62%",
  style,
}: {
  lines?: number;
  height?: number;
  gap?: number;
  lastWidth?: ViewStyle["width"];
  style?: StyleProp<ViewStyle>;
}) {
  const visible = LINE_IDS.slice(0, Math.max(0, lines));
  return (
    <View style={[{ gap }, style]}>
      {visible.map((id, position) => (
        <Skeleton
          key={id}
          height={height}
          width={position === visible.length - 1 && visible.length > 1 ? lastWidth : "100%"}
        />
      ))}
    </View>
  );
}

/** 聊天里的消息气泡占位（对齐左右两侧）。 */
export function SkeletonBubble({ mine = false, lines = 2 }: { mine?: boolean; lines?: number }) {
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", width: mine ? "62%" : "82%" }}>
      <Skeleton
        height={mine ? 44 : 18 * lines + 28}
        radius={22}
        style={{ borderBottomRightRadius: mine ? 7 : 22, borderBottomLeftRadius: mine ? 22 : 7 }}
      />
    </View>
  );
}

/** 列表行占位：左边一个图标方块 + 两行文字，跟仓库里的卡片风格一致。 */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 14 }}>
      {ROW_SHAPES.slice(0, Math.max(0, count)).map((row) => (
        <View key={row.id} style={[styles.row, { gap: 14 }]}>
          <Skeleton width={42} height={42} radius={13} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={row.title} height={13} />
            <Skeleton width={row.detail} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** 文档预览占位：几块"纸面"结构，用在 Office / PDF 加载时。 */
export function SkeletonDocument({ rows = 6 }: { rows?: number }) {
  return (
    <View style={styles.document}>
      <View style={{ gap: 10 }}>
        <Skeleton width="52%" height={18} />
        <Skeleton width="76%" height={11} />
      </View>
      <SkeletonText lines={rows} height={11} lastWidth="44%" />
      <Skeleton height={92} radius={12} />
      <SkeletonText lines={3} height={11} lastWidth="70%" />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: BAND_WIDTH,
    backgroundColor: "rgba(255,255,255,0.62)",
    borderRadius: 999,
  },
  row: { flexDirection: "row", alignItems: "center" },
  document: {
    gap: 14,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
});
