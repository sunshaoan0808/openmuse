import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import { AgentActivityScreen, AppsScreen, GoalsScreen, IdeasScreen } from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import {
  apiUrl,
  createSession,
  defaultApiUrl,
  loadAccessKey,
  loadApiUrl,
  loadToken,
  MuseApi,
  saveAccessKey,
  saveApiUrl,
  saveToken,
  setUnauthorizedHandler,
} from "./src/api";
import { AvatarPanel } from "./src/avatar-panel";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { installCrashHandler } from "./src/crash-log";
import { CrashNotice } from "./src/crash-notice";
import { Details } from "./src/details";
import { ErrorBoundary } from "./src/error-boundary";
import { hapticTap } from "./src/haptics";
import { headerScrollHandler } from "./src/header-scrim";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import { Button, Card, colors, ErrorNotice, Field, IconButton, Mascot, s } from "./src/ui";
import { useAndroidKeyboardInset } from "./src/use-android-keyboard-inset";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "聊天", icon: MessageCircle },
  { id: "activity", label: "动态", icon: PanelsTopLeft },
  { id: "ideas", label: "灵感", icon: Lightbulb },
  { id: "goals", label: "目标", icon: SquareCheck },
  { id: "apps", label: "应用", icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "动态", subtitle: "计划、进展、决策与结果。" },
  ideas: { title: "灵感", subtitle: "贴合你实际情况的下一步建议。" },
  goals: {
    title: "目标",
    subtitle: "长期目标与需要留意的事。",
  },
  apps: {
    title: "应用",
    subtitle: "连接、能力，以及智能体记住的东西。",
  },
  connections: { title: "应用", subtitle: "连接与能力。" },
  mail: { title: "邮件", subtitle: "你工作背后的那些对话。" },
  calendar: { title: "Calendar", subtitle: "把时间留给重要的事。" },
  browser: { title: "浏览器", subtitle: "你已连接的浏览会话。" },
  files: { title: "文件", subtitle: "文档、表单与已填写的副本。" },
};
// Muse 用一组固定几何量对齐顶栏三个控件（HatchStatusPillMetrics 的 leading/trailingChromeCenterY）：
// 左右控件的中心与中间卡片中心同高，而不是各自贴顶。
// 实测量得：卡片 y=33 高=51 → 中心 58.5；左圆钮 36pt、右胶囊 34pt 高，故 top = 59-18 / 59-17。
const CHROME_CENTER_Y = 59;

// 尽早接住全局异常：release 包里未捕获的 JS 异常就是无提示闪退
installCrashHandler();

export default function App() {
  // edge-to-edge 下 Android 不执行 adjustResize，键盘会盖住输入区；在根上补内边距统一解决
  const keyboardInset = useAndroidKeyboardInset();
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [server, setServer] = useState(apiUrl());
  // 启动时先不起转圈：要先知道有没有存过密钥，否则就是"转圈 → 报错 → 才要密钥"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connect = useCallback(async (key?: string, url?: string) => {
    setBusy(true);
    setError("");
    try {
      if (url !== undefined) setServer(await saveApiUrl(url));
      const session = await createSession(key);
      setToken(session.token);
      await saveToken(session.token);
      if (key) {
        setAccessKey(key);
        await saveAccessKey(key);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // 失败时把密钥填回表单，方便直接改，不用重敲
      if (key) setAccessKey(key);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void (async () => {
      const [savedUrl, savedKey, savedToken] = await Promise.all([
        loadApiUrl(),
        loadAccessKey(),
        loadToken(),
      ]);
      setServer(savedUrl);
      if (savedKey) setAccessKey(savedKey);
      // 有令牌就直接用（重启不必再登录一次，跨境外链路上这一步很贵）；
      // 令牌过期由 401 续期钩子兜住，续不上才回到表单
      if (savedToken) setToken(savedToken);
      // Web 验收专用（仅 dev 构建）：Web 上文件系统不可用、存不住令牌，于是"已登录"的界面在 Web 上
      // 渲染不出来 —— 顶部白带这类只在登录后出现的问题就没法量。给个假令牌只是把外壳与各页面渲染
      // 出来量尺寸（数据请求会失败，不影响布局）。真机与正式包都不受影响。
      else if (__DEV__ && Platform.OS === "web" && process.env.EXPO_PUBLIC_FAKE_TOKEN)
        setToken(process.env.EXPO_PUBLIC_FAKE_TOKEN);
      else if (savedKey) await connect(savedKey);
    })();
  }, [connect]);

  // 令牌失效时自动用存下的密钥续期（回调里只续一次，失败就交给界面提示）
  useEffect(() => {
    setUnauthorizedHandler(async () => {
      const key = await loadAccessKey();
      if (!key) return null;
      try {
        const session = await createSession(key);
        return session.token;
      } catch {
        return null;
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);
  return (
    <ErrorBoundary>
      <SafeAreaProvider initialMetrics={webFakeInsets()}>
        <StatusBar style="dark" />
        <View style={{ flex: 1, paddingBottom: keyboardInset }}>
          <CrashNotice />
          {token ? (
            <CopilotKitProvider
              runtimeUrl={`${server}/api/copilotkit`}
              headers={{ Authorization: `Bearer ${token}` }}
            >
              <WorkspaceApp token={token} />
            </CopilotKitProvider>
          ) : (
            <SafeAreaView
              style={{
                flex: 1,
                backgroundColor: colors.canvas,
                justifyContent: "center",
                alignItems: "center",
                padding: 24,
              }}
            >
              <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
                <Mascot size={72} />
                <Text
                  style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
                >
                  欢迎使用 OpenMuse。
                </Text>
                <Text style={[s.muted, { textAlign: "center" }]}>给你的一天留点空间。</Text>
                {busy ? (
                  <ActivityIndicator color={colors.blueDark} />
                ) : (
                  <Card style={{ width: "100%" }}>
                    <ErrorNotice error={error} />
                    <Field
                      label="服务器地址"
                      value={server}
                      onChangeText={setServer}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      placeholder={defaultApiUrl()}
                    />
                    <Field
                      label="工作区访问密钥"
                      value={accessKey}
                      onChangeText={setAccessKey}
                      secureTextEntry
                      placeholder="实时工作区必填"
                    />
                    <Button primary onPress={() => void connect(accessKey || undefined, server)}>
                      打开工作区
                    </Button>
                    <Text style={[s.small, { marginTop: 15 }]}>
                      填你的 OpenMuse 服务器地址（例如
                      http://10.7.0.6:8787）。它会记在这台设备上。本地工作区无需密钥。
                    </Text>
                  </Card>
                )}
              </View>
            </SafeAreaView>
          )}
        </View>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
function WorkspaceApp({ token }: { token: string }) {
  const api = useMemo(() => new MuseApi(token), [token]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>重试</Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>正在打开工作区…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            <WorkspaceShell
              detail={detail}
              toast={toast}
              clearToast={() => setToast("")}
              error={error}
              prompt={prompt}
            />
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
/**
 * 顶栏三块控件共用的一层"真玻璃"：expo-blur 真模糊（Android 必须 dimezisBlurView，
 * 否则只有半透明底色、没有模糊）+ 一层半透明白，让底下的内容透出来。
 * 尺寸由父容器给（absoluteFill），父容器负责圆角与 overflow: hidden。
 */
/**
 * Web 验收专用：Web 版没有状态栏（insets.top 恒为 0），因此"顶部白带"这类只在真机出现的问题
 * 在 Web 上永远复现不出来 —— 前几轮 Web 检查全绿、真机仍有白带，就是这个原因。
 * 给 Web 一个假的 insets（EXPO_PUBLIC_FAKE_INSET_TOP=44）就能真量、真验；真机不受影响。
 */
function webFakeInsets():
  | {
      frame: { x: number; y: number; width: number; height: number };
      insets: { top: number; left: number; right: number; bottom: number };
    }
  | undefined {
  if (Platform.OS !== "web") return undefined;
  const top = Number(process.env.EXPO_PUBLIC_FAKE_INSET_TOP ?? 0);
  if (!top) return undefined;
  return {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top, left: 0, right: 0, bottom: 34 },
  };
}

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

function GlassLayer({ radius = 999 }: { radius?: number }) {
  return (
    <View pointerEvents="none" style={[FILL, { borderRadius: radius, overflow: "hidden" }]}>
      <BlurView intensity={26} tint="light" experimentalBlurMethod="dimezisBlurView" style={FILL} />
      <View style={[FILL, { backgroundColor: "rgba(255,255,255,0.05)" }]} />
    </View>
  );
}

function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data, chatTrouble } = useAgentWorkspace();
  // 顶栏要覆盖状态栏那条区域（否则会露出一条"窄白带"），所以需要顶部安全区高度
  const insets = useSafeAreaInsets();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "OpenMuse";
  // 本会话此刻在干什么（服务端每次工具调用都会更新）；没有就退回任务状态
  const live = data?.live?.find((activity) => activity.threadId === selection.id);
  const liveStatus = live ? `${live.text}${live.detail ? ` · ${live.detail}` : ""}` : "";
  // 聊天出问题时，顶栏必须先说实话：否则会出现"屏幕上是红色报错、顶栏还说正在搜索"
  const status =
    (chatTrouble ? `刚才出错了 · ${chatTrouble}` : "") ||
    liveStatus ||
    (activeTask
      ? activeTask.status === "waiting_approval"
        ? `等你确认 · ${activeTask.title}`
        : activeTask.status === "waiting_input"
          ? `还缺信息 · ${activeTask.title}`
          : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
      : data?.tasks.some((task) => task.status === "queued")
        ? "正在接取下一个任务…"
        : "需要我就叫我");
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files"].includes(section);
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["bottom"]}>
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            // 这里原来用 expo-blur 的 BlurView（tint=light + dimezisBlurView）。
            // 真机实测：Android 上它没能真模糊时**退化成一层白色实底**，于是整条顶栏变成
            // 从屏幕左到右的白色横带（下边缘还是硬边），三个白色控件被同色淹没 ——
            // 用户看到的就是"一个白色块"。
            //
            // 现在这条容器自己带 GlassLayer（见下面第一个子节点）：它采样的是**内容**（外壳已不再给
            // 顶部留内边距，内容从 y=0 就铺上来），所以玻璃颜色跟着所在页面走 —— 对话页是灰的，
            // 玻璃就是浅灰，状态栏那条与下面无缝。之前的问题是这条容器**没有任何背景**，
            // 露出来的是外壳底色（#FCFCFC 近白）而内容偏灰，于是每个页面顶部都有一条"白带"。
            pointerEvents="box-none"
            style={{
              position: "absolute",
              // 从屏幕最顶端开始，连状态栏那条区域一起盖住
              top: -insets.top,
              left: 0,
              right: 0,
              zIndex: 6,
              height: (desktop ? 124 : 104) + insets.top,
              paddingTop: insets.top + (desktop ? 12 : 2),
              paddingHorizontal: 20,
            }}
          >
            {/* 顶栏的底色：**刻意不用 BlurView** —— 真机实测 expo-blur 在 Android 上模糊不可用时
                会退化成"白色实底"，那样整条顶栏又变回一条白带（第一轮就是这么翻车的）。
                这里用画布色的半透明遮罩：不依赖模糊能力，而外壳已不再给顶部留内边距，
                底下就是真实内容（卡片/文字），所以这条读起来是"顶栏"而不是"空白的白带"。 */}
            <View
              pointerEvents="none"
              style={[FILL, { backgroundColor: "rgba(252,252,252,0.22)" }]}
            />
            <View
              style={{
                position: "absolute",
                left: 0,
                top: insets.top + CHROME_CENTER_Y - 18,
                borderRadius: 18,
                overflow: "hidden",
              }}
            >
              <GlassLayer radius={18} />
              <IconButton
                glass
                icon={Menu}
                label="打开会话与菜单"
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View style={{ alignItems: "center", gap: 1 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${agentName} activity and approvals`}
                onPress={() => setAvatarOpen(true)}
                style={({ pressed }) => ({
                  alignItems: "center",
                  maxWidth: "70%",
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Mascot size={desktop ? 46 : 38} variant={data?.identity.avatar} glass />
                {/* Muse 实测结构：中间是一张白色圆角卡片（头像叠在上沿），
                    第二行可变——空闲是入口，干活时是"当前在做什么"。 */}
                <View
                  style={{
                    // 叠得比之前多一点：头像像"坐在卡片上沿"，而不是贴纸一样浮在边上
                    marginTop: -7,
                    marginBottom: 7,
                    paddingHorizontal: 14,
                    paddingTop: 8,
                    paddingBottom: 9,
                    borderRadius: 18,
                    // 改成玻璃：不再是不透明白底，底下滚动的文字能透出来（用户选的方案 1）
                    backgroundColor: "transparent",
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: "rgba(19,38,49,0.06)",
                    alignItems: "center",
                    gap: 1,
                    // Muse 实测：中间卡片是可变的窄卡片（名字 + 一行状态），不是信息堆栈；
                    // 限宽是防止长状态把它撑成一条白带（这正是之前看起来像"白色块"的原因）。
                    minWidth: 132,
                    maxWidth: 188,
                    shadowColor: "#132631",
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.06,
                    shadowRadius: 16,
                    elevation: 2,
                  }}
                >
                  <GlassLayer radius={18} />
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.text,
                      letterSpacing: -0.4,
                    }}
                  >
                    {agentName}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted }}>
                    {status}
                  </Text>
                </View>
              </Pressable>
            </View>
            <View
              style={{ position: "absolute", right: 0, top: insets.top + CHROME_CENTER_Y - 17 }}
            >
              {/* 照 Muse：右侧是一个带文字的胶囊，而不是光秃秃一个图标 */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`通知：${pending} 条未读或待处理`}
                onPress={() => open({ type: "notifications" })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  height: 34,
                  paddingHorizontal: 14,
                  borderRadius: 19,
                  backgroundColor: "transparent",
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "rgba(19,38,49,0.06)",
                  shadowColor: "#132631",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.08,
                  shadowRadius: 12,
                  elevation: 2,
                }}
              >
                <GlassLayer radius={19} />
                <Bell size={16} strokeWidth={1.8} color={colors.text} />
                <Text style={[s.small, { color: colors.text }]}>
                  {pending > 0 ? `通知 · ${pending}` : "通知"}
                </Text>
              </Pressable>
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0, paddingTop: desktop ? 12 : 8 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                onScroll={headerScrollHandler()}
                scrollEventThrottle={16}
                contentContainerStyle={{ paddingHorizontal: desktop ? 42 : 22, paddingBottom: 28 }}
                keyboardShouldPersistTaps="handled"
              >
                {utility && (
                  <Button
                    small
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate("apps")}
                  >
                    返回应用
                  </Button>
                )}
                <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              {richThreads ? (
                <>
                  <ErrorNotice error={threadsError} />
                  {threadsError ? (
                    <Button onPress={retryThreads}>重试主聊天</Button>
                  ) : threadsLoading ? (
                    <ActivityIndicator color={colors.blueDark} />
                  ) : null}
                  {!threadsLoading && selection.id !== mainId && (
                    <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                      侧边聊天
                    </Text>
                  )}
                  {visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <ChatScreen prompt={prompt} active={section === "chat"} />
              )}
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 10,
              paddingBottom: desktop ? 22 : 7,
              alignItems: "center",
            }}
          >
            {/* 照 Muse：底部就是几个图标铺在底色上，不套整块白底容器 */}
            <View
              style={{
                flexDirection: "row",
                width: "100%",
                maxWidth: 370,
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || (item.id === "apps" && utility);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      hapticTap();
                      navigate(item.id);
                    }}
                    style={{
                      flex: 1,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? "#F0F1F2" : "transparent",
                      borderRadius: 28,
                    }}
                  >
                    <item.icon size={22} strokeWidth={1.7} color={colors.text} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        {!!toast && (
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
          >
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.text,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text style={{ color: "#FFF", fontSize: 13, flexShrink: 1 }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="忽略通知"
                onPress={clearToast}
              >
                <X size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
        {avatarOpen && <AvatarPanel onClose={() => setAvatarOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}
