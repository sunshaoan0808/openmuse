/**
 * P2a 的**集成守卫**：三条硬规则在真实数据形态下真的生效。
 *
 * 直接对着 `dedupeOwnerMemories` / `sedimentTurnMemories` 跑，断言"库里的最终状态"，
 * 而不是断言纯函数 —— 纯函数的行为在 `tests/memory-adjudicate.test.ts` 里已经钉过了。
 *
 * 这里用**区分 kind** 的内存 store（`tests/memory-dedupe.test.ts` 的假 store 不区分 kind，
 * 无法把 `memory-log` 与 `memories` 分开断言），别的写法与既有一致。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dedupeOwnerMemories,
  type MemoryRecord,
  rememberMemory,
} from "../apps/server/src/engine/memory-dedupe.ts";
import { rollbackMemoryLog, type MemoryLogEntry } from "../apps/server/src/engine/memory-log.ts";
import { resetSedimentThrottle, sedimentTurnMemories } from "../apps/server/src/engine/memory-sediment.ts";

/** 区分 kind 的内存 store：`memories` 与 `memory-log` 各自一个桶。 */
function memStore(seed: MemoryRecord[] = []) {
  const buckets = new Map<string, Map<string, unknown>>();
  const bucket = (kind: string) => {
    let found = buckets.get(kind);
    if (!found) {
      found = new Map();
      buckets.set(kind, found);
    }
    return found;
  };
  for (const item of seed) bucket("memories").set(item.id, { ...item });
  const store = {
    async list<T>(_owner: string, kind: string): Promise<T[]> {
      return [...bucket(kind).values()] as T[];
    },
    async put<T extends { id: string }>(_owner: string, kind: string, value: T): Promise<T> {
      bucket(kind).set(value.id, JSON.parse(JSON.stringify(value)) as T);
      return value;
    },
    async remove(_owner: string, kind: string, id: string): Promise<void> {
      bucket(kind).delete(id);
    },
    async get<T>(_owner: string, kind: string, id: string): Promise<T | null> {
      return (bucket(kind).get(id) ?? null) as T | null;
    },
  };
  return {
    store,
    memories: () => [...bucket("memories").values()] as MemoryRecord[],
    logs: () => [...bucket("memory-log").values()] as MemoryLogEntry[],
  };
}

const machine = (id: string, text: string): MemoryRecord => ({
  id,
  text,
  source: "自动沉淀",
  createdAt: "2026-03-01T00:00:00.000Z",
});
const handWritten = (id: string, text: string): MemoryRecord => ({ id, text });

// ---------------------------------------------------------------------------
// 永不删用户手写
// ---------------------------------------------------------------------------

test("§2.2 用户手写条目不会被自动整理删掉（keeper 是机器条目时）", async () => {
  const { store, memories } = memStore([
    // 机器那条**更长** → 按"更长者胜"它会当 keeper，用户手写的那条就成了待删副本 → 必须被守卫拦住
    machine("m1", "我的代号是「白虎」。"),
    handWritten("u1", "我的代号是白虎"),
  ]);
  const result = await dedupeOwnerMemories(store, "p2a-a");
  const ids = memories().map((m) => m.id);
  assert.ok(ids.includes("u1"), "用户手写的那条必须还在");
  assert.ok(
    result.skippedByGuard.some((row) => row.dropped === "u1"),
    "被守卫挡下的事实要如实报告",
  );
});

test("§2.2 两条都是用户手写时，同 key 照旧归并成一条（内容不丢，keeper 取更长者）", async () => {
  const { store, memories } = memStore([
    handWritten("u1", "我的代号是白虎"),
    handWritten("u2", "我的代号是「白虎」。"),
  ]);
  await dedupeOwnerMemories(store, "p2a-b");
  const left = memories();
  assert.equal(left.length, 1, "两条用户手写的同义记录归并成一条");
  assert.equal(left[0]?.id, "u2", "保留信息量更大的写法（更长者胜）");
});

test("§2.2 机器条目之间照旧归并（不许因为守卫而停止清理）", async () => {
  const { store, memories } = memStore([
    machine("m1", "用户住在西安"),
    machine("m2", "用户住在「西安」。"),
  ]);
  const result = await dedupeOwnerMemories(store, "p2a-c");
  assert.equal(memories().length, 1);
  assert.equal(result.skippedByGuard.length, 0, "机器条目之间不该被守卫拦");
});

// ---------------------------------------------------------------------------
// 删除上限
// ---------------------------------------------------------------------------

test("§2.2 删除上限：10 条同义机器记录最多删 20%（2 条），其余原样留下", async () => {
  const seed = [
    machine("k", "用户喜欢喝咖啡"),
    ...Array.from({ length: 9 }, (_, i) => machine(`d${i}`, `用户喜欢喝「咖啡」。${".".repeat(i)}`)),
  ];
  const { store, memories } = memStore(seed);
  const result = await dedupeOwnerMemories(store, "p2a-d");
  assert.equal(result.after, 8, "10 条里最多删 2 条");
  assert.equal(memories().length, 8);
  assert.equal(result.skippedByGuard.length, 7, "剩下 7 条因触顶被挡下");
});

test("§2.2 上限只对**较大集合**生效：5 条同义只删 1 条；小集合（≤4）照旧全归并", async () => {
  const five = memStore([
    machine("k", "用户在西安"),
    ...Array.from({ length: 4 }, (_, i) => machine(`f${i}`, `用户在「西安」。${".".repeat(i)}`)),
  ]);
  const fiveResult = await dedupeOwnerMemories(five.store, "p2a-e");
  assert.equal(fiveResult.after, 4, "5 条删到 4 条就该收手（keepAtLeast）");
  assert.equal(five.memories().length, 4);

  const four = memStore([
    machine("k", "用户在北京"),
    ...Array.from({ length: 3 }, (_, i) => machine(`g${i}`, `用户在「北京」。${".".repeat(i)}`)),
  ]);
  const fourResult = await dedupeOwnerMemories(four.store, "p2a-f");
  // 实现取舍（有意，写进回报）：上限是防"批量清理把记忆清空"的，只有集合大过下限时才套用；
  // 4 条以下没有囤积问题，照旧归并 —— 这也让既有回归锁（2 条必须归并成 1 条）保持绿。
  assert.equal(fourResult.after, 1, "小集合不受上限影响（与既有行为一致）");
});

test("§2.2 小集合不受上限影响（既有回归锁的形态：2 条同义机器记录仍归并成 1 条）", async () => {
  const { store, memories } = memStore([
    machine("m1", "我的代号是白虎"),
    machine("m2", "我的代号是「白虎」。"),
  ]);
  const result = await dedupeOwnerMemories(store, "p2a-g");
  assert.equal(result.after, 1, "两条的小集合不该被 20%/下限挡住");
  assert.equal(memories().length, 1);
});

// ---------------------------------------------------------------------------
// 词表裁决（revise）
// ---------------------------------------------------------------------------

/** 造一个"模型说要修正"的假补全。 */
const reviseWith = (id: string, text: string) => async () => ({
  text: JSON.stringify({ add: [], revise: [{ id: id.slice(0, 12), text }] }),
});

test("§2.2 改写凭空造词 → 被拒，且原记录一个字都没动", async () => {
  const { store, memories } = memStore([machine("t1", "用户在西安")]);
  resetSedimentThrottle();
  const outcome = await sedimentTurnMemories(store, "p2a-h", "我不在西安了，我在北京", "好的。", {
    complete: reviseWith("t1", "用户在成都"), // 「成都」既不在原记忆也不在用户消息里
  });
  assert.equal(outcome.revised.length, 0, "凭空造词的修正不许落库");
  assert.equal(outcome.rejected.length, 1, "被拒的修正要如实报告");
  assert.ok(outcome.rejected[0]!.unknown.includes("成都"), "要点名是哪个词不在源里");
  assert.equal(memories()[0]?.text, "用户在西安", "原记录必须原样保留");
});

test("§2.2 用本轮用户消息里的新词改写 → 通过（用户改主意是正常路径）", async () => {
  const { store, memories } = memStore([machine("t2", "用户在西安")]);
  resetSedimentThrottle();
  const outcome = await sedimentTurnMemories(store, "p2a-i", "我搬到北京了", "恭喜。", {
    complete: reviseWith("t2", "用户在北京"),
  });
  assert.equal(outcome.rejected.length, 0);
  assert.equal(outcome.revised.length, 1);
  assert.equal(memories()[0]?.text, "用户在北京");
});

test("§2.2 词表**不含助手回复**：模型复述自己说过的话也会被拒", async () => {
  const { store, memories } = memStore([machine("t3", "用户在西安")]);
  resetSedimentThrottle();
  const outcome = await sedimentTurnMemories(store, "p2a-j", "我把房间收拾了一下", "你已经在成都生活了", {
    complete: reviseWith("t3", "用户在成都"), // 「成都」只在助手回复里
  });
  assert.equal(outcome.rejected.length, 1, "助手自己的话不能当证据（否则等于教模型自证）");
  assert.equal(memories()[0]?.text, "用户在西安");
});

// ---------------------------------------------------------------------------
// 可回滚日志
// ---------------------------------------------------------------------------

test("§2.3 归并落库时写一条 memory-log，字段完整（action/before/after/reason/at）", async () => {
  const { store, logs } = memStore([
    machine("m1", "我的代号是白虎"),
    machine("m2", "我的代号是「白虎」。"),
  ]);
  await dedupeOwnerMemories(store, "p2a-k", store);
  const [entry] = logs();
  assert.ok(entry, "应当写了一条日志");
  assert.equal(entry.action, "dedupe-merge");
  assert.equal(entry.owner, "p2a-k");
  assert.ok(entry.at, "要有时间戳");
  assert.ok(entry.reason, "要有原因");
  assert.ok(entry.before.some((snap) => snap.id === "m1"), "被删条目的完整快照要在 before 里");
  assert.ok(entry.before.every((snap) => snap.data?.text), "快照必须带完整 data，否则没法还原");
});

test("§2.3 rollbackMemoryLog 把被删条目原样复活；重复回滚幂等（0/0）", async () => {
  const { store, memories, logs } = memStore([
    machine("m1", "我的代号是白虎"),
    machine("m2", "我的代号是「白虎」。"),
  ]);
  await dedupeOwnerMemories(store, "p2a-l", store);
  assert.equal(memories().length, 1, "先确认真的归并掉了");
  const logId = logs()[0]!.id;

  const first = await rollbackMemoryLog(store, "p2a-l", logId);
  assert.equal(first.restored, 1, "被删的那条应当被写回");
  assert.equal(memories().length, 2, "回滚后被删条目必须回来");

  const second = await rollbackMemoryLog(store, "p2a-l", logId);
  assert.deepEqual(second, { restored: 0, removed: 0 }, "同一条日志回滚两次结果相同（幂等）");
  assert.equal(memories().length, 2, "幂等回滚不该把条目再删一遍");
});

test("§2.3 沉淀新增的那条能按日志回滚删掉（before 空、after 只留 id）", async () => {
  const { store, memories, logs } = memStore();
  resetSedimentThrottle();
  const outcome = await sedimentTurnMemories(store, "p2a-m", "我最喜欢的城市是西安", "记住了。", {
    complete: async () => ({ text: JSON.stringify({ add: ["用户最喜欢的城市是西安"], revise: [] }) }),
    logSink: store,
  });
  assert.equal(outcome.added.length, 1);
  assert.equal(memories().length, 1);
  const entry = logs().find((row) => row.action === "sediment-add");
  assert.ok(entry, "新增也要写一条 sediment-add 日志");

  const result = await rollbackMemoryLog(store, "p2a-m", entry.id);
  assert.equal(result.removed, 1, "回滚应当把这条新增删掉");
  assert.equal(memories().length, 0);
});

test("§2.3 没给日志出口时完全不写日志（既不污染，也不报错）", async () => {
  const { store, logs } = memStore([
    machine("m1", "我的代号是白虎"),
    machine("m2", "我的代号是「白虎」。"),
  ]);
  await dedupeOwnerMemories(store, "p2a-n");
  resetSedimentThrottle();
  await sedimentTurnMemories(store, "p2a-n", "我在西安住", "好。", {
    complete: async () => ({ text: JSON.stringify({ add: ["用户在西安住"], revise: [] }) }),
  });
  assert.equal(logs().length, 0, "没给出口就一个字都不该写");
});

// ---------------------------------------------------------------------------
// 回归锁：rememberMemory 的既有契约
// ---------------------------------------------------------------------------

test("§2.2 rememberMemory 仍会把同义记录归并（并多回报 absorbedRecords 供写日志）", async () => {
  const { store, memories } = memStore([machine("m1", "我的代号是白虎")]);
  const result = await rememberMemory(store, "p2a-o", {
    id: "m2",
    text: "我的代号是「白虎」。",
    source: "自动沉淀",
  });
  assert.equal(result.action, "merged");
  assert.equal(memories().length, 1, "同义新写入不该堆第二条");
  assert.equal(result.absorbedRecords.length, 1, "要让调用方拿到被吸收的完整记录（写日志用）");
  assert.equal(result.absorbedRecords[0]?.text, "我的代号是白虎", "被吸收的是较短的那条写法");
});
