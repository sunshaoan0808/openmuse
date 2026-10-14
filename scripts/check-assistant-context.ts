/**
 * 验证「角色 + 记忆」真的拼进了提示词，且记忆受温度排序与预算约束。
 * 用桩 service（不连库）跑，便于在 CI/本地快速回归。
 */
import { estimateTokens } from "../apps/server/src/engine/memory-temperature.ts";
import { loadAssistantContext, memoryPromptBlock } from "../apps/server/src/engine/assistant-context.ts";
import { TEMP_BURNING, TEMP_COLD, TEMP_WARM } from "../apps/server/src/engine/memory-temperature.ts";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

function stubService(identity: unknown, memories: unknown[]) {
  const writes: unknown[] = [];
  return {
    writes,
    service: {
      db: {
        get: async () => identity,
        list: async () => memories,
        put: async (_owner: string, _kind: string, value: unknown) => {
          writes.push(value);
          return value;
        },
      },
    } as never,
  };
}

function report(title: string, block: string) {
  console.log(`\n=== ${title} ===`);
  console.log(`  片段 ${block.length} 字符 / 约 ${estimateTokens(block)} tokens`);
  for (const line of block.split("\n")) if (line.trim()) console.log(`  | ${line.slice(0, 110)}`);
}

// ① 绑定了角色 + 有记忆
{
  const { service } = stubService({ name: "OpenMuse", tone: "warm", personaId: "hanqingxue" }, [
    { id: "a", text: "老板在北京，常用中文", source: "chat", createdAt: iso(1), temp: TEMP_WARM },
    { id: "b", text: "老板讨厌重复确认，尽量一次做完", source: "chat", createdAt: iso(2), temp: TEMP_BURNING },
    { id: "c", text: "很久以前记的、不重要的事", source: "chat", createdAt: iso(200), temp: TEMP_COLD },
  ]);
  const ctx = await loadAssistantContext(service, "owner-1");
  report("① 绑定角色 + 3 条记忆", ctx.block);
  console.log(`  统计：personaId=${ctx.personaId} 注入记忆 ${ctx.memoryCount} 条 / 约 ${ctx.memoryTokens} tokens / 丢弃 ${ctx.memorySkipped}`);
}

// ② 没角色（回落到运行态角色），无记忆
{
  const { service } = stubService({ name: "OpenMuse", tone: "warm" }, []);
  const ctx = await loadAssistantContext(service, "owner-2");
  report("② 身份未绑定角色 + 无记忆", ctx.block || "（空片段 → 行为与接入前一致）");
  console.log(`  统计：personaId=${ctx.personaId} persona=${ctx.persona?.id ?? "null"} 记忆 ${ctx.memoryCount} 条`);
}

// ③ 预算截断：塞 40 条长记忆，看是否被砍
{
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    text: `第 ${i} 条记忆：${"内容".repeat(40)}`,
    source: "chat",
    createdAt: iso(i),
    temp: i < 3 ? TEMP_BURNING : TEMP_COLD,
  }));
  const { service } = stubService({ name: "OpenMuse", tone: "concise" }, many);
  const ctx = await loadAssistantContext(service, "owner-3");
  console.log("\n=== ③ 40 条记忆的预算截断 ===");
  console.log(`  注入 ${ctx.memoryCount} 条（约 ${ctx.memoryTokens} tokens），丢弃 ${ctx.memorySkipped} 条`);
  console.log(`  前 3 条是燃烧档，应全部保留：${ctx.memories.slice(0, 3).map((m) => m.id).join(", ")}`);
}

// ④ 衰减：温热 + 30 天前 → 应产生一次写回，降为冷存
{
  const { service, writes } = stubService({ name: "OpenMuse", tone: "warm" }, [
    { id: "old", text: "30 天前的温热记忆", source: "chat", createdAt: iso(30), temp: TEMP_WARM },
    { id: "locked", text: "锁定的老记忆 <!-- locked -->", source: "chat", createdAt: iso(30), temp: TEMP_WARM },
    { id: "fresh", text: "刚记的温热记忆", source: "chat", createdAt: iso(1), temp: TEMP_WARM },
  ]);
  await loadAssistantContext(service, "owner-4");
  console.log("\n=== ④ 温度衰减（每小时最多扫一次）===");
  console.log(`  写回 ${writes.length} 条（期望 1 —— 只有 30 天前那条；锁定的不动）`);
  for (const w of writes) console.log(`    ${JSON.stringify(w)}`);
}

// ⑤ 直接测记忆片段：显式预算
{
  const picked = memoryPromptBlock(
    [
      { id: "x", text: "冷的", source: "s", createdAt: iso(100), temp: TEMP_COLD },
      { id: "y", text: "热的", source: "s", createdAt: iso(100), temp: TEMP_BURNING },
    ],
    8,
  );
  console.log("\n=== ⑤ 预算只够一条时应优先保燃烧档 ===");
  console.log(`  选中 ${picked.used} 条 →`, JSON.stringify(picked.items.map((i) => i.text)));
  console.log(`  丢弃 ${picked.skipped} 条`);
}
