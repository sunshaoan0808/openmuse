/**
 * 记忆日志：自动整理/沉淀造成落库改动时写的可回滚记录。
 *
 * 沿用 `db.ts` 的通用 `records` 存取（`kind='memory-log'`），**不新建表**。
 * 写入失败一律静默降级 —— 日志只是可回滚的保险，不该影响记忆本身。
 */

import type { MemoryRecord } from "./memory-dedupe.ts";

/** 写日志只需要 `put`。 */
export interface MemoryLogWriter {
  put<T extends { id: string }>(owner: string, kind: string, value: T): Promise<T>;
}

/** 回滚日志还需要读与删。 */
export interface MemoryLogStore extends MemoryLogWriter {
  get<T = Record<string, unknown>>(owner: string, kind: string, id: string): Promise<T | null>;
  remove(owner: string, kind: string, id: string): Promise<void>;
}

/** 还原用的最小快照：被删/被改写条目存完整 data，被新增条目只存 id。 */
export interface MemorySnapshot {
  id: string;
  /** 完整条目（有则能原样写回）；纯新增条目只留 id */
  data?: MemoryRecord;
}

/** 一条记忆日志。 */
export interface MemoryLogEntry {
  id: string;
  at: string;
  action: "sediment-add" | "sediment-revise" | "dedupe-merge";
  owner: string;
  before: MemorySnapshot[];
  after: MemorySnapshot[];
  reason: string;
  /** 已回滚标记：同一条日志回滚两次返回同样的 0/0（幂等）。 */
  rolledBackAt?: string;
}

/** 一次日志动作的输入（id / at 由本模块生成）。 */
export interface MemoryLogInput {
  action: MemoryLogEntry["action"];
  owner: string;
  before: MemorySnapshot[];
  after: MemorySnapshot[];
  reason: string;
}

/**
 * 追加一条日志。**不抛异常**：写不进去只回报 `logFailed: true`，由调用方在 outcome 里标记。
 */
export async function appendMemoryLog(
  store: MemoryLogWriter,
  input: MemoryLogInput,
): Promise<{ id: string; logFailed: boolean }> {
  const id = crypto.randomUUID();
  const entry: MemoryLogEntry = {
    id,
    at: new Date().toISOString(),
    action: input.action,
    owner: input.owner,
    before: input.before,
    after: input.after,
    reason: input.reason,
  };
  try {
    await store.put(input.owner, "memory-log", entry);
    return { id, logFailed: false };
  } catch {
    return { id, logFailed: true };
  }
}

/**
 * 按日志把 owner 的记忆恢复到该条日志的 `before` 状态。
 *
 * - `before` 里的完整 data 原样写回（覆盖本次改写、复活本次删除）；
 * - `after` 里不在 `before` 的 id 被删掉（撤掉本次新增）；
 * - 幂等：日志一旦标记 `rolledBackAt`，再次调用直接返回 `{restored:0, removed:0}`。
 */
export async function rollbackMemoryLog(
  store: MemoryLogStore,
  owner: string,
  logId: string,
): Promise<{ restored: number; removed: number }> {
  const log = await store.get<MemoryLogEntry>(owner, "memory-log", logId);
  if (!log) return { restored: 0, removed: 0 };
  if (log.rolledBackAt) return { restored: 0, removed: 0 };

  let restored = 0;
  const beforeIds = new Set<string>();
  for (const snap of log.before) {
    beforeIds.add(snap.id);
    if (!snap.data) continue;
    await store.put(owner, "memories", snap.data);
    restored += 1;
  }

  let removed = 0;
  for (const snap of log.after) {
    if (beforeIds.has(snap.id)) continue;
    await store.remove(owner, "memories", snap.id);
    removed += 1;
  }

  // 标记已回滚。标记失败也不影响结果 —— 下一次最坏只是重复执行一遍幂等操作。
  try {
    await store.put(owner, "memory-log", { ...log, rolledBackAt: new Date().toISOString() });
  } catch {
    /* 静默 */
  }

  return { restored, removed };
}