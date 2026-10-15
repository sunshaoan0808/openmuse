/**
 * 审批往返（服务端，P1b）的测试。
 *
 * 钉死的是单子 §4 的八条，外加两条承重的契约：
 *   - **`once` 的原子消耗**：两个并发调用只能过一个（断言写的是「恰好一个 fulfilled」，
 *     不是「至少一个」——后者在放行两次的实现上也会绿）；
 *   - **拒绝名单优先级高于 grant**：用户批准过也不放行，而且拒绝名单**不吃掉**那条授权
 *     （否则一次误配置就能把用户的 `once` 白烧掉）。
 *
 * 全部用例**不 sleep、不真等 24 小时**：`instanceId` 与时钟都由 `setApprovalRuntime` 注入
 * （单子 §4.3/§4.4 的要求），「服务重启」= 换一次 instanceId，「过期」= 把时钟拨过去。
 *
 * 用例之间靠 owner 分区互不串；共享一个内存库与一套接线（咽喉与 REST 共用同一个
 * ApprovalService —— 换成另一个对象的话 `session` 授权会带着另一个 instanceId 而永远失效）。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { attachAuditStore } from "../apps/server/src/engine/audit-store.ts";
import {
  attachApprovalStore,
  getApprovalService,
  setApprovalRuntime,
} from "../apps/server/src/engine/approval-store.ts";
import {
  type ApprovalRecord,
  GRANT_24H_MS,
  type GrantRecord,
  type GrantScope,
  isGrantScope,
} from "../apps/server/src/engine/approvals.ts";
import {
  flushAuditSink,
  getApprovalBackend,
  runToolCall,
  setApprovalBackend,
  setAuditSink,
  ToolApprovalPendingError,
  type ToolPolicy,
} from "../apps/server/src/engine/tool-executor.ts";

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------

/** 安静点：这些用例要的是判定与落库，不是控制台那行（那行由 P1a 的源码级断言钉住）。 */
const quiet = { denyList: [] as string[], audit: () => {} };

/** 收集控制台那行 `[audit] …`，顺带断言它。 */
function collector() {
  const lines: string[] = [];
  return { lines, audit: (line: string) => lines.push(line) };
}

/** 固定起点：所有时刻都从这里推 —— 拨时钟代替 sleep。 */
const T0 = Date.parse("2026-03-01T08:00:00.000Z");
/** 本「进程实例」的标识。换掉它 = 服务重启过（`session` 授权据此失效）。 */
const INSTANCE = "p1b-instance-a";

let clockNow = T0;
let restoreRuntime = () => {};
let realBackend: ReturnType<typeof getApprovalBackend>;

let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token: string;

/** 咽喉是 fire-and-forget 落库，断言库里的行之前要显式把在途的写盘等干净。 */
const settled = () => flushAuditSink();

/** 需要审批的工具（静态 sensitive）：跑一次必被拦、必登记一条 pending。 */
const sensitive = (name: string, execute: (args: never) => Promise<unknown> = async () => "done") =>
  ({ name, risk: "sensitive", execute }) satisfies ToolPolicy;

/** 跑一次「要审批」的工具，把它抛出的「等待审批」错误拿回来（没拦下来就当场炸）。 */
async function blocked(...args: Parameters<typeof runToolCall>): Promise<ToolApprovalPendingError> {
  try {
    await runToolCall(...args);
  } catch (error) {
    assert.ok(
      error instanceof ToolApprovalPendingError,
      `应当抛 ToolApprovalPendingError，实际是：${String(error)}`,
    );
    return error;
  }
  assert.fail("这次调用本该被拦下来等审批，却跑通了");
}

/**
 * 完整往返的第一步：跑一次被拦的调用，取回它登记的那条 pending 审批。
 * 取「最新那条」——同一个 owner 在一个用例里可能拦过好几次。
 */
async function pendingFor(
  owner: string,
  tool: ToolPolicy,
  threadId: string | undefined = undefined,
  args: unknown = {},
): Promise<ApprovalRecord> {
  await blocked(tool, args, { owner, threadId }, quiet);
  const [record] = await db.listApprovals(owner, { status: "pending" });
  assert.ok(record, `${owner} 名下应当登记了一条 pending 审批`);
  assert.equal(record.tool, tool.name, "取到的应当是这次调用登记的那条");
  return record;
}

/** 批准（走服务端那个对象，与 REST 同一套：同一个 instanceId、同一个时钟）。 */
async function approve(approval: ApprovalRecord, scope: GrantScope): Promise<GrantRecord> {
  const service = getApprovalService();
  assert.ok(service, "审批服务应当已经接上");
  const result = await service.approve(approval.owner, approval.id, scope);
  assert.ok(result, "批准应当成功（审批是本人的、且还待决）");
  assert.equal(result.approval.status, "approved");
  return result.grant;
}

/** 把时钟拨到绝对时刻（过期 / 重启用）。 */
const setClock = (at: number) => {
  clockNow = at;
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-approval-"));
  db = await createStore(); // 内存库：不碰线上 Postgres
  attachAuditStore(db);
  assert.equal(attachApprovalStore(db), true, "审批往返应当装配成功");

  restoreRuntime = setApprovalRuntime({ instanceId: INSTANCE, now: () => clockNow });
  realBackend = getApprovalBackend();

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
  restoreRuntime();
  setApprovalBackend(null);
  setAuditSink(null);
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

// 每个用例都从「干净的接线」出发：某个用例故意接了个坏 sink / 坏存储，不许漏给下一个。
afterEach(() => {
  setApprovalBackend(realBackend);
  attachAuditStore(db);
  clockNow = T0;
});

// ---------------------------------------------------------------------------
// §4.1 无 grant 时：被拦，且登记了一条 pending（含 reason 与工具名）
// ---------------------------------------------------------------------------

test("§4.1 没有 grant 时要审批的工具被拦下，并登记一条含工具名与理由的 pending", async () => {
  const owner = "p1b-alice";
  const tool = sensitive("send_payment", async () => "paid");
  const { lines, audit } = collector();

  const error = await blocked(tool, { amount: 10 }, { owner, threadId: "t-alice" }, {
    denyList: [],
    audit,
  });

  // 回灌给模型的文案：单子 §2.4 点名要写清的三件事，一件都不能少。
  assert.match(error.message, /Do not retry the same call/, "必须明确叫模型别重试同一个调用");
  assert.match(error.message, /已经通知用户/, "必须说明用户已被通知（否则等于教模型撒谎）");
  assert.match(error.message, /会直接成功/, "必须说明批了之后同一个调用会成功");
  assert.equal(error.tool, "send_payment");
  assert.equal(error.name, "ToolApprovalPendingError", "等待审批要与「永久否决」分得开");
  assert.ok(error.approvalId, "登记成功就该把 id 带给调用方");

  // 登记的那一条
  const pending = await db.getApproval(owner, error.approvalId as string);
  assert.ok(pending, "库里应当真的有这条审批");
  assert.equal(pending.status, "pending");
  assert.equal(pending.tool, "send_payment", "必须带工具名");
  assert.equal(pending.owner, owner);
  assert.equal(pending.threadId, "t-alice");
  assert.equal(pending.risk, "sensitive");
  assert.match(pending.reason, /敏感能力/, "reason 要说清为什么需要人批");
  assert.equal(pending.scope, null, "待决的还没有 scope");
  assert.equal(pending.decidedAt, null);
  assert.equal(pending.grantId, null);
  assert.match(pending.requestedAt, /^\d{4}-\d{2}-\d{2}T/, "requestedAt 是 ISO 时刻");
  assert.deepEqual(pending.args, { amount: 10 }, "登记参数摘要，便于用户看清在批什么");

  // 被拦时不产生任何放行
  assert.deepEqual(await db.listGrants(owner, "send_payment"), [], "被拦不该凭空写出 grant");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[audit\] tool=send_payment owner=p1b-alice thread=t-alice risk=sensitive/);
  assert.match(lines[0], /outcome=awaiting_approval/);
  assert.ok(lines[0].includes(`approval=${pending.id}`), "控制台那行要带上审批 id");
});

test("§4.1 三种拦法都登记待审批：敏感能力 / 结果外流 / 声明了警告", async () => {
  const owner = "p1b-cause";
  const cases: { tool: ToolPolicy; expect: RegExp }[] = [
    { tool: sensitive("wipe_disk"), expect: /敏感能力/ },
    {
      tool: {
        name: "publish_note",
        assess: () => ({ egress: "review", egressTarget: "example.com" }),
        execute: async () => "published",
      },
      expect: /带出本机/,
    },
    {
      tool: {
        name: "weather",
        assess: () => ({ warnings: ["数据来自第三方，仅供参考"] }),
        execute: async () => ({ answer: "38 ℃" }),
      },
      expect: /先看一眼/,
    },
  ];
  for (const { tool, expect } of cases) {
    const pending = await pendingFor(owner, tool);
    assert.match(pending.reason, expect, `${tool.name} 的 reason 要说清拦的原因`);
    assert.equal(pending.status, "pending");
  }
  assert.deepEqual(
    (await db.listApprovals(owner)).map((row) => row.tool).sort(),
    ["publish_note", "weather", "wipe_disk"],
    "三次拦截各登记一条",
  );
});

// ---------------------------------------------------------------------------
// §4.2 once：消耗型 —— 下一次过、再下一次被拦；并发两次只能过一次
// ---------------------------------------------------------------------------

test("§4.2 once：批准后下一次成功、再下一次又被拦（消耗语义）", async () => {
  const owner = "p1b-once";
  const threadId = "t-once";
  const tool = sensitive("transfer_money");

  const pending = await pendingFor(owner, tool, threadId);
  const grant = await approve(pending, "once");
  assert.equal(grant.scope, "once");
  assert.equal(grant.threadId, threadId, "once 绑定批准时的那次会话");
  assert.equal(grant.consumedAt, null, "刚批出来还没用掉");
  assert.equal(grant.expiresAt, null, "once 不靠过期失效，靠用掉");
  assert.equal(grant.approvalId, pending.id, "授权要能回溯到那条审批");

  assert.equal(await runToolCall(tool, { n: 1 }, { owner, threadId }, quiet), "done");
  const [consumed] = await db.listGrants(owner, "transfer_money");
  assert.ok(consumed.consumedAt, "once 用掉后必须留下 consumedAt");

  // 再下一次：又被拦（消耗型）
  await blocked(tool, { n: 2 }, { owner, threadId }, quiet);
  // 授权按 owner 分区：换个 owner 的同名工具也不受影响
  await blocked(sensitive("transfer_money"), { n: 3 }, { owner: "p1b-stranger" }, quiet);
});

test("§4.2 once 是原子消耗的：两个并发调用只能过一次（不多不少）", async () => {
  const owner = "p1b-race";
  const threadId = "t-race";
  let executions = 0;
  const tool = sensitive("race_tool", async () => {
    executions += 1;
    return "ran";
  });

  await approve(await pendingFor(owner, tool, threadId), "once");

  const results = await Promise.allSettled([
    runToolCall(tool, {}, { owner, threadId }, quiet),
    runToolCall(tool, {}, { owner, threadId }, quiet),
  ]);
  const passed = results.filter((result) => result.status === "fulfilled");
  const refused = results.filter((result) => result.status === "rejected");

  assert.equal(passed.length, 1, "并发两次调用只允许一次靠授权放行（放行两次就该红）");
  assert.equal(refused.length, 1, "另一个必须照常被拦");
  assert.equal(executions, 1, "工具只该真的跑一次");
  const reason = (refused[0] as PromiseRejectedResult).reason;
  assert.ok(reason instanceof ToolApprovalPendingError, "输的那次仍然是「等审批」，不是别的错");
});

// ---------------------------------------------------------------------------
// §4.3 session：同 thread 一直放行；换 thread 仍拦；服务实例重启后失效
// ---------------------------------------------------------------------------

test("§4.3 session：同 thread 内连续放行，换 thread 仍拦，换服务实例失效", async () => {
  const owner = "p1b-session";
  const tool = sensitive("session_tool");
  const grant = await approve(await pendingFor(owner, tool, "t-A"), "session");
  assert.equal(grant.threadId, "t-A");
  assert.equal(grant.instanceId, INSTANCE, "session 绑的是批准时的进程实例");
  assert.equal(grant.expiresAt, null, "session 不靠过期失效");

  // 同 thread：连续两次都放行（session 不消耗）
  await runToolCall(tool, { n: 1 }, { owner, threadId: "t-A" }, quiet);
  await runToolCall(tool, { n: 2 }, { owner, threadId: "t-A" }, quiet);

  // 换 thread：仍拦（session 只认那一次会话）
  await blocked(tool, { n: 3 }, { owner, threadId: "t-B" }, quiet);
  // 换 thread 这一次不吃掉授权：回到 t-A 还能用
  await runToolCall(tool, { n: 4 }, { owner, threadId: "t-A" }, quiet);

  // 服务实例重启（换 instanceId）：即便 thread 对上也失效
  const restore = setApprovalRuntime({ instanceId: "p1b-instance-b" });
  try {
    await blocked(tool, { n: 5 }, { owner, threadId: "t-A" }, quiet);
  } finally {
    restore();
  }
  // 回到原实例：又放行了 —— 证明失效的原因是「换了进程」，不是「被用掉了」
  await runToolCall(tool, { n: 6 }, { owner, threadId: "t-A" }, quiet);
});

// ---------------------------------------------------------------------------
// §4.4 24h：expiresAt = 授权时刻 + 24h；过期后重新拦（拨时钟，不 sleep）
// ---------------------------------------------------------------------------

test("§4.4 24h：expiresAt 算得准、过点前放行、过点后重新拦", async () => {
  const owner = "p1b-day";
  const tool = sensitive("day_tool");

  setClock(T0);
  const grant = await approve(await pendingFor(owner, tool, "t-day"), "24h");
  assert.equal(
    grant.expiresAt,
    new Date(T0 + GRANT_24H_MS).toISOString(),
    "expiresAt 必须正好是授权时刻 + 24h",
  );
  assert.equal(grant.createdAt, new Date(T0).toISOString(), "createdAt 就是授权那一刻");
  assert.equal(grant.threadId, null, "24h 是 owner 名下任意线程放行，不绑会话");
  assert.equal(grant.consumedAt, null, "24h 不消耗");

  // 换 thread 照样放行（这一档的意义就在这儿）
  await runToolCall(tool, { n: 1 }, { owner, threadId: "t-other" }, quiet);

  // 到点前 1ms：还在有效期内
  setClock(T0 + GRANT_24H_MS - 1);
  await runToolCall(tool, { n: 2 }, { owner, threadId: "t-day" }, quiet);

  // 正好到点：失效，重新被拦（不 sleep，时钟是拨的）
  setClock(T0 + GRANT_24H_MS);
  await blocked(tool, { n: 3 }, { owner, threadId: "t-day" }, quiet);
  // 再往后也一样拦
  setClock(T0 + GRANT_24H_MS + 60_000);
  await blocked(tool, { n: 4 }, { owner, threadId: "t-day" }, quiet);
});

test("§4.4 授权只对批准时的那一个工具生效（不做前缀 / 通配匹配）", async () => {
  const owner = "p1b-tool-scope";
  await approve(await pendingFor(owner, sensitive("pay_invoice")), "24h");
  // 同 owner、命名相近的另一个工具：一律不认
  await blocked(sensitive("pay_invoice_batch"), {}, { owner, threadId: "t-x" }, quiet);
  await blocked(sensitive("delete_invoice"), {}, { owner, threadId: "t-x" }, quiet);
});

// ---------------------------------------------------------------------------
// §4.5 拒绝名单优先级高于 grant
// ---------------------------------------------------------------------------

test("§4.5 拒绝名单优先级高于 grant：批准过也照拦，且不吃掉那条授权", async () => {
  const owner = "p1b-deny";
  const threadId = "t-deny";
  let ran = false;
  const tool = sensitive("run_shell", async () => {
    ran = true;
    return "executed";
  });

  // 先给它批一条 once
  const grant = await approve(await pendingFor(owner, tool, threadId), "once");
  const pendingBefore = (await db.listApprovals(owner, { status: "pending" })).length;

  // 同时命中拒绝名单 → 仍然不放行
  const { lines, audit } = collector();
  await assert.rejects(
    () => runToolCall(tool, {}, { owner, threadId }, { denyList: ["run_shell"], audit }),
    (error: Error) => /拒绝名单/.test(error.message) && /Do not retry the same call/.test(error.message),
    "拒绝名单命中时抛的是「永久否决」那一条，不是「等审批」",
  );
  assert.equal(ran, false, "被拒绝名单拦下的工具连执行都不该有");
  assert.match(lines[0], /outcome=denied/);

  // 关键：拒绝名单**不吃掉**用户的授权（否则一次误配置就把 once 白烧了）
  const [afterDeny] = await db.listGrants(owner, "run_shell");
  assert.equal(afterDeny.id, grant.id);
  assert.equal(afterDeny.consumedAt, null, "拒绝名单在 grant 查询之前返回，不许消耗授权");
  assert.equal(
    (await db.listApprovals(owner, { status: "pending" })).length,
    pendingBefore,
    "拒绝名单命中也不该再登记待审批（这条路已经死了）",
  );

  // 把拒绝名单撤掉：那条 once 原封不动还在，下一次调用就放行
  await runToolCall(tool, {}, { owner, threadId }, quiet);
  assert.equal(ran, true, "授权还在就该放行");
});

test("§4.5 拒绝名单优先级高于 24h / session 授权（不止 once）", async () => {
  for (const scope of ["24h", "session"] as const) {
    const owner = `p1b-deny-${scope}`;
    const threadId = `t-${scope}`;
    const tool = sensitive(`banned_${scope}`);
    await approve(await pendingFor(owner, tool, threadId), scope);
    await assert.rejects(
      () =>
        runToolCall(tool, {}, { owner, threadId }, {
          denyList: [`banned_${scope}`],
          audit: () => {},
        }),
      (error: Error) => /拒绝名单/.test(error.message),
      `${scope} 授权也不许盖过拒绝名单`,
    );
  }
});

// ---------------------------------------------------------------------------
// §4.6 未声明 risk/assess 的工具：行为与改造前逐字一致（同一性断言）
// ---------------------------------------------------------------------------

test("§4.6 没声明 risk/assess 的工具：返回值同一对象、抛错同一 Error 实例（审批已接上时也一样）", async () => {
  const owner = "p1b-plain";
  assert.ok(getApprovalBackend(), "本组用例的前提就是审批后端已经接上");

  // 1) 返回值：同一个对象（不是等值、不是深拷贝）
  const raw = { results: [{ title: "hello" }], backend: "worker" };
  const plain: ToolPolicy = { name: "browse_web", execute: async () => raw };
  assert.equal(
    await runToolCall(plain, { url: "https://example.com" }, { owner, threadId: "t-p" }, quiet),
    raw,
    "返回值必须是同一个对象",
  );

  // 2) 抛错：同一个 Error 实例（仓库里工具靠 throw 表达失败，吞成 {error} 会改掉契约）
  const boom = new Error("创建账户需要同时提供 site（站点名）和 username（登录名）");
  const failing: ToolPolicy = {
    name: "site_account",
    execute: async () => {
      throw boom;
    },
  };
  await assert.rejects(
    () => runToolCall(failing, {}, { owner, threadId: "t-p" }, quiet),
    (error: unknown) => error === boom,
    "不许包装、不许替换工具自己的 Error 实例",
  );

  // 3) 没声明 risk/assess 的工具**不会**被登记待审批，也不该收到等待审批错误
  assert.deepEqual(await db.listApprovals(owner), [], "这类工具不该牵扯审批");
});

test("§4.6 有授权命中的普通工具：返回值仍是同一个对象、抛错仍是同一个实例", async () => {
  const owner = "p1b-plain-grant";
  const threadId = "t-pg";
  const raw = { answer: "38 ℃" };
  const plain: ToolPolicy = { name: "weather", execute: async () => raw };

  // 给一个**自己不会**触发审批的工具批一条 24h 授权（授权只改判定顺序，不改执行语义）
  const grant: GrantRecord = {
    id: "20260301080000000-00000001",
    owner,
    tool: "weather",
    scope: "24h",
    threadId: null,
    createdAt: new Date(clockNow).toISOString(),
    expiresAt: new Date(clockNow + GRANT_24H_MS).toISOString(),
    consumedAt: null,
    instanceId: INSTANCE,
    approvalId: "20260301080000000-00000002",
  };
  await db.putGrant(grant);

  assert.equal(await runToolCall(plain, {}, { owner, threadId }, quiet), raw, "授权放行也不许换对象");

  const boom = new Error("上游超时");
  await assert.rejects(
    () =>
      runToolCall(
        { name: "weather", execute: async () => Promise.reject(boom) },
        {},
        { owner, threadId },
        quiet,
      ),
    (error: unknown) => error === boom,
    "授权放行也不许包装工具自己的错",
  );
});

// ---------------------------------------------------------------------------
// §4.7 审计：granted:<scope> 与审批登记都看得见；落库失败不影响工具语义
// ---------------------------------------------------------------------------

test("§4.7 审计：授权放行记 granted:<scope>，审批登记也各写一行", async () => {
  const owner = "p1b-audit";
  const threadId = "t-audit";
  const tool = sensitive("audit_tool");
  const { lines, audit } = collector();

  // a) 登记待审批 → 一行 outcome=blocked、reason 保留
  await blocked(tool, { n: 1 }, { owner, threadId }, { denyList: [], audit });
  await approve((await db.listApprovals(owner, { status: "pending" }))[0], "session");

  // b) 靠授权放行 → 判定记 granted:<scope>
  await runToolCall(tool, { n: 2 }, { owner, threadId }, { denyList: [], audit });
  await settled();

  assert.match(lines[0], /outcome=awaiting_approval/, "审批登记要在控制台那一行里看得见");
  assert.match(lines[1], /outcome=granted:session/, "靠授权放的，判定要带上 scope");

  const rows = await db.listAudit(owner, { threadId });
  const registered = rows.find((row) => row.decision === "awaiting_approval");
  assert.ok(registered, "审批登记要落一条审计");
  assert.equal(registered.outcome, "blocked", "登记时那次调用是被拦的");
  assert.ok(registered.reason && registered.reason.length > 0, "reason 必须保留");
  assert.equal(registered.tool, "audit_tool");
  assert.equal(registered.risk, "sensitive");

  const granted = rows.find((row) => row.decision === "granted:session");
  assert.ok(granted, "授权放行要落一条带 granted:<scope> 的审计");
  assert.equal(granted.outcome, "ok");
  assert.equal(granted.reason, null, "放行没有理由");
});

test("§4.7 审批落库失败不影响工具语义：仍是同一个对象 / 同一个 Error 实例", async () => {
  const owner = "p1b-sink-fail";
  const threadId = "t-sf";
  const raw = { results: [{ title: "hi" }] };
  const boom = new Error("连接超时");

  // 审计出口同步抛错
  setAuditSink(() => {
    throw new Error("审计库连不上");
  });
  assert.equal(
    await runToolCall({ name: "browse_web", execute: async () => raw }, {}, { owner, threadId }, quiet),
    raw,
    "审计落库失败不许换掉返回对象",
  );
  await assert.rejects(
    () =>
      runToolCall(
        { name: "browse_web", execute: async () => Promise.reject(boom) },
        {},
        { owner, threadId },
        quiet,
      ),
    (error: unknown) => error === boom,
    "审计落库失败不许包装工具的 Error",
  );
  await settled();

  // 审批登记失败 → 退回 P0 的「直接拒批」，仍然是**被拦**（不能让工具跑起来）
  const realPutApproval = db.putApproval.bind(db);
  db.putApproval = async () => {
    throw new Error("审批表写不进去");
  };
  try {
    let ran = false;
    await assert.rejects(
      () =>
        runToolCall(
          {
            name: "wipe_disk",
            risk: "sensitive",
            execute: async () => {
              ran = true;
              return "x";
            },
          },
          {},
          { owner, threadId },
          quiet,
        ),
      (error: Error) =>
        /当前没有可用的审批入口/.test(error.message) &&
        /Do not retry the same call/.test(error.message),
      "登记不上就退回 P0 拒批，但必须照拦",
    );
    assert.equal(ran, false, "登记失败绝不放行");
  } finally {
    db.putApproval = realPutApproval;
  }
});

// ---------------------------------------------------------------------------
// §4.8 REST：approve/deny 正常路径、非法 scope → 400、别人的审批 id → 403/404
// ---------------------------------------------------------------------------

const authed = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: authed(), body: JSON.stringify(body) });

test("§4.8 REST：GET /approvals 按会话 owner 取数，limit 生效，最近的在前", async () => {
  const tool = sensitive("rest_list_tool");
  const first = await pendingFor("local-user", tool, "rest-1");
  setClock(T0 + 1000);
  const second = await pendingFor("local-user", tool, "rest-2");

  const response = await app.request("/approvals", { headers: authed() });
  assert.equal(response.status, 200);
  const body = await response.json();
  const fromStore = await db.listApprovals("local-user", { status: "pending" });
  assert.deepEqual(
    body.approvals.map((row: { id: string }) => row.id),
    fromStore.map((row) => row.id),
    "REST 返回的顺序要与库里一致（最近的在前）",
  );
  assert.equal(body.approvals[0].id, second.id, "刚登记的那条排在最前");
  assert.ok(
    body.approvals.some((row: { id: string }) => row.id === first.id),
    "两次登记都要在列表里",
  );
  assert.ok(
    body.approvals.every((row: { owner: string }) => row.owner === "local-user"),
    "只返回会话自己的审批",
  );

  const limited = await (await app.request("/approvals?limit=1", { headers: authed() })).json();
  assert.equal(limited.approvals.length, 1, "limit 要真的限住");
  assert.equal(limited.approvals[0].id, second.id);

  // /api/* 前缀同样可用
  const viaApi = await app.request("/api/approvals?limit=2", { headers: authed() });
  assert.equal(viaApi.status, 200);
  assert.equal((await viaApi.json()).approvals.length, 2);
});

test("§4.8 REST：POST /approvals/:id/approve 正常路径（写出 grant + 审批置 approved）", async () => {
  const tool = sensitive("rest_approve_tool");
  const pending = await pendingFor("local-user", tool, "rest-approve");

  const response = await post(`/approvals/${pending.id}/approve`, { scope: "24h" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.approval.status, "approved");
  assert.equal(body.approval.scope, "24h");
  assert.ok(body.approval.decidedAt, "批准要有时刻");
  assert.ok(body.grant, "批准必须写出授权");
  assert.equal(body.grant.scope, "24h");
  assert.equal(body.grant.tool, "rest_approve_tool");
  assert.equal(body.grant.approvalId, pending.id);

  // 用户点「同意」这个动作本身要单独写一行审计（单子 §2.5 的最后一句）
  await settled();
  const decisions = (await db.listAudit("local-user")).filter(
    (row) => row.tool === "rest_approve_tool" && row.decision.startsWith("approval_"),
  );
  assert.equal(decisions.length, 1, "批准这个动作要单独记一行");
  assert.equal(decisions[0].decision, "approval_approved");
  assert.match(decisions[0].reason ?? "", /用户已批准（scope=24h）/);
  assert.equal(decisions[0].owner, "local-user");

  // 授权确实落到库里、咽喉下次就用得上
  assert.equal((await db.listGrants("local-user", "rest_approve_tool")).length, 1);
  assert.equal(
    await runToolCall(tool, {}, { owner: "local-user", threadId: "rest-approve" }, quiet),
    "done",
    "REST 批出来的授权，咽喉要能直接放行",
  );

  // /api 前缀同样能用
  const next = await pendingFor("local-user", sensitive("rest_approve_tool2"), "rest-approve2");
  const viaApi = await post(`/api/approvals/${next.id}/approve`, { scope: "once" });
  assert.equal(viaApi.status, 200);
  assert.equal((await viaApi.json()).grant.scope, "once");
});

test("§4.8 REST：非法 scope → 400，且不产生任何放行", async () => {
  const tool = sensitive("rest_scope_tool");
  const pending = await pendingFor("local-user", tool, "rest-scope");

  for (const scope of ["forever", "", "ONCE", null, 7]) {
    const response = await post(`/approvals/${pending.id}/approve`, { scope });
    assert.equal(response.status, 400, `scope=${JSON.stringify(scope)} 应当 400`);
  }
  // 连 scope 都没有也是 400
  assert.equal((await post(`/approvals/${pending.id}/approve`, {})).status, 400);

  // 仍然待决、没有任何 grant
  const still = await db.getApproval("local-user", pending.id);
  assert.equal(still?.status, "pending", "非法 scope 不许顺手把审批处理掉");
  assert.deepEqual(await db.listGrants("local-user", "rest_scope_tool"), []);
  await blocked(tool, {}, { owner: "local-user", threadId: "rest-scope" }, quiet);
});

test("§4.8 REST：POST /approvals/:id/deny 置 denied，且不产生任何放行", async () => {
  const tool = sensitive("rest_deny_tool");
  const pending = await pendingFor("local-user", tool, "rest-deny");

  const response = await post(`/approvals/${pending.id}/deny`, { reason: "这次先别做" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.approval.status, "denied");
  assert.equal(body.approval.denyReason, "这次先别做");
  assert.ok(body.approval.decidedAt);
  assert.equal(body.grant, undefined, "拒绝**不产生任何放行**");

  // 工具照旧被拦（这条 denied 审批不该被当成授权）
  await blocked(tool, {}, { owner: "local-user", threadId: "rest-deny" }, quiet);
  assert.deepEqual(await db.listGrants("local-user", "rest_deny_tool"), []);

  // 拒绝过的审批不能再批；批过的也不能再拒
  assert.equal((await post(`/approvals/${pending.id}/approve`, { scope: "once" })).status, 404);
  const approved = await pendingFor("local-user", sensitive("rest_deny_tool2"), "rest-deny2");
  assert.equal((await post(`/approvals/${approved.id}/approve`, { scope: "once" })).status, 200);
  assert.equal((await post(`/approvals/${approved.id}/deny`, {})).status, 404);
});

test("§4.8 REST：别人的审批 id 与不存在的 id 一律 404（不泄露存不存在）", async () => {
  // 造一条属于别人的审批
  const foreign = await db.putApproval({
    id: "20260301080000000-deadbeef",
    tool: "foreign_tool",
    owner: "someone-else",
    threadId: null,
    risk: "sensitive",
    reason: "别人的审批",
    args: null,
    requestedAt: new Date(clockNow).toISOString(),
    status: "pending",
    scope: null,
    decidedAt: null,
    denyReason: null,
    grantId: null,
  });
  assert.equal(foreign.status, "pending");

  assert.equal(
    (await post(`/approvals/${foreign.id}/approve`, { scope: "24h" })).status,
    404,
    "批别人的审批 → 404",
  );
  assert.equal((await post(`/approvals/${foreign.id}/deny`, {})).status, 404, "拒别人的审批 → 404");

  // 不存在的 id 同样是 404（两种情况**无法区分**，免得变成存在性探测）
  assert.equal((await post("/approvals/20260301080000000-cafebabe/approve", { scope: "once" })).status, 404);
  assert.equal((await post("/approvals/20260301080000000-cafebabe/deny", {})).status, 404);

  // 别人的那条还挂着 pending，没被顺手改掉
  assert.equal((await db.getApproval("someone-else", foreign.id))?.status, "pending");
});

test("§4.8 REST：审批入口要鉴权，owner 只从会话取", async () => {
  assert.equal((await app.request("/approvals")).status, 401, "没令牌不许看审批");
  assert.equal((await app.request("/api/approvals")).status, 401);
  assert.equal((await app.request("/approvals/x/approve", { method: "POST", body: "{}" })).status, 401);
  // URL/query 里带 owner 只做一致性校验：不一致 403
  assert.equal((await app.request("/approvals?owner=someone-else", { headers: authed() })).status, 403);
  assert.equal((await app.request("/approvals?owner=local-user", { headers: authed() })).status, 200);
  // limit 越界按 zod 的规矩回 422（与 /audit 同一套）
  assert.equal((await app.request("/approvals?limit=0", { headers: authed() })).status, 422);
});

test("§4.8 scope 合法性只认 once / session / 24h 三档", () => {
  for (const good of ["once", "session", "24h"]) assert.ok(isGrantScope(good));
  for (const bad of ["", "ONCE", "24H", "forever", "week", null, undefined, 7, {}, []])
    assert.equal(isGrantScope(bad), false, `${JSON.stringify(bad)} 不该被当成合法 scope`);
});