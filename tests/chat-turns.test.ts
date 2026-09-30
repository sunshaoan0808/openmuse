import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import {
  type AgUiLikeEvent,
  appendMessages,
  assembleTurnMessages,
  emptyConversation,
  messagesSince,
  newTurn,
  parseSseChunk,
  turnOutcome,
} from "../apps/server/src/chat-turns.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store, app: Awaited<ReturnType<typeof createApp>>["app"], token: string, directory: string;
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-turns-"));
  db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  ({ app } = await createApp(db, config));
  token = (
    await (
      await app.request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json()
  ).token;
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("追加消息：发游标、按 id 幂等、重发不回退", () => {
  const now = "2026-09-30T00:00:00.000Z";
  const first = appendMessages(null, "c", [{ id: "m1", role: "user", content: "你好" }], now);
  assert.equal(first.next.seq, 1);
  assert.equal(first.added.length, 1);
  assert.equal(first.next.messages[0].seq, 1);
  // 同样的消息再送一次（至少一次投递的正常现象）：不新增、不换 seq
  const repeat = appendMessages(
    first.next,
    "c",
    [{ id: "m1", role: "user", content: "你好" }],
    now,
  );
  assert.equal(repeat.added.length, 0);
  assert.equal(repeat.next.seq, 1);
  assert.equal(repeat.next.messages.length, 1);
  // 同 id 但内容不同：以先到的为准
  const conflict = appendMessages(
    first.next,
    "c",
    [{ id: "m1", role: "user", content: "改了" }],
    now,
  );
  assert.equal(conflict.next.messages[0].content, "你好");
  const more = appendMessages(
    conflict.next,
    "c",
    [{ id: "m2", role: "assistant", content: "在" }],
    now,
  );
  assert.equal(more.next.seq, 2);
});

test("游标拉取：since 之后的消息才下发", () => {
  const now = "2026-09-30T00:00:00.000Z";
  const built = appendMessages(
    appendMessages(null, "c", [{ id: "m1", role: "user", content: "一" }], now).next,
    "c",
    [
      { id: "m2", role: "assistant", content: "二" },
      { id: "m3", role: "user", content: "三" },
    ],
    now,
  ).next;
  assert.equal(messagesSince(built, "c").messages.length, 3);
  assert.deepEqual(
    messagesSince(built, "c", 1).messages.map((message) => message.id),
    ["m2", "m3"],
  );
  assert.deepEqual(
    messagesSince(built, "c", 3).messages.map((message) => message.id),
    [],
  );
  assert.equal(messagesSince(built, "c", 1).seq, 3);
  assert.deepEqual(messagesSince(emptyConversation("c"), "c", 5).messages, []);
});

test("SSE 解析与消息拼装：正文 + 工具调用 + 工具结果", () => {
  const raw = [
    'event: message\ndata: {"type":"RUN_STARTED"}',
    'data: {"type":"TEXT_MESSAGE_START","messageId":"a1","role":"assistant"}',
    'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"a1","delta":"我先查"}',
    'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolCallName":"search_web","parentMessageId":"a1"}',
    'data: {"type":"TOOL_CALL_ARGS","toolCallId":"t1","delta":"{\\"query\\":\\"东京水族馆\\"}"}',
    'data: {"type":"TOOL_CALL_END","toolCallId":"t1"}',
    'data: {"type":"TOOL_CALL_RESULT","messageId":"r1","toolCallId":"t1","content":"{\\"results\\":[]}"}',
    'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"a1","delta":"，查到了"}',
    "data: [DONE]",
    ": 注释行",
    'data: {"type":"RUN_ERROR","message":"模型网关暂时过载"}',
  ].join("\n");
  const events = parseSseChunk(raw);
  assert.equal(events.length, 9);
  const messages = assembleTurnMessages(events, "2026-09-30T00:00:00.000Z");
  assert.equal(messages.length, 2);
  const [assistant, tool] = messages;
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, "我先查，查到了");
  const calls = assistant.toolCalls as {
    id: string;
    function: { name: string; arguments: string };
  }[];
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "t1");
  assert.equal(calls[0].function.name, "search_web");
  assert.equal(calls[0].function.arguments, '{"query":"东京水族馆"}');
  assert.equal(tool.role, "tool");
  assert.equal(tool.toolCallId, "t1");
  assert.deepEqual(turnOutcome(events), { status: "failed", error: "模型网关暂时过载" });
});

test("没有正文也没有工具调用的空消息不落库", () => {
  const events: AgUiLikeEvent[] = [
    { type: "TEXT_MESSAGE_START", messageId: "a1" },
    { type: "TEXT_MESSAGE_END", messageId: "a1" },
  ];
  assert.deepEqual(assembleTurnMessages(events, "2026-09-30T00:00:00.000Z"), []);
});

test("服务端接口：追加是幂等的，且能按游标只取增量", async () => {
  const threadId = "dddd4444-eeee-4fff-8000-111122223333";
  const first = await (
    await app.request(`/api/conversation?threadId=${threadId}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        messages: [
          { id: "u1", role: "user", content: "东京水族馆门票多少钱" },
          { id: "u1", role: "user", content: "重复投递" },
        ],
      }),
    })
  ).json();
  assert.equal(first.seq, 1, "重复 id 只算一条");
  assert.equal(first.added, 1);

  // 模拟客户端断线后重发（at-least-once）：不新增
  const retry = await (
    await app.request(`/api/conversation?threadId=${threadId}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        messages: [{ id: "u1", role: "user", content: "东京水族馆门票多少钱" }],
      }),
    })
  ).json();
  assert.equal(retry.added, 0);
  assert.equal(retry.seq, 1);

  // 服务端自己写入的回复（tee 那一支做的事）
  await app.request(`/api/conversation?threadId=${threadId}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ messages: [{ id: "a1", role: "assistant", content: "大约 700 日元" }] }),
  });
  const all = await (
    await app.request(`/api/conversation?threadId=${threadId}`, { headers: headers() })
  ).json();
  assert.equal(all.messages.length, 2);
  assert.equal(all.seq, 2);

  const incremental = await (
    await app.request(`/api/conversation?threadId=${threadId}&since=1`, { headers: headers() })
  ).json();
  assert.deepEqual(
    incremental.messages.map((message: { id: string }) => message.id),
    ["a1"],
  );
  assert.equal(incremental.seq, 2);
});

test("重开 App 后能从游标处拿到断线期间的回复与轮次状态", async () => {
  const threadId = "eeee5555-ffff-4000-8111-222233334444";
  await db.put("local-user", "conversations", {
    id: threadId,
    seq: 2,
    messages: [
      { id: "q1", role: "user", content: "帮我查水族馆", seq: 1, at: "2026-09-30T00:00:00.000Z" },
      {
        id: "a1",
        role: "assistant",
        content: "水族馆在品川",
        seq: 2,
        at: "2026-09-30T00:00:05.000Z",
      },
    ],
  });
  await db.put("local-user", "turns", {
    ...newTurn("run-1", threadId, "2026-09-30T00:00:01.000Z"),
    status: "succeeded",
    finishedAt: "2026-09-30T00:00:05.000Z",
  });
  const response = await (
    await app.request(`/api/conversation?threadId=${threadId}&since=1`, { headers: headers() })
  ).json();
  assert.deepEqual(
    response.messages.map((message: { id: string }) => message.id),
    ["a1"],
    "断线期间写完的回复要在增量里",
  );
  assert.equal(response.turn.status, "succeeded");
  assert.equal(response.turn.id, "run-1");
});

test("卡住的一轮会被看门狗判为中断，不会让 App 一直等", async () => {
  const threadId = "ffff6666-0000-4111-8222-333344445555";
  await db.put("local-user", "turns", {
    ...newTurn("run-stuck", threadId, new Date(Date.now() - 6 * 60_000).toISOString()),
  });
  const response = await (
    await app.request(`/api/conversation?threadId=${threadId}`, { headers: headers() })
  ).json();
  assert.equal(response.turn.status, "interrupted");
  assert.match(response.turn.error, /太久没有结果/);
});
