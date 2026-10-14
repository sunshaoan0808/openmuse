/**
 * 运行态看门狗判据（纯函数，便于单测）。
 *
 * 背景：跨境链路上聊天的长连接常被掐，而"流断了"**不一定**触发 onError
 * （服务端用 tee() 分了后台一支，回复照样落库、照样在会话里）。这种情况下客户端已经
 * 把回复捞回来了、界面也没报错，但 `agent.isRunning` 还挂着 true —— 于是
 * `flush()` 的守卫（`if (... || agent.isRunning) return`）把之后**每一条**消息都挡回去，
 * 消息永远停在「排队中」，服务端连一个 run 请求都收不到。
 *
 * 真机现场：第一条消息正常收到回复，第二条一直「排队中」；服务端日志里只有
 * `GET /api/agent` / `GET /api/workspace` 的轮询，没有任何 `POST .../run`。
 *
 * 判据用**服务端的 turn 记录**（它是权威）：服务端只在整条流消费完才把它写成终态，
 * 所以「客户端说在跑 + 服务端说已终态」就说明客户端的状态机漏了这一轮。
 */

/** 服务端 turn 的终态。`running` 不算。 */
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "interrupted"]);

export function isTerminalTurnStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

/**
 * 是否应当收回客户端的运行态。
 *
 * @param clientRunning `agent.isRunning`（客户端自己的状态机）
 * @param turnStatus    服务端最近一轮的状态
 */
export function shouldReclaimRun(clientRunning: boolean, turnStatus: unknown): boolean {
  return clientRunning === true && isTerminalTurnStatus(turnStatus);
}

/**
 * 宽限期：给"服务端已终态、客户端还差几秒把缓冲事件读完"留出余量，
 * 避免在正常收尾时误发停止请求。
 */
export const RECLAIM_GRACE_MS = 6000;
