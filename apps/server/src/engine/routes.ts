import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type {
  AgentIdentity,
  AgentMemory,
  AgentNotification,
} from "../../../../packages/domain/src/agent.ts";
import { AppError } from "../errors.ts";
import { readActivities } from "../live-activity.ts";
import type { AgentService } from "./service.ts";

const text = z.string().trim().min(1).max(4000);
const memorySchema = z.object({ text, source: z.string().trim().min(1).max(200).optional() });
const goalPatchSchema = z.object({
  status: z.enum(["active", "paused", "completed"]).optional(),
  milestones: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

export function agentRoutes(service: AgentService): Hono<{ Variables: { owner: string } }> {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => {
    const owner = c.get("owner");
    const [snapshot, live] = await Promise.all([
      service.snapshot(owner),
      readActivities(service.db, owner),
    ]);
    // live：智能体此刻在干什么（App 的动态页显示实时状态）
    return c.json({ ...snapshot, live });
  });
  app.post("/tasks", async (c) => {
    // 带 Idempotency-Key 的派活可以安全重试：同一个 key 只会产生一个任务
    // （手机网络抖动时 App 会重发，不会变成两个任务）。
    const key = c.req.header("Idempotency-Key")?.trim() || undefined;
    return c.json(await service.createTask(c.get("owner"), await c.req.json(), key), 201);
  });
  app.get("/tasks/:id", async (c) =>
    c.json(await service.detail(c.get("owner"), c.req.param("id"))),
  );
  app.post("/tasks/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "cancel", "retry"]) })
      .parse(await c.req.json());
    return c.json(await service.control(c.get("owner"), c.req.param("id"), action));
  });
  app.post("/tasks/:id/input", async (c) => {
    const body = z
      .object({
        answer: z.string().trim().min(1).max(12000),
        fields: z
          .record(z.string().min(1).max(300), z.union([z.string().max(12000), z.boolean()]))
          .optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.answer(c.get("owner"), c.req.param("id"), body.answer, body.fields),
    );
  });
  app.post("/goals", async (c) =>
    c.json(await service.createGoal(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/goals/:id", async (c) => {
    const body = goalPatchSchema.parse(await c.req.json());
    return c.json(await service.updateGoal(c.get("owner"), c.req.param("id"), body));
  });
  app.post("/monitors", async (c) =>
    c.json(await service.createMonitor(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/monitors/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "stop", "check"]) })
      .parse(await c.req.json());
    return c.json(await service.controlMonitor(c.get("owner"), c.req.param("id"), action));
  });
  // 任务级短时凭据（照 Muse 的 mint/revoke）
  app.get("/credentials", async (c) => c.json(await service.listCredentials(c.get("owner"))));
  app.post("/credentials", async (c) => {
    const body = z
      .object({
        label: z.string().trim().min(1).max(80),
        kind: z.enum(["git", "api", "ssh"]),
        scopes: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
        ttlMs: z
          .number()
          .int()
          .positive()
          .max(24 * 60 * 60_000)
          .optional(),
        taskId: z.string().trim().min(1).max(120).optional(),
      })
      .parse(await c.req.json());
    return c.json(await service.mintCredential(c.get("owner"), body), 201);
  });
  app.post("/credentials/:id/revoke", async (c) =>
    c.json(await service.revokeCredential(c.get("owner"), c.req.param("id"), "manual")),
  );
  app.post("/ideas/refresh", async (c) => c.json(await service.refreshIdeas(c.get("owner"))));
  /** 分页取灵感（照 Muse 的 IdeaCardsPaginationJson） */
  app.get("/ideas", async (c) => {
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = Number(c.req.query("offset") ?? 0);
    return c.json(
      await service.ideasPage(
        c.get("owner"),
        Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
        Number.isFinite(offset) && offset > 0 ? offset : 0,
      ),
    );
  });
  /** 照 Muse 的 IdeaCardExecute：按勾选的条目执行 */
  app.post("/ideas/:id/execute", async (c) => {
    const body = z
      .object({
        itemIds: z.array(z.string()).optional(),
        mode: z.string().trim().max(40).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(
      await service.executeIdea(c.get("owner"), c.req.param("id"), body.itemIds, body.mode),
    );
  });
  app.post("/ideas/:id", async (c) => {
    const body = z
      .object({
        action: z.enum(["accept", "dismiss", "restore", "feedback"]),
        prompt: z.string().trim().min(1).max(12000).optional(),
        value: z.enum(["up", "down"]).optional(),
      })
      .parse(await c.req.json());
    const owner = c.get("owner");
    const id = c.req.param("id");
    if (body.action === "feedback") {
      if (!body.value) throw new AppError("反馈需要 value：up 或 down");
      return c.json(await service.rateIdea(owner, id, body.value));
    }
    return c.json(await service.decideIdea(owner, id, body.action, body.prompt));
  });
  app.post("/memories", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory: AgentMemory = {
      id: randomUUID(),
      text: body.text,
      source: body.source ?? "You",
      createdAt: new Date().toISOString(),
    };
    return c.json(await service.db.put(c.get("owner"), "memories", memory), 201);
  });
  app.post("/memories/:id", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory = await service.db.compareAndSwap<AgentMemory>(
      c.get("owner"),
      "memories",
      c.req.param("id"),
      {},
      body,
    );
    if (!memory) throw new AppError("找不到这条记忆", 404);
    return c.json(memory);
  });
  app.post("/memories/:id/forget", async (c) => {
    if (!(await service.db.take(c.get("owner"), "memories", c.req.param("id"))))
      throw new AppError("找不到这条记忆", 404);
    return c.json({ ok: true });
  });
  app.post("/identity", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        tone: z.enum(["warm", "concise", "thoughtful"]),
        avatar: z.enum(["sky", "sand", "lilac"]).optional(),
        showChatUpdates: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const owner = c.get("owner");
    await service.ensure(owner);
    const identity = await service.db.compareAndSwap<AgentIdentity>(
      owner,
      "agent-settings",
      "identity",
      {},
      body,
    );
    if (!identity) throw new AppError("智能体身份已变更，刷新后重试", 409);
    return c.json(identity);
  });
  app.get("/notifications", async (c) =>
    c.json((await service.snapshot(c.get("owner"))).notifications),
  );
  app.post("/notifications/:id/read", async (c) => {
    const notification = await service.db.compareAndSwap<AgentNotification>(
      c.get("owner"),
      "notifications",
      c.req.param("id"),
      {},
      { read: true },
    );
    if (!notification) throw new AppError("找不到这条通知", 404);
    return c.json(notification);
  });
  app.post("/sample-page", async (c) => {
    if (service.config.mode !== "sample") throw new AppError("未找到", 404);
    const body = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
    await service.db.put(c.get("owner"), "sample-pages", { id: "availability", text: body.text });
    return c.json({ ok: true });
  });
  return app;
}
