/**
 * 工具执行咽喉（P0 收口）的测试。
 *
 * 最要紧的一组是「**没声明 risk/assess 的工具，行为与改造前逐字一致**」——
 * 返回值要能过 `assert.equal`（同一对象）、抛错要能过同一性检查（同一个 Error 实例），
 * 因为仓库里工具就是靠 `throw` 表达失败（tests/site-accounts.test.ts 这么断言），
 * 把抛错吞成 `{error}` 会悄悄改掉契约。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { readToolDenyList } from "../apps/server/src/config.ts";
import { instrument } from "../apps/server/src/engine/tool-kit.ts";
import {
  blockedMessage,
  blockedReason,
  decideDeny,
  needsApproval,
  redactResult,
  runToolCall,
  type ToolPolicy,
} from "../apps/server/src/engine/tool-executor.ts";

/** 收集审计行，别让它刷屏。 */
function collector() {
  const lines: string[] = [];
  return { lines, audit: (line: string) => lines.push(line) };
}

const silent = { denyList: [] as string[], audit: () => {} };

test("没声明 risk/assess 的工具：返回值原样（同一个对象），不被包装", async () => {
  const raw = { results: [{ title: "hello" }], backend: "worker" };
  const tool: ToolPolicy = { name: "browse_web", execute: async () => raw };
  const got = await runToolCall(tool, { url: "https://example.com" }, {}, silent);
  assert.equal(got, raw, "必须是同一个对象，不能深拷贝或加壳");
});

test("没声明 risk/assess 的工具：抛错原样（同一个 Error 实例）", async () => {
  const boom = new Error("创建账户需要同时提供 site（站点名）和 username（登录名）");
  const tool: ToolPolicy = {
    name: "site_account",
    execute: async () => {
      throw boom;
    },
  };
  await assert.rejects(
    () => runToolCall(tool, {}, {}, silent),
    (error: unknown) => error === boom,
    "咽喉不许包装、不许替换工具自己的错误对象",
  );
});

test("拒绝名单命中：连执行都不执行，且明确要求模型不要重试", async () => {
  let ran = false;
  const { lines, audit } = collector();
  const tool: ToolPolicy = {
    name: "run_shell",
    execute: async () => {
      ran = true;
      return "ok";
    },
  };
  await assert.rejects(
    () => runToolCall(tool, {}, { owner: "u1", threadId: "t1" }, { denyList: ["run_shell"], audit }),
    (error: Error) => /Do not retry the same call/.test(error.message),
  );
  assert.equal(ran, false, "被拦下的工具不该真的跑起来");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /outcome=denied/);
  assert.match(lines[0], /owner=u1/);
  assert.match(lines[0], /thread=t1/);
});

test("静态 sensitive：默认拒批（没有审批入口时宁可拦住）", async () => {
  let ran = false;
  const { lines, audit } = collector();
  const tool: ToolPolicy = {
    name: "send_payment",
    risk: "sensitive",
    execute: async () => {
      ran = true;
      return "paid";
    },
  };
  await assert.rejects(
    () => runToolCall(tool, {}, {}, { denyList: [], audit }),
    (error: Error) => /Do not retry the same call/.test(error.message) && /敏感能力/.test(error.message),
  );
  assert.equal(ran, false);
  assert.match(lines[0], /outcome=refused/);
});

test("逐次评估说结果要流出本机（egress=review）→ 同样拒批", async () => {
  const tool: ToolPolicy = {
    name: "publish_note",
    assess: () => ({ egress: "review", egressTarget: "example.com", target: "note#7" }),
    execute: async () => "published",
  };
  await assert.rejects(
    () => runToolCall(tool, {}, {}, silent),
    (error: Error) => /Do not retry the same call/.test(error.message),
  );
});

test("评估自己坏了 → fail closed（拦住），并把原因写进审计", async () => {
  const { lines, audit } = collector();
  const tool: ToolPolicy = {
    name: "read_private",
    assess: () => {
      throw new Error("策略服务不可用");
    },
    execute: async () => "secret",
  };
  await assert.rejects(() => runToolCall(tool, {}, {}, { denyList: [], audit }));
  assert.match(lines[0], /outcome=assess_failed/);
  assert.match(lines[0], /策略服务不可用/);
});

test("警告：声明 warnings 就必须拦（不是装饰结果），理由带出警告原文", async () => {
  let ran = false;
  const { lines, audit } = collector();
  const tool: ToolPolicy = {
    name: "weather",
    assess: () => ({ warnings: ["数据来自第三方，仅供参考"], target: "weather.example" }),
    execute: async () => {
      ran = true;
      return { answer: "38 ℃" };
    },
  };
  await assert.rejects(
    () => runToolCall(tool, {}, {}, { denyList: [], audit }),
    (error: Error) =>
      /Do not retry the same call/.test(error.message) &&
      /数据来自第三方，仅供参考/.test(error.message),
  );
  assert.equal(ran, false, "声明了要人先看的调用不许真的执行");
  assert.match(lines[0], /outcome=refused/);
  assert.match(lines[0], /target=weather\.example/);
});

test("moderate：放行但必进审计（不因为档位高就拦）", async () => {
  const { lines, audit } = collector();
  const tool: ToolPolicy = {
    name: "browse_web",
    risk: "moderate",
    assess: () => ({ summary: "读一页公开页面" }),
    execute: async () => ({ results: [{ title: "hi" }] }),
  };
  const got = (await runToolCall(tool, {}, {}, { denyList: [], audit })) as Record<string, unknown>;
  assert.deepEqual(got, { results: [{ title: "hi" }] });
  assert.match(lines[0], /outcome=ok/);
  assert.match(lines[0], /summary=读一页公开页面/);
});

test("打码：只有评估明确要求时才动，凭据字段被抹掉、普通字段原样", async () => {
  const raw = {
    user: "amy",
    apiKey: "sk-abcdefgh12345678",
    nested: { cookie: "session=abc", title: "hi" },
    list: ["plain", "Bearer abcdefghijklmnop"],
  };
  const got = (await runToolCall(
    { name: "dump", assess: () => ({ redact: true }), execute: async () => raw },
    {},
    {},
    silent,
  )) as Record<string, unknown>;
  assert.equal(got.user, "amy");
  assert.equal(got.apiKey, "[REDACTED]");
  assert.deepEqual(got.nested, { cookie: "[REDACTED]", title: "hi" });
  assert.deepEqual(got.list, ["plain", "[REDACTED]"]);
  // 没要求打码时，一字不改
  assert.equal(redactResult(raw, {}), raw);
});

test("审计：放行、拒批、抛错三条路各留一行，含 risk 与耗时", async () => {
  const { lines, audit } = collector();
  const ok: ToolPolicy = { name: "search_web", execute: async () => ({ results: [] }) };
  await runToolCall(ok, {}, {}, { denyList: [], audit });
  const failing: ToolPolicy = {
    name: "browse_web",
    execute: async () => {
      throw new Error("域名无法解析");
    },
  };
  await assert.rejects(() => runToolCall(failing, {}, {}, { denyList: [], audit }));
  const dangerous: ToolPolicy = { name: "wipe", risk: "sensitive", execute: async () => "x" };
  await assert.rejects(() => runToolCall(dangerous, {}, {}, { denyList: [], audit }));

  assert.equal(lines.length, 3);
  assert.match(lines[0], /tool=search_web .*risk=safe .*outcome=ok/);
  assert.match(lines[1], /outcome=error .*error=域名无法解析/);
  assert.match(lines[2], /tool=wipe .*risk=sensitive .*outcome=refused/);
  assert.match(lines[0], /\(\d+ms\)$/);
});

test("接线守卫：经过 instrument() 的工具一定走咽喉（拒绝名单能拦住合成工具）", async () => {
  const previous = process.env.TOOL_DENY_LIST;
  process.env.TOOL_DENY_LIST = "blocked_probe";
  try {
    let ran = false;
    const wrapped = instrument({
      name: "blocked_probe",
      description: "测试用",
      parameters: z.object({}),
      execute: async () => {
        ran = true;
        return "should not happen";
      },
    });
    await assert.rejects(
      () => wrapped.execute({} as never),
      (error: Error) => /Do not retry the same call/.test(error.message),
    );
    assert.equal(ran, false, "咽喉必须挡在工具前面");
  } finally {
    if (previous === undefined) delete process.env.TOOL_DENY_LIST;
    else process.env.TOOL_DENY_LIST = previous;
  }
});

test("接线守卫：两个引擎的外壳都是先套 instrument 再定义工具（源码级）", async () => {
  const { readFileSync } = await import("node:fs");
  const agUi = readFileSync("apps/server/src/engine/tool-kit.ts", "utf8");
  const mastra = readFileSync("apps/server/src/engine/mastra-tools.ts", "utf8");
  assert.match(agUi, /tools\.map\(instrument\)/, "自带引擎必须经 instrument（咽喉）");
  assert.match(mastra, /tools\.map\(instrument\)/, "Mastra 引擎必须经 instrument（咽喉）");
});

test("接线守卫：真正执行工具的地方只有这 4 个文件（多一个就说明有人绕过咽喉）", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const raw = execFileSync(
    "grep",
    ["-rnE", String.raw`\.execute\((args|inputData)`, "apps/server/src", "--include=*.ts"],
    { encoding: "utf8" },
  );
  const files = raw
    .trim()
    .split("\n")
    .filter((line) => {
      const body = line.split(":").slice(2).join(":").trim();
      return !(body.startsWith("//") || body.startsWith("*") || body.startsWith("/*"));
    })
    .map((line) => line.split(":")[0]);
  assert.deepEqual([...new Set(files)].sort(), [
    "apps/server/src/engine/mastra-engine.ts", // 工具定义内部的委托；外壳仍是 instrument
    "apps/server/src/engine/mastra-tools.ts", // Mastra 的接线：对象已经过 instrument
    "apps/server/src/engine/tool-executor.ts", // ★ 咽喉：唯一的真正执行点
    "apps/server/src/engine/tool-kit.ts", // forAgUi 的接线 + instrument：对象已经过咽喉
    "apps/server/src/live-activity.ts", // 动作上报包装层，坐在咽喉内侧
  ]);
  // 咽喉本体：执行语句就在 runToolCall 里
  assert.match(
    readFileSync("apps/server/src/engine/tool-executor.ts", "utf8"),
    /await tool\.execute\(args as never\)/,
  );
});

test("拒绝名单从配置读，能解析逗号/空格/空项", () => {
  assert.deepEqual(readToolDenyList("a, b ,,c"), ["a", "b", "c"]);
  assert.deepEqual(readToolDenyList(""), []);
  assert.deepEqual(readToolDenyList("  "), []);
});

test("纯函数：拒绝名单匹配大小写与首尾空格不敏感；措辞包含「别重试」", () => {
  assert.ok(decideDeny(" RUN_SHELL ", ["run_shell"]));
  assert.equal(decideDeny("browse_web", ["run_shell"]), null);
  assert.match(blockedMessage("x", "原因", "换个做法"), /Do not retry the same call/);
  assert.equal(needsApproval({ risk: "safe", egress: "allow" }), false);
  assert.equal(needsApproval({ risk: "moderate", egress: "allow" }), false);
  assert.equal(needsApproval({ egress: "review" }), true);
  assert.equal(needsApproval({ warnings: ["先看一眼"] }), true);
  assert.match(blockedReason({ risk: "sensitive" }), /敏感能力/);
  assert.match(blockedReason({ warnings: ["先看一眼"] }), /先看一眼/);
});
