import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { AppError } from "./errors.ts";
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
