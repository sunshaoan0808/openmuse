import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTerminalTurnStatus,
  RECLAIM_GRACE_MS,
  shouldReclaimRun,
} from "../src/run-watchdog.ts";

test("只有终态才算终态 —— running 不算", () => {
  assert.equal(isTerminalTurnStatus("succeeded"), true);
  assert.equal(isTerminalTurnStatus("failed"), true);
  assert.equal(isTerminalTurnStatus("interrupted"), true);
  assert.equal(isTerminalTurnStatus("running"), false);
  assert.equal(isTerminalTurnStatus(undefined), false);
  assert.equal(isTerminalTurnStatus(null), false);
  assert.equal(isTerminalTurnStatus(42), false);
});

test("客户端说在跑 + 服务端已终态 → 收回运行态", () => {
  assert.equal(shouldReclaimRun(true, "succeeded"), true);
  assert.equal(shouldReclaimRun(true, "interrupted"), true);
});

test("不该误收的情况：客户端本来没在跑，或服务端还在跑", () => {
  // 没在跑就没什么可收回的
  assert.equal(shouldReclaimRun(false, "succeeded"), false);
  // 服务端还在 running —— 这是一轮正常的长回复，绝不能去打断它
  assert.equal(shouldReclaimRun(true, "running"), false);
  // 还没拿到 turn 记录（刚进会话），此时不动手
  assert.equal(shouldReclaimRun(true, undefined), false);
});

test("宽限期必须为正，否则会在正常收尾时误发停止请求", () => {
  assert.ok(RECLAIM_GRACE_MS > 0);
});
