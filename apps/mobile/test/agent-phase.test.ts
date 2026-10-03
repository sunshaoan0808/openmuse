import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionEmoji,
  agentPhase,
  agentPhaseLabel,
} from "../src/labels.ts";

test("相位优先级：用工具 > 出字 > 思考 > 后台任务 > 等审批 > 空闲", () => {
  const base = {
    inFlightTool: false,
    startedTyping: false,
    runActive: false,
    backgroundTasks: false,
    pendingApprovals: false,
  };
  assert.equal(agentPhase(base), "IDLE");
  // 逐层点亮
  assert.equal(agentPhase({ ...base, pendingApprovals: true }), "NEEDS_APPROVAL");
  assert.equal(agentPhase({ ...base, pendingApprovals: true, backgroundTasks: true }), "WAITING_FOR_SUBAGENTS");
  assert.equal(agentPhase({ ...base, pendingApprovals: true, runActive: true }), "THINKING");
  assert.equal(agentPhase({ ...base, runActive: true, startedTyping: true }), "TYPING");
  assert.equal(
    agentPhase({ ...base, runActive: true, startedTyping: true, inFlightTool: true }),
    "USING_TOOL",
  );
});

test("出字优先于思考：还没调工具但已有正文时是 TYPING，不是 THINKING", () => {
  const base = {
    inFlightTool: false,
    startedTyping: true,
    runActive: true,
    backgroundTasks: false,
    pendingApprovals: false,
  };
  assert.equal(agentPhase(base), "TYPING");
  // 一旦有在飞工具，立刻让位给 USING_TOOL
  assert.equal(agentPhase({ ...base, inFlightTool: true }), "USING_TOOL");
});

test("思考期的关键是「有话说」：runActive 但无工具无正文 = THINKING", () => {
  assert.equal(
    agentPhase({
      inFlightTool: false,
      startedTyping: false,
      runActive: true,
      backgroundTasks: true,
      pendingApprovals: true,
    }),
    "THINKING",
  );
});

test("相位文案：后台任务带数量，其余走固定词表", () => {
  assert.equal(agentPhaseLabel("THINKING"), "思考中…");
  assert.equal(agentPhaseLabel("TYPING"), "正在回复");
  assert.equal(agentPhaseLabel("NEEDS_APPROVAL"), "等你确认");
  assert.equal(agentPhaseLabel("IDLE"), "需要我就叫我");
  assert.equal(agentPhaseLabel("WAITING_FOR_SUBAGENTS", 3), "3 个任务在跑");
  assert.equal(agentPhaseLabel("WAITING_FOR_SUBAGENTS"), "后台任务在跑");
});

test("动作 emoji：认识的工具给对应表情，不认识的给兜底扳手", () => {
  assert.equal(actionEmoji("search_web"), "🔍");
  assert.equal(actionEmoji("save_document"), "📝");
  assert.equal(actionEmoji("run_computer_command"), "⌨️");
  assert.equal(actionEmoji(" totally_unknown_tool "), "🛠️");
  assert.equal(actionEmoji(""), "🛠️");
});
