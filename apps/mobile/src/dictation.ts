/**
 * 语音输入的**可测部分**：取消阈值、音量归一、取消判定。
 *
 * 单独放一个平台中立的模块，`speech.native.ts` / `speech.web.ts` / 界面都引用同一份
 * —— 免得出现"阈值写在原生实现里、界面另写一个数"的漂移。
 */

/**
 * 上滑取消的距离阈值（dp）。Muse 的原值是 `DICTATION_CANCEL_THRESHOLD = 60.0f`
 * （`composer/view/HatchComposerKt.java:133`）：按住后往上滑过 60dp 再松手 = 取消，
 * 而不是把半句识别结果提交上去。
 */
export const DICTATION_CANCEL_THRESHOLD = 60;

/** 原生音量事件给的是 -2..10（<0 视为听不见），归一到 0..1 好驱动动效。 */
export function normalizeVolume(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / 10);
}

/** 松手时该不该取消：从按下的位置往上滑够了阈值。 */
export function shouldCancelDictation(startY: number, endY: number): boolean {
  return startY - endY >= DICTATION_CANCEL_THRESHOLD;
}

/**
 * 可以自愈的错误：麦克风被别的应用占用（`audio-capture`）/ 识别服务忙（`busy`）。
 * Muse 的 `HatchDictationMicRecorder.scheduleStartRetry` 干的就是这件事 ——
 * 来电或别的录音应用抢麦，不该只丢一句失败就结束。
 */
export const RETRYABLE_DICTATION_ERRORS: readonly string[] = ["audio-capture", "busy"];

/** 自动重试的次数与间隔：够穿越一次抢麦，又不至于把用户按在"重试中"出不来。 */
export const MAX_DICTATION_START_RETRIES = 2;
export const DICTATION_RETRY_DELAY_MS = 800;

/** 波形保留多少个采样点（音量事件约 100ms 一个点 → 24 点约 2.4 秒）。 */
export const DICTATION_WAVEFORM_POINTS = 24;

/**
 * 往波形缓冲里推一个采样，返回**新数组**（便于 React 判断变化）。
 * 只保留最近的 N 个点：波形是"刚刚有没有在说话"，不是完整录音。
 */
export function pushLevel(
  levels: readonly number[],
  level: number,
  max = DICTATION_WAVEFORM_POINTS,
): number[] {
  const next = [...levels, Math.max(0, Math.min(1, level))];
  return next.length > max ? next.slice(next.length - max) : next;
}
