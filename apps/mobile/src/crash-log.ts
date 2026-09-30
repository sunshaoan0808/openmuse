import * as FileSystem from "expo-file-system/legacy";

/**
 * 崩溃可见化：release 包里一个未捕获的 JS 异常就是"无提示闪退"，
 * 用户只看到 app 消失、我们拿不到任何线索。这里把全局错误处理接上：
 *   1. 写入 openmuse-crash.log（供下次启动展示 / 用户截图）
 *   2. 不再让进程直接消失（保留现场，用户能截到栈）
 *   3. 通过订阅把错误抛给界面，用横幅显示
 */
const LOG = `${FileSystem.documentDirectory ?? ""}openmuse-crash.log`;
const MAX = 4000;

let last: string | null = null;
const listeners = new Set<(text: string | null) => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener(last);
    } catch {
      // 监听者自己出问题不能再影响上报
    }
  }
}

function describe(error: unknown, extra?: string): string {
  const when = new Date().toISOString();
  if (error instanceof Error) {
    return `[${when}]${extra ? ` ${extra}` : ""} ${error.message}\n${error.stack ?? ""}`.slice(
      0,
      MAX,
    );
  }
  return `[${when}]${extra ? ` ${extra}` : ""} ${String(error)}`.slice(0, MAX);
}

/** 记录一次错误（点击处理器、网络回调等自己 catch 到的地方也调这个）。 */
export function recordCrash(error: unknown, extra?: string) {
  const text = describe(error, extra);
  last = text;
  notify();
  void FileSystem.writeAsStringAsync(LOG, text).catch(() => {});
}

export function subscribeCrash(listener: (text: string | null) => void) {
  listeners.add(listener);
  listener(last);
  return () => listeners.delete(listener);
}

export async function readCrashLog(): Promise<string | null> {
  if (last) return last;
  try {
    const text = await FileSystem.readAsStringAsync(LOG);
    return text || null;
  } catch {
    return null;
  }
}

export async function clearCrashLog() {
  last = null;
  notify();
  try {
    await FileSystem.deleteAsync(LOG, { idempotent: true });
  } catch {
    // 删不掉也不影响使用
  }
}

/**
 * 接住全局未捕获异常。返回 true 表示这次装上了。
 */
export function installCrashHandler(): boolean {
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  const utils = g.ErrorUtils;
  if (utils?.setGlobalHandler) {
    utils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      recordCrash(error, isFatal ? "(致命)" : "(非致命)");
      // 有意不再向上抛：保留现场比直接消失有价值
    });
    return true;
  }
  // Web / 非 RN 环境
  if (typeof g.addEventListener === "function") {
    g.addEventListener("error", (event: unknown) => {
      const e = event as { error?: unknown; message?: string };
      recordCrash(e?.error ?? e?.message ?? "未知错误", "(window)");
    });
    return true;
  }
  return false;
}

/** 包一层点击处理器：处理器里抛错不会带走整个 app。 */
export function guard<A extends unknown[]>(name: string, fn: (...args: A) => void) {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (error) {
      recordCrash(error, `[${name}]`);
    }
  };
}
