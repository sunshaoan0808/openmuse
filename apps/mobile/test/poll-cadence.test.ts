import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentWorkspace } from "../../../packages/domain/src/agent";
import { BUSY_POLL_MS, hasActiveWork, IDLE_POLL_MS, nextPollDelay } from "../src/poll-cadence";

const ws = (over: Partial<AgentWorkspace>) => ({ tasks: [], ...over }) as AgentWorkspace;

test("有空转的任务时按忙时节奏", () => {
  const data = ws({ tasks: [{ id: "t1", status: "running" } as never] });
  assert.equal(hasActiveWork(data), true);
  assert.equal(nextPollDelay(data), BUSY_POLL_MS);
});

test("刚上报过实时活动时也算在动", () => {
  const data = ws({ live: [{ threadId: "a", label: "正在搜索网页" }] } as never);
  assert.equal(nextPollDelay(data), BUSY_POLL_MS);
});

test("等审批/等输入也算在动（用户随手一答就该立刻跟上）", () => {
  for (const status of ["queued", "scheduled", "waiting_approval", "waiting_input"]) {
    assert.equal(
      nextPollDelay(ws({ tasks: [{ id: "t", status } as never] })),
      BUSY_POLL_MS,
      status,
    );
  }
});

test("全静下来就放宽到闲时间隔", () => {
  const data = ws({ tasks: [{ id: "t", status: "succeeded" } as never] });
  assert.equal(hasActiveWork(data), false);
  assert.equal(nextPollDelay(data), IDLE_POLL_MS);
});

test("还没拿到数据时按忙时（首屏要快）", () => {
  assert.equal(nextPollDelay(undefined), BUSY_POLL_MS);
});

test("闲时间隔至少是忙时的 3 倍（这就是省下来的流量）", () => {
  assert.ok(IDLE_POLL_MS >= BUSY_POLL_MS * 3);
});
