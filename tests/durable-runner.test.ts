import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { Observable, of } from "rxjs";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { DurableAgentRunner } from "../apps/server/src/engine/durable-runner.ts";

let db: Store, directory: string, runner: DurableAgentRunner;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-runner-"));
  db = await createStore({ dataDir: directory });
  runner = new DurableAgentRunner(db);
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

const request = (threadId: string, messageId: string) =>
  ({
    threadId,
    agent: {} as never,
    input: { messages: [{ id: messageId, role: "user", content: "在吗" }] },
  }) as never;

/** 收集 observable 的事件（测试里只关心"跑没跑"与"有没有报错"）。 */
function collect(observable: Observable<unknown>) {
  return new Promise<{ events: unknown[]; error?: Error }>((resolve) => {
    const events: unknown[] = [];
    observable.subscribe({
      next: (event) => events.push(event),
      error: (error: Error) => resolve({ events, error }),
      complete: () => resolve({ events }),
    });
  });
}

test("同一轮被重复投递时只跑一次（客户端超时重发不该白跑第二遍）", async (t) => {
  let calls = 0;
  t.mock.method(InMemoryAgentRunner.prototype, "run", () => {
    calls += 1;
    // 模拟"跑得比较慢"，好让第二次投递落在它还没结束的时候
    const done = new Promise((resolve) => setTimeout(resolve, 120));
    return new Observable((subscriber) => {
      void done.then(() => {
        subscriber.next({ type: "RUN_FINISHED" });
        subscriber.complete();
      });
    });
  });
  const [first, second] = await Promise.all([
    collect(runner.run(request("t1", "m1"))),
    collect(runner.run(request("t1", "m1"))),
  ]);
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.equal(calls, 1, "重复投递不应该再跑一遍");
  assert.equal(second.events.length, 0, "重复的那次不发事件，回复由游标补拉送达");
});

test("同一会话的另一轮会排队等前面跑完，而不是报 Thread already running", async (t) => {
  const order: string[] = [];
  t.mock.method(
    InMemoryAgentRunner.prototype,
    "run",
    (input: { input?: { messages?: { id?: string }[] } }) => {
      const id = input?.input?.messages?.[0]?.id ?? "?";
      order.push(`start:${id}`);
      return new Observable((subscriber) => {
        setTimeout(() => {
          order.push(`end:${id}`);
          subscriber.next({ type: "RUN_FINISHED" });
          subscriber.complete();
        }, 60);
      });
    },
  );
  const [first, second] = await Promise.all([
    collect(runner.run(request("t2", "m1"))),
    collect(runner.run(request("t2", "m2"))),
  ]);
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.deepEqual(order, ["start:m1", "end:m1", "start:m2", "end:m2"], "第二轮要等第一轮结束");
});

test("内存 runner 报 already running 时会自动重试，不把这一轮丢掉", async (t) => {
  let attempts = 0;
  t.mock.method(InMemoryAgentRunner.prototype, "run", () => {
    attempts += 1;
    if (attempts === 1)
      return new Observable((subscriber) => subscriber.error(new Error("Thread already running")));
    return of({ type: "RUN_FINISHED" });
  });
  const result = await collect(runner.run(request("t3", "m1")));
  assert.equal(result.error, undefined, "重试后应该正常完成");
  assert.equal(attempts, 2);
});
