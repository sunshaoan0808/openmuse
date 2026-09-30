import * as FileSystem from "expo-file-system/legacy";
import type { QueuedMessage, QueueStorage } from "./conversation-queue";

/**
 * 防杀进程的本地状态：
 *  - outbox：还没被服务端确认的待发消息（收到 ACK 才清）
 *  - cursors：每条会话我看到哪了（seq 游标），重开时按它增量拉取、把断线期间的回复补上
 * 存的都是本机小文件，格式与 api.ts 的服务器地址存储一致。
 */
const OUTBOX = `${FileSystem.documentDirectory ?? ""}openmuse-outbox.json`;
const CURSORS = `${FileSystem.documentDirectory ?? ""}openmuse-cursors.json`;

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return fallback;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown) {
  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
  } catch {
    // 写不进去只影响下次启动的恢复，不能影响这次发送
  }
}

export const outboxStorage: QueueStorage = {
  load: async () => {
    const stored = await readJson<QueuedMessage[]>(OUTBOX, []);
    return Array.isArray(stored) ? stored.filter((message) => message?.id && message?.text) : [];
  },
  save: (messages) => writeJson(OUTBOX, messages),
};

export async function loadCursor(threadId: string): Promise<number | undefined> {
  const cursors = await readJson<Record<string, number>>(CURSORS, {});
  const value = cursors?.[threadId];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function saveCursor(threadId: string, seq: number): Promise<void> {
  const cursors = await readJson<Record<string, number>>(CURSORS, {});
  cursors[threadId] = seq;
  await writeJson(CURSORS, cursors);
}
