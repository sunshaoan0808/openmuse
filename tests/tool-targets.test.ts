/**
 * openmuse-L1：给浏览类工具补 `targets()` 声明。
 *
 * 两组：
 *   1. `hostFromUrl` 的纯解析规则（同步、不联网、不抛异常）；
 *   2. 接线：`instrument()` 之后 `targets` 仍能被读到，并在同一份 args 上返回预期域名；
 *      外加直接取 `chatTools()` 里的 `browse_web` / `watch_page` / `read_pages` 验证真接线。
 *
 * 风格对齐 tests/ 既有用例：`node:test` + `node:assert/strict`（仓库 `pnpm test`
 * 就是 `./node_modules/.bin/tsx --test tests/*.test.ts`）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { type ChatToolContext, chatTools } from "../apps/server/src/engine/chat-tools.ts";
import { instrument } from "../apps/server/src/engine/tool-kit.ts";
import { hostFromUrl } from "../apps/server/src/engine/targets.ts";

// ---------------------------------------------------------------------------
// hostFromUrl 的解析规则（单子 §1）
// ---------------------------------------------------------------------------

test("hostFromUrl：https 正常地址 → 小写域名", () => {
  assert.equal(hostFromUrl("https://example.com/a/b?c=1#d"), "example.com");
});

test("hostFromUrl：http 正常地址", () => {
  assert.equal(hostFromUrl("http://example.com"), "example.com");
});

test("hostFromUrl：主机名大小写混合 → 小写", () => {
  assert.equal(hostFromUrl("https://ExAmPlE.CoM/Path"), "example.com");
});

test("hostFromUrl：非默认端口保留", () => {
  assert.equal(hostFromUrl("https://a.com:8443/x"), "a.com:8443");
});

test("hostFromUrl：默认端口省略", () => {
  assert.equal(hostFromUrl("https://a.com:443/x"), "a.com");
  assert.equal(hostFromUrl("http://a.com:80/x"), "a.com");
});

test("hostFromUrl：非 http(s) 协议 → null", () => {
  assert.equal(hostFromUrl("mailto:someone@example.com"), null);
  assert.equal(hostFromUrl("ftp://a.com/x"), null);
});

test("hostFromUrl：相对路径 → null", () => {
  assert.equal(hostFromUrl("foo/bar"), null);
});

test("hostFromUrl：空字符串 → null", () => {
  assert.equal(hostFromUrl(""), null);
});

test("hostFromUrl：非字符串 → null", () => {
  assert.equal(hostFromUrl(null), null);
  assert.equal(hostFromUrl(123), null);
  assert.equal(hostFromUrl(undefined), null);
  assert.equal(hostFromUrl({ url: "https://example.com" }), null);
});

// ---------------------------------------------------------------------------
// 接线：instrument() 不许把 targets 弄丢
// ---------------------------------------------------------------------------

test("接线：instrument() 之后 targets 仍可读，且在同一份 args 上返回预期域名", async () => {
  const executed: unknown[] = [];
  const wired = instrument({
    name: "browse_web",
    description: "假浏览工具（只为接线验证）",
    parameters: z.object({ url: z.string() }),
    targets: (args: unknown) => hostFromUrl((args as { url?: unknown } | undefined)?.url),
    execute: async (args) => {
      executed.push(args);
      return { ok: true };
    },
  });

  assert.equal(typeof wired.targets, "function", "instrument() 不许把 targets 弄丢");
  const args = { url: "https://News.Example.com/x" };
  assert.equal(wired.targets?.(args), "news.example.com");
  // 执行仍走咽喉、原样落到工具上（targets 不影响正常执行）。
  await wired.execute(args as never);
  assert.deepEqual(executed, [args]);
});

test("接线：数组目标经 instrument() 后去重且可读", () => {
  const wired = instrument({
    name: "read_pages",
    description: "假多页工具（只为接线验证）",
    parameters: z.object({ urls: z.array(z.string()) }),
    targets: (args: unknown) => {
      const urls = (args as { urls?: unknown } | undefined)?.urls;
      if (!Array.isArray(urls)) return [];
      const hosts: string[] = [];
      for (const url of urls) {
        const host = hostFromUrl(url);
        if (host && !hosts.includes(host)) hosts.push(host);
      }
      return hosts;
    },
    execute: async () => ({}),
  });

  assert.deepEqual(wired.targets?.({ urls: ["https://a.com/1", "https://a.com/2", "https://b.com/x"] }), [
    "a.com",
    "b.com",
  ]);
  assert.deepEqual(wired.targets?.({ urls: [] }), []);
});

// ---------------------------------------------------------------------------
// 真接线：chatTools() 里的三个浏览类工具确实声明了 targets
// ---------------------------------------------------------------------------

test("真接线：browse_web / watch_page / read_pages 声明了 targets", () => {
  // 构造期不碰 ctx（service / signal 都只在 execute 闭包里用），空壳足够取工具。
  const tools = chatTools({} as ChatToolContext);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const browse = byName.get("browse_web");
  assert.equal(typeof browse?.targets, "function", "browse_web 应当声明 targets");
  assert.equal(browse?.targets?.({ url: "https://Example.com/a" }), "example.com");

  const watch = byName.get("watch_page");
  assert.equal(typeof watch?.targets, "function", "watch_page 应当声明 targets");
  assert.equal(watch?.targets?.({ url: "https://price.example.com:8443/x" }), "price.example.com:8443");

  const read = byName.get("read_pages");
  assert.equal(typeof read?.targets, "function", "read_pages 应当声明 targets");
  assert.deepEqual(
    read?.targets?.({
      urls: ["https://a.com/1", "https://a.com/2", "https://b.com:8443/x"],
    }),
    ["a.com", "b.com:8443"],
  );

  // 没有自然目标的工具不硬塞（search_web 的 query / page_act 的动作都不算目标）。
  assert.equal(byName.get("search_web")?.targets, undefined);
  assert.equal(byName.get("page_act")?.targets, undefined);
});
