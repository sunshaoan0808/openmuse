import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, createServer, type Server, type Socket } from "node:net";
import test from "node:test";
import { parseUpstream, socksTunnel } from "../apps/worker/src/proxy.ts";

/** 缓冲读取：TCP 可能把 greeting 和 CONNECT 合并成一个包，不能假设一次 data 就是一条消息。 */
function bufferedReader(socket: Socket) {
  let buffer = Buffer.alloc(0);
  const waiters: (() => void)[] = [];
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (const wake of waiters.splice(0)) wake();
  });
  return async (count: number) => {
    while (buffer.length < count) {
      await new Promise<void>((resolve, reject) => {
        waiters.push(resolve);
        socket.once("close", () => reject(new Error("closed")));
        socket.once("error", reject);
      });
    }
    const value = buffer.subarray(0, count);
    buffer = buffer.subarray(count);
    return Buffer.from(value);
  };
}

/** 极简 SOCKS5 服务器（RFC 1928/1929），握手后转发到 echo 端口。 */
async function fakeSocks5(options: { username?: string; password?: string; echoPort: number }) {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer(async (socket) => {
    sockets.add(socket);
    const read = bufferedReader(socket);
    try {
      const greeting = await read(2);
      await read(greeting[1]);
      if (options.username) {
        socket.write(Buffer.from([0x05, 0x02]));
        const header = await read(2);
        const user = (await read(header[1])).toString();
        const passLength = (await read(1))[0];
        const password = (await read(passLength)).toString();
        seen.push(`${user}:${password}`);
        const ok = user === options.username && password === options.password;
        socket.write(Buffer.from([0x01, ok ? 0 : 1]));
        if (!ok) {
          socket.end();
          return;
        }
      } else {
        socket.write(Buffer.from([0x05, 0x00]));
      }
      const request = await read(4);
      const atyp = request[3];
      const address =
        atyp === 0x01
          ? Array.from(await read(4)).join(".")
          : atyp === 0x04
            ? "ipv6"
            : (await read((await read(1))[0])).toString();
      const port = (await read(2)).readUInt16BE(0);
      seen.push(`${address}:${port}`);
      const upstream = connect({ host: "127.0.0.1", port: options.echoPort });
      sockets.add(upstream);
      await once(upstream, "connect");
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90]));
      socket.pipe(upstream);
      upstream.pipe(socket);
    } catch {
      socket.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    port: address.port,
    seen,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function echoServer() {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk) => socket.write(Buffer.concat([Buffer.from("echo:"), chunk])));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

test("parseUpstream：只认 socks5://，拒绝 socks5h（上游做 DNS 会在 WARP 下卡死）", () => {
  assert.deepEqual(parseUpstream("socks5://openmuse:pa%23ss@127.0.0.1:1080"), {
    host: "127.0.0.1",
    port: 1080,
    username: "openmuse",
    password: "pa#ss",
  });
  assert.throws(() => parseUpstream("socks5h://127.0.0.1:1080"), /socks5:\/\//);
  assert.deepEqual(parseUpstream("socks5://127.0.0.1"), {
    host: "127.0.0.1",
    port: 1080,
    username: "",
    password: "",
  });
});

test("socksTunnel：用户名密码握手成功后双向透传", async (t) => {
  const echo = await echoServer();
  const fake = await fakeSocks5({ username: "openmuse", password: "secret", echoPort: echo.port });
  t.after(async () => {
    await fake.close();
    await echo.close();
  });

  const socket = await socksTunnel(
    { host: "127.0.0.1", port: fake.port, username: "openmuse", password: "secret" },
    "93.184.216.34",
    443,
    4,
  );
  t.after(() => socket.destroy());
  socket.write(Buffer.from("hello"));
  const [reply] = await once(socket, "data");
  assert.equal(reply.toString(), "echo:hello");
  assert.deepEqual(fake.seen, ["openmuse:secret", "93.184.216.34:443"]);
});

test("socksTunnel：无认证上游也能用（覆盖 greeting 与 CONNECT 合并到一个包的情况）", async (t) => {
  const echo = await echoServer();
  const fake = await fakeSocks5({ echoPort: echo.port });
  t.after(async () => {
    await fake.close();
    await echo.close();
  });
  const socket = await socksTunnel({ host: "127.0.0.1", port: fake.port, username: "", password: "" }, "1.1.1.1", 80, 4);
  t.after(() => socket.destroy());
  socket.write(Buffer.from("ping"));
  const [reply] = await once(socket, "data");
  assert.equal(reply.toString(), "echo:ping");
  assert.deepEqual(fake.seen, ["1.1.1.1:80"]);
});

test("socksTunnel：认证被拒时抛错，不留下半个隧道", async (t) => {
  const echo = await echoServer();
  const fake = await fakeSocks5({ username: "openmuse", password: "right", echoPort: echo.port });
  t.after(async () => {
    await fake.close();
    await echo.close();
  });
  await assert.rejects(
    socksTunnel({ host: "127.0.0.1", port: fake.port, username: "openmuse", password: "wrong" }, "1.1.1.1", 443, 4),
    /authentication rejected/,
  );
});
