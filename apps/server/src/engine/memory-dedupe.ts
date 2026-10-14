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
): Promise<{ memory: T; action: "inserted" | "merged"; absorbed: string[] }> {
  const existing = await store.list<T>(owner, "memories");
  const key = normalizeMemoryText(candidate.text ?? "");

  if (!key) {
    await store.put(owner, "memories", candidate);
    return { memory: candidate, action: "inserted", absorbed: [] };
  }

  const sameKey = existing.filter((item) => normalizeMemoryText(item.text ?? "") === key);
  if (sameKey.length === 0) {
    await store.put(owner, "memories", candidate);
    return { memory: candidate, action: "inserted", absorbed: [] };
  }

  // 候选文本未必更好，所以和已有的一起挑一次"最优写法"。
  const group = [candidate, ...sameKey];
  const winner = group.reduce((best, item) => preferable(best, item), group[0]!);

  // 保留 winner 的 id（若 winner 是候选则沿用候选 id）；文本用 winner 的，温度/时间做归并。
  const keeper = mergeRecords(winner, group.filter((item) => item !== winner));
  await store.put(owner, "memories", keeper);

  const absorbed: string[] = [];
  for (const item of group) {
    if (item.id === keeper.id) continue;
    await store.remove(owner, "memories", item.id);
    absorbed.push(item.id);
  }
  return { memory: keeper, action: "merged", absorbed };
}

/** 对已有记忆做一次全量归并（一次性清理 / 定期维护用）。返回被合并掉了多少条。 */
export async function dedupeOwnerMemories(
  store: MemoryStore,
  owner: string,
): Promise<{ before: number; after: number; merged: { kept: string; dropped: string[] }[] }> {
  const all = await store.list<MemoryRecord>(owner, "memories");
  // 先记下条数：`all` 可能与存储内部的数组是同一个引用，删除会把它的长度一起改掉。
  const before = all.length;
  const plan = planDedupe(all);

  const byKeeper = new Map<string, MemoryRecord[]>();
  for (const { dropped, keeper } of plan.absorbed) {
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

  return { before, after: before - plan.absorbed.length, merged };
}
