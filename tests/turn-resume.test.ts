import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideResume,
  MAX_RESUME_ATTEMPTS,
  MIN_RESUME_INTERVAL_MS,
  resetResumeState,
  resumeTurn,
  scanUnfinishedTurns,
  selfBaseUrl,
  toAgUiMessages,
  unansweredUserMessage,
  type ResumeDeps,
} from "../apps/server/src/engine/turn-resume.ts";

// ---------------------------------------------------------------- 纯函数

test("unansweredUserMessage：最后一条用户消息之后有没有助手回复", () => {
  assert.equal(unansweredUserMessage([{ role: "user" }, { role: "assistant" }]), false);
  assert.equal(unansweredUserMessage([{ role: "assistant" }, { role: "user" }]), true);
  // 工具消息不算"回答"
  assert.equal(
    unansweredUserMessage([{ role: "user" }, { role: "tool" }, { role: "tool" }]),
    true,
  );
  // 空会话：没有用户消息就谈不上"没被回答"
  assert.equal(unansweredUserMessage([]), false);
  assert.equal(unansweredUserMessage([{ role: "assistant" }]), false);
});

test("decideResume：失败/中断且用户消息没被回答 → 该续", () => {
  const now = Date.now();
  for (const status of ["failed", "interrupted"]) {
    const decision = decideResume({ turn: { id: "t", threadId: "x", status }, unanswered: true, now });
    assert.equal(decision.resume, true, `${status} 应当续跑`);
  }
});

test("decideResume：正常结束、正在跑、有回复、超次数、太密集 —— 都不动", () => {
  const now = Date.now();
  const base = { id: "t", threadId: "x" };

  assert.equal(
    decideResume({ turn: { ...base, status: "succeeded" }, unanswered: true, now }).resume,
    false,
    "成功的一轮不能重跑（会重复回答）",
  );
  assert.equal(
    decideResume({ turn: { ...base, status: "running" }, unanswered: true, now }).resume,
    false,
    "还在跑的一轮不能插一脚",
  );
  assert.equal(
    decideResume({ turn: { ...base, status: "failed" }, unanswered: false, now }).resume,
    false,
    "已经有回复了就别补",
  );
  assert.equal(decideResume({ turn: null, unanswered: true, now }).resume, false);
  assert.equal(
    decideResume({
      turn: { ...base, status: "failed", resumeCount: MAX_RESUME_ATTEMPTS },
      unanswered: true,
      now,
    }).resume,
    false,
    "到上限就放弃，避免坏配置无限重跑",
  );
  assert.equal(
    decideResume({
      turn: { ...base, status: "failed", resumeCount: 1, lastResumeAt: now - 1000 },
      unanswered: true,
      now,
    }).resume,
    false,
    "刚续过就别马上再续",
  );
  assert.equal(
    decideResume({
      turn: { ...base, status: "failed", resumeCount: 1, lastResumeAt: now - MIN_RESUME_INTERVAL_MS - 1 },
      unanswered: true,
      now,
    }).resume,
    true,
    "过了间隔就可以再试一次",
  );
});

test("toAgUiMessages：只留 user/assistant 的文本，工具消息与空内容丢掉", () => {
  const mapped = toAgUiMessages([
    { id: "u1", role: "user", content: "你好" },
    { id: "a1", role: "assistant", content: "在的" },
    { id: "t1", role: "tool", content: "{}", toolCallId: "c1" },
    { id: "a2", role: "assistant", content: "   " },
    { role: "user", content: "还在吗" },
  ]);
  assert.deepEqual(mapped, [
    { id: "u1", role: "user", content: "你好" },
    { id: "a1", role: "assistant", content: "在的" },
    // 没 id 的用原数组下标兜底，保证唯一且稳定
    { id: "resume-4", role: "user", content: "还在吗" },
  ]);
});

test("selfBaseUrl：通配监听要换成回环，否则连不上自己", () => {
  assert.equal(selfBaseUrl({ host: "0.0.0.0", port: 8787 }), "http://127.0.0.1:8787");
  assert.equal(selfBaseUrl({ host: "::", port: 8787 }), "http://127.0.0.1:8787");
  assert.equal(selfBaseUrl({ host: "10.7.0.6", port: 8787 }), "http://10.7.0.6:8787");
});

// ---------------------------------------------------------------- 巡检

interface Harness {
  deps: ResumeDeps;
  posts: { url: string; body: Record<string, unknown> }[];
  rows: Map<string, Record<string, unknown>>;
}

function harness(options: { status?: string; messages?: Record<string, unknown>[]; turn?: Record<string, unknown>; postStatus?: number; postThrows?: boolean } = {}): Harness {
  const rows = new Map<string, Record<string, unknown>>();
  rows.set("turns/t1", {
    id: "t1",
    threadId: "thread-1",
    status: options.status ?? "failed",
    startedAt: "2026-10-14T12:00:00.000Z",
    ...options.turn,
  });
  rows.set("conversations/thread-1", {
    id: "thread-1",
    seq: 2,
    messages: options.messages ?? [
      { id: "u1", role: "user", content: "帮我查一下东京水族馆门票" },
    ],
  });

  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const deps: ResumeDeps = {
    store: {
      async scan<T>() {
        return [...rows.entries()]
          .filter(([key]) => key.startsWith("turns/"))
          .map(([, value]) => ({ owner: "local-user", value: value as T }));
      },
      async get<T>(_owner: string, kind: string, id: string) {
        return (rows.get(`${kind}/${id}`) as T | undefined) ?? null;
      },
      async put<T extends { id: string }>(_owner: string, kind: string, value: T) {
        rows.set(`${kind}/${value.id}`, value as unknown as Record<string, unknown>);
        return value;
      },
    },
    auth: { async session() { return { token: "self-token" }; } },
    config: { mode: "live", accessKey: "x".repeat(32), host: "10.7.0.6", port: 8787 },
    async post(url: string, init: { body: string }) {
      posts.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      if (options.postThrows) throw new Error("连接失败");
      return new Response("data: {}\n\n", { status: options.postStatus ?? 200 });
    },
  };
  return { deps, posts, rows };
}

test("巡检：用户消息没被回答 + turn 失败 → 服务端自己补跑，并记下次数", async () => {
  resetResumeState();
  const h = harness();
  const result = await scanUnfinishedTurns(h.deps, Date.now());

  assert.equal(result.resumed.length, 1);
  assert.equal(h.posts.length, 1, "应当向自己发一次 run");
  assert.match(h.posts[0]!.url, /\/api\/copilotkit\/agent\/default\/run$/);
  const body = h.posts[0]!.body as { threadId: string; messages: { role: string; content: string }[] };
  assert.equal(body.threadId, "thread-1");
  assert.equal(body.messages.at(-1)?.content, "帮我查一下东京水族馆门票");

  const turn = h.rows.get("turns/t1")!;
  assert.equal(turn.resumeCount, 1, "次数要落盘 —— 否则进程重启后会无限重跑");
  assert.equal(typeof turn.lastResumeAt, "number");
});

test("巡检：已经有回复 / 正常结束 / 到上限 —— 都不发请求", async () => {
  resetResumeState();
  const answered = harness({
    status: "failed",
    messages: [{ role: "user", content: "问" }, { role: "assistant", content: "答" }],
  });
  await scanUnfinishedTurns(answered.deps, Date.now());
  assert.equal(answered.posts.length, 0, "有回复就不该补");

  resetResumeState();
  const succeeded = harness({ status: "succeeded" });
  await scanUnfinishedTurns(succeeded.deps, Date.now());
  assert.equal(succeeded.posts.length, 0, "成功的一轮绝不能重跑");

  resetResumeState();
  const exhausted = harness({ status: "failed", turn: { resumeCount: MAX_RESUME_ATTEMPTS } });
  await scanUnfinishedTurns(exhausted.deps, Date.now());
  assert.equal(exhausted.posts.length, 0, "到上限就停手");
});

test("巡检：投递失败时如实返回，不假装成功", async () => {
  resetResumeState();
  const h = harness({ postThrows: true });
  const result = await scanUnfinishedTurns(h.deps, Date.now());
  assert.equal(result.resumed.length, 0);
  assert.ok(result.skipped.some((item) => item.reason.includes("未能受理")));
});

test("resumeTurn：401 时清掉令牌缓存，下一轮重新取（令牌过期要能自愈）", async () => {
  resetResumeState();
  let calls = 0;
  const deps: ResumeDeps = {
    store: harness().deps.store,
    auth: { async session() { calls += 1; return { token: `t${calls}` }; } },
    config: { mode: "live", accessKey: "x".repeat(32), host: "10.7.0.6", port: 8787 },
    async post() {
      return new Response("nope", { status: 401 });
    },
  };
  assert.equal(await resumeTurn(deps, "local-user", "thread-1", []), false);
  await resumeTurn(deps, "local-user", "thread-1", []);
  assert.equal(calls, 2, "第一次 401 后应当重新取令牌，而不是一直用死令牌");
});
