import assert from "node:assert/strict";
import { test } from "node:test";
import { scrubSecrets } from "../apps/server/src/app.ts";
import { recoverRows } from "../apps/server/src/db.ts";

// 线上真实撞到的原文（PGlite/Postgres 的 TOAST 缺块）
const REAL = "missing chunk number 0 for toast value 16631 in pg_toast_16384";

test("isCorruptRow 认得出真实的损坏消息，普通错误照旧抛", async () => {
  await assert.rejects(
    () =>
      recoverRows(
        "list",
        new Error("connection refused"),
        async () => ["(0,1)"],
        async () => ({}) as never,
      ),
    /connection refused/,
    "非损坏类错误必须原样抛出，不能被吞掉",
  );
});

test("一行 TOAST 坏了 → 逐行读，坏的跳过，其余照常返回（不再整个 502）", async () => {
  const rows = await recoverRows<string>(
    "list",
    new Error(REAL),
    async () => ["(0,1)", "(0,2)", "(0,3)"],
    async (ctid) => {
      if (ctid === "(0,2)") throw new Error(REAL); // 这一行就是坏数据
      return `row-${ctid}`;
    },
  );
  assert.deepEqual(rows, ["row-(0,1)", "row-(0,3)"]);
});

test("降级路径里遇到损坏以外的错误仍然抛（不能把真问题当数据损坏吞掉）", async () => {
  await assert.rejects(
    () =>
      recoverRows(
        "list",
        new Error(REAL),
        async () => ["(0,1)"],
        async () => {
          throw new Error("out of memory");
        },
      ),
    /out of memory/,
  );
});

test("日志脱敏：令牌形状不会原样进 journald", () => {
  const dirty =
    "GET https://x/api?token=abcdef123456 failed, Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def, key sk-abcdefghijklmnop";
  const clean = scrubSecrets(dirty);
  assert.equal(clean.includes("abcdef123456"), false);
  assert.equal(clean.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(clean.includes("sk-abcdefghijklmnop"), false);
  assert.match(clean, /\[REDACTED\]/);
});
