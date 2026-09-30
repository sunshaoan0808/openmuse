import { once } from "node:events";
import { createServer, type OutgoingHttpHeaders, request } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { validatePublicUrl } from "./network.ts";

/** 上游 SOCKS5（例如 MicroWARP 提供的 Cloudflare WARP 出口）。 */
export interface UpstreamProxy {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * 解析 `EGRESS_SOCKS5=socks5://user:pass@host:port`。
 * 只接受 socks5://（本机解析 DNS，再把**已校验过的 IP** 交给上游）。
 * 不要用 socks5h：让上游做 DNS 会在 WARP 那类策略路由下把解析请求本身送进隧道而卡死
 * （实测直连 66ms vs socks5h 5s 超时）。
 */
export function parseUpstream(value: string): UpstreamProxy {
  const url = new URL(value);
  if (url.protocol !== "socks5:") throw new Error("EGRESS_SOCKS5 must use the socks5:// scheme");
  return {
    host: url.hostname,
    port: Number(url.port || 1080),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/** IPv6 文本 → 16 字节（支持 `::` 缩写）。 */
function ipv6Bytes(address: string) {
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => "0"),
    ...right,
  ];
  const bytes = Buffer.alloc(16);
  for (const [index, group] of groups.slice(0, 8).entries())
    bytes.writeUInt16BE(Number.parseInt(group || "0", 16) || 0, index * 2);
  return bytes;
}

/** 按需从 socket 读取固定字节数；握手期间不能丢已到达的数据（可能已经是隧道里的 TLS 字节）。 */
function makeReader(socket: Socket) {
  let buffer = Buffer.alloc(0);
  const waiters: (() => void)[] = [];
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (const wake of waiters.splice(0)) wake();
  };
  socket.on("data", onData);
  return {
    async take(count: number) {
      while (buffer.length < count) {
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve);
          socket.once("error", reject);
          socket.once("close", () => reject(new Error("SOCKS5 connection closed")));
        });
      }
      const value = buffer.subarray(0, count);
      buffer = buffer.subarray(count);
      return value;
    },
    /** 握手结束后把剩余字节塞回流，交给管道处理。 */
    finish() {
      socket.off("data", onData);
      if (buffer.length) socket.unshift(buffer);
    },
  };
}

/**
 * 经上游 SOCKS5 打通到指定 IP/端口（RFC 1928 + 1929 认证）。
 * 这里传 IP 而不是域名：公网校验已经解析并检查过地址，上游不需要、也不应该再解析一次。
 */
export async function socksTunnel(
  upstream: UpstreamProxy,
  address: string,
  port: number,
  family: number,
): Promise<Socket> {
  const socket = connect({ host: upstream.host, port: upstream.port });
  try {
    await once(socket, "connect");
    const reader = makeReader(socket);
    const wantsAuth = upstream.username.length > 0;
    socket.write(
      Buffer.from([0x05, wantsAuth ? 0x02 : 0x01, ...(wantsAuth ? [0x00, 0x02] : [0x00])]),
    );
    const greeting = await reader.take(2);
    if (greeting[0] !== 0x05) throw new Error("SOCKS5 greeting failed");
    if (greeting[1] === 0x02) {
      const user = Buffer.from(upstream.username, "utf8");
      const pass = Buffer.from(upstream.password, "utf8");
      socket.write(
        Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]),
      );
      const auth = await reader.take(2);
      if (auth[1] !== 0x00) throw new Error("SOCKS5 authentication rejected");
    } else if (greeting[1] !== 0x00)
      throw new Error("SOCKS5 upstream requires unsupported authentication");
    // 目标用 IP 字面量：ATYP 1=IPv4, 4=IPv6
    const octets = address.split(".").map(Number);
    const isV4 =
      family !== 6 && octets.length === 4 && octets.every((part) => Number.isInteger(part));
    const literal = isV4
      ? Buffer.from([0x01, ...octets])
      : Buffer.from([0x04, ...ipv6Bytes(address)]);
    socket.write(
      Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00]),
        literal,
        Buffer.from([port >> 8, port & 0xff]),
      ]),
    );
    const reply = await reader.take(4);
    if (reply[1] !== 0x00) throw new Error(`SOCKS5 connect refused (code ${reply[1]})`);
    // 应答尾巴：BND.ADDR（长度随 ATYP 变化）+ BND.PORT，必须完整吃掉，否则会污染隧道
    if (reply[3] === 0x01) await reader.take(4);
    else if (reply[3] === 0x04) await reader.take(16);
    else if (reply[3] === 0x03) await reader.take((await reader.take(1))[0]);
    else throw new Error("SOCKS5 connect reply malformed");
    await reader.take(2);
    reader.finish();
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/** All upstream sockets connect to a validated IP, never a second DNS lookup. */
export async function startEgressProxy(options: { upstream?: UpstreamProxy } = {}) {
  const upstream = options.upstream;
  const sockets = new Set<Socket>();
  const server = createServer(async (incoming, response) => {
    try {
      const target = await validatePublicUrl(incoming.url ?? "");
      if (target.url.protocol !== "http:") throw new Error("HTTP proxy requires HTTP URL");
      const headers: OutgoingHttpHeaders = { ...incoming.headers, host: target.url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstreamRequest = request(
        {
          hostname: target.address,
          family: target.family,
          port: Number(target.url.port || 80),
          path: `${target.url.pathname}${target.url.search}`,
          method: incoming.method,
          headers,
          timeout: 30_000,
          agent: false,
          // 配了上游就经 SOCKS5 出去；否则直连（行为与以前一致）。
          ...(upstream
            ? {
                createConnection: (
                  _options: unknown,
                  oncreate: (error: Error | null, socket: Duplex) => void,
                ) => {
                  void socksTunnel(
                    upstream,
                    target.address,
                    Number(target.url.port || 80),
                    target.family,
                  ).then(
                    (socket) => oncreate(null, socket),
                    () => {
                      // 上游挂了不能让明文 HTTP 也断：退回直连并留一条日志。
                      console.warn(
                        "egress upstream unavailable on plain HTTP, falling back to direct",
                      );
                      const direct = connect({
                        host: target.address,
                        port: Number(target.url.port || 80),
                        family: target.family,
                      });
                      direct.once("connect", () => oncreate(null, direct));
                      direct.once("error", (error) => oncreate(error, undefined as never));
                    },
                  );
                  return undefined;
                },
              }
            : {}),
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.on("error", () => response.destroy());
          result.pipe(response);
        },
      );
      upstreamRequest.on("timeout", () => upstreamRequest.destroy());
      upstreamRequest.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      incoming.on("aborted", () => upstreamRequest.destroy());
      response.on("close", () => upstreamRequest.destroy());
      incoming.pipe(upstreamRequest);
    } catch {
      response.writeHead(403);
      response.end("Destination blocked");
    }
  });
  server.on("connect", async (request, client, head) => {
    client.on("error", () => client.destroy());
    try {
      const authority = request.url ?? "";
      if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+):443$/i.test(authority))
        throw new Error("Invalid tunnel");
      const target = await validatePublicUrl(`https://${authority}`);
      if (client.destroyed) return;
      const direct = () =>
        new Promise<Socket>((resolve, reject) => {
          const socket = connect({ host: target.address, port: 443, family: target.family });
          socket.once("connect", () => resolve(socket));
          socket.once("error", reject);
        });
      let tunnel: Socket;
      if (upstream) {
        try {
          tunnel = await socksTunnel(upstream, target.address, 443, target.family);
        } catch (error) {
          // 上游不可达（容器重启、凭据变更）不能让浏览整体瘫痪：退回直连并留日志。
          // 站点级封锁（403/挑战页）不是连接错误，所以照样会暴露出来，不会被兜底掩盖。
          console.warn(
            "egress upstream unavailable, falling back to direct",
            error instanceof Error ? error.message : error,
          );
          tunnel = await direct();
        }
      } else {
        tunnel = await direct();
      }
      sockets.add(tunnel);
      tunnel.setTimeout(60_000, () => tunnel.destroy());
      tunnel.on("close", () => {
        sockets.delete(tunnel);
        client.destroy();
      });
      tunnel.on("error", () => client.destroy());
      client.on("close", () => tunnel.destroy());
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) tunnel.write(head);
      tunnel.pipe(client);
      client.pipe(tunnel);
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Proxy unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
