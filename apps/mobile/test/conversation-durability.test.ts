import assert from "node:assert/strict";
import { test } from "node:test";
import { acknowledgedIds, mergeConversation } from "../src/conversation-merge";
import { ConversationQueue, type QueuedMessage } from "../src/conversation-queue";

function memoryStorage(initial: QueuedMessage[] = []) {
  let stored = [...initial];
  return {
    get stored() {
      return stored;
    },
    load: async () => [...stored],
    save: async (messages: readonly QueuedMessage[]) => {
      stored = [...messages];
    },
  };
}

test("合并：服务端顺序为准，本地多出来的接在后面，按 id 去重", () => {
  const local = [
    { id: "m2", role: "assistant", content: "本地版本" },
    { id: "m4", role: "user", content: "刚发的" },
  ];
  const incoming = [
    { id: "m1", role: "user", content: "你好" },
    { id: "m2", role: "assistant", content: "服务端版本" },
    { id: "m3", role: "assistant", content: "断线期间写完的回复" },
  ];
  const merged = mergeConversation(local, incoming);
  assert.deepEqual(
    merged.map((message) => message.id),
    ["m1", "m2", "m3", "m4"],
  );
  assert.equal(merged[1].content, "服务端版本", "同一个 id 以服务端为准");
  assert.deepEqual([...acknowledgedIds(incoming)], ["m1", "m2", "m3"]);
});

test("待发消息落盘：重启后队列里还在，服务端确认后才清账", async () => {
  const storage = memoryStorage();
  const first = new ConversationQueue(storage);
  first.enqueue({ id: "u1", text: "东京水族馆门票多少" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    storage.stored.map((message) => message.id),
    ["u1"],
  );

  // 模拟杀进程后重启：新队列实例从同一份存储恢复
  const restarted = new ConversationQueue(storage);
  await restarted.restore();
  assert.deepEqual(
    restarted.getSnapshot().pending.map((message) => message.id),
    ["u1"],
  );

  // 服务端确认（游标里出现了这条 id）→ 清账 → 落盘也空了
  for (const id of acknowledgedIds([{ id: "u1", role: "user", content: "东京水族馆门票多少" }]))
    restarted.remove(id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(restarted.getSnapshot().pending, []);
  const afterAck = new ConversationQueue(storage);
  await afterAck.restore();
  assert.deepEqual(afterAck.getSnapshot().pending, []);
});

test("恢复不会把队列里已有的消息复制一遍", async () => {
  const storage = memoryStorage([{ id: "u1", text: "一" }]);
  const queue = new ConversationQueue(storage);
  queue.enqueue({ id: "u1", text: "一" });
  await queue.restore();
  assert.equal(queue.getSnapshot().pending.length, 1);
});
