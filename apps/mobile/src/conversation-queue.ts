export type QueuedMessage = { id: string; text: string };
type Snapshot = { pending: readonly QueuedMessage[]; running: boolean; paused: boolean };

/**
 * 待发消息的落盘接口。杀进程也不丢：发出去之前先写本地，服务端确认收到（游标里出现这条 id）
 * 之后才清掉——对应 Telegram 那套"本地 SQLite 标记待发送 + 收到 ACK 才置为已发送"。
 */
export type QueueStorage = {
  load: () => Promise<QueuedMessage[]>;
  save: (messages: readonly QueuedMessage[]) => Promise<void>;
};

/** One AG-UI run at a time, while the person can keep composing. */
export class ConversationQueue {
  private state: Snapshot = { pending: [], running: false, paused: false };
  constructor(private readonly storage?: QueueStorage) {}
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
  /** 启动时把上次没发完的消息捡回来（还在队里，等一轮跑完继续发）。 */
  async restore() {
    if (!this.storage) return;
    const stored = await this.storage.load().catch(() => []);
    const known = new Set(this.state.pending.map((message) => message.id));
    const pending = stored.filter((message) => message.id && !known.has(message.id));
    if (pending.length) this.update({ pending: [...pending, ...this.state.pending] });
  }
  enqueue(message: QueuedMessage) {
    this.update({ pending: [...this.state.pending, message] });
  }
  remove(id: string) {
    this.update({ pending: this.state.pending.filter((message) => message.id !== id) });
  }
  pause() {
    this.update({ paused: true });
  }
  resume() {
    this.update({ paused: false });
  }
  async flush(send: (message: QueuedMessage) => Promise<void>) {
    if (this.state.running || this.state.paused) return;
    this.update({ running: true });
    try {
      while (this.state.pending.length && !this.state.paused) {
        const [message, ...pending] = this.state.pending;
        this.update({ pending });
        await send(message);
      }
    } catch (error) {
      // The failed message is already in the transcript. Never resend it implicitly.
      this.update({ paused: true });
      throw error;
    } finally {
      this.update({ running: false });
    }
  }
}
