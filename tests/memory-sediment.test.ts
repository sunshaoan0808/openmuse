import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryRecord } from "../apps/server/src/engine/memory-dedupe.ts";
import {
  buildSedimentPrompt,
  looksLikeSecret,
  memoryId,
  parseSedimentPlan,
  resetSedimentThrottle,
  sedimentTurnMemories,
} from "../apps/server/src/engine/memory-sediment.ts";

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

/** 假补全器：记下被调用的次数与提示词，返回预设输出。 */
function fakeComplete(output: string) {
  const calls: string[] = [];
  return {
    calls,
    complete: async (prompt: string) => {
      calls.push(prompt);
      return { text: output };
    },
  };
}

test("memoryId 只由文本决定 —— 跨轮稳定（对话路径的 key 含每轮不同的 requestKey）", () => {
  assert.equal(memoryId("我喜欢喝美式"), memoryId("我喜欢喝美式"));
  assert.notEqual(memoryId("我喜欢喝美式"), memoryId("我喜欢喝拿铁"));
  assert.match(memoryId("x"), /^[0-9a-f]{64}$/);
});

test("looksLikeSecret 拦住常见凭据形态，不误伤正常文本", () => {
  assert.equal(looksLikeSecret("我的 key 是 sk-abcdefghijklmnopqrst"), true);
  assert.equal(looksLikeSecret("zen-ffffffffffff"), true);
  assert.equal(looksLikeSecret("ghp_abcdefghijklmnopqrstuvwx"), true);
  assert.equal(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----"), true);
  assert.equal(looksLikeSecret("A".repeat(48)), true);

  assert.equal(looksLikeSecret("我的代号是「白虎」。"), false);
  assert.equal(looksLikeSecret("喜欢在晚上写代码"), false);
});

test("parseSedimentPlan：裸 JSON / ```包裹 / 前后有解释 都能认出来", () => {
  const known = ["abcdef1234567890", "fedcba0987654321"];
  const raw = '{"add":["喜欢喝美式"],"revise":[{"id":"abcdef","text":"代号是白虎"}]}';
  const expected = { add: ["喜欢喝美式"], revise: [{ id: "abcdef1234567890", text: "代号是白虎" }] };
  assert.deepEqual(parseSedimentPlan(raw, known), expected);
  assert.deepEqual(parseSedimentPlan("```json\n" + raw + "\n```", known), expected);
  assert.deepEqual(parseSedimentPlan("好的，结果如下：\n" + raw + "\n以上。", known), expected);
});

test("parseSedimentPlan：垃圾输入一律当没有内容，不抛异常", () => {
  assert.deepEqual(parseSedimentPlan("", []), { add: [], revise: [] });
  assert.deepEqual(parseSedimentPlan("模型今天不想说话", []), { add: [], revise: [] });
  assert.deepEqual(parseSedimentPlan("{坏的json", []), { add: [], revise: [] });
  assert.deepEqual(parseSedimentPlan('{"add":"不是数组"}', []), { add: [], revise: [] });
});

test("parseSedimentPlan：凭据不进记忆、认不出的 id 不动、超量截断", () => {
  const known = ["aaaa111122223333"];
  const plan = parseSedimentPlan(
    JSON.stringify({
      add: ["sk-abcdefghijklmnopqrst", "正常偏好", "第二条", "第三条", "第四条", "第五条", "第六条"],
      revise: [
        { id: "aaaa", text: "合法修正" },
        { id: "zzzz", text: "认不出的 id，应丢弃" },
        { id: "aaaa", text: "同一目标重复，应去重" },
      ],
    }),
    known,
  );
  assert.equal(plan.add.includes("sk-abcdefghijklmnopqrst"), false, "凭据必须被拦下");
  assert.equal(plan.add.length, 5, "新增最多 5 条");
  assert.deepEqual(plan.revise, [{ id: "aaaa111122223333", text: "合法修正" }]);
});

test("sedimentTurnMemories：短到像应答就不调模型，但『我改名叫白虎了』这种 7 字事实要放行", async () => {
  resetSedimentThrottle();
  const store = memoryStore();
  const fake = fakeComplete('{"add":["不该发生"],"revise":[]}');

  // 纯应答：长度够但没内容
  const acked = await sedimentTurnMemories(store, "local-user", "好的好的", "那我等着～", {
    complete: fake.complete,
  });
  assert.equal(fake.calls.length, 0, "纯应答不该产生模型调用");
  assert.match(acked.skipped ?? "", /应答/);

  // 太短
  const short = await sedimentTurnMemories(store, "local-user", "嗯", "嗯嗯", {
    complete: fake.complete,
  });
  assert.equal(fake.calls.length, 0);
  assert.equal(short.skipped, "用户消息过短或只是应答");
  assert.equal(store.rows.length, 0);

  // 7 个汉字 = 完整事实，必须放行（中文信息密度高，闸门不能按英文长度设）
  resetSedimentThrottle();
  await sedimentTurnMemories(store, "local-user", "我改名叫白虎了", "记住了。", {
    complete: fake.complete,
  });
  assert.equal(fake.calls.length, 1, "完整的短句也要沉淀");
});

test("sedimentTurnMemories：新增事实落库，来源标为自动沉淀、温度温热", async () => {
  resetSedimentThrottle();
  const store = memoryStore();
  const fake = fakeComplete('{"add":["喜欢在晚上写代码"],"revise":[]}');
  const outcome = await sedimentTurnMemories(
    store,
    "local-user",
    "我一般晚上写代码效率最高",
    "记下了。",
    { complete: fake.complete },
  );

  assert.equal(outcome.added.length, 1);
  assert.equal(outcome.added[0]!.merged, false);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0]!.text, "喜欢在晚上写代码");
  assert.equal(store.rows[0]!.source, "自动沉淀");
  assert.equal(store.rows[0]!.temp, 2);
  assert.equal(store.rows[0]!.id, memoryId("喜欢在晚上写代码"), "id 必须确定性");
});

test("sedimentTurnMemories：新增与既有记忆近重复时归并而不是多出一条", async () => {
  resetSedimentThrottle();
  const store = memoryStore([
    { id: memoryId("我的代号是「白虎」。"), text: "我的代号是「白虎」。", temp: 2 },
  ]);
  const fake = fakeComplete('{"add":["我的代号是白虎"],"revise":[]}');
  const outcome = await sedimentTurnMemories(store, "local-user", "再提醒你一次", "记住了。", {
    complete: fake.complete,
  });

  assert.equal(outcome.added[0]!.merged, true);
  assert.equal(store.rows.length, 1, "不能因为写法不同就多出一条");
});

test("sedimentTurnMemories：修正既有记忆，并记下修正前的原文", async () => {
  resetSedimentThrottle();
  const target = memoryId("我的代号是「青龙」。");
  const store = memoryStore([{ id: target, text: "我的代号是「青龙」。", temp: 2 }]);
  const fake = fakeComplete(
    JSON.stringify({ add: [], revise: [{ id: target.slice(0, 12), text: "我的代号是「白虎」。" }] }),
  );
  const outcome = await sedimentTurnMemories(store, "local-user", "我改名叫白虎了", "记住了。", {
    complete: fake.complete,
  });

  assert.equal(outcome.revised.length, 1);
  assert.equal(outcome.revised[0]!.from, "我的代号是「青龙」。");
  assert.equal(store.rows.length, 1, "修正应当就改那一条");
  assert.equal(store.rows[0]!.text, "我的代号是「白虎」。");
  assert.equal(store.rows[0]!.revisedFrom, "我的代号是「青龙」。", "要留痕，便于回溯");
  assert.ok(store.rows[0]!.updatedAt);
});

test("sedimentTurnMemories：修正后与另一条撞车时，靠收尾归并把重复收掉", async () => {
  resetSedimentThrottle();
  const target = memoryId("代号是青龙");
  const sibling = memoryId("我的代号是「白虎」。");
  const store = memoryStore([
    { id: target, text: "代号是青龙", temp: 2 },
    { id: sibling, text: "我的代号是「白虎」。", temp: 2 },
  ]);
  const fake = fakeComplete(
    JSON.stringify({ add: [], revise: [{ id: target.slice(0, 12), text: "我的代号是白虎" }] }),
  );
  await sedimentTurnMemories(store, "local-user", "我改名叫白虎了", "记住了。", {
    complete: fake.complete,
  });

  assert.equal(store.rows.length, 1, "修正后应只剩一条");
  assert.equal(store.rows[0]!.text, "我的代号是「白虎」。", "保留信息量更大的写法");
});

test("sedimentTurnMemories：节流 —— 同一 owner 连续两次只跑一次", async () => {
  resetSedimentThrottle();
  const store = memoryStore();
  const fake = fakeComplete('{"add":["喜欢在晚上写代码"],"revise":[]}');
  await sedimentTurnMemories(store, "local-user", "我一般晚上写代码效率最高", "记下了。", {
    complete: fake.complete,
  });
  const second = await sedimentTurnMemories(store, "local-user", "再说一次，我晚上写代码", "嗯。", {
    complete: fake.complete,
  });
  assert.equal(fake.calls.length, 1, "15 秒内不该再调模型");
  assert.equal(second.skipped, "距上次沉淀太近");
});

test("sedimentTurnMemories：模型/网关报错只当这轮没记，不抛异常", async () => {
  resetSedimentThrottle();
  const store = memoryStore();
  const outcome = await sedimentTurnMemories(store, "local-user", "我一般晚上写代码", "记下了。", {
    complete: async () => ({ error: "网关报错：Upstream error from Nvidia: overloaded" }),
  });
  assert.equal(store.rows.length, 0);
  assert.match(outcome.skipped ?? "", /网关报错/);
});

test("parseSedimentPlan：模型给 {\"fact\": ...} 这种对象形态也能认（ministral 就这么干）", () => {
  const plan = parseSedimentPlan(
    '{"add":[{"fact":"喜欢喝美式咖啡"},{"text":"一般晚上写代码"},{"无关字段":"x"}],"revise":[]}',
    [],
  );
  assert.deepEqual(plan.add, ["喜欢喝美式咖啡", "一般晚上写代码"]);
});

test("parseSedimentPlan：模型给 ```json 包裹 + 对象形态的组合（实测 ministral 的真实输出）", () => {
  const raw = [
    "```json",
    "{",
    '  "add": [',
    '    { "fact": "用户偏好饮用美式咖啡", "confidence": 0.9 },',
    '    { "fact": "用户一般晚上写代码", "confidence": 0.8 }',
    "  ],",
    '  "revise": []',
    "}",
    "```",
  ].join("\n");
  const plan = parseSedimentPlan(raw, []);
  assert.deepEqual(plan.add, ["用户偏好饮用美式咖啡", "用户一般晚上写代码"]);
});

test("buildSedimentPrompt：把既有记忆的短标识与整轮对话都带进提示词", () => {
  const prompt = buildSedimentPrompt(
    [{ id: "abcdef1234567890", text: "我的代号是「白虎」。" }],
    "我改名叫青龙了",
    "好的。",
  );
  assert.ok(prompt.includes("abcdef123456"), "要给出短标识供修正引用");
  assert.ok(prompt.includes("我的代号是「白虎」。"));
  assert.ok(prompt.includes("我改名叫青龙了"));
  assert.match(prompt, /凭据/);
  // 空记忆时也要说得通
  assert.ok(buildSedimentPrompt([], "abc def ghi", "ok").includes("还没有任何记忆"));
});
