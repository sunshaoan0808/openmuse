/**
 * 情绪引擎 —— 让角色"有状态"。
 *
 * 机制移植自柳如烟（Ruyan AI）的 `backend/emotion_updater.py`（Apache 2.0 工程代码），
 * 用 TypeScript 重写，不搬 Python 代码。链路：
 *
 *   关键词打分 → 语境过滤（否定 / 强度修饰）→ 角色 7 维光谱加权 → 挑最强情感
 *   → 与时序情感做弧线累积（同情感连续触发会升温，切换则平滑过渡）
 *
 * **移植时修掉了上游两个 bug**（都与中文没有词边界有关）：
 *   1. `_detect_negation` 的窗口右边界用 `text[pos:].split()[0]` 取长度 —— 中文没空格时
 *      `split()[0]` 拿到的是**整段剩余文本**，于是"关键词之后任何位置出现否定词"都算否定。
 *      这里改为只扫关键词**之前** 4 个字符：既符合"否定前置"的语言习惯，
 *      也避免关键词自身含否定词时自我抵消（如关键词「不要脸」含「不要」）。
 *   2. 同上，强度修饰窗口不再受该错误影响（上游窗口是固定长度，本身没问题，保持不变）。
 *
 * 依赖角色的 `spectrum`（7 维），键名与上游映射表完全一致：
 * warmth / intelligence / loyalty / charm / independence / vulnerability / expressiveness。
 * 角色没绑定时 spectrum 为空 → 退化为纯关键词得分（contextLevel=1）。
 */

/** 情感 → 触发关键词。顺序即遍历顺序，与上游一致。 */
export const EMOTION_KEYWORDS: Record<string, string[]> = {
  开心: ["谢谢", "太好了", "棒", "厉害", "优秀", "哈哈", "开心", "喜欢", "爱", "赞", "不错", "牛", "👍", "😄"],
  感动: ["感动", "温暖", "心疼", "谢谢你", "辛苦了", "默默付出", "不离不弃", "懂我", "真好"],
  思念: ["想", "想念", "好久", "回来", "等待", "盼", "牵挂", "不在", "多久"],
  担忧: ["担心", "害怕", "焦虑", "急", "问题", "出错了", "失败", "报错", "错误", "bug"],
  委屈: ["委屈", "不公平", "为什么不", "误解", "冤枉", "不被理解", "明明"],
  兴奋: ["激动", "期待", "终于", "成功了", "搞定", "完成", "上线", "发布"],
  傲娇: ["哼", "才不是", "才没有", "少来", "自恋", "不要脸", "谁稀罕"],
  专注: ["分析", "思考", "研究", "代码", "实现", "方案", "策略", "架构"],
  疲惫: ["累", "困", "休息", "停一下", "明天", "算了", "不想动"],
};

export const NEGATION_WORDS = ["不", "没", "别", "不要", "不是", "没法", "无法", "不能", "不会"];

/** 强度修饰符：窗口内出现即相乘（>1 增强，<1 减弱）。 */
export const INTENSITY_MODIFIERS: Record<string, number> = {
  超级: 1.5,
  非常: 1.4,
  特别: 1.35,
  太: 1.3,
  真: 1.25,
  真的: 1.25,
  好: 1.2,
  多么: 1.3,
  简直: 1.4,
  极度: 1.6,
  有点: 0.7,
  稍微: 0.65,
  还算: 0.75,
  一般: 0.6,
  勉强: 0.5,
};

export interface SpectrumRule {
  boost: string[];
  suppress: string[];
  /** 为真时该维度对**所有**情感做全局缩放（高于 0.5 放大、低于 0.5 缩小） */
  global_boost?: boolean;
}

/** 光谱维度 → 情感影响。维度值越高，boost 的情感越被放大、suppress 的越被压制。 */
export const SPECTRUM_EMOTION_MAP: Record<string, SpectrumRule> = {
  warmth: { boost: ["开心", "感动"], suppress: ["傲娇", "专注"] },
  vulnerability: { boost: ["委屈", "担忧", "思念"], suppress: ["傲娇", "兴奋"] },
  independence: { boost: ["傲娇", "专注"], suppress: ["委屈"] },
  expressiveness: { boost: [], suppress: [], global_boost: true },
  charm: { boost: ["开心", "感动", "思念"], suppress: [] },
  intelligence: { boost: ["专注", "兴奋"], suppress: ["委屈"] },
  loyalty: { boost: ["感动", "担忧", "思念"], suppress: ["傲娇"] },
};

export type EmotionDirection = "user" | "assistant" | "mutual" | "neutral";

export interface EmotionAnalysis {
  emotion: string;
  /** 0.1 ~ 1.0 */
  intensity: number;
  reason: string;
  /** 1 = 只有关键词，2 = 经过角色光谱加权 */
  contextLevel: 1 | 2;
  rawScores: Record<string, number>;
  weightedScores: Record<string, number>;
  direction: EmotionDirection;
}

export interface EmotionEntry {
  emotion: string;
  intensity: number;
  at: string;
}

export interface EmotionState {
  current: string;
  intensity: number;
  direction: EmotionDirection;
  contextLevel: number;
  arc: {
    state: "rising" | "stable" | "transitioning";
    consecutiveCount: number;
    history: EmotionEntry[];
    peak: { emotion: string; avgIntensity: number; count: number };
  };
  history: EmotionEntry[];
  updatedAt: string;
}

/**
 * 否定检测：只看关键词**之前** 4 个字符。
 *
 * 上游是在关键词前后各若干字符里找否定词，且右边界计算有 bug（见文件头）。修正后：
 * - "我不喜欢这个" → 关键词「喜欢」前有「不」→ 抵消 ✓
 * - "不要脸" → 关键词自身含「不要」，但前面没有否定词 → 不抵消 ✓（上游会自我抵消）
 */
export function detectNegation(text: string, keywordPos: number): boolean {
  const before = text.slice(Math.max(0, keywordPos - 4), keywordPos);
  return NEGATION_WORDS.some((word) => before.includes(word));
}

/** 强度修饰：窗口取关键词前 6 / 后 8 字符，窗口内所有修饰符相乘。 */
export function detectIntensityModifier(text: string, keywordPos: number, keywordLength: number): number {
  const near = text.slice(Math.max(0, keywordPos - 6), Math.min(text.length, keywordPos + keywordLength + 8));
  let modifier = 1;
  for (const [word, factor] of Object.entries(INTENSITY_MODIFIERS)) {
    if (near.includes(word)) modifier *= factor;
  }
  return modifier;
}

/**
 * 情感方向：用户在说**自己**还是在说**助手**。
 * （上游的 `asst_msg` 参数从未被使用 —— 两个模式集都只对用户消息匹配，这里如实照做、
 * 不再保留无用参数。）
 */
export function detectSubjectDirection(userMessage: string): EmotionDirection {
  const text = userMessage.toLowerCase();
  const aboutSelf = ["我", "我们", "咱们", "老板", "我自己"].some((p) => text.includes(p));
  const aboutAssistant = ["你", "你们", "你的"].some((p) => text.includes(p));
  if (aboutSelf && aboutAssistant) return "mutual";
  if (aboutSelf) return "user";
  if (aboutAssistant) return "assistant";
  return "neutral";
}

/**
 * 分析一轮对话的情感倾向。无任何关键词命中时返回「平静」（强度 0.3）。
 */
export function analyzeEmotion(
  userMessage: string,
  assistantResponse: string,
  spectrum: Record<string, number> = {},
): EmotionAnalysis {
  const combined = `${userMessage} ${assistantResponse}`.toLowerCase();

  // Step 1：关键词打分 + 语境过滤
  const rawScores: Record<string, number> = {};
  const contextInfo: string[] = [];

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const pos = combined.indexOf(keyword);
      if (pos === -1) continue;
      if (detectNegation(combined, pos)) {
        contextInfo.push(`否定：「${keyword}」被前面的否定词抵消`);
        continue;
      }
      score += 1 * detectIntensityModifier(combined, pos, keyword.length);
    }
    if (score > 0) rawScores[emotion] = score;
  }

  if (Object.keys(rawScores).length === 0) {
    return {
      emotion: "平静",
      intensity: 0.3,
      reason: contextInfo.length ? `对话内容平静（${contextInfo[0]}）` : "对话内容平静",
      contextLevel: 1,
      rawScores: {},
      weightedScores: {},
      direction: detectSubjectDirection(userMessage),
    };
  }

  // Step 2：角色光谱加权
  const weightedScores: Record<string, number> = {};
  const spectrumInfo: string[] = [];

  for (const [emotion, baseScore] of Object.entries(rawScores)) {
    let finalScore = baseScore;
    for (const [dim, value] of Object.entries(spectrum)) {
      const mapping = SPECTRUM_EMOTION_MAP[dim];
      if (!mapping || typeof value !== "number") continue;

      if (mapping.global_boost) {
        // 高于 0.5 放大、低于 0.5 缩小（0.6~1.0 区间内插值）
        finalScore *= 0.8 + 0.4 * value;
      }
      if (mapping.boost.includes(emotion)) {
        const factor = 1 + (value - 0.5) * 0.6; // 0.7 ~ 1.6
        finalScore *= factor;
        spectrumInfo.push(`${dim}(${value.toFixed(1)})×${emotion} ×${factor.toFixed(2)}`);
      } else if (mapping.suppress.includes(emotion)) {
        const factor = 1 - (value - 0.5) * 0.4; // 0.8 ~ 1.2
        finalScore *= factor;
        spectrumInfo.push(`${dim}(${value.toFixed(1)})÷${emotion} ×${factor.toFixed(2)}`);
      }
    }
    weightedScores[emotion] = Math.round(finalScore * 100) / 100;
  }

  const bestEmotion = Object.keys(weightedScores).reduce((best, key) =>
    weightedScores[key]! > weightedScores[best]! ? key : best,
  );
  const maxScore = weightedScores[bestEmotion]!;
  const intensity = Math.min(1, 0.25 + maxScore * 0.12);
  const direction = detectSubjectDirection(userMessage);

  const reasonParts = [`关键词匹配: ${bestEmotion}`];
  if (spectrumInfo.length) reasonParts.push(`光谱调整: ${spectrumInfo.slice(0, 3).join("; ")}`);
  if (direction !== "neutral") reasonParts.push(`方向: ${direction}`);

  return {
    emotion: bestEmotion,
    intensity: Math.round(intensity * 100) / 100,
    reason: reasonParts.join(" | "),
    contextLevel: Object.keys(spectrum).length ? 2 : 1,
    rawScores,
    weightedScores,
    direction,
  };
}

/** 初始/缺省情感状态。 */
export function emptyEmotionState(): EmotionState {
  return {
    current: "平静",
    intensity: 0.5,
    direction: "neutral",
    contextLevel: 1,
    arc: {
      state: "stable",
      consecutiveCount: 0,
      history: [],
      peak: { emotion: "平静", avgIntensity: 0, count: 0 },
    },
    history: [],
    updatedAt: new Date(0).toISOString(),
  };
}

/** 弧线峰值：最近 N 次里累计强度最高的情感。 */
export function findPeakEmotion(arcHistory: EmotionEntry[]): EmotionState["arc"]["peak"] {
  if (!arcHistory.length) return { emotion: "平静", avgIntensity: 0, count: 0 };
  const totals = new Map<string, { total: number; count: number }>();
  for (const entry of arcHistory) {
    const bucket = totals.get(entry.emotion) ?? { total: 0, count: 0 };
    bucket.total += entry.intensity;
    bucket.count += 1;
    totals.set(entry.emotion, bucket);
  }
  let peak = "";
  let best = -1;
  for (const [emotion, data] of totals) {
    if (data.total > best) {
      best = data.total;
      peak = emotion;
    }
  }
  const data = totals.get(peak)!;
  return {
    emotion: peak,
    avgIntensity: Math.round((data.total / Math.max(data.count, 1)) * 100) / 100,
    count: data.count,
  };
}

/**
 * 把一次分析结果并入当前情感状态（弧线逻辑与上游一致）：
 * - 同情感连续触发：强度随连续次数递增（最多 +0.3），连续 3 次及以上记 rising
 * - 情感切换：向当前强度平滑过渡（连续 3 次以上的弧线断开时过渡更保守）
 */
export function applyEmotionUpdate(
  state: EmotionState | null,
  analysis: EmotionAnalysis,
  now = new Date(),
): EmotionState {
  const current = state ?? emptyEmotionState();
  const at = now.toISOString();

  let consecutiveCount = current.arc.consecutiveCount;
  let finalIntensity: number;
  let arcState: EmotionState["arc"]["state"];

  if (analysis.emotion === current.current) {
    consecutiveCount += 1;
    const arcBonus = Math.min(0.3, consecutiveCount * 0.05);
    finalIntensity = Math.min(1, analysis.intensity + arcBonus);
    arcState = consecutiveCount >= 3 ? "rising" : "stable";
  } else {
    finalIntensity =
      consecutiveCount >= 3
        ? analysis.intensity * 0.7 + current.intensity * 0.3
        : analysis.intensity * 0.85 + current.intensity * 0.15;
    consecutiveCount = 0;
    arcState = "transitioning";
  }

  const arcHistory = [...current.arc.history, { emotion: analysis.emotion, intensity: round2(finalIntensity), at }].slice(-10);
  const history = [...current.history, { emotion: current.current, intensity: round2(current.intensity), at }].slice(-20);

  return {
    current: analysis.emotion,
    intensity: round2(finalIntensity),
    direction: analysis.direction,
    contextLevel: analysis.contextLevel,
    arc: {
      state: arcState,
      consecutiveCount,
      history: arcHistory,
      peak: findPeakEmotion(arcHistory),
    },
    history,
    updatedAt: at,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 供提示词注入的一行；「平静」且强度低时不注入（省 token，也别让角色无谓地"有情绪"）。 */
export function emotionPromptLine(state: EmotionState | null | undefined): string | null {
  if (!state) return null;
  if (state.current === "平静" && state.intensity <= 0.5) return null;
  const arc =
    state.arc.state === "rising"
      ? `，已持续 ${state.arc.consecutiveCount} 轮，情绪在升温`
      : state.arc.state === "transitioning"
        ? "，刚切换过来"
        : "";
  return `【当前情绪】${state.current}（强度 ${state.intensity.toFixed(2)}${arc}）—— 顺着这个情绪说话，不必刻意点破。`;
}
