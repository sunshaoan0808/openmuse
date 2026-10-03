import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import {
  appendMessages,
  emptyConversation,
  messagesSince,
  noteReactionUsage,
  orderReactionsByUsage,
  toggleReaction,
  unsendMessage,
} from "../apps/server/src/chat-turns.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store, app: Awaited<ReturnType<typeof createApp>>["app"], token: string, directory: string;
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-conversation-actions-"));
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

test("撤回纯函数：移除消息、写墓碑、幂等、重试补发不复活", () => {
  const now = "2026-10-03T00:00:00.000Z";
  const seeded = appendMessages(
    null,
    "c",
    [
      { id: "u1", role: "user", content: "帮我看看" },
      { id: "a1", role: "assistant", content: "好的" },
    ],
    now,
  ).next;
  const removed = unsendMessage(seeded, "c", "u1", now);
  assert.equal(removed.removed, true);
  assert.deepEqual(
    removed.next.messages.map((m) => m.id),
    ["a1"],
  );
  assert.deepEqual(
    removed.next.tombstones?.map((t) => t.id),
    ["u1"],
  );

  // 重复撤回：幂等，不再记一条墓碑
  const again = unsendMessage(removed.next, "c", "u1", now);
  assert.equal(again.removed, false);
  assert.equal(again.next.tombstones?.length, 1);

  // 原消息的重试补发（至少一次投递）不能让已撤回的消息复活
  const resurrect = appendMessages(
    removed.next,
    "c",
    [{ id: "u1", role: "user", content: "帮我看看" }],
    now,
  );
  assert.equal(resurrect.added.length, 0);
  assert.deepEqual(
    resurrect.next.messages.map((m) => m.id),
    ["a1"],
  );

  // 撤回不存在的消息：不动状态
  const missing = unsendMessage(seeded, "c", "nope", now);
  assert.equal(missing.removed, false);
});

test("反应纯函数：切换、seq 顶到最新、已撤回消息不可反应", () => {
  const now = "2026-10-03T00:00:00.000Z";
  const seeded = appendMessages(null, "c", [{ id: "u1", role: "user", content: "赞" }], now).next;
  const added = toggleReaction(seeded, "c", "u1", "👍", now);
  assert.deepEqual(added.updated?.reactions, ["👍"]);
  assert.equal(added.next.seq, seeded.seq + 1, "被改的消息要顶到最新，增量才能重投递");
  assert.equal(added.next.messages[0].seq, added.next.seq);
  const removedAgain = toggleReaction(added.next, "c", "u1", "👍", now);
  assert.deepEqual(removedAgain.updated?.reactions, []);
  const unknown = toggleReaction(seeded, "c", "ghost", "👍", now);
  assert.equal(unknown.updated, null);
});

test("反应面板顺序：用得多的在前，没用过的保持默认顺序", () => {
  const defaults = orderReactionsByUsage(undefined);
  assert.equal(defaults.length, 8, "固定表情集一个不少");
  const ordered = orderReactionsByUsage({ "🔥": 5, "👍": 3, "🙏": 1 });
  assert.deepEqual(ordered.slice(0, 3), ["🔥", "👍", "🙏"]);
  // 🔥 计数被清零后回到默认段的相对位置（不再霸占第一）
  assert.notEqual(orderReactionsByUsage({ "🔥": 0 })[0], "🔥");
});

test("使用频率计数：只增不减（历史用法决定面板排序）", () => {
  let counts = noteReactionUsage(undefined, "❤️", true);
  counts = noteReactionUsage(counts, "❤️", true);
  counts = noteReactionUsage(counts, "❤️", false); // 取消反应不算减频率
  assert.equal(counts["❤️"], 2);
});

test("服务端接口：撤回→拉取带墓碑→其它端能清掉本地副本；只能撤回自己的消息", async () => {
  const threadId = "aaaa1111-bbbb-4ccc-8ddd-222233334444";
  await app.request(`/api/conversation?threadId=${threadId}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      messages: [
        { id: "u1", role: "user", content: "这条要撤回" },
        { id: "a1", role: "assistant", content: "收到" },
      ],
    }),
  });
  // 撤回助手消息被拒
  const denied = await app.request(`/api/conversation?threadId=${threadId}&messageId=a1`, {
    method: "DELETE",
    headers: headers(),
  });
  assert.equal(denied.status, 422);

  const ok = await app.request(`/api/conversation?threadId=${threadId}&messageId=u1`, {
    method: "DELETE",
    headers: headers(),
  });
  assert.equal(ok.status, 200);

  // 全量拉取：消息没了，墓碑在
  const all = await (
    await app.request(`/api/conversation?threadId=${threadId}`, { headers: headers() })
  ).json();
  assert.deepEqual(
    all.messages.map((m: { id: string }) => m.id),
    ["a1"],
  );
  assert.deepEqual(all.tombstones, ["u1"]);

  // 增量拉取同样带墓碑（客户端只有增量时也要能清本地）
  const incremental = await (
    await app.request(`/api/conversation?threadId=${threadId}&since=99`, { headers: headers() })
  ).json();
  assert.deepEqual(incremental.messages, []);
  assert.deepEqual(incremental.tombstones, ["u1"]);

  // 幂等：再撤一次不 404 之外的新墓碑
  const repeat = await app.request(`/api/conversation?threadId=${threadId}&messageId=u1`, {
    method: "DELETE",
    headers: headers(),
  });
  assert.equal(repeat.status, 404, "已移除的消息再撤是「不在会话里」");
});

test("服务端接口：反应切换会随游标增量重投递，不支持的表情被拒", async () => {
  const threadId = "bbbb2222-cccc-4ddd-8eee-333344445555";
  await app.request(`/api/conversation?threadId=${threadId}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ messages: [{ id: "a1", role: "assistant", content: "一段回复" }] }),
  });
  const before = await (
    await app.request(`/api/conversation?threadId=${threadId}`, { headers: headers() })
  ).json();

  const toggle = await app.request(`/api/conversation/reactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ threadId, messageId: "a1", emoji: "🔥" }),
  });
  assert.equal(toggle.status, 200);

  // 游标没动的客户端：seq 变了，增量里带着带反应的消息
  const incremental = await (
    await app.request(`/api/conversation?threadId=${threadId}&since=${before.seq}`, {
      headers: headers(),
    })
  ).json();
  assert.equal(incremental.seq, before.seq + 1);
  assert.deepEqual(
    incremental.messages.map((m: { reactions?: string[] }) => m.reactions),
    [["🔥"]],
  );

  // 不支持的表情
  const rejected = await app.request(`/api/conversation/reactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ threadId, messageId: "a1", emoji: "🫠" }),
  });
  assert.equal(rejected.status, 422);

  // 不存在的消息（含已撤回的消息被移出数组后）不可反应
  const ghost = await app.request(`/api/conversation/reactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ threadId, messageId: "ghost", emoji: "👍" }),
  });
  assert.equal(ghost.status, 404);

  // 面板顺序接口
  const order = await (
    await app.request(`/api/conversation/reactions`, { headers: headers() })
  ).json();
  assert.ok(Array.isArray(order.emojis) && order.emojis.length === 8);
});

test("空会话的墓碑字段是空数组而不是缺省", () => {
  const since = messagesSince(emptyConversation("c"), "c");
  assert.deepEqual(since.tombstones, []);
});
