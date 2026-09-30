import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import type { ChatTurn } from "./chat-turns.ts";
import { readConfig } from "./config.ts";
import { createStore } from "./db.ts";

const config = readConfig();
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
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
const { app, agent } = await createApp(db, config);
if (config.taskWorkerEnabled) agent.start();
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
  server.close(() => {
    void agent
      .stop()
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
