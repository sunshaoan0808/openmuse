/**
 * git 凭据代发代理 —— "密钥不进沙箱" 的落点。
 *
 * 问题：原来 git_push 把令牌经环境变量注进沙箱（GIT_ASKPASS），令牌就躺在沙箱进程的内存里，
 *      同沙箱内的任何代码都能读到它。
 * 做法：沙箱只拿一个**一次性句柄**（32 字节随机串，就是路径本身），把 push 打给本机代理；
 *      真正的 Authorization 由**服务端**在转发时加上，令牌从不进入沙箱进程。
 *
 * 安全边界（逐条都靠机制而不是靠自觉）：
 *  - 句柄即能力：32 字节随机、只在内存里、只对创建它的任务有意义，猜不到也列不出来。
 *  - 转发目标**固定**在句柄里：客户端路径只能拼在远端之后，改不了主机与仓库。
 *  - 每次请求都重新 `resolveSecret`：凭据一被吊销/过期，句柄立刻失效（任务终态即失效）。
 *  - 客户端自带的 Authorization 一律剥掉，不接受沙箱"自带凭据"绕过。
 */
import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { resolveSecret } from "./credentials.ts";
import type { Store } from "./db.ts";

export interface GitHandle {
  id: string;
  owner: string;
  taskId: string;
  /** 真实远端基址，例如 https://github.com/owner/repo.git（句柄里写死，客户端改不了） */
  remote: string;
  credentialId: string;
  createdAt: number;
}

/** 单进程服务的内存表：句柄短命（跟任务同生命周期），不落库 */
const handles = new Map<string, GitHandle>();

export function createGitHandle(input: {
  owner: string;
  taskId: string;
  remote: string;
  credentialId: string;
}): GitHandle {
  const handle: GitHandle = {
    id: randomBytes(24).toString("base64url"),
    createdAt: Date.now(),
    ...input,
  };
  handles.set(handle.id, handle);
  return handle;
}

export function getGitHandle(id: string): GitHandle | undefined {
  return handles.get(id);
}

/** 任务终态时清掉它名下的句柄（凭据吊销已让它们失效，这里是第二道） */
export function revokeGitHandles(taskId: string): number {
  let removed = 0;
  for (const [id, handle] of handles) {
    if (handle.taskId === taskId) {
      handles.delete(id);
      removed += 1;
    }
  }
  return removed;
}

/** 拼出上游地址：远端基址 + 客户端路径（只允许拼在后面，不能改主机） */
export function upstreamUrl(remote: string, suffix: string, search: string): string {
  const base = remote.endsWith("/") ? remote.slice(0, -1) : remote;
  const path = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${base}${path}${search}`;
}

/** HTTP Basic（git 的通用做法；GitHub 用 x-access-token 当用户名，GitLab 认任意非空） */
export function basicAuth(secret: string): string {
  return `Basic ${Buffer.from(`x-access-token:${secret}`).toString("base64")}`;
}

/** 只转发这几类头，别把客户端的 Authorization/ Cookie 带上去 */
const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "git-protocol", "user-agent"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "www-authenticate", "cache-control", "expires"];

export function gitProxyRoutes(db: Store): Hono {
  const app = new Hono();

  app.all("/:handle", (c) => handleRequest(c, db));
  app.all("/:handle/*", (c) => handleRequest(c, db));
  return app;
}

async function handleRequest(c: Context, db: Store): Promise<Response> {
  const id = c.req.param("handle") ?? "";
  const handle = getGitHandle(id);
  if (!handle) return c.json({ error: "这个推送句柄不存在或已失效。" }, 404);

  let secret: string;
  try {
    // 每次请求都重新校验：任务结束/超过有效期，句柄立刻不能用了
    secret = await resolveSecret(db, handle.owner, handle.credentialId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "凭据已失效。" }, 403);
  }

  const url = new URL(c.req.url);
  const suffix = url.pathname.replace(`/git/${id}`, "");
  const target = upstreamUrl(handle.remote, suffix === "" ? "/" : suffix, url.search);

  const headers = new Headers({ authorization: basicAuth(secret) });
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const method = c.req.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body, redirect: "manual" });
  } catch (error) {
    return c.json(
      { error: `连不上远端：${error instanceof Error ? error.message : "未知错误"}` },
      502,
    );
  }

  const outHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: outHeaders,
  });
}
