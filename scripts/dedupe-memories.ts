/**
 * 记忆近重复清理。
 *
 * `id = sha256(owner+text)` 只挡得住逐字节相同的文本，挡不住"同一句话的另一种写法"。
 * 这个脚本对**已有**数据做一次归并；新写入由 `rememberMemory()` 实时归并。
 *
 * 默认 **dry-run**（只报告，不写库），确认无误再加 `--apply`：
 *   tsx scripts/dedupe-memories.ts                 # 看看会合并什么
 *   tsx scripts/dedupe-memories.ts --apply         # 真正归并
 *   tsx scripts/dedupe-memories.ts --owner xxx     # 指定 owner（默认 local-user）
 *
 * 注意：**必须**有 DATABASE_URL。没有就直接退出 —— 否则 createStore 会退回去开一个
 * 空白的嵌入式库，看着"清理成功"其实动的是另一个库。
 */
import { existsSync, readFileSync } from "node:fs";
import { createStore } from "../apps/server/src/db.ts";
import {
  dedupeOwnerMemories,
  planDedupe,
  type MemoryRecord,
} from "../apps/server/src/engine/memory-dedupe.ts";

/** 允许直接跑而不必手动 source .env。 */
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = rawValue!.trim().replace(/^["']|["']$/g, "");
  }
}

if (!process.env.DATABASE_URL) loadEnvFile(new URL("../.env", import.meta.url).pathname);
if (!process.env.DATABASE_URL) {
  console.error("  ✖ 缺少 DATABASE_URL（不会退回嵌入式库，避免误清另一个库）");
  process.exit(2);
}

const apply = process.argv.includes("--apply");
const ownerAt = process.argv.indexOf("--owner");
const owner = ownerAt >= 0 ? (process.argv[ownerAt + 1] ?? "local-user") : "local-user";

const store = await createStore({ databaseUrl: process.env.DATABASE_URL });
try {
  const all = await store.list<MemoryRecord>(owner, "memories");
  console.log(`  owner=${owner}  现有记忆 ${all.length} 条`);

  const plan = planDedupe(all);
  if (plan.absorbed.length === 0) {
    console.log("  ✓ 没有近重复，无需归并");
  } else {
    console.log(`  发现 ${plan.absorbed.length} 条近重复，计划并入 ${plan.kept.length} 条保留项中的对应条目：`);
    for (const { dropped, keeper } of plan.absorbed) {
      console.log(`    「${dropped.text}」(${dropped.id.slice(0, 8)})`);
      console.log(`      → 并入「${keeper.text}」(${keeper.id.slice(0, 8)})`);
    }
  }

  if (!apply) {
    console.log("\n  （dry-run，未写库；确认无误后加 --apply 落地）");
  } else if (plan.absorbed.length > 0) {
    const result = await dedupeOwnerMemories(store, owner);
    console.log(`\n  ✅ 已归并：${result.before} → ${result.after} 条，处理 ${result.merged.length} 组`);
    for (const group of result.merged) {
      console.log(`    保留 ${group.kept.slice(0, 8)}，删除 ${group.dropped.map((id) => id.slice(0, 8)).join(", ")}`);
    }
  }
} finally {
  await store.close();
}
