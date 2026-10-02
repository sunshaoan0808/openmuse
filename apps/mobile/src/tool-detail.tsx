import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { familyOf, toolActionLabel } from "../../../packages/domain/src/activity";
import { colors, s } from "./ui";

/**
 * 工具卡的"降级外壳"：默认只占**一行**，点开才露出原来的卡片。
 *
 * 为什么：Muse 的聊天里，跑动过程是**任务流**（activity 卡），工具的细节是次要的、收起来的。
 * 我们原来把每张工具卡都铺在消息流里，过程就被细节淹没了。
 *
 * 行的文字刻意与 activity 卡用**同一套词**：`任务 · 动作`（如"查网页 · 搜索网页"）。
 * 工具行是 CPK 在消息流里渲染的，物理上收不进那张卡（要收就得把 7 张卡在卡里重实现一遍），
 * 但把词和视觉统一之后，两层读起来是一条线：卡片是概览，这些行是它的展开。
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
  const task = familyOf(name, name).title;
  const action = toolActionLabel(name);
  const label = task === action ? task : `${task} · ${action}`;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}${loading ? "，进行中" : ""}，${open ? "收起" : "展开"}细节`}
        onPress={() => setOpen((value) => !value)}
        style={styles.head}
      >
        <View style={[styles.dot, loading ? styles.dotActive : styles.dotDone]} />
        <Text style={styles.title}>{label}</Text>
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
