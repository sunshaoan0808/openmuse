/**
 * 用**库里真实数据**验证：把真记忆喂进温度模型，看最终会拼进提示词的到底是什么。
 * 只读、不写库。用法：
 *   psql "$DATABASE_URL" -t -A -c "select json_agg(data) from records where kind='memories'" > /tmp/memories.json
 *   node_modules/.bin/tsx scripts/check-real-memories.ts /tmp/memories.json [personaId]
 */
import { readFileSync } from "node:fs";
import { loadAssistantContext } from "../apps/server/src/engine/assistant-context.ts";
import { memoryTemperature, estimateTokens } from "../apps/server/src/engine/memory-temperature.ts";

const file = process.argv[2] ?? "/tmp/memories.json";
const personaId = process.argv[3] ?? "";

const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
const memories = (Array.isArray(raw) ? raw : []).map((m) => ({
  id: String((m as { id: string }).id),
  text: String((m as { text: string }).text),
  source: String((m as { source: string }).source ?? ""),
  createdAt: String((m as { createdAt: string }).createdAt),
  temp: (m as { temp?: number }).temp,
}));

console.log(`  读入真实记忆 ${memories.length} 条：`);
for (const m of memories) {
  const ageDays = Math.round((Date.now() - Date.parse(m.createdAt)) / 86_400_000);
  const label = memoryTemperature(m) === 3 ? "🔥燃烧" : memoryTemperature(m) === 2 ? "🌡️温热" : "❄️冷存";
  console.log(
    `    ${label}  ${ageDays} 天前  ${m.text.slice(0, 40)}  (${estimateTokens(m.text)} tok)`,
  );
}

const service = {
  db: {
    get: async () => ({ name: "OpenMuse", tone: "warm", ...(personaId ? { personaId } : {}) }),
    list: async () => memories,
    put: async () => null,
  },
} as never;

const ctx = await loadAssistantContext(service, "local-user");
console.log(`\n  personaId=${personaId || "(未绑定)"} → persona=${ctx.persona?.id ?? "null"}`);
console.log(`  注入记忆 ${ctx.memoryCount} 条 / 约 ${ctx.memoryTokens} tokens；丢弃 ${ctx.memorySkipped} 条`);
console.log(`  片段总长 ${ctx.block.length} 字符 / 约 ${estimateTokens(ctx.block)} tokens`);
if (ctx.block) {
  console.log("  ---- 记忆部分 ----");
  const idx = ctx.block.indexOf("【长期记忆】");
  console.log(
    (idx >= 0 ? ctx.block.slice(idx) : "（未生成记忆段）").split("\n").map((l) => `  ${l}`).join("\n"),
  );
  if (ctx.persona) {
    console.log("  ---- 角色部分（前 200 字）----");
    console.log(`  ${ctx.block.slice(0, 200).replace(/\n/g, "\n  ")}`);
  }
}
