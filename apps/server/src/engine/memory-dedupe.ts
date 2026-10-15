/**
 * 记忆去重 / 归并。
 *
 * 背景：写入侧的 id 是 `sha256(owner + text)`（见 `chat-tools.ts`），只能挡住**逐字节相同**的
 * 文本。真实数据里已经出现同一事实的两种写法 —— `我的代号是「白虎」。` 与 `我的代号是白虎` ——
 * 于是库里堆了近重复。这里做两件事：
 *
 *   1. `normalizeMemoryText()`：抹掉引号、句读、空白，全角转半角，用于比较；
 *   2. `rememberMemory()` / `dedupeOwnerMemories()`：把同一条事实的多份记录归并成一份。
 *
 * 只做**形式**上的归并，不做语义判断。"白虎" 与 "青龙" 是不是同一个人改了主意，那是模型的活
 * —— 归并只处理"同一句话的不同写法"，不会去动内容不同的两条。
 */

import { isUserAuthored, planRemoval, protectedIds } from "./memory-adjudicate.ts";
import {
  appendMemoryLog,
  type MemoryLogWriter,
  type MemorySnapshot,
} from "./memory-log.ts";

/** 记忆的最小形状（与 `records` 表里 `kind='memories'` 的 data 对应）。 */
export interface MemoryRecord {
  id: string;
  text: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  temp?: number;
  /** `<!-- locked -->` 之类免衰减标记会体现在 text 上，这里只留位置 */
  [key: string]: unknown;
}

/** 去重需要的最小存储接口（`Store` 满足它；测试里传个内存实现即可）。 */
export interface MemoryStore {
  list<T = Record<string, unknown>>(owner: string, kind: string): Promise<T[]>;
  put<T extends { id: string }>(owner: string, kind: string, value: T): Promise<T>;
  remove(owner: string, kind: string, id: string): Promise<void>;
}

/**
 * 归一化：用于判断两条记忆"是不是同一句话的不同写法"。
 *
 * - 全角转半角（含全角标点、全角空格）
 * - 英文小写
 * - 只保留字母与数字（`\p{L}\p{N}`，汉字算字母），其余一律抹掉 —— 引号、句读、破折号、
 *   省略号、emoji、空白都在此列
 *
 * **不**做同义替换，也不动汉字/字母/数字本身 —— 归一化只该消除"排版差异"，
 * 不该把内容不同的两条判成同一条。
 */
export function normalizeMemoryText(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 同组里选哪条作为"保留的那条"：文本更长者胜（保留信息量最大的写法），平手取更新的。 */
function preferable<T extends MemoryRecord>(a: T, b: T): T {
  if (a.text.length !== b.text.length) return a.text.length > b.text.length ? a : b;
  const at = a.createdAt ? Date.parse(a.createdAt) : 0;
  const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
  return at >= bt ? a : b;
}

export interface DedupePlan<T extends MemoryRecord> {
  /** 归并后应当保留的记录（每个归一化 key 一条） */
  kept: T[];
  /** 被并入 `keeper` 的记录（调用方负责删除） */
  absorbed: { dropped: T; keeper: T }[];
}

/**
 * 规划一次归并：按归一化 key 分组，组内挑一条保留，其余并入。
 * 纯函数，不碰数据库 —— 便于测试；落地由 `dedupeOwnerMemories()` 负责。
 */
export function planDedupe<T extends MemoryRecord>(memories: T[]): DedupePlan<T> {
  const groups = new Map<string, T[]>();
  for (const memory of memories) {
    const key = normalizeMemoryText(memory.text ?? "");
    if (!key) continue; // 空文本无从比较，原样放过
    const bucket = groups.get(key);
    if (bucket) bucket.push(memory);
    else groups.set(key, [memory]);
  }

  const kept: T[] = [];
  const absorbed: { dropped: T; keeper: T }[] = [];

  for (const bucket of groups.values()) {
    let keeper = bucket[0]!;
    for (const item of bucket.slice(1)) keeper = preferable(keeper, item);
    kept.push(keeper);
    for (const item of bucket) if (item !== keeper) absorbed.push({ dropped: item, keeper });
  }

  // 空文本的记录也保留（不参与归并）
  for (const memory of memories) {
    if (!normalizeMemoryText(memory.text ?? "")) kept.push(memory);
  }

  return { kept, absorbed };
}

/** 把 `absorbed` 里的内容并进 keeper：温度取高者、创建时间取更早者、更新时间为现在。 */
export function mergeRecords<T extends MemoryRecord>(keeper: T, others: T[]): T {
  const now = new Date().toISOString();
  let temp = keeper.temp;
  let createdAt = keeper.createdAt;

  for (const other of others) {
    if (typeof other.temp === "number") {
      temp = typeof temp === "number" ? Math.max(temp, other.temp) : other.temp;
    }
    if (other.createdAt) {
      if (!createdAt || Date.parse(other.createdAt) < Date.parse(createdAt)) createdAt = other.createdAt;
    }
  }

  return {
    ...keeper,
    ...(typeof temp === "number" ? { temp } : {}),
    ...(createdAt ? { createdAt } : {}),
    updatedAt: now,
  };
}

/**
 * 写一条记忆：先找有没有"同一句话的别的写法"，有则归并（并把副本删掉），没有才新增。
 *
 * 这是写入侧的统一入口 —— 只要都走这里，`id = sha256(text)` 挡不住的近重复也进不来。
 */
export async function rememberMemory<T extends MemoryRecord>(
  store: MemoryStore,
  owner: string,
  candidate: T,
): Promise<{
  memory: T;
  action: "inserted" | "merged";
  absorbed: string[];
  absorbedRecords: T[];
  keeperIsNew: boolean;
}> {
  const existing = await store.list<T>(owner, "memories");
  const key = normalizeMemoryText(candidate.text ?? "");

  if (!key) {
    await store.put(owner, "memories", candidate);
    return {
      memory: candidate,
      action: "inserted",
      absorbed: [],
      absorbedRecords: [],
      keeperIsNew: true,
    };
  }

  const sameKey = existing.filter((item) => normalizeMemoryText(item.text ?? "") === key);
  if (sameKey.length === 0) {
    await store.put(owner, "memories", candidate);
    return {
      memory: candidate,
      action: "inserted",
      absorbed: [],
      absorbedRecords: [],
      keeperIsNew: true,
    };
  }

  // 候选文本未必更好，所以和已有的一起挑一次"最优写法"。
  const group = [candidate, ...sameKey];

  // 用户手写保护：只要既有记录里有用户手写的，keeper 必须是用户手写的那条
  // （不能拿机器沉淀的条目把它顶掉）；若候选本身是用户手写而既有都是机器沉淀，keeper 取候选。
  const storedUserAuthored = sameKey.filter(isUserAuthored);
  const pool = storedUserAuthored.length > 0 ? storedUserAuthored : group;
  const winner = pool.reduce((best, item) => preferable(best, item), pool[0]!);

  // 保留 winner 的 id（若 winner 是候选则沿用候选 id）；文本用 winner 的，温度/时间做归并。
  const keeper = mergeRecords(winner, group.filter((item) => item !== winner));
  await store.put(owner, "memories", keeper);

  const absorbed: string[] = [];
  const absorbedRecords: T[] = [];
  for (const item of group) {
    if (item.id === keeper.id) continue;
    // 永不"拿机器条目顶掉用户手写"；keeper 自己也是用户手写时，同 key 的副本照旧归并
    // （存量数据的 source 常缺失，一律算用户手写，见 memory-adjudicate.ts:isUserAuthored）。
    if (isUserAuthored(item) && !isUserAuthored(keeper)) continue;
    await store.remove(owner, "memories", item.id);
    absorbed.push(item.id);
    absorbedRecords.push(item);
  }

  // keeper 是否为本轮新增（候选胜出且同 key 原本不存在）
  const keeperIsNew = keeper.id === candidate.id && !sameKey.some((item) => item.id === candidate.id);

  return {
    memory: keeper,
    action: "merged",
    absorbed,
    absorbedRecords,
    keeperIsNew,
  };
}

/** 对已有记忆做一次全量归并（一次性清理 / 定期维护用）。返回被合并掉了多少条。 */
export async function dedupeOwnerMemories(
  store: MemoryStore,
  owner: string,
  logSink?: MemoryLogWriter,
): Promise<{
  before: number;
  after: number;
  merged: { kept: string; dropped: string[] }[];
  skippedByGuard: { dropped: string; keeper: string }[];
  logFailed?: boolean;
}> {
  const all = await store.list<MemoryRecord>(owner, "memories");
  // 先记下条数：`all` 可能与存储内部的数组是同一个引用，删除会把它的长度一起改掉。
  const before = all.length;
  const plan = planDedupe(all);

  const protectedSet = protectedIds(all);
  // 删除上限（20% 且至少留 4）是给"囤积很多条"的批量清理用的：
  // 只有集合本身大过下限时才生效；小集合没有囤积问题，照旧归并
  //（既有单测 tests/memory-dedupe.test.ts 用 2 条数据，必须仍然归并成 1 条）。
  const allowedDrops =
    all.length > 4 ? planRemoval(all.length, plan.absorbed.length) : plan.absorbed.length;

  // 只对"允许范围内且非用户手写"的 absorbed 执行删除；其余原样保留。
  const actualDropped: { dropped: MemoryRecord; keeper: MemoryRecord }[] = [];
  const skippedByGuard: { dropped: string; keeper: string }[] = [];
  let budget = allowedDrops;
  for (const { dropped, keeper } of plan.absorbed) {
    // 只有"拿机器条目顶掉用户手写"才拦：keeper 自己也是用户手写时，同 key 的
    // 副本照旧归并（否则存量数据（source 缺失）永远归并不掉，既有回归锁直接红）。
    const sacrifice = protectedSet.has(dropped.id) && !protectedSet.has(keeper.id);
    if (sacrifice) {
      skippedByGuard.push({ dropped: dropped.id, keeper: keeper.id });
    } else if (budget > 0) {
      actualDropped.push({ dropped, keeper });
      budget -= 1;
    } else {
      skippedByGuard.push({ dropped: dropped.id, keeper: keeper.id });
    }
  }

  // 按 keeper 分组实际删除的记录：写回归并后的 keeper，再删副本。
  const byKeeper = new Map<string, MemoryRecord[]>();
  for (const { dropped, keeper } of actualDropped) {
    const bucket = byKeeper.get(keeper.id);
    if (bucket) bucket.push(dropped);
    else byKeeper.set(keeper.id, [dropped]);
  }

  const merged: { kept: string; dropped: string[] }[] = [];
  for (const [keeperId, others] of byKeeper) {
    const keeper = plan.kept.find((item) => item.id === keeperId);
    if (!keeper) continue;
    await store.put(owner, "memories", mergeRecords(keeper, others));
    const dropped: string[] = [];
    for (const other of others) {
      await store.remove(owner, "memories", other.id);
      dropped.push(other.id);
    }
    merged.push({ kept: keeperId, dropped });
  }

  // 日志：被删条目的完整 data 作为 before 快照（足以还原）。
  // 只在调用方显式给了日志出口时才写 —— 既有单测用的假 store 不区分 kind，
  // 往同一个 store 里塞 memory-log 行会污染它的记忆列表（回归锁会红）。
  let logFailed = false;
  if (actualDropped.length > 0 && logSink) {
    const beforeSnapshots: MemorySnapshot[] = actualDropped.map(({ dropped }) => ({
      id: dropped.id,
      data: dropped,
    }));
    const result = await appendMemoryLog(logSink, {
      action: "dedupe-merge",
      owner,
      before: beforeSnapshots,
      after: [],
      reason: "归并同义记忆",
    });
    logFailed = result.logFailed;
  }

  return {
    before,
    after: before - actualDropped.length,
    merged,
    skippedByGuard,
    ...(logFailed ? { logFailed } : {}),
  };
}
