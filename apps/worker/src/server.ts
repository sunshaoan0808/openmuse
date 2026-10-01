import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { createBrowserManager, validateSessionId } from "./browser.ts";
import { WorkerError } from "./errors.ts";

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new WorkerError("INVALID_BODY", "A JSON request body is required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 64 * 1024)
      throw new WorkerError("BODY_TOO_LARGE", "Request body exceeds 64 KiB.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Invalid object");
    return result as Record<string, unknown>;
  } catch {
    throw new WorkerError("INVALID_BODY", "A JSON object is required.");
  }
}

function requiredUrl(body: Record<string, unknown>): string {
  if (typeof body.url !== "string" || body.url.length > 8192)
    throw new WorkerError("INVALID_URL", "A URL of at most 8192 characters is required.");
  return body.url;
}

export async function createWorkerServer(options: {
  token: string;
  dataDir: string;
  maxSessions?: number;
  idleTimeoutMs?: number;
}) {
  if (options.token.length < 32)
    throw new Error("WORKER_TOKEN must contain at least 32 characters.");
  const tokenHash = createHash("sha256").update(`Bearer ${options.token}`).digest();
  const browser = await createBrowserManager(options);
  const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
    };
    try {
      const target = new URL(request.url ?? "/", "http://worker");
      const pathname = target.pathname;
      const search = target.searchParams;
      if (request.method === "GET" && pathname === "/health") {
        json(200, { status: "ok" });
        return;
      }
      const headerHash = createHash("sha256")
        .update(request.headers.authorization ?? "")
        .digest();
      if (!timingSafeEqual(headerHash, tokenHash))
        throw new WorkerError("UNAUTHORIZED", "Worker authentication is required.", 401);
      if (pathname === "/sessions" && request.method === "GET") {
        json(200, browser.list());
        return;
      }
      if (pathname === "/sessions" && request.method === "POST") {
        const body = await readBody(request);
        json(201, await browser.create(validateSessionId(body.id), requiredUrl(body)));
        return;
      }
      const match =
        /^\/sessions\/([^/]+)\/(navigate|close|screenshot|pdf|read|content|input|downloads|back|forward|reload|viewport|elements|act)(?:\/([^/]+))?$/.exec(
          pathname,
        );
      if (!match) throw new WorkerError("NOT_FOUND", "Worker endpoint not found.", 404);
      const id = validateSessionId(match[1]);
      const action = match[2];
      const downloadId = match[3];
      if (action === "navigate" && !downloadId && request.method === "POST")
        json(200, await browser.navigate(id, requiredUrl(await readBody(request))));
      else if (action === "close" && !downloadId && request.method === "POST")
        json(200, await browser.closeSession(id));
      else if (action === "input" && !downloadId && request.method === "POST")
        json(200, await browser.input(id, await readBody(request)));
      else if (action === "read" && !downloadId && request.method === "GET")
        json(200, await browser.read(id));
      else if (action === "content" && !downloadId && request.method === "GET")
        json(200, await browser.content(id));
      else if (action === "back" && !downloadId && request.method === "POST")
        json(200, await browser.back(id));
      else if (action === "forward" && !downloadId && request.method === "POST")
        json(200, await browser.forward(id));
      else if (action === "reload" && !downloadId && request.method === "POST")
        json(200, await browser.reload(id));
      else if (action === "viewport" && !downloadId && request.method === "POST") {
        const body = await readBody(request);
        const { width, height } = body;
        if (
          typeof width !== "number" ||
          typeof height !== "number" ||
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width < 320 ||
          width > 1920 ||
          height < 240 ||
          height > 1200
        )
          throw new WorkerError(
            "INVALID_VIEWPORT",
            "Viewport must be 320-1920 by 240-1200 pixels.",
          );
        json(200, await browser.viewport(id, width, height));
      } else if (action === "elements" && !downloadId && request.method === "GET")
        json(200, await browser.elements(id));
      else if (action === "act" && !downloadId && request.method === "POST")
        json(200, await browser.act(id, await readBody(request)));
      else if (action === "pdf" && !downloadId && request.method === "POST") {
        // 导出用：把一段 HTML 打印成 PDF（返回二进制，不走 JSON）
        const body = await readBody(request);
        const html = typeof body.html === "string" ? body.html : "";
        if (!html) throw new WorkerError("INVALID_REQUEST", "html is required.");
        const bytes = await browser.pdf(id, html);
        response.writeHead(200, {
          "content-type": "application/pdf",
          "content-length": bytes.length,
        });
        response.end(bytes);
      } else if (action === "screenshot" && !downloadId && request.method === "GET") {
        const format = search.get("format") === "jpeg" ? "jpeg" : "png";
        const quality = Number(search.get("quality") ?? "");
        const bytes = await browser.screenshot(id, {
          format,
          ...(Number.isFinite(quality) ? { quality } : {}),
        });
        response.writeHead(200, {
          "content-type": format === "jpeg" ? "image/jpeg" : "image/png",
          "content-length": bytes.length,
        });
        response.end(bytes);
      } else if (action === "downloads" && request.method === "GET") {
        if (!downloadId) json(200, await browser.downloads(id));
        else {
          const result = await browser.download(id, downloadId);
          response.writeHead(200, {
            "content-type": "application/pdf",
            "content-length": result.bytes.length,
            "content-disposition": `attachment; filename="${result.metadata.name}"`,
          });
          response.end(result.bytes);
        }
      } else throw new WorkerError("NOT_FOUND", "Worker endpoint not found.", 404);
    } catch (error) {
      // 非预期错误对外只回一句通用文案，真实原因必须落到服务端日志，否则线上只能看到 500。
      if (!(error instanceof WorkerError)) console.error("worker failure", error);
      const safe =
        error instanceof WorkerError
          ? error
          : new WorkerError(
              "WORKER_FAILURE",
              "The browser operation failed. Check worker health and reopen the session.",
              500,
            );
      if (!response.headersSent && !response.destroyed)
        json(safe.status, { error: { code: safe.code, message: safe.message } });
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return {
    server,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await browser.close();
    },
  };
}
