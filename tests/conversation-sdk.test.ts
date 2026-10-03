import assert from "node:assert/strict";
import { test } from "node:test";
import { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCore } from "@copilotkit/core";
import { throwError } from "rxjs";
import {
  ConversationQueue,
  type QueuedMessage,
  type QueueStorage,
  RESEND_DELAYS,
} from "../apps/mobile/src/conversation-queue.ts";
import { runConversationTurn } from "../apps/mobile/src/conversation-run.ts";

/**
 * 可注入的假时钟：让泵的退避定时器可手动到点，测试不会挂着真实 setTimeout 不退出。
 */
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

function memoryStorage(): QueueStorage & { saved: QueuedMessage[][] } {
  let current: QueuedMessage[] = [];
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

test("an emitted CopilotKit run error folds into backoff retries and never pauses the queue", async () => {
  let attempts = 0;
  class FailingAgent extends AbstractAgent {
    run() {
      attempts++;
      return throwError(() => new Error("Connection interrupted"));
    }
  }
  const agent = new FailingAgent({ agentId: "default" });
  const core = new CopilotKitCore({ agents__unsafe_dev_only: { default: agent } });
  const fake = fakeClock();
  const storage = memoryStorage();
  const queue = new ConversationQueue(storage, fake.clock);
  queue.enqueue({ id: "first", text: "First task" });
  queue.enqueue({ id: "second", text: "Second task" });
  const send = (message: QueuedMessage) =>
    runConversationTurn(
      "default",
      () => core.runAgent({ agent }),
      (onError) => core.subscribe({ onError }),
    );
  // 失败被泵折算成退避重试：flush 不再 reject、队列不再暂停（无感发送的新契约）
  await queue.flush(send);
  assert.equal(attempts, 1);
  assert.equal(queue.getSnapshot().paused, false);
  const first = queue.getSnapshot().pending.find((message) => message.id === "first");
  assert.equal(first?.attempts, 1);
  assert.equal(first?.sending, false);
  assert.deepEqual(
    queue.getSnapshot().pending.map((message) => message.id),
    ["first", "second"],
  );
  assert.deepEqual(
    storage.saved.at(-1)?.map((message) => message.id),
    ["first", "second"],
  );
  assert.equal(fake.scheduledMs.at(-1), RESEND_DELAYS[0], "第一次失败按 1s 退避");
  // 幂等要点（本测试只到队列层）：重试到达时，泵按 nextAt 自动再投递
  fake.advance(RESEND_DELAYS[0]);
  await queue.flush(send);
  assert.equal(attempts, 2, "到点自动重试");
});
