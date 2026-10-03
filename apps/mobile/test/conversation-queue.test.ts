import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUSY_RETRY_MS,
  ConversationQueue,
  QueueBusyError,
  type QueuedMessage,
  type QueueStorage,
  RESEND_DELAYS,
  STUCK_AFTER_ATTEMPTS,
} from "../src/conversation-queue.ts";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 可注入的假时钟：记录每次实际调度的退避毫秒，由测试手动"到点"。 */
function fakeClock() {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void }[] = [];
  const scheduledMs: number[] = [];
  const schedule = (fn: () => void, ms: number) => {
    scheduledMs.push(ms);
    timers.push({ at: now + ms, fn });
    return () => {
      timers = timers.filter((timer) => timer.fn !== fn);
    };
  };
  return {
    clock: { now: () => now, schedule },
    scheduledMs,
    advance(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.fn();
    },
  };
}

function memoryStorage(initial: QueuedMessage[] = []): QueueStorage & { saved: QueuedMessage[][] } {
  let current: QueuedMessage[] = [...initial];
  const saved: QueuedMessage[][] = [];
  return {
    load: async () => [...current],
    save: async (messages) => {
      current = [...messages];
      saved.push([...messages]);
    },
    saved,
  };
}

test("follow-ups sent during a reply run once, in order; 泵忙时 flush 立即返回不叠加等待", async () => {
  const queue = new ConversationQueue();
  const gate = deferred();
  const received: string[] = [];
  queue.enqueue({ id: "1", text: "First" });
  const send = async ({ id }: { id: string }) => {
    received.push(id);
    if (id === "1") await gate.promise;
  };
  const running = queue.flush(send);
  queue.enqueue({ id: "2", text: "Second" });
  queue.enqueue({ id: "3", text: "Third" });
  // 泵正被 1 占着：这次 flush 只注册通道、不会重复投递（fire-and-forget，不等在跑的那轮）
  void queue.flush(send);
  assert.deepEqual(received, ["1"]);
  queue.remove("2");
  gate.resolve();
  await running;
  assert.deepEqual(received, ["1", "3"]);
  assert.equal(queue.getSnapshot().running, false);
});

test("失败不是终局：不暂停、不抛错、不弹终态，退避到点自动重试成功", async () => {
  const fake = fakeClock();
  const queue = new ConversationQueue(undefined, fake.clock);
  queue.enqueue({ id: "1", text: "First" });
  queue.enqueue({ id: "2", text: "Second" });
  let failures = 0;
  const flaky = async ({ id }: { id: string }) => {
    if (id === "1" && failures < 1) {
      failures += 1;
      throw new Error("Connection lost");
    }
  };
  await queue.flush(flaky);
  // 第一次尝试失败：不抛错、不暂停；attempts=1、按 1s 退避
  assert.equal(failures, 1);
  assert.equal(queue.getSnapshot().paused, false, "失败不再把队列打成暂停");
  const entry = queue.getSnapshot().pending.find((m) => m.id === "1");
  assert.equal(entry?.attempts, 1);
  assert.equal(entry?.sending, false);
  assert.deepEqual(fake.scheduledMs, [RESEND_DELAYS[0]]);

  // 退避到点 → 自动重试成功 → 队列继续把剩下的排空（下一条跟着投递）
  fake.advance(RESEND_DELAYS[0]);
  await queue.flush(flaky);
  assert.deepEqual(
    queue.getSnapshot().pending.map((m) => m.id),
    [],
    "重试成功后整条队列排空",
  );
  assert.deepEqual(failures, 1, "只有第一条失败过一次");
  await queue.flush(flaky);
  assert.equal(queue.getSnapshot().pending.length, 0);
});

test("退避节奏就是 TG 那套：1s→2s→5s→15s→60s→5min，之后封顶 5min；达到阈值算「卡住」", async () => {
  const fake = fakeClock();
  const queue = new ConversationQueue(undefined, fake.clock);
  queue.enqueue({ id: "1", text: "First" });
  const fail = async () => {
    throw new Error("still down");
  };
  for (let attempt = 1; attempt <= RESEND_DELAYS.length; attempt += 1) {
    await queue.flush(fail);
    assert.equal(queue.getSnapshot().pending[0].attempts, attempt);
    // 到点触发自动重试（仍旧失败），并等这一轮泵安静下来
    fake.advance(RESEND_DELAYS[attempt - 1]);
    await queue.flush(fail);
    assert.equal(
      queue.getSnapshot().pending[0].attempts,
      attempt + 1,
      "到点的自动重试已发生并计次",
    );
  }
  assert.deepEqual(
    fake.scheduledMs.slice(0, RESEND_DELAYS.length),
    [1000, 2000, 5000, 15000, 60000, 300000],
  );
  // 表走完之后一直 5min（封顶），且 attempts 达到「卡住」阈值
  for (let extra = 0; extra < 2; extra += 1) {
    fake.advance(RESEND_DELAYS[RESEND_DELAYS.length - 1]);
    await queue.flush(fail);
  }
  assert.ok(
    fake.scheduledMs.slice(RESEND_DELAYS.length).every((ms) => ms === 300000),
    "封顶 5min",
  );
  const stuck = queue.getSnapshot().pending[0];
  assert.ok(stuck, "失败的消息还在队里");
  assert.ok(
    stuck.attempts !== undefined && stuck.attempts >= STUCK_AFTER_ATTEMPTS,
    "UI 据此显示重发图标",
  );
});

test("点按重发：resendNow 清零失败计数、不等退避立刻再试", async () => {
  const fake = fakeClock();
  const queue = new ConversationQueue(undefined, fake.clock);
  queue.enqueue({ id: "1", text: "First" });
  let failures = 0;
  const received: string[] = [];
  const flaky = async ({ id }: { id: string }) => {
    if (failures < 1) {
      failures += 1;
      throw new Error("down");
    }
    received.push(id);
  };
  await queue.flush(flaky);
  assert.equal(queue.getSnapshot().pending[0].attempts, 1);
  queue.resendNow("1");
  await queue.flush(flaky);
  assert.deepEqual(received, ["1"], "不等退避到点，立即重发成功");
  assert.equal(queue.getSnapshot().pending.length, 0);
});

test("通道忙（QueueBusyError）不算失败：attempts 不增，只让位 1.5s 再试", async () => {
  const fake = fakeClock();
  const queue = new ConversationQueue(undefined, fake.clock);
  queue.enqueue({ id: "1", text: "First" });
  await queue.flush(async () => {
    throw new QueueBusyError();
  });
  const entry = queue.getSnapshot().pending[0];
  assert.equal(entry.attempts ?? 0, 0, "忙不算失败");
  assert.equal(entry.sending, false);
  assert.deepEqual(fake.scheduledMs, [BUSY_RETRY_MS]);
  // 换成功通道，让位期到点后自动送达
  const received: string[] = [];
  const succeed = async ({ id }: { id: string }) => {
    received.push(id);
  };
  await queue.flush(succeed);
  fake.advance(BUSY_RETRY_MS);
  await queue.flush(succeed);
  assert.deepEqual(received, ["1"]);
});

test("冷启动恢复：杀进程后重开，outbox 里的未送达消息继续送（含失败计数），送达后落盘清空", async () => {
  const fake = fakeClock();
  const storage = memoryStorage();
  // 第一次会话：写了一条进 outbox，且已经失败过一次（attempts/nextAt 持久化）
  const first = new ConversationQueue(storage, fake.clock);
  first.enqueue({ id: "u1", text: "断网前发的" });
  await first.flush(async () => {
    throw new Error("down");
  });
  assert.equal(storage.saved.at(-1)?.length, 1);
  assert.equal(storage.saved.at(-1)?.[0].attempts, 1);

  // 模拟杀进程：直接丢弃 first，从同一份存储恢复出新队列（同一时钟：真实场景里时间只会更晚）
  const second = new ConversationQueue(storage, fake.clock);
  await second.restore();
  assert.deepEqual(
    second.getSnapshot().pending.map((m) => ({
      id: m.id,
      attempts: m.attempts,
      sending: m.sending,
    })),
    [{ id: "u1", attempts: 1, sending: false }],
    "恢复后 sending 复位（上次可能死在发送途中），失败计数保留",
  );
  const received: string[] = [];
  await second.flush(async ({ id }) => {
    received.push(id);
  });
  fake.advance(RESEND_DELAYS[0]);
  await second.flush(async ({ id }) => {
    received.push(id);
  });
  assert.deepEqual(received, ["u1"], "冷启动后继续送");
  assert.equal(storage.saved.at(-1)?.length, 0, "送达后 outbox 落盘清空（ACK）");
});

test("restore 不重复恢复同一条（快照里已有的跳过）", async () => {
  const storage = memoryStorage([{ id: "u1", text: "已恢复过" }]);
  const queue = new ConversationQueue(storage);
  queue.enqueue({ id: "u1", text: "内存里已有" });
  await queue.restore();
  assert.equal(queue.getSnapshot().pending.length, 1);
});

test("暂停后泵不动；resume 继续投递（stop 语义保持）", async () => {
  const queue = new ConversationQueue();
  queue.enqueue({ id: "1", text: "First" });
  queue.pause();
  const received: string[] = [];
  await queue.flush(async ({ id }) => {
    received.push(id);
  });
  assert.equal(received.length, 0, "暂停期间不投递");
  queue.resume();
  await queue.flush(async ({ id }) => {
    received.push(id);
  });
  assert.deepEqual(received, ["1"]);
});
