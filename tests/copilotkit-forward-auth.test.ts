import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** 断言前剥注释：上面的说明里就有 "authorization"/"forwardHeaders" 字样，不剥会误报 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const source = strip(
  readFileSync(new URL("../apps/server/src/agent.ts", import.meta.url), "utf8"),
);

/**
 * 守一条极难定位的回归：**入站 Authorization 被转发到模型调用**。
 *
 * 现场症状：app 聊天一直失败（网关回 `401 Invalid API key`），但同一把 key
 * 用 curl 或直接调 agent 都是 200 —— 只有走 HTTP 聊天这条路才 401。
 *
 * 链路：CopilotKit 运行时按设计把入站 `authorization` 转发到 agent 上
 * （默认黑名单只挡 `x-forwarded-*` 之类代理头），`@ag-ui/mastra` 又把它塞进模型调用的
 * `modelSettings.headers`，于是 app 的会话令牌覆盖掉 provider 的 apiKey 发给了网关。
 *
 * 所以 CopilotRuntime 必须显式拒绝转发 authorization。这条断言就是防它被删掉。
 */
test("CopilotRuntime 必须拒绝转发入站 authorization", () => {
  assert.match(
    source,
    /deny:\s*\[[^\]]*["']authorization["'][^\]]*\]/i,
    "agent.ts 里应有一处 deny 名单包含 authorization",
  );
  const constructions = source.match(/new CopilotRuntime\(\{/g) ?? [];
  assert.ok(constructions.length >= 2, "两条运行时分支（Intelligence / SSE）都应存在");
  const withPolicy = source.match(/forwardHeaders:\s*FORWARD_HEADERS/g) ?? [];
  assert.equal(
    withPolicy.length,
    constructions.length,
    "每个 new CopilotRuntime 都必须带上 forwardHeaders，否则又会有分支把会话令牌漏给模型",
  );
});
