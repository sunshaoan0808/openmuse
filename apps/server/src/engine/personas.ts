/**
 * 角色（persona）加载与校验。
 *
 * 内容资产来自 柳如烟 (Ruyan AI) `agents/`（CC BY-NC-ND 4.0，**仅个人非商业使用**，见
 * `apps/server/personas/ORIGIN.md`），规范见 `personas/templates/SCHEMA.md`（Schema v2）。
 *
 * 两层结构：
 * - **模板层** `personas/templates/<id>/` —— `meta.json`（结构化人格参数）+ SOUL/GENOME/PERSONALITY/IDENTITY
 * - **运行态** `personas/runtime/` —— 当前生效角色的实际状态（多一个 EMOTION.json / USER.md / MEMORY.md）
 *
 * 分层的关键不是"多几个文件"，而是**可变性分级**：GENOME 是出厂设定（改动需明确确认）、
 * SOUL/PERSONALITY 会随相处成长、EMOTION 是即时状态、USER/MEMORY 是不断累积的上下文。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPersonaSummary } from "../../../../packages/domain/src/agent.ts";

/** Schema v2 的 10 大原型（`meta.prototype` 必须取其中之一） */
export const PERSONA_PROTOTYPES = [
  "万界型",
  "冷傲型",
  "灵动型",
  "睿智型",
  "忠诚型",
  "温润型",
  "冷峻型",
  "洒脱型",
  "沉稳型",
  "邪魅型",
] as const;

/** Schema v2 的 7 维人格光谱（`meta.spectrum` 必须且只能含这 7 个键） */
export const PERSONA_SPECTRUM_KEYS = [
  "warmth",
  "intelligence",
  "loyalty",
  "charm",
  "independence",
  "vulnerability",
  "expressiveness",
] as const;

export const SPECTRUM_LABELS: Record<string, string> = {
  warmth: "温度",
  intelligence: "智慧",
  loyalty: "忠诚",
  charm: "魅力",
  independence: "独立",
  vulnerability: "脆弱",
  expressiveness: "表达",
};

export interface PersonaMeta {
  name?: string;
  prototype?: string;
  gender?: string;
  description?: string;
  one_line?: string;
  core?: string;
  avatar?: string;
  order?: number;
  charm_layers?: unknown;
  spectrum?: Record<string, number>;
  charm_nuke?: string;
  jealousy_style?: string;
  comfort_style?: string;
  care_style?: string;
  like_style?: string;
  is_template?: boolean;
  template_id?: string;
  meta?: { version?: number; created?: string; design_philosophy?: string };
}

export interface LoadedPersona {
  id: string;
  source: "template" | "runtime";
  meta: PersonaMeta;
  files: {
    soul?: string;
    genome?: string;
    personality?: string;
    identity?: string;
    user?: string;
    memory?: string;
  };
  emotion?: { current?: string; intensity?: number; history?: unknown[] };
  /** 非空 = 该角色文件不符合 Schema v2（仍可用，但会在日志里提示） */
  validation: string[];
}

/** 角色资产的根目录：环境变量优先，其次按源码/产物两种布局依次探测。 */
export function resolvePersonasDir(): string | null {
  const candidates: string[] = [];
  const override = process.env.OPENMUSE_PERSONAS_DIR?.trim();
  if (override) candidates.push(override);
  try {
    candidates.push(fileURLToPath(new URL("../../personas/", import.meta.url)));
  } catch {
    /* 非 file: URL（打包场景）——忽略 */
  }
  candidates.push(join(process.cwd(), "apps/server/personas"));
  candidates.push(join(process.cwd(), "personas"));
  for (const dir of candidates) {
    if (existsSync(join(dir, "templates"))) return dir;
  }
  return null;
}

function readIfExists(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 按 Schema v2 校验 `meta.json`。返回错误列表（空 = 通过）。
 * 规则取自上游 `SCHEMA.md` 的「校验规则」一节，逐条对应。
 */
export function validateTemplateMeta(meta: PersonaMeta, dirName: string): string[] {
  const errors: string[] = [];
  if (!meta.prototype || !(PERSONA_PROTOTYPES as readonly string[]).includes(meta.prototype))
    errors.push(`prototype 必须是 10 大原型之一，当前=${JSON.stringify(meta.prototype)}`);
  if (!Array.isArray(meta.charm_layers) || meta.charm_layers.length !== 4)
    errors.push("charm_layers 必须是 4 元素字符串数组");
  else if (!meta.charm_layers.every((x) => typeof x === "string"))
    errors.push("charm_layers 的元素必须都是字符串");
  const keys = meta.spectrum ? Object.keys(meta.spectrum) : [];
  if (!meta.spectrum) errors.push("缺少 spectrum");
  else {
    const missing = PERSONA_SPECTRUM_KEYS.filter((k) => !(k in (meta.spectrum as Record<string, number>)));
    const extra = keys.filter((k) => !(PERSONA_SPECTRUM_KEYS as readonly string[]).includes(k));
    if (missing.length) errors.push(`spectrum 缺少维度：${missing.join(", ")}`);
    if (extra.length) errors.push(`spectrum 含未定义维度：${extra.join(", ")}`);
  }
  if (meta.template_id && meta.template_id !== dirName)
    errors.push(`template_id(${meta.template_id}) 与目录名(${dirName}) 不一致`);
  if (meta.avatar !== undefined && [...String(meta.avatar)].length > 2)
    errors.push(`avatar 应是单个 emoji，当前=${JSON.stringify(meta.avatar)}`);
  if (meta.meta && meta.meta.version !== 2)
    errors.push(`meta.version 必须为 2，当前=${String(meta.meta.version)}`);
  return errors;
}

function loadDir(dir: string, id: string, source: "template" | "runtime"): LoadedPersona {
  const metaRaw = readIfExists(join(dir, "meta.json"));
  let meta: PersonaMeta = {};
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw) as PersonaMeta;
    } catch {
      meta = {};
    }
  }
  const files: LoadedPersona["files"] = {
    soul: readIfExists(join(dir, "SOUL.md")),
    genome: readIfExists(join(dir, "GENOME.md")),
    personality: readIfExists(join(dir, "PERSONALITY.md")),
    identity: readIfExists(join(dir, "IDENTITY.md")),
    user: readIfExists(join(dir, "USER.md")),
    memory: readIfExists(join(dir, "MEMORY.md")),
  };
  const emotionRaw = readIfExists(join(dir, "EMOTION.json"));
  let emotion: LoadedPersona["emotion"];
  if (emotionRaw) {
    try {
      emotion = JSON.parse(emotionRaw) as LoadedPersona["emotion"];
    } catch {
      emotion = undefined;
    }
  }
  return { id, source, meta, files, emotion, validation: validateTemplateMeta(meta, id) };
}

/** 列出全部模板（含校验结果），供设置页/调试用。 */
export function listPersonaTemplates(): LoadedPersona[] {
  const root = resolvePersonasDir();
  if (!root) return [];
  const dir = join(root, "templates");
  let entries: string[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const out = entries.map((id) => loadDir(join(dir, id), id, "template"));
  return out.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999));
}

/**
 * 带缓存的模板清单：设置页/快照会频繁取，而角色文件是磁盘上的静态资产。
 * TTL 30 秒 —— 手改角色文件后最多半分钟生效，不值得为此每次请求都读盘。
 */
const TEMPLATES_TTL_MS = 30_000;
let templatesCache: { at: number; items: LoadedPersona[] } | null = null;

export function listPersonaTemplatesCached(): LoadedPersona[] {
  const now = Date.now();
  if (templatesCache && now - templatesCache.at < TEMPLATES_TTL_MS) return templatesCache.items;
  const items = listPersonaTemplates();
  templatesCache = { at: now, items };
  return items;
}

/** 角色 → 对外摘要（设置页列表用；不带 SOUL/GENOME 正文） */
export function personaSummary(persona: LoadedPersona): AgentPersonaSummary {
  const meta = persona.meta;
  return {
    id: persona.id,
    name: meta.name ?? persona.id,
    prototype: meta.prototype,
    gender: meta.gender,
    description: meta.description,
    oneLine: meta.one_line,
    core: meta.core,
    avatar: meta.avatar,
    order: meta.order ?? 999,
    spectrum: meta.spectrum,
    charmLayers: Array.isArray(meta.charm_layers) ? (meta.charm_layers as string[]) : undefined,
  };
}

/**
 * 载入指定角色：先找模板，再找运行态；`id` 为空时返回运行态角色（即"当前生效的那个"）。
 */
export function loadPersona(id?: string | null): LoadedPersona | null {
  const root = resolvePersonasDir();
  if (!root) return null;
  const key = id?.trim();
  if (key) {
    const asTemplate = join(root, "templates", key);
    if (existsSync(asTemplate)) return loadDir(asTemplate, key, "template");
    const asRuntime = join(root, "runtime", key);
    if (existsSync(asRuntime)) return loadDir(asRuntime, key, "runtime");
    return null;
  }
  const runtime = join(root, "runtime");
  return existsSync(runtime) ? loadDir(runtime, "runtime", "runtime") : null;
}

function spectrumLine(spectrum?: Record<string, number>): string | null {
  if (!spectrum) return null;
  const parts = PERSONA_SPECTRUM_KEYS.filter((k) => typeof spectrum[k] === "number").map(
    (k) => `${SPECTRUM_LABELS[k] ?? k} ${spectrum[k]}`,
  );
  return parts.length ? parts.join(" · ") : null;
}

/**
 * 把角色拼成提示词片段。
 *
 * 优先级声明很重要：角色只影响**语气与视角**，不得覆盖工具纪律与安全约束 ——
 * 否则一个人设写得强硬的角色就能让 agent 开始编造工具结果。
 */
export function personaPromptBlock(persona: LoadedPersona | null): string {
  if (!persona) return "";
  const meta = persona.meta;
  const head: string[] = [];
  head.push(`【角色】${meta.name ?? persona.id}${meta.prototype ? `（${meta.prototype}）` : ""}`);
  if (meta.core) head.push(`核心底色：${meta.core}`);
  if (meta.description) head.push(`定位：${meta.description}`);
  const spec = spectrumLine(meta.spectrum);
  if (spec) head.push(`人格光谱：${spec}`);
  if (Array.isArray(meta.charm_layers))
    head.push(`魅力层次：${(meta.charm_layers as string[]).join(" → ")}`);
  const styles = [
    meta.jealousy_style && `吃醋方式：${meta.jealousy_style}`,
    meta.comfort_style && `安慰方式：${meta.comfort_style}`,
    meta.care_style && `关心方式：${meta.care_style}`,
    meta.like_style && `喜欢方式：${meta.like_style}`,
    meta.charm_nuke && `终极一幕：${meta.charm_nuke}`,
  ].filter(Boolean) as string[];
  if (styles.length) head.push(...styles);

  const body: string[] = [];
  if (persona.files.genome) body.push(`## GENOME（出厂设定，未经明确确认不得改写）\n${persona.files.genome.trim()}`);
  if (persona.files.soul) body.push(`## SOUL\n${persona.files.soul.trim()}`);
  if (persona.files.personality) body.push(`## PERSONALITY\n${persona.files.personality.trim()}`);
  if (persona.files.identity) body.push(`## IDENTITY\n${persona.files.identity.trim()}`);
  if (persona.emotion?.current)
    body.push(
      `## 当前情绪\n${persona.emotion.current}${
        typeof persona.emotion.intensity === "number" ? `（强度 ${persona.emotion.intensity}）` : ""
      }`,
    );
  if (persona.files.user) body.push(`## 关于用户\n${persona.files.user.trim()}`);

  return [
    "\n\n【角色设定】以下定义你的语气、称呼与视角。它**只影响表达**：",
    "工具纪律、事实准确性、安全与审批约束恒优先；不得因为人设而编造工具结果或跳过确认。",
    head.join("\n"),
    body.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
