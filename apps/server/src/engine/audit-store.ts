/**
 * 把咽喉的审计出口接到 Postgres（单子 §1.1/§1.2）。
 *
 * 单独一个文件是刻意的：`tool-executor.ts` 只依赖结构类型、不 import `db.ts`
 * （免得与接线处形成运行时环），所以「Store 怎么存」的知识留在这里，由启动处组装。
 *
 * **降级是硬要求**：`createStore` 起不来、或接线抛错，服务照常起，
 * 只是审计退回「只有控制台那一行」—— 那行本来就有（`tool-executor.ts` 里一字未改）。
 */
import type { Store } from "../db.ts";
import {
  type AuditEvent,
  type AuditSink,
  flushAuditSink,
  setAuditSink,
} from "./tool-executor.ts";

/**
 * 造一个落库 sink。返回的 sink 自己吞掉所有失败：
 * 写库抛错只留一行 `[audit-persist]` 日志，绝不改工具的返回值/抛错/耗时（咽喉的硬契约）。
 */
export function storeAuditSink(store: Pick<Store, "putAudit">): AuditSink {
  return async (event: AuditEvent) => {
    await store.putAudit(event);
  };
}

/**
 * 接线：把 Store 装到咽喉上。
 * 失败时**吞掉错误并返回 false**，调用方据此打一行日志即可 —— 不让审计可用性决定服务起不起来。
 */
export function attachAuditStore(store: Pick<Store, "putAudit">): boolean {
  try {
    setAuditSink(storeAuditSink(store));
    return true;
  } catch (error) {
    setAuditSink(null);
    console.error(
      `[audit-persist] 审计落库未启用，退回仅控制台输出：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export { flushAuditSink };
