export type QueuedMessage = {
  id: string;
  text: string;
  /** 已失败次数（首次发送=0）：达到 STUCK_AFTER 显示「点按重发」，且重试前先向服务端确认是否已收到 */
  attempts?: number;
  /** 下次允许尝试的时间戳（毫秒）；缺省=立即可试 */
  nextAt?: number;
  /** true = 这一轮正在跑（原地标记，不再"先弹出再发送"——杀进程也不丢这条） */
  sending?: boolean;
};
type Snapshot = { pending: readonly QueuedMessage[]; running: boolean; paused: boolean };

/**
 * 重试前的退避序列（毫秒）：1s→2s→5s→15s→60s→5min，之后一直 5min。
 * **永不把失败当终局**——失败只改变"下次什么时候再试"，绝不向上层抛「连不上服务器」。
 */
export const RESEND_DELAYS: readonly number[] = [1000, 2000, 5000, 15000, 60000, 300000];
/** 失败次数达到这个数，徽标从纯时钟升级为「可点的小重发图标」。 */
export const STUCK_AFTER_ATTEMPTS = 3;
/** 运行通道忙时的让位间隔：不算失败、不计入 attempts，只推迟下一次尝试。 */
export const BUSY_RETRY_MS = 1500;

/** 运行通道忙（上一轮还在跑/会话没就绪）：泵稍后原样重试，不算失败。 */
export class QueueBusyError extends Error {
  constructor() {
    super("发送通道忙，稍后自动重试。");
    this.name = "QueueBusyError";
  }
}

/**
 * 待发消息的落盘接口。杀进程也不丢：发出去之前先写本地，服务端确认收到（游标里出现这条 id）
 * 之后才清掉——对应 Telegram 那套"本地 SQLite 标记待发送 + 收到 ACK 才置为已发送"。
 */
export type QueueStorage = {
  load: () => Promise<QueuedMessage[]>;
  save: (messages: readonly QueuedMessage[]) => Promise<void>;
};

export type QueueClock = {
  now?: () => number;
  /** 可注入的定时器（node:test 里用来确定性地驱动退避）。返回取消函数。 */
  schedule?: (fn: () => void, ms: number) => () => void;
};

/** One AG-UI run at a time, while the person can keep composing. */
export class ConversationQueue {
  private state: Snapshot = { pending: [], running: false, paused: false };
  private send?: (message: QueuedMessage) => Promise<void>;
  private timer?: () => void;
  private cyclePromise?: Promise<void>;
  constructor(
    private readonly storage?: QueueStorage,
    private readonly clock: QueueClock = {},
  ) {}
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    if (patch.pending) void this.storage?.save(this.state.pending).catch(() => {});
    for (const listener of this.listeners) listener();
  }
  private now() {
    return this.clock.now?.() ?? Date.now();
  }
  private scheduleRetry(delayMs: number) {
    this.timer?.();
    const schedule =
      this.clock.schedule ??
      ((fn: () => void, ms: number) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
    this.timer = schedule(() => {
      this.timer = undefined;
      void this.pump();
    }, delayMs);
  }
  /** 启动时把上次没发完的消息捡回来（sending 复位——上次可能死在发送途中）。 */
  async restore() {
    if (!this.storage) return;
    const stored = await this.storage.load().catch(() => []);
    const known = new Set(this.state.pending.map((message) => message.id));
    const pending = stored
      .filter((message) => message.id && !known.has(message.id))
      .map((message) => ({ ...message, sending: false }));
    if (pending.length) this.update({ pending: [...this.state.pending, ...pending] });
  }
  enqueue(message: QueuedMessage) {
    this.update({ pending: [...this.state.pending, message] });
    void this.pump();
  }
  remove(id: string) {
    this.update({ pending: this.state.pending.filter((message) => message.id !== id) });
  }
  /** 用户点「重发」：清掉失败计数并立刻尝试（不改变其它条的退避节奏）。 */
  resendNow(id: string) {
    this.update({
      pending: this.state.pending.map((message) =>
        message.id === id
          ? { ...message, attempts: 0, nextAt: undefined, sending: false }
          : message,
      ),
    });
    void this.pump();
  }
  pause() {
    this.timer?.();
    this.timer = undefined;
    this.update({ paused: true });
  }
  resume() {
    this.update({ paused: false });
    void this.pump();
  }
  /** 注册发送通道并立刻泵一轮。永不 reject：失败被泵折算成退避重试。
   *  泵已在跑时**等待那一轮结束**（测试用来确定性静默；调用方用 void 触发即不等待）。 */
  async flush(send: (message: QueuedMessage) => Promise<void>) {
    this.send = send;
    await (this.cyclePromise ?? this.pump());
  }
  /**
   * 后台泵：按顺序投递到期的消息，一次只跑一条。
   * 失败 → attempts+1 并按 RESEND_DELAYS 安排下一次；QueueBusy → 让位重试不计失败。
   * already-pumping 时直接复用在跑的那一轮（调用方 await 它即可看到本轮排空）。
   */
  private pump(): Promise<void> {
    if (this.cyclePromise) return this.cyclePromise;
    if (this.state.paused || !this.send) return Promise.resolve();
    const cycle = this.runCycle().finally(() => {
      this.cyclePromise = undefined;
    });
    this.cyclePromise = cycle;
    return cycle;
  }
  private async runCycle(): Promise<void> {
    for (;;) {
      if (this.state.paused || !this.send) return;
      const now = this.now();
      const next = this.state.pending.find(
        (message) => !message.sending && (message.nextAt ?? 0) <= now,
      );
      if (!next) {
        // 还有没到点的？把泵的下一跳定在最近的 nextAt 上（已有定时器就不重排，避免抖动）
        const waiting = this.state.pending.filter((message) => !message.sending);
        const due = waiting.length ? Math.min(...waiting.map((message) => message.nextAt ?? 0)) : 0;
        if (due > now && !this.timer) this.scheduleRetry(due - now);
        return;
      }
      this.update({
        pending: this.state.pending.map((message) =>
          message.id === next.id ? { ...message, sending: true } : message,
        ),
      });
      try {
        await this.send(next);
        this.remove(next.id);
      } catch (error) {
        if (error instanceof QueueBusyError) {
          this.update({
            pending: this.state.pending.map((message) =>
              message.id === next.id
                ? { ...message, sending: false, nextAt: this.now() + BUSY_RETRY_MS }
                : message,
            ),
          });
          this.scheduleRetry(BUSY_RETRY_MS);
          return;
        }
        const attempts = (next.attempts ?? 0) + 1;
        const delay = RESEND_DELAYS[Math.min(attempts - 1, RESEND_DELAYS.length - 1)];
        const nextAt = this.now() + delay;
        this.update({
          pending: this.state.pending.map((message) =>
            message.id === next.id ? { ...message, sending: false, attempts, nextAt } : message,
          ),
        });
        this.scheduleRetry(delay);
        return;
      }
    }
  }
}
