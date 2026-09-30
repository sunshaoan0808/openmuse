/**
 * 游标拉取后的合并：服务端是唯一事实来源，本地可能还有它还不知道的消息
 * （刚发出、还没被确认的那条），所以按 id 去重后以服务端顺序为准、本地多出来的接在后面。
 */
export type AnyMessage = { id?: string } & Record<string, unknown>;

export function mergeConversation(local: readonly AnyMessage[], incoming: readonly AnyMessage[]) {
  const merged: AnyMessage[] = [];
  const seen = new Set<string>();
  for (const message of [...incoming, ...local]) {
    const id = typeof message?.id === "string" ? message.id : undefined;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    merged.push(message);
  }
  return merged;
}

/** 服务端已确认的消息 id 集合：本地待发队列据此清账（ACK）。 */
export function acknowledgedIds(incoming: readonly AnyMessage[]) {
  return new Set(
    incoming.map((message) => (typeof message?.id === "string" ? message.id : "")).filter(Boolean),
  );
}
