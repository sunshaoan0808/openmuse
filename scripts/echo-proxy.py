#!/usr/bin/env python3
"""本地回声代理：把请求转发给真网关，同时记下 Authorization 头的**指纹**（不记本体）。

用途：当"网关说 key 无效、但同样的 key 用 curl 又是 200"时，唯一能定位的办法就是
看清 SDK 到底往请求里塞了什么头。

监听 127.0.0.1:9599，把 /v1/... 原样转发到 UPSTREAM（默认 http://10.7.0.1:9527）。
只打印指纹：长度、前 4 字符、sha256 前 16 位。绝不打印密钥本体。
"""
import hashlib
import http.client
import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = os.environ.get("ECHO_UPSTREAM", "http://10.7.0.1:9527")
up = urllib.parse.urlparse(UPSTREAM)
LOG = os.environ.get("ECHO_LOG", "/tmp/echo-proxy.log")


def fingerprint(value: str) -> str:
    if not value:
        return "(缺失)"
    return (
        f"len={len(value)} 前4={value[:4]!r} "
        f"sha256={hashlib.sha256(value.encode()).hexdigest()[:16]}"
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # 静音默认日志
        pass

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""

        auth = self.headers.get("Authorization")
        # 有些 SDK 会把 key 放别的头里，一并看一眼
        keys = {
            k: self.headers.get(k)
            for k in ("Authorization", "api-key", "x-api-key", "X-Api-Key")
            if self.headers.get(k)
        }
        line = [
            f"→ {self.command} {self.path}  content-type={self.headers.get('Content-Type')}",
            f"   auth_len={len(auth or '')}  auth_hash={hashlib.sha256((auth or '').encode()).hexdigest()[:16]}  auth_前4={ (auth or '')[:4]!r}",
        ]
        for name, value in keys.items():
            if name != "Authorization":
                line.append(f"   {name}: {fingerprint(value)}")
        line.append(f"   其它头: {sorted(h for h in self.headers.keys())}")
        if body:
            try:
                parsed = json.loads(body)
                line.append(f"   body.model={parsed.get('model')} stream={parsed.get('stream')} tools={len(parsed.get('tools') or [])}")
            except Exception:
                line.append(f"   body 非 JSON，{len(body)} 字节")
        with open(LOG, "a") as fh:
            fh.write("\n".join(line) + "\n")

        conn = http.client.HTTPConnection(up.hostname, up.port or 80, timeout=120)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "accept-encoding")}
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
        except Exception as error:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "0")
            self.end_headers()
            with open(LOG, "a") as fh:
                fh.write(f"   转发失败: {error}\n")
            return

        payload = resp.read()
        with open(LOG, "a") as fh:
            fh.write(f"   ← HTTP {resp.status} {payload[:120]!r}\n")
        self.send_response(resp.status)
        for name, value in resp.getheaders():
            if name.lower() in ("transfer-encoding", "connection", "content-length"):
                continue
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_DELETE = _handle


if __name__ == "__main__":
    open(LOG, "w").close()
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("ECHO_PORT", "9599"))), Handler)
    print(f"  echo proxy on 127.0.0.1:{server.server_port} → {UPSTREAM}，日志 {LOG}", flush=True)
    server.serve_forever()
