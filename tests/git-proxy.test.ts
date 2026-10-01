import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  mintCredential,
  resolveSecret,
  revokeCredential,
  taskSecrets,
} from "../apps/server/src/credentials.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { chatTools } from "../apps/server/src/engine/chat-tools.ts";
import { createGitHandle, gitProxyRoutes } from "../apps/server/src/git-proxy.ts";
import { BwrapSandbox, defaultSandboxRoot } from "../apps/server/src/sandbox.ts";

const exec = promisify(execFile);
const git = (args: string[]) => exec("git", args);

const OWNER = "local-user";
const TASK = "task-gitproxy";
let root: string;
let db: Store;
/** 远端收到的 Authorization（证明凭据确实由服务端代发到了远端） */
const seenAuth: string[] = [];
let originPort = 0;
let origin: ReturnType<typeof createServer>;
let proxy: { close: (callback?: () => void) => void };
let proxyPort = 0;
let bare = "";

/** 用 git http-backend（CGI）把裸仓库挂成"远端"，并要求 Authorization */
function originHandler(req: IncomingMessage, res: ServerResponse) {
  const auth = String(req.headers.authorization ?? "");
  seenAuth.push(auth);
  if (!auth.startsWith("Basic ")) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' });
    res.end("auth required");
    return;
  }
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${originPort}`);
  const child = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: join(root, "served"),
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.replace(/^\?/, ""),
      REQUEST_METHOD: req.method ?? "GET",
      CONTENT_TYPE: String(req.headers["content-type"] ?? ""),
      REMOTE_USER: "x-access-token",
    },
  });
  const chunks: Buffer[] = [];
  req.pipe(child.stdin);
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.on("close", (code) => {
    const out = Buffer.concat(chunks);
    const split = out.indexOf("\r\n\r\n");
    if (code !== 0 || split < 0) {
      res.writeHead(500);
      res.end("git http-backend failed");
      return;
    }
    const headers: Record<string, string> = {};
    for (const line of out.subarray(0, split).toString("utf8").split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    res.writeHead(Number(String(headers.Status ?? "200").split(" ")[0]) || 200, headers);
    res.end(out.subarray(split + 4));
  });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "openmuse-gitproxy-"));
  db = await createStore();

  bare = join(root, "served", "repo.git");
  await mkdir(join(root, "served"), { recursive: true });
  await git(["init", "--bare", "-q", bare]);
  await git(["-C", bare, "config", "http.receivepack", "true"]);

  origin = createServer(originHandler);
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  originPort = (origin.address() as AddressInfo).port;

  const app = new Hono();
  app.route("/git", gitProxyRoutes(db));
  proxy = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
    proxyPort = (info as AddressInfo).port;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
});

after(async () => {
  origin.close();
  await new Promise((resolve) => proxy.close(() => resolve(undefined)));
  await rm(root, { recursive: true, force: true });
});

test("密钥不进沙箱：沙箱只拿句柄、凭据由服务端代发；吊销后句柄立刻失效", async () => {
  const minted = await mintCredential(db, OWNER, {
    label: "代发测试",
    kind: "git",
    scopes: ["repo:write"],
    ttlMs: 600_000,
    taskId: TASK,
  });
  const secret = await resolveSecret(db, OWNER, minted.credential.id);

  const box = await BwrapSandbox.open(
    { taskId: "gitproxy-test", network: "egress" },
    defaultSandboxRoot(join(root, "data")),
  );
  const commit = "cd /workspace/work && git -c user.email=a@o -c user.name=OpenMuse";
  await box.exec("git init -q -b main /workspace/work && echo hi > /workspace/work/README.md");
  await box.exec(`${commit} add -A && ${commit} commit -q -m init`);

  const push = (url: string) =>
    box.exec(
      `cd /workspace/work && GIT_TERMINAL_PROMPT=0 git push ${JSON.stringify(url)} main 2>&1`,
      {
        timeoutMs: 90_000,
      },
    );

  // ① 没有凭据直连远端 → 推不上去（证明远端真的在鉴权）
  const direct = await push(`http://127.0.0.1:${originPort}/repo.git`);
  assert.notEqual(direct.code, 0, `没有凭据不该推成功：${direct.stdout}${direct.stderr}`);

  // ② 走句柄 → 推成功
  const handle = createGitHandle({
    owner: OWNER,
    taskId: TASK,
    remote: `http://127.0.0.1:${originPort}/repo.git`,
    credentialId: minted.credential.id,
  });
  const through = await push(`http://127.0.0.1:${proxyPort}/git/${handle.id}`);
  assert.equal(through.code, 0, `经代发应该推成功：${through.stdout}${through.stderr}`);

  // ③ 远端确实收到了凭据，而沙箱这边没有令牌
  const decoded = seenAuth.map((value) =>
    Buffer.from(value.replace("Basic ", ""), "base64").toString(),
  );
  assert.ok(
    decoded.some((value) => value.includes(secret)),
    "远端应该收到由服务端注入的凭据",
  );
  assert.equal(
    `${through.stdout}${through.stderr}`.includes(secret),
    false,
    "沙箱这边不该出现令牌",
  );

  // ④ 远端裸仓库里确实有这次提交（裸仓库 HEAD 默认 master，我们推的是 main）
  const log = await git(["--git-dir", bare, "log", "--oneline", "-1", "main"]);
  assert.match(log.stdout, /init/);

  // ⑤ 凭据吊销 → 同一句柄立刻失效
  await revokeCredential(db, OWNER, minted.credential.id, "task_finished");
  const afterRevoke = await push(`http://127.0.0.1:${proxyPort}/git/${handle.id}`);
  assert.notEqual(afterRevoke.code, 0, "凭据吊销后不该还能推");
  assert.match(
    `${afterRevoke.stdout}${afterRevoke.stderr}`,
    /403|已随任务结束|已被吊销|Authentication/i,
    "应该看到句柄失效的证据",
  );

  await box.destroy();
});

test("工具层：git_push 自动改用代发句柄，沙箱命令行与回包里都没有令牌", async () => {
  const taskId = `task-push-${Date.now()}`;
  const minted = await mintCredential(db, OWNER, {
    label: "工具层代发",
    kind: "git",
    scopes: ["repo:write"],
    ttlMs: 600_000,
    taskId,
  });
  // 先把凭据铸好，再把 id 写进任务的 state（线上由 service.createTask 做这件事）
  await db.put(OWNER, "tasks", {
    id: taskId,
    owner: OWNER,
    title: "工具层代发",
    status: "running",
    input: { repoPath: join(root, "source-repo") },
    state: { credentialIds: [minted.credential.id] },
  });
  const secret = await resolveSecret(db, OWNER, minted.credential.id);

  const tools = chatTools({
    service: { config: { dataDir: join(root, "data"), port: proxyPort }, db },
    owner: OWNER,
    threadId: taskId,
    requestKey: "k",
    key: (name: string, value: unknown) => `${name}:${String(value)}`,
    signal: new AbortController().signal,
    taskId,
    secrets: await taskSecrets(db, OWNER, { state: { credentialIds: [minted.credential.id] } }),
  } as never);
  const gitPush = tools.find((entry) => entry.name === "git_push");
  assert.ok(gitPush, "应该有 git_push");

  // 源仓库（工具会把它只读挂进沙箱，再 clone 到工作区）
  const source = join(root, "source-repo");
  await mkdir(source, { recursive: true });
  await git(["init", "-q", "-b", "main", source]);
  await exec("sh", ["-c", `echo hi > ${source}/README.md`]);
  await git(["-C", source, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  await git([
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

  const seenBefore = seenAuth.length;
  // 现实顺序：先提交（这一步会把源仓库 clone 进工作区），再推送
  const gitCommit = tools.find((entry) => entry.name === "git_commit");
  assert.ok(gitCommit, "应该有 git_commit");

  // 先在工作区里改个文件（走沙箱文件工具），否则 git 没什么可提交的
  const workspaceWrite = tools.find((entry) => entry.name === "workspace_write_file");
  assert.ok(workspaceWrite, "应该有 workspace_write_file");
  await (workspaceWrite?.execute as (input: { path: string; content: string }) => Promise<unknown>)(
    {
      path: "work/NOTE.md",
      content: "代发验证：这行由沙箱文件工具写入\n",
    },
  );

  const commitResult = (await (
    gitCommit?.execute as (input: {
      repo: string;
      message: string;
    }) => Promise<Record<string, unknown>>
  )({
    repo: "work",
    message: "工具层代发验证",
  })) as { ok?: boolean; output?: string; error?: string };
  assert.equal(commitResult.ok, true, `提交应该成功：${commitResult.error ?? commitResult.output}`);

  const execute = gitPush?.execute as (input: {
    repo: string;
    remote: string;
    branch: string;
  }) => Promise<Record<string, unknown>>;
  // 第二个远端仓库：第一个测试已经往 repo.git 推过 main，
  // 这里是另一份历史，复用同一个远端会被 git 以"非快进"正当拒绝（那是正确行为，不是 bug）。
  const bare2 = join(root, "served", "repo2.git");
  await git(["init", "--bare", "-q", bare2]);
  await git(["-C", bare2, "config", "http.receivepack", "true"]);

  const result = (await execute({
    repo: "work",
    remote: `http://127.0.0.1:${originPort}/repo2.git`,
    branch: "main",
  })) as { ok?: boolean; output?: string; error?: string };

  assert.equal(result.error, undefined, `不该报错：${result.error}`);
  assert.equal(result.ok, true, `应该推成功：${result.output}`);
  const decoded = seenAuth
    .slice(seenBefore)
    .map((value) => Buffer.from(value.replace("Basic ", ""), "base64").toString());
  assert.ok(
    decoded.some((value) => value.includes(secret)),
    "远端应该收到服务端注入的凭据",
  );
  assert.equal(JSON.stringify(result).includes(secret), false, "工具结果里不该有令牌");
});
