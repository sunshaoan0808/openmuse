/**
 * 公开只读链接（发布）—— 对应 Muse 的 PUBLISH。
 *
 * **故意挂在 /api/* 之外**：拿到链接的人没有会话令牌，认证靠 token 本身
 * （24 字节随机 = 能力），和 /git 代发代理是同一套思路。
 *
 * 安全边界：
 *  - token 猜不到（192 位随机），且只在数据库里、不跟着列表/详情到处漂；
 *  - 只读、只服务这一个文件，没有列目录、没有写路径；
 *  - 停止发布 = 删掉映射记录，同一个 token 立刻 404（不是"标记失效"那种假撤销）；
 *  - 回包带 no-store，免得中间层把它缓存成"永久公开"。
 */
import { Hono } from "hono";
import type { Files } from "./files.ts";

export function publishRoutes(files: Files) {
  const app = new Hono();
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    // 长度先挡一道：token 是 32 字符的 base64url，短的一律当无效，连查都不查
    const published = token.length >= 16 ? await files.resolvePublish(token) : undefined;
    if (!published) return c.text("这个链接已失效。", 404);
    const file = await files.get(published.owner, published.fileId);
    c.header("Content-Type", file.mimeType || "application/octet-stream");
    c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    c.header("Cache-Control", "no-store");
    return c.body(await files.bytes(published.owner, published.fileId));
  });
  return app;
}
