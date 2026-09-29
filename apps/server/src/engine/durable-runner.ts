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
import { defer, from, mergeAll, type Observable, tap } from "rxjs";
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

type StoredMessages = { id: string; messages: Message[] };
type StoredEvents = { id: string; events: BaseEvent[] };
type StoredState = { id: string; state: Record<string, unknown> | null };

export class DurableAgentRunner extends AgentRunner implements LocalThreadEndpointRunner {
  readonly ɵsupportsLocalThreadEndpoints = true as const;
  private readonly inner = new InMemoryAgentRunner();
  private readonly threads = new Map<string, LocalThreadEndpointRecord>();
  private readonly messages = new Map<string, Message[]>();
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
          return this.inner
            .run(request)
            .pipe(tap({ complete: () => void this.persist(request.threadId) }));
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
