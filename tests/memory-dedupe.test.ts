import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeOwnerMemories,
  normalizeMemoryText,
  planDedupe,
  rememberMemory,
  type MemoryRecord,
} from "../apps/server/src/engine/memory-dedupe.ts";

/** 内存版存储：只实现去重逻辑用到的那三个方法。 */
function memoryStore(seed: MemoryRecord[] = []) {
  const rows = [...seed];
  return {
    rows,
    async list<T>(_: string, __: string) {
      return rows as unknown as T[];
    },
    async put<T extends { id: string }>(_: string, __: string, value: T) {
      const at = rows.findIndex((row) => row.id === value.id);
      if (at >= 0) rows[at] = value as unknown as MemoryRecord;
      else rows.push(value as unknown as MemoryRecord);
      return value;
    },
    async remove(_: string, __: string, id: string) {
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) rows.splice(at, 1);
    },
  };
}

test("normalizeMemoryText 抹掉排版差异，但不吞掉内容", () => {
  // 真实数据：同一条事实的两种写法应当归一
  assert.equal(normalizeMemoryText("我的代号是「白虎」。"), normalizeMemoryText("我的代号是白虎"));
  assert.equal(normalizeMemoryText("  喜欢  喝咖啡  "), "喜欢喝咖啡");
  assert.equal(normalizeMemoryText("Ｈｅｌｌｏ！"), "hello");
  assert.equal(normalizeMemoryText("（备注）—— A、B"), "备注ab");
  // 内容不同就不能归一
  assert.notEqual(normalizeMemoryText("我的代号是「白虎」。"), normalizeMemoryText("我的代号是「青龙」。"));
  // 数字/字母大小写以外的差异要保留
  assert.notEqual(normalizeMemoryText("温度 20 度"), normalizeMemoryText("温度 21 度"));
});

test("planDedupe 把同一句话的不同写法归成一条，保留信息量最大的写法", () => {
  const memories: MemoryRecord[] = [
    { id: "a", text: "我的代号是「青龙」。", createdAt: "2026-09-29T03:49:17.787Z" },
    { id: "b", text: "我的代号是「白虎」。", createdAt: "2026-09-29T04:20:18.194Z" },
    { id: "c", text: "我的代号是白虎", createdAt: "2026-09-29T06:21:20.502Z" },
  ];
  const plan = planDedupe(memories);

  assert.equal(plan.kept.length, 2, "青龙 与 白虎 是两条不同的事实，不能合成一条");
  const keptIds = plan.kept.map((item) => item.id).sort();
  assert.deepEqual(keptIds, ["a", "b"]);

  // b 文本更长（带引号），胜过 c
  assert.equal(plan.absorbed.length, 1);
  assert.equal(plan.absorbed[0]!.dropped.id, "c");
  assert.equal(plan.absorbed[0]!.keeper.id, "b");
});

test("planDedupe 对空文本与独一份的记录不动手", () => {
  const plan = planDedupe([
    { id: "a", text: "唯一一条" },
    { id: "b", text: "   " },
  ]);
  assert.equal(plan.kept.length, 2);
  assert.equal(plan.absorbed.length, 0);
});

test("dedupeOwnerMemories 归并后库里的条数真的减少，且温度/时间取并集", async () => {
  const store = memoryStore([
    { id: "b", text: "我的代号是「白虎」。", createdAt: "2026-09-29T04:20:18.194Z", temp: 2 },
    { id: "c", text: "我的代号是白虎", createdAt: "2026-09-29T06:21:20.502Z", temp: 3 },
  ]);

  const result = await dedupeOwnerMemories(store, "local-user");

  assert.equal(result.before, 2);
  assert.equal(result.after, 1);
  assert.equal(store.rows.length, 1);
  const [survivor] = store.rows;
  assert.equal(survivor!.id, "b", "保留更长的那条文本");
  assert.equal(survivor!.text, "我的代号是「白虎」。");
  assert.equal(survivor!.temp, 3, "温度取高者，别把热记忆降级");
  assert.equal(survivor!.createdAt, "2026-09-29T04:20:18.194Z", "创建时间取更早者");
  assert.ok(survivor!.updatedAt, "归并要写 updatedAt，否则会立刻被当成陈旧记忆");
});

test("rememberMemory 写入近重复时归并而不是新增", async () => {
  const store = memoryStore([
    { id: "b", text: "我的代号是「白虎」。", createdAt: "2026-09-29T04:20:18.194Z", temp: 2 },
  ]);

  const result = await rememberMemory(store, "local-user", {
    id: "sha-of-variant",
    text: "我的代号是白虎",
    source: "User confirmed in chat",
    createdAt: "2026-10-14T00:00:00.000Z",
    temp: 2,
  });

  assert.equal(result.action, "merged");
  assert.equal(store.rows.length, 1, "不能因为写法不同就多出一条");
  assert.equal(store.rows[0]!.text, "我的代号是「白虎」。", "更长的写法胜出");
  assert.deepEqual(result.absorbed, ["sha-of-variant"]);
});

test("rememberMemory 对新事实照常新增", async () => {
  const store = memoryStore([{ id: "a", text: "我的代号是「白虎」。" }]);
  const result = await rememberMemory(store, "local-user", {
    id: "new",
    text: "我喜欢喝美式",
    createdAt: "2026-10-14T00:00:00.000Z",
  });
  assert.equal(result.action, "inserted");
  assert.equal(store.rows.length, 2);
});

test("rememberMemory 遇到空文本不参与归并，直接写入", async () => {
  const store = memoryStore([{ id: "a", text: "   " }]);
  const result = await rememberMemory(store, "local-user", { id: "b", text: "" });
  assert.equal(result.action, "inserted");
  assert.equal(store.rows.length, 2);
});
