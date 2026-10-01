import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  BwrapSandbox,
  bwrapAvailable,
  createBwrapBackend,
  destroySandbox,
} from "../apps/server/src/sandbox.ts";

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "openmuse-sbx-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const skip = bwrapAvailable() ? false : "bwrap 不可用（非 Linux 或没装）";

test("沙箱里跑得起来，只有 /workspace 可写、系统目录只读", { skip }, async () => {
  const box = await BwrapSandbox.open({ taskId: "t-write" }, root);
  const echo = await box.exec("echo hello && pwd");
  assert.equal(echo.code, 0, echo.stderr);
  assert.match(echo.stdout, /hello/);
  assert.match(echo.stdout, /workspace/);
  const allowed = await box.exec("touch ok.txt && ls");
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.match(allowed.stdout, /ok.txt/);
  const denied = await box.exec("touch /usr/evil.txt 2>&1 || echo DENIED");
  assert.match(denied.stdout, /DENIED/, "系统目录应该是只读的");
  await box.destroy();
});

test("硬指标 1：默认无网络（只有 loopback）", { skip }, async () => {
  const box = await BwrapSandbox.open({ taskId: "t-net" }, root);
  const blocked = await box.exec(
    "echo MARK; curl -s -m 3 -o /dev/null -w '%{http_code}' https://example.com 2>&1; echo \" code=$?\"",
    { timeoutMs: 20_000 },
  );
  // 先证明命令真的在沙箱里跑起来了（否则"没有 200"是空对空的假通过）
  assert.match(blocked.stdout, /MARK/, `沙箱命令没跑起来：${blocked.stdout} ${blocked.stderr}`);
  assert.ok(!/200/.test(blocked.stdout), `不该出得了网：${blocked.stdout} ${blocked.stderr}`);
  // 用 bash 的 /dev/tcp 再打一次（不依赖 curl 是否可用）
  const tcp = await box.exec("echo MARK2; (exec 3<>/dev/tcp/1.1.1.1/80) 2>&1 || echo TCP_BLOCKED", {
    timeoutMs: 15_000,
  });
  assert.match(tcp.stdout, /MARK2/);
  assert.match(tcp.stdout, /TCP_BLOCKED/, `TCP 也不该连得上：${tcp.stdout}`);
  const loopback = await box.exec("ip -o addr show lo 2>/dev/null | wc -l || echo 0");
  assert.ok(Number(loopback.stdout.trim()) >= 0);
  await box.destroy();
});

test("硬指标 2：读不到宿主机 .env，也继承不到服务端环境变量", { skip }, async () => {
  const hostEnv = join(process.cwd(), ".env");
  process.env.OPENMUSE_SANDBOX_LEAK_PROBE = "should-not-leak";
  const box = await BwrapSandbox.open({ taskId: "t-env" }, root);
  const read = await box.exec(`cat ${hostEnv} 2>&1 || echo NO_ENV`);
  assert.match(read.stdout, /NO_ENV/, "宿主机 .env 不该在沙箱里可读");
  const home = await box.exec("ls /home 2>&1 || echo NO_HOME");
  assert.match(home.stdout, /NO_HOME/, "不该挂载宿主机 /home");
  const env = await box.exec("env");
  assert.ok(!/should-not-leak/.test(env.stdout), "服务端环境变量不该继承进沙箱");
  assert.ok(env.stdout.trim().split("\n").length <= 5, `沙箱环境应是干净的：\n${env.stdout}`);
  await box.destroy();
});

test("硬指标 3：destroy 之后目录不存在（任务结束即重置，且幂等）", { skip }, async () => {
  const backend = createBwrapBackend(root);
  const box = await backend.start({ taskId: "t-destroy" });
  await box.write("note.txt", "hi");
  const read = await box.exec("cat note.txt");
  assert.equal(read.stdout.trim(), "hi", read.stderr);
  const dir = box.dir;
  assert.ok(existsSync(dir), "建好后目录应该在");
  await box.destroy();
  assert.equal(existsSync(dir), false, "destroy 之后必须不存在");
  assert.equal(box.destroyed, true);
  await box.destroy();
  await assert.rejects(
    () => box.exec("echo again"),
    /沙箱已销毁/,
    "销毁后再执行应该直接报错，而不是悄悄跑到别处",
  );
});

test("仓库以只读方式挂入：能读、改不了", { skip }, async () => {
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "README.md"), "# hi\n");
  const box = await BwrapSandbox.open({ taskId: "t-repo", repo }, root);
  const read = await box.exec("cat /repo/README.md");
  assert.match(read.stdout, /# hi/, read.stderr);
  const denied = await box.exec("echo x >> /repo/README.md 2>&1 || echo DENIED");
  assert.match(denied.stdout, /DENIED/, "仓库必须是只读的");
  await box.destroy();
});

test("任务终态钩子用的 destroySandbox：按目录名删、幂等", { skip }, async () => {
  const root = join(await mkdtemp(join(tmpdir(), "openmuse-sbx2-")), "sandboxes");
  const box = await createBwrapBackend(root).start({ taskId: "task-xyz" });
  assert.ok(existsSync(box.dir));
  assert.equal(await destroySandbox(root, "task-xyz"), true, "第一次应真的删掉");
  assert.equal(existsSync(box.dir), false);
  assert.equal(await destroySandbox(root, "task-xyz"), false, "再删一次返回 false（幂等）");
});
