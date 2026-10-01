import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chatTools } from "../apps/server/src/engine/chat-tools.ts";

let root: string;
const TASK = { id: "task-ws", state: {} as Record<string, unknown> };

/**
 * 有状态的假 db：真库里 state 是持久化的，所以同一个任务的多次工具调用会复用**同一个沙箱**
 * （ensureTaskSandbox 靠 state.sandboxId 幂等）。假 db 不持久化就会每次新开沙箱，测试会失真。
 */
function fakeDb() {
  return {
    get: async (_owner: string, _kind: string, id: string) => (id === TASK.id ? TASK : null),
    compareAndSwap: async (
      _owner: string,
      _kind: string,
      _id: string,
      _patch: unknown,
      next: { state?: unknown },
    ) => {
      if (next?.state) TASK.state = next.state as Record<string, unknown>;
      return undefined;
    },
  };
}

/** 造一个"任务里"的工具表：db 只回答任务查询（够 resolveTaskSandbox 用） */
function toolsForTask() {
  const db = fakeDb();
  return chatTools({
    service: { config: { dataDir: root }, db },
    owner: "local-user",
    threadId: TASK.id, // 任务路径里 threadId 就是 task.id
    requestKey: "k",
    key: (name: string, value: unknown) => `${name}:${String(value)}`,
    signal: new AbortController().signal,
  } as never);
}
const call = async (name: string, input: Record<string, unknown>) => {
  const tool = toolsForTask().find((t) => t.name === name);
  assert.ok(tool, `应该有 ${name}`);
  return (await (tool?.execute as (i: unknown) => Promise<Record<string, unknown>>)(input)) ?? {};
};

before(async () => {
  root = await mkdtemp(join(tmpdir(), "openmuse-ws-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("写 / 读 / 列表：文件落在沙箱工作区里", async () => {
  const written = await call("workspace_write_file", {
    path: "src/app.ts",
    content: "export const a = 1;\n",
  });
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.bytes, "export const a = 1;\n".length);

  const read = await call("workspace_read_file", { path: "src/app.ts" });
  assert.match(String(read.content), /export const a = 1;/);

  const listed = await call("workspace_list_files", { dir: "src" });
  assert.match(String(listed.output), /app\.ts/);

  const whole = await call("workspace_list_files", {});
  assert.match(String(whole.output), /src/);
});

test("改文件：原文唯一才改，不唯一就拒绝且不写", async () => {
  await call("workspace_write_file", { path: "note.md", content: "甲\n乙\n甲\n" });
  const ambiguous = await call("workspace_edit_file", {
    path: "note.md",
    oldText: "甲",
    newText: "丙",
  });
  assert.match(String(ambiguous.error ?? ""), /不唯一/);
  assert.match(
    String((await call("workspace_read_file", { path: "note.md" })).content),
    /甲\n乙\n甲/,
  );

  const ok = await call("workspace_edit_file", { path: "note.md", oldText: "乙", newText: "丁" });
  assert.equal(ok.replaced, 1);
  assert.match(String((await call("workspace_read_file", { path: "note.md" })).content), /丁/);

  const missing = await call("workspace_edit_file", {
    path: "note.md",
    oldText: "不存在",
    newText: "x",
  });
  assert.match(String(missing.error ?? ""), /找不到/);
});

test("越界一律拒绝：绝对路径、..、域外目录", async () => {
  for (const path of ["/etc/passwd", "../outside.txt", "a/../../b.txt", ""]) {
    const result = await call("workspace_write_file", { path, content: "x" });
    assert.ok(result.error, `${path} 应该被拒：${JSON.stringify(result)}`);
  }
  const readOutside = await call("workspace_read_file", { path: "/etc/passwd" });
  assert.ok(readOutside.error, "读也不许越界");
});

test("聊天里调用 → 拒绝（不建沙箱、不动文件）", async () => {
  const db = { get: async () => null, compareAndSwap: async () => undefined };
  const tools = chatTools({
    service: { config: { dataDir: root }, db },
    owner: "local-user",
    threadId: "chat-thread",
    requestKey: "k",
    key: (name: string, value: unknown) => `${name}:${String(value)}`,
    signal: new AbortController().signal,
  } as never);
  const write = tools.find((t) => t.name === "workspace_write_file");
  const result = (await (write?.execute as (i: unknown) => Promise<Record<string, unknown>>)({
    path: "x.txt",
    content: "不该发生",
  })) as { error?: string };
  assert.match(String(result.error ?? ""), /只在任务里可用/);
});
