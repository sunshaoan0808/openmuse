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
 *
 * 两条路径：
 *  - GET /p/:token      文本/Markdown 渲染成**网页**看；网页文件原样当页面；其它类型给原始内容
 *  - GET /p/:token/raw  永远给原始字节（图片/PDF/音视频直链，以及"就是要下载原文"的场合）
 */
import type { Context } from "hono";
import { Hono } from "hono";
import type { Files } from "./files.ts";
import { escapeHtml, markdownToHtml, wrapHtmlDocument } from "./markdown-html.ts";

export function publishRoutes(files: Files) {
  const app = new Hono();

  /** token 长度先挡一道：真的 token 是 32 字符 base64url，短的一律当无效，连查都不查 */
  const lookup = async (token: string) =>
    token.length >= 16 ? await files.resolvePublish(token) : undefined;

  /** 原始字节的处理：类型与文件名照实给，浏览器能显示就显示、不能就下载 */
  const raw = async (c: Context, owner: string, fileId: string) => {
    const file = await files.get(owner, fileId);
    c.header("Content-Type", file.mimeType || "application/octet-stream");
    c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return c.body(await files.bytes(owner, fileId));
  };

  app.get("/:token", async (c) => {
    const published = await lookup(c.req.param("token"));
    if (!published) return c.text("这个链接已失效。", 404);
    const file = await files.get(published.owner, published.fileId);
    c.header("Cache-Control", "no-store");

    // 网页文件：原样当页面（发布一个 html 就是"把它放到网上"，与静态托管同一理解）
    if (file.mimeType === "text/html" || /\.html?$/i.test(file.name)) {
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.body(await files.bytes(published.owner, published.fileId));
    }
    // Markdown / 纯文本：渲染成文档页面。markdown 走转换；纯文本保持等宽原文（两处都做转义）
    if (file.mimeType.startsWith("text/")) {
      const text = new TextDecoder().decode(await files.bytes(published.owner, published.fileId));
      const isMarkdown =
        file.mimeType === "text/markdown" || /\.(md|mdown|markdown)$/i.test(file.name);
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.body(
        wrapHtmlDocument(
          file.name,
          isMarkdown ? markdownToHtml(text) : `<pre>${escapeHtml(text)}</pre>`,
        ),
      );
    }
    // 其它类型（PDF/图片/音视频）：直接给字节
    return raw(c, published.owner, published.fileId);
  });

  app.get("/:token/raw", async (c) => {
    const published = await lookup(c.req.param("token"));
    if (!published) return c.text("这个链接已失效。", 404);
    c.header("Cache-Control", "no-store");
    return raw(c, published.owner, published.fileId);
  });

  return app;
}
