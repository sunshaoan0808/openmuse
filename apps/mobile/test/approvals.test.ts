import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVAL_SCOPES,
  approvalSummary,
  approveBody,
  approveIdempotencyKey,
  denyBody,
  denyIdempotencyKey,
  isApprovalScope,
  parseApprovals,
  scopeLabel,
} from "../src/approvals";

const row = (over: Record<string, unknown> = {}) => ({
  id: "20261015112611418-89f4583e",
  tool: "browse_web",
  reason: "该能力是敏感能力，需要你先批准这一次调用",
  risk: "sensitive",
  threadId: "t-1",
  requestedAt: "2026-10-15T11:26:11.418Z",
  status: "pending",
  ...over,
});

test("parseApprovals：只留 pending，别的状态一律不要", () => {
  const parsed = parseApprovals({
    approvals: [
      row({ id: "a", status: "pending" }),
      row({ id: "b", status: "approved" }),
      row({ id: "c", status: "denied" }),
    ],
  });
  assert.deepEqual(
    parsed.map((a) => a.id),
    ["a"],
  );
});

test("parseApprovals：按请求时间倒序（最近的在前）", () => {
  const parsed = parseApprovals({
    approvals: [
      row({ id: "old", requestedAt: "2026-10-15T10:00:00.000Z" }),
      row({ id: "new", requestedAt: "2026-10-15T12:00:00.000Z" }),
      row({ id: "mid", requestedAt: "2026-10-15T11:00:00.000Z" }),
    ],
  });
  assert.deepEqual(
    parsed.map((a) => a.id),
    ["new", "mid", "old"],
  );
});

test("parseApprovals：坏行丢弃而不是让界面崩（缺 id / 缺 tool / 非对象）", () => {
  const parsed = parseApprovals({
    approvals: [
      row({ id: "ok" }),
      row({ id: "" }), // 空 id
      row({ id: "no-tool", tool: null }), // 缺工具名
      null,
      "垃圾",
      42,
    ],
  });
  assert.deepEqual(
    parsed.map((a) => a.id),
    ["ok"],
  );
});

test("parseApprovals：返回体不是 { approvals: [] } 时安静给空列表，不抛错", () => {
  for (const payload of [undefined, null, {}, { approvals: "nope" }, { approvals: null }, []]) {
    assert.deepEqual(parseApprovals(payload), []);
  }
});

test("parseApprovals：字段缺失给兜底（reason/risk/threadId/requestedAt 可缺）", () => {
  const [only] = parseApprovals({
    approvals: [row({ reason: undefined, risk: undefined, threadId: undefined, requestedAt: undefined })],
  });
  assert.equal(only.reason, null);
  assert.equal(only.risk, null);
  assert.equal(only.threadId, null);
  assert.equal(only.requestedAt, null);
});

test("approvalSummary：有理由用理由，没理由退回「<工具> 需要你确认」", () => {
  const [withReason] = parseApprovals({ approvals: [row()] });
  assert.equal(approvalSummary(withReason), "该能力是敏感能力，需要你先批准这一次调用");
  const [noReason] = parseApprovals({ approvals: [row({ reason: "   " })] });
  assert.equal(approvalSummary(noReason), "browse_web 需要你确认后才能执行");
});

test("档位：只认三档，标签固定，顺序固定", () => {
  assert.deepEqual([...APPROVAL_SCOPES], ["once", "session", "24h"]);
  assert.equal(scopeLabel("once"), "只允许这一次");
  assert.equal(scopeLabel("session"), "本会话内");
  assert.equal(scopeLabel("24h"), "24 小时内");
  assert.equal(isApprovalScope("once"), true);
  assert.equal(isApprovalScope("always"), false);
  assert.equal(isApprovalScope(""), false);
  assert.equal(isApprovalScope(undefined), false);
});

test("approveBody：非法档位在本地就被拦下（返回 null，不发请求）", () => {
  assert.deepEqual(approveBody("once"), { scope: "once" });
  assert.deepEqual(approveBody("24h"), { scope: "24h" });
  for (const bad of ["always", "ONCE", "", null, undefined, 1, {}]) {
    assert.equal(approveBody(bad), null);
  }
});

test("denyBody：理由空白就不带字段，非空白去掉首尾空格", () => {
  assert.deepEqual(denyBody(), {});
  assert.deepEqual(denyBody(""), {});
  assert.deepEqual(denyBody("   "), {});
  assert.deepEqual(denyBody("  不要打开这个站  "), { reason: "不要打开这个站" });
});

test("幂等键：同一条审批 + 同一档位稳定不变，不同档位互不相同", () => {
  const id = "20261015112611418-89f4583e";
  assert.equal(approveIdempotencyKey(id, "once"), approveIdempotencyKey(id, "once"));
  assert.notEqual(approveIdempotencyKey(id, "once"), approveIdempotencyKey(id, "session"));
  assert.notEqual(approveIdempotencyKey(id, "once"), denyIdempotencyKey(id));
});
