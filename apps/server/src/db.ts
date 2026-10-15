import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { AppError } from "./errors.ts";
import {
  type ApprovalRecord,
  APPROVAL_DEFAULT_LIMIT,
  APPROVAL_MAX_LIMIT,
  type ApprovalQuery,
  type GrantRecord,
  normalizeApproval,
  normalizeGrant,
} from "./engine/approvals.ts";
import type { AuditEvent } from "./engine/tool-executor.ts";
import { backgroundFailure } from "./log.ts";

type Row = { data: Record<string, unknown> };
interface Database {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  close: () => Promise<void>;
}

/** 判断是不是"行数据损坏"（PGlite/Postgres 的 TOAST 缺块），只有这种才降级，别的错照旧抛 */
export function isCorruptRow(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /missing chunk number \d+ for toast value|unexpected chunk number|invalid page in block/i.test(
    message,
  );
}

/**
 * 单行损坏会让**整条** SELECT 失败（TOAST 在扫描时才读），于是"一行坏数据 ⇒ 整个界面 502"。
 * 这里退化成按 ctid 逐行读：坏的跳过并记日志，其余照常返回。
 * 只在快路径抛错后才走这条，正常情况零额外开销。
 */
export async function recoverRows<T>(
  label: string,
  cause: unknown,
  listCtid: () => Promise<string[]>,
  readCtid: (ctid: string) => Promise<T>,
): Promise<T[]> {
  if (!isCorruptRow(cause)) throw cause;
  console.error(`[db] ${label} 命中损坏行，改为逐行读取：${String((cause as Error).message)}`);
  const ctids = await listCtid();
  const rows: T[] = [];
  let skipped = 0;
  for (const ctid of ctids) {
    try {
      const row = await readCtid(ctid);
      if (row !== undefined && row !== null) rows.push(row);
    } catch (error) {
      if (!isCorruptRow(error)) throw error;
      skipped += 1;
      console.error(`[db] 跳过损坏行 ${label} ctid=${ctid}：${String((error as Error).message)}`);
    }
  }
  if (skipped)
    console.error(`[db] ${label} 共跳过 ${skipped} 行损坏数据（其余 ${rows.length} 行正常返回）`);
  return rows;
}
/** 审计查询的过滤条件：`threadId` 不给就是该 owner 的全部会话；`limit` 有上限，别让人拉爆内存。 */
export interface AuditQuery {
  threadId?: string;
  limit?: number;
}

export const AUDIT_DEFAULT_LIMIT = 100;
export const AUDIT_MAX_LIMIT = 500;

/** 把库里读回来的审计行补齐成「未发生的字段一律 null」的形状，查询方不用到处判空。 */
export function normalizeAudit(row: Partial<AuditEvent> & { id: string }): AuditEvent {
  return {
    id: row.id,
    at: typeof row.at === "string" ? row.at : "",
    tool: typeof row.tool === "string" ? row.tool : "",
    owner: typeof row.owner === "string" ? row.owner : "",
    threadId: typeof row.threadId === "string" ? row.threadId : null,
    risk: row.risk ?? "safe",
    outcome: row.outcome ?? "ok",
    decision: row.decision ?? "ok",
    target: typeof row.target === "string" ? row.target : null,
    egress: row.egress ?? "none",
    egressTarget: typeof row.egressTarget === "string" ? row.egressTarget : null,
    summary: typeof row.summary === "string" ? row.summary : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : 0,
    args: row.args ?? null,
    result: row.result ?? null,
  };
}

export class Store {
  constructor(private readonly db: Database) {}
  async get<T = Record<string, unknown>>(
    owner: string,
    kind: string,
    id: string,
  ): Promise<T | null> {
    try {
      const result = await this.db.query(
        "SELECT data FROM records WHERE owner=$1 AND kind=$2 AND id=$3",
        [owner, kind, id],
      );
      return (result.rows[0]?.data as T | undefined) ?? null;
    } catch (error) {
      if (!isCorruptRow(error)) throw error;
      // 这一行本身坏了（TOAST 缺块）：如实告诉用户是数据问题，而不是"检查服务端配置"
      console.error(
        `[db] 记录已损坏 kind=${kind} id=${id.slice(0, 12)}：${String((error as Error).message)}`,
      );
      throw new AppError("这条记录在数据库里已损坏，无法读取；可以把它删掉重来。", 422);
    }
  }
  async list<T = Record<string, unknown>>(owner: string, kind: string): Promise<T[]> {
    try {
      const result = await this.db.query(
        "SELECT data FROM records WHERE owner=$1 AND kind=$2 ORDER BY updated_at DESC,id",
        [owner, kind],
      );
      return result.rows.map((row) => row.data as T);
    } catch (error) {
      return recoverRows<T>(
        "list",
        error,
        async () => {
          const ids = await this.db.query(
            "SELECT ctid::text AS ctid FROM records WHERE owner=$1 AND kind=$2 ORDER BY updated_at DESC,id",
            [owner, kind],
          );
          return (ids.rows as unknown as { ctid: string }[]).map((row) => String(row.ctid));
        },
        async (ctid) => {
          const row = await this.db.query("SELECT data FROM records WHERE ctid=$1", [ctid]);
          return row.rows[0]?.data as T;
        },
      );
    }
  }
  async put<T extends { id: string }>(owner: string, kind: string, value: T): Promise<T> {
    await this.db.query(
      "INSERT INTO records(owner,kind,id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data,updated_at=now()",
      [owner, kind, value.id, JSON.stringify(value)],
    );
    return value;
  }
  /**
   * 写一条审计（单子 §1.1）。就是普通 `records` 一行：`kind='audit'`，owner 取调用上下文，
   * 缺失时咽喉已经填了 `local-user`。
   *
   * 与 `put` 同一个 INSERT 形状，**不额外加重试/事务** —— 咽喉那边是 fire-and-forget 的，
   * 这里失败只会被咽喉记一行日志，不影响工具行为。
   */
  async putAudit(event: AuditEvent): Promise<AuditEvent> {
    return this.put(event.owner, "audit", event);
  }
  /**
   * 查审计（单子 §1.4）：按 owner 取，可按 threadId 过滤，按 limit 限量，**最近的在前**。
   * 只读：不加锁、不写任何东西。行坏了走 `recoverRows` 跳过，跟 `list` 同一套降级。
   */
  async listAudit(owner: string, options: AuditQuery = {}): Promise<AuditEvent[]> {
    const threadId = options.threadId?.trim() || null;
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? AUDIT_DEFAULT_LIMIT), 1),
      AUDIT_MAX_LIMIT,
    );
    const filter = "owner=$1 AND kind='audit' AND ($2::text IS NULL OR data->>'threadId'=$2)";
    try {
      const result = await this.db.query(
        `SELECT data FROM records WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT $3`,
        [owner, threadId, limit],
      );
      return result.rows.map((row) => normalizeAudit(row.data as { id: string }));
    } catch (error) {
      return recoverRows<AuditEvent>(
        "listAudit",
        error,
        async () => {
          const ids = await this.db.query(
            `SELECT ctid::text AS ctid FROM records WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT $3`,
            [owner, threadId, limit],
          );
          return (ids.rows as unknown as { ctid: string }[]).map((row) => String(row.ctid));
        },
        async (ctid) => {
          const row = await this.db.query(
            "SELECT data FROM records WHERE ctid=$1",
            [ctid],
          );
          return normalizeAudit(row.rows[0]?.data as { id: string });
        },
      );
    }
  }
  // -------------------------------------------------------------------------
  // 授权 / 审批（P1b）。同样就是 `records` 表：授权是 `kind='grants'`、审批是 `kind='approvals'`，
  // 都按 owner 分区 —— 谁的东西只有谁能查、谁能批（REST 层另有 owner 一致性校验）。
  // -------------------------------------------------------------------------

  /** 写一条授权（批准时产出）。 */
  async putGrant(grant: GrantRecord): Promise<GrantRecord> {
    return this.put(grant.owner, "grants", grant);
  }

  /**
   * 候选授权：某工具在某 owner 名下的全部授权，**最近的在前**（后批的优先，语义上更接近用户当下的意思）。
   * 只做 tool 过滤，有效性判定交给 `grantApplies`（纯函数、可注入时钟）——
   * SQL 里塞一堆 jsonb 条件既难读又难测。
   */
  async listGrants(owner: string, tool: string, limit = 50): Promise<GrantRecord[]> {
    const filter = "owner=$1 AND kind='grants' AND data->>'tool'=$2";
    const bound = Math.min(Math.max(Math.trunc(limit), 1), 200);
    try {
      const result = await this.db.query(
        `SELECT data FROM records WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT $3`,
        [owner, tool, bound],
      );
      return result.rows.map((row) => normalizeGrant(row.data as { id: string }));
    } catch (error) {
      return recoverRows<GrantRecord>(
        "listGrants",
        error,
        async () => {
          const ids = await this.db.query(
            `SELECT ctid::text AS ctid FROM records WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT $3`,
            [owner, tool, bound],
          );
          return (ids.rows as unknown as { ctid: string }[]).map((row) => String(row.ctid));
        },
        async (ctid) => {
          const row = await this.db.query("SELECT data FROM records WHERE ctid=$1", [ctid]);
          return normalizeGrant(row.rows[0]?.data as { id: string });
        },
      );
    }
  }

  /**
   * 消耗一条 `once` 授权（单子 §1：并发下不能放行两次）。
   *
   * 用的是**条件 UPDATE**（`data @> '{"consumedAt": null}'`），不是 read-then-write：
   * 两个并发调用只有一个能把 `consumedAt` 从 null 改成时刻，另一个拿到 null（= 没抢到）。
   * 授权行必须显式写 `consumedAt: null` —— 字段缺席与「已被消耗」在这个判定里不是一回事。
   */
  async consumeGrant(owner: string, id: string, consumedAt: string): Promise<GrantRecord | null> {
    return this.compareAndSwap<GrantRecord>(
      owner,
      "grants",
      id,
      { consumedAt: null },
      { consumedAt },
    );
  }

  /** 登记一条待审批（咽喉登记，或测试直接造）。 */
  async putApproval(approval: ApprovalRecord): Promise<ApprovalRecord> {
    return this.put(approval.owner, "approvals", approval);
  }

  /** 取一条审批。取不到（含**别人的**审批 id）一律 null —— REST 据此回 404，不泄露存不存在。 */
  async getApproval(owner: string, id: string): Promise<ApprovalRecord | null> {
    const row = await this.get<Partial<ApprovalRecord> & { id: string }>(owner, "approvals", id);
    return row ? normalizeApproval(row) : null;
  }

  /**
   * 审批列表：按 owner 取，`pending` 只看待决的，`all` 全要，**最近的在前**。
   * 只读：不加锁、不写任何东西。坏行走 `recoverRows` 跳过，与 `listAudit` 同一套降级。
   */
  async listApprovals(owner: string, options: ApprovalQuery = {}): Promise<ApprovalRecord[]> {
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? APPROVAL_DEFAULT_LIMIT), 1),
      APPROVAL_MAX_LIMIT,
    );
    const status = options.status === "all" ? null : "pending";
    const filter = "owner=$1 AND kind='approvals' AND ($2::text IS NULL OR data->>'status'=$2)";
    try {
      const result = await this.db.query(
        `SELECT data FROM records WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT $3`,
        [owner, status, limit],
      );
      return result.rows.map((row) => normalizeApproval(row.data as { id: string }));
    } catch (error) {
      return recoverRows<ApprovalRecord>(
        "listApprovals",
        error,
        async () => {
          const ids = await this.db.query(
            `SELECT ctid::text AS ctid FROM records WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT $3`,
            [owner, status, limit],
          );
          return (ids.rows as unknown as { ctid: string }[]).map((row) => String(row.ctid));
        },
        async (ctid) => {
          const row = await this.db.query("SELECT data FROM records WHERE ctid=$1", [ctid]);
          return normalizeApproval(row.rows[0]?.data as { id: string });
        },
      );
    }
  }

  async remove(owner: string, kind: string, id: string): Promise<void> {
    await this.db.query("DELETE FROM records WHERE owner=$1 AND kind=$2 AND id=$3", [
      owner,
      kind,
      id,
    ]);
  }
  async compareAndSwap<T>(
    owner: string,
    kind: string,
    id: string,
    expected: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<T | null> {
    const result = await this.db.query(
      "UPDATE records SET data=data || $5::jsonb,updated_at=now() WHERE owner=$1 AND kind=$2 AND id=$3 AND data @> $4::jsonb RETURNING data",
      [owner, kind, id, JSON.stringify(expected), JSON.stringify(patch)],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  async insertIfAbsent<T extends { id: string }>(
    owner: string,
    kind: string,
    value: T,
  ): Promise<T | null> {
    const result = await this.db.query(
      "INSERT INTO records(owner,kind,id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING data",
      [owner, kind, value.id, JSON.stringify(value)],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  async scan<T>(kind: string): Promise<{ owner: string; value: T }[]> {
    try {
      const result = await this.db.query(
        "SELECT jsonb_build_object('owner',owner,'value',data) AS data FROM records WHERE kind=$1 ORDER BY updated_at ASC",
        [kind],
      );
      return result.rows.map((row) => row.data as { owner: string; value: T });
    } catch (error) {
      return recoverRows<{ owner: string; value: T }>(
        "scan",
        error,
        async () => {
          const ids = await this.db.query(
            "SELECT ctid::text AS ctid FROM records WHERE kind=$1 ORDER BY updated_at ASC",
            [kind],
          );
          return (ids.rows as unknown as { ctid: string }[]).map((row) => String(row.ctid));
        },
        async (ctid) => {
          const row = await this.db.query(
            "SELECT jsonb_build_object('owner',owner,'value',data) AS data FROM records WHERE ctid=$1",
            [ctid],
          );
          return row.rows[0]?.data as { owner: string; value: T };
        },
      );
    }
  }
  async claim<T>(owner: string, id: string, status: string, now: string): Promise<T | null> {
    const result = await this.db.query(
      `UPDATE records AS action SET data=jsonb_set(data,'{status}',$4::jsonb),updated_at=now()
       WHERE owner=$1 AND kind='actions' AND id=$2 AND data->>'status'='awaiting_review'
       AND (data->>'expiresAt')::timestamptz>$3::timestamptz
       AND ($4::jsonb <> '"executing"'::jsonb OR data->>'taskId' IS NULL OR EXISTS (
         SELECT 1 FROM records task WHERE task.owner=action.owner AND task.kind='tasks'
         AND task.id=action.data->>'taskId' AND task.data->>'status' IN ('running','waiting_approval')
       )) RETURNING data`,
      [owner, id, now, JSON.stringify(status)],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  async recoverInterruptedActions(): Promise<void> {
    await this.db.query(
      `UPDATE records SET data=data || '{"status":"outcome_unknown","error":"Server restarted during execution. Check the provider before creating another action."}'::jsonb WHERE kind='actions' AND data->>'status'='executing'`,
    );
  }
  async take<T>(owner: string, kind: string, id: string): Promise<T | null> {
    const result = await this.db.query(
      "DELETE FROM records WHERE owner=$1 AND kind=$2 AND id=$3 RETURNING data",
      [owner, kind, id],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  close(): Promise<void> {
    return this.db.close();
  }
  async updateCredential(owner: string, connectionId: string, secret: string): Promise<boolean> {
    const result = await this.db.query(
      "UPDATE records SET data=jsonb_set(data,'{secret}',$3::jsonb),updated_at=now() WHERE owner=$1 AND kind='credentials' AND id='google' AND data->>'connectionId'=$2 RETURNING data",
      [owner, connectionId, JSON.stringify(secret)],
    );
    return result.rows.length === 1;
  }
}

/** Idle clients can be disconnected by a database restart; without a listener pg's `error` event crashes the process. */
export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on("error", (error) => backgroundFailure("postgres pool", error));
  return pool;
}

export async function createStore(
  options: { dataDir?: string; databaseUrl?: string } = {},
): Promise<Store> {
  let database: Database;
  if (options.databaseUrl) {
    const pool = createPool(options.databaseUrl);
    database = { query: async (sql, params) => pool.query(sql, params), close: () => pool.end() };
  } else {
    if (options.dataDir) await mkdir(dirname(options.dataDir), { recursive: true, mode: 0o700 });
    const embedded = new PGlite(options.dataDir);
    await embedded.waitReady;
    database = {
      query: (sql, params) => embedded.query<Row>(sql, params),
      close: () => embedded.close(),
    };
  }
  await database.query(
    "CREATE TABLE IF NOT EXISTS records(owner text NOT NULL,kind text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner,kind,id))",
  );
  return new Store(database);
}
