import { StyleSheet, Text, View } from "react-native";
import {
  type ActivityStep,
  foldActivity,
  formatDurationMs,
  stepsOfCurrentRun,
} from "../../../packages/domain/src/activity";

export { stepsOfCurrentRun };
import { colors, s } from "./ui";

/**
 * 一次跑动的任务流卡片 —— 对齐 Muse 的 `HatchActivityCard`：
 * 行是**任务**（不是工具调用），行间用虚线连成一条时间线，run 级别显示状态与用时。
 *
 * 数据来自 `foldActivity`（见 packages/domain/src/activity.ts）：
 * 连续的同类工具调用合成一个任务，换类目才开新任务。
 */
export function RunActivityCard({
  steps,
  running,
  startedAtMs,
  endedAtMs,
  labelFor,
  style,
}: {
  steps: readonly ActivityStep[];
  running: boolean;
  startedAtMs?: number;
  endedAtMs?: number;
  labelFor?: (name: string) => string;
  style?: object;
}) {
  const activity = foldActivity({ steps, running, startedAtMs, endedAtMs, labelFor });

  // 没跑过东西就不长出一张空卡（Muse 也是没有 activity 就不画）
  if (!activity.tasks.length) return null;

  const done = activity.tasks.filter((task) => task.isDone).length;
  const duration = activity.durationMs === undefined ? undefined : formatDurationMs(activity.durationMs);

  return (
    <View style={[styles.card, style]}>
      <View style={s.between}>
        <View style={s.row}>
          <View style={[styles.dot, running ? styles.dotActive : styles.dotDone]} />
          <Text style={styles.head}>{running ? "正在干活" : "这次做完了"}</Text>
        </View>
        <Text style={s.small}>
          {activity.tasks.length} 个任务 · 完成 {done}
          {duration ? ` · 用时 ${duration}` : ""}
        </Text>
      </View>

      <View style={styles.rows}>
        {activity.tasks.map((task, index) => {
          const last = index === activity.tasks.length - 1;
          return (
            <View key={task.key} style={styles.rowLine}>
              {/* 左边一列：点 + 往下的虚线，和 Muse 的 DottedVerticalConnector 一个意思 */}
              <View style={styles.rail}>
                <View
                  style={[
                    styles.taskDot,
                    task.isDone ? styles.taskDotDone : styles.taskDotActive,
                  ]}
                />
                {!last && <View style={styles.connector} />}
              </View>
              <View style={styles.taskText}>
                <Text style={styles.taskTitle}>
                  {task.title}
                  {task.isDone ? "" : "…"}
                </Text>
                <Text style={s.small}>{task.isDone ? task.subtitle : `正在 ${task.subtitle}`}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: { borderRadius: 4, height: 8, marginRight: 6, width: 8 },
  dotActive: { backgroundColor: colors.blueDark },
  dotDone: { backgroundColor: colors.line },
  head: { color: colors.text, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  rows: { gap: 0 },
  rowLine: { flexDirection: "row", alignItems: "stretch", minHeight: 34 },
  rail: { alignItems: "center", marginRight: 10, width: 12 },
  taskDot: { borderRadius: 5, height: 10, marginTop: 4, width: 10 },
  taskDotDone: { backgroundColor: colors.line },
  taskDotActive: { backgroundColor: colors.blueDark },
  // RN 的 dotted 在部分平台会被画成实线，这里用「一截线 + 断口」拼出虚线，跨端一致。
  connector: {
    borderLeftColor: colors.line,
    borderLeftWidth: 1,
    borderStyle: "dotted",
    flex: 1,
    marginTop: 2,
    width: 0,
  },
  taskText: { flex: 1, paddingBottom: 8 },
  taskTitle: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
