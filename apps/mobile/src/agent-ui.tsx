import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Globe2,
  Heart,
  Lightbulb,
  ListChecks,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Target,
  Users,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Pressable,
  Share,
  Text,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { ActionProposal, Artifact, BrowserSession } from "../../../packages/domain/src";
import type {
  AgentArtifact,
  AgentMemory,
  AgentTask,
  Evidence,
  Goal,
  Idea,
  Monitor,
  RunEvent,
  TemporaryCredential,
} from "../../../packages/domain/src/agent";
import { useAgentWorkspace } from "./agent-workspace";
import {
  actionKindLabel,
  fieldLabel,
  missingCount,
  pendingSummary,
  relativeTime,
  statusLabel,
  stepStatusLabel,
  taskStatusLabel,
} from "./labels";
import type { HeroRect } from "./motion";
import { ActivityScreen, ConnectionsScreen } from "./screens";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  colors,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  Mascot,
  MeasureCard,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
} from "./ui";
import { useWorkspace } from "./workspace";

function stamp(value?: string) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "尚未检查";
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function activeTask(task: AgentTask) {
  return !["succeeded", "failed", "cancelled"].includes(task.status);
}
/** 一闪一闪的"在干活"指示灯。 */
function LivePulse() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.orange, opacity }}
    />
  );
}
/**
 * 实时状态：智能体此刻在干什么。
 *
 * 上游这里只显示 worker 在线与否，看不出它在做什么；Muse 是一边干活一边显示当前动作。
 * 数据来自服务端的 /api/agent`live`（每次工具调用都会更新）——太旧会自动消失，
 * 所以这里同时显示"多久之前"，并且每 5 秒重算一次相对时间。
 */
export function AgentStatus() {
  const { data, error, refresh } = useAgentWorkspace();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  const live = (data?.live ?? [])[0]; // 各会话各一条，动态页显示最新的
  const running = (data?.tasks ?? []).find((task) => ["running", "waiting"].includes(task.status));
  const step = running?.plan.find((item) => ["running", "waiting"].includes(item.status));
  const text = live?.text ?? (running ? `正在执行：${running.title}` : "");
  const detail = live?.detail || (step ? `${stepStatusLabel(step.status)} · ${step.title}` : "");
  const at = live?.at ?? running?.updatedAt;
  return (
    <View style={{ gap: 8 }}>
      <ErrorNotice error={error ? `没能连上智能体：${error}` : ""} />
      {!!error && (
        <Button small onPress={() => void refresh().catch(() => {})}>
          重新连接智能体
        </Button>
      )}
      {!data && !error && <ActivityIndicator color={colors.blueDark} />}
      {!!data && !!text && (
        <Card style={{ padding: 16, gap: 8, borderRadius: 22 }}>
          <View style={[s.row, { gap: 9, alignItems: "center" }]}>
            <LivePulse />
            <Text style={[s.text, { flex: 1 }]}>{text}</Text>
            {!!at && <Text style={s.small}>{relativeTime(at)}</Text>}
          </View>
          {!!detail && (
            <Text style={s.small} numberOfLines={2}>
              {detail}
            </Text>
          )}
        </Card>
      )}
      {!!data && !text && data.worker.running && (
        <Text style={s.small}>待命中。它在聊天里接到活之后，这里会显示当前在做什么。</Text>
      )}
      {!!data && !data.worker.running && (
        <Text style={s.small}>worker 离线，已保存的工作会在它重连后继续。</Text>
      )}
    </View>
  );
}
export function TaskCard({
  task,
  compact = false,
  onOpen,
}: {
  task: AgentTask;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { open } = useWorkspace();
  const done = task.plan.filter((step) => step.status === "succeeded").length;
  const next = task.plan.find((step) => ["running", "waiting"].includes(step.status));
  const waiting = ["waiting_input", "waiting_approval"].includes(task.status);
  return (
    <MeasureCard
      label={`Open task: ${task.title}`}
      onPress={(rect) => {
        onOpen?.();
        open({
          type: "task",
          taskId: task.id,
          // 共享元素过渡：从这张任务卡飞进详情
          hero: {
            rect,
            title: task.title,
            subtitle: `${taskStatusLabel(task.status)}${task.plan.length ? ` · ${done}/${task.plan.length} 步` : ""}`,
            icon: ListChecks,
            tint: waiting ? colors.orange : colors.sky,
          },
        });
      }}
    >
      <Card
        style={{
          padding: compact ? 15 : 20,
          gap: 11,
          borderRadius: 22,
          backgroundColor: "#F0F1F2",
        }}
      >
        <View style={[s.row, { gap: 10 }]}>
          <View
            style={[
              s.iconBox,
              { width: 34, height: 34, backgroundColor: waiting ? colors.orange : colors.sky },
            ]}
          >
            <ListChecks size={18} color={colors.blueDark} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.heading}>{task.title}</Text>
            <Text style={s.small}>
              {taskStatusLabel(task.status)}
              {task.plan.length ? ` · ${done}/${task.plan.length} 步` : ""}
            </Text>
            {/* 照 Muse 的任务列表：行里直接显示"它刚做了什么"，而不是只有状态 */}
            {!!task.lastStep && (
              <Text numberOfLines={1} style={[s.small, { color: colors.blueDark }]}>
                {task.lastStep.title}
                {task.lastStep.detail ? ` · ${task.lastStep.detail}` : ""}
              </Text>
            )}
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
        {!!task.plan.length && (
          <View style={{ height: 4, backgroundColor: colors.line, borderRadius: 4 }}>
            <View
              style={{
                height: 4,
                width: `${Math.round((done / task.plan.length) * 100)}%`,
                backgroundColor: "#6AAEE0",
                borderRadius: 4,
              }}
            />
          </View>
        )}
        {(task.question || task.result || task.error || next?.title) && (
          <Text numberOfLines={compact ? 2 : 4} style={s.muted}>
            {task.question || task.error || resultSummary(task.result || next?.title || "")}
          </Text>
        )}
        {waiting && (
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            {task.status === "waiting_approval"
              ? "等你确认这次操作"
              : missingCount(task)
                ? `还缺 ${missingCount(task)} 项信息`
                : "需要你的补充"}
          </Text>
        )}
      </Card>
    </MeasureCard>
  );
}
export function ChatWork() {
  const { data } = useAgentWorkspace();
  const tasks = [...(data?.tasks || [])]
    .filter(activeTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {tasks.map((task) => (
        <TaskCard task={task} key={task.id} compact />
      ))}
    </View>
  );
}
/** 需要人介入的两个状态：等确认、缺信息。 */
export function needsMe(task: AgentTask) {
  return ["waiting_input", "waiting_approval"].includes(task.status);
}
export function AgentActivityScreen() {
  const { data } = useAgentWorkspace();
  const { workspace: w, open } = useWorkspace();
  // 默认落在"待我处理"：需要人的事排最前，其余按时间。
  const [filter, setFilter] = useState("待我处理");
  const pendingActions = w.actions.filter((action) => action.status === "awaiting_review");
  const queue = (data?.tasks || []).filter(needsMe);
  const tasks = [...(data?.tasks || [])]
    .filter((task) => {
      if (filter === "待我处理") return needsMe(task);
      if (filter === "全部") return true;
      return filter === "进行中" ? activeTask(task) : !activeTask(task);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const nothingWaiting = !tasks.length && !pendingActions.length;
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {["待我处理", "全部", "进行中", "已完成"].map((item) => (
          <Button key={item} small primary={filter === item} onPress={() => setFilter(item)}>
            {item === "待我处理" && queue.length + pendingActions.length
              ? `${item} · ${queue.length + pendingActions.length}`
              : item}
          </Button>
        ))}
      </View>
      {filter === "待我处理" && !!pendingActions.length && (
        <PendingActionCards
          actions={pendingActions}
          onOpen={(action, rect) =>
            open({
              type: "review",
              action,
              ...(rect
                ? {
                    hero: {
                      rect,
                      title: action.title,
                      subtitle: actionKindLabel(action.kind),
                      icon: ShieldCheck,
                      tint: colors.lavender,
                    },
                  }
                : {}),
            })
          }
        />
      )}
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {!tasks.length && (filter !== "待我处理" || nothingWaiting) && (
        <Empty
          icon={ListChecks}
          title={filter === "待我处理" ? "没有等你处理的事" : "放工作的地方"}
          detail={
            filter === "待我处理"
              ? "需要你确认的操作、缺信息的任务会排在这里；其余进展按时间排列。"
              : "在聊天里派个任务，它的计划、进展和结果都会留在这里。"
          }
        />
      )}
      <SectionHeading title="复核与回执" />
      <ActivityScreen />
    </View>
  );
}
export function EvidenceList({ items }: { items: Evidence[] }) {
  const { workspace, open } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 10 }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{ borderLeftWidth: 2, borderLeftColor: colors.blue, paddingLeft: 12, gap: 4 }}
        >
          <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{item.title}</Text>
          <Text selectable style={s.small}>
            {item.excerpt}
          </Text>
          {item.url && /^https?:\/\//i.test(item.url) && (
            <Button
              small
              onPress={() =>
                void Linking.openURL(item.url || "").catch((e) => setError(errorText(e)))
              }
            >
              打开
            </Button>
          )}
          {item.kind === "mail" && workspace.mail.some((mail) => mail.id === item.id) && (
            <Button
              small
              onPress={() => {
                const mail = workspace.mail.find((m) => m.id === item.id);
                if (mail) open({ type: "mail", mail });
              }}
            >
              查看邮件
            </Button>
          )}
          {item.kind === "file" && workspace.files.some((file) => file.id === item.id) && (
            <Button
              small
              onPress={() => {
                const file = workspace.files.find((f) => f.id === item.id);
                if (file) open({ type: "file", file });
              }}
            >
              查看文件
            </Button>
          )}
        </View>
      ))}
      <ErrorNotice error={error} />
    </View>
  );
}
export function TaskDetail({ taskId }: { taskId: string }) {
  const { api, workspace, close, open, refresh: refreshWorkspace } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  // 照 Muse 的详情页：副标题显示"此刻正在做的那一步"，而不是静态状态
  const liveNow = (data?.live ?? []).find((activity) => activity.threadId === taskId);
  const [detail, setDetail] = useState<{
    task: AgentTask;
    events: RunEvent[];
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [fieldJson, setFieldJson] = useState("");
  const [showFieldJson, setShowFieldJson] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const task = data?.tasks.find((item) => item.id === taskId) || detail?.task;
  useEffect(() => {
    let active = true;
    void api
      .request<{
        task: AgentTask;
        events: RunEvent[];
        artifacts: AgentArtifact[];
        files: Artifact[];
        browsers: BrowserSession[];
      }>(`/api/agent/tasks/${taskId}`)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [api, taskId, task?.updatedAt]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${taskId}/${path}`, body);
      if (path === "input") {
        setAnswer("");
        setFields({});
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitInput() {
    try {
      let parsed: Record<string, string | boolean> = fields;
      if (fieldJson.trim()) {
        const raw: unknown = JSON.parse(fieldJson);
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.values(raw).some(
            (value) => typeof value !== "string" && typeof value !== "boolean",
          )
        )
          throw new Error("表单字段必须是一个 JSON 对象，值为文本或 true/false。");
        parsed = raw as Record<string, string | boolean>;
      }
      await act("input", {
        answer: answer.trim() || "已提供所需字段。",
        fields: parsed,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function review() {
    const actionId = task?.actionId;
    if (!actionId) {
      setError("这次复核还不可用，刷新后重试。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 先在已加载的工作区快照里找（0 次往返），找不到才补一次请求
      let action = workspace.actions.find((item) => item.id === actionId);
      if (!action) {
        const snapshot = await api.request<typeof workspace>("/api/workspace");
        action = snapshot.actions.find((item) => item.id === actionId);
      }
      if (!action) throw new Error("这次复核还不可用，刷新后重试。");
      open({ type: "review", action });
      // 后台补新鲜度：复核面板若拿到更新的 hash 会自己换新，批准照旧能用
      void refreshWorkspace();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const missing = Array.isArray(task?.state.missingFields) ? task.state.missingFields : [];
  const fieldNames = missing
    .map((field) =>
      typeof field === "string"
        ? field
        : typeof field === "object" && field && "name" in field
          ? String(field.name)
          : "",
    )
    .filter(Boolean);
  return (
    <Sheet
      title={task?.title || "任务"}
      subtitle={
        task
          ? liveNow
            ? `${liveNow.text}${liveNow.detail ? ` · ${liveNow.detail}` : ""}`
            : `${taskStatusLabel(task.status)} · ${stamp(task.updatedAt)}`
          : "正在加载已保存的进展…"
      }
      onClose={close}
    >
      <ErrorNotice error={error} />
      {!task ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 20 }}>
          <Text selectable style={s.text}>
            {task.prompt}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {["queued", "running", "scheduled", "waiting_input", "waiting_approval"].includes(
              task.status,
            ) && (
              <Button
                small
                icon={Pause}
                busy={busy}
                onPress={() => void act("control", { action: "pause" })}
              >
                暂停
              </Button>
            )}
            {task.status === "paused" && (
              <Button
                small
                icon={Play}
                busy={busy}
                onPress={() => void act("control", { action: "resume" })}
              >
                继续
              </Button>
            )}
            {task.status === "failed" && (
              <Button
                small
                icon={RefreshCw}
                busy={busy}
                onPress={() => void act("control", { action: "retry" })}
              >
                重试任务
              </Button>
            )}
            {activeTask(task) && (
              <Button
                small
                danger
                icon={X}
                busy={busy}
                onPress={() => void act("control", { action: "cancel" })}
              >
                取消任务
              </Button>
            )}
          </View>
          {task.status === "waiting_approval" && (
            <Card style={{ backgroundColor: colors.lavender, gap: 12 }}>
              <Text style={s.heading}>等你确认这次操作</Text>
              <Text style={s.muted}>在继续之前，复核具体操作与账号；确认后它才会真的发出去。</Text>
              <Button primary busy={busy} onPress={() => void review()}>
                复核操作
              </Button>
            </Card>
          )}
          {task.status === "waiting_input" && (
            <Card style={{ backgroundColor: colors.sky, gap: 10 }}>
              <Text style={s.heading}>{task.question || "补充一点信息会更好"}</Text>
              {!!missingCount(task) && (
                <Text style={s.small}>还缺 {missingCount(task)} 项信息，填完就能继续。</Text>
              )}
              {fieldNames.map((name) =>
                missing.some(
                  (f) => typeof f === "object" && f && f.name === name && f.type === "checkbox",
                ) ? (
                  <CheckRow
                    key={name}
                    label={fieldLabel(name)}
                    checked={Boolean(fields[name])}
                    onPress={() => setFields((current) => ({ ...current, [name]: !current[name] }))}
                  />
                ) : (
                  <Field
                    key={name}
                    label={fieldLabel(name)}
                    value={String(fields[name] ?? "")}
                    onChangeText={(value) =>
                      setFields((current) => ({ ...current, [name]: value }))
                    }
                  />
                ),
              )}
              {!fieldNames.length && (
                <Field
                  label="你的回答"
                  value={answer}
                  onChangeText={setAnswer}
                  multiline
                  placeholder="补充缺少的信息…"
                />
              )}
              {task.kind === "document" && !fieldNames.length && (
                <>
                  <Button small onPress={() => setShowFieldJson(!showFieldJson)}>
                    表单字段值
                  </Button>
                  {showFieldJson && (
                    <Field
                      label="字段（JSON：字段名到值）"
                      value={fieldJson}
                      onChangeText={setFieldJson}
                      multiline
                      autoCapitalize="none"
                      placeholder={'{"full_name":"你的名字","consent":true}'}
                    />
                  )}
                </>
              )}
              <Button
                primary
                busy={busy}
                disabled={!answer.trim() && !Object.keys(fields).length && !fieldJson.trim()}
                onPress={() => void submitInput()}
              >
                继续任务
              </Button>
            </Card>
          )}
          {!!task.plan.length && (
            <Card style={{ gap: 15 }}>
              <Text style={s.heading}>计划</Text>
              {task.plan.map((step, index) => (
                <View key={step.id} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                  <Text
                    style={[
                      s.text,
                      { color: step.status === "succeeded" ? colors.blueDark : colors.muted },
                    ]}
                  >
                    {step.status === "succeeded" ? "✓" : `${index + 1}.`}
                  </Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.text}>{step.title}</Text>
                    <Text style={s.small}>
                      {stepStatusLabel(step.status)}
                      {step.detail ? ` · ${step.detail}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {!!task.result && (
            <Card style={{ backgroundColor: colors.green }}>
              <Text selectable style={s.text}>
                {resultSummary(task.result)}
              </Text>
            </Card>
          )}
          <ErrorNotice error={task.error ?? undefined} />
          {detail?.browsers?.map((browser) => (
            <Card key={browser.id} style={{ gap: 10 }}>
              <Text style={s.heading}>{browser.title || "智能体浏览器"}</Text>
              <Text style={s.small}>{browser.url}</Text>
              {browser.status === "active" && browser.previewUrl && (
                <Image
                  accessibilityLabel="智能体浏览器预览"
                  source={{ uri: api.url(browser.previewUrl) }}
                  style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12 }}
                />
              )}
              <Button
                small
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void (async () => {
                    try {
                      if (["running", "scheduled", "queued"].includes(task.status))
                        await mutate(`/tasks/${taskId}/control`, { action: "pause" });
                      open({ type: "browser", browser });
                    } catch (error) {
                      setError(errorText(error));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {["running", "scheduled", "queued"].includes(task.status)
                  ? "暂停并打开浏览器"
                  : "打开浏览器"}
              </Button>
            </Card>
          ))}
          {detail?.files?.map((file) => (
            <LinkRow
              key={file.id}
              title={file.name}
              detail={`${file.pageCount} pages · PDF`}
              icon={FileText}
              onPress={() => open({ type: "file", file })}
            />
          ))}
          {(
            data?.artifacts.filter((artifact) => artifact.taskId === taskId) ||
            detail?.artifacts ||
            []
          ).map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
          {!!task.evidence.length && (
            <View style={{ gap: 14 }}>
              <Text style={s.heading}>来源</Text>
              <EvidenceList items={task.evidence} />
            </View>
          )}
          <Text style={s.heading}>时间线</Text>
          {detail?.events.map((event) => (
            <View
              key={event.id}
              style={[
                s.row,
                {
                  gap: 9,
                  alignItems: "flex-start",
                  paddingLeft: 12,
                  borderLeftWidth: 2,
                  borderLeftColor: event.kind === "error" ? colors.danger : colors.line,
                },
              ]}
            >
              {/* 照 Muse：每一步带结果标记（完成 ✓ / 失败 ✗ / 交付 ★） */}
              <Text
                style={[
                  s.text,
                  {
                    color:
                      event.kind === "error"
                        ? colors.danger
                        : event.kind === "result"
                          ? colors.blueDark
                          : "#1F8A4C",
                  },
                ]}
              >
                {event.kind === "error" ? "✗" : event.kind === "result" ? "★" : "✓"}
              </Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.small}>
                  {stamp(event.date)} · {statusLabel(event.kind)}
                </Text>
                <Text style={s.text}>{event.title}</Text>
                <Text selectable style={s.muted}>
                  {event.detail}
                </Text>
              </View>
            </View>
          ))}
          {!detail?.events.length && <Text style={s.muted}>worker 会把每一步记录在这里。</Text>}
        </View>
      )}
    </Sheet>
  );
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function display(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : value === null
        ? "—"
        : JSON.stringify(value, null, 2) || "";
}
export function ArtifactCard({ artifact }: { artifact: AgentArtifact }) {
  const [expanded, setExpanded] = useState(false);
  if (artifact.kind === "finance") return <FinanceArtifact artifact={artifact} />;
  const rows = Object.entries(artifact.data);
  return (
    <Card style={{ gap: 13, backgroundColor: colors.card }}>
      <View style={s.between}>
        <Text style={s.heading}>{artifact.title}</Text>
        <Chip>{statusLabel(artifact.kind)}</Chip>
      </View>
      <Text selectable style={s.muted}>
        {artifact.summary}
      </Text>
      {(expanded ? rows : rows.slice(0, 4)).map(([key, value]) => (
        <View key={key} style={{ gap: 6 }}>
          <Text style={s.label}>{key.replace(/_/g, " ")}</Text>
          {Array.isArray(value) ? (
            value.slice(0, expanded ? 100 : 5).map((item) => {
              const row = record(item);
              return (
                <View
                  key={`${key}-${display(row?.id ?? item)}`}
                  style={{
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <Text selectable style={s.text}>
                    {row
                      ? Object.entries(row)
                          .map(([name, val]) => `${name}: ${display(val)}`)
                          .join(" · ")
                      : display(item)}
                  </Text>
                </View>
              );
            })
          ) : record(value) ? (
            Object.entries(record(value) || {}).map(([name, val]) => (
              <View key={name} style={s.between}>
                <Text style={s.muted}>{name}</Text>
                <Text selectable style={s.text}>
                  {display(val)}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={[s.text, { fontSize: typeof value === "number" ? 24 : 14 }]}>
              {display(value)}
            </Text>
          )}
        </View>
      ))}
      <Button small onPress={() => setExpanded(!expanded)}>
        {expanded ? "显示摘要" : "查看完整结果"}
      </Button>
    </Card>
  );
}
function FinanceArtifact({ artifact }: { artifact: AgentArtifact }) {
  const [details, setDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { mutate } = useAgentWorkspace();
  const [goalTitle, setGoalTitle] = useState("");
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState("");
  const saveGoal = async () => {
    setGoalBusy(true);
    setGoalError("");
    try {
      await mutate("/goals", {
        title: goalTitle.trim(),
        category: "财务",
        description: `Inspired by ${artifact.title}: ${artifact.summary}`,
        milestones: ["选一个储蓄目标", "每周复盘支出"],
      });
      setGoalSaved(true);
    } catch (error) {
      setGoalError(errorText(error));
    } finally {
      setGoalBusy(false);
    }
  };
  const amount = (value: unknown) =>
    Number(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const categories = Array.isArray(artifact.data.categories) ? artifact.data.categories : [];
  const transactions = Array.isArray(artifact.data.transactions) ? artifact.data.transactions : [];
  const spending = Number(artifact.data.spending) || 1;
  const period = record(artifact.data.period);
  return (
    <Card
      style={{ gap: 12, padding: 10, backgroundColor: "#EEEEF0", maxWidth: 440, width: "100%" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open finance tracker: ${artifact.title}`}
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails(!details)}
      >
        <View
          style={{
            minHeight: 200,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#080B10",
            padding: 20,
          }}
        >
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 142 }}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="finance" x1="0" y1="0" x2="0.5" y2="1">
                  <Stop offset="0" stopColor="#281066" />
                  <Stop offset="0.5" stopColor="#163BBF" />
                  <Stop offset="1" stopColor="#148CE8" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#finance)" />
            </Svg>
          </View>
          <Text style={{ color: "#D4DCFC", fontSize: 11, lineHeight: 18, marginBottom: 20 }}>
            来自你导入的交易记录。{"\n"}
            {String(period?.from ?? "")} — {String(period?.to ?? "")}
            {"\n"}
            已归类汇总 {transactions.length} 笔。
          </Text>
          <View style={[s.row, { gap: 7 }]}>
            {(
              [
                ["Income", "income"],
                ["Spending", "spending"],
                ["Remaining", "saved"],
              ] as const
            ).map(([label, key]) => (
              <View
                key={key}
                style={{ flex: 1, padding: 11, borderRadius: 12, backgroundColor: "#1D2025" }}
              >
                <Text style={{ color: "#A4A7AD", fontSize: 9 }}>{label}</Text>
                <Text
                  selectable
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                  style={{
                    fontSize: 17,
                    fontWeight: "600",
                    color: key === "saved" ? "#58D3AE" : "#FFF",
                    marginTop: 5,
                  }}
                >
                  {amount(artifact.data[key])}
                </Text>
                <Text style={{ color: "#7E8289", fontSize: 8, marginTop: 4 }}>原始货币</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[s.row, { gap: 11, paddingHorizontal: 8, paddingTop: 13, paddingBottom: 4 }]}>
          <Text style={{ fontSize: 25 }}>💸</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>记账</Text>
            <Text style={s.small}>支出、储蓄，以及接下来的计划。</Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
      </Pressable>
      {details && (
        <View style={{ gap: 16, padding: 10 }}>
          <Text style={s.label}>你的钱花在哪了</Text>
          {categories.map((category) => {
            const row = record(category);
            if (!row) return null;
            return (
              <View key={String(row.name)} style={{ gap: 8 }}>
                <View style={s.between}>
                  <Text style={s.text}>{String(row.name)}</Text>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
                <View style={{ height: 7, backgroundColor: "#DFE8EB", borderRadius: 8 }}>
                  <View
                    style={{
                      width: `${Math.min(100, (Number(row.amount) / spending) * 100)}%`,
                      height: 7,
                      backgroundColor: colors.blueDark,
                      borderRadius: 8,
                    }}
                  />
                </View>
              </View>
            );
          })}
          <Text style={s.small}>金额使用你的原始货币，此汇总覆盖已导入的日期范围。</Text>
          {goalSaved ? (
            <Text style={s.text}>你的储蓄目标已保存在「目标」。</Text>
          ) : (
            <View style={{ gap: 10 }}>
              <Field
                label="把它变成储蓄目标"
                value={goalTitle}
                onChangeText={setGoalTitle}
                placeholder="你想为什么攒钱？"
              />
              <ErrorNotice error={goalError} />
              <Button
                small
                busy={goalBusy}
                disabled={!goalTitle.trim()}
                onPress={() => void saveGoal()}
              >
                新建储蓄目标
              </Button>
            </View>
          )}
          <Button small onPress={() => setExpanded(!expanded)}>
            {expanded ? "隐藏交易" : "查看交易"}
          </Button>
          {expanded &&
            transactions.slice(0, 100).map((transaction) => {
              const row = record(transaction);
              return row ? (
                <View key={String(row.id ?? display(row))} style={s.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.text}>{String(row.description)}</Text>
                    <Text style={s.small}>
                      {String(row.date)} · {String(row.category)}
                    </Text>
                  </View>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
              ) : null;
            })}
          {expanded && transactions.length > 100 && (
            <Text style={s.small}>仅显示前 100 条交易，合计包含所有行。</Text>
          )}
        </View>
      )}
    </Card>
  );
}
export function DelegateSheet() {
  const { workspace, close, open } = useWorkspace();
  const { delegate } = useAgentWorkspace();
  const [kind, setKind] = useState<AgentTask["kind"]>("plan");
  const [prompt, setPrompt] = useState("");
  const [messageId, setMessageId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        prompt: prompt.trim(),
        kind,
        input: kind === "finance" ? { csv } : kind === "document" ? { messageId } : {},
      });
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="交办一件事"
      subtitle="OpenMuse 会保存计划，并在服务器上继续干活。"
      onClose={close}
    >
      <View style={[s.row, { flexWrap: "wrap", gap: 8, marginBottom: 20 }]}>
        {(["plan", "document", "finance", "agent"] as const).map((item) => (
          <Button small primary={kind === item} key={item} onPress={() => setKind(item)}>
            {item === "agent" ? "通用任务" : statusLabel(item)}
          </Button>
        ))}
      </View>
      <Field
        label="你想让它完成什么？"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        placeholder={
          kind === "document"
            ? "填好附件里的表单，并准备一封回复待我复核"
            : kind === "finance"
              ? "汇总我的支出并建议一个储蓄计划"
              : "帮我做个能落地的一周计划"
        }
      />
      {kind === "document" && (
        <View style={{ gap: 8, marginBottom: 18 }}>
          <Text style={s.heading}>选择带 PDF 的那封邮件</Text>
          {workspace.mail
            .filter((mail) => mail.attachments.length)
            .map((mail) => (
              <CheckRow
                key={mail.id}
                checked={mail.id === messageId}
                label={`${mail.subject} · ${mail.sender}`}
                onPress={() => setMessageId(mail.id)}
              />
            ))}
          {!workspace.mail.some((mail) => mail.attachments.length) && (
            <Text style={s.muted}>在「应用」里关联邮箱，然后选择一封带 PDF 附件的邮件。</Text>
          )}
        </View>
      )}
      {kind === "finance" && (
        <>
          <Field
            label="交易 CSV"
            value={csv}
            onChangeText={setCsv}
            multiline
            autoCapitalize="none"
            placeholder={"date,description,amount,category\n2026-09-01,Groceries,54.20,Food"}
          />
          {workspace.mode === "sample" && (
            <Button
              onPress={() =>
                setCsv(
                  "date,description,amount,category\n2026-09-01,Salary,-4200,Income\n2026-09-02,Groceries,84.50,Food\n2026-09-03,Subscription,19.99,Subscriptions\n2026-09-04,Coffee,6.50,Food",
                )
              }
            >
              试试示例交易
            </Button>
          )}
          <Text style={[s.small, { marginVertical: 12 }]}>
            正数为支出，负数为收入。仅限已导入的数据，并不代表连接了银行。
          </Text>
        </>
      )}
      {kind === "agent" && !workspace.runtime.configured && (
        <Text style={[s.muted, { marginBottom: 16 }]}>
          通用任务与计划需要先配置模型。文档处理、网页监控和支出汇总有引导式流程。
        </Text>
      )}
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !prompt.trim() ||
          (kind === "document" && !messageId) ||
          (kind === "finance" && !csv.trim())
        }
        onPress={() => void submit()}
      >
        派发任务
      </Button>
    </Sheet>
  );
}
export function IdeasScreen() {
  const { data, mutate } = useAgentWorkspace();
  const { navigate, notify } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refreshIdeas() {
    setBusy(true);
    setError("");
    try {
      const refreshed = await mutate<{ id: string; status: string }[]>("/ideas/refresh", {});
      const fresh = (Array.isArray(refreshed) ? refreshed : []).filter(
        (idea) => idea?.status === "new",
      );
      // 灵感按来源内容去重：同一封邮件只提醒一次，处理过就不再重复推荐 —— 所以"没反应"很常见，
      // 必须把原因说出来，否则看起来就是按钮坏了
      if (!fresh.length)
        notify(
          "暂时没有新的灵感 —— 灵感来自你已连接的应用，而且同一来源只提醒一次。去「应用」里连上邮箱或日历再试。",
        );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ideas = data?.ideas.filter((idea) => idea.status === "new") || [];
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={s.between}>
        <Text style={s.small}>灵感来自你已连接的应用</Text>
        <Button small icon={RefreshCw} busy={busy} onPress={() => void refreshIdeas()}>
          找灵感
        </Button>
      </View>
      <ErrorNotice error={error} />
      {/* 照 Muse 的 IdeaCardSection：灵感是**分区**的，不是一维列表 */}
      {(
        [
          { kind: "document", title: "邮件里的文档" },
          { kind: "agent", title: "日程与对接" },
          { kind: "plan", title: "目标与计划" },
        ] as const
      ).map((group) => {
        const items = ideas.filter((idea) => idea.kind === group.kind);
        if (!items.length) return null;
        return (
          <View key={group.kind} style={{ gap: 2 }}>
            <View style={[s.between, { marginBottom: 4 }]}>
              <Text style={s.small}>{group.title}</Text>
              <Text style={s.small}>{items.length} 条</Text>
            </View>
            {items.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))}
          </View>
        );
      })}
      {ideas
        .filter((idea) => !["document", "agent", "plan"].includes(idea.kind))
        .map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      {!ideas.length && (
        <Empty
          icon={Lightbulb}
          title="还没有可做的灵感"
          detail="灵感不是凭空来的：我会从你**已连接的应用**（邮箱、日历）里找线索，每条都附上原文出处和依据。

现在还没有连接任何应用，所以没有来源可看；就算连上了，同一个来源也只提醒一次，处理过就不再重复。"
        >
          <Button small icon={ArrowRight} onPress={() => navigate("apps")}>
            去连接应用
          </Button>
        </Empty>
      )}
      {(data?.ideas || [])
        .filter((idea) => idea.status === "accepted")
        .map((idea) => (
          <Card key={idea.id} style={{ gap: 7 }}>
            <Text style={s.heading}>{idea.title}</Text>
            <Chip tint={colors.green}>已开始</Chip>
            {!!idea.taskId && <TaskLink taskId={idea.taskId} />}
          </Card>
        ))}
    </View>
  );
}
function TaskLink({ taskId, onOpen }: { taskId: string; onOpen?: () => void }) {
  const { open } = useWorkspace();
  return (
    <Button
      small
      icon={ArrowRight}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId });
      }}
    >
      查看任务
    </Button>
  );
}
function IdeaCard({ idea }: { idea: Idea }) {
  const { mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(idea.prompt);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 照 Muse 的 IdeaCardItem{selectable, isSelected}：卡里的小条目可以单独勾
  const [chosen, setChosen] = useState<string[]>(
    (idea.items ?? []).filter((item) => item.selected !== false).map((item) => item.id),
  );
  async function executeSelected() {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Idea>(`/ideas/${idea.id}/execute`, {
        itemIds: chosen,
        mode: "selected",
      });
      if (result.taskId) open({ type: "task", taskId: result.taskId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    const lines = [idea.title, idea.reason, idea.buildSummary ? `会得到：${idea.buildSummary}` : ""]
      .filter(Boolean)
      .join("\n");
    await Share.share({ message: lines }).catch(() => {});
  }
  async function act(action: "accept" | "dismiss" | "feedback", value?: "up" | "down") {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Idea>(`/ideas/${idea.id}`, { action, prompt, value });
      if (result.taskId && action === "accept") open({ type: "task", taskId: result.taskId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View idea: ${idea.title}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: "row", gap: 14 }}
      >
        <Text style={{ fontSize: 27, width: 34, paddingTop: 3 }}>
          {/document|permission|form/i.test(idea.title)
            ? "📋"
            : /money|spend|saving/i.test(idea.title)
              ? "💸"
              : /goal|plan|training/i.test(idea.title)
                ? "👟"
                : /dinner|table/i.test(idea.title)
                  ? "🍽️"
                  : "💡"}
        </Text>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[s.heading, { fontSize: 16, lineHeight: 23 }]}>{idea.title}</Text>
          {/* 照 Muse 的 fitReason：说清"这条为什么贴合你"，而不是只给一句描述 */}
          <Text style={s.muted}>{idea.reason}</Text>
          {/* 照 Muse 的 badges：角标由服务端下发 */}
          {!!idea.badges?.length && (
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {idea.badges.map((badge) => (
                <Chip key={badge} tint={idea.seeded ? colors.sky : colors.lavender}>
                  {badge}
                </Chip>
              ))}
            </View>
          )}
        </View>
      </Pressable>
      {expanded && (
        <View style={{ gap: 15, marginTop: 18, paddingLeft: 48 }}>
          {/* 照 Muse 的 buildSummary："做出来会得到什么" */}
          {!!idea.buildSummary && (
            <Card style={{ gap: 6, padding: 13, backgroundColor: colors.sky }}>
              <Text style={s.small}>做出来会得到</Text>
              <Text style={s.text}>{idea.buildSummary}</Text>
            </Card>
          )}
          {/* 照 Muse 的 IdeaCardItem：可勾选条目，执行时按 itemIds 走 */}
          {!!idea.items?.length && (
            <View style={{ gap: 9 }}>
              <Text style={s.small}>这次要做哪几件（可多选）</Text>
              {idea.items.map((item) => {
                const on = chosen.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${on ? "取消" : "选择"}：${item.title}`}
                    disabled={busy}
                    onPress={() =>
                      setChosen((ids) =>
                        on ? ids.filter((id) => id !== item.id) : [...ids, item.id],
                      )
                    }
                    style={[s.row, { gap: 10, alignItems: "flex-start" }]}
                  >
                    <Check
                      size={18}
                      color={on ? colors.blueDark : colors.line}
                      style={{ marginTop: 2 }}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.text}>{item.title}</Text>
                      {!!item.summary && <Text style={s.small}>{item.summary}</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          <EvidenceList items={idea.evidence} />
          {editing && (
            <Field
              label="想让 OpenMuse 做什么？"
              value={prompt}
              onChangeText={setPrompt}
              multiline
            />
          )}
          <ErrorNotice error={error} />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              primary
              busy={busy}
              disabled={!prompt.trim() || (!!idea.items?.length && !chosen.length)}
              onPress={() => void (idea.items?.length ? executeSelected() : act("accept"))}
            >
              {idea.items?.length ? `只做勾选的 ${chosen.length} 件` : "开始这个"}
            </Button>
            <Button disabled={busy} onPress={() => setEditing(!editing)}>
              {editing ? "保留修改" : "编辑"}
            </Button>
            <Button disabled={busy} onPress={() => void act("dismiss")}>
              忽略
            </Button>
            <Button disabled={busy} onPress={() => void share()}>
              分享
            </Button>
            {/* 照 Muse 的 IdeaFeedback：点踩过的方向，后面就不再推荐 */}
            <Button
              disabled={busy}
              icon={idea.feedback === "up" ? Check : undefined}
              onPress={() => void act("feedback", "up")}
            >
              贴合
            </Button>
            <Button
              disabled={busy}
              icon={idea.feedback === "down" ? Check : undefined}
              onPress={() => void act("feedback", "down")}
            >
              不感兴趣
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
/**
 * 短时凭据管理（照 Muse 的 `LinkDeviceTokenMinter.mint/revoke` + `TemporaryAccess`）。
 * 铁律：密钥不进日志、列表**永远只显示后 6 位**、铸造那一刻的明文只出现一次。
 */
type CredentialView = TemporaryCredential & { secretTail: string; usable: boolean };
const CREDENTIAL_KIND_LABEL: Record<TemporaryCredential["kind"], string> = {
  git: "Git 仓库",
  api: "外部 API",
  ssh: "SSH",
};
function credentialState(item: CredentialView): { text: string; tint: string } {
  if (item.usable) return { text: "可用", tint: colors.green };
  if (item.revokeReason === "task_finished") return { text: "已随任务销毁", tint: colors.line };
  if (item.revokeReason === "expired") return { text: "已过期", tint: colors.line };
  return { text: "已吊销", tint: colors.line };
}
export function CredentialsPanel() {
  const { api, close, notify, open } = useWorkspace();
  const [items, setItems] = useState<CredentialView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<{ label: string; secret: string } | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<TemporaryCredential["kind"]>("git");
  const [scopes, setScopes] = useState("");
  const [ttl, setTtl] = useState(30);

  const load = useCallback(async () => {
    try {
      setItems(await api.request<CredentialView[]>("/api/agent/credentials"));
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function mint() {
    if (!label.trim()) return;
    setBusy(true);
    setError("");
    try {
      const made = await api.request<{ label: string; secret: string }>("/api/agent/credentials", {
        label: label.trim(),
        kind,
        scopes: scopes.split(/[,\s]+/).filter(Boolean),
        ttlMs: ttl * 60_000,
      });
      // 明文只在这里出现一次；之后任何地方都只有后 6 位
      setFresh({ label: made.label, secret: made.secret });
      setLabel("");
      setScopes("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(item: CredentialView) {
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/agent/credentials/${item.id}/revoke`, {});
      notify(`已吊销「${item.label}」`);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="短时凭据"
      subtitle="给任务临时用。任务一结束就自动销毁 —— 不是长期放在配置里的那种。"
      onClose={close}
    >
      {fresh && (
        <Card style={{ gap: 10, backgroundColor: colors.lavender }}>
          <Text style={s.heading}>「{fresh.label}」的密钥</Text>
          <Text style={s.small}>只显示这一次。离开这个面板后就再也取不到明文了。</Text>
          <Text selectable style={{ fontFamily: "monospace", fontSize: 13, color: colors.text }}>
            {fresh.secret}
          </Text>
          <View style={[s.row, { gap: 8 }]}>
            <Button
              small
              icon={ArrowRight}
              onPress={() => void Share.share({ message: fresh.secret }).catch(() => {})}
            >
              分享给自己
            </Button>
            <Button small onPress={() => setFresh(null)}>
              我记下了
            </Button>
          </View>
        </Card>
      )}

      <View style={s.between}>
        <Text style={s.small}>共 {items.length} 把</Text>
        <Button small icon={Plus} busy={busy} onPress={() => setAdding(!adding)}>
          {adding ? "收起" : "铸一把"}
        </Button>
      </View>

      {adding && (
        <Card style={{ gap: 12 }}>
          <Field
            label="用途名称"
            value={label}
            onChangeText={setLabel}
            placeholder="例如：给 xx 仓库推代码"
          />
          <View style={{ gap: 7 }}>
            <Text style={s.small}>类型</Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {(["git", "api", "ssh"] as const).map((option) => (
                <Pressable key={option} onPress={() => setKind(option)}>
                  <Chip tint={kind === option ? colors.sky : undefined}>
                    {CREDENTIAL_KIND_LABEL[option]}
                  </Chip>
                </Pressable>
              ))}
            </View>
          </View>
          <Field
            label="权限范围（逗号分隔，可留空）"
            value={scopes}
            onChangeText={setScopes}
            placeholder="repo:write, pr:create"
          />
          <View style={{ gap: 7 }}>
            <Text style={s.small}>有效期</Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {[15, 30, 60, 120].map((minutes) => (
                <Pressable key={minutes} onPress={() => setTtl(minutes)}>
                  <Chip tint={ttl === minutes ? colors.sky : undefined}>{minutes} 分钟</Chip>
                </Pressable>
              ))}
            </View>
          </View>
          <Button primary busy={busy} disabled={!label.trim()} onPress={() => void mint()}>
            铸好
          </Button>
        </Card>
      )}

      <ErrorNotice error={error} />

      {items.map((item) => {
        const state = credentialState(item);
        return (
          <Card key={item.id} style={{ gap: 9 }}>
            <View style={s.between}>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Text style={s.heading}>{item.label}</Text>
                <Chip>{CREDENTIAL_KIND_LABEL[item.kind]}</Chip>
              </View>
              <Chip tint={state.tint}>{state.text}</Chip>
            </View>
            <Text style={s.small}>
              密钥 {item.secretTail}
              {item.scopes.length ? ` · 权限 ${item.scopes.join("、")}` : ""}
              {` · 到期 ${stamp(item.expiresAt)}`}
            </Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {!!item.taskId && (
                <Button
                  small
                  icon={ArrowRight}
                  onPress={() => open({ type: "task", taskId: String(item.taskId) })}
                >
                  看绑定的任务
                </Button>
              )}
              {item.usable && (
                <Button small disabled={busy} onPress={() => void revoke(item)}>
                  立即吊销
                </Button>
              )}
            </View>
          </Card>
        );
      })}

      {!items.length && (
        <Empty
          icon={ShieldCheck}
          title="还没有短时凭据"
          detail="任务需要写仓库或调外部接口时，给它铸一把：只在这次任务期间有效，任务一结束就自动吊销（不会留在配置里）。"
        />
      )}
    </Sheet>
  );
}
export function GoalsScreen() {
  const { data } = useAgentWorkspace();
  const [adding, setAdding] = useState<string>();
  const [selectedGoal, setSelectedGoal] = useState<string>();
  const [selectedMonitor, setSelectedMonitor] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  const goal = data?.goals.find((item) => item.id === selectedGoal);
  const monitor = data?.monitors.find((item) => item.id === selectedMonitor);
  const monitors = data?.monitors || [];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <View style={{ gap: 8 }}>
        <View style={[s.between, { marginBottom: 5 }]}>
          <View style={[s.row, { gap: 10 }]}>
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 5,
                borderColor: "#D9F1E2",
                backgroundColor: "#24A46B",
              }}
            />
            <Text style={[s.heading, { color: "#189A58" }]}>跟踪中</Text>
          </View>
          <Button small icon={Plus} onPress={() => setAdding("跟踪中")}>
            跟踪
          </Button>
        </View>
        {(showAll ? monitors : monitors.slice(0, 3)).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open tracking: ${item.title}`}
            onPress={() => setSelectedMonitor(item.id)}
            style={[s.row, { gap: 12, paddingVertical: 13 }]}
          >
            <Square size={21} color="#A7AAAC" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{item.title}</Text>
              <Text numberOfLines={1} style={s.muted}>
                {item.status === "active"
                  ? `Checking every ${item.intervalMinutes} minutes`
                  : statusLabel(item.status)}
              </Text>
            </View>
            <ChevronRight size={18} color="#A3A6A8" />
          </Pressable>
        ))}
        {!monitors.length && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>票价、订位，或是你正在盯着的页面。</Text>
        )}
        {monitors.length > 3 && (
          <Button small onPress={() => setShowAll(!showAll)}>
            {showAll ? "收起" : `Show ${monitors.length - 3} more`}
          </Button>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 10, marginBottom: 5 }]}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 5,
              borderColor: "#D7E9FA",
              backgroundColor: "#3D9BDE",
            }}
          />
          <Text style={[s.heading, { color: colors.blueDark }]}>目标</Text>
        </View>
        {data?.goals.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open goal: ${item.title}`}
            onPress={() => setSelectedGoal(item.id)}
            style={[s.row, { gap: 12, paddingVertical: 13 }]}
          >
            <Square
              size={21}
              color="#A7AAAC"
              fill={item.status === "completed" ? colors.green : "transparent"}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.text}>{item.title}</Text>
              <Text numberOfLines={2} style={s.muted}>
                {item.description || statusLabel(item.status)}
              </Text>
            </View>
            <ChevronRight size={18} color="#A3A6A8" />
          </Pressable>
        ))}
        {!data?.goals.length && (
          <Text style={[s.muted, { paddingVertical: 10 }]}>大计划都从一小步开始。</Text>
        )}
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <Text style={s.heading}>新建目标</Text>
      {[
        { name: "健康", icon: Heart },
        { name: "关系", icon: Users },
        { name: "财务", icon: CircleDollarSign },
        { name: "其他", icon: Target },
      ].map((item) => (
        <Pressable
          key={item.name}
          accessibilityRole="button"
          accessibilityLabel={`Create ${item.name.toLowerCase()} goal`}
          onPress={() => setAdding(item.name)}
          style={[s.row, { gap: 12, minHeight: 38 }]}
        >
          <item.icon size={23} color="#989C9F" />
          <Text style={[s.text, { flex: 1, color: "#666A6D" }]}>{item.name}</Text>
          <Plus size={18} color="#989C9F" />
        </Pressable>
      ))}
      {adding && (
        <Sheet
          title={adding === "跟踪中" ? "跟踪点什么" : "新建目标"}
          onClose={() => setAdding(undefined)}
        >
          {adding === "跟踪中" ? (
            <MonitorForm onDone={() => setAdding(undefined)} />
          ) : (
            <GoalForm category={adding} onDone={() => setAdding(undefined)} />
          )}
        </Sheet>
      )}
      {goal && (
        <Sheet title={goal.title} onClose={() => setSelectedGoal(undefined)}>
          <GoalCard goal={goal} onOpenTask={() => setSelectedGoal(undefined)} />
        </Sheet>
      )}
      {monitor && (
        <Sheet title={monitor.title} onClose={() => setSelectedMonitor(undefined)}>
          <MonitorCard monitor={monitor} onOpenTask={() => setSelectedMonitor(undefined)} />
        </Sheet>
      )}
    </View>
  );
}
function GoalForm({ onDone, category }: { onDone: () => void; category?: string }) {
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/goals", {
        title: title.trim(),
        category,
        description,
        milestones: milestones
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="你的目标"
        value={title}
        onChangeText={setTitle}
        placeholder="攒出一笔三个月的应急金"
      />
      <Field label="怎样算成功？" value={description} onChangeText={setDescription} multiline />
      <Field label="里程碑（每行一个）" value={milestones} onChangeText={setMilestones} multiline />
      <ErrorNotice error={error} />
      <Button primary disabled={!title.trim()} busy={busy} onPress={() => void save()}>
        新建目标
      </Button>
    </Card>
  );
}
function GoalCard({ goal, onOpenTask }: { goal: Goal; onOpenTask?: () => void }) {
  const { data, mutate, delegate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = goal.milestones.filter((item) => item.done).length;
  async function update(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/goals/${goal.id}`, body);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        title: `Plan: ${goal.title}`,
        prompt: `Create a practical plan for this goal: ${goal.title}. ${goal.description}`,
        kind: "plan",
        goalId: goal.id,
        input: {},
      });
      onOpenTask?.();
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{goal.title}</Text>
        <Chip tint={goal.status === "completed" ? colors.green : colors.sky}>
          {statusLabel(goal.status)}
        </Chip>
      </View>
      <Text style={s.muted}>{goal.description}</Text>
      <Text style={s.small}>
        {done} / {goal.milestones.length} 个里程碑
      </Text>
      {goal.milestones.map((milestone) => (
        <CheckRow
          key={milestone.id}
          checked={milestone.done}
          label={milestone.title}
          onPress={() => {
            if (!busy)
              void update({
                milestones: goal.milestones.map((item) =>
                  item.id === milestone.id ? { ...item, done: !item.done } : item,
                ),
              });
          }}
        />
      ))}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          busy={busy}
          onPress={() => void update({ status: goal.status === "active" ? "paused" : "active" })}
        >
          {goal.status === "active" ? "暂停" : "继续"}
        </Button>
        {goal.status !== "completed" && (
          <Button small busy={busy} onPress={() => void update({ status: "completed" })}>
            完成目标
          </Button>
        )}
        <Button small primary busy={busy} onPress={() => void plan()}>
          规划下一步
        </Button>
      </View>
      {data?.tasks
        .filter((task) => task.goalId === goal.id)
        .map((task) => (
          <TaskCard key={task.id} task={task} compact onOpen={onOpenTask} />
        ))}
    </Card>
  );
}
function MonitorForm({ onDone }: { onDone: () => void }) {
  const { workspace } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [condition, setCondition] = useState<Monitor["condition"]>("change");
  const [value, setValue] = useState("");
  const [interval, setInterval] = useState("15");
  const [sample, setSample] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const minutes = Number(interval);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
        throw new Error("检查间隔需在 1 到 10080 分钟之间。");
      if (!sample && !/^https?:\/\//i.test(url.trim()))
        throw new Error("输入公网页面的 http 或 https 地址。");
      await mutate("/monitors", {
        title: title.trim(),
        url: sample ? "sample://availability" : url.trim(),
        condition,
        value,
        intervalMinutes: minutes,
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="你在关注什么？"
        value={title}
        onChangeText={setTitle}
        placeholder="帮我订常去餐厅的位子"
      />
      {workspace.mode === "sample" && (
        <CheckRow
          checked={sample}
          label="试试内置的可约时间页"
          onPress={() => setSample(!sample)}
        />
      )}
      {!sample && (
        <Field
          label="公开页面 URL"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          placeholder="https://example.com/product"
        />
      )}
      <Text style={[s.small, { marginBottom: 10 }]}>在以下情况通知我</Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {(["change", "contains", "price_below"] as const).map((item) => (
          <Button small primary={condition === item} key={item} onPress={() => setCondition(item)}>
            {item === "change" ? "页面变更" : item === "contains" ? "出现文字" : "价格低于"}
          </Button>
        ))}
      </View>
      {condition !== "change" && (
        <Field
          label={condition === "contains" ? "要查找的文字" : "目标价格"}
          value={value}
          onChangeText={setValue}
        />
      )}
      <Field
        label="检查间隔（分钟）"
        value={interval}
        onChangeText={setInterval}
        keyboardType="number-pad"
      />
      <Text style={[s.small, { marginBottom: 14 }]}>
        {sample
          ? "对这个内置页面的修改只留在你的工作区。"
          : "OpenMuse 会在服务器上检查这个公开页面，并把有意义的变更存进通知。"}
      </Text>
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !title.trim() || (!sample && !url.trim()) || (condition !== "change" && !value.trim())
        }
        onPress={() => void save()}
      >
        开始跟踪
      </Button>
    </Card>
  );
}
function MonitorCard({ monitor, onOpenTask }: { monitor: Monitor; onOpenTask?: () => void }) {
  const { mutate } = useAgentWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/monitors/${monitor.id}/control`, { action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeSample() {
    setBusy(true);
    setError("");
    try {
      await mutate("/sample-page", {
        text: `Availability: a table is available. Updated ${new Date().toISOString()}`,
      });
      await mutate(`/monitors/${monitor.id}/control`, { action: "check" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 13 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{monitor.title}</Text>
        <Chip tint={colors.sky}>{statusLabel(monitor.status)}</Chip>
      </View>
      <Text selectable style={s.small}>
        {monitor.url.startsWith("sample:") ? "内置可约时间页" : monitor.url}
      </Text>
      <Text style={s.text}>
        {monitor.condition === "change"
          ? "监控页面变更"
          : monitor.condition === "contains"
            ? `监控是否出现「${monitor.value}」`
            : `价格低于 ${monitor.value}`}
      </Text>
      <Text style={s.small}>
        每 {monitor.intervalMinutes} 分钟检查一次 · 已检查 {monitor.checks} 次
      </Text>
      <Text style={s.small}>
        上次检查：{stamp(monitor.lastCheckedAt)}
        {monitor.status === "active" ? `\n下次检查：${stamp(monitor.nextCheckAt)}` : ""}
      </Text>
      {!!monitor.lastValue && (
        <Text selectable numberOfLines={5} style={s.muted}>
          {monitor.lastValue}
        </Text>
      )}
      <ErrorNotice error={error || monitor.error} />
      {monitor.status !== "stopped" && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button
            small
            busy={busy}
            onPress={() => void act(monitor.status === "active" ? "pause" : "resume")}
          >
            {monitor.status === "active" ? "暂停" : "继续"}
          </Button>
          <Button small busy={busy} onPress={() => void act("check")}>
            立即检查
          </Button>
          <Button small danger busy={busy} onPress={() => void act("stop")}>
            停止跟踪
          </Button>
        </View>
      )}
      {monitor.url.startsWith("sample:") && monitor.status !== "stopped" && (
        <Button small busy={busy} onPress={() => void changeSample()}>
          修改可约时间
        </Button>
      )}
      <TaskLink taskId={monitor.taskId} onOpen={onOpenTask} />
    </Card>
  );
}
/**
 * 待复核动作的行列表：铃铛面板与活动页共用同一套渲染，
 * 保证"红点数量 = 进去能看到的待办数量"。
 */
function PendingActionCards({
  actions,
  onOpen,
}: {
  actions: ActionProposal[];
  onOpen: (action: ActionProposal, rect?: HeroRect) => void;
}) {
  return (
    <Card style={{ backgroundColor: colors.lavender }}>
      <SectionHeading title={`等你复核 · ${actions.length}`} />
      {actions.map((action) => (
        <MeasureCard
          key={action.id}
          label={`复核：${action.title}`}
          style={[
            s.row,
            { gap: 15, paddingVertical: 17, borderTopWidth: 1, borderTopColor: colors.line },
          ]}
          onPress={(rect) => onOpen(action, rect)}
        >
          <View style={[s.iconBox, { backgroundColor: colors.lavender }]}>
            <ShieldCheck size={18} color={colors.text} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.text}>{action.title}</Text>
            <Text style={s.small}>
              {actionKindLabel(action.kind)}
              {action.account ? ` · ${action.account}` : ""}
            </Text>
          </View>
          <Button primary small onPress={() => onOpen(action)}>
            复核
          </Button>
        </MeasureCard>
      ))}
    </Card>
  );
}

export function NotificationsSheet() {
  const { data, mutate } = useAgentWorkspace();
  const { workspace: w, close, open } = useWorkspace();
  const [error, setError] = useState("");
  const pendingActions = w.actions.filter((action) => action.status === "awaiting_review");
  const unread = (data?.notifications || []).filter((item) => !item.read).length;
  async function read(id: string, taskId?: string) {
    try {
      await mutate(`/notifications/${id}/read`, {});
      if (taskId) open({ type: "task", taskId });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Sheet
      title="待你处理"
      subtitle={pendingSummary(pendingActions.length, unread)}
      onClose={close}
    >
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {!!pendingActions.length && (
          <PendingActionCards
            actions={pendingActions}
            onOpen={(action, rect) =>
              open({
                type: "review",
                action,
                ...(rect
                  ? {
                      hero: {
                        rect,
                        title: action.title,
                        subtitle: actionKindLabel(action.kind),
                        icon: ShieldCheck,
                        tint: colors.lavender,
                      },
                    }
                  : {}),
              })
            }
          />
        )}
        {!!pendingActions.length && !!data?.notifications.length && <SectionHeading title="更新" />}
        {data?.notifications.map((item) => (
          <Card
            key={item.id}
            style={{ gap: 8, backgroundColor: item.read ? colors.card : colors.sky }}
          >
            <View style={s.between}>
              <Text style={s.heading}>{item.title}</Text>
              {!item.read && <Chip>新</Chip>}
            </View>
            <Text style={s.muted}>{item.body}</Text>
            <Text style={s.small}>{stamp(item.createdAt)}</Text>
            <Button small onPress={() => void read(item.id, item.taskId)}>
              {item.taskId ? "查看任务" : item.read ? "已读" : "标记已读"}
            </Button>
          </Card>
        ))}
        {!pendingActions.length && !data?.notifications.length && (
          <Empty
            icon={Bell}
            title="都处理完了"
            detail="需要你确认的操作、结果和缺信息的任务都会出现在这里。"
          />
        )}
      </View>
    </Sheet>
  );
}
export function AppsScreen() {
  const { navigate, open } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [name, setName] = useState(data?.identity.name || "OpenMuse");
  const [tone, setTone] = useState(data?.identity.tone || "warm");
  const [avatar, setAvatar] = useState(data?.identity.avatar || "sky");
  const [showChatUpdates, setShowChatUpdates] = useState(data?.identity.showChatUpdates !== false);
  const [memory, setMemory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.identity) {
      setName(data.identity.name);
      setTone(data.identity.tone);
      setAvatar(data.identity.avatar || "sky");
      setShowChatUpdates(data.identity.showChatUpdates !== false);
    }
  }, [
    data?.identity.name,
    data?.identity.tone,
    data?.identity.avatar,
    data?.identity.showChatUpdates,
  ]);
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(path, body);
      if (path === "/memories") setMemory("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const shortcuts = [
    {
      section: "mail" as const,
      title: "邮件",
      detail: "读取邮件并准备回复",
      icon: Mail,
    },
    {
      section: "calendar" as const,
      title: "Calendar",
      detail: "事件与已复核的邀请",
      icon: CalendarDays,
    },
    {
      section: "browser" as const,
      title: "智能体电脑",
      detail: "持久浏览器会话",
      icon: Globe2,
    },
    {
      section: "files" as const,
      title: "文件",
      detail: "PDF、表单与已填写的副本",
      icon: FileText,
    },
  ];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <Field label="搜索应用" value={query} onChangeText={setQuery} placeholder="搜索连接器" />
      <ConnectionsScreen query={query} />
      <Text style={s.heading}>在你的电脑上</Text>
      <Card style={{ paddingVertical: 3, backgroundColor: "#F4F5F6" }}>
        {shortcuts
          .filter((item) =>
            `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((item) => (
            <LinkRow
              key={item.section}
              icon={item.icon}
              title={item.title}
              detail={item.detail}
              onPress={() =>
                item.section === "browser" ? open({ type: "computer" }) : navigate(item.section)
              }
            />
          ))}
      </Card>
      <Button onPress={() => setSettings(!settings)}>
        {settings ? "关闭智能体设置" : "人格与记忆"}
      </Button>
      {settings && (
        <>
          <Card style={{ gap: 10 }}>
            <SectionHeading title="你的智能体" />
            <View style={[s.row, { gap: 16, justifyContent: "center", marginBottom: 12 }]}>
              {(["sky", "sand", "lilac"] as const).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityLabel={`${statusLabel(item)} avatar`}
                  accessibilityState={{ checked: avatar === item }}
                  onPress={() => setAvatar(item)}
                  style={{
                    padding: 7,
                    borderRadius: 24,
                    backgroundColor: avatar === item ? colors.sky : colors.canvas,
                  }}
                >
                  <Mascot size={62} variant={item} />
                </Pressable>
              ))}
            </View>
            <Field label="名称" value={name} onChangeText={setName} />
            <View style={[s.row, { gap: 8 }]}>
              {(["warm", "concise", "thoughtful"] as const).map((item) => (
                <Button key={item} small primary={tone === item} onPress={() => setTone(item)}>
                  {statusLabel(item)}
                </Button>
              ))}
            </View>
            <CheckRow
              label="在聊天中显示后台更新"
              checked={showChatUpdates}
              onPress={() => setShowChatUpdates(!showChatUpdates)}
            />
            <Text style={s.small}>动态与通知会保留完整记录，包括需要你批准的请求。</Text>
            <Button
              busy={busy}
              disabled={!name.trim()}
              onPress={() =>
                void save("/identity", { name: name.trim(), tone, avatar, showChatUpdates })
              }
            >
              保存偏好
            </Button>
          </Card>
          <Card style={{ gap: 12 }}>
            <SectionHeading title="记忆" />
            <Text style={s.muted}>你可以查看、修正或遗忘的上下文。</Text>
            {data?.memories.map((item) => (
              <MemoryRow key={item.id} memory={item} />
            ))}
            <Field
              label="记住一些关于我的事"
              value={memory}
              onChangeText={setMemory}
              placeholder="我更喜欢上午开会"
            />
            <Button
              busy={busy}
              disabled={!memory.trim()}
              onPress={() =>
                void save("/memories", { text: memory.trim(), source: "用户已在「应用」中添加" })
              }
            >
              记住
            </Button>
          </Card>
        </>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}
function MemoryRow({ memory }: { memory: AgentMemory }) {
  const { mutate } = useAgentWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(forget: boolean) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/memories/${memory.id}${forget ? "/forget" : ""}`, forget ? {} : { text });
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      {editing ? (
        <Field label="记忆" value={text} onChangeText={setText} />
      ) : (
        <Text style={s.text}>{memory.text}</Text>
      )}
      <Text style={s.small}>
        {memory.source} · {stamp(memory.createdAt)}
      </Text>
      <View style={[s.row, { gap: 8 }]}>
        {editing ? (
          <Button small busy={busy} disabled={!text.trim()} onPress={() => void act(false)}>
            保存修正
          </Button>
        ) : (
          <Button small onPress={() => setEditing(true)}>
            编辑
          </Button>
        )}
        <Button small danger busy={busy} onPress={() => void act(true)}>
          遗忘
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}
