import {
  Bell,
  ListChecks,
  MessageCircle,
  PanelsTopLeft,
  Plus,
  ShieldCheck,
} from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { ComputerEntry } from "./computer";
import { agentActionLabel, relativeTime, statusLabel } from "./labels";
import { Button, colors, Mascot, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * 点顶栏头像展开的面板（对应 Muse 的 HatchExpandedAvatarPanel / AvatarFullScreen）。
 * 把"它现在在干嘛、有几个活在跑、我要去哪儿"集中在一处，不用再到处找。
 */
export function AvatarPanel({ onClose }: { onClose: () => void }) {
  const { data } = useAgentWorkspace();
  const { workspace: w, navigate, open } = useWorkspace();
  const name = data?.identity.name || "OpenMuse";
  const live = (data?.live ?? [])[0];
  const tasks = (data?.tasks ?? []).filter(
    (task) => !["succeeded", "failed", "cancelled"].includes(task.status),
  );
  const running = tasks.filter((task) => ["running", "queued", "scheduled"].includes(task.status));
  const waiting = tasks.filter((task) =>
    ["waiting_input", "waiting_approval"].includes(task.status),
  );
  const pending = w.actions.filter((action) => action.status === "awaiting_review");
  return (
    <Sheet title={name} subtitle={live ? live.text : "待命中"} onClose={onClose}>
      <View style={{ alignItems: "center", gap: 10, paddingVertical: 6 }}>
        <Mascot size={104} variant={data?.identity.avatar} />
        <Text style={[s.heading, { fontSize: 18 }]}>{name}</Text>
        <Text style={[s.small, { textAlign: "center" }]} numberOfLines={2}>
          {live
            ? `${live.text}${live.detail ? ` · ${live.detail}` : ""} · ${relativeTime(live.at)}`
            : "待命中，接到活之后这里会显示它在做什么。"}
        </Text>
      </View>
      <View style={[s.row, { gap: 8, flexWrap: "wrap", justifyContent: "center" }]}>
        {running.length > 0 && (
          <View
            style={[
              s.row,
              {
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: colors.sky,
              },
            ]}
          >
            <ListChecks size={14} color={colors.blueDark} />
            <Text style={s.small}>{running.length} 个任务在跑</Text>
          </View>
        )}
        {waiting.length + pending.length > 0 && (
          <View
            style={[
              s.row,
              {
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: colors.orange,
              },
            ]}
          >
            <Bell size={14} color={colors.text} />
            <Text style={s.small}>{waiting.length + pending.length} 件等你处理</Text>
          </View>
        )}
      </View>
      <View style={{ gap: 8, marginTop: 4 }}>
        {tasks.slice(0, 3).map((task) => (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            accessibilityLabel={`打开任务：${task.title}`}
            onPress={() => {
              onClose();
              open({ type: "task", taskId: task.id });
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderRadius: 16,
              backgroundColor: pressed ? "#F0F1F2" : "#F5F6F7",
            })}
          >
            <Text numberOfLines={1} style={[s.text, { flex: 1 }]}>
              {task.title}
            </Text>
            <Text style={s.small}>{statusLabel(task.status)}</Text>
          </Pressable>
        ))}
        {live && (
          <Text style={s.small}>
            正在用：{agentActionLabel(live.tool)}
            {live.detail ? ` · ${live.detail}` : ""}
          </Text>
        )}
      </View>
      <View style={[s.row, { gap: 8, flexWrap: "wrap", marginTop: 6 }]}>
        <Button
          small
          primary
          icon={MessageCircle}
          onPress={() => {
            onClose();
            navigate("chat");
          }}
        >
          回到聊天
        </Button>
        <Button
          small
          icon={Plus}
          onPress={() => {
            onClose();
            open({ type: "notifications" });
          }}
        >
          通知与待办
        </Button>
        <Button
          small
          icon={PanelsTopLeft}
          onPress={() => {
            onClose();
            navigate("activity");
          }}
        >
          查看动态
        </Button>
        <Button
          small
          icon={ShieldCheck}
          onPress={() => {
            onClose();
            open({ type: "credentials" });
          }}
        >
          短时凭据
        </Button>
      </View>
      {/* 顶栏卡片要窄（照 Muse），所以"可接管"这类入口移到这里来 */}
      <View style={{ marginTop: 14, alignItems: "center" }}>
        <ComputerEntry />
      </View>
    </Sheet>
  );
}
