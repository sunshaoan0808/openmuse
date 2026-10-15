import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import type { ChatTurn } from "./chat-turns.ts";
import { readConfig } from "./config.ts";
import { createStore } from "./db.ts";
import { attachApprovalStore } from "./engine/approval-store.ts";
import { attachAuditStore, flushAuditSink } from "./engine/audit-store.ts";
import { startTurnResumer } from "./engine/turn-resume.ts";

const config = readConfig();
// 启动自检：模型链路三要素各打印一行指纹（长度/前缀/sha256 头，**绝不打印密钥本体**）。
// 这行是为"网关报 401 Invalid API key"这类事故准备的 —— 第一个要回答的问题是
// "进程手里的到底是哪个 key"，没有这行就只能靠猜。
{
  const key = process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "";
  const source = process.env.OPENAI_API_KEY
    ? "OPENAI_API_KEY"
    : process.env.DEEPSEEK_API_KEY
      ? "DEEPSEEK_API_KEY(兜底!)"
      : "(未配置，将退化为字面量 'gateway')";
  const fingerprint = key
    ? `${key.slice(0, 4)}… len=${key.length} sha256=${createHash("sha256").update(key).digest("hex").slice(0, 8)}`
    : "(空)";
  console.log(
    `[config] mode=${config.mode} baseURL=${process.env.OPENAI_BASE_URL ?? "(未配置)"} ` +
      `model=${config.model ?? "(未配置)"} apiKey=${fingerprint} 来源=${source}`,
  );
}
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
// 审计落库：咽喉产出的每条审计事件写成 records 一行（单子 §1.2）。
// 优雅降级：接不上就只保留控制台那一行 `[audit] …`（tool-executor.ts 里一字未改），
// **绝不让审计可用性决定服务起不起来**。
if (!attachAuditStore(db))
  console.error("[audit-persist] 审计只落控制台，查询接口 /audit 会返回空列表。");

// 审批落库（P1b）：咽喉产出的每条授权决策写成 records 一行（单子 §2.5）。
// 优雅降级：接不上就只保留控制台那一行，工具直接按 P0「直接拒批」——
// 那行本来就有（tool-executor.ts 里一字未改），绝不让审批可用性决定服务起不起来。
if (!attachApprovalStore(db))
  console.error("[approval-persist] 审批只落控制台，查询接口 /approvals 会返回空列表。");
await db.recoverInterruptedActions();
// 上次没跑完的对话轮次：进程已经重启，它们不可能还在跑——标成 interrupted，
// 免得 App 重连后一直等一条永远不会来的回复。
const now = new Date().toISOString();
for (const record of await db.scan<ChatTurn>("turns")) {
  if (record.value.status !== "running") continue;
  await db.put(record.owner, "turns", {
    ...record.value,
    status: "interrupted",
    error: "服务重启，这一轮没有跑完",
    finishedAt: now,
  });
}
const { app, auth, agent } = await createApp(db, config);
if (config.taskWorkerEnabled) agent.start();
// 服务端自动续跑未完成的一轮 —— 用户原话：「用户端要求无感，重试动作要做到服务端」。
// 启动时立刻跑一遍：服务重启打断的那些轮次（index.ts 上面刚标成 interrupted）正是这时候补上的；
// 之后按周期巡检，把"用户消息没被回答"的轮次自己补跑掉，不再等客户端重发。
const stopTurnResumer = startTurnResumer({
  store: db,
  auth,
  config,
  log: (message) => console.log(message),
});
// 额外监听一个公网地址（通常是本机的 IPv6）：入口域名只有 A 记录，跨境链路上
// 长连接（聊天那一轮的 SSE）常被掐；而手机侧的 IPv6 到这台机器是通的，且比绕欧洲
// 那台反代更近。设了 PUBLIC_HOST 才开这一路，不影响原有 mesh 监听。
const publicHost = process.env.PUBLIC_HOST?.trim();
if (publicHost) {
  serve({ fetch: app.fetch, port: config.port, hostname: publicHost }, (info) => {
    console.log(`[server] public listener on ${publicHost}:${info.port}`);
  });
}
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () =>
  console.log(`OpenMuse ${config.mode} API ready at ${config.publicUrl}`),
);
const shutdown = () => {
  stopTurnResumer();
  server.close(() => {
    // 先把在途的审计写完再关库，免得退出这一刻的审计随进程一起消失（只影响关停，不影响工具耗时）。
    void flushAuditSink()
      .catch(() => {})
      .then(() => agent.stop())
      .then(() => db.close())
      .then(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// MCP：启动时连接配置里的服务器并缓存工具（失败不影响启动），之后定期刷新。
// 工具通过 mcpTools() 同步取用，两个引擎（自带 / Mastra）都会带上。
void (async () => {
  const { startMcp, refreshMcpTools } = await import("./engine/mcp-tools.ts");
  await startMcp();
  const timer = setInterval(() => void refreshMcpTools().catch(() => {}), 10 * 60_000);
  timer.unref?.();
})();
