/**
 * 已保存会话（本地线程）。
 *
 * 上游 App 的会话列表走的是 CopilotKit 的富线程接口，那套只有 CopilotKit Intelligence（云）
 * 才支持；本地运行时上改名/归档必然抛 "Thread mutations are not available"。这里我们自己
 * 存会话：列表、改名、归档、删除、以及每条会话自己的消息历史，全部落在自有 store 里。
 */
export type SavedThread = {
  id: string;
  name: string;
  archived: boolean;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

/** 主会话（App 里始终可用、不可删除的那条）的固定 id。 */
export const mainThreadId = "local-main";
/** 未命名会话的显示名（App 端同名同义）。 */
export const untitledThread = "新会话";

/** 会话最近更新时间用于排序，避免列表因毫秒级抖动而乱序。 */
export function sortThreads(threads: SavedThread[]): SavedThread[] {
  return [...threads].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

/** 从消息里取一个像样的会话名：第一条用户文本，压平空白、截断。 */
export function titleFromMessages(messages: unknown, limit = 40): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const candidate = message as { role?: unknown; content?: unknown };
    if (candidate.role !== "user") continue;
    const text = flattenText(candidate.content);
    if (!text) continue;
    return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
  }
  return undefined;
}

/** 消息内容既可能是字符串，也可能是 AG-UI 的分段数组。 */
function flattenText(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 把一次请求带来的信息合进会话记录：改名/归档是显式操作，标题与消息数是自动维护的。
 * 自动改标题只在会话还没被用户命名时发生，绝不覆盖用户自己起的名字。
 */
export function mergeThread(
  existing: SavedThread | undefined,
  id: string,
  options: {
    now: string;
    agentId?: string;
    name?: string;
    archived?: boolean;
    autoTitle?: string;
    messageCount?: number;
    touch?: boolean;
  },
): SavedThread {
  const previousName = existing?.name?.trim() ?? "";
  const explicitName = options.name?.trim();
  const autoTitle = options.autoTitle?.trim();
  const keepUserTitle = !!previousName && previousName !== untitledThread;
  const name =
    explicitName || (keepUserTitle ? previousName : autoTitle || previousName || untitledThread);
  return {
    id,
    name,
    archived: options.archived ?? existing?.archived ?? false,
    agentId: options.agentId ?? existing?.agentId ?? "default",
    createdAt: existing?.createdAt ?? options.now,
    updatedAt: options.touch === false ? (existing?.updatedAt ?? options.now) : options.now,
    messageCount: Math.max(options.messageCount ?? existing?.messageCount ?? 0, 0),
  };
}

/** 会话存储用的 key：主会话沿用历史记录 id，保证升级后老历史还在。 */
export function conversationRecordId(threadId: string | undefined): string {
  if (!threadId || threadId === mainThreadId) return "default";
  return threadId;
}
