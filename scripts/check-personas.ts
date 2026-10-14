import {
  applyTemperatureDecay,
  estimateTokens,
  parseTemperature,
  selectMemoriesForPrompt,
  sortByTemperature,
  TEMP_BURNING,
  TEMP_COLD,
  TEMP_WARM,
} from "../apps/server/src/engine/memory-temperature.ts";
import {
  listPersonaTemplates,
  loadPersona,
  personaPromptBlock,
  resolvePersonasDir,
} from "../apps/server/src/engine/personas.ts";

console.log("=== 路径解析 ===");
console.log("  personas 根目录:", resolvePersonasDir());

console.log("\n=== 14 个模板的 Schema v2 校验 ===");
const templates = listPersonaTemplates();
console.log(`  载入 ${templates.length} 个`);
let bad = 0;
for (const t of templates) {
  const flag = t.validation.length ? `✗ ${t.validation.join("; ")}` : "✓";
  if (t.validation.length) bad++;
  console.log(
    `  ${flag.padEnd(4)} ${t.id.padEnd(16)} ${String(t.meta.name ?? "").padEnd(8)} ${String(
      t.meta.prototype ?? "",
    ).padEnd(6)} 光谱${Object.keys(t.meta.spectrum ?? {}).length}维 魅力${(t.meta.charm_layers as unknown[])?.length ?? 0}层`,
  );
}
console.log(`  合计：${templates.length - bad} 通过 / ${bad} 有问题`);

console.log("\n=== 载入一个角色并拼提示词 ===");
const p = loadPersona("hanqingxue");
if (p) {
  const block = personaPromptBlock(p);
  console.log(`  韩清雪：soul=${p.files.soul?.length}B genome=${p.files.genome?.length}B personality=${p.files.personality?.length}B`);
  console.log(`  提示词片段 ${block.length} 字符 / 约 ${estimateTokens(block)} tokens`);
  console.log("  ---- 前 420 字 ----");
  console.log(block.slice(0, 420).split("\n").map((l) => "  " + l).join("\n"));
}

console.log("\n=== 温度模型 ===");
console.log("  无标记 →", parseTemperature("普通一行"), "(应为 1=冷存)");
console.log("  🔥 标记 →", parseTemperature("这条很重要 <!-- temp:burning -->"));
console.log("  locked  →", parseTemperature("温热但锁定 <!-- temp:warm --> <!-- locked -->"));

const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
const fresh = new Date().toISOString();
const memories = [
  { id: "m1", text: "刚说的重要事 <!-- temp:warm -->", date: fresh },
  { id: "m2", text: "30 天前的温热记忆 <!-- temp:warm -->", date: old },
  { id: "m3", text: "锁定的老记忆 <!-- temp:warm --> <!-- locked -->", date: old },
  { id: "m4", text: "永恒记忆 <!-- temp:burning -->", date: old },
  { id: "m5", text: "冷存的旧事", date: old },
];
const decay = applyTemperatureDecay(memories);
console.log(`  衰减扫描：${decay.changed} 条降级（期望 1 —— 只有 m2）`);
for (const patch of decay.patches) console.log(`    ${patch.id} → ${patch.text}`);

const order = sortByTemperature(memories).map((m) => `${m.id}(${parseTemperature(m.text)})`);
console.log("  温度降序:", order.join(" "), "（期望 m4 燃烧在最前）");

const pick = selectMemoriesForPrompt(memories, 12);
console.log(
  `  预算 12 tokens → 取 ${pick.selected.length}/${memories.length} 条，用 ${pick.tokens} tokens，丢弃 ${pick.skipped} 条`,
);
for (const s of pick.selected) console.log(`    · ${s.text.slice(0, 40)} (${estimateTokens(s.text)} tok)`);

console.log("\n=== 边界 ===");
console.log("  空角色 id →", loadPersona(null)?.id ?? "null", "（运行态角色）");
console.log("  不存在的 id →", loadPersona("nope-missing"));
console.log("  温度常量:", TEMP_BURNING, TEMP_WARM, TEMP_COLD);
