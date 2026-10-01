import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgedIds, mergeConversation } from "../src/conversation-merge.ts";

const msg = (id: string, role: string, seq?: number) => ({ id, role, content: id, ...(seq === undefined ? {} : { seq }) });

test("增量拉取时不能把新消息前置（真机：新回复被顶到最上面、被悬浮顶栏压住，看起来像丢了）", () => {
  // 本地已有 1..47，服务端增量只回 48
  const local = Array.from({ length: 47 }, (_, i) => msg(`m${i + 1}`, "user", i + 1));
  const incoming = [msg("m48", "assistant", 48)];
  const merged = mergeConversation(local, incoming);
  assert.equal(merged.length, 48);
  assert.equal(merged.at(-1)?.id, "m48", "最新一条必须排在最后");
  assert.equal(merged[0]?.id, "m1", "历史顺序必须保持");
});

test("服务端全量返回时按 seq 排序、本地未确认的接在最后", () => {
  const incoming = [msg("m2", "assistant", 2), msg("m1", "user", 1)];
  const local = [msg("m1", "user", 1), msg("local-1", "user")];
  const merged = mergeConversation(local, incoming);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["m1", "m2", "local-1"],
  );
});

test("没有 seq 时保持原顺序（不瞎排）", () => {
  const incoming = [msg("a", "user"), msg("b", "assistant")];
  const merged = mergeConversation([], incoming);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["a", "b"],
  );
});

test("acknowledgedIds 只认服务端回来的 id", () => {
  const ids = acknowledgedIds([msg("x", "user", 1), { role: "user" }]);
  assert.deepEqual([...ids], ["x"]);
});
