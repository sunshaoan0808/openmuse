/**
 * 验证 GET /personas 路由：不经过 HTTP 鉴权，在 Hono 层直接请求。
 * 这条路由不碰 service，所以 service 传空对象即可。
 */
import { Hono } from "hono";
import { agentRoutes } from "../apps/server/src/engine/routes.ts";

const app = new Hono<{ Variables: { owner: string } }>();
app.use("*", async (c, next) => {
  c.set("owner", "local-user");
  await next();
});
app.route("/", agentRoutes({} as never));

const res = await app.request("/personas");
console.log(`  HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
const body = (await res.json()) as { personas?: unknown[] };
const list = (body.personas ?? []) as {
  id: string;
  name: string;
  prototype?: string;
  avatar?: string;
  order?: number;
  spectrum?: Record<string, number>;
  charmLayers?: string[];
  oneLine?: string;
}[];
console.log(`  返回 ${list.length} 个角色：`);
for (const p of list) {
  console.log(
    `    ${(p.avatar ?? "?").padEnd(2)} ${p.name.padEnd(9)} ${String(p.prototype ?? "").padEnd(5)} ` +
      `order=${String(p.order).padEnd(3)} 光谱${Object.keys(p.spectrum ?? {}).length}维 魅力${(p.charmLayers ?? []).length}层  ${(p.oneLine ?? "").slice(0, 22)}`,
  );
}
const expected = ["id", "name", "prototype", "avatar", "order", "spectrum", "charmLayers"];
const missing = expected.filter((k) => !(k in (list[0] ?? {})));
console.log(`  首条字段完备性：${missing.length ? `缺 ${missing.join(", ")}` : "✓ 全部齐备"}`);
console.log(`  正文是否泄漏（不该有 SOUL/GENOME）：${JSON.stringify(list[0]).includes("SOUL") ? "✗ 泄漏" : "✓ 未带正文"}`);
