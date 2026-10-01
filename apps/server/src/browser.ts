import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserSession } from "../../../packages/domain/src/index.ts";
import type { Auth } from "./auth.ts";
import { browserConsole } from "./browser-console.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";

const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.enum(["idle", "active", "closed", "error"]),
  updatedAt: z.string(),
});
const readSchema = z.object({
  url: z.string(),
  title: z.string().max(300),
  text: z.string().max(100_000),
  truncated: z.boolean(),
});
const contentSchema = z.object({
  url: z.string(),
  title: z.string().max(300),
  html: z.string().max(700_000),
  truncated: z.boolean(),
});
/** worker 的"元素编号"结果：模型按 ref 点击/填表，而不是猜像素坐标。 */
const pageSchema = z.object({
  url: z.string(),
  title: z.string().max(300),
  elements: z
    .array(
      z.object({
        ref: z.number().int().positive(),
        role: z.string().max(40),
        tag: z.string().max(20).optional(),
        label: z.string().max(200),
        value: z.string().max(100).optional(),
        checked: z.boolean().optional(),
        disabled: z.boolean().optional(),
        inView: z.boolean().optional(),
      }),
    )
    .max(120),
  text: z.string().max(8_000).optional(),
});
const failureSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
type ChatBrowser = { id: string; sessionId: string };

export class BrowserService {
  private readonly queues = new Map<string, Promise<unknown>>();
  private health?: { checkedAt: number; reachable: Promise<boolean> };
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
    private readonly files: Files,
    private readonly now: () => number = Date.now,
  ) {}
  /** Whether the configured worker answers its health check, cached briefly for snapshots. */
  reachable(): Promise<boolean> {
    if (!this.config.workerUrl || !this.config.workerToken) return Promise.resolve(false);
    const now = this.now();
    if (this.health && now - this.health.checkedAt < 15_000) return this.health.reachable;
    const reachable = fetch(`${this.config.workerUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    this.health = { checkedAt: now, reachable };
    return reachable;
  }
  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(id, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }
  /**
   * 把一段 HTML 渲染成 PDF（导出用）：复用该会话的浏览器上下文，worker 里**另开一页**打印，
   * 不打断用户正在看的那一页。返回 PDF 字节。
   */
  async exportPdf(owner: string, threadId: string, html: string): Promise<Buffer> {
    const id = await this.threadSession(owner, threadId, "about:blank");
    return this.serial(id, async () => {
      // worker 里的会话要"第一次导航"才真的建起来；about:blank 已在网络的 URL 校验里放行
      // （空白页没有任何网络目的地）。这是导出专用会话，每次都先归零，顺带自愈掉被关掉的上下文。
      await this.openOwned(owner, id, "about:blank");
      const response = await this.request(`/sessions/${id}/pdf`, { html });
      return Buffer.from(await response.arrayBuffer());
    });
  }
  private async request(path: string, body?: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.config.workerUrl || !this.config.workerToken)
      throw new AppError("浏览器工作进程未配置，按安装指南启动它。", 503);
    let response: Response;
    try {
      response = await fetch(`${this.config.workerUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.config.workerToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
          : AbortSignal.timeout(45000),
      });
    } catch {
      signal?.throwIfAborted();
      throw new AppError("浏览器工作进程不可用，检查它的容器是否在运行。", 503);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new AppError(
        typeof payload?.error?.message === "string" ? payload.error.message : "浏览器请求失败",
        502,
      );
    }
    return response;
  }
  async get(owner: string, id: string) {
    const value = await this.db.get<BrowserSession>(owner, "browsers", id);
    if (!value) throw new AppError("找不到这个浏览器会话", 404);
    return value;
  }
  decorate(owner: string, session: BrowserSession) {
    return {
      ...session,
      consoleUrl: this.auth.sign(owner, `/api/browsers/${session.id}/console`),
      previewUrl: this.auth.sign(owner, `/api/browsers/${session.id}/preview`),
    };
  }
  private async save(owner: string, payload: unknown, expectedId: string) {
    const session = sessionSchema.parse(payload);
    if (session.id !== expectedId) throw new AppError("浏览器工作进程返回了另一个会话", 502);
    await this.db.put(owner, "browsers", session);
    return this.decorate(owner, session);
  }
  async create(owner: string, url: string) {
    const id = randomUUID();
    // Record ownership before calling the worker, including when its response is lost.
    await this.db.put(owner, "browsers", {
      id,
      url,
      title: "新建浏览会话",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    return this.reopen(owner, id, url);
  }
  private async openOwned(owner: string, id: string, url?: string, signal?: AbortSignal) {
    const value = await this.get(owner, id);
    const target = url ?? value.url;
    try {
      const response = await this.request("/sessions", { id, url: target }, signal);
      return await this.save(owner, await response.json(), id);
    } catch (error) {
      await this.save(
        owner,
        { ...value, url: target, status: "error", updatedAt: new Date().toISOString() },
        id,
      );
      throw error;
    }
  }
  reopen(owner: string, id: string, url?: string) {
    return this.serial(id, () => this.openOwned(owner, id, url));
  }
  navigate(owner: string, id: string, url: string) {
    return this.reopen(owner, id, url);
  }
  private async readOwned(owner: string, id: string, signal?: AbortSignal) {
    const session = await this.get(owner, id);
    const result = readSchema.parse(
      await (await this.request(`/sessions/${id}/read`, undefined, signal)).json(),
    );
    await this.save(
      owner,
      {
        ...session,
        url: result.url,
        title: result.title,
        status: "active",
        updatedAt: new Date().toISOString(),
      },
      id,
    );
    return result;
  }
  read(owner: string, id: string) {
    return this.serial(id, () => this.readOwned(owner, id));
  }
  async observe(owner: string, url: string, existingId?: string) {
    const id = existingId ?? (await this.create(owner, url)).id;
    return this.serial(id, async () => {
      if (existingId) await this.openOwned(owner, id, url);
      return { sessionId: id, ...(await this.readOwned(owner, id)) };
    });
  }
  /**
   * 一条会话一个浏览器 profile：先落库再联系 worker，
   * 这样失败/丢响应之后的对话轮次仍复用同一个 profile，不会把额度耗尽。
   */
  private async threadSession(owner: string, threadId: string, url: string) {
    const association =
      (await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId)) ??
      (await this.db.insertIfAbsent(owner, "chat-browsers", {
        id: threadId,
        sessionId: randomUUID(),
      })) ??
      (await this.db.get<ChatBrowser>(owner, "chat-browsers", threadId));
    if (!association) throw new AppError("无法占用聊天用的浏览器会话", 500);
    const id = association.sessionId;
    await this.db.insertIfAbsent(owner, "browsers", {
      id,
      url,
      title: "新建浏览会话",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    return id;
  }
  async observeForThread(owner: string, threadId: string, url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const id = await this.threadSession(owner, threadId, url);
    return this.serial(id, async () => {
      signal?.throwIfAborted();
      await this.openOwned(owner, id, url, signal);
      signal?.throwIfAborted();
      const page = await this.readOwned(owner, id, signal);
      signal?.throwIfAborted();
      return {
        sessionId: id,
        ...page,
        text: page.text.slice(0, 30_000),
        truncated: page.truncated || page.text.length > 30_000,
      };
    });
  }
  /**
   * 结构化抓取：把当前页的 HTML 交给调用方解析（搜索结果页要抠链接与摘要，
   * innerText 抠不出来）。复用这条会话的浏览器配置，所以和 browse_web 同一个出口。
   */
  async htmlForThread(owner: string, threadId: string, url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const id = await this.threadSession(owner, threadId, url);
    return this.serial(id, async () => {
      signal?.throwIfAborted();
      await this.openOwned(owner, id, url, signal);
      signal?.throwIfAborted();
      const response = contentSchema.parse(
        await (await this.request(`/sessions/${id}/content`, undefined, signal)).json(),
      );
      await this.save(
        owner,
        {
          id,
          url: response.url,
          title: response.title,
          status: "active",
          updatedAt: new Date().toISOString(),
        },
        id,
      );
      return { sessionId: id, ...response };
    });
  }
  /**
   * 聊天里"看得见、点得动"的入口：复用该线程的浏览器会话（与 browse_web 同一个 profile、同一个出口），
   * 需要时先导航到 url。人和 agent 用的是同一个会话，所以 App 控制台里能实时看到 agent 的操作。
   */
  private async threadPage(
    owner: string,
    threadId: string,
    url: string | undefined,
    run: (id: string) => Promise<Response>,
  ) {
    const id = await this.threadSession(owner, threadId, url ?? "about:blank");
    return this.serial(id, async () => {
      if (url) await this.openOwned(owner, id, url);
      const payload = pageSchema.parse(await (await run(id)).json());
      await this.save(
        owner,
        {
          id,
          url: payload.url,
          title: payload.title,
          status: "active",
          updatedAt: new Date().toISOString(),
        },
        id,
      );
      return { sessionId: id, ...payload };
    });
  }
  pageElementsForThread(owner: string, threadId: string, url?: string) {
    return this.threadPage(owner, threadId, url, (id) => this.request(`/sessions/${id}/elements`));
  }
  actForThread(owner: string, threadId: string, action: Record<string, unknown>, url?: string) {
    return this.threadPage(owner, threadId, url, (id) =>
      this.request(`/sessions/${id}/act`, action),
    );
  }
  /** 截图交给视觉模型用：JPEG 比 PNG 小得多，8k 文本量级的一张图仍能看清版面。 */
  async screenshotForThread(owner: string, threadId: string, url?: string) {
    const id = await this.threadSession(owner, threadId, url ?? "about:blank");
    return this.serial(id, async () => {
      if (url) await this.openOwned(owner, id, url);
      const response = await this.request(`/sessions/${id}/screenshot?format=jpeg&quality=70`);
      const state = await this.get(owner, id);
      return { bytes: new Uint8Array(await response.arrayBuffer()), session: state };
    });
  }
  async close(owner: string, id: string) {
    return this.serial(id, async () => {
      await this.get(owner, id);
      return this.save(owner, await (await this.request(`/sessions/${id}/close`, {})).json(), id);
    });
  }
  async preview(owner: string, id: string, options: { quality?: number } = {}) {
    const session = await this.get(owner, id);
    const query = options.quality ? `?format=jpeg&quality=${options.quality}` : "";
    return { response: await this.request(`/sessions/${id}/screenshot${query}`), session };
  }
  async input(owner: string, id: string, value: unknown) {
    return this.serial(id, async () => {
      await this.get(owner, id);
      // 控制台的历史导航/视口：worker 上是独立端点，这里按 type 分流（老坐标点击仍走 /input）。
      const type = (value as { type?: unknown } | null)?.type;
      const path =
        type === "back" || type === "forward" || type === "reload" || type === "viewport"
          ? `/sessions/${id}/${type}`
          : `/sessions/${id}/input`;
      return this.save(owner, await (await this.request(path, value)).json(), id);
    });
  }
  async imports(owner: string, id: string) {
    await this.get(owner, id);
    const { downloads, failures } = z
      .object({
        downloads: z.array(
          z.object({ id: z.string(), name: z.string(), size: z.number(), mimeType: z.string() }),
        ),
        failures: z.array(failureSchema),
      })
      .parse(await (await this.request(`/sessions/${id}/downloads`)).json());
    const saved = [];
    for (const download of downloads) {
      const existing = await this.db.get<{ fileId: string }>(
        owner,
        "browser-downloads",
        download.id,
      );
      if (existing) {
        saved.push(this.files.signed(owner, await this.files.get(owner, existing.fileId)));
        continue;
      }
      const response = await this.request(
        `/sessions/${id}/downloads/${encodeURIComponent(download.id)}`,
      );
      const file = await this.files.import(
        owner,
        download.name,
        new Uint8Array(await response.arrayBuffer()),
        `Browser · ${id}`,
      );
      await this.db.put(owner, "browser-downloads", { id: download.id, fileId: file.id });
      saved.push(file);
    }
    return { files: saved, failures };
  }
  console(owner: string, id: string) {
    return browserConsole(this.auth.sign(owner, `/api/browsers/${id}/preview`));
  }
}
