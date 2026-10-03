/**
 * 对话的"防杀进程"基础设施：中心存储 + 游标（at-least-once）。
 *
 * 之前的问题：一轮回复只存在于那条 HTTP 流里——杀掉 App 就没了，回复也不落库。
 * 这里照 Telegram 那套做法补齐三件事：
 *  1. 消息带单调递增的 seq（游标），客户端记住自己看到哪，重连时 `since` 增量拉取；
 *  2. 追加语义 + 按消息 id 幂等：同一个 id 重复送（重试/补发）不会变成两条；
 *  3. 一轮对话独立成 turn 记录，回复由服务端在后台写进会话，与客户端生命周期解耦。
 */

/** 会话消息：AG-UI 的 Message 加游标与时间。 */
export type StoredMessage = { id: string; seq?: number; at?: string } & Record<string, unknown>;

/** 撤回墓碑：消息从会话移除后留下的记号——增量拉取时客户端据此清掉本地副本（不复活）。 */
export interface Tombstone {
  id: string;
  at: string;
}

export type Conversation = {
  id: string;
  messages: StoredMessage[];
  seq: number;
  tombstones?: Tombstone[];
};

export function emptyConversation(id: string): Conversation {
  return { id, messages: [], seq: 0 };
}

function messageId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id ? id : undefined;
}

/**
 * 追加消息：按 id 去重（至少一次投递会重复送），给新消息发新的 seq。
 * 已经存在但内容不同的同 id 消息不覆盖——先到的算（客户端重发旧内容不会回退服务端状态）。
 */
export function appendMessages(
  current: Conversation | null,
  id: string,
  incoming: unknown[],
  now: string,
): { next: Conversation; added: StoredMessage[] } {
  const base = current ?? emptyConversation(id);
  // 墓碑也在 known 里：原消息的重试补发（至少一次投递）不能把已撤回的消息复活
  const known = new Set([
    ...base.messages.map((message) => message.id),
    ...(base.tombstones ?? []).map((tombstone) => tombstone.id),
  ]);
  const messages = [...base.messages];
  const added: StoredMessage[] = [];
  let seq = base.seq;
  for (const candidate of incoming) {
    const candidateId = messageId(candidate);
    if (!candidateId || known.has(candidateId)) continue;
    known.add(candidateId);
    seq += 1;
    const stored = { ...(candidate as Record<string, unknown>), id: candidateId, seq, at: now };
    messages.push(stored);
    added.push(stored);
  }
  return { next: { id, messages, seq, tombstones: base.tombstones }, added };
}

/** 游标拉取：只给 seq 大于 since 的消息（since 缺省=全量）；墓碑总是全量带上（客户端据此清本地）。 */
export function messagesSince(
  current: Conversation | null,
  id: string,
  since?: number,
): { messages: StoredMessage[]; seq: number; tombstones: string[] } {
  const conversation = current ?? emptyConversation(id);
  const floor = typeof since === "number" && Number.isFinite(since) ? since : -1;
  return {
    messages: conversation.messages.filter((message) => (message.seq ?? 0) > floor),
    seq: conversation.seq,
    tombstones: (conversation.tombstones ?? []).map((tombstone) => tombstone.id),
  };
}

/**
 * 撤回：从会话里移除消息并写一条墓碑。按消息 id 幂等——重复请求不会再记一条。
 * 只改会话记录本身；增量拉取靠响应里永远带上的墓碑列表让其它端清掉本地副本。
 */
export function unsendMessage(
  current: Conversation | null,
  id: string,
  messageId: string,
  now: string,
): { next: Conversation; removed: boolean } {
  const base = current ?? emptyConversation(id);
  const tombstones = base.tombstones ?? [];
  if (tombstones.some((tombstone) => tombstone.id === messageId))
    return { next: base, removed: false };
  if (!base.messages.some((message) => message.id === messageId))
    return { next: base, removed: false };
  return {
    next: {
      ...base,
      messages: base.messages.filter((message) => message.id !== messageId),
      tombstones: [...tombstones, { id: messageId, at: now }],
    },
    removed: true,
  };
}

/** 消息反应的固定表情集（对标 Muse 的反应面板；单用户体系下一条消息上每个表情至多一个）。 */
export const REACTION_EMOJIS: readonly string[] = ["👍", "👎", "❤️", "😂", "😮", "😢", "🙏", "🔥"];

/**
 * 在消息上切换一个反应（有则删、无则加）。被改的消息 **seq 顶到最新**——
 * 这样游标增量拉取会把它当成一条新事件重投递给其它端，合并按 id 以服务端版本为准。
 */
export function toggleReaction(
  current: Conversation | null,
  id: string,
  messageId: string,
  emoji: string,
  now: string,
): { next: Conversation; updated: StoredMessage | null } {
  const base = current ?? emptyConversation(id);
  const index = base.messages.findIndex((message) => message.id === messageId);
  if (index === -1) return { next: base, updated: null };
  const message = base.messages[index];
  const currentReactions = Array.isArray(message.reactions)
    ? (message.reactions as string[]).filter((item) => typeof item === "string")
    : [];
  const reactions = currentReactions.includes(emoji)
    ? currentReactions.filter((item) => item !== emoji)
    : [...currentReactions, emoji];
  const updated: StoredMessage = { ...message, reactions, seq: base.seq + 1 };
  const messages = [...base.messages];
  messages[index] = updated;
  return { next: { ...base, messages, seq: base.seq + 1 }, updated };
}

/** 反应的使用频率计数（对标 Muse 的 HatchReactionUsageStore：面板按用得多在前排序）。 */
export function noteReactionUsage(
  counts: Record<string, number> | undefined,
  emoji: string,
  used: boolean,
): Record<string, number> {
  const next = { ...(counts ?? {}) };
  const value = typeof next[emoji] === "number" && next[emoji] > 0 ? next[emoji] : 0;
  next[emoji] = used ? value + 1 : value;
  return next;
}

/** 面板顺序：用得多的在前；没用过的保持默认顺序（不会把生面孔排到用过的前面）。 */
export function orderReactionsByUsage(counts: Record<string, number> | undefined): string[] {
  const frequency = (emoji: string) => {
    const value = counts?.[emoji];
    return typeof value === "number" && value > 0 ? value : 0;
  };
  return [...REACTION_EMOJIS].sort((left, right) => frequency(right) - frequency(left));
}

/** 一轮对话（客户端发一条消息 → 服务端跑完一条回复）。 */
export type ChatTurn = {
  id: string;
  threadId: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export function newTurn(id: string, threadId: string, now: string): ChatTurn {
  return { id, threadId, status: "running", startedAt: now };
}

export function finishTurn(
  turn: ChatTurn,
  outcome: { status: ChatTurn["status"]; error?: string; now: string },
): ChatTurn {
  return {
    ...turn,
    status: outcome.status,
    error: outcome.error?.slice(0, 300),
    finishedAt: outcome.now,
  };
}

// ---- SSE 解析：把服务端流出去的同一批事件，在后台拼回消息落库 ----

export type AgUiLikeEvent = { type?: string } & Record<string, unknown>;

/** 从 SSE 文本里取出事件对象（跨 chunk 的半行由调用方缓存）。 */
export function parseSseChunk(text: string): AgUiLikeEvent[] {
  const events: AgUiLikeEvent[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === "object") events.push(parsed as AgUiLikeEvent);
    } catch {
      // 半行 JSON：等下一个 chunk
    }
  }
  return events;
}

/**
 * 按 AG-UI 事件拼出这一轮产生的消息：助手正文（含工具调用）+ 工具结果。
 * 只认得标准的 TEXT_MESSAGE_* / TOOL_CALL_* 事件，其它事件忽略。
 */
export function assembleTurnMessages(events: AgUiLikeEvent[], now: string): StoredMessage[] {
  const messages: StoredMessage[] = [];
  const byId = new Map<string, StoredMessage>();
  const toolParent = new Map<string, StoredMessage>();
  const toolArgs = new Map<string, string>();

  const assistantFor = (messageId: string): StoredMessage => {
    const existing = byId.get(messageId);
    if (existing) return existing;
    const message: StoredMessage = { id: messageId, role: "assistant", content: "", at: now };
    byId.set(messageId, message);
    messages.push(message);
    return message;
  };

  for (const event of events) {
    const type = typeof event.type === "string" ? event.type : "";
    const messageId = typeof event.messageId === "string" ? event.messageId : undefined;
    const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    if (type === "TEXT_MESSAGE_START" && messageId) assistantFor(messageId);
    if (type === "TEXT_MESSAGE_CONTENT" && messageId) {
      const message = assistantFor(messageId);
      message.content = `${typeof message.content === "string" ? message.content : ""}${typeof event.delta === "string" ? event.delta : ""}`;
    }
    if (type === "TOOL_CALL_START" && toolCallId) {
      const parentId =
        (typeof event.parentMessageId === "string" && event.parentMessageId) ||
        (typeof messageId === "string" && messageId) ||
        [...byId.keys()].pop() ||
        `assistant-${toolCallId}`;
      const parent = assistantFor(parentId);
      const calls = Array.isArray(parent.toolCalls) ? (parent.toolCalls as unknown[]) : [];
      const call = {
        id: toolCallId,
        type: "function",
        function: {
          name: typeof event.toolCallName === "string" ? event.toolCallName : "",
          arguments: "",
        },
      };
      parent.toolCalls = [...calls, call];
      toolParent.set(toolCallId, parent);
      toolArgs.set(toolCallId, "");
    }
    if (type === "TOOL_CALL_ARGS" && toolCallId && typeof event.delta === "string") {
      const text = `${toolArgs.get(toolCallId) ?? ""}${event.delta}`;
      toolArgs.set(toolCallId, text);
      const parent = toolParent.get(toolCallId);
      const calls =
        (parent?.toolCalls as { id: string; function?: { arguments?: string } }[]) ?? [];
      for (const call of calls)
        if (call.id === toolCallId && call.function) call.function.arguments = text;
    }
    if (type === "TOOL_CALL_RESULT" && toolCallId) {
      const resultId =
        messageId ?? `tool-${toolCallId}-${messages.length.toString().padStart(3, "0")}`;
      if (!byId.has(resultId)) {
        const message: StoredMessage = {
          id: resultId,
          role: "tool",
          toolCallId,
          content: event.content ?? "",
          at: now,
        };
        byId.set(resultId, message);
        messages.push(message);
      }
    }
  }
  // 没有任何正文的空助手消息不必落库
  return messages.filter((message) => {
    if (message.role !== "assistant") return true;
    const text = typeof message.content === "string" ? message.content.trim() : "";
    return !!text || (Array.isArray(message.toolCalls) && message.toolCalls.length > 0);
  });
}

/** 一轮流结束时判定成败：RUN_ERROR ⇒ failed，否则 succeeded。 */
export function turnOutcome(events: AgUiLikeEvent[]): {
  status: ChatTurn["status"];
  error?: string;
} {
  for (const event of events) {
    if (event.type !== "RUN_ERROR") continue;
    const message = event.message ?? event.error;
    return { status: "failed", error: typeof message === "string" ? message : "这一轮失败了" };
  }
  return { status: "succeeded" };
}

/**
 * 后台消费同一条 SSE 流（tee 出来的那一支）：按行切、跨 chunk 的半行留在缓冲里。
 * 客户端断开不影响这一支——这正是"杀掉 App 也不丢回复"的关键。
 */
export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  onEvents: (events: AgUiLikeEvent[]) => void,
): Promise<{ error?: string }> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.lastIndexOf("\n");
      if (boundary < 0) continue;
      const complete = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      const events = parseSseChunk(complete);
      if (events.length) onEvents(events);
    }
    const tail = parseSseChunk(buffer);
    if (tail.length) onEvents(tail);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
