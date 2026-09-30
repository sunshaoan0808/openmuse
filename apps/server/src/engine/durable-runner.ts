import type { BaseEvent, Message } from "@ag-ui/core";
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
  InMemoryAgentRunner,
  type LocalThreadEndpointRecord,
  type LocalThreadEndpointRunner,
  ɵGLOBAL_STORE,
} from "@copilotkit/runtime/v2";
import {
  catchError,
  defer,
  EMPTY,
  from,
  mergeAll,
  mergeMap,
  type Observable,
  tap,
  throwError,
  timer,
} from "rxjs";
import type { Store } from "../db.ts";
import { backgroundFailure } from "../log.ts";

/**
 * 让运行时自带的本地线程端点（/threads 列表、/threads/:id/messages、/state）活过重启。
 *
 * 官方 SSE 模式用一个进程级内存存储保存线程，重启即丢。这里包一层 InMemoryAgentRunner：
 * - 读路径从我们自己的 PGlite 库出（列表/消息/事件/状态）；
 * - 写路径在每轮 run 起跑前与完成后各快照一次（中途崩了也不丢上一轮）。
 *
 * 落库 owner 用固定值：应用是单用户部署（访问密钥鉴权），而运行时的 runner 接口不携带 owner。
 */
const OWNER = "local-user";
const THREADS = "chat-threads";
const MESSAGES = "chat-messages";
const EVENTS = "chat-events";
const STATE = "chat-state";

/** 取最后一条用户消息的 id：用来识别"同一轮被重复投递"。 */
function lastUserMessageId(input: { messages?: unknown } | undefined): string | undefined {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; id?: string } | undefined;
    if (message?.role === "user" && typeof message.id === "string") return message.id;
  }
  return undefined;
}

type StoredMessages = { id: string; messages: Message[] };
type StoredEvents = { id: string; events: BaseEvent[] };
type StoredState = { id: string; state: Record<string, unknown> | null };

export class DurableAgentRunner extends AgentRunner implements LocalThreadEndpointRunner {
  readonly ɵsupportsLocalThreadEndpoints = true as const;
  private readonly inner = new InMemoryAgentRunner();
  private readonly threads = new Map<string, LocalThreadEndpointRecord>();
  private readonly messages = new Map<string, Message[]>();
  /** 每个会话当前在跑的那一轮（用于去重与排队，避免 "Thread already running"）。 */
  private readonly inFlight = new Map<string, { messageId?: string; settled: Promise<void> }>();
  private readonly events = new Map<string, BaseEvent[]>();
  private readonly states = new Map<string, Record<string, unknown> | null>();
  private readonly hydrating: Promise<void>;

  constructor(private readonly store: Store) {
    super();
    this.hydrating = this.hydrate();
  }

  /** 启动时把库里的线程读回内存缓存；读接口是同步签名，写路径用 hydrating 承诺保证等到就绪。 */
  private async hydrate(): Promise<void> {
    try {
      for (const thread of await this.store.list<LocalThreadEndpointRecord>(OWNER, THREADS))
        this.threads.set(thread.id, thread);
      for (const row of await this.store.list<StoredMessages>(OWNER, MESSAGES))
        this.messages.set(row.id, row.messages ?? []);
      for (const row of await this.store.list<StoredEvents>(OWNER, EVENTS))
        this.events.set(row.id, row.events ?? []);
      for (const row of await this.store.list<StoredState>(OWNER, STATE))
        this.states.set(row.id, row.state ?? null);
    } catch (error) {
      backgroundFailure("durable-runner-hydrate", error);
    }
  }

  /** 按 runId 合并事件：库里的历史在前，同一 runId 以内存中的最新为准。 */
  private mergeEvents(stored: BaseEvent[], live: BaseEvent[]): BaseEvent[] {
    if (!stored.length) return live;
    if (!live.length) return stored;
    const group = (events: BaseEvent[], tag: string) => {
      const groups = new Map<string, BaseEvent[]>();
      let current = "";
      for (const [index, event] of events.entries()) {
        const runId = (event as { runId?: string }).runId;
        if ((event as { type?: string }).type === "RUN_STARTED" || !current)
          current = runId ?? `${tag}:${index}`;
        const bucket = groups.get(current) ?? [];
        bucket.push(event);
        groups.set(current, bucket);
      }
      return groups;
    };
    const storedGroups = group(stored, "stored");
    const liveGroups = group(live, "live");
    const merged: BaseEvent[] = [];
    for (const key of new Set([...storedGroups.keys(), ...liveGroups.keys()])) {
      const events = liveGroups.get(key) ?? storedGroups.get(key);
      if (events?.length) merged.push(...events);
    }
    return merged;
  }

  /** 按消息 id 合并：保持先出现的顺序，同 id 以内存中的最新为准。 */
  private mergeMessages(stored: Message[], live: Message[]): Message[] {
    if (!stored.length) return live;
    if (!live.length) return stored;
    const byId = new Map<string, Message>();
    for (const message of stored) byId.set(message.id, message);
    for (const message of live) byId.set(message.id, message);
    return [...byId.values()];
  }

  private async persist(threadId: string): Promise<void> {
    try {
      const live = this.inner.listThreads().find((thread) => thread.id === threadId);
      const previous = this.threads.get(threadId);
      // 重启后内存 runner 是空的，直接覆盖会把历史抹掉——按 runId/消息 id 合并。
      const messages = this.mergeMessages(
        this.messages.get(threadId) ?? [],
        this.inner.getThreadMessages(threadId),
      );
      const events = this.mergeEvents(
        this.events.get(threadId) ?? [],
        this.inner.getThreadEvents(threadId),
      );
      const state = this.inner.getThreadState(threadId) ?? this.states.get(threadId) ?? null;
      const now = new Date().toISOString();
      const thread: LocalThreadEndpointRecord = {
        id: threadId,
        name: live?.name ?? previous?.name ?? null,
        agentId: live?.agentId ?? previous?.agentId ?? "default",
        organizationId: "",
        createdById: "",
        archived: false,
        createdAt: previous?.createdAt ?? live?.createdAt ?? now,
        updatedAt: now,
      };
      this.threads.set(threadId, thread);
      this.messages.set(threadId, messages);
      this.events.set(threadId, events);
      this.states.set(threadId, state);
      await this.store.put(OWNER, THREADS, thread);
      await this.store.put(OWNER, MESSAGES, { id: threadId, messages } satisfies StoredMessages);
      await this.store.put(OWNER, EVENTS, { id: threadId, events } satisfies StoredEvents);
      await this.store.put(OWNER, STATE, { id: threadId, state } satisfies StoredState);
    } catch (error) {
      // 落库失败不能影响对话本身
      backgroundFailure("durable-runner-persist", error);
    }
  }

  /**
   * 重启后内存 runner 是空的：把库里的事件与消息回灌成一条"历史运行"，
   * connect 便能重放出对话，下一轮 run 也带上了上下文。内存里已有事件时跳过（幂等）。
   */
  private seed(threadId: string): void {
    if (this.inner.getThreadEvents(threadId).length) return;
    const events = this.events.get(threadId) ?? [];
    const messages = this.messages.get(threadId) ?? [];
    if (!events.length && !messages.length) return;
    // appendRun 在"线程尚未进入存储"时会静默丢弃，所以先 getOrCreate。
    ɵGLOBAL_STORE.getOrCreate(threadId);
    ɵGLOBAL_STORE.appendRun(threadId, {
      threadId,
      runId: `seed:${threadId}`,
      agentId: this.threads.get(threadId)?.agentId ?? "default",
      parentRunId: null,
      events,
      messages,
      createdAt: Date.now(),
    });
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return defer(() =>
      from(
        (async () => {
          await this.hydrating;
          this.seed(request.threadId);
          void this.persist(request.threadId);
          const messageId = lastUserMessageId(request.input);
          const existing = this.inFlight.get(request.threadId);
          // 同一轮的重复投递（客户端超时后重发、或用户连点）：不要再跑一遍。
          // 回复已经由这一轮自己在写，客户端按游标增量拉取就能拿到——这也是 at-least-once 的语义。
          if (existing && messageId && existing.messageId === messageId) {
            console.log(
              `[runner] 忽略重复的一轮 thread=${request.threadId} message=${messageId}（回复由游标补拉送达）`,
            );
            return EMPTY;
          }
          // 同一会话已有另一轮在跑：等它结束再开始（原来的实现直接抛
          // "Thread already running"，等于把这一轮丢掉）
          if (existing)
            await Promise.race([existing.settled, new Promise((r) => setTimeout(r, 180_000))]);
          let settle = () => {};
          const settled = new Promise<void>((resolve) => {
            settle = resolve;
          });
          const entry = { messageId, settled };
          this.inFlight.set(request.threadId, entry);
          const release = () => {
            settle();
            if (this.inFlight.get(request.threadId) === entry)
              this.inFlight.delete(request.threadId);
          };
          const start = (attempt: number): Observable<BaseEvent> =>
            this.inner.run(request).pipe(
              catchError((error: unknown) => {
                // 兜底：内存 runner 里可能还有我们不知道的在跑的轮次
                const reason = error instanceof Error ? error.message : String(error);
                if (attempt >= 3 || !/already running/i.test(reason))
                  return throwError(() => error);
                return timer(1500).pipe(mergeMap(() => start(attempt + 1)));
              }),
            );
          return start(0).pipe(
            tap({
              complete: () => {
                void this.persist(request.threadId);
                release();
              },
              error: () => release(),
            }),
          );
        })(),
      ).pipe(mergeAll()),
    );
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return defer(() =>
      from(
        (async () => {
          await this.hydrating;
          if (request.threadId) this.seed(request.threadId);
          return this.inner.connect(request);
        })(),
      ).pipe(mergeAll()),
    );
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return this.inner.isRunning(request);
  }

  async stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const stopped = await this.inner.stop(request);
    await this.persist(request.threadId);
    return stopped;
  }

  listThreads(): LocalThreadEndpointRecord[] {
    return [...this.threads.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  getThreadMessages(threadId: string): Message[] {
    return this.messages.get(threadId) ?? [];
  }

  getThreadEvents(threadId: string): BaseEvent[] {
    return this.events.get(threadId) ?? [];
  }

  getThreadState(threadId: string): Record<string, unknown> | null {
    return this.states.get(threadId) ?? null;
  }

  clearThreads(): void {
    this.inner.clearThreads();
    this.threads.clear();
    this.messages.clear();
    this.events.clear();
    this.states.clear();
    void (async () => {
      try {
        for (const kind of [THREADS, MESSAGES, EVENTS, STATE]) {
          for (const row of await this.store.list<{ id: string }>(OWNER, kind))
            await this.store.remove(OWNER, kind, row.id);
        }
      } catch (error) {
        backgroundFailure("durable-runner-clear", error);
      }
    })();
  }
}
