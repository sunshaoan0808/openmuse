/**
 * 用与服务器**完全相同**的方式建客户端并发一次流式请求，用来定位
 * "网关说 key 无效、但同一把 key 用 curl 是 200"这类矛盾。
 *
 * 与 mastra-engine.ts 的差异只有一处：baseURL 可被 DIAG_BASE_URL 覆盖 ——
 * 指到本地回声代理上，就能看清 SDK 实际发出的请求头指纹。
 *
 * 用法：
 *   node_modules/.bin/tsx scripts/check-sdk-call.ts
 *   DIAG_BASE_URL=http://127.0.0.1:9599/v1 node_modules/.bin/tsx scripts/check-sdk-call.ts
 */
import { createHash } from "node:crypto";
import "../apps/server/src/config.ts";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

const baseURL = process.env.DIAG_BASE_URL ?? process.env.OPENAI_BASE_URL;
const modelId = (process.env.MODEL ?? "").replace(/^openai\//, "");
const apiKey = process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "gateway";

console.log(`  baseURL = ${baseURL}`);
console.log(`  modelId = ${modelId}`);
console.log(
  `  key     = len=${apiKey.length} 前4=${apiKey.slice(0, 4)} ` +
    `sha256=${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`,
);
if (!baseURL || !modelId) {
  console.error("  ✖ 缺少 OPENAI_BASE_URL / MODEL");
  process.exit(2);
}

// 与 mastra-engine.ts:66 逐字一致
const gateway = createOpenAI({ baseURL, apiKey });
const agent = new Agent({
  id: "openmuse-diag",
  name: "openmuse-diag",
  instructions: "你是诊断助手。只回复用户要求的两个字。",
  model: gateway.chat(modelId),
});

try {
  const result = await agent.generate([{ role: "user", content: "说：可以" }]);
  console.log(`  ✅ 成功，回复 = ${JSON.stringify(result?.text ?? result).slice(0, 120)}`);
} catch (error) {
  const text = String(error);
  console.log(`  ❌ 失败：${text.split("\n").slice(0, 4).join(" / ").slice(0, 400)}`);
}
