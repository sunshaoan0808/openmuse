/**
 * 服务端自动续跑未完成的一轮 —— 让"重试"这件事不再依赖客户端。
 *
 * 背景（用户原话）：「**用户端要求无感，重试动作要做到服务器端**」。
 * 现状是反过来的：客户端删了又删的重试逻辑（发件箱 + 退避），服务端只负责把一轮
 * 标成 `failed`/`interrupted` 然后躺着等客户端重发。于是客户端一旦处于坏状态
 * （静默断流后 `agent.isRunning` 卡死、进程被杀、网络断了），这一轮就永远没人管。
 *
 * 服务端其实**什么信息都有**：用户消息在会话里、turn 是失败态、回复不存在 ——
 * "这一轮没答完"是可以判定的。所以由服务端自己把它补上。
 *
 * 为什么用"向自己发一次 HTTP 请求"来实现续跑：这样**复用整条既有链路**
 * （SSE `tee()` 后台落库、turn 记录、`durable-runner` 的幂等与排队），
 * 而不是另写一份"跑一轮"的实现 —— 两份实现必然漂移，而漂移的代价就是今天这两个故障。
 */
import { randomUUID } from "node:crypto";
import type { Conversation } from "../chat-turns.ts";
import { conversationRecordId } from "../threads.ts";

/** 同一轮最多续跑几次（避免模型/配置坏了导致无限重跑）。 */
export const MAX_RESUME_ATTEMPTS = 2;
/** 两次续跑之间的最小间隔。 */
export const MIN_RESUME_INTERVAL_MS = 30_000;
/** 巡检周期。 */
export const RESUME_SCAN_INTERVAL_MS = 60_000;
/** 自请求的超时（消费 SSE 的最大时长）。 */
export const RESUME_TIMEOUT_MS = 5 * 60_000;

export interface StoredTurn {
  id: string;
  threadId?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  /** 由本模块维护：已续跑次数与最近一次时间 */
  resumeCount?: number;
  lastResumeAt?: number;
}

export interface ResumeDecision {
  resume: boolean;
  reason: string;
}

/**
 * 「这一轮有没有被答完」：最后一条用户消息之后**没有**助手回复。
 *
 * 只看 user/assistant 两类 —— 工具消息不算"回答"。
 */
export function unansweredUserMessage(messages: readonly { role?: unknown }[]): boolean {
  let lastUser = -1;
  let lastAssistant = -1;
  messages.forEach((message, index) => {
    if (message?.role === "user") lastUser = index;
    else if (message?.role === "assistant") lastAssistant = index;
  });
  return lastUser >= 0 && lastUser > lastAssistant;
}

/** 该不该续跑这一轮（纯函数，便于单测）。 */
export function decideResume(input: {
  turn: StoredTurn | null | undefined;
  /** 会话里最后一条用户消息是否还没被回答 */
  unanswered: boolean;
  now: number;
}): ResumeDecision {
  const { turn, unanswered, now } = input;
  if (!turn) return { resume: false, reason: "没有 turn 记录" };
  if (turn.status !== "failed" && turn.status !== "interrupted") {
    return { resume: false, reason: `turn 状态是 ${String(turn.status)}，不是失败/中断` };
  }
  if (!unanswered) return { resume: false, reason: "最后一条用户消息已经有回复" };
  const attempts = turn.resumeCount ?? 0;
  if (attempts >= MAX_RESUME_ATTEMPTS) {
    return { resume: false, reason: `已续跑 ${attempts} 次，不再重试` };
  }
  if (typeof turn.lastResumeAt === "number" && now - turn.lastResumeAt < MIN_RESUME_INTERVAL_MS) {
    return { resume: false, reason: "距上次续跑不足 30 秒" };
  }
  return { resume: true, reason: `turn ${String(turn.status)} 且用户消息未被回答` };
}

/**
 * 把会话里存的消息收敛成 AG-UI 能吃的形状。
 *
 * 只保留 user/assistant 的文本消息：会话里还存着工具调用与工具结果，
 * 那些需要 `toolCallId` 等配套字段，缺一个就会被运行时以 400 拒掉；
 * 而续跑只需要"用户说过什么、助手答过什么"。
 */
export function toAgUiMessages(
  messages: readonly Record<string, unknown>[],
): { id: string; role: string; content: string }[] {
  const out: { id: string; role: string; content: string }[] = [];
  for (const [index, message] of messages.entries()) {
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof message.content === "string" ? message.content : "";
    if (!content.trim()) continue;
    out.push({
      id: typeof message.id === "string" && message.id ? message.id : `resume-${index}`,
      role,
      content,
    });
  }
  return out;
}

/** 自请求基址：HOST 是通配地址时换成回环，否则连不上。 */
export function selfBaseUrl(config: { host: string; port: number }): string {
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  return `http://${host}:${config.port}`;
}

export interface ResumeDeps {
  store: {
    scan<T>(kind: string): Promise<{ owner: string; value: T }[]>;
    get<T>(owner: string, kind: string, id: string): Promise<T | null>;
    put<T extends { id: string }>(owner: string, kind: string, value: T): Promise<T>;
  };
  auth: { session(accessKey?: string): Promise<{ token: string }> };
  config: { mode: string; accessKey?: string; host: string; port: number };
  log?: (message: string) => void;
  /** 自请求实现（测试可注入）。 */
  post?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
  ) => Promise<Response>;
}

/** 服务端给自己用的会话令牌（续跑要带上凭据走鉴权中间件）。 */
let cachedSelfToken: string | null = null;

async function selfToken(deps: ResumeDeps): Promise<string | null> {
  if (cachedSelfToken) return cachedSelfToken;
  if (deps.config.mode !== "live" || !deps.config.accessKey) return null;
  try {
    cachedSelfToken = (await deps.auth.session(deps.config.accessKey)).token;
    return cachedSelfToken;
  } catch {
    return null;
  }
}

/**
 * 向本进程发一次 run，把这一轮补跑完。
 *
 * 之所以走 HTTP 而不是直接调引擎：这样**整条既有链路**都会被复用 ——
 * SSE `tee()` 的后台落库、turn 记录、`durable-runner` 的"同轮重复忽略/同会话排队"。
 * 另写一份"跑一轮"的实现必然与原路径漂移，而漂移正是今天这些故障的成因。
 */
export async function resumeTurn(
  deps: ResumeDeps,
  owner: string,
  threadId: string,
  messages: readonly Record<string, unknown>[],
): Promise<boolean> {
  const token = await selfToken(deps);
  if (!token) return false;
  const body = JSON.stringify({
    threadId,
    runId: randomUUID(),
    messages: toAgUiMessages(messages),
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  });
  const post =
    deps.post ??
    ((
      url: string,
      init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
    ) => fetch(url, init));
  try {
    const response = await post(
      `${selfBaseUrl(deps.config)}/api/copilotkit/agent/default/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(RESUME_TIMEOUT_MS),
      },
    );
    if (response.status === 401) cachedSelfToken = null; // 令牌过期，下一轮重取
    if (!response.ok) return false;
    // 200 就代表这一轮被受理了；把 SSE 读干净（后台那一支本来就会自己落库）
    void response.text().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export interface ResumeScanResult {
  scanned: number;
  resumed: { owner: string; threadId: string; attempt: number }[];
  skipped: { threadId: string; reason: string }[];
}

/** 正在续跑的线程，避免同一条被并发触发。 */
const inFlight = new Set<string>();

/** 供测试复位模块级状态（令牌缓存 + 在跑的线程）。 */
export function resetResumeState(): void {
  cachedSelfToken = null;
  inFlight.clear();
}

/**
 * 巡检一遍所有线程，把"用户消息没被回答 + turn 失败/中断"的轮次补跑掉。
 */
export async function scanUnfinishedTurns(
  deps: ResumeDeps,
  now = Date.now(),
): Promise<ResumeScanResult> {
  const result: ResumeScanResult = { scanned: 0, resumed: [], skipped: [] };
  const turns = await deps.store.scan<StoredTurn>("turns");

  // 每个 (owner, threadId) 只关心最近的一轮
  const latest = new Map<string, { owner: string; turn: StoredTurn }>();
  for (const { owner, value } of turns) {
    if (!value?.threadId) continue;
    const key = `${owner}::${value.threadId}`;
    const prev = latest.get(key);
    const at = value.startedAt ? Date.parse(value.startedAt) : 0;
    const prevAt = prev?.turn.startedAt ? Date.parse(prev.turn.startedAt) : 0;
    if (!prev || at >= prevAt) latest.set(key, { owner, turn: value });
  }

  for (const [key, { owner, turn }] of latest) {
    const threadId = turn.threadId!;
    result.scanned += 1;
    if (inFlight.has(key)) {
      result.skipped.push({ threadId, reason: "这一条正在续跑" });
      continue;
    }
    const conversation = await deps.store
      .get<Conversation>(owner, "conversations", conversationRecordId(threadId))
      .catch(() => null);
    const messages = (conversation?.messages ?? []) as Record<string, unknown>[];

    const decision = decideResume({ turn, unanswered: unansweredUserMessage(messages), now });
    if (!decision.resume) {
      result.skipped.push({ threadId, reason: decision.reason });
      continue;
    }

    // 先落盘再发：即使这一发失败/进程挂掉，次数也被记下了，不会无限重试
    const attempt = (turn.resumeCount ?? 0) + 1;
    try {
      await deps.store.put(owner, "turns", { ...turn, resumeCount: attempt, lastResumeAt: now });
    } catch {
      result.skipped.push({ threadId, reason: "写续跑次数失败" });
      continue;
    }

    inFlight.add(key);
    try {
      const ok = await resumeTurn(deps, owner, threadId, messages);
      if (ok) {
        result.resumed.push({ owner, threadId, attempt });
        deps.log?.(
          `[resume] 服务端续跑第 ${attempt} 次 thread=${threadId}（${decision.reason}）`,
        );
      } else {
        result.skipped.push({ threadId, reason: "续跑请求未能受理" });
      }
    } finally {
      inFlight.delete(key);
    }
  }

  return result;
}

/** 周期巡检；启动时也立刻跑一遍（服务重启打断的那些轮次正是这时候补上）。 */
export function startTurnResumer(
  deps: ResumeDeps,
  options: { intervalMs?: number; immediate?: boolean } = {},
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await scanUnfinishedTurns(deps);
      if (result.resumed.length) {
        deps.log?.(
          `[resume] 巡检 ${result.scanned} 条线程，续跑 ${result.resumed.length} 条` +
            (result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ""),
        );
      }
    } catch (error) {
      deps.log?.(`[resume] 巡检失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), options.intervalMs ?? RESUME_SCAN_INTERVAL_MS);
  // 别让这个定时器把进程钉住
  if (typeof timer.unref === "function") timer.unref();
  if (options.immediate !== false) void tick();
  return () => clearInterval(timer);
}
