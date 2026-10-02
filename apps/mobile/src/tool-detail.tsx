import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { familyOf } from "../../../packages/domain/src/activity";
import { colors, s } from "./ui";

/**
 * 工具卡的"降级外壳"：默认只占**一行**（任务名 + 状态 + 展开），点开才露出原来的卡片。
 *
 * 为什么：Muse 的聊天里，跑动过程是**任务流**（activity 卡），工具的细节是次要的、收起来的。
 * 我们原来把每张工具卡都铺在消息流里，于是"过程"被细节淹没 —— 这里按下不表，展开仍在。
 */
export function ToolDetailRow({
  name,
  loading,
  children,
}: {
  name: string;
  loading: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${familyOf(name, name).title}${loading ? "，进行中" : ""}，${open ? "收起" : "展开"}细节`}
        onPress={() => setOpen((value) => !value)}
        style={styles.head}
      >
        <View style={[styles.dot, loading ? styles.dotActive : styles.dotDone]} />
        <Text style={styles.title}>{familyOf(name, name).title}</Text>
        <Text style={s.small}>{loading ? "进行中" : "完成"}</Text>
        <Text style={styles.toggle}>{open ? "收起" : "细节"}</Text>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 2 },
  head: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  dot: { borderRadius: 4, height: 7, width: 7 },
  dotActive: { backgroundColor: colors.blueDark },
  dotDone: { backgroundColor: colors.line },
  title: { color: colors.text, flex: 1, fontSize: 13, lineHeight: 18 },
  toggle: { color: colors.blueDark, fontSize: 11, lineHeight: 16 },
  body: { paddingTop: 4 },
});
