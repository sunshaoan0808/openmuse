import { ListChecks } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { activitySummaryLine } from "../../../packages/domain/src/activity";
import { useAgentWorkspace } from "./agent-workspace";
import { statusLabel } from "./labels";
import { taskProgress, taskSummary, visibleTasks } from "./thread-tasks";
import { useMuseThread } from "./threads";
import { colors, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * 聊天里的"并行子任务"一栏（对应 Muse 的 SubAgentRow / activeSubAgents）。
 *
 * 原版 Muse 在主线跑着的时候可以再起子代理，界面上按行列出有几个在跑、几个已完成；
 * 我们的后台任务（派活）本来就在并行跑，但只出现在动态页——这里把它们带回聊天，
 * 让"我插进去的活"一眼可见：正在跑哪一步、卡在哪、点开就是详情。
 */
function LiveDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blueDark, opacity }}
    />
  );
}

export function RunningTasks() {
  const { data } = useAgentWorkspace();
  const { open } = useWorkspace();
  const { selection, mainId, enabled } = useMuseThread();
  const tasks = visibleTasks(data?.tasks ?? [], {
    threadId: selection.id,
    mainId,
    threadsEnabled: enabled,
  });
  if (!tasks.length) return null;
  const summary = taskSummary(tasks);
  return (
    <View style={{ gap: 8, marginBottom: 4 }}>
      <View style={[s.row, { gap: 7, alignItems: "center" }]}>
        <ListChecks size={14} color={colors.muted} />
        <Text style={s.small}>
          {summary.running > 0 ? `${summary.running} 个任务在跑` : `${summary.total} 个任务`}
          {summary.waiting > 0 ? ` · ${summary.waiting} 个等你` : ""}
        </Text>
      </View>
      {tasks.slice(0, 3).map((task) => {
        const progress = taskProgress(task);
        const running = ["running", "queued", "scheduled"].includes(task.status);
        return (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            accessibilityLabel={`打开任务：${task.title}`}
            onPress={() => open({ type: "task", taskId: task.id })}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: 14,
              backgroundColor: pressed ? "#F0F1F2" : "#F5F6F7",
            })}
          >
            {running ? <LiveDot /> : <View style={{ width: 7 }} />}
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={[s.text, { fontSize: 14 }]}>
                {task.title}
              </Text>
              {/* 服务端折好的任务流：这一行就是它做过的事（重复的合成 ×N），末尾跟用时 */}
              {task.activity && task.activity.tasks.length > 0 && (
                <Text numberOfLines={1} style={s.small}>
                  {activitySummaryLine(task.activity)}
                </Text>
              )}
            </View>
            <Text style={s.small}>
              {statusLabel(task.status)}
              {progress.total ? ` · ${progress.done}/${progress.total} 步` : ""}
            </Text>
          </Pressable>
        );
      })}
      {tasks.length > 3 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看全部任务"
          onPress={() => open({ type: "notifications" })}
          style={{ paddingVertical: 4 }}
        >
          <Text style={s.small}>还有 {tasks.length - 3} 个任务</Text>
        </Pressable>
      )}
    </View>
  );
}
