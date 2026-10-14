/**
 * 复现服务端调模型的**每一个环节**：同一套 .env 加载（config.ts）、同一个 SDK
 * （@ai-sdk/openai）、同一个模型 id、同一个网关地址。
 *
 * 目的：把"网关拒绝"拆成两种可能 ——
 *   (a) 代码/配置本身有问题（这个脚本也会失败）
 *   (b) 只有**正在运行的服务进程**的环境有问题（这个脚本会成功）
 *
 * 用法：node_modules/.bin/tsx scripts/check-gateway-sdk.ts
 */
import "../apps/server/src/config.ts";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const baseURL = process.env.OPENAI_BASE_URL;
const modelId = (process.env.MODEL ?? "").replace(/^openai\//, "");
const rawKey = process.env.OPENAI_API_KEY;
const apiKey = rawKey ?? process.env.DEEPSEEK_API_KEY ?? "gateway";

console.log(`  baseURL   = ${baseURL}`);
console.log(`  modelId   = ${modelId}`);
console.log(`  key 来源  = ${rawKey ? "OPENAI_API_KEY" : process.env.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY(兜底)" : "字面量 'gateway'(兜底!)"}`);
console.log(`  key 长度  = ${apiKey.length}  前缀 = ${apiKey.slice(0, 4)}`);
console.log(`  sha256 头 = ${(await import("node:crypto")).createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`);

console.log("\n  ---- 先用裸 fetch 打一次（对照组）----");
try {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 5 }),
  });
  console.log(`  fetch → HTTP ${res.status} ${(await res.text()).slice(0, 90)}`);
} catch (error) {
  console.log(`  fetch → 失败 ${String(error).slice(0, 120)}`);
}

console.log("\n  ---- 再用服务端同一个 SDK 打一次 ----");
const gateway = createOpenAI({ baseURL, apiKey });
try {
  const result = await generateText({
    model: gateway.chat(modelId),
    prompt: "只回复两个字：可以",
  });
  console.log(`  SDK → OK，回复 = ${JSON.stringify(result.text)}`);
} catch (error) {
  console.log(`  SDK → 失败：${String(error).split("\n").slice(0, 3).join(" / ").slice(0, 300)}`);
}
