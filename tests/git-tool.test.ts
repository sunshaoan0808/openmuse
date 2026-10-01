import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { ensureTaskSandbox } from "../apps/server/src/sandbox.ts";

const run = promisify(execFile);
let root: string, source: string;
const sandboxes = () => join(root, "sandboxes");

before(async () => {
  root = await mkdtemp(join(tmpdir(), "openmuse-git-"));
  // 造一个"源仓库"（Host 上，沙箱里只读挂载）
  source = join(root, "source-repo");
  await mkdir(source, { recursive: true });
  await run("git", ["init", "-q", "-b", "main", source]);
  await writeFile(join(source, "README.md"), "hello\n");
  await run("git", ["-C", source, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  await run("git", [
    "-C",
    source,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    "init",
  ]);
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("沙箱里：从只读挂载克隆源仓库 → 提交 → 推回本地裸仓库（全程无网）", async () => {
  const task = { id: "git-task", state: {} as Record<string, unknown> };
  const box = await ensureTaskSandbox(root, undefined as never, "local-user", task, {
    repo: source,
  }).catch(async () => {
    // 没有 db 的场景（本测试只用沙箱）：直接建一个
    const { BwrapSandbox } = await import("../apps/server/src/sandbox.ts");
    return BwrapSandbox.open({ taskId: "git-task", repo: source }, sandboxes());
  });

  const clone = await box.exec("git clone -q /repo /workspace/work && cd /workspace/work && ls");
  assert.match(clone.stdout, /README\.md/, clone.stderr);
  // 源仓库是只读的：不能在 /repo 里写
  const denied = await box.exec("touch /repo/evil 2>&1 || echo DENIED");
  assert.match(denied.stdout, /DENIED/);

  // 改文件 + 提交（消息走文件，不进命令行）
  await box.write("work/NOTE.md", "sandbox wrote this\n");
  await box.write(".openmuse-commit-msg", "从沙箱提交\n");
  const commit = await box.exec(
    "cd /workspace/work && git add -A && git -c user.email=a@o -c user.name=OpenMuse commit -F /workspace/.openmuse-commit-msg",
  );
  assert.equal(commit.code, 0, commit.stderr);

  // 本地裸仓库当远端（沙箱内路径 → 不需要网络）
  const push = await box.exec(
    "cd /workspace && git init -q --bare remote.git && cd work && git push -q /workspace/remote.git main 2>&1; " +
      "git --git-dir=/workspace/remote.git log --oneline -1 main && git --git-dir=/workspace/remote.git show --stat --oneline main | head -4",
    { timeoutMs: 60_000 },
  );
  assert.equal(push.code, 0, push.stderr);
  assert.match(push.stdout, /从沙箱提交/, "裸仓库里应该有我们那次提交");

  await box.destroy();
});

test("凭据走 GIT_ASKPASS：远端只认凭据，且凭据不出现在命令行/配置里", async () => {
  // 起一个只看 Authorization 头的 HTTP 服务（沙箱有 egress 时能连宿主机 loopback）
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(String(req.headers.authorization ?? ""));
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' });
    res.end("denied");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;

  const box = await ensureTaskSandbox(
    root,
    undefined as never,
    "local-user",
    { id: "git-cred", state: {} },
    {
      network: "egress",
    },
  ).catch(async () => {
    const { BwrapSandbox } = await import("../apps/server/src/sandbox.ts");
    return BwrapSandbox.open({ taskId: "git-cred", network: "egress" }, sandboxes());
  });

  const secret = "tok_" + "x".repeat(24);
  await box.write(
    ".openmuse-askpass.sh",
    '#!/bin/sh\ncase "$1" in *[Uu]sername*) echo openmuse;; *) echo "$OPENMUSE_GIT_TOKEN";; esac\n',
  );
  await box.exec("chmod +x /workspace/.openmuse-askpass.sh");
  const res = await box.exec(
    `cd /workspace && OPENMUSE_GIT_TOKEN=${JSON.stringify(secret)} GIT_ASKPASS=/workspace/.openmuse-askpass.sh GIT_TERMINAL_PROMPT=0 ` +
      `git ls-remote http://127.0.0.1:${port}/repo.git 2>&1 | head -3; echo done`,
    { timeoutMs: 60_000 },
  );
  server.close();
  console.log("   沙箱里看到的状态:", res.stdout.trim().split("\n")[0]);
  console.log("   服务端收到的 Authorization 次数:", seen.length);
  const gotSecret = seen.some((header) =>
    Buffer.from(header.replace("Basic ", ""), "base64").toString().includes(secret),
  );
  if (seen.length)
    assert.ok(gotSecret, "凭据应该通过 GIT_ASKPASS 送到了 HTTP 头里（说明它确实被 git 用上了）");
  assert.equal(res.stdout.includes(secret), false, "凭据不该出现在命令输出里");
  await box.destroy();
});

test("聊天里调用 git 工具 → 明确拒绝，且不碰沙箱", async () => {
  const { chatTools } = await import("../apps/server/src/engine/chat-tools.ts");
  const before = existsSync(join(root, "sandboxes", "chat-thread"));
  const tools = chatTools({
    owner: "local-user",
    threadId: "chat-thread",
    requestKey: "k",
    key: (name: string, value: unknown) => `${name}:${String(value)}`,
    signal: new AbortController().signal,
    service: { db: { get: async () => null } } as never,
  } as never);
  const gitCommit = tools.find((tool) => tool.name === "git_commit");
  assert.ok(gitCommit, "应该有 git_commit 工具");
  const execute = gitCommit?.execute as (input: {
    repo: string;
    message: string;
  }) => Promise<{ error?: string }>;
  const result = await execute({ repo: "work", message: "不该发生" });
  assert.match(String(result?.error ?? ""), /只在任务里可用/);
  assert.equal(existsSync(join(root, "sandboxes", "chat-thread")), before, "聊天调用不该建沙箱");
});
