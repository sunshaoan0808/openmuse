import { useEffect, useState } from "react";
import { formatDurationMs } from "../../../packages/domain/src/activity";

/**
 * 「已经跑了多久」的**活数字**。
 *
 * Muse 的子任务行是 `%1$d个子智能体%2$s工作中 · %3$d秒` —— 每秒刷新。这不是装饰：
 * 一个静态数字回答不了用户唯一的疑问「它到底在动，还是卡住了」。
 *
 * 纯函数单独放出来是为了能单测（`test/elapsed.test.ts`）。
 */
export function elapsedSeconds(sinceMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - sinceMs) / 1000));
}

/** 「已 12 秒」/「已 1 分 20 秒」——复用全仓统一的用时人话格式。 */
export function elapsedLabel(sinceMs: number, nowMs: number): string {
  return `已 ${formatDurationMs(Math.max(0, nowMs - sinceMs))}`;
}

/**
 * 每秒重算一次的毫秒差。`sinceMs` 为 undefined 时**不挂定时器**（跑完了就别再空转）。
 */
export function useElapsedMs(sinceMs?: number): number | undefined {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (sinceMs === undefined) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sinceMs]);
  return sinceMs === undefined ? undefined : Math.max(0, nowMs - sinceMs);
}
