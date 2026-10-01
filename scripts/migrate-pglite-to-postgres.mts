/**
 * PGlite → 真 Postgres 的一次性迁移（可重复执行）。
 *
 * 背景：PGlite 是 WASM Postgres，长驻服务 + 频繁重启在写入途中被打断时会留下
 * 撕裂的 TOAST / 坏索引 / 重复主键（本仓库真实踩过三次）。迁移到真 Postgres 后不再有这类问题。
 *
 * 用法：
 *   1) 停机：      sudo systemctl stop openmuse
 *   2) 跑本脚本：  npx tsx scripts/migrate-pglite-to-postgres.mts
 *   3) 起服务：    sudo systemctl start openmuse
 *      （`.env` 里的 DATABASE_URL 必须已是 postgres://…；脚本只负责搬数据）
 *
 * 特性：
 *   - 按 ctid **逐行**读源库：单行损坏只跳过并记账，不会让整次迁移失败
 *   - 保留原始 updated_at（界面列表按它排序，重置会打乱顺序）
 *   - upsert 写入 ⇒ 可以中断后重跑
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

interface Row {
  owner: string;
  kind: string;
  id: string;
  data: unknown;
  updated_at: unknown;
}

const ROOT = resolve(import.meta.dirname, "..");
const envFile = process.env.ENV_FILE ?? resolve(ROOT, ".env");
const dataDir = process.env.PGLITE_DIR ?? resolve(ROOT, ".openmuse/postgres");

const env = readFileSync(envFile, "utf8");
const databaseUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
if (!databaseUrl?.startsWith("postgres")) {
  throw new Error(`目标不是 Postgres（${envFile} 里的 DATABASE_URL）：迁移需要一个 postgres:// 连接串`);
}

const source = new PGlite(dataDir);
const target = new pg.Pool({ connectionString: databaseUrl, max: 3 });
await target.query(
  "CREATE TABLE IF NOT EXISTS records(owner text NOT NULL,kind text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner,kind,id))",
);

const countRow = await source.query<{ n: number }>("select count(*)::int as n from records");
const total = countRow.rows[0]?.n ?? 0;
const idRows = await source.query<{ ctid: string }>("select ctid::text as ctid from records");
console.log(`源库 ${total} 行，按 ctid 逐行读（损坏行会跳过）`);

let moved = 0;
let skipped = 0;
const byKind = new Map<string, number>();
for (const { ctid } of idRows.rows) {
  let row: Row;
  try {
    const result = await source.query<Row>(
      "select owner, kind, id, data, updated_at from records where ctid = $1",
      [ctid],
    );
    const found = result.rows[0];
    if (!found) throw new Error("row disappeared");
    row = found;
  } catch (error) {
    skipped += 1;
    console.error(`  跳过损坏行 ctid=${ctid}：${String((error as Error).message).slice(0, 70)}`);
    continue;
  }
  await target.query(
    "INSERT INTO records(owner,kind,id,data,updated_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
    [row.owner, row.kind, row.id, JSON.stringify(row.data), row.updated_at],
  );
  moved += 1;
  byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
}

const destRow = await target.query<{ n: number }>("select count(*)::int as n from records");
console.log(
  `迁移完成：搬过去 ${moved} 行，跳过 ${skipped} 行，目标库现在 ${destRow.rows[0]?.n ?? 0} 行`,
);
console.log(
  "按类型（前 8）:",
  [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(" "),
);

// 抽样校验：目标与源逐字段一致
const sample = await target.query<Row>(
  "select owner,kind,id,data from records order by updated_at desc limit 3",
);
for (const row of sample.rows) {
  const same = await source.query<{ data: unknown }>(
    "select data from records where owner=$1 and kind=$2 and id=$3",
    [row.owner, row.kind, row.id],
  );
  const equal = JSON.stringify(same.rows[0]?.data) === JSON.stringify(row.data);
  console.log(`  抽样 ${row.kind}/${String(row.id).slice(0, 12)} 与源库一致: ${equal}`);
}

await target.end();
await source.close();
