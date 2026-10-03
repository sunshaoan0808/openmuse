import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import type {
  AgentTask,
  AgentWorkspace,
  CreateTaskInput,
} from "../../../packages/domain/src/agent";
import { nextPollDelay } from "./poll-cadence";
import { useWorkspace } from "./workspace";

interface AgentContextValue {
  data?: AgentWorkspace;
  error: string;
  refresh: () => Promise<void>;
  mutate: <T>(path: string, body: unknown, idempotencyKey?: string) => Promise<T>;
  delegate: (input: CreateTaskInput) => Promise<AgentTask>;
  /**
   * 聊天这一层最近一次"出问题了"（连不上/这一轮失败），顶栏状态行要优先说这个。
   * 原因：顶栏读的是服务端的实时活动，客户端把流断了它并不知道，于是界面上
   * 弹着红色报错、顶栏却还在说"正在搜索网页…"（真机上就是这么被发现的）。
   */
  chatTrouble: string;
  setChatTrouble: (text: string) => void;
  /**
   * 聊天层推导出的当前相位文案（空串 = 没在跑）。顶栏优先显示它：
   * THINKING/TYPING 这两段只有客户端知道（服务端只在工具调用时才有话可说），
   * 聊天页算好推上来，顶栏/头像面板直接用——三处共用同一份推导（labels.agentPhase）。
   */
  runPhase: string;
  setRunPhase: (text: string) => void;
}
const AgentContext = createContext<AgentContextValue | null>(null);
export function AgentWorkspaceProvider({ children }: { children: ReactNode }) {
  const { api } = useWorkspace();
  const [data, setData] = useState<AgentWorkspace>();
  const [chatTrouble, setChatTrouble] = useState("");
  const [runPhase, setRunPhase] = useState("");
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const next = await api.request<AgentWorkspace>("/api/agent");
      if (version === requestVersion.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (version === requestVersion.current) setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, [api]);
  // 轮询按"有没有活干"自适应：在跑就 3 秒，闲着就 12 秒（跨境外链路下这一项最省时间）
  const latest = useRef<AgentWorkspace | undefined>(undefined);
  latest.current = data ?? latest.current;
  useEffect(() => {
    const visible = () =>
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive" &&
      (Platform.OS !== "web" || typeof document === "undefined" || !document.hidden);
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(poll, nextPollDelay(latest.current));
    };
    const poll = () => {
      if (stopped) return;
      if (!visible() || polling) return schedule();
      polling = true;
      void refresh()
        .catch(() => {})
        .finally(() => {
          polling = false;
          schedule();
        });
    };
    poll();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") poll();
    });
    if (Platform.OS === "web" && typeof document !== "undefined")
      document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearTimeout(timer);
      subscription.remove();
      requestVersion.current++;
      if (Platform.OS === "web" && typeof document !== "undefined")
        document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);
  const mutate = useCallback(
    async <T,>(path: string, body: unknown, idempotencyKey?: string): Promise<T> => {
      const result = await api.request<T>(`/api/agent${path}`, body, undefined, { idempotencyKey });
      // The successful mutation stays successful even if the following read fails.
      await refresh().catch(() => {});
      return result;
    },
    [api, refresh],
  );
  const delegate = useCallback(
    // 幂等键：链路抖动重发时服务端只认一个任务（不会变成两个）
    (input: CreateTaskInput) =>
      mutate<AgentTask>(
        "/tasks",
        input,
        `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ),
    [mutate],
  );
  return (
    <AgentContext.Provider
      value={{
        data,
        error,
        refresh,
        mutate,
        delegate,
        chatTrouble,
        setChatTrouble,
        runPhase,
        setRunPhase,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}
export function useAgentWorkspace() {
  const context = useContext(AgentContext);
  if (!context) throw new Error("智能体工作区不可用");
  return context;
}
