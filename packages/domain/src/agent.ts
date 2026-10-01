import { z } from "zod";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "scheduled"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface Evidence {
  id: string;
  kind: "mail" | "file" | "web" | "user";
  title: string;
  excerpt: string;
  url?: string;
}
export interface TaskStep {
  id: string;
  title: string;
  status: "pending" | "running" | "succeeded" | "failed" | "waiting";
  detail?: string;
}
export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  kind: "agent" | "document" | "monitor" | "finance" | "plan";
  status: TaskStatus;
  goalId?: string;
  threadId?: string;
  plan: TaskStep[];
  evidence: Evidence[];
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  leaseId?: string | null;
  leaseUntil?: string | null;
  attempts: number;
  actionId?: string | null;
  result?: string;
  error?: string | null;
  question?: string;
  artifactIds: string[];
  /** 快照里附带：任务最近完成的一步（列表行显示"它刚做了什么"，照 Muse 的列表）。 */
  lastStep?: { kind: string; title: string; detail?: string; date: string };
}
export interface RunEvent {
  id: string;
  taskId: string;
  date: string;
  kind: "plan" | "step" | "observation" | "approval" | "result" | "error" | "status";
  title: string;
  detail: string;
}
export interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "active" | "paused" | "completed";
  milestones: { id: string; title: string; done: boolean }[];
  createdAt: string;
}
export interface Monitor {
  id: string;
  taskId: string;
  title: string;
  url: string;
  condition: "change" | "contains" | "price_below";
  value: string;
  intervalMinutes: number;
  status: "active" | "paused" | "stopped";
  nextCheckAt: string;
  lastCheckedAt?: string;
  lastValue?: string;
  lastHash?: string;
  error?: string;
  checks: number;
}
/**
 * 照 Muse 的 `explore/repo/IdeaCardItem`：一条灵感可以拆成**多个可勾选的小条目**，
 * 执行时按 itemIds 传（而不是整卡一把梭）。字段名对齐 Muse：selectable / isSelected。
 */
export interface IdeaItem {
  id: string;
  kind: string;
  title: string;
  summary?: string;
  /** 这一条做出来会得到什么（Muse 的 buildSummary） */
  buildSummary?: string;
  selectable: boolean;
  selected?: boolean;
}
export interface Idea {
  id: string;
  title: string;
  reason: string;
  evidence: Evidence[];
  prompt: string;
  kind: AgentTask["kind"];
  input: Record<string, unknown>;
  status: "new" | "dismissed" | "accepted";
  taskId?: string;
  createdAt: string;
  /**
   * 用户对这条灵感的反馈（照 Muse 的 IdeaFeedback{UP, DOWN}）。
   * 用途不只是显示：`refreshIdeas` 会据此让后续推荐避开被踩过的方向。
   */
  feedback?: "up" | "down";
  /** 照 Muse 的 IdeaCardItem：拆出来的可勾选条目 */
  items?: IdeaItem[];
  /** 照 Muse 的 badges/labels：卡片上的角标（数据驱动，客户端只负责画） */
  badges?: string[];
  /** 照 Muse 的 buildSummary：这条灵感"造出来"会得到什么 */
  buildSummary?: string;
  /** 照 Muse 的 SeededIdeaDetail：预置/种子灵感（没有任何来源时也能给出可执行的事） */
  seeded?: boolean;
  /** 照 Muse 的 IdeaCardsViewerStateJson.hasBuiltIdea：已经做过至少一次 */
  builtAt?: string;
  /** 照 Muse 的 IdeaCardExecuteRequestJson.mode：执行方式（默认按勾选的条目走） */
  mode?: string;
}
export interface AgentMemory {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}
export interface AgentArtifact {
  id: string;
  taskId: string;
  kind: "plan" | "comparison" | "finance" | "report";
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}
export interface AgentNotification {
  id: string;
  taskId?: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
export interface AgentIdentity {
  name: string;
  tone: "warm" | "concise" | "thoughtful";
  avatar?: "sky" | "sand" | "lilac";
  showChatUpdates?: boolean;
}
export interface AgentWorkspace {
  tasks: AgentTask[];
  goals: Goal[];
  monitors: Monitor[];
  ideas: Idea[];
  memories: AgentMemory[];
  artifacts: AgentArtifact[];
  notifications: AgentNotification[];
  identity: AgentIdentity;
  worker: { running: boolean; lastTickAt?: string };
  /** 各会话此刻在干什么（App 显示实时状态，按会话匹配）；太久没更新则为空。 */
  live?: {
    id: string;
    tool: string;
    text: string;
    detail: string;
    threadId?: string;
    at: string;
  }[];
}
export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().min(1).max(12000),
  kind: z.enum(["agent", "document", "monitor", "finance", "plan"]).default("agent"),
  goalId: z.string().optional(),
  /** 提出这件事的会话：让结果/审批回到它开始的地方 */
  threadId: z.string().trim().max(200).optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export const monitorInputSchema = z
  .object({
    title: z.string().min(1).max(160),
    url: z.url().max(4096),
    condition: z.enum(["change", "contains", "price_below"]).default("change"),
    value: z.string().max(300).default(""),
    intervalMinutes: z.number().int().min(1).max(10080).default(15),
  })
  .superRefine((v, c) => {
    if (v.condition !== "change" && !v.value.trim())
      c.addIssue({ code: "custom", message: "请填写监控条件值" });
    if (
      v.condition === "price_below" &&
      (!Number.isFinite(Number(v.value)) || Number(v.value) <= 0)
    )
      c.addIssue({ code: "custom", message: "请填写一个正数价格" });
  });
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(""),
  category: z.string().max(80).default("Personal"),
  milestones: z.array(z.string().min(1).max(200)).max(20).default([]),
});
