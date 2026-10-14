/**
 * 记忆自动沉淀 —— 补上"这段对话值不值得记"的判断。
 *
 * 此前只有模型**主动**调 `remember_fact` 才写记忆，等于把"该不该记"完全交给模型临场发挥。
 * 这里在每轮对话结束后跑一次轻量提炼：把既有记忆 + 刚发生的一轮丢给模型，
 * 要它只输出结构化 JSON（新增哪些事实、哪条既有记忆需要修正），再落到库里。
 *
 * 三条设计约束：
 *  1. **确定性 id**：`memoryId()` 只由文本决定（`sha256("memory:" + JSON.stringify(text))`）。
 *     对话路径的 `key()` 里含每轮不同的 `requestKey`，所以那边算出来的 id 每轮都不同、
 *     `insertIfAbsent` 事实上从不生效 —— 这是近重复堆积的根因。沉淀侧不再犯这个错：
 *     同一句话永远映射到同一个 id。
 *  2. **写入必过去重**：新增走 `rememberMemory()`（近重复归并），全部处理完再跑一次
 *     `dedupeOwnerMemories()`，收拾"修正后与另一条撞车"的情况。
 *  3. **绝不记凭据**：`looksLikeSecret()` 在落库前拦一道 —— 密码、token、私钥不进长期记忆。
 *
 * 沉淀失败一律静默：它是后台优化，不能影响对话。
 */
import { createHash } from "node:crypto";
import { dedupeOwnerMemories, rememberMemory, type MemoryRecord, type MemoryStore } from "./memory-dedupe.ts";
import { TEMP_WARM } from "./memory-temperature.ts";

/**
 * 低于这个长度不沉淀。
 *
 * 中文信息密度高，闸门必须放低：7 个字的「我改名叫白虎了」是完整且值得记的事实。
 * 真正的过滤交给两层 —— 纯应答正则（挡住"好的好的"这类）与模型自己的判断。
 */
export const MIN_USER_CHARS = 5;
/** 纯应答没有可记内容（长度闸门挡不住"好的好的""嗯嗯嗯"）。 */
const ACK_PATTERN = /^(好的?|嗯+|哦+|啊+|可以|行|继续|谢谢|哈哈+|收到|明白|懂了|ok|okay|yes|no|thx)[。！!~～\s]*$/i;
/** 同一个 owner 的沉淀最小间隔，避免连发消息时每轮都调模型。 */
export const MIN_INTERVAL_MS = 15_000;
/** 单次补全的超时。 */
export const COMPLETE_TIMEOUT_MS = 30_000;

const MAX_ADDS = 5;
const MAX_REVISES = 3;
const MAX_ITEM_CHARS = 200;

/** 确定性记忆 id：只由文本决定，跨轮稳定。 */
export function memoryId(text: string): string {
  return createHash("sha256").update(`memory:${JSON.stringify(text)}`).digest("hex");
}

/**
 * 明显是凭据的文本不该进长期记忆。宁可漏拦（模型也可能把 token 说成别的样子），
 * 也不放过最常见的几种形态。
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /zen-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export interface SedimentPlan {
  add: string[];
  revise: { id: string; text: string }[];
}

const EMPTY_PLAN: SedimentPlan = { add: [], revise: [] };

/** 模型返回短 id（前 12 位）即可，这里按前缀还原成完整 id；有歧义就丢弃那一条。 */
export function resolveShortId(short: string, known: string[]): string | null {
  const needle = short.trim().toLowerCase();
  if (!needle) return null;
  const hits = known.filter((id) => id.toLowerCase().startsWith(needle));
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * 解析模型输出。模型不总是乖乖只吐 JSON（常见：包在 ``` 里、前后加解释），
 * 所以先剥代码块，再退化为"取第一个平衡的 {...}"。解析不出来就当没有内容。
 */
export function parseSedimentPlan(raw: string, knownIds: string[] = []): SedimentPlan {
  if (!raw?.trim()) return EMPTY_PLAN;
  const withoutFence = raw.replace(/```(?:json)?/gi, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) return EMPTY_PLAN;

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return EMPTY_PLAN;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_PLAN;

  const raw_add = (parsed as { add?: unknown }).add;
  const raw_revise = (parsed as { revise?: unknown }).revise;

  const add: string[] = [];
  if (Array.isArray(raw_add)) {
    for (const item of raw_add) {
      // 模型不总给字符串数组：ministral 这类会给 {"fact": "..."}。
      // 认这两种形态，别的当没看见。
      const candidate =
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? (["fact", "text", "memory"] as const)
                .map((field) => (item as Record<string, unknown>)[field])
                .find((value): value is string => typeof value === "string") ?? ""
            : "";
      const text = candidate.trim().slice(0, MAX_ITEM_CHARS);
      if (!text || looksLikeSecret(text)) continue;
      if (!add.includes(text)) add.push(text);
      if (add.length >= MAX_ADDS) break;
    }
  }

  const revise: { id: string; text: string }[] = [];
  if (Array.isArray(raw_revise)) {
    for (const item of raw_revise) {
      if (!item || typeof item !== "object") continue;
      const shortId = (item as { id?: unknown }).id;
      const text = (item as { text?: unknown }).text;
      if (typeof shortId !== "string" || typeof text !== "string") continue;
      const resolved = resolveShortId(shortId, knownIds);
      if (!resolved) continue; // 认不出是哪条 —— 宁可不动，也不猜
      const nextText = text.trim().slice(0, MAX_ITEM_CHARS);
      if (!nextText || looksLikeSecret(nextText)) continue;
      if (revise.some((entry) => entry.id === resolved)) continue;
      revise.push({ id: resolved, text: nextText });
      if (revise.length >= MAX_REVISES) break;
    }
  }

  return { add, revise };
}

/** 提炼提示词。显式列明"什么不该记"，否则模型会把寒暄和过程都记下来。 */
export function buildSedimentPrompt(
  existing: { id: string; text: string }[],
  userText: string,
  assistantText: string,
): string {
  const known =
    existing.length > 0
      ? existing.map((memory) => `- ${memory.id.slice(0, 12)}  ${memory.text}`).join("\n")
      : "（还没有任何记忆）";
  return [
    "你在做长期记忆沉淀：从刚发生的一轮对话里，挑出**值得长期记住**的、关于用户的稳定信息。",
    "",
    "该记：身份与称呼、长期偏好与习惯、明确说过的好恶、重要的约定或边界、用户纠正过的错误认知。",
    "不该记：一次性的任务过程、寒暄与客套、助手自己说的话、临时的中间状态、",
    "密码/token/密钥等任何凭据（绝对不要记）。",
    "",
    "已有的长期记忆（开头是短标识，修正时引用它）：",
    known,
    "",
    "刚发生的一轮对话：",
    `用户：${userText.slice(0, 2000)}`,
    `助手：${assistantText.slice(0, 2000)}`,
    "",
    "如果新对话与某条已有记忆**矛盾**（用户改了主意、或之前记错了），把它放进 revise 修正。",
    "如果没有任何值得记或需要修正的，两个数组都留空 —— 宁可不记，也别记废话。",
    "",
    '只输出 JSON，不要解释、不要 Markdown 代码块：{"add":["..."],"revise":[{"id":"短标识","text":"修正后的事实"}]}',
  ].join("\n");
}

export interface SedimentDeps {
  /** 单次补全。默认走 OPENAI_BASE_URL 的 OpenAI 兼容端点；测试里注入假实现。 */
  complete?: (prompt: string) => Promise<{ text?: string; error?: string }>;
}

export interface SedimentOutcome {
  added: { text: string; merged: boolean }[];
  revised: { id: string; from: string; to: string }[];
  skipped: string | null;
}

/** 默认补全实现：与 `vision.ts` 同一条路子（OpenAI 兼容 /chat/completions）。 */
async function defaultComplete(prompt: string): Promise<{ text?: string; error?: string }> {
  const base = process.env.OPENAI_BASE_URL?.replace(/\/+$/, "");
  if (!base) return { error: "未配置 OPENAI_BASE_URL" };
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPENAI_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: process.env.SEDIMENT_MODEL ?? process.env.MODEL ?? "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        // 预算要给足：推理类模型会先花一大截在 reasoning 上，给太少会拿到空 content
        // （实测 max_tokens=10 时 content 为 null，模型把额度全用在推理里了）。
        max_tokens: 1200,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string; code?: string };
    };
    // 网关会把上游错误包在 HTTP 200 里透传（顶层 error + 空 choices）—— 这种不能当"没有内容"放过
    if (data?.error) return { error: `网关报错：${data.error.message ?? data.error.code ?? "未知"}` };
    const text = data?.choices?.[0]?.message?.content;
    return text ? { text } : { error: "模型没有返回内容" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const lastRunAt = new Map<string, number>();

/**
 * 一轮结束后沉淀记忆。返回本次做了什么（供日志/自检脚本观察）。
 *
 * 静默失败：任何环节出问题都只是"这次没记"，绝不影响对话。
 */
export async function sedimentTurnMemories(
  store: MemoryStore,
  owner: string,
  userText: string,
  assistantText: string,
  deps: SedimentDeps = {},
): Promise<SedimentOutcome> {
  const nothing = { added: [], revised: [], skipped: null } as SedimentOutcome;

  const trimmed = userText.trim();
  if (trimmed.length < MIN_USER_CHARS || ACK_PATTERN.test(trimmed)) {
    return { ...nothing, skipped: "用户消息过短或只是应答" };
  }
  if (!assistantText.trim()) return { ...nothing, skipped: "没有助手回复" };

  const last = lastRunAt.get(owner) ?? 0;
  if (Date.now() - last < MIN_INTERVAL_MS) return { ...nothing, skipped: "距上次沉淀太近" };

  const complete = deps.complete ?? defaultComplete;

  try {
    const existing = await store.list<MemoryRecord>(owner, "memories");
    const prompt = buildSedimentPrompt(
      existing.map((memory) => ({ id: memory.id, text: memory.text })),
      userText,
      assistantText,
    );

    // 先占位再调用：并发进来时后一次的间隔检查会命中，避免同一轮重复沉淀
    lastRunAt.set(owner, Date.now());

    const { text, error } = await complete(prompt);
    if (error || !text) return { ...nothing, skipped: error ?? "没有输出" };

    const plan = parseSedimentPlan(text, existing.map((memory) => memory.id));
    if (!plan.add.length && !plan.revise.length) return { ...nothing, skipped: "没有值得记的内容" };

    const added: SedimentOutcome["added"] = [];
    for (const item of plan.add) {
      const result = await rememberMemory(store, owner, {
        id: memoryId(item),
        text: item,
        source: "自动沉淀",
        createdAt: new Date().toISOString(),
        temp: TEMP_WARM,
      });
      added.push({ text: result.memory.text, merged: result.action === "merged" });
    }

    const revised: SedimentOutcome["revised"] = [];
    for (const item of plan.revise) {
      const target = existing.find((memory) => memory.id === item.id);
      if (!target || target.text === item.text) continue;
      await store.put(owner, "memories", {
        ...target,
        text: item.text,
        // 修正后仍是"用户刚确认过的事实"，所以重新计入温热
        temp: Math.max(typeof target.temp === "number" ? target.temp : TEMP_WARM, TEMP_WARM),
        updatedAt: new Date().toISOString(),
        revisedFrom: target.text,
      });
      revised.push({ id: target.id, from: target.text, to: item.text });
    }

    // 修正可能让两条撞成同一句话 —— 用既有的归并收尾
    if (revised.length) await dedupeOwnerMemories(store, owner);

    return { added, revised, skipped: null };
  } catch (error) {
    return { ...nothing, skipped: error instanceof Error ? error.message : String(error) };
  }
}

/** 供测试复位节流状态。 */
export function resetSedimentThrottle(): void {
  lastRunAt.clear();
}

/**
 * 从一轮产出的消息里取「最后一条用户消息 + 助手回复」。
 *
 * 入参是 SSE 组装出来的 `StoredMessage`，字段是 `unknown`（见 `chat-turns.ts`），
 * 所以在这里收窄。情绪推进与记忆沉淀共用这一份，免得两处各写一份、日后漂移。
 */
export function extractTurnTexts(messages: readonly Record<string, unknown>[]): {
  userText: string;
  assistantText: string;
} {
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const userText = text(
    [...messages].reverse().find((message) => message.role === "user")?.content,
  );
  const assistantText = messages
    .filter((message) => message.role === "assistant")
    .map((message) => text(message.content))
    .join("\n");
  return { userText, assistantText };
}
