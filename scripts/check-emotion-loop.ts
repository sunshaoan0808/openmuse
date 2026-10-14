/**
 * 端到端验证情绪链路（用内存假存储 + **真实的柳如烟角色文件**）：
 *   一轮对话 → 按角色光谱算情感 → 弧线累积并落盘 → 下一轮注入提示词
 *
 * 用法：node_modules/.bin/tsx scripts/check-emotion-loop.ts
 */
import {
  advanceEmotionFromTurn,
  loadAssistantContext,
  loadEmotionState,
} from "../apps/server/src/engine/assistant-context.ts";
import { emotionPromptLine } from "../apps/server/src/engine/emotion.ts";
import { loadPersona } from "../apps/server/src/engine/personas.ts";

/** 内存版 Store：只实现这个流程用到的方法。 */
function fakeStore(seed: Record<string, Record<string, unknown>> = {}) {
  const table = new Map<string, Record<string, unknown>>(Object.entries(seed));
  return {
    table,
    db: {
      async get<T>(_owner: string, kind: string, id: string) {
        return (table.get(`${kind}/${id}`) as T | undefined) ?? null;
      },
      async list<T>(_owner: string, kind: string) {
        return [...table.entries()]
          .filter(([key]) => key.startsWith(`${kind}/`))
          .map(([, value]) => value as T);
      },
      async put<T extends { id: string }>(_owner: string, kind: string, value: T) {
        table.set(`${kind}/${value.id}`, value as unknown as Record<string, unknown>);
        return value;
      },
      async remove(_owner: string, kind: string, id: string) {
        table.delete(`${kind}/${id}`);
      },
    },
  };
}

const persona = loadPersona("liuruyan");
if (!persona) {
  console.error("  ✖ 读不到柳如烟角色文件（apps/server/personas/templates/liuruyan）");
  process.exit(2);
}
console.log(`  角色：${persona.meta.name}（${persona.meta.prototype}）`);
console.log(`  光谱：${Object.entries(persona.meta.spectrum ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")}`);

const store = fakeStore({ "agent-settings/identity": { id: "identity", name: "柳如烟", personaId: "liuruyan" } });
const service = { db: store.db } as never;
const owner = "local-user";

// 三轮都用"明显开心/感动"的输入，看弧线是否升温
const turns: { user: string; assistant: string }[] = [
  { user: "谢谢你，太棒了！", assistant: "能帮上你就好。" },
  { user: "真的谢谢你，太厉害了", assistant: "这点小事，不用谢。" },
  { user: "谢谢你，辛苦了", assistant: "我不累。" },
];

for (const [index, turn] of turns.entries()) {
  const state = await advanceEmotionFromTurn(service, owner, [
    { role: "user", content: turn.user },
    { role: "assistant", content: turn.assistant },
  ]);
  if (!state) {
    console.error(`    第 ${index + 1} 轮：没有产生状态`);
    continue;
  }
  console.log(
    `    第 ${index + 1} 轮「${turn.user}」→ ${state.current} ` +
      `强度 ${state.intensity}  弧线 ${state.arc.state}(连${state.arc.consecutiveCount})  ` +
      `峰值 ${state.arc.peak.emotion}@${state.arc.peak.avgIntensity}`,
  );
}

const persisted = await loadEmotionState(service, owner);
console.log(`\n  落盘状态：${persisted?.current} / ${persisted?.intensity} / ${persisted?.arc.state}`);
console.log(`  注入行：${emotionPromptLine(persisted) ?? "（平静，不注入）"}`);

const context = await loadAssistantContext(service as never, owner);
console.log(`\n  提示词片段总长 ${context.block.length} 字符`);
const lines = context.block.split("\n").filter((line) => line.includes("【"));
console.log(`  片段中的结构标记：${lines.map((line) => line.slice(0, 30)).join(" | ")}`);
console.log(`  情绪段是否已在片段里：${context.block.includes("【当前情绪】") ? "是" : "否"}`);
console.log(`  情绪是否随角色光谱计算（contextLevel=2）：${persisted?.contextLevel === 2 ? "是" : "否"}`);
