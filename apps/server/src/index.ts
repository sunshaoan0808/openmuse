import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { createStore } from "./db.ts";

const config = readConfig();
const db = await createStore({
  dataDir: `${config.dataDir}/postgres`,
  databaseUrl: config.databaseUrl,
});
await db.recoverInterruptedActions();
const { app, agent } = await createApp(db, config);
if (config.taskWorkerEnabled) agent.start();
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
