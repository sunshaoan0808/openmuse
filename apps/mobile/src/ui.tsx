import { ArrowUpRight, Check, ChevronRight, type LucideIcon, X } from "lucide-react-native";
import { type ComponentRef, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hapticSettle, hapticTap } from "./haptics";
import { type HeroCard, type HeroRect, usePressScale, useRiseIn, useSheetEntrance } from "./motion";
import { useAndroidKeyboardInset } from "./use-android-keyboard-inset";

/** 按压缩放交给 Animated（写死的 transform: scale 没有回弹，手感是"顿"的）。 */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export const colors = {
  canvas: "#FCFCFC",
  card: "#FFFFFF",
  text: "#11191C",
  muted: "#697176",
  line: "#EEEEF0",
  blue: "#C8E7FF",
  blueDark: "#1473C8",
  sky: "#EDF7FD",
  green: "#E3F3E8",
  lavender: "#F0EEFA",
  orange: "#FDF0DF",
  danger: "#AA4A45",
};
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // 排版节奏：正文保持 1.4~1.5 倍行高（中文需要这点余量），标题收紧行高与字距，
  // 小字与按钮文字补上显式行高，避免混排时基线跳动。
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 23,
    borderWidth: 0,
    borderColor: colors.line,
    padding: 20,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    backgroundColor: "#FFF",
    minHeight: 45,
  },
  field: { gap: 7, marginBottom: 16 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 17,
    minHeight: 42,
    paddingVertical: 10,
    borderRadius: 24,
  },
  primary: { backgroundColor: colors.blue },
  secondary: { backgroundColor: "#F1F2F3" },
  buttonText: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
  },
  chipText: { fontSize: 10, fontWeight: "600", color: colors.muted },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.sky,
  },
  error: { padding: 16, borderRadius: 14, backgroundColor: "#FBEFED", marginVertical: 10, gap: 4 },
  modalShade: {
    flex: 1,
    backgroundColor: "rgba(35,48,44,0.25)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderRadius: 26,
    width: "100%",
    maxWidth: 790,
    maxHeight: "94%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  // 共享元素过渡时单独铺一层遮罩，方便和飞行中的卡片分开控淡入淡出
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(35,48,44,0.25)",
  },
  hero: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: "#18384B",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
});
export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}) {
  const color = danger ? colors.danger : colors.text;
  const { scale, onPressIn, onPressOut } = usePressScale(0.975);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || busy}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPressIn={() => {
        if (disabled || busy) return;
        hapticTap();
        onPressIn();
      }}
      onPressOut={onPressOut}
      onPress={onPress}
      style={[
        s.button,
        primary ? s.primary : s.secondary,
        small && { minHeight: 38, paddingVertical: 7, paddingHorizontal: 13 },
        (disabled || busy) && { opacity: 0.5 },
        { transform: [{ scale }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}
      <Text style={[s.buttonText, { color }]}>{children}</Text>
    </AnimatedPressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  glass = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  /** 磨砂顶栏上使用：半透明底、无阴影，让玻璃层本身承担层次 */
  glass?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const { scale, onPressIn, onPressOut } = usePressScale(0.92);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        setPressed(true);
        hapticTap();
        onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        onPressOut();
      }}
      onPress={onPress}
      style={[
        {
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 18,
          backgroundColor: glass
            ? pressed
              ? "rgba(255,255,255,0.38)"
              : "rgba(255,255,255,0.16)"
            : pressed
              ? colors.line
              : "#FFFFFF",
          ...(glass
            ? { borderWidth: 1, borderColor: "rgba(255,255,255,0.45)" }
            : {
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.08,
                shadowRadius: 10,
                elevation: 2,
              }),
        },
        { transform: [{ scale }] },
      ]}
    >
      <Icon size={17} strokeWidth={1.8} color={colors.text} />
    </AnimatedPressable>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

/**
 * 列表卡片外壳：按下时先量出自己的窗口矩形，再交给详情面板做共享元素过渡。
 * `<MeasureCard onPress={(rect) => open({ type: "file", file, hero: { rect, title, icon } })}>…</MeasureCard>`
 *
 * 注意：`style` 直接落在可点击元素上，和原来的 `<Pressable>` 完全等价（不额外套一层
 * View，避免 flexDirection/gap 这类布局属性被拆到两处而改变排版）。
 */
export function MeasureCard({
  children,
  style,
  label,
  onPress,
  onLongPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  label?: string;
  onPress: (rect: HeroRect) => void;
  /** 可选的长按（同样量出矩形）：对话文件卡用它弹出「分享/复制链接/导出」操作菜单。 */
  onLongPress?: (rect: HeroRect) => void;
}) {
  const ref = useRef<ComponentRef<typeof AnimatedPressable>>(null);
  const { scale, onPressIn, onPressOut } = usePressScale(0.98);
  return (
    <AnimatedPressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        hapticTap();
        onPressIn();
      }}
      onPressOut={onPressOut}
      onPress={() => {
        const node = ref.current as View | null;
        node?.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
      }}
      onLongPress={
        onLongPress
          ? () => {
              const node = ref.current as View | null;
              node?.measureInWindow((x, y, width, height) => onLongPress({ x, y, width, height }));
            }
          : undefined
      }
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * 入场包一层：淡入 + 上浮，只在挂载时跑一次。
 * 用于消息气泡、"添加图片"卡片、语音状态行这类"新出现"的东西。
 */
export function RiseIn({
  children,
  style,
  delay = 0,
  distance = 8,
  from = 0.98,
  enabled = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
  distance?: number;
  from?: number;
  enabled?: boolean;
}) {
  const rise = useRiseIn({ delay, distance, from, enabled });
  return <Animated.View style={[style, rise]}>{children}</Animated.View>;
}
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View style={[s.chip, tint ? { backgroundColor: tint } : null]}>
      <Text style={s.chipText}>{children}</Text>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 120, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", padding: 40, gap: 13 }}>
      <View style={[s.iconBox, { width: 55, height: 55, borderRadius: 18 }]}>
        <Icon size={24} color={colors.blueDark} />
      </View>
      <Text style={s.heading}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>{detail}</Text>
      {children}
    </View>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <View accessibilityRole="alert" style={s.error}>
      <Text style={[s.text, { color: colors.danger }]}>{error}</Text>
    </View>
  ) : null;
}

export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  wide,
  hero,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** 传了就做"从这张卡片飞进来 / 飞回去"的共享元素过渡 */
  hero?: HeroCard;
}) {
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 面板是 RN Modal（渲染在另一棵树里），根组件那层键盘补偿管不到它 —— 这里必须自己避让键盘，
  // 否则面板里的输入框（任务/目标/邮件/会话重命名等）会被输入法盖住。
  const keyboard = useAndroidKeyboardInset();
  const compact = width < 600;
  // 面板进场：淡入 + 上浮 + 轻微缩放，替代 Modal 自带的硬滑入
  const entrance = useSheetEntrance();
  const drag = useRef(new Animated.Value(0)).current;
  // 共享元素过渡：0 = 还贴在来源卡片的矩形上，1 = 已经落到面板最终位置
  const [frame, setFrame] = useState<HeroRect>();
  const [landed, setLanded] = useState(!hero);
  const [flying, setFlying] = useState(!!hero);
  const morph = useRef(new Animated.Value(hero ? 0 : 1)).current;
  const scrim = useRef(new Animated.Value(hero ? 0 : 1)).current;
  const sheetBox = useRef<View>(null);
  const closing = useRef(false);
  const started = useRef(false);
  const measureSheet = useCallback(() => {
    sheetBox.current?.measureInWindow((x, y, panelWidth, panelHeight) =>
      setFrame({ x, y, width: panelWidth, height: panelHeight }),
    );
  }, []);
  useEffect(() => {
    if (!hero || !frame || closing.current || started.current) return;
    // 只飞一次：内容加载导致面板高度变化时会重新 onLayout，不能让它重飞
    started.current = true;
    Animated.timing(scrim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    Animated.timing(morph, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      // 克隆体只动 transform/opacity，可以走原生驱动（不掉帧）
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setLanded(true);
      setFlying(false);
    });
  }, [frame, hero, morph, scrim]);
  // 量不到面板矩形时不能让面板一直隐身：兜底直接落位
  useEffect(() => {
    if (!hero || frame) return;
    const timer = setTimeout(() => {
      morph.setValue(1);
      scrim.setValue(1);
      setLanded(true);
      setFlying(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [frame, hero, morph, scrim]);
  /** 关闭：有 hero 就先把卡片飞回列表原位，飞完再真正关闭 */
  const requestClose = useCallback(() => {
    if (!hero || !frame || closing.current) {
      onClose();
      return;
    }
    closing.current = true;
    setLanded(false);
    setFlying(true);
    Animated.timing(scrim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    Animated.timing(morph, {
      toValue: 0,
      duration: 300,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  }, [frame, hero, morph, onClose, scrim]);
  // PanResponder 只建一次，用 ref 拿最新的关闭逻辑
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  const springBack = () =>
    Animated.spring(drag, {
      toValue: 0,
      damping: 18,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  // 下拉关面板只在"把手 + 标题栏"上生效：那里没有滚动，接管手势不会与内容滚动打架
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 92 || gesture.vy > 0.9) {
          hapticTap();
          closeRef.current();
          return;
        }
        // 没拉够就弹回去：给一个"落位"震动，否则用户要靠眼睛确认"到底关没关上"
        hapticSettle();
        springBack();
      },
      onPanResponderTerminate: springBack,
    }),
  ).current;
  return (
    <Modal transparent animationType={hero ? "none" : "fade"} visible onRequestClose={requestClose}>
      <View style={{ flex: 1 }}>
        {/* hero 模式下遮罩自己淡入（Modal 的 fade 会连飞行中的卡片一起淡掉） */}
        {!!hero && <Animated.View pointerEvents="none" style={[s.scrim, { opacity: scrim }]} />}
        <View
          style={[
            s.modalShade,
            compact && { padding: 0, justifyContent: "flex-end" },
            hero ? { backgroundColor: "transparent" } : null,
          ]}
        >
          <Animated.View
            ref={sheetBox}
            onLayout={measureSheet}
            accessibilityViewIsModal
            pointerEvents={landed ? "auto" : "none"}
            style={[
              s.sheet,
              wide && { maxWidth: 1050 },
              compact && {
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                paddingBottom: Math.max(insets.bottom, 12) + keyboard,
                maxHeight: keyboard > 0 ? Math.max(220, windowHeight - keyboard - 40) : "94%",
              },
              hero
                ? { opacity: morph, transform: [{ translateY: drag }] }
                : [entrance, { transform: [...entrance.transform, { translateY: drag }] }],
            ]}
          >
            <View {...pan.panHandlers}>
              {compact && (
                <View
                  style={{
                    alignSelf: "center",
                    width: 34,
                    height: 4,
                    borderRadius: 3,
                    backgroundColor: "#D8DBDE",
                    marginTop: 10,
                  }}
                />
              )}
              <View
                style={[
                  s.between,
                  {
                    padding: compact ? 20 : 24,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  },
                ]}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.title}>{title}</Text>
                  {!!subtitle && <Text style={s.muted}>{subtitle}</Text>}
                </View>
                <IconButton icon={X} label="关闭详情" onPress={requestClose} />
              </View>
            </View>
            {/* nestedScrollEnabled（Android）：面板正文自己就是滚动容器，而文件预览里的
                PDF / HTML / Office / 音视频是**自滚动子视图**（react-native-pdf、WebView）。
                不开这个，外层会抢走竖向手势 → 文档滑不动（用户报「整个页面滑动、内容不滑动」）。
                开了之后交给 Android 的嵌套滚动协商：子视图先滚，滚到底再交给面板。 */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              contentContainerStyle={{ padding: compact ? 20 : 24 }}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
        {/* 飞行中的卡片：最上层，落位前一直不透明，最后 20% 与真面板交叉淡出 */}
        {!!hero && flying && !!frame && <HeroFlight hero={hero} frame={frame} morph={morph} />}
      </View>
    </Modal>
  );
}

/** 共享元素过渡里"飞过去的那张卡片"。 */
function HeroFlight({
  hero,
  frame,
  morph,
}: {
  hero: HeroCard;
  frame: HeroRect;
  morph: Animated.Value;
}) {
  const Icon = hero.icon;
  // 克隆体按"面板最终矩形"布局，再整体缩放+位移到来源卡片的位置。
  // 缩放发生在自身中心，所以起点平移量要把两边的中心差算进去：
  // 这样 morph=0 时它正好盖住卡片矩形，morph=1 时正好落在面板上。
  const shiftX = hero.rect.x + hero.rect.width / 2 - (frame.x + frame.width / 2);
  const shiftY = hero.rect.y + hero.rect.height / 2 - (frame.y + frame.height / 2);
  const scaleX = frame.width > 0 ? hero.rect.width / frame.width : 1;
  const scaleY = frame.height > 0 ? hero.rect.height / frame.height : 1;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.hero,
        {
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          // 全程只有 transform/opacity，可以放心交给原生驱动（不逐帧改布局）
          transform: [
            { translateX: morph.interpolate({ inputRange: [0, 1], outputRange: [shiftX, 0] }) },
            { translateY: morph.interpolate({ inputRange: [0, 1], outputRange: [shiftY, 0] }) },
            { scaleX: morph.interpolate({ inputRange: [0, 1], outputRange: [scaleX, 1] }) },
            { scaleY: morph.interpolate({ inputRange: [0, 1], outputRange: [scaleY, 1] }) },
          ],
          // 落位前保持不透明，最后 20% 与真面板交叉淡出
          opacity: morph.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
        },
      ]}
    >
      {!!Icon && (
        <View style={{ padding: 16, gap: 10 }}>
          <View style={[s.iconBox, hero.tint ? { backgroundColor: hero.tint } : null]}>
            <Icon size={19} color={colors.text} />
          </View>
          <Text numberOfLines={2} style={s.heading}>
            {hero.title}
          </Text>
          {!!hero.subtitle && (
            <Text numberOfLines={1} style={s.small}>
              {hero.subtitle}
            </Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}
export function CheckRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.985);
  return (
    <AnimatedPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPressIn={() => {
        hapticTap();
        onPressIn();
      }}
      onPressOut={onPressOut}
      onPress={onPress}
      style={[s.row, { gap: 10, paddingVertical: 9 }, { transform: [{ scale }] }]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: checked ? colors.text : colors.line,
          backgroundColor: checked ? colors.text : "#FFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={13} color="#FFF" />}
      </View>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
    </AnimatedPressable>
  );
}
export function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[s.between, { marginBottom: 19 }]}>
      <Text style={s.heading}>{title}</Text>
      {action && onPress && (
        <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 5 }]}>
          <Text style={[s.small, { color: colors.text }]}>{action}</Text>
          <ArrowUpRight size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function LinkRow({
  title,
  detail,
  onPress,
  icon: Icon,
  tint,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  icon: LucideIcon;
  tint?: string;
}) {
  const [pressed, setPressed] = useState(false);
  const { scale, onPressIn, onPressOut } = usePressScale(0.985);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPressIn={() => {
        setPressed(true);
        hapticTap();
        onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        onPressOut();
      }}
      onPress={onPress}
      style={[
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
        { transform: [{ scale }] },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: tint || colors.sky }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, { fontWeight: "500" }]}>{title}</Text>
        {!!detail && <Text style={s.small}>{detail}</Text>}
      </View>
      <ChevronRight size={15} color={colors.muted} />
    </AnimatedPressable>
  );
}
/** OpenMuse's original capybara, shared by every assistant surface. */
export function Mascot({
  size = 42,
  variant = "sky",
  glass = false,
}: {
  size?: number;
  variant?: "sky" | "sand" | "lilac";
  /**
   * 玻璃顶栏上用 true：水豚背后那块垫色改成**半透明**。
   * 真机实测：这块垫色原本完全不透明（rgb(236,245,250) alpha=1，29×29），
   * 水豚本身是抠好的透明 PNG，所以"水豚下面那条白块"其实就是它 —— 不是图没抠。
   */
  glass?: boolean;
}) {
  const palette = {
    sky: "#ECF5FA",
    sand: "#FAF0DF",
    lilac: "#F1ECF9",
  }[variant];
  const chip = glass
    ? (palette
        .replace("#", "")
        .match(/.{2}/g)
        ?.map((h) => Number.parseInt(h, 16))
        .join(", ") ?? "236, 245, 250")
    : null;
  return (
    <View accessibilityLabel="OpenMuse 水豚" style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          top: size * 0.15,
          left: size * 0.12,
          width: size * 0.76,
          height: size * 0.76,
          borderRadius: size,
          backgroundColor: chip ? `rgba(${chip}, 0.26)` : palette,
          ...(chip ? { borderWidth: 1, borderColor: "rgba(19,38,49,0.05)" } : {}),
        }}
      />
      <Image
        source={require("../assets/capybara.png")}
        resizeMode="contain"
        style={{ width: size, height: size }}
        accessible={false}
      />
    </View>
  );
}
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", options || { month: "short", day: "numeric" });
}
export function timeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}
export function relativeDate(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  return diff < 60_000
    ? "刚刚"
    : diff < 3600_000
      ? `${Math.floor(diff / 60_000)}m ago`
      : diff < 86400_000
        ? `${Math.floor(diff / 3600_000)}h ago`
        : dateLabel(value);
}

export function resultSummary(value: string) {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? "回复已存入本地「已发送」。"
    : value;
}
