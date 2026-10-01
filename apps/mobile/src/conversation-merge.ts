/**
 * 游标拉取后的合并：服务端是唯一事实来源，本地可能还有它还不知道的消息
 * （刚发出、还没被确认的那条），所以按 id 去重后以服务端顺序为准、本地多出来的接在后面。
 */
export type AnyMessage = { id?: string } & Record<string, unknown>;

export function mergeConversation(local: readonly AnyMessage[], incoming: readonly AnyMessage[]) {
  // incoming 常常只是**游标之后的增量**（一两条），所以不能直接把它前置。
  // 两边都带服务端的单调 seq（本地历史也是从服务端来的），所以正确做法是**一起按 seq 排**；
  // 本地那条刚发出、还没被服务端确认的没有 seq，排在最后。
  // 之前 `[...incoming, ...local]` 会把最新几条顶到最前面 —— 真机上表现为：
  // 新回复跑到滚动区顶部、被悬浮顶栏压住，"写完了就消失了，任何地方看不到"。
  const byId = new Map<string, AnyMessage>();
  const anonymous: AnyMessage[] = [];
  const collect = (message: AnyMessage) => {
    const id = typeof message?.id === "string" ? message.id : undefined;
    if (!id) {
      anonymous.push(message);
      return;
    }
    if (!byId.has(id)) byId.set(id, message); // incoming 先收集 → 同 id 以服务端版本为准
  };
  for (const message of incoming) collect(message);
  for (const message of local) collect(message);

  const known = [...byId.values()];
  const sequenced = known.filter((message) => typeof message?.seq === "number");
  const unsequenced = known.filter((message) => typeof message?.seq !== "number");
  // 一条 seq 都没有（老数据/纯本地）：保持收集顺序（服务端在前、本地多出来的接在后）——老契约
  if (!sequenced.length) return [...known, ...anonymous];
  // 有 seq 的按 seq 排成完整时序；本地刚发、还没被服务端确认的没有 seq，排在最后
  const ordered = [...sequenced].sort((a, b) => Number(a.seq) - Number(b.seq));
  return [...ordered, ...unsequenced, ...anonymous];
}

/** 服务端已确认的消息 id 集合：本地待发队列据此清账（ACK）。 */
export function acknowledgedIds(incoming: readonly AnyMessage[]) {
  return new Set(
    incoming.map((message) => (typeof message?.id === "string" ? message.id : "")).filter(Boolean),
  );
}
