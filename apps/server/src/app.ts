import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { emailDraftSchema, proposalSchema } from "../../../packages/domain/src/index.ts";
import { ActionService } from "./actions.ts";
import { agentConfigured, makeRuntime } from "./agent.ts";
import { createAuth } from "./auth.ts";
import { BrowserService } from "./browser.ts";
import {
  type AgUiLikeEvent,
  appendMessages,
  assembleTurnMessages,
  type ChatTurn,
  type Conversation,
  consumeSse,
  finishTurn,
  messagesSince,
  newTurn,
  noteReactionUsage,
  orderReactionsByUsage,
  REACTION_EMOJIS,
  toggleReaction,
  turnOutcome,
  unsendMessage,
} from "./chat-turns.ts";
import { ComputerService, type DockerRunner } from "./computer.ts";
import { computerRoutes } from "./computer-routes.ts";
import { assertApiDeploymentConfig, type Config, intelligenceConfigured } from "./config.ts";
import type { Store } from "./db.ts";
import { DurableAgentRunner } from "./engine/durable-runner.ts";
import { agentRoutes } from "./engine/routes.ts";
import { AgentService } from "./engine/service.ts";
import { AppError } from "./errors.ts";
import { Files } from "./files.ts";
import { gitProxyRoutes } from "./git-proxy.ts";
import { GoogleAuth } from "./google-auth.ts";
import { friendlyToolError, recordActivity } from "./live-activity.ts";
import { backgroundFailure } from "./log.ts";
import { markdownToHtml, wrapHtmlDocument } from "./markdown-html.ts";
import { publishRoutes } from "./publish.ts";
import { SearchService } from "./search.ts";
import {
  conversationRecordId,
  mainThreadId,
  mergeThread,
  type SavedThread,
  sortThreads,
  titleFromMessages,
} from "./threads.ts";
import { WorkspaceService } from "./workspace.ts";

/** 日志脱敏：把常见令牌形状换成 [REDACTED]，避免 journald 里躺着可用凭据 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
    .replace(/(sk-|pk-|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{8,}/g, "$1[REDACTED]")
    .replace(/([?&](?:token|key|access_key|apikey|api_key)=)[^&\s"']+/gi, "$1[REDACTED]");
}

export async function createApp(
  db: Store,
  config: Config,
  options: { docker?: DockerRunner } = {},
) {
  assertApiDeploymentConfig(config);
  const auth = await createAuth(db, config),
    files = new Files(db, config, auth),
    google = new GoogleAuth(db, config),
    workspace = new WorkspaceService(db, config, files, google);
  const actions = new ActionService(db, {
    execute: (owner, input, connectionId, targetVersion) =>
      workspace.execute(owner, input, connectionId, targetVersion),
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner) => workspace.connected(owner),
    connection: (owner) => workspace.connection(owner),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config, options.docker);
  const search = new SearchService(config, browser);
  const agent = new AgentService(db, config, workspace, files, actions, browser, computer, search);
  const intelligence = intelligenceConfigured(config)
    ? new CopilotKitIntelligence({
        apiKey: config.intelligenceApiKey ?? "local-shim",
        ...(config.intelligenceApiUrl ? { apiUrl: config.intelligenceApiUrl } : {}),
        ...(config.intelligenceWsUrl ? { wsUrl: config.intelligenceWsUrl } : {}),
      })
    : undefined;
  const runtime = makeRuntime(config, agent, auth, intelligence, new DurableAgentRunner(db));
  const app = new Hono<{ Variables: { owner: string } }>();
  const origins = new Set([...config.allowedOrigins, new URL(config.publicUrl).origin]);
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !origins.has(origin)) return c.json({ error: "Origin is not allowed" }, 403);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (c) => c.json({ error: "请求过大；PDF 需在 10 MB 以内" }, 413),
    }),
  );
  // 访问日志：手机报"连不上/超时"时，唯一能判断"请求到底有没有到达服务端"的依据。
  // 只记方法、路径（去掉 query 里的敏感值）、状态码与耗时；不记请求体、不记鉴权头。
  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    const path = c.req.path;
    if (path === "/api/health") return;
    const status = c.res.status;
    const ms = Date.now() - started;
    const slow = ms > 3000 ? "（慢）" : "";
    console.log(`[http] ${c.req.method} ${path} → ${status} ${ms}ms${slow}`);
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: error.issues.map((i) => i.message).join("; ") }, 422);
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (error.name === "PdfError" || error.name === "RecurringEventError")
      return c.json({ error: error.message }, 422);
    if (error instanceof SyntaxError) return c.json({ error: "请求数据无效" }, 400);
    // Provider and document errors are useful, but raw stack traces and token-bearing responses are not.
    // 日志只留内部可用的信息：原来只打 error.name（例如 "TypeError"），线上等于没有线索 —— 补上消息与栈，
    // 并顺手脱敏（日志进 journald，可能被转发或截图）。
    console.error(`[OpenMuse] ${error.name}: ${scrubSecrets(error.message)}`);
    if (error.stack)
      console.error(
        scrubSecrets(error.stack)
          .split("\n")
          .slice(0, 8)
          .map((line) => `    ${line.trim()}`)
          .join("\n"),
      );
    return c.json(
      {
        error:
          error.name === "PdfError" || error.name === "GoogleApiError"
            ? error.message
            : "请求失败，请检查服务端配置后重试。",
      },
      502,
    );
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mode: config.mode,
      agentConfigured: agentConfigured(config),
      browserConfigured: Boolean(config.workerUrl && config.workerToken),
    }),
  );
  let loginWindow = 0,
    loginAttempts = 0;
  app.post("/api/session", async (c) => {
    if (Date.now() - loginWindow > 60000) {
      loginWindow = Date.now();
      loginAttempts = 0;
    }
    if (++loginAttempts > 30) throw new AppError("登录尝试过于频繁，请一分钟后再试。", 429);
    const body = z.object({ accessKey: z.string().optional() }).parse(await c.req.json());
    const session = await auth.session(body.accessKey);
    await workspace.ensureSample("local-user", actions);
    await agent.ensure("local-user");
    if (config.mode === "sample") await agent.refreshIdeas("local-user");
    return c.json(session);
  });
  app.get("/api/google/callback", async (c) => {
    if (c.req.query("error"))
      return c.html("<h1>Google connection cancelled</h1><p>You can return to OpenMuse.</p>", 400);
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (!state || !code) throw new AppError("Google 回调不完整");
    await google.callback(state, code);
    return c.html(
      "<h1>Google is connected</h1><p>Return to OpenMuse and refresh your workspace.</p>",
    );
  });
  app.use("/api/*", async (c, next) => {
    const signedRoute =
      /^\/api\/files\/[^/]+\/content$|^\/api\/browsers\/[^/]+\/(?:preview|console)$/.test(
        c.req.path,
      );
    const owner =
      signedRoute && c.req.query("signature")
        ? auth.verify(new URL(c.req.url))
        : await auth.owner(c.req.header("authorization"));
    c.set("owner", owner);
    await next();
  });
  app.get("/api/workspace", async (c) => {
    const [snapshot, reachable] = await Promise.all([
      workspace.snapshot(c.get("owner"), c.req.query("q")),
      browser.reachable(),
    ]);
    snapshot.browsers = snapshot.browsers.map((s) => browser.decorate(c.get("owner"), s));
    // A configured worker that does not answer is offline, not ready.
    snapshot.connections = snapshot.connections.map((connection) =>
      connection.id === "browser" && connection.status === "connected" && !reachable
        ? { ...connection, status: "unavailable" }
        : connection,
    );
    return c.json(snapshot);
  });
  // git 凭据代发代理：**故意挂在 /api/* 之外** —— 调用它的是沙箱，没有会话令牌，
  // 认证靠句柄本身（32 字节随机）= 一次性能力，且每次转发都重新校验凭据是否还有效。
  app.route("/git", gitProxyRoutes(db));
  // 公开只读链接：同样挂在 /api/* 之外 —— 拿到链接的人没有会话令牌，认证靠 token 本身
  app.route("/p", publishRoutes(files, config.publicUrl));
  app.route("/api/agent", agentRoutes(agent));
  app.route("/api/computer", computerRoutes(computer, files));
  app.get("/api/calendars", async (c) => c.json(await workspace.calendars(c.get("owner"))));
  app.get("/api/calendar/events", async (c) => {
    const query = z
      .object({
        calendarId: z.string().min(1).max(1024).optional(),
        timeMin: z.iso.datetime({ offset: true }).optional(),
        timeMax: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(c.req.query());
    if (
      query.timeMin &&
      query.timeMax &&
      (Date.parse(query.timeMax) <= Date.parse(query.timeMin) ||
        Date.parse(query.timeMax) - Date.parse(query.timeMin) > 366 * 86400000)
    )
      throw new AppError("日历范围请选 1 个时刻到 366 天之间", 422);
    return c.json(await workspace.events(c.get("owner"), query));
  });
  app.get("/api/mail/threads/:id", async (c) =>
    c.json(await workspace.thread(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/actions", async (c) => {
    const input = proposalSchema.parse(await c.req.json());
    if (input.kind === "email.send")
      for (const id of input.data.attachmentIds) await files.get(c.get("owner"), id);
    return c.json(await actions.propose(c.get("owner"), input), 201);
  });
  app.post("/api/actions/:id/decide", async (c) => {
    const body = z
      .object({ hash: z.string(), decision: z.enum(["approve", "deny"]) })
      .parse(await c.req.json());
    return c.json(
      await actions.decide(c.get("owner"), c.req.param("id"), body.hash, body.decision),
    );
  });
  app.get("/api/drafts", async (c) => c.json(await db.list(c.get("owner"), "drafts")));
  app.post("/api/drafts", async (c) => {
    const body = emailDraftSchema.extend({ id: z.string().optional() }).parse(await c.req.json());
    const existing = body.id
      ? await db.get<{ createdAt: string }>(c.get("owner"), "drafts", body.id)
      : null;
    if (body.id && !existing) throw new AppError("找不到这份草稿", 404);
    return c.json(
      await db.put(c.get("owner"), "drafts", {
        ...body,
        id: body.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
      201,
    );
  });
  // 一轮对话最多跑这么久；超过就认为被上游卡住（模型网关内部重试可能很久）
  const TURN_TIMEOUT_MS = 5 * 60_000;
  // ---- 本地已保存会话（不走 CopilotKit 云线程）----
  const ensureThread = async (
    owner: string,
    id: string,
    options: {
      name?: string;
      archived?: boolean;
      autoTitle?: string;
      messageCount?: number;
      agentId?: string;
    } = {},
  ): Promise<SavedThread> => {
    const existing = await db.get<SavedThread>(owner, "threads", id);
    const next = mergeThread(existing ?? undefined, id, {
      now: new Date().toISOString(),
      ...options,
    });
    await db.put(owner, "threads", next);
    return next;
  };
  app.get("/api/threads", async (c) => {
    const owner = c.get("owner");
    await ensureThread(owner, mainThreadId);
    return c.json({ threads: sortThreads(await db.list<SavedThread>(owner, "threads")) });
  });
  app.patch("/api/threads/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const patch = z
      .object({ name: z.string().trim().max(80).optional(), archived: z.boolean().optional() })
      .parse(body ?? {});
    const thread = await ensureThread(c.get("owner"), c.req.param("id"), patch);
    return c.json({ thread });
  });
  app.post("/api/threads/:id/archive", async (c) => {
    const thread = await ensureThread(c.get("owner"), c.req.param("id"), { archived: true });
    return c.json({ thread });
  });
  app.post("/api/threads/:id/unarchive", async (c) => {
    const thread = await ensureThread(c.get("owner"), c.req.param("id"), { archived: false });
    return c.json({ thread });
  });
  app.delete("/api/threads/:id", async (c) => {
    const owner = c.get("owner");
    const id = c.req.param("id");
    if (id === mainThreadId) throw new AppError("主会话不能删除");
    await db.remove(owner, "threads", id);
    await db.remove(owner, "conversations", conversationRecordId(id));
    return c.json({ ok: true });
  });
  app.get("/api/main-thread", async (c) => {
    const owner = c.get("owner");
    // 本地会话模式：不需要平台线程，用固定线程号，会话记录由我们自己存
    if (!intelligence) {
      await ensureThread(owner, mainThreadId);
      return c.json({ threadId: mainThreadId, existing: true });
    }
    await db.insertIfAbsent(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    const main = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (!main) throw new AppError("主会话加载失败", 503);
    try {
      await intelligence.getOrCreateThread({
        threadId: main.threadId,
        userId: owner,
        agentId: "default",
      });
    } catch {
      throw new AppError("主会话不可用，检查多会话线程连接后重试。", 502);
    }
    return c.json({ threadId: main.threadId, existing: true });
  });
  const latestTurn = async (owner: string, threadId: string): Promise<ChatTurn | null> => {
    const turns = await db.list<ChatTurn>(owner, "turns");
    const mine = turns
      .filter((turn) => turn.threadId === threadId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const turn = mine[0] ?? null;
    if (turn?.status !== "running") return turn;
    // 看门狗：一轮跑够久了要么被上游拖住、要么早没了下文。
    // 不标它，App 会一直显示"正在生成"等一条永远不来的回复。
    if (Date.parse(turn.startedAt) + TURN_TIMEOUT_MS > Date.now()) return turn;
    const interrupted: ChatTurn = {
      ...turn,
      status: "interrupted",
      error: "这一轮太久没有结果（上游可能卡住了）",
      finishedAt: new Date().toISOString(),
    };
    await db.put(owner, "turns", interrupted);
    return interrupted;
  };
  // 带游标的读取：客户端记着自己看到哪（lastSeq），重连时只拉漏掉的（Telegram 那套 offset）
  app.get("/api/conversation", async (c) => {
    const owner = c.get("owner");
    const threadId = c.req.query("threadId");
    const since = c.req.query("since");
    const stored = await db.get<Conversation>(
      owner,
      "conversations",
      conversationRecordId(threadId),
    );
    const { messages, seq, tombstones } = messagesSince(
      stored,
      conversationRecordId(threadId),
      since === undefined ? undefined : Number(since),
    );
    const turn = threadId ? await latestTurn(owner, threadId) : null;
    // tombstones 总是全量带上：增量里不含被撤回的消息，客户端靠它清掉本地副本（不复活）
    return c.json({ messages, seq, turn, tombstones });
  });
  // 撤回（对应 Muse 的 unsend）：只允许撤回你自己发的消息；写墓碑 + 从会话移除，按消息 id 幂等
  app.delete("/api/conversation", async (c) => {
    const owner = c.get("owner");
    const threadId = c.req.query("threadId");
    const messageId = c.req.query("messageId");
    if (!threadId || !messageId) throw new AppError("缺少会话或消息参数", 400);
    const recordId = conversationRecordId(threadId);
    const current = await db.get<Conversation>(owner, "conversations", recordId);
    const target = current?.messages.find((message) => message.id === messageId);
    if (!target) throw new AppError("这条消息不在会话里（可能已撤回）。", 404);
    if (target.role !== "user") throw new AppError("只能撤回你自己发的消息。", 422);
    const { next } = unsendMessage(current, recordId, messageId, new Date().toISOString());
    await db.put(owner, "conversations", next);
    return c.json({ ok: true });
  });
  // 消息反应（对应 Muse 的 reactions）：在固定表情集上切换；被改的消息 seq 顶到最新，
  // 游标增量会把它重投递给其它端。使用频率单独计数，反应面板按"用得多在前"排序。
  app.post("/api/conversation/reactions", async (c) => {
    const owner = c.get("owner");
    const body = z
      .object({
        threadId: z.string().min(1),
        messageId: z.string().min(1),
        emoji: z.string().min(1).max(8),
      })
      .parse(await c.req.json());
    if (!REACTION_EMOJIS.includes(body.emoji)) throw new AppError("不支持这个表情。", 422);
    const recordId = conversationRecordId(body.threadId);
    const current = await db.get<Conversation>(owner, "conversations", recordId);
    const { next, updated } = toggleReaction(
      current,
      recordId,
      body.messageId,
      body.emoji,
      new Date().toISOString(),
    );
    if (!updated) throw new AppError("这条消息不在会话里（可能已撤回）。", 404);
    await db.put(owner, "conversations", next);
    const usage =
      (await db.get<{ counts?: Record<string, number> }>(owner, "reaction-usage", "usage")) ?? {};
    await db.put(owner, "reaction-usage", {
      id: "usage",
      counts: noteReactionUsage(
        usage.counts,
        body.emoji,
        (updated.reactions as string[]).includes(body.emoji),
      ),
    });
    return c.json({ ok: true, reactions: updated.reactions ?? [] });
  });
  app.get("/api/conversation/reactions", async (c) => {
    const owner = c.get("owner");
    const usage =
      (await db.get<{ counts?: Record<string, number> }>(owner, "reaction-usage", "usage")) ?? {};
    return c.json({ emojis: orderReactionsByUsage(usage.counts) });
  });
  // 追加语义 + 按 id 幂等：重复送同一条不会变两条（至少一次投递要求）
  const appendConversation = async (
    owner: string,
    threadId: string | undefined,
    body: { messages?: unknown },
  ) => {
    const incoming = z.array(z.unknown()).max(1000).parse(body.messages);
    for (const message of incoming) MessageSchema.parse(message);
    const recordId = conversationRecordId(threadId);
    const current = await db.get<Conversation>(owner, "conversations", recordId);
    const { next, added } = appendMessages(current, recordId, incoming, new Date().toISOString());
    await db.put(owner, "conversations", next);
    if (threadId && added.length)
      await ensureThread(owner, threadId, {
        autoTitle: titleFromMessages(next.messages),
        messageCount: next.messages.length,
      });
    await db.put(owner, "conversations", next);
    return { ok: true, seq: next.seq, added: added.length };
  };
  const conversationBody = async (request: { json: () => Promise<unknown> }) => {
    try {
      return (await request.json()) as { messages?: unknown };
    } catch {
      return {} as { messages?: unknown };
    }
  };
  app.post("/api/conversation", async (c) =>
    c.json(
      await appendConversation(
        c.get("owner"),
        c.req.query("threadId"),
        await conversationBody(c.req),
      ),
    ),
  );
  app.put("/api/conversation", async (c) =>
    c.json(
      await appendConversation(
        c.get("owner"),
        c.req.query("threadId"),
        await conversationBody(c.req),
      ),
    ),
  );
  app.post("/api/files", async (c) => {
    const data = await c.req.parseBody();
    const file = data.file;
    if (!(file instanceof File)) throw new AppError("请选择文件（PDF、图片或文本文件）");
    return c.json(
      await files.import(
        c.get("owner"),
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        "Uploaded by you",
      ),
      201,
    );
  });
  app.get("/api/files/:id/content", async (c) => {
    const file = await files.get(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", file.mimeType || "application/octet-stream");
    c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return c.body(await files.bytes(c.get("owner"), file.id));
  });
  // 把文本型文件导出成 PDF（Muse 也有导出）：服务端转 HTML → 浏览器 worker 打印 → 存成一个新文件
  app.post("/api/files/:id/export", async (c) => {
    const body = z.object({ format: z.enum(["pdf", "html"]) }).parse(await c.req.json());
    const owner = c.get("owner");
    const file = await files.get(owner, c.req.param("id"));
    if (!file.mimeType.startsWith("text/"))
      throw new AppError("只有文本、Markdown 或网页文件能导出为 PDF。", 400);
    const text = new TextDecoder().decode(await files.bytes(owner, file.id));
    const isHtmlFile = file.mimeType === "text/html" || /\.html?$/i.test(file.name);
    const document = wrapHtmlDocument(file.name, isHtmlFile ? text : markdownToHtml(text));
    const name = file.name.replace(/\.[^.]+$/, "") || "导出";
    // HTML 导出不需要浏览器：转换器已经产出完整文档，直接存成文件
    if (body.format === "html")
      return c.json(
        await files.import(
          owner,
          `${name}.html`,
          Buffer.from(document, "utf-8"),
          `导出为 HTML：${file.name}`,
        ),
        201,
      );
    const pdf = await browser.exportPdf(owner, "exports", document);
    return c.json(await files.import(owner, `${name}.pdf`, pdf, `导出为 PDF：${file.name}`), 201);
  });
  // 发布：生成/复用一条公开只读链接（token 即能力，停止发布立刻失效）
  app.post("/api/files/:id/publish", async (c) => {
    // 全部可选：不传 = 保持原样，传空串 = 清掉（"再发一次"就是更新发布页设置的入口）
    const body = z
      .object({
        title: z.string().trim().max(120).optional(),
        description: z.string().trim().max(300).optional(),
        coverId: z.string().trim().max(80).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await files.publish(c.get("owner"), c.req.param("id"), body));
  });
  app.delete("/api/files/:id/publish", async (c) =>
    c.json(await files.stopPublish(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/files/:id/fill", async (c) => {
    const body = z
      .object({ fields: z.record(z.string(), z.union([z.string(), z.boolean()])) })
      .parse(await c.req.json());
    return c.json(await files.fill(c.get("owner"), c.req.param("id"), body.fields), 201);
  });
  app.post("/api/mail/import-attachment", async (c) => {
    const body = z.object({ reference: z.string() }).parse(await c.req.json());
    return c.json(await workspace.importAttachment(c.get("owner"), body.reference), 201);
  });
  app.post("/api/google/connect", async (c) => {
    const body = z.object({ capability: z.enum(["read", "write"]) }).parse(await c.req.json());
    if (config.mode === "sample") {
      await db.put(c.get("owner"), "settings", {
        id: "google",
        enabled: true,
        connectionId: randomUUID(),
      });
      return c.json({ url: null, connected: true });
    }
    return c.json(await google.connect(c.get("owner"), body.capability === "write"));
  });
  app.post("/api/google/disconnect", async (c) => {
    if (config.mode === "sample")
      await db.put(c.get("owner"), "settings", { id: "google", enabled: false });
    else await google.disconnect(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/browsers", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.create(c.get("owner"), body.url), 201);
  });
  app.get("/api/browsers/:id", async (c) => {
    const owner = c.get("owner");
    return c.json(browser.decorate(owner, await browser.get(owner, c.req.param("id"))));
  });
  app.post("/api/browsers/:id/navigate", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.navigate(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/close", async (c) =>
    c.json(await browser.close(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/read", async (c) =>
    c.json(await browser.read(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/browsers/:id/reopen", async (c) => {
    const raw = await c.req.text();
    const body = z.object({ url: z.url().max(4096).optional() }).parse(raw ? JSON.parse(raw) : {});
    return c.json(await browser.reopen(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/import-downloads", async (c) =>
    c.json(await browser.imports(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/preview", async (c) => {
    const quality = Number(c.req.query("quality") ?? "");
    const { response, session } = await browser.preview(
      c.get("owner"),
      c.req.param("id"),
      Number.isFinite(quality) && quality >= 20 && quality <= 90 ? { quality } : {},
    );
    c.header("Content-Type", response.headers.get("content-type") ?? "image/png");
    // 控制台每帧都要显示"当前在哪"，跟截图同一响应带回去，省一次往返。
    // HTTP 头只能是 ASCII，标题要 encodeURIComponent（控制台那边 decode）。
    c.header("x-page-url", session.url);
    c.header("x-page-title", encodeURIComponent(session.title));
    return c.body(await response.arrayBuffer());
  });
  app.get("/api/browsers/:id/console", async (c) => {
    await browser.get(c.get("owner"), c.req.param("id"));
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    );
    return c.html(browser.console(c.get("owner"), c.req.param("id")));
  });
  app.post("/api/browsers/:id/console", async (c) => {
    await browser.input(c.get("owner"), c.req.param("id"), await c.req.json());
    return c.json({ ok: true });
  });
  // 新会话的 threadId 由客户端本地生成，平台上并不存在；运行时直接去取线程会 404
  // THREAD_NOT_FOUND，用户看到的就是"发了消息没有任何回复"。这里先 get-or-create 建好平台
  // 线程再交给运行时。已建过的记在内存里，避免每个请求都多打一次平台。
  const knownThreads = new Set<string>();
  const THREAD_ID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  app.all("/api/copilotkit/*", async (c) => {
    // 本轮对话的 turn 记录（请求内局部，避免并发互相覆盖）
    let turn: ChatTurn | undefined;
    if (!agentConfigured(config))
      throw new AppError("要开始聊天，请配置模型与供应商 API key，或一个有效的 AG-UI 端点", 503);
    try {
      let threadId: string | undefined;
      let runId: string | undefined;
      let messages: unknown[] | undefined;
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        const text = await c.req.raw.clone().text();
        if (text) {
          try {
            const body = JSON.parse(text) as {
              threadId?: unknown;
              runId?: unknown;
              messages?: unknown;
            };
            if (typeof body.threadId === "string") threadId = body.threadId;
            if (typeof body.runId === "string") runId = body.runId;
            if (Array.isArray(body.messages)) messages = body.messages;
          } catch {
            // 非 JSON 请求体，忽略
          }
        }
      }
      threadId ??= c.req.path.match(/\/threads\/([0-9a-fA-F-]{36})/)?.[1];
      if (intelligence && threadId && THREAD_ID_RE.test(threadId) && !knownThreads.has(threadId)) {
        await intelligence.getOrCreateThread({
          threadId,
          userId: c.get("owner"),
          agentId: "default",
        });
        knownThreads.add(threadId);
      }
      // 本地会话：进一次对话就把会话登记下来（带上自动标题与消息），
      // 这样侧会话会自己出现在列表里，历史也不依赖 App 主动保存。
      // 一轮对话独立成 turn 记录：即便客户端断开，下面的后台分支也会把回复写进会话
      if (threadId && runId) {
        turn = newTurn(runId, threadId, new Date().toISOString());
        await db.put(c.get("owner"), "turns", turn);
      }
      if (threadId && !intelligence) {
        const owner = c.get("owner");
        await ensureThread(owner, threadId, {
          autoTitle: titleFromMessages(messages),
          messageCount: messages?.length,
        });
        if (messages?.length) {
          try {
            for (const message of messages) MessageSchema.parse(message);
            // 追加而不是替换：后台那一支可能已经写入了这一轮的回复，
            // 用客户端发来的（可能还不含回复的）列表覆盖会把回复弄丢。
            const recordId = conversationRecordId(threadId);
            const current = await db.get<Conversation>(owner, "conversations", recordId);
            const { next } = appendMessages(current, recordId, messages, new Date().toISOString());
            await db.put(owner, "conversations", next);
          } catch {
            // 消息形状不合规就不落库，别影响这一轮对话
          }
        }
      }
    } catch (error) {
      // 不阻断请求：让运行时按原路径如实报错，日志里留下原因
      backgroundFailure("copilotkit-thread-precreate", error);
    }
    const response = await runtime.fetch(c.req.raw);
    // Runtime 1.70 emits SSE strings; a WHATWG Response body requires byte chunks.
    const encoder = new TextEncoder();
    const converted = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        },
      }),
    );
    const activeTurn = turn;
    if (!converted || !activeTurn)
      return new Response(converted ?? null, {
        status: response.status,
        headers: response.headers,
      });
    // 关键：同一条流分两路。客户端那支断了（杀掉 App）不影响另一支，
    // 后台那支把这一轮产生的消息写进会话——重开就能看到完整回复。
    const [toClient, toStore] = converted.tee();
    const owner = c.get("owner");
    void (async () => {
      const collected: AgUiLikeEvent[] = [];
      const { error } = await consumeSse(toStore, (events) => collected.push(...events));
      const now = new Date().toISOString();
      const produced = assembleTurnMessages(collected, now);
      const outcome = error
        ? { status: "failed" as const, error: `连接中断：${error}` }
        : turnOutcome(collected);
      try {
        if (produced.length && activeTurn.threadId) {
          const recordId = conversationRecordId(activeTurn.threadId);
          const current = await db.get<Conversation>(owner, "conversations", recordId);
          const { next } = appendMessages(current, recordId, produced, now);
          await db.put(owner, "conversations", next);
          await ensureThread(owner, activeTurn.threadId, { messageCount: next.messages.length });
        }
        await db.put(owner, "turns", finishTurn(activeTurn, { ...outcome, now }));
        // 这一轮没成功时把实时状态改成"出错了"：否则界面上那条"正在搜索网页…"会一直挂到
        // 90 秒窗口过期，而屏幕上其实已经弹了红色报错（真机撞到过："状态正在搜索，实际已经报错"）
        if (outcome.status === "failed" || outcome.status === "interrupted") {
          await recordActivity(db, owner, {
            id: "current",
            threadId: activeTurn.threadId,
            tool: "error",
            text: outcome.status === "failed" ? "刚才出错了" : "这一轮被打断了",
            detail: friendlyToolError(outcome.error ?? ""),
            at: now,
          });
        }
      } catch (failure) {
        backgroundFailure("chat-turn-persist", failure);
      }
    })();
    return new Response(toClient, { status: response.status, headers: response.headers });
  });
  app.get("/", (c) =>
    c.json({ name: "OpenMuse", app: "http://localhost:8081", health: "/api/health" }),
  );
  return { app, auth, files, actions, workspace, agent, computer };
}
