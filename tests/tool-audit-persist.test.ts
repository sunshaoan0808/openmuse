/**
 * 审计落库（P1a）的测试。
 *
 * 这一单要钉死的是三件事：
 *   1) 咽喉产出的每条审计事件真的落成了 Postgres 一行（放行 / 拒批 / 抛错三条路都落）；
 *   2) 落库失败**完全不影响**工具行为 —— 返回值是同一个对象、抛错是同一个 Error 实例；
 *   3) 查得回来，且 `threadId` 过滤 / `limit` 生效，不同会话互不串。
 *
 * 承重的是第 2 条：它是与 P0 同级的行为契约，用**同一性**（`===`）断言，
 * 不是等值 —— 「等值但换了对象」在生产里一样会炸（比如工具在返回值里挂了缓存/回调）。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { AUDIT_MAX_LIMIT, createStore, type Store } from "../apps/server/src/db.ts";
import { attachAuditStore } from "../apps/server/src/engine/audit-store.ts";
import {
  type AuditEvent,
  type AuditOutcome,
  auditEventId,
  flushAuditSink,
  runToolCall,
  setAuditSink,
  type ToolPolicy,
} from "../apps/server/src/engine/tool-executor.ts";

/** 安静点：这些用例要的是落库，不是控制台那行（那行另有源码级断言）。 */
const quiet = { denyList: [] as string[], audit: () => {} };

let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token: string;

/** 造一条手工审计行：id 前缀里的时间戳递增，插入顺序与时间序一致，排序断言才不飘。 */
let seq = 0;
function fakeAudit(patch: Partial<AuditEvent> & { threadId?: string | null }): AuditEvent {
  seq += 1;
  const stamp = `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `${stamp.replace(/[-:.TZ]/g, "")}-${seq.toString(16).padStart(8, "0")}`,
    at: stamp,
    tool: "noop",
    owner: "local-user",
    threadId: null,
    risk: "safe",
    outcome: "ok" as AuditOutcome,
    decision: "ok",
    target: null,
    egress: "none",
    egressTarget: null,
    summary: null,
    reason: null,
    durationMs: 1,
    args: null,
    result: null,
    ...patch,
  };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-audit-"));
  db = await createStore();
  attachAuditStore(db);
  // REST 用例要真起一个 app（走会话鉴权），跟库共用同一个 Store。
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
  setAuditSink(null);
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
afterEach(() => setAuditSink(null));

/** 咽喉是 fire-and-forget 落库（不拖累工具耗时），所以测试显式把在途的写盘等干净。 */
const settled = async () => {
  await flushAuditSink();
};

// ---------------------------------------------------------------------------
// 1) 三条路都落库，字段齐全
// ---------------------------------------------------------------------------

test("每次工具调用落一条审计：放行 / 拒批 / 抛错三条路都有，字段齐全", async () => {
  attachAuditStore(db);

  // 放行
  const ok: ToolPolicy = {
    name: "search_web",
    risk: "moderate",
    assess: () => ({ target: "example.com", summary: "读一页公开页面" }),
    execute: async () => ({ results: [{ title: "hi" }] }),
  };
  await runToolCall(ok, { q: "openmuse" }, { owner: "amy", threadId: "t-1" }, quiet);

  // 拒批（敏感能力 + 无审批入口）
  const blocked: ToolPolicy = {
    name: "send_payment",
    risk: "sensitive",
    assess: () => ({ target: "bank#9", summary: "转账" }),
    execute: async () => "paid",
  };
  await assert.rejects(() =>
    runToolCall(blocked, { amount: 10 }, { owner: "amy", threadId: "t-1" }, quiet),
  );

  // 工具自己抛错
  const boom = new Error("域名无法解析");
  const failing: ToolPolicy = {
    name: "browse_web",
    assess: () => ({ target: "nope.invalid", egress: "allow", egressTarget: "nope.invalid" }),
    execute: async () => {
      throw boom;
    },
  };
  await assert.rejects(() =>
    runToolCall(failing, {}, { owner: "amy", threadId: "t-1" }, quiet),
  );
  await settled();

  const rows = await db.listAudit("amy", { threadId: "t-1" });
  assert.equal(rows.length, 3, "三次调用应当各落一行");

  const outcomes = rows.map((row) => row.outcome).sort();
  assert.deepEqual(outcomes, ["blocked", "error", "ok"]);

  const okRow = rows.find((row) => row.tool === "search_web");
  assert.ok(okRow, "放行那次要有行");
  // §1.1 要求的字段一个都不能少
  for (const field of [
    "tool",
    "owner",
    "threadId",
    "risk",
    "outcome",
    "target",
    "egress",
    "durationMs",
  ])
    assert.ok(field in okRow, `审计行缺字段 ${field}`);
  assert.equal(okRow.owner, "amy");
  assert.equal(okRow.threadId, "t-1");
  assert.equal(okRow.risk, "moderate");
  assert.equal(okRow.outcome, "ok");
  assert.equal(okRow.target, "example.com");
  assert.equal(okRow.egress, "none");
  assert.equal(okRow.reason, null, "没被拦就没有 reason");
  assert.equal(typeof okRow.durationMs, "number");
  assert.ok(okRow.durationMs >= 0);
  assert.equal(okRow.summary, "读一页公开页面");
  assert.deepEqual(okRow.args, { q: "openmuse" });

  // id 时间有序、可读（`时间戳-随机短串`）
  assert.match(okRow.id, /^\d{17}-[0-9a-f]{8}$/, `id 形态不对：${okRow.id}`);
});

test("缺 owner 时用 local-user 占位（不落成空字符串）", async () => {
  attachAuditStore(db);
  await runToolCall({ name: "noop", execute: async () => 1 }, {}, {}, quiet);
  await settled();
  const rows = await db.listAudit("local-user");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner, "local-user");
  assert.equal(rows[0].threadId, null, "没有会话号就写 null，不写 '-'");
});

// ---------------------------------------------------------------------------
// 2) 被拦：outcome=blocked 且 reason 非空
// ---------------------------------------------------------------------------

test("被拦时 outcome=blocked 且 reason 非空（三种拦法都有）", async () => {
  attachAuditStore(db);

  // a) 静态 sensitive，无审批入口
  await assert.rejects(() =>
    runToolCall({ name: "wipe_disk", risk: "sensitive", execute: async () => "x" }, {}, {
      owner: "bob",
      threadId: "t-2",
    }, quiet),
  );
  // b) 结果要外流
  await assert.rejects(() =>
    runToolCall(
      {
        name: "publish",
        assess: () => ({ egress: "review", egressTarget: "example.com" }),
        execute: async () => "x",
      },
      {},
      { owner: "bob", threadId: "t-2" },
      quiet,
    ),
  );
  // c) 拒绝名单命中（连评估都不该有）
  await assert.rejects(() =>
    runToolCall({ name: "run_shell", execute: async () => "x" }, {}, { owner: "bob", threadId: "t-2" }, {
      denyList: ["run_shell"],
      audit: () => {},
    }),
  );
  // d) 评估自己坏了 → fail closed
  await assert.rejects(() =>
    runToolCall(
      {
        name: "read_private",
        assess: () => {
          throw new Error("策略服务不可用");
        },
        execute: async () => "x",
      },
      {},
      { owner: "bob", threadId: "t-2" },
      quiet,
    ),
  );
  await settled();

  const rows = await db.listAudit("bob", { threadId: "t-2" });
  assert.equal(rows.length, 4, "四种拦法都要落库");
  for (const row of rows) {
    assert.equal(row.outcome, "blocked", `${row.tool} 应当是 blocked`);
    assert.equal(typeof row.reason, "string");
    assert.ok(row.reason && row.reason.length > 0, `${row.tool} 的 reason 不能为空`);
  }
  const byTool = new Map(rows.map((row) => [row.tool, row]));
  assert.match(byTool.get("wipe_disk")?.reason ?? "", /敏感能力/);
  assert.match(byTool.get("publish")?.reason ?? "", /带出本机/);
  assert.match(byTool.get("run_shell")?.reason ?? "", /拒绝名单/);
  assert.match(byTool.get("read_private")?.reason ?? "", /评估失败/);
  // 细粒度判定也留着，排障时能区分「为什么没发」
  assert.deepEqual(
    rows.map((row) => row.decision).sort(),
    ["assess_failed", "denied", "refused", "refused"],
  );
});

// ---------------------------------------------------------------------------
// 3) 硬契约：落库失败不改工具行为（同一性断言）
// ---------------------------------------------------------------------------

test("sink 同步抛错：返回值是同一个对象，抛错是同一个 Error 实例", async () => {
  const raw = { results: [{ title: "hello" }] };
  const boom = new Error("创建账户需要同时提供 site（站点名）和 username（登录名）");

  // 同步抛错的 sink
  setAuditSink(() => {
    throw new Error("审计库连不上");
  });

  const okTool: ToolPolicy = { name: "browse_web", execute: async () => raw };
  const got = await runToolCall(okTool, {}, { owner: "amy" }, quiet);
  assert.equal(got, raw, "审计失败不许换掉返回对象");

  const failing: ToolPolicy = {
    name: "site_account",
    execute: async () => {
      throw boom;
    },
  };
  await assert.rejects(
    () => runToolCall(failing, {}, { owner: "amy" }, quiet),
    (error: unknown) => error === boom,
    "审计失败不许包装/替换工具自己的 Error 实例",
  );

  // 被拦也是同一个 Error 路径
  await assert.rejects(
    () => runToolCall({ name: "wipe", risk: "sensitive", execute: async () => "x" }, {}, {}, quiet),
    (error: Error) => /Do not retry the same call/.test(error.message),
  );
  await settled();
});

test("sink 异步 reject：同样不改变返回值 / 抛错实例 / 错误形状", async () => {
  const raw = { answer: "38 ℃" };
  const boom = new Error("连接超时");
  setAuditSink(async () => {
    await Promise.resolve();
    throw new Error("写库超时");
  });

  assert.equal(
    await runToolCall({ name: "weather", execute: async () => raw }, {}, { owner: "amy" }, quiet),
    raw,
  );
  await assert.rejects(
    () =>
      runToolCall(
        {
          name: "browse_web",
          execute: async () => {
            throw boom;
          },
        },
        {},
        { owner: "amy" },
        quiet,
      ),
    (error: unknown) => error === boom,
  );
  await settled();
});

test("落库失败只记一行日志，不抛到调用方（也不刷 console）", async () => {
  const seen: string[] = [];
  const realError = console.error;
  const realLog = console.log;
  console.error = (line: unknown) => void seen.push(String(line));
  console.log = () => {};
  try {
    setAuditSink(async () => {
      throw new Error("库炸了");
    });
    const raw = { ok: true };
    const got = await runToolCall({ name: "noop", execute: async () => raw }, {}, {}, quiet);
    assert.equal(got, raw);
    await settled();
  } finally {
    console.error = realError;
    console.log = realLog;
    setAuditSink(null);
  }
  const persisted = seen.filter((line) => line.startsWith("[audit-persist]"));
  assert.equal(persisted.length, 1, "失败只允许记一行");
  assert.match(persisted[0], /库炸了/);
});

test("没挂 sink 时工具照常执行（优雅降级：只有控制台那一行）", async () => {
  setAuditSink(null);
  const raw = { answer: "hi" };
  assert.equal(await runToolCall({ name: "noop", execute: async () => raw }, {}, {}, quiet), raw);
});

// ---------------------------------------------------------------------------
// 4) 查询：threadId 过滤、limit 生效、不同 thread 互不串
// ---------------------------------------------------------------------------

test("查询：threadId 过滤与 limit 生效，不同 thread / 不同 owner 互不串", async () => {
  const owner = "carol";
  for (let i = 0; i < 5; i++)
    await db.putAudit(fakeAudit({ owner, threadId: "thread-A", tool: `a${i}` }));
  for (let i = 0; i < 3; i++)
    await db.putAudit(fakeAudit({ owner, threadId: "thread-B", tool: `b${i}` }));
  await db.putAudit(fakeAudit({ owner: "dave", threadId: "thread-A", tool: "other-owner" }));

  const all = await db.listAudit(owner);
  assert.equal(all.length, 8, "不带过滤就是该 owner 的全部");

  const a = await db.listAudit(owner, { threadId: "thread-A" });
  assert.equal(a.length, 5);
  assert.ok(a.every((row) => row.threadId === "thread-A"), "thread-A 不许混进别的会话");
  assert.ok(a.every((row) => row.owner === owner), "别家 owner 的行不许出现");

  const b = await db.listAudit(owner, { threadId: "thread-B" });
  assert.equal(b.length, 3);
  assert.ok(b.every((row) => row.threadId === "thread-B"));

  // 过滤 + 限量同时生效
  const limited = await db.listAudit(owner, { threadId: "thread-A", limit: 2 });
  assert.equal(limited.length, 2, "limit 要真的限住");

  // 限量上限
  assert.equal((await db.listAudit(owner, { limit: 99999 })).length, 8);
  assert.ok(AUDIT_MAX_LIMIT >= 1);

  // 换个 owner 什么都看不到
  assert.equal((await db.listAudit("erin", { threadId: "thread-A" })).length, 0);

  // 最近的在前
  const newestFirst = await db.listAudit(owner, { threadId: "thread-B" });
  const times = newestFirst.map((row) => row.at);
  assert.deepEqual(times, [...times].sort().reverse(), "审计要倒序（最近的在前）");
});

test("查询结果里 reason 缺省就是 null，不是 undefined（调用方不用到处判空）", async () => {
  // 手工塞一条「老版本/异常写入」的残缺行：只有三个字段
  await db.put("frank", "audit", {
    id: "20260101000000001-0000aaaa",
    at: "2026-01-01T00:00:01.000Z",
    tool: "noop",
    owner: "frank",
  });
  const [row] = await db.listAudit("frank");
  assert.equal(row.reason, null);
  assert.equal(row.target, null);
  assert.equal(row.risk, "safe");
  assert.equal(row.outcome, "ok");
});

// ---------------------------------------------------------------------------
// 5) 脱敏：落库内容必须是脱敏后的
// ---------------------------------------------------------------------------

test("脱敏：评估要求 redact 时，落库内容里凭据字段已被抹掉", async () => {
  attachAuditStore(db);
  const secret = "sk-abcdefgh12345678";
  const tool: ToolPolicy = {
    name: "dump_account",
    assess: () => ({ redact: true, target: "acct#1" }),
    execute: async () => ({
      user: "amy",
      apiKey: secret,
      nested: { cookie: secret, title: "hi" },
      list: [secret],
    }),
  };
  await runToolCall(tool, { site: "x", password: secret }, { owner: "amy", threadId: "t-3" }, quiet);
  await settled();

  const [row] = await db.listAudit("amy", { threadId: "t-3" });
  const dumped = JSON.stringify(row);
  assert.ok(!dumped.includes(secret), "凭据不该出现在落库内容里");
  assert.equal((row.result as Record<string, unknown>).apiKey, "[REDACTED]");
  assert.equal((row.result as Record<string, unknown>).user, "amy", "普通字段原样");
  assert.equal(
    ((row.result as Record<string, unknown>).nested as Record<string, unknown>).cookie,
    "[REDACTED]",
  );
  assert.deepEqual((row.result as Record<string, unknown>).list, ["[REDACTED]"]);
  // 入参同样按评估结论打码
  assert.equal((row.args as Record<string, unknown>).password, "[REDACTED]");
  assert.equal((row.args as Record<string, unknown>).site, "x");

  // 审计行本身不含 [REDACTED] 之外的残留凭据
  assert.ok(!dumped.includes(secret));
});

test("脱敏不强制：没要求 redact 时，落库内容与工具返回一致", async () => {
  attachAuditStore(db);
  const raw = { results: [{ title: "hi" }] };
  const got = await runToolCall({ name: "search", execute: async () => raw }, { q: "x" }, {
    owner: "amy",
    threadId: "t-4",
  }, quiet);
  await settled();
  assert.equal(got, raw, "没要求 redact 时返回同一个对象");
  const [row] = await db.listAudit("amy", { threadId: "t-4" });
  assert.deepEqual(row.result, { results: [{ title: "hi" }] });
});

test("落库内容有界：深层嵌套只留规模，不把整页正文抄进审计表", async () => {
  attachAuditStore(db);
  const deep = { a: { b: { c: { d: { e: "不该整段进库" } } } } };
  await runToolCall({ name: "dig", execute: async () => deep }, {}, { owner: "amy", threadId: "t-7" }, quiet);
  await settled();
  const [row] = await db.listAudit("amy", { threadId: "t-7" });
  const dumped = JSON.stringify(row.result);
  assert.ok(!dumped.includes("不该整段进库"), "超深的内容只留规模标记");
  assert.match(dumped, /keys:1/);

  // 反过来：常见的两三层结构必须原样留住（否则审计就没什么可复盘的了）
  await runToolCall(
    { name: "dig2", execute: async () => ({ results: [{ title: "hi" }] }) },
    {},
    { owner: "amy", threadId: "t-8" },
    quiet,
  );
  await settled();
  const [shallow] = await db.listAudit("amy", { threadId: "t-8" });
  assert.deepEqual(shallow.result, { results: [{ title: "hi" }] });
});

// ---------------------------------------------------------------------------
// 6) 控制台那一行必须原样保留（线上日志依赖它）
// ---------------------------------------------------------------------------

test("源码级：控制台 `[audit]` 那一行还在，且格式一字未改", async () => {
  const source = await readFile("apps/server/src/engine/tool-executor.ts", "utf8");
  assert.match(source, /`\[audit\] tool=\$\{tool\.name\} owner=\$\{ctx\.owner \?\? "-"\}/);
  assert.match(source, /thread=\$\{ctx\.threadId \?\? "-"\} risk=\$\{/);
  // 行尾的 `... ${extra} (${Date.now() - started}ms)` 一字未改
  assert.match(
    source,
    /\} \$\{extra\} \(\$\{Date\.now\(\) - started\}ms\)`/,
    "行尾耗时格式没动",
  );
  assert.match(source, /const defaultAudit = \(line: string\) => console\.log\(line\);/);
});

test("控制台行照旧逐次输出，落库是**另一条**出口（互不替代）", async () => {
  const lines: string[] = [];
  attachAuditStore(db);
  await runToolCall({ name: "search_web", execute: async () => ({ results: [] }) }, {}, {
    owner: "amy",
    threadId: "t-5",
  }, { denyList: [], audit: (line) => lines.push(line) });
  await settled();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[audit\] tool=search_web owner=amy thread=t-5 risk=safe outcome=ok/);
  assert.equal((await db.listAudit("amy", { threadId: "t-5" })).length, 1, "两条出口各走各的");
});

// ---------------------------------------------------------------------------
// 7) id / 接线
// ---------------------------------------------------------------------------

test("auditEventId：时间戳前缀递增 = 时间有序，后缀随机短串", () => {
  const early = auditEventId("2026-01-01T00:00:01.000Z");
  const late = auditEventId("2026-01-02T00:00:01.000Z");
  assert.ok(early < late, "同一格式下字典序必须等于时间序");
  assert.match(early, /^20260101000001000-[0-9a-f]{8}$/);
  assert.notEqual(auditEventId("2026-01-01T00:00:01.000Z"), auditEventId("2026-01-01T00:00:01.000Z"));
});

test("接线：Store 接上咽喉后，instrument() 包的工具调用也会落库", async () => {
  const { instrument } = await import("../apps/server/src/engine/tool-kit.ts");
  const { z } = await import("zod");
  attachAuditStore(db);
  const wrapped = instrument({
    name: "probe_tool",
    description: "测试用",
    parameters: z.object({}),
    context: () => ({ owner: "gil", threadId: "t-6" }),
    execute: async () => ({ ok: true }),
  });
  const realLog = console.log;
  console.log = () => {};
  try {
    await wrapped.execute({} as never);
    await settled();
  } finally {
    console.log = realLog;
  }
  const rows = await db.listAudit("gil", { threadId: "t-6" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, "probe_tool");
  assert.equal(rows[0].outcome, "ok");
});

// ---------------------------------------------------------------------------
// 8) REST 查询入口（只读）
// ---------------------------------------------------------------------------

const authed = () => ({ Authorization: `Bearer ${token}` });

test("GET /audit：按 threadId 过滤、按 limit 限量，带 reason（无则 null）", async () => {
  for (const [i, threadId] of ["r-1", "r-1", "r-1", "r-2"].entries()) {
    await db.putAudit(
      fakeAudit({
        owner: "local-user",
        threadId,
        tool: `tool${i}`,
        ...(threadId === "r-2" ? { outcome: "blocked" as const, reason: "敏感能力" } : {}),
      }),
    );
  }
  const response = await app.request("/audit?threadId=r-1", { headers: authed() });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.audit.length, 3);
  assert.ok(body.audit.every((row: { threadId: string }) => row.threadId === "r-1"));

  const limited = await (await app.request("/audit?threadId=r-1&limit=2", { headers: authed() })).json();
  assert.equal(limited.audit.length, 2, "limit 生效");

  const blocked = await (await app.request("/audit?threadId=r-2", { headers: authed() })).json();
  assert.equal(blocked.audit.length, 1);
  assert.equal(blocked.audit[0].outcome, "blocked");
  assert.equal(blocked.audit[0].reason, "敏感能力");

  const plain = await (await app.request("/audit?threadId=r-1", { headers: authed() })).json();
  assert.equal(plain.audit[0].reason, null, "没被拦的 reason 就是 null");
});

test("GET /api/audit 同样可用（沿用仓库 /api 前缀）", async () => {
  const response = await app.request("/api/audit?threadId=r-1&limit=1", { headers: authed() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).audit.length, 1);
});

test("GET /audit 是只读且要鉴权：没令牌 401，冒用别人的 owner 403", async () => {
  assert.equal((await app.request("/audit")).status, 401);
  const cross = await app.request("/audit?owner=someone-else", { headers: authed() });
  assert.equal(cross.status, 403, "owner 不许从 query 里取，只做一致性校验");
  assert.equal((await app.request("/audit?owner=local-user", { headers: authed() })).status, 200);
  assert.equal((await app.request("/audit?limit=0", { headers: authed() })).status, 422);
});
