import type { LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

/**
 * 统一的动效节奏。
 *
 * 目标不是花哨，而是"就手"：按压有轻微物理感、进出场短促不拖沓、循环动效幅度小。
 * 全部基于 React Native 自带 Animated（不加 reanimated / gesture-handler，
 * 也就不需要改 babel 配置或重建原生工程）。
 */
export const motion = {
  /** 轻碰一下的时长 */
  quick: 130,
  /** 常规进出场 */
  normal: 220,
  /** 面板、整屏过渡 */
  slow: 320,
} as const;

/** 按下收紧用：略紧、回弹快 */
const pressIn = { damping: 16, stiffness: 320, mass: 0.5, useNativeDriver: true } as const;
/** 松手回位用：柔和一点，带一点回弹 */
const pressOut = { damping: 14, stiffness: 220, mass: 0.6, useNativeDriver: true } as const;

/** 按压缩放：手指按下轻微收紧、松手弹回。替代写死的 `transform: scale(0.94)`。 */
export function usePressScale(scaleTo = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = useCallback(() => {
    Animated.spring(scale, { toValue: scaleTo, ...pressIn }).start();
  }, [scale, scaleTo]);
  const onPressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, ...pressOut }).start();
  }, [scale]);
  return { scale, onPressIn, onPressOut };
}

/**
 * 入场：淡入 + 轻微上浮（可选轻微缩放）。用于消息气泡、卡片、状态行。
 * 只在挂载时跑一次。
 */
export function useRiseIn({
  delay = 0,
  distance = 8,
  from = 0.98,
  duration = motion.normal,
  enabled = true,
}: {
  delay?: number;
  distance?: number;
  from?: number;
  duration?: number;
  /** false 表示直接以最终状态出现（用于历史消息，避免一次刷出一屏动画） */
  enabled?: boolean;
} = {}) {
  const progress = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => {
    if (!enabled) return;
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, duration, enabled, progress]);
  return {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) },
    ],
  };
}

/** 呼吸循环：聆听中的麦克风、思考中的小圆点。返回 0..1 循环值。 */
export function usePulse({
  duration = 900,
  delay = 0,
  easing = Easing.inOut(Easing.quad),
}: {
  duration?: number;
  delay?: number;
  easing?: (value: number) => number;
} = {}) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, delay, easing, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, duration, easing, value]);
  return value;
}

/** 面板从下方进入：透明度 + 位移 + 轻微缩放，让"详情"不再是硬切。 */
export function useSheetEntrance({ distance = 26, from = 0.97, duration = motion.slow } = {}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [duration, progress]);
  return {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) },
    ],
  };
}

/** 0..1 的进度值做一次动画（骨架屏扫光、下拉回弹都用它）。 */
export function useProgress({ duration = motion.normal, delay = 0 } = {}) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(value, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, duration, value]);
  return value;
}

/** 屏幕坐标里的一个矩形（`measureInWindow` 的返回值）。 */
export interface HeroRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 共享元素式过渡的"来源卡片"：列表项在按下时量出自己的矩形，
 * 交给详情面板，让面板从那块矩形里长出来（返回时再飞回去）。
 */
export interface HeroCard {
  rect: HeroRect;
  title: string;
  subtitle?: string;
  /** 卡片上的那个小图标底色/图标，飞行途中保持一致 */
  tint?: string;
  icon?: LucideIcon;
}
