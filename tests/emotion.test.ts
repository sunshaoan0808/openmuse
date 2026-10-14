import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeEmotion,
  applyEmotionUpdate,
  detectNegation,
  emotionPromptLine,
  emptyEmotionState,
  findPeakEmotion,
  type EmotionAnalysis,
} from "../apps/server/src/engine/emotion.ts";

/** 柳如烟的真实光谱（templates/liuruyan/meta.json），用于验证"角色天赋影响情绪"。 */
const LIURUYAN_SPECTRUM = {
  warmth: 0.78,
  intelligence: 0.85,
  loyalty: 0.8,
  charm: 0.95,
  independence: 0.75,
  vulnerability: 0.65,
  expressiveness: 0.72,
};

test("detectNegation 只认关键词之前的否定词（不再自我抵消）", () => {
  // 「喜欢」前面有「不」→ 抵消
  assert.equal(detectNegation("我不喜欢这个", "我不喜欢这个".indexOf("喜欢")), true);
  // 「不要脸」自身含「不要」，但前面没有否定词 → 不抵消（上游会误判）
  assert.equal(detectNegation("不要脸", "不要脸".indexOf("不要脸")), false);
  // 关键词在开头，前面没内容
  assert.equal(detectNegation("喜欢", 0), false);
});

test("否定生效：『我不喜欢这个』不该被记成开心", () => {
  const result = analyzeEmotion("我不喜欢这个", "");
  assert.equal(result.emotion, "平静", "被否定的开心不该得分");
  assert.equal(result.rawScores.开心, undefined);
  assert.match(result.reason, /否定/);
});

test("『不要脸』这类关键词不会被自身包含的否定词抵消", () => {
  const result = analyzeEmotion("不要脸", "");
  assert.ok((result.rawScores.傲娇 ?? 0) > 0, "傲娇应当得分");
});

test("无角色光谱时退化为纯关键词（contextLevel=1）", () => {
  const result = analyzeEmotion("谢谢你，太棒了", "");
  assert.equal(result.emotion, "开心");
  assert.equal(result.contextLevel, 1);
});

test("角色光谱真的参与加权：忠诚高的角色，感动被放大、傲娇被压制", () => {
  const withSpectrum = analyzeEmotion("辛苦了", "", { loyalty: 1 });
  assert.equal(withSpectrum.rawScores.感动, 1, "关键词基础分是 1");
  assert.equal(withSpectrum.weightedScores.感动, 1.3, "loyalty=1 → ×1.3");
  assert.equal(withSpectrum.contextLevel, 2);

  const proud = analyzeEmotion("哼", "", { loyalty: 1 });
  assert.equal(proud.weightedScores.傲娇, 0.8, "loyalty=1 → 傲娇 ÷1.25 记作 ×0.8");
});

test("表达力是全局缩放：expressiveness=1 → 所有情感 ×1.2", () => {
  const result = analyzeEmotion("哼", "", { expressiveness: 1 });
  assert.equal(result.weightedScores.傲娇, 1.2);
});

test("同一句话会因为角色光谱不同而落到不同情感 —— 这才是光谱的意义", () => {
  // 「谢谢你」同时命中 开心(谢谢) 与 感动(谢谢你)，基础分并列 1.0。
  // 无光谱时按关键词表顺序，开心在前 → 开心胜。
  const plain = analyzeEmotion("谢谢你", "");
  assert.equal(plain.rawScores.开心, 1);
  assert.equal(plain.rawScores.感动, 1);
  assert.equal(plain.emotion, "开心", "并列时按关键词表顺序，开心在前");

  // 柳如烟的光谱里，感动被三重加成（loyalty 0.8 boost + warmth 0.78 boost + charm 0.95 boost），
  // 开心只有两重（warmth + charm）→ 胜负翻转成感动。
  const asLiuruyan = analyzeEmotion("谢谢你", "", LIURUYAN_SPECTRUM);
  assert.equal(asLiuruyan.emotion, "感动", "高忠诚 + 高温度 + 高魅力的角色，更容易被感动");
  assert.equal(asLiuruyan.contextLevel, 2);
  assert.ok(asLiuruyan.weightedScores.感动! > asLiuruyan.weightedScores.开心!);
  assert.ok(asLiuruyan.weightedScores.感动! > asLiuruyan.rawScores.感动!, "光谱应当放大感动");
  assert.match(asLiuruyan.reason, /光谱调整/);
});

test("情感方向看的是用户在说自己还是在说助手", () => {
  assert.equal(analyzeEmotion("我今天很累", "").direction, "user");
  assert.equal(analyzeEmotion("你辛苦了", "").direction, "assistant");
  assert.equal(analyzeEmotion("我懂你", "").direction, "mutual");
  assert.equal(analyzeEmotion("今天下雨", "").direction, "neutral");
});

test("弧线：从平静切过去算切换，之后同情感连续触发才升温，第 3 次转 rising", () => {
  const analysis: EmotionAnalysis = {
    emotion: "开心",
    intensity: 0.5,
    reason: "",
    contextLevel: 1,
    rawScores: {},
    weightedScores: {},
    direction: "user",
  };

  // 第一次是从「平静」切换过去 —— 不是延续，所以计数为 0、强度向旧值平滑
  const first = applyEmotionUpdate(null, analysis);
  assert.equal(first.current, "开心");
  assert.equal(first.arc.consecutiveCount, 0, "切换不累加计数");
  assert.equal(first.arc.state, "transitioning");
  assert.equal(first.intensity, Math.round((0.5 * 0.85 + 0.5 * 0.15) * 100) / 100);

  const second = applyEmotionUpdate(first, analysis);
  assert.equal(second.arc.consecutiveCount, 1);
  assert.equal(second.arc.state, "stable");
  assert.equal(second.intensity, 0.55, "0.5 + 1×0.05");

  const third = applyEmotionUpdate(second, analysis);
  assert.equal(third.arc.consecutiveCount, 2);
  assert.equal(third.intensity, 0.6, "0.5 + 2×0.05");

  const fourth = applyEmotionUpdate(third, analysis);
  assert.equal(fourth.arc.state, "rising");
  assert.equal(fourth.intensity, 0.65, "0.5 + 3×0.05");
  assert.equal(fourth.arc.peak.emotion, "开心");

  // 切换情感：连续计数清零，且因为此前已是 3 连（成弧），过渡更保守
  const switched = applyEmotionUpdate(fourth, { ...analysis, emotion: "感动" });
  assert.equal(switched.current, "感动");
  assert.equal(switched.arc.consecutiveCount, 0);
  assert.equal(switched.arc.state, "transitioning");
  assert.equal(switched.intensity, Math.round((0.5 * 0.7 + 0.65 * 0.3) * 100) / 100);
});

test("弧线与历史都只保留最近 N 条，不会无限增长", () => {
  let state = emptyEmotionState();
  for (let index = 0; index < 40; index++) {
    state = applyEmotionUpdate(state, {
      emotion: index % 2 === 0 ? "开心" : "担忧",
      intensity: 0.5,
      reason: "",
      contextLevel: 1,
      rawScores: {},
      weightedScores: {},
      direction: "user",
    });
  }
  assert.equal(state.arc.history.length, 10);
  assert.equal(state.history.length, 20);
  assert.ok(state.updatedAt);
});

test("findPeakEmotion 取累计强度最高的那种情感", () => {
  const peak = findPeakEmotion([
    { emotion: "开心", intensity: 0.5, at: "2026-01-01T00:00:00Z" },
    { emotion: "开心", intensity: 0.6, at: "2026-01-01T00:01:00Z" },
    { emotion: "感动", intensity: 0.9, at: "2026-01-01T00:02:00Z" },
  ]);
  assert.equal(peak.emotion, "开心");
  assert.equal(peak.count, 2);
  assert.equal(peak.avgIntensity, 0.55);
});

test("提示词注入：平静且低强度不注入（省 token）", () => {
  const calm = { ...emptyEmotionState(), current: "平静", intensity: 0.5 };
  assert.equal(emotionPromptLine(calm), null);
  assert.equal(emotionPromptLine(null), null);

  const happy = { ...emptyEmotionState(), current: "开心", intensity: 0.8 };
  const line = emotionPromptLine(happy);
  assert.ok(line?.includes("开心"));
  assert.ok(line?.includes("0.80"));

  const rising = {
    ...happy,
    arc: { ...happy.arc, state: "rising" as const, consecutiveCount: 4 },
  };
  assert.match(emotionPromptLine(rising) ?? "", /升温/);
});
