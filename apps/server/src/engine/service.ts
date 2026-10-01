import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type AgentArtifact,
  type AgentIdentity,
  type AgentMemory,
  type AgentNotification,
  type AgentTask,
  type AgentWorkspace,
  createTaskSchema,
  type Evidence,
  type Goal,
  goalInputSchema,
  type Idea,
  type Monitor,
  monitorInputSchema,
  type RunEvent,
} from "../../../../packages/domain/src/agent.ts";
import type {
  ActionProposal,
  Artifact,
  BrowserSession,
  Mail,
  ProposalInput,
} from "../../../../packages/domain/src/index.ts";
import type { ActionService } from "../actions.ts";
import type { BrowserService } from "../browser.ts";
import { ComputerService } from "../computer.ts";
import type { Config } from "../config.ts";
import {
  listCredentials,
  mintCredential,
  revokeCredential,
  revokeForTask,
  sweepExpired,
} from "../credentials.ts";
import type { Store } from "../db.ts";
import { AppError } from "../errors.ts";
import type { Files } from "../files.ts";
import { backgroundFailure } from "../log.ts";
import { SearchService } from "../search.ts";
import type { WorkspaceService } from "../workspace.ts";
import { analyzeSpending } from "./finance.ts";
import { executeModelTask } from "./model.ts";
import { LostLeaseError, type TaskContext, TaskWorker } from "./worker.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = () => new Date().toISOString();
const terminal = new Set(["succeeded", "failed", "cancelled"]);
export class AgentService {
  readonly worker: TaskWorker;
  private maintenance?: ReturnType<typeof setInterval>;
  private refreshing = false;
  constructor(
    readonly db: Store,
    readonly config: Config,
    readonly workspace: WorkspaceService,
    readonly files: Files,
    readonly actions: ActionService,
    readonly browser: BrowserService,
    readonly computer: ComputerService = new ComputerService(db, config),
    readonly search: SearchService = new SearchService(config, browser),
  ) {
    this.worker = new TaskWorker(db, (owner, task, context) => this.execute(owner, task, context), {
      settled: (owner, task) => this.publishOutcome(owner, task),
    });
  }
  start() {
    this.worker.start();
    // Maintenance is independent of the HTTP response and reconciles durable records.
    void this.maintain().catch((error) => backgroundFailure("initial maintenance", error));
    this.maintenance = setInterval(() => {
      void this.maintain().catch((error) => backgroundFailure("maintenance", error));
    }, 60000);
  }
  async stop() {
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = undefined;
    await this.worker.stop();
    while (this.refreshing) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  private async maintain() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // Recover publications if the process exited after committing an outcome.
      for (const { owner, value } of await this.db.scan<AgentTask>("tasks"))
        await this.publishOutcome(owner, value);
      for (const { owner, value } of await this.db.scan<Monitor>("monitors"))
        await this.activateMonitor(owner, value);
      for (const { owner, value } of await this.db.scan<Idea>("ideas"))
        if (
          value.status === "accepted" &&
          value.taskId &&
          !(await this.db.get(owner, "tasks", value.taskId))
        )
          await this.decideIdea(owner, value.id, "accept").catch(async (error) => {
            backgroundFailure("recover accepted idea", error);
            await this.notify(
              owner,
              "已采纳的灵感需要处理",
              "Open the idea again after making room for another task.",
              undefined,
              `idea-recovery:${value.id}`,
            );
          });
      for (const { owner, value } of await this.db.scan<{ id: string; lastIdeasAt?: string }>(
        "agent-settings",
      )) {
        if (value.id !== "identity") continue;
        if (!value.lastIdeasAt || Date.now() - Date.parse(value.lastIdeasAt) > 15 * 60000)
          await this.refreshIdeas(owner).catch(async () => {
            await this.notify(
              owner,
              "来源刷新需要处理",
              "Reconnect the source or refresh Ideas to see the error.",
              undefined,
              `source-error:${Math.floor(Date.now() / 3600000)}`,
            );
          });
      }
    } finally {
      this.refreshing = false;
    }
  }
  async ensure(owner: string) {
    await this.db.insertIfAbsent(owner, "agent-settings", {
      id: "identity",
      name: "OpenMuse",
      tone: "warm",
    });
  }
  async snapshot(owner: string): Promise<AgentWorkspace> {
    await this.ensure(owner);
    const [tasks, goals, monitors, ideas, memories, artifacts, notifications, identity] =
      await Promise.all([
        this.db.list<AgentTask>(owner, "tasks"),
        this.db.list<Goal>(owner, "goals"),
        this.db.list<Monitor>(owner, "monitors"),
        this.db.list<Idea>(owner, "ideas"),
        this.db.list<AgentMemory>(owner, "memories"),
        this.db.list<AgentArtifact>(owner, "agent-artifacts"),
        this.db.list<AgentNotification>(owner, "notifications"),
        this.db.get<AgentIdentity>(owner, "agent-settings", "identity"),
      ]);
    const heartbeat = await this.db.get<{ lastTickAt: string }>("system", "worker-status", "tasks");
    // 每个任务带上"最近一步"：任务列表要像 Muse 那样，行里直接显示它刚做了什么
    const runEvents = await this.db.list<RunEvent>(owner, "run-events");
    const latestStep = new Map<string, RunEvent>();
    for (const event of runEvents) {
      if (!event.taskId) continue;
      const current = latestStep.get(event.taskId);
      if (!current || event.date > current.date) latestStep.set(event.taskId, event);
    }
    const tasksWithSteps = tasks.map((task) => {
      const step = latestStep.get(task.id);
      return step
        ? {
            ...task,
            lastStep: {
              kind: step.kind,
              title: step.title,
              detail: step.detail ?? "",
              date: step.date,
            },
          }
        : task;
    });
    return {
      tasks: tasksWithSteps,
      goals,
      monitors,
      ideas,
      memories,
      artifacts,
      notifications,
      identity: identity ?? { name: "OpenMuse", tone: "warm" },
      worker: {
        running:
          this.worker.running ||
          Boolean(heartbeat && Date.now() - Date.parse(heartbeat.lastTickAt) < 15000),
        lastTickAt: heartbeat?.lastTickAt ?? this.worker.lastTickAt,
      },
    };
  }
  async getTask(owner: string, id: string) {
    const task = await this.db.get<AgentTask>(owner, "tasks", id);
    if (!task) throw new AppError("找不到这个任务", 404);
    return task;
  }
  async detail(owner: string, id: string) {
    const task = await this.getTask(owner, id);
    const files = (await this.db.list<Artifact>(owner, "files")).filter((file) =>
      task.artifactIds.includes(file.id),
    );
    const browsers = (await this.db.list<BrowserSession>(owner, "browsers")).filter((browser) =>
      [task.state.browserId, task.state.sessionId].includes(browser.id),
    );
    return {
      task,
      files: files.map((file) => this.files.signed(owner, file)),
      browsers: browsers.map((browser) => this.browser.decorate(owner, browser)),
      events: (await this.db.list<RunEvent>(owner, "run-events"))
        .filter((e) => e.taskId === id)
        .sort((a, b) => a.date.localeCompare(b.date)),
      artifacts: (await this.db.list<AgentArtifact>(owner, "agent-artifacts")).filter(
        (a) => a.taskId === id,
      ),
    };
  }
  async createTask(owner: string, raw: unknown, idempotencyKey?: string, held = false) {
    const input = createTaskSchema.parse(raw);
    if (input.goalId && !(await this.db.get(owner, "goals", input.goalId)))
      throw new AppError("找不到这个目标", 404);
    const id = idempotencyKey ? hash(`task:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<AgentTask>(owner, "tasks", id);
    if (existing) return existing;
    if (
      (await this.db.list<AgentTask>(owner, "tasks")).filter((t) => !terminal.has(t.status))
        .length >= 100
    )
      throw new AppError("先完成或取消一些任务，再添加新的", 409);
    const titles =
      input.kind === "document"
        ? ["找到原始文档", "填写新的副本", "准备回复", "等你的决定", "记录结果"]
        : input.kind === "monitor"
          ? ["检查来源", "与上次观察对比", "报告有意义的变化"]
          : input.kind === "finance"
            ? ["校验账目", "计算汇总", "保存你的记录"]
            : ["理解目标", "规划步骤", "使用已连接的工具", "交付结果"];
    const task: AgentTask = {
      id,
      title: input.title ?? input.prompt.slice(0, 90),
      prompt: input.prompt,
      kind: input.kind,
      goalId: input.goalId,
      threadId: input.threadId,
      status: held ? "paused" : "queued",
      plan: titles.map((title, i) => ({ id: String(i), title, status: "pending" })),
      evidence: [],
      input: input.input,
      state: {
        connectionId: (await this.workspace.connection(owner))?.id ?? null,
        ...(held && input.kind === "monitor" ? { initializingMonitor: true } : {}),
      },
      createdAt: date(),
      updatedAt: date(),
      attempts: 0,
      leaseId: null,
      leaseUntil: null,
      artifactIds: [],
    };
    await this.ensure(owner);
    await this.db.insertIfAbsent(owner, "tasks", task);
    return (await this.db.get<AgentTask>(owner, "tasks", id)) ?? task;
  }
  async control(owner: string, id: string, action: "pause" | "resume" | "cancel" | "retry") {
    const task = await this.getTask(owner, id);
    if (action === "cancel" && task.status === "succeeded")
      throw new AppError("这个任务已完成", 409);
    if (action === "retry" && task.status !== "failed")
      throw new AppError("只有失败的任务可以重试", 409);
    if (action === "resume" && task.status !== "paused")
      throw new AppError("只有已暂停的任务可以继续", 409);
    if (action === "pause" && (terminal.has(task.status) || task.status === "paused")) return task;
    const status =
      action === "cancel"
        ? "cancelled"
        : action === "pause"
          ? "paused"
          : task.actionId
            ? "waiting_approval"
            : "queued";
    if (action === "retry" && task.actionId) {
      const a = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (a && a.status !== "succeeded")
        throw new AppError("重试前先核对这次操作的结果（可能不确定）；核对清楚后请新建任务。", 409);
    }
    const updated = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: task.status, leaseId: task.leaseId ?? null },
      {
        status,
        leaseId: null,
        leaseUntil: null,
        error: null,
        updatedAt: date(),
        result:
          action === "cancel"
            ? "Stopped by you."
            : action === "pause"
              ? "Paused. Resume when you're ready."
              : "",
        ...(task.kind === "monitor" && action === "resume"
          ? { state: { ...task.state, failures: 0, notice: null, resumingMonitor: false } }
          : {}),
      },
    );
    if (!updated) throw new AppError("任务已变更，刷新后重试", 409);
    this.worker.abort(id);
    if (task.kind === "monitor")
      await this.db.compareAndSwap(
        owner,
        "monitors",
        String(task.input.monitorId),
        {},
        {
          status: action === "cancel" ? "stopped" : action === "pause" ? "paused" : "active",
          nextCheckAt: date(),
          // Clearing the error fences out a failure reconcile that read the task before this.
          ...(action === "resume" || action === "retry" ? { error: null } : {}),
        },
      );
    if (action === "cancel" && task.actionId) {
      const proposal = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (proposal?.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
    }
    await this.db.put(owner, "run-events", {
      id: randomUUID(),
      taskId: id,
      kind: "status",
      date: date(),
      title: `Task ${status}`,
      detail: "由你修改",
    });
    return updated;
  }
  async answer(
    owner: string,
    id: string,
    answer: string,
    fields?: Record<string, string | boolean>,
  ) {
    const task = await this.getTask(owner, id);
    if (task.status !== "waiting_input") throw new AppError("这个任务不在等待输入", 409);
    const next = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: "waiting_input" },
      {
        status: "queued",
        question: null,
        input: { ...task.input, ...(fields ? { fields } : {}) },
        state: { ...task.state, answer },
        updatedAt: date(),
      },
    );
    if (!next) throw new AppError("任务已变更，刷新后重试", 409);
    return next;
  }
  async createGoal(owner: string, raw: unknown, id?: string) {
    const input = goalInputSchema.parse(raw);
    const goal: Goal = {
      id: id ?? randomUUID(),
      title: input.title,
      description: input.description,
      category: input.category,
      status: "active",
      milestones: input.milestones.map((title) => ({ id: randomUUID(), title, done: false })),
      createdAt: date(),
    };
    await this.db.insertIfAbsent(owner, "goals", goal);
    return (await this.db.get<Goal>(owner, "goals", goal.id)) ?? goal;
  }
  async updateGoal(
    owner: string,
    id: string,
    patch: { status?: Goal["status"]; milestones?: Goal["milestones"] },
  ) {
    const goal = await this.db.get<Goal>(owner, "goals", id);
    if (!goal) throw new AppError("找不到这个目标", 404);
    const saved = await this.db.put(owner, "goals", { ...goal, ...patch });
    if (patch.status === "paused")
      for (const task of await this.db.list<AgentTask>(owner, "tasks"))
        if (task.goalId === id && !terminal.has(task.status) && task.status !== "paused")
          await this.control(owner, task.id, "pause");
    return saved;
  }
  async createMonitor(owner: string, raw: unknown, idempotencyKey?: string) {
    const input = monitorInputSchema.parse(raw);
    const url = new URL(input.url);
    if (url.protocol === "sample:" && this.config.mode !== "sample")
      throw new AppError("示例来源在真实工作区中不可用", 422);
    if (!["https:", "http:", "sample:"].includes(url.protocol) || url.username || url.password)
      throw new AppError("请使用公开的 HTTP(S) 页面", 422);
    if (url.protocol === "sample:" && input.url !== "sample://availability")
      throw new AppError("未知的示例来源", 422);
    const id = idempotencyKey ? hash(`monitor:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<Monitor>(owner, "monitors", id);
    if (existing) {
      await this.activateMonitor(owner, existing);
      return existing;
    }
    const task = await this.createTask(
      owner,
      {
        kind: "monitor",
        title: input.title,
        prompt: `Watch ${input.url} for ${input.condition}${input.value ? `: ${input.value}` : ""}`,
        input: { monitorId: id },
      },
      `monitor:${id}`,
      true,
    );
    const monitor: Monitor = {
      id,
      taskId: task.id,
      ...input,
      status: "active",
      nextCheckAt: date(),
      checks: 0,
    };
    await this.db.insertIfAbsent(owner, "monitors", monitor);
    await this.activateMonitor(owner, monitor);
    return monitor;
  }
  private async activateMonitor(owner: string, monitor: Monitor) {
    if (monitor.status !== "active") return null;
    const task = await this.getTask(owner, monitor.taskId);
    if (task.status !== "paused") return null;
    if (task.state.resumingMonitor)
      return this.db.compareAndSwap(
        owner,
        "tasks",
        task.id,
        { status: "paused", state: { resumingMonitor: true } },
        {
          status: "queued",
          nextRunAt: date(),
          leaseId: null,
          leaseUntil: null,
          error: null,
          state: { ...task.state, resumingMonitor: false, failures: 0, notice: null },
        },
      );
    if (!task.state.initializingMonitor) return null;
    return this.db.compareAndSwap(
      owner,
      "tasks",
      task.id,
      { status: "paused", attempts: 0, state: { initializingMonitor: true } },
      {
        status: "queued",
        state: { ...task.state, initializingMonitor: false },
      },
    );
  }
  async controlMonitor(owner: string, id: string, action: "pause" | "resume" | "stop" | "check") {
    const monitor = await this.db.get<Monitor>(owner, "monitors", id);
    if (!monitor) throw new AppError("找不到这个监控", 404);
    if (monitor.status === "stopped" && action !== "stop")
      throw new AppError("要重启这个已停止的监控，请新建一个监控", 409);
    if (action === "pause" || action === "stop") {
      const status = action === "pause" ? "paused" : "stopped";
      const saved = await this.db.put(owner, "monitors", {
        ...monitor,
        status,
        nextCheckAt: date(),
      });
      const task = await this.getTask(owner, monitor.taskId);
      await this.control(owner, task.id, action === "pause" ? "pause" : "cancel");
      return saved;
    }
    let monitorStatus = monitor.status;
    for (let attempt = 0; attempt < 2; attempt++) {
      const task = await this.getTask(owner, monitor.taskId);
      if (task.status === "cancelled") break;
      if (task.status === "paused") {
        // Mark the paused task before activating the monitor so no worker can claim it in between.
        const marked = await this.db.compareAndSwap(
          owner,
          "tasks",
          task.id,
          { status: "paused", leaseId: task.leaseId ?? null },
          { state: { ...task.state, resumingMonitor: true } },
        );
        if (!marked) break;
        const activated = await this.db.compareAndSwap<Monitor>(
          owner,
          "monitors",
          id,
          { status: monitor.status },
          { status: "active", nextCheckAt: date(), error: null },
        );
        const saved = activated ?? (await this.db.get<Monitor>(owner, "monitors", id));
        if (saved?.status === "active" && (await this.activateMonitor(owner, saved))) return saved;
        const unmarked = await this.db.compareAndSwap(
          owner,
          "tasks",
          task.id,
          { status: "paused", state: { resumingMonitor: true } },
          { state: { ...task.state, resumingMonitor: false } },
        );
        // Another request or maintenance may have finished this resume first.
        if (!unmarked && saved?.status === "active") {
          const latest = await this.getTask(owner, task.id);
          if (["queued", "running", "scheduled"].includes(latest.status)) return saved;
        }
        if (activated)
          await this.db.compareAndSwap(
            owner,
            "monitors",
            id,
            { status: "active" },
            { status: monitor.status, error: monitor.error ?? null },
          );
        break;
      }
      // Only activate the monitor we read, so a concurrent stop is never undone.
      const saved = await this.db.compareAndSwap<Monitor>(
        owner,
        "monitors",
        id,
        { status: monitorStatus },
        { status: "active", nextCheckAt: date() },
      );
      if (!saved) break;
      monitorStatus = "active";
      this.worker.abort(task.id);
      const queued = await this.db.compareAndSwap(
        owner,
        "tasks",
        task.id,
        // updatedAt fences out a whole run finishing in between, which would move the baseline.
        { status: task.status, leaseId: task.leaseId ?? null, updatedAt: task.updatedAt },
        {
          status: "queued",
          nextRunAt: date(),
          leaseId: null,
          leaseUntil: null,
          error: null,
          state: { ...task.state, failures: 0, notice: null },
        },
      );
      if (queued) return saved;
    }
    throw new AppError("更新时监控已变更，请重试。", 409);
  }
  /**
   * 照 Muse 给生成出来的灵感补上"卡片该有的东西"：可勾选条目（IdeaCardItem）、
   * 角标（badges）、以及"做出来会得到什么"（buildSummary）。
   * Muse 那边这些是服务端下发的（IdeaCardPresentationJson），我们同样由服务端定，客户端只画。
   */
  private enrichIdea(idea: Idea): Idea {
    const byKind: Record<string, Pick<Idea, "items" | "badges" | "buildSummary">> = {
      document: {
        badges: ["来自邮件", "需要你确认"],
        buildSummary: "会得到一份填好的 PDF，外加一封待你确认的回复草稿。",
        items: [
          {
            id: "fill",
            kind: "document",
            title: "把表填好",
            summary: "按邮件里的要求逐项填，缺的信息先问你",
            buildSummary: "填好的 PDF",
            selectable: true,
            selected: true,
          },
          {
            id: "reply",
            kind: "reply",
            title: "拟一封回复",
            summary: "写好但不发，等你确认",
            buildSummary: "回复草稿",
            selectable: true,
            selected: true,
          },
        ],
      },
      agent: {
        badges: ["来自邮件"],
        buildSummary: "会得到一条明确的下步建议 + 一封待你确认的回复。",
        items: [
          {
            id: "calendar",
            kind: "check",
            title: "查我的日历",
            summary: "看那段时间有没有冲突",
            buildSummary: "可用时段",
            selectable: true,
            selected: true,
          },
          {
            id: "reply",
            kind: "reply",
            title: "拟一封回复",
            summary: "给出两三个可选时间，等你确认",
            buildSummary: "回复草稿",
            selectable: true,
            selected: true,
          },
        ],
      },
      plan: {
        badges: ["来自目标"],
        buildSummary: "会得到一份可执行的计划（里程碑 + 每一步的验收标准）。",
        items: [
          {
            id: "milestones",
            kind: "plan",
            title: "拆出里程碑",
            summary: "把目标拆成 3–6 个能验收的里程碑",
            buildSummary: "里程碑清单",
            selectable: true,
            selected: true,
          },
        ],
      },
    };
    const extra = byKind[idea.kind];
    return extra ? { ...idea, ...extra } : idea;
  }

  /**
   * 照 Muse 的 `SeededIdeaDetail{detail, isExecutable}`：**没有任何来源时也给几张能立刻做的事**，
   * 而不是让界面空着（用户真实反馈就是"点了也没反应"，因为一个应用都没连）。
   * 种子灵感不需要外部来源，全部可直接执行；一旦有真实来源就不再展示（避免混淆）。
   */
  private seededIdeas(): Idea[] {
    const at = date();
    const seeds: Array<Omit<Idea, "id" | "createdAt" | "status">> = [
      {
        title: "帮我盯一个网页，变了就告诉我",
        reason:
          "你现在还没连接邮箱或日历，所以我先给能立刻做的事。告诉我盯哪个页面，我每天替你看一次。",
        prompt: "帮我盯一个网页的变化。先问我盯哪个网址、关心页面上的哪部分，然后建立监控。",
        kind: "monitor",
        input: {},
        seeded: true,
        badges: ["种子灵感", "可直接执行"],
        buildSummary: "会建立一个定时监控，页面一变就通知你。",
        evidence: [],
      },
      {
        title: "给一个话题做调研，写成一份报告",
        reason: "没有来源也能做：我会去搜、去读，然后把结论整理成一份带出处的报告。",
        prompt: "围绕我给的话题做一次调研，用中文写成一份带来源链接的报告，存成文件给我。",
        kind: "agent",
        input: {},
        seeded: true,
        badges: ["种子灵感", "可直接执行"],
        buildSummary: "会得到一份带出处的中文报告（并保存成文件）。",
        evidence: [],
      },
      {
        title: "把一堆零散的事排出优先级",
        reason: "没有来源也能做：把你要做的事丢给我，我按紧急/重要排一遍并给出今天先做的三件。",
        prompt:
          "我接下来会给你一堆要做的事，请你排出优先级，并告诉我今天最该先做的三件。先问我有哪些事。",
        kind: "plan",
        input: {},
        seeded: true,
        badges: ["种子灵感", "可直接执行"],
        buildSummary: "会得到一份排好序的清单 + 今天先做的三件事。",
        evidence: [],
      },
    ];
    return seeds.map((seed) => ({
      ...seed,
      id: hash(`seed:${seed.title}`),
      status: "new" as const,
      createdAt: at,
    }));
  }

  /**
   * 按**当前**模板重写一条灵感的文案（恢复/重新处理时用）。
   * 灵感 id 是按来源内容哈希的：来源过期后即使模板改了也不会再生成，
   * 存量记录就会一直挂着旧文案（实测：模板已中文化，界面上还是英文标题）。
   * 只用记录里已有的信息（evidence 的标题就是来源标题）重写；重写不出来就原样返回。
   */
  private renderIdeaText(idea: Idea): Idea {
    const source = idea.evidence?.[0]?.title?.trim();
    if (!source) return idea;
    const byKind: Record<string, { title: string; reason: string; prompt: string }> = {
      document: {
        title: `我可以帮你处理「${source}」`,
        reason: "对方发来一份可能需要你处理的文档。我可以先处理好，并拟一份回复给你过目。",
        prompt: `帮我填好「${source}」这份 PDF，并拟一份回复供我确认。`,
      },
      agent: {
        title: `我可以帮你对接「${source}」`,
        reason: "对方提到了见面的事。我可以查一下你的日历，并拟一份回复给你过目。",
        prompt: `看一下邮件「${source}」，查我的日历，给出下一步建议。缺偏好就先问我，再拟回复。`,
      },
      plan: {
        title: `给「${source}」做个计划吧`,
        reason: "这个目标还没有任何里程碑。一份具体的计划能让它有下一步。",
        prompt: `为「${source}」制定一份可执行的计划。`,
      },
    };
    const text = byKind[idea.kind];
    return text ? { ...idea, ...text } : idea;
  }

  /**
   * 写一条灵感：没有就插入；**已有但仍未处理**（status=new）就刷新文案。
   * 灵感 id 是按来源内容哈希出来的，文案改了（比如本地化）之后如果只 insertIfAbsent，
   * 老记录会一直挂着旧文案 —— 实测就撞到过：模板已中文化，界面上还是英文标题。
   */
  private async upsertIdea(owner: string, raw: Idea) {
    const idea = this.enrichIdea(raw);
    const existing = await this.db.get<Idea>(owner, "ideas", idea.id);
    if (!existing) return this.db.insertIfAbsent(owner, "ideas", idea);
    if (existing.status !== "new") return existing;
    return (
      (await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        idea.id,
        { status: "new" },
        {
          title: idea.title,
          reason: idea.reason,
          prompt: idea.prompt,
          items: idea.items,
          badges: idea.badges,
          buildSummary: idea.buildSummary,
        },
      )) ?? existing
    );
  }

  async refreshIdeas(owner: string) {
    const w = await this.workspace.snapshot(owner);
    const sentIds = new Set(
      w.mail.filter((mail) => /^Sent\b/i.test(mail.label)).map((mail) => mail.id),
    );
    const completedSources = new Set(
      (await this.db.list<AgentTask>(owner, "tasks"))
        .filter((task) => task.status === "succeeded" && typeof task.input.messageId === "string")
        .map((task) => `${task.kind}:${task.input.messageId}`),
    );
    const obsolete = (kind: AgentTask["kind"], messageId: unknown) =>
      typeof messageId === "string" &&
      (sentIds.has(messageId) || completedSources.has(`${kind}:${messageId}`));
    // Retire earlier suggestions as well as preventing new duplicates. A concurrent
    // acceptance wins its own compare-and-swap and is never overwritten here.
    for (const idea of await this.db.list<Idea>(owner, "ideas"))
      if (idea.status === "new" && obsolete(idea.kind, idea.input.messageId))
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          { status: "dismissed" },
        );
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("document", m.id) &&
          m.attachments.length &&
          /form|permission|complete|fill|sign/i.test(`${m.subject} ${m.body}`),
      )
      .slice(0, 5)) {
      const id = hash(`document:${mail.id}:${mail.body}`);
      const idea: Idea = {
        id,
        title: `我可以帮你处理「${mail.subject}」`,
        reason: `${mail.sender} 发来一份可能需要你处理的文档。我可以先处理好，并拟一份回复给你过目。`,
        evidence: [this.mailEvidence(mail)],
        prompt: `帮我填好「${mail.subject}」这份 PDF，并拟一份回复供我确认。`,
        kind: "document",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      };
      await this.upsertIdea(owner, idea);
    }
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("agent", m.id) &&
          /coffee|meet|available|schedule/i.test(`${m.subject} ${m.body}`),
      )
      .slice(0, 5)) {
      await this.upsertIdea(owner, {
        id: hash(`coordination:${mail.id}`),
        title: `我可以帮你对接「${mail.subject}」`,
        reason: `${mail.sender} 提到了见面的事。我可以查一下你的日历，并拟一份回复给你过目。`,
        evidence: [this.mailEvidence(mail)],
        prompt: `看一下邮件「${mail.subject}」，查我的日历，给出下一步建议。缺偏好就先问我，再拟回复。`,
        kind: "agent",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      } satisfies Idea);
    }
    for (const goal of await this.db.list<Goal>(owner, "goals"))
      if (goal.status === "active" && !goal.milestones.length) {
        const id = hash(`goal:${goal.id}:${goal.description}`);
        await this.upsertIdea(owner, {
          id,
          title: `给「${goal.title}」做个计划吧`,
          reason: "这个目标还没有任何里程碑。一份具体的计划能让它有下一步。",
          evidence: [{ id: goal.id, kind: "user", title: goal.title, excerpt: goal.description }],
          prompt: `为「${goal.title}」制定一份可执行的计划。${goal.description}`,
          kind: "plan",
          input: { goalId: goal.id },
          status: "new",
          createdAt: date(),
        } satisfies Idea);
      }
    // 反馈回流（照 Muse 的 IdeaFeedback）：用户点过踩的方向不再推荐；
    // 点过赞的不动 —— 那是他自己认可过的，别替他撤。
    const rated = await this.db.list<Idea>(owner, "ideas");
    const disliked = new Set(
      rated.filter((idea) => idea.feedback === "down").map((idea) => idea.kind),
    );
    if (disliked.size)
      for (const idea of rated)
        if (idea.status === "new" && idea.feedback !== "up" && disliked.has(idea.kind))
          await this.db.compareAndSwap(
            owner,
            "ideas",
            idea.id,
            { status: "new" },
            { status: "dismissed" },
          );
    // 回填：存量灵感可能是在补 items/badges/buildSummary 之前生成的，
    // 来源过期就不会再走生成路径，于是永远缺这些字段（实测就撞到了）。
    for (const idea of await this.db.list<Idea>(owner, "ideas"))
      if (idea.status === "new" && !idea.seeded && (!idea.items || !idea.buildSummary))
        // 文案也一起按当前模板重写：存量记录可能是本地化之前生成的，
        // 界面上就会中英混杂（实测截图里那条理由还是英文）
        await this.upsertIdea(owner, this.renderIdeaText(idea));
    // 照 Muse 的种子灵感：一个真实来源都没有（或都被处理过）时，给几张能立刻做的，
    // 而不是让界面空着 ——"点了也没反应"就是这么来的
    const current = await this.db.list<Idea>(owner, "ideas");
    const hasReal = current.some(
      (idea) => idea.status === "new" && !idea.seeded && idea.feedback !== "down",
    );
    if (!hasReal) for (const seed of this.seededIdeas()) await this.upsertIdea(owner, seed);
    await this.ensure(owner);
    await this.db.compareAndSwap(owner, "agent-settings", "identity", {}, { lastIdeasAt: date() });
    return this.db.list<Idea>(owner, "ideas");
  }
  /** 铸一把任务级短时凭据（照 Muse 的 LinkDeviceTokenMinter.mintDeviceTokens）。 */
  async mintCredential(
    owner: string,
    input: {
      label: string;
      kind: "git" | "api" | "ssh";
      scopes?: string[];
      ttlMs?: number;
      taskId?: string;
    },
  ) {
    const { credential, secret } = await mintCredential(this.db, owner, input);
    // 明文只在铸的这一刻返回一次；库里存着供工具取用，接口此后只回后 6 位
    return { ...credential, secret, secretTail: `…${secret.slice(-6)}` };
  }
  async listCredentials(owner: string) {
    await sweepExpired(this.db, owner);
    return listCredentials(this.db, owner);
  }
  async revokeCredential(
    owner: string,
    id: string,
    reason: "manual" | "task_finished" | "expired" = "manual",
  ) {
    return revokeCredential(this.db, owner, id, reason);
  }

  /**
   * 照 Muse 的 `IdeaCardExecuteRequestJson{itemIds, mode}` → `IdeaCardExecuteResult`
   * 一条灵感可以只做其中几件：勾选的条目会被记下来（isSelected），并作为任务的限定范围。
   */
  async executeIdea(owner: string, id: string, itemIds?: string[], mode?: string) {
    const idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("找不到这条灵感", 404);
    const all = idea.items ?? [];
    const picked = all.filter((item) =>
      itemIds?.length ? itemIds.includes(item.id) : item.selected !== false,
    );
    if (all.length)
      await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        {},
        {
          items: all.map((item) => ({
            ...item,
            selected: picked.some((chosen) => chosen.id === item.id),
          })),
          mode,
        },
      );
    const scope = picked.length
      ? `\n\n这次只做这几件：${picked.map((item) => item.title).join("、")}。`
      : "";
    return this.decideIdea(owner, id, "accept", `${idea.prompt}${scope}`);
  }

  /** 分页取灵感（照 Muse 的 IdeaCardsPaginationJson：feed 是分页的）。 */
  async ideasPage(owner: string, limit = 20, offset = 0) {
    const all = await this.db.list<Idea>(owner, "ideas");
    const ordered = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ideas: ordered.slice(offset, offset + limit),
      total: ordered.length,
      hasMore: offset + limit < ordered.length,
    };
  }

  /**
   * 记录用户对一条灵感的反馈（Muse: IdeaFeedback{UP, DOWN}）。
   * 只是打分，不改状态 —— 卡片仍留在列表里，用户可以接着接受或忽略。
   */
  async rateIdea(owner: string, id: string, value: "up" | "down") {
    const idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("找不到这条灵感", 404);
    return (
      (await this.db.compareAndSwap<Idea>(owner, "ideas", id, {}, { feedback: value })) ?? idea
    );
  }

  async decideIdea(
    owner: string,
    id: string,
    action: "accept" | "dismiss" | "restore",
    prompt?: string,
  ) {
    let idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("找不到这条灵感", 404);
    // 撤销忽略：把被忽略的那条放回"待处理"（灵感按来源去重，只有这一条路能让它重新出现）
    if (action === "restore") {
      // 顺手按当前模板重写文案：存量记录可能还挂着旧版（甚至旧语言）的措辞
      const fresh = this.renderIdeaText(idea);
      return (
        (await this.db.compareAndSwap<Idea>(
          owner,
          "ideas",
          id,
          { status: "dismissed" },
          { status: "new", title: fresh.title, reason: fresh.reason, prompt: fresh.prompt },
        )) ?? idea
      );
    }
    if (idea.status === "dismissed" || (idea.status === "accepted" && action === "dismiss"))
      return idea;
    if (action === "dismiss")
      return this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        { status: "dismissed" },
      );
    if (idea.status === "new") {
      const claimed = await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        {
          status: "accepted",
          taskId: hash(`task:idea:${id}`),
          prompt: prompt ?? idea.prompt,
        },
      );
      idea = claimed ?? (await this.db.get<Idea>(owner, "ideas", id));
      if (idea?.status !== "accepted") return idea;
    }
    const goal = await this.createGoal(
      owner,
      { title: idea.title, description: idea.reason },
      hash(`idea-goal:${id}`),
    );
    const task = await this.createTask(
      owner,
      {
        title: idea.title,
        prompt: idea.prompt,
        kind: idea.kind,
        input: idea.input,
        goalId: goal.id,
      },
      `idea:${id}`,
    );
    // 照 Muse 的 IdeaCardsViewerStateJson.hasBuiltIdea
    await this.db.compareAndSwap<Idea>(owner, "ideas", id, {}, { builtAt: date() });
    await this.db.compareAndSwap(
      owner,
      "ideas",
      id,
      { status: "new" },
      { status: "accepted", taskId: task.id },
    );
    return this.db.get<Idea>(owner, "ideas", id);
  }
  async notify(owner: string, title: string, body: string, taskId?: string, key?: string) {
    const value: AgentNotification = {
      id: key ? hash(key) : randomUUID(),
      taskId,
      title,
      body,
      createdAt: date(),
      read: false,
    };
    await this.db.insertIfAbsent(owner, "notifications", value);
  }
  mailEvidence(mail: Mail): Evidence {
    return { id: mail.id, kind: "mail", title: mail.subject, excerpt: mail.body.slice(0, 400) };
  }
  async artifact(
    owner: string,
    task: AgentTask,
    kind: AgentArtifact["kind"],
    title: string,
    summary: string,
    data: Record<string, unknown>,
    key: string = kind,
  ) {
    const value: AgentArtifact = {
      id: hash(`${task.id}:${key}`),
      taskId: task.id,
      kind,
      title,
      summary,
      data,
      createdAt: date(),
    };
    await this.db.put(owner, "agent-artifacts", value);
    return value;
  }
  async prepare(
    owner: string,
    task: AgentTask,
    input: ProposalInput,
    key: string,
    context: TaskContext,
  ) {
    await context.guard();
    const connection = await this.workspace.connection(owner);
    if (connection?.id !== task.state.connectionId)
      throw new AppError("任务执行期间 Google 连接变了，请用当前账号新建任务。", 409);
    const proposal = await this.actions.propose(
      owner,
      input,
      `${task.id}:${key}`,
      task.id,
      task.threadId,
    );
    if (proposal.status === "succeeded") return proposal;
    if (proposal.status !== "awaiting_review" && proposal.status !== "executing")
      throw new AppError(
        `Reviewed action ${proposal.status}: ${proposal.error ?? "No further action was taken"}`,
        409,
      );
    try {
      await context.checkpoint({ actionId: proposal.id });
    } catch (error) {
      if (proposal.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
      throw error;
    }
    if (proposal.status === "awaiting_review")
      await context.event(
        "approval",
        proposal.title,
        `Review prepared for ${proposal.account ?? "the connected account"}`,
      );
    return proposal;
  }
  private async execute(
    owner: string,
    task: AgentTask,
    context: TaskContext,
  ): Promise<Partial<AgentTask>> {
    await context.event("status", task.attempts === 1 ? "开始工作" : "继续工作", task.prompt);
    if (task.actionId) {
      const action = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (!action) throw new Error("找不到关联的复核");
      if (action.status === "succeeded") {
        await context.event("result", "已批准的操作已完成", action.result);
        if (task.kind === "document")
          return this.finish(task, context, action.result ?? "Reply completed");
        task = await context.checkpoint({
          state: { ...task.state, approvalResult: action.result },
          actionId: null,
        });
      } else if (action.status !== "awaiting_review" && action.status !== "executing")
        throw new Error(
          `Reviewed action ${action.status}: ${action.error ?? "No further action was taken"}`,
        );
      else return { status: "waiting_approval" };
    }
    if (task.kind === "document") return this.document(owner, task, context);
    if (task.kind === "monitor") {
      try {
        return await this.observe(owner, task, context);
      } catch (error) {
        if (error instanceof LostLeaseError || context.signal.aborted) throw error;
        await context.guard();
        const failures = Number(task.state.failures ?? 0) + 1;
        // Each streak of failures (after a success or a resume) gets its own alerts.
        const failureStreak = Number(task.state.failureStreak ?? 0) + (failures === 1 ? 1 : 0);
        const detail = error instanceof Error ? error.message : "页面检查失败";
        const nextCheckAt = new Date(
          Date.now() + Math.min(60, 2 ** failures) * 60000,
        ).toISOString();
        await this.db.compareAndSwap(
          owner,
          "monitors",
          String(task.input.monitorId),
          { status: "active" },
          { error: detail, nextCheckAt },
        );
        await context.event(
          "error",
          failures >= 5 ? "Watch paused after repeated failures" : "Check failed; retry scheduled",
          detail,
        );
        return {
          status: failures >= 5 ? "paused" : "scheduled",
          error: detail,
          nextRunAt: nextCheckAt,
          state: {
            ...task.state,
            failures,
            resumingMonitor: false,
            failureStreak,
            notice: {
              title: "监控需要处理",
              body: detail,
              key: `watch-error:${task.id}:${failureStreak}:${failures >= 5 ? "paused" : "retry"}`,
            },
          },
        };
      }
    }
    if (task.kind === "finance") {
      await context.event("step", "正在分析导入的账目");
      const csv = z.string().parse(task.input.csv);
      const data = analyzeSpending(csv);
      const artifact = await this.artifact(
        owner,
        task,
        "finance",
        "Spending tracker",
        `${data.count} transactions · ${data.spending.toFixed(2)} spent`,
        data,
      );
      task = await context.checkpoint({
        artifactIds: [artifact.id],
        evidence: [
          {
            id: task.id,
            kind: "user",
            title: "你的交易 CSV",
            excerpt: `${data.count} rows; ${data.period.from} through ${data.period.to}`,
          },
        ],
      });
      return this.finish(task, context, artifact.summary);
    }
    return executeModelTask(this, owner, task, context);
  }
  async finish(task: AgentTask, context: TaskContext, result: string) {
    await context.guard();
    await context.event("result", "工作已完成", result);
    return {
      status: "succeeded" as const,
      result,
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" as const })),
    };
  }
  private async publishOutcome(owner: string, saved: AgentTask) {
    // 照 Muse 的"用完就销毁"：任务一到终态，就把它名下的短时凭据全部吊销（显式吊销，不靠过期）
    try {
      const revoked = await revokeForTask(this.db, owner, saved.id);
      if (revoked)
        console.log(`[credentials] 任务 ${saved.id.slice(0, 8)} 结束，吊销短时凭据 ${revoked} 把`);
    } catch {
      // 吊销失败不影响任务收尾；下次 sweep 或人工吊销兜底
    }
    const task = await this.getTask(owner, saved.id);
    if (task.status === "succeeded") {
      await this.notify(
        owner,
        task.title,
        task.result ?? "工作已完成",
        task.id,
        `task-done:${task.id}`,
      );
      if (task.goalId) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const goal = await this.db.get<Goal>(owner, "goals", task.goalId);
          if (!goal || goal.milestones.some((m) => m.id === task.id)) break;
          if (
            await this.db.compareAndSwap(
              owner,
              "goals",
              goal.id,
              { milestones: goal.milestones },
              {
                milestones: [...goal.milestones, { id: task.id, title: task.title, done: true }],
              },
            )
          )
            break;
        }
      }
    } else if (task.status === "failed") {
      await this.notify(
        owner,
        "任务需要处理",
        task.error ?? task.title,
        task.id,
        `task-error:${task.id}:${task.attempts}`,
      );
    } else if (task.status === "waiting_input") {
      await this.notify(
        owner,
        "Your details are needed",
        task.question ?? task.title,
        task.id,
        `input:${task.id}:${hash(task.question ?? "")}`,
      );
    } else if (task.status === "waiting_approval") {
      await this.notify(
        owner,
        "Ready for your review",
        task.title,
        task.id,
        `review:${task.actionId}`,
      );
    }
    const notice = z
      .object({ title: z.string(), body: z.string(), key: z.string() })
      .safeParse(task.state.notice);
    if ((task.status === "scheduled" || (task.status === "paused" && task.error)) && notice.success)
      await this.notify(owner, notice.data.title, notice.data.body, task.id, notice.data.key);
    // A watch pauses after repeated failures only once that task outcome has committed.
    if (task.kind === "monitor" && task.status === "paused" && task.error)
      await this.db.compareAndSwap(
        owner,
        "monitors",
        String(task.input.monitorId),
        { status: "active", error: task.error },
        { status: "paused" },
      );
  }
  private async document(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    let source = task.state.source as { mail: Mail; fileId: string } | undefined;
    if (!source) {
      const w = await this.workspace.snapshot(owner);
      const mail = w.mail.find((m) => m.id === task.input.messageId);
      if (!mail) throw new Error("请选择一封带 PDF 附件的当前邮件来启动这个任务");
      const ref = mail.attachments[0];
      if (!ref) throw new Error("这封邮件没有 PDF 附件");
      await ctx.guard();
      let file: Artifact;
      try {
        file = await this.files.get(owner, ref);
      } catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
        file = await this.workspace.importAttachment(owner, ref);
      }
      source = { mail, fileId: file.id };
      task = await ctx.checkpoint({
        state: { ...task.state, source },
        evidence: [this.mailEvidence(mail)],
        plan: task.plan.map((s, i) => ({ ...s, status: i === 0 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "找到了文档", file.name);
    }
    const fields = z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .optional()
      .parse(task.input.fields);
    if (!fields || !Object.keys(fields).length) {
      const file = await this.files.get(owner, source.fileId);
      const names = file.fields
        ?.filter((f) => f.type !== "unsupported")
        .map((f) => f.name)
        .join(", ");
      if (!names)
        throw new Error(
          "This PDF has no supported fillable fields. Open it in Files to review it.",
        );
      return {
        status: "waiting_input",
        question: `Enter the form values you want to use. Supported fields: ${names}. The original PDF will stay intact.`,
        state: {
          ...task.state,
          source,
          missingFields: file.fields?.filter((f) => f.type !== "unsupported"),
        },
      };
    }
    let filledId = typeof task.state.filledId === "string" ? task.state.filledId : undefined;
    if (!filledId) {
      await ctx.guard();
      const filled = await this.files.fill(owner, source.fileId, fields);
      filledId = filled.id;
      task = await ctx.checkpoint({
        state: { ...task.state, source, filledId },
        artifactIds: [filledId],
        plan: task.plan.map((s, i) => ({ ...s, status: i <= 1 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "已保存填写好的副本", filled.name);
    }
    const input: ProposalInput = {
      kind: "email.send",
      data: {
        to: [source.mail.from],
        cc: [],
        bcc: [],
        subject: /^re:/i.test(source.mail.subject)
          ? source.mail.subject
          : `Re: ${source.mail.subject}`,
        body:
          typeof task.input.reply === "string"
            ? task.input.reply
            : "Hello,\n\nPlease find the completed form attached.\n\nThank you.",
        attachmentIds: [filledId],
        threadId: source.mail.threadId,
        replyToMessageId: source.mail.id,
      },
    };
    const proposal = await this.prepare(owner, task, input, "document-reply", ctx);
    return {
      status: "waiting_approval",
      actionId: proposal.id,
      plan: task.plan.map((s, i) => ({
        ...s,
        status: i < 3 ? "succeeded" : i === 3 ? "waiting" : "pending",
      })),
    };
  }
  private async observe(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    const monitor = await this.db.get<Monitor>(owner, "monitors", String(task.input.monitorId));
    if (!monitor) throw new Error("找不到这个监控");
    if (monitor.status !== "active")
      return { status: monitor.status === "paused" ? "paused" : "cancelled" };
    let observation: { url: string; title: string; text: string; sessionId?: string };
    if (monitor.url === "sample://availability") {
      if (this.config.mode !== "sample") throw new Error("示例来源不可用");
      const page = await this.db.get<{ text: string }>(owner, "sample-pages", "availability");
      observation = {
        url: monitor.url,
        title: "Sample dinner availability",
        text: page?.text ?? "No tables available. Check again later.",
      };
    } else {
      await ctx.guard();
      observation = await this.browser.observe(
        owner,
        monitor.url,
        typeof task.state.sessionId === "string" ? task.state.sessionId : undefined,
      );
    }
    const text = observation.text.replace(/\s+/g, " ").trim();
    const currentHash = hash(text);
    const previousHash =
      typeof task.state.lastHash === "string" ? task.state.lastHash : monitor.lastHash;
    const matched =
      monitor.condition === "change"
        ? Boolean(previousHash && previousHash !== currentHash)
        : monitor.condition === "contains"
          ? text.toLowerCase().includes(monitor.value.toLowerCase())
          : this.matchesPrice(text, Number(monitor.value));
    const previouslyMatched = Boolean(task.state.matched);
    const shouldNotify = matched && (monitor.condition === "change" || !previouslyMatched);
    const nextCheckAt = new Date(Date.now() + monitor.intervalMinutes * 60000).toISOString();
    await ctx.guard();
    // Worker lease is checked before each publication; monitor control also invalidates that lease.
    const savedMonitor = await this.db.compareAndSwap(
      owner,
      "monitors",
      monitor.id,
      { status: "active" },
      {
        checks: monitor.checks + 1,
        lastCheckedAt: date(),
        lastHash: currentHash,
        lastValue: text.slice(0, 1000),
        nextCheckAt,
        error: null,
      },
    );
    if (!savedMonitor) throw new LostLeaseError();
    await ctx.event(
      "observation",
      previousHash ? "Checked for changes" : "Saved the first observation",
      text.slice(0, 1000),
    );
    if (shouldNotify) {
      await ctx.guard();
      await ctx.event("result", "发现了一处有意义的变化", text.slice(0, 500));
    }
    return {
      status: "scheduled",
      nextRunAt: nextCheckAt,
      result: shouldNotify
        ? "Change found. A notification is ready."
        : "Watching. I'll check again on schedule.",
      state: {
        ...task.state,
        sessionId: observation.sessionId,
        lastHash: currentHash,
        resumingMonitor: false,
        matched,
        failures: 0,
        notice: shouldNotify
          ? {
              title: monitor.title,
              body: `Condition met at ${observation.url}: ${text.slice(0, 240)}`,
              key: `monitor:${monitor.id}:${currentHash}`,
            }
          : null,
      },
      error: null,
      evidence: [
        {
          id: monitor.id,
          kind: "web",
          title: observation.title,
          url: observation.url,
          excerpt: text.slice(0, 600),
        },
      ],
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" })),
    };
  }
  private matchesPrice(text: string, threshold: number) {
    const matches = [...text.matchAll(/(?:\$|USD\s*)(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g)];
    return matches.some((m) => Number(m[1].replace(/,/g, "")) < threshold);
  }
}
