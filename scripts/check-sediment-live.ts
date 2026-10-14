/**
 * 真机验证记忆自动沉淀：**不注入假补全**，直接打真实网关 + 真实模型，
 * 走完 提炼 → 解析 → 落库 的整条链路。
 *
 * 需要 .env 里的 OPENAI_BASE_URL / OPENAI_API_KEY（SEDIMENT_MODEL 可选）。
 * 用法：node_modules/.bin/tsx scripts/check-sediment-live.ts
 */
import { existsSync, readFileSync } from "node:fs";
import type { MemoryRecord } from "../apps/server/src/engine/memory-dedupe.ts";
import {
  buildSedimentPrompt,
  sedimentTurnMemories,
} from "../apps/server/src/engine/memory-sediment.ts";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = match;
    if (process.env[key!] === undefined) process.env[key!] = raw!.trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(new URL("../.env", import.meta.url).pathname);

console.log(`  网关：${process.env.OPENAI_BASE_URL ?? "（未配置）"}`);
console.log(`  沉淀模型：${process.env.SEDIMENT_MODEL ?? process.env.MODEL ?? "（未配置）"}`);
console.log(`  key：${process.env.OPENAI_API_KEY ? `已配置 len=${process.env.OPENAI_API_KEY.length}` : "未配置"}`);
console.log(`  超时：${Number(process.env.SEDIMENT_TIMEOUT_MS ?? 0) || "默认 30s"}`);

/** 内存版存储，让这次验证不碰真实数据库。 */
function memoryStore(seed: MemoryRecord[] = []) {
  const rows = [...seed];
  return {
    rows,
    async list<T>(_: string, __: string) {
      return rows as unknown as T[];
    },
    async put<T extends { id: string }>(_: string, __: string, value: T) {
      const at = rows.findIndex((row) => row.id === value.id);
      if (at >= 0) rows[at] = value as unknown as MemoryRecord;
      else rows.push(value as unknown as MemoryRecord);
      return value;
    },
    async remove(_: string, __: string, id: string) {
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) rows.splice(at, 1);
    },
  };
}

const store = memoryStore([
  { id: "a".repeat(64), text: "我的代号是「白虎」。", temp: 2, source: "User confirmed in chat" },
]);

const userText = "顺便说一下，我一般晚上十点以后写代码最顺，白天反而写不出来。另外以后叫我白虎就行。";
const assistantText = "明白了白虎，晚上十点以后是你的高效时段，我记下了。";

console.log("\n  ---- 送给模型的提示词（前 300 字）----");
console.log(
  buildSedimentPrompt(
    store.rows.map((memory) => ({ id: memory.id, text: memory.text })),
    userText,
    assistantText,
  )
    .slice(0, 300)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n"),
);

const started = Date.now();
const outcome = await sedimentTurnMemories(store, "local-user", userText, assistantText);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n  ---- 结果（${elapsed}s）----`);
console.log(`  跳过原因：${outcome.skipped ?? "（无，正常处理）"}`);
console.log(`  新增 ${outcome.added.length} 条：`);
for (const item of outcome.added) {
  console.log(`    ${item.merged ? "并入既有" : "新写入  "}  ${item.text}`);
}
console.log(`  修正 ${outcome.revised.length} 条：`);
for (const item of outcome.revised) {
  console.log(`    「${item.from}」 → 「${item.to}」`);
}
console.log(`  库内最终 ${store.rows.length} 条：`);
for (const row of store.rows) {
  console.log(`    [${row.source ?? "-"}] temp=${row.temp ?? "-"}  ${row.text}`);
}
