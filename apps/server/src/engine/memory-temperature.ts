/**
 * 记忆的「温度 + 衰减」模型。
 *
 * 移植自 柳如烟 (Ruyan AI) `backend/memory_manager.py`（CC BY-NC-ND 4.0，仅个人非商业使用，
 * 见 `apps/server/personas/ORIGIN.md`）；该文件自述其 token 估算又移植自 Claude Code 的
 * `microCompact.ts`。
 *
 * 为什么值得移植：记忆的召回**不靠向量相似度**，靠「优先级 + 时间衰减」。遗忘是「降级」而不是
 * 删除，记忆本身仍是人可读、可版本化的纯文本 —— 所以到万级条目为止都不需要向量库。
 *
 * 与上游的差异（有意为之）：
 * - 上游从 `### [YYYY-MM-DD]` 标题里找条目日期；这里优先用记忆记录自带的 `date` 字段，
 *   找不到标题时才回退去文本里找。两种都支持。
 */

/** 🔥 燃烧 — 始终加载，不衰减 */
export const TEMP_BURNING = 3;
/** 🌡️ 温热 — 优先加载；陈旧后自动降级 */
export const TEMP_WARM = 2;
/** ❄️ 冷存 — 靠后加载（也是没有标记时的默认档） */
export const TEMP_COLD = 1;

const TEMP_TAG = /<!--\s*temp:\s*(burning|warm|cold|🔥|🌡️|❄️)\s*-->/;
const LOCKED_TAG = /<!--\s*locked\s*-->/;
const ENTRY_DATE = /^###\s*\[(\d{4})-(\d{2})-(\d{2})\]/;

const TEMP_MAP: Record<string, number> = {
  burning: TEMP_BURNING,
  "🔥": TEMP_BURNING,
  warm: TEMP_WARM,
  "🌡️": TEMP_WARM,
  cold: TEMP_COLD,
  "❄️": TEMP_COLD,
};

/** 温热记忆多少天未更新后自动降为冷存 */
export const TEMP_DECAY_DAYS = 14;
/** 衰减扫描的最小间隔：防频繁调用重复扫描 */
export const TEMP_DECAY_MIN_INTERVAL_MS = 3_600_000;

/** 读一行记忆的温度标记；无标记 = 冷存 */
export function parseTemperature(text: string): number {
  const m = TEMP_TAG.exec(text);
  return m ? (TEMP_MAP[m[1].toLowerCase()] ?? TEMP_COLD) : TEMP_COLD;
}

/** 带 `<!-- locked -->` 的记忆不参与衰减 */
export function isLocked(text: string): boolean {
  return LOCKED_TAG.test(text);
}

/** 温度对应的标记文本（写入记忆时用） */
export function temperatureTag(temp: number): string {
  if (temp >= TEMP_BURNING) return "<!-- temp:burning -->";
  if (temp === TEMP_WARM) return "<!-- temp:warm -->";
  return "<!-- temp:cold -->";
}

/**
 * 估算文本 token 数（中英混排）。中文 ~1.5 字/token，其他 ~4 字符/token，再乘 4/3 保守上浮。
 * 移植自上游同名函数（其源头是 Claude Code `microCompact.ts` 的 roughTokenCountEstimation）。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let chinese = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) chinese++;
  }
  const other = [...text].length - chinese;
  return Math.floor((chinese / 1.5 + other / 4) * (4 / 3));
}

export interface TemperatureMemory {
  id: string;
  text: string;
  date: string;
  source?: string;
  /**
   * 温度（可选的独立字段）。**本移植与原版的差异**：上游把温度写在正文里
   * （`<!-- temp:warm -->`），但这里 `memory.text` 会被 app 直接显示给用户，标记会漏到界面上，
   * 所以温度优先走本字段；内联标记仍然能解析（用于导入上游记忆文件）。
   */
  temp?: number;
}

/** 读一条记忆的温度：优先独立字段，其次正文内联标记，都没有 = 冷存 */
export function memoryTemperature(memory: TemperatureMemory): number {
  if (typeof memory.temp === "number") return memory.temp;
  return parseTemperature(memory.text);
}

/** 取记忆的日期：优先记录自带的 `date`，回退到文本里的 `### [YYYY-MM-DD]` 标题 */
export function memoryDate(memory: TemperatureMemory): number | null {
  if (memory.date) {
    const t = Date.parse(memory.date);
    if (!Number.isNaN(t)) return t;
  }
  const m = ENTRY_DATE.exec(memory.text);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** 按温度降序（燃烧在前），同温按时间降序。 */
export function sortByTemperature<T extends TemperatureMemory>(memories: T[]): T[] {
  return [...memories].sort((a, b) => {
    const dt = memoryTemperature(b) - memoryTemperature(a);
    if (dt !== 0) return dt;
    return (memoryDate(b) ?? 0) - (memoryDate(a) ?? 0);
  });
}

/**
 * 衰减扫描：🔥 不动（除非手动降级）；🌡️ 超过 `TEMP_DECAY_DAYS` 天未更新且未锁定 → ❄️；❄️ 不变。
 * 找不到日期的**保守不动**，避免把无日期记忆一刀切凉。
 *
 * 返回需要写回的降级项：`text` 仅在原温度是**内联标记**时给出（那种情况要改写正文），
 * 否则调用方只需写 `temp` 字段。调用方负责持久化。
 */
export function applyTemperatureDecay<T extends TemperatureMemory>(
  memories: T[],
  now = Date.now(),
): { patches: { id: string; temp: number; text?: string }[]; changed: number } {
  const patches: { id: string; temp: number; text?: string }[] = [];
  const cutoff = TEMP_DECAY_DAYS * 86_400_000;

  for (const memory of memories) {
    if (memoryTemperature(memory) !== TEMP_WARM) continue;
    if (isLocked(memory.text)) continue;
    const date = memoryDate(memory);
    if (date === null) continue;
    if (now - date < cutoff) continue;
    const inline = TEMP_TAG.test(memory.text);
    patches.push({
      id: memory.id,
      temp: TEMP_COLD,
      ...(inline ? { text: memory.text.replace(TEMP_TAG, temperatureTag(TEMP_COLD)) } : {}),
    });
  }

  return { patches, changed: patches.length };
}

/**
 * 挑出要注入提示词的记忆：**先按温度排序，再按 token 预算截断**。
 *
 * 这是替代「全量塞进 prompt」的那一步：高温记忆恒在，冷存记忆在预算够时才带上，
 * 超预算的部分直接丢弃（不是截断正文 —— 半条记忆比没有更糟）。
 */
export function selectMemoriesForPrompt<T extends TemperatureMemory>(
  memories: T[],
  budgetTokens: number,
): { selected: T[]; skipped: number; tokens: number } {
  const selected: T[] = [];
  let tokens = 0;
  for (const memory of sortByTemperature(memories)) {
    const cost = estimateTokens(memory.text) + 4; // + 每条的记忆开销（ID/来源/分行）
    if (tokens + cost > budgetTokens && selected.length > 0) break;
    selected.push(memory);
    tokens += cost;
  }
  return { selected, skipped: memories.length - selected.length, tokens };
}
