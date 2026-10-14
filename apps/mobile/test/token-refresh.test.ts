import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
/** 断言前先剥注释：文件里到处是"曾经这么写导致 401"的说明，注释里的旧值会误报 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const app = strip(readFileSync(join(root, "App.tsx"), "utf8"));

/**
 * 守一条真机上撞到的回归：**会话过期后聊天通道要能自己爬起来**。
 *
 * 现场症状：自己的 API 全部自愈（`/api/workspace` 200），唯独聊天一直报
 * 「Runtime info request failed with status 401」，而且必须冷启动 App 才恢复。
 *
 * 成因：会话有 24 小时有效期（服务端），`api.ts` 收到 401 会用存下的访问密钥续期并
 * `saveToken`，但**不更新 App 的 token state**；而 CopilotKit Provider 的 headers 正是
 * 从这个 state 来的 —— 它不走 api.ts 的续期钩子，于是永远拿着死令牌。
 */
test("续期钩子必须把新令牌写回 App 的 token state", () => {
  const start = app.indexOf("setUnauthorizedHandler(");
  const end = app.indexOf("setUnauthorizedHandler(null)");
  assert.ok(start > 0 && end > start, "App.tsx 里应能找到续期钩子的注册");

  const handler = app.slice(start, end);
  assert.ok(handler.includes("createSession(key)"), "续期应当用存下的访问密钥重新登录");
  assert.match(
    handler,
    /setToken\(session\.token\)/,
    "续期成功后必须 setToken —— 只 return 给调用方的话，聊天通道会一直用死令牌",
  );
});

test("CopilotKitProvider 的 headers 仍然取自 token state", () => {
  const headers = app
    .split("\n")
    .find((line) => line.includes("headers=") && line.includes("Authorization"));
  assert.ok(headers, "App.tsx 里应能找到 CopilotKitProvider 的 headers 配置");
  assert.ok(
    headers.includes("${token}"),
    "headers 必须引用 token state；写成常量的话令牌轮换就传不进去了",
  );
});
