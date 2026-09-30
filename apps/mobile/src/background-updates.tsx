import { ArrowRight, Bell, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { ensureNotificationPermission, syncLocalNotifications } from "./local-notifications";
import { Button, Card, colors, ErrorNotice, resultSummary, s } from "./ui";
import { useWorkspace } from "./workspace";

export function BackgroundUpdates() {
  const { data, mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 进入工作区时申请一次通知权限（被拒也不会反复弹系统弹窗）
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);
  // 轮询到新快照时，把“新出现的通知 / 刚完成的任务”变成系统通知（同一条只弹一次）
  useEffect(() => {
    void syncLocalNotifications(data);
  }, [data]);
  const updates = data?.notifications.filter((item) => !item.read && item.taskId) || [];
  // 点过 X 就本端先藏起来：服务端那一步再慢也不该让卡片"点了没反应"
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = updates.filter((item) => !hidden.includes(item.id));
  const first = visible[0];
  if (!first || data?.identity.showChatUpdates === false) return null;
  async function dismiss() {
    const target = first;
    if (!target || busy) return;
    setHidden((ids) => [...ids, target.id]);
    setBusy(true);
    try {
      await mutate(`/notifications/${target.id}/read`, {});
      setError("");
    } catch (e) {
      // 服务端没标成也没关系：本端已经隐藏；下次轮询若仍是未读，它会再出现
      setHidden((ids) => ids.filter((id) => id !== target.id));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ backgroundColor: colors.sky, padding: 16, gap: 10 }}>
      <View style={[s.between, { gap: 12 }]}>
        <View style={[s.row, { gap: 7 }]}>
          <Bell size={14} color={colors.blueDark} />
          <Text style={s.small}>给你一条更新</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="忽略后台更新"
          // 不做 disabled：一旦请求挂住，disabled 会让这个按钮永久失效（真机上就是这个表现）
          onPress={() => void dismiss()}
          hitSlop={14}
          style={{ padding: 10 }}
        >
          <X size={18} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={s.heading}>{first.title}</Text>
      <Text style={s.text}>{resultSummary(first.body)}</Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          icon={ArrowRight}
          onPress={() => first.taskId && open({ type: "task", taskId: first.taskId })}
        >
          查看任务
        </Button>
        {visible.length > 1 && (
          <Button small onPress={() => open({ type: "notifications" })}>
            还有 {visible.length - 1} 条更新
          </Button>
        )}
      </View>
      <ErrorNotice error={error} />
    </Card>
  );
}
