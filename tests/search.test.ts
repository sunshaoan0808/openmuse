import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, test } from "node:test";
import type { BrowserService } from "../apps/server/src/browser.ts";
import type { Config } from "../apps/server/src/config.ts";
import {
  decodeEntities,
  decodeRedirect,
  extractArticleText,
  filterRelevant,
  genericResults,
  looksBlocked,
  parseSerp,
  relevanceScore,
  SearchService,
  stripTags,
} from "../apps/server/src/search.ts";

const fixture = (name: string) => readFile(join("tests", "fixtures", name), "utf8");
const searchConfig = (extra: Partial<Config> = {}) =>
  ({ searchApiKeys: [], ...extra }) as unknown as Config;
const noWorker = {
  htmlForThread: async () => {
    throw new Error("浏览器工作进程未配置");
  },
} as unknown as BrowserService;

let bingHtml = "";
let braveHtml = "";
let duckHtml = "";
let articleHtml = "";

before(async () => {
  [bingHtml, braveHtml, duckHtml, articleHtml] = await Promise.all([
    fixture("serp-bing.html"),
    fixture("serp-brave.html"),
    fixture("serp-duckduckgo.html"),
    fixture("article.html"),
  ]);
});

test("html helpers decode entities and strip markup", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &#39;d&#39;"), "a & b <c> 'd'");
  assert.equal(stripTags("<p>Hello <b>world</b></p>"), "Hello world");
  assert.equal(stripTags("<script>bad()</script><p>ok</p>"), "ok");
});

test("redirect links resolve to their real target", () => {
  const bing = "https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLm9yZy9kb2Nz&nt=1";
  assert.equal(decodeRedirect(bing), "https://example.org/docs");
  const ddg = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&rut=z";
  assert.equal(decodeRedirect(ddg), "https://example.org/a?b=1");
  assert.equal(decodeRedirect("//example.org/x"), "https://example.org/x");
  assert.equal(decodeRedirect("https://example.org/plain"), "https://example.org/plain");
});

test("bing results parse into titles, real urls and snippets", () => {
  const results = parseSerp(bingHtml, "bing");
  assert.ok(results.length >= 3, `期望 >=3 条，实际 ${results.length}`);
  for (const item of results) {
    assert.match(item.url, /^https?:\/\//);
    assert.ok(!item.url.includes("bing.com/ck"), "跳转链接必须被还原");
    assert.ok(item.title.length > 3, "标题不能为空");
    assert.ok(!item.title.includes("http"), "标题不能是面包屑里的 URL");
  }
  // 时效性问题要能引用发布日期，SERP 摘要里的日期要留着
  assert.ok(
    results.some((item) => /\b(19|20)\d{2}\b/.test(item.snippet)),
    "摘要应保留发布日期",
  );
});

test("brave results parse from the real markup", () => {
  const results = parseSerp(braveHtml, "brave");
  assert.ok(results.length >= 2, `期望 >=2 条，实际 ${results.length}`);
  assert.ok(results.some((item) => item.url.includes("github.com/CopilotKit/openmuse")));
  for (const item of results) assert.ok(item.title.length > 3);
});

test("duckduckgo results decode the uddg redirect", () => {
  const results = parseSerp(duckHtml, "duckduckgo");
  assert.equal(results[0]?.url, "https://github.com/CopilotKit/openmuse");
  assert.match(results[0]?.snippet ?? "", /browser, terminal and files/);
  assert.equal(results[1]?.url, "https://example.org/openmuse-docs");
});

test("an unfamiliar serp layout still yields same-site results", () => {
  const html =
    '<html><body><div><a href="https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLm9yZy9h">Example article about retrieval</a></div>' +
    '<div><a href="https://example.org/b">Another useful page here</a></div>' +
    '<div><a href="https://example.org/b">Another useful page here</a></div></body></html>';
  const results = genericResults(html, 10);
  assert.deepEqual(
    results.map((item) => item.url),
    ["https://example.org/a", "https://example.org/b"],
  );
});

test("article text keeps the body and drops chrome and scripts", () => {
  const { text, truncated } = extractArticleText(articleHtml, 4000);
  assert.match(text, /Retrieval turns a question into a query/);
  assert.match(text, /three good sources with clear dates/);
  assert.ok(!text.includes("should not appear"), "脚本内容不能混进来");
  assert.ok(!text.includes("All rights reserved"), "页脚不该是正文");
  assert.equal(truncated, false);
  const short = extractArticleText(articleHtml, 60);
  assert.equal(short.truncated, true);
  assert.ok(short.text.length <= 60);
});

test("a decoy serp scores as irrelevant while real results score high", () => {
  // 这份 bing 固件来自实践中的诱饵：问 openmuse 却返回完全无关的商品页
  const decoy = parseSerp(bingHtml, "bing");
  const decoyScore = relevanceScore("CopilotKit OpenMuse personal agent", decoy);
  assert.ok(decoyScore < 0.34, `诱饵必须被判低，实际 ${decoyScore}`);
  assert.equal(filterRelevant("CopilotKit OpenMuse personal agent", decoy).length, 0);
  const real = parseSerp(braveHtml, "brave");
  const realScore = relevanceScore("openmuse agent framework", real);
  assert.ok(realScore >= 0.34, `真实结果必须过关，实际 ${realScore}`);
  assert.ok(filterRelevant("openmuse agent framework", real).length >= 1);
});

test("search uses the http backend and returns structured results", async () => {
  let calls = 0;
  const service = new SearchService(searchConfig(), noWorker, () => 1_000, (async (url: string) => {
    calls += 1;
    if (String(url).includes("search.brave.com")) return new Response(braveHtml, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as unknown as typeof fetch);
  const outcome = await service.search("owner", "thread", "openmuse agent framework", { count: 3 });
  assert.equal(outcome.backend, "http-serp");
  assert.ok(outcome.results.length >= 1);
  assert.ok(outcome.results.every((item) => /^https?:\/\//.test(item.url)));
  assert.equal(outcome.pages.length, 0);
  // 第二次同 query 命中缓存，不再发请求
  const before = calls;
  const cached = await service.search("owner", "thread", "openmuse agent framework", { count: 3 });
  assert.match(cached.backend, /缓存/);
  assert.equal(calls, before);
});

test("search with read returns pages and isolates a failing url", async () => {
  const service = new SearchService(searchConfig(), noWorker, () => 5_000, (async (url: string) => {
    const target = String(url);
    if (target.includes("search.brave.com")) return new Response(braveHtml, { status: 200 });
    if (target.endsWith("/broken")) return new Response("nope", { status: 503 });
    return new Response(articleHtml, { status: 200 });
  }) as unknown as typeof fetch);
  const first = (await service.search("owner", "thread", "openmuse agent", { read: 0 })).results[0];
  assert.ok(first);
  const pages = await service.readPages([first.url, "https://example.org/broken"], {});
  assert.equal(pages.length, 2);
  assert.match(pages[0]?.text ?? "", /Retrieval turns a question/);
  assert.equal(pages[0]?.title, "How retrieval works");
  assert.match(pages[1]?.error ?? "", /HTTP 503/);
});

test("a configured api key is used before scraping", async () => {
  const seen: string[] = [];
  const service = new SearchService(
    searchConfig({ searchApiKeys: ["secret"], searchProvider: "brave" }),
    noWorker,
    () => 9_000,
    (async (url: string, init?: RequestInit) => {
      seen.push(String(url));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      assert.equal(headers["X-Subscription-Token"], "secret");
      return new Response(await fixture("brave-api.json"), { status: 200 });
    }) as unknown as typeof fetch,
  );
  const outcome = await service.search("owner", "thread", "openmuse");
  assert.equal(outcome.backend, "brave");
  assert.equal(outcome.results[0]?.url, "https://github.com/CopilotKit/openmuse");
  assert.ok(seen[0]?.includes("api.search.brave.com"));
});

test("firecrawl search results parse from the documented shape", async () => {
  // 手上 10 把 key 全被 Firecrawl 封号（403 banned），所以这份固件按文档形状写，
  // 等拿到可用 key 再用真实响应复核
  const service = new SearchService(
    searchConfig({ searchApiKeys: ["fc-test"], searchProvider: "firecrawl" }),
    noWorker,
    () => 9_000,
    (async (url: string) => {
      assert.equal(String(url), "https://api.firecrawl.dev/v1/search");
      return new Response(await fixture("firecrawl.json"), { status: 200 });
    }) as unknown as typeof fetch,
  );
  const outcome = await service.search("owner", "thread", "openmuse");
  assert.equal(outcome.backend, "firecrawl");
  assert.deepEqual(
    outcome.results.map((item) => item.url),
    ["https://github.com/CopilotKit/openmuse", "https://www.copilotkit.ai/openmuse"],
  );
});

test("a banned key rotates to the next one and never leaks the secret", async () => {
  const seen: string[] = [];
  const service = new SearchService(
    searchConfig({
      searchApiKeys: ["fc-banned-aaaaaaaa", "fc-good-bbbbbbbb"],
      searchProvider: "firecrawl",
    }),
    noWorker,
    () => 9_000,
    (async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const key = headers.Authorization.replace("Bearer ", "");
      seen.push(key);
      if (key.includes("banned"))
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized: This account has been banned." }),
          { status: 403 },
        );
      return new Response(await fixture("firecrawl.json"), { status: 200 });
    }) as unknown as typeof fetch,
  );
  const outcome = await service.search("owner", "thread", "openmuse");
  assert.equal(outcome.backend, "firecrawl");
  assert.equal(outcome.results.length, 2);
  assert.deepEqual(seen, ["fc-banned-aaaaaaaa", "fc-good-bbbbbbbb"]);

  // 被封的那把进冷却：换个 query 再搜，不该再去撞它
  seen.length = 0;
  const second = await service.search("owner", "thread", "openmuse again");
  assert.equal(second.backend, "firecrawl");
  assert.deepEqual(seen, ["fc-good-bbbbbbbb"], "冷却中的 key 不该被再次尝试");

  // 全被封时：报错要说明是第几把、后 6 位，但不能出现完整 key
  const dead = new SearchService(
    searchConfig({ searchApiKeys: ["fc-banned-aaaaaaaa"], searchProvider: "firecrawl" }),
    noWorker,
    () => 1,
    (async () =>
      new Response(JSON.stringify({ success: false, error: "Unauthorized: banned." }), {
        status: 403,
      })) as unknown as typeof fetch,
  );
  await assert.rejects(dead.search("owner", "thread", "openmuse"), (error: Error) => {
    assert.match(error.message, /firecrawl/);
    assert.match(error.message, /aaaaaa/, "应保留后 6 位便于定位");
    assert.ok(!error.message.includes("fc-banned-aaaaaaaa"), "完整 key 不能进错误信息");
    return true;
  });
});

test("a pool of dead keys fails fast after the first attempt", async () => {
  let keyCalls = 0;
  const service = new SearchService(
    searchConfig({
      searchApiKeys: ["fc-dead-111111", "fc-dead-222222", "fc-dead-333333"],
      searchProvider: "firecrawl",
    }),
    noWorker,
    () => 10_000,
    (async (url: string) => {
      if (!String(url).includes("api.firecrawl.dev")) return new Response("nope", { status: 403 });
      keyCalls += 1;
      return new Response(JSON.stringify({ success: false, error: "account has been banned" }), {
        status: 403,
      });
    }) as unknown as typeof fetch,
  );
  await assert.rejects(service.search("owner", "thread", "first"), /banned|冷却中/);
  assert.equal(keyCalls, 3, "第一次要把三把都试过");
  // 第二次：全都还在冷却里 → 立刻放弃（让抓取后端接管），不再打这些 key
  const before = keyCalls;
  await assert.rejects(service.search("owner", "thread", "second"), /冷却中/);
  assert.equal(keyCalls, before, "冷却中的 key 不该再被请求");
});

test("a huge key pool only spends a few attempts per search", async () => {
  let calls = 0;
  const service = new SearchService(
    searchConfig({
      searchApiKeys: Array.from({ length: 40 }, (_, index) => `tvly-dev-dead-${index}`),
      searchProvider: "tavily",
    }),
    noWorker,
    () => 1_000,
    (async (url: string) => {
      // 只数打给 Tavily 的请求；抓取后端的 3 次不算在里面
      if (!String(url).includes("api.tavily.com")) return new Response("nope", { status: 403 });
      calls += 1;
      return new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 });
    }) as unknown as typeof fetch,
  );
  await assert.rejects(service.search("owner", "thread", "anything"));
  assert.equal(calls, 6, "40 把 key 的池子单次最多试 6 把");
});

test("a working key is remembered and used first next time", async () => {
  const tried: string[] = [];
  const service = new SearchService(
    searchConfig({
      searchApiKeys: ["tvly-dev-dead-1", "tvly-dev-dead-2", "tvly-dev-live-9"],
      searchProvider: "tavily",
    }),
    noWorker,
    () => 1_000,
    (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { api_key?: string };
      const key = body.api_key ?? "";
      tried.push(key);
      if (key.includes("dead"))
        return new Response(JSON.stringify({ detail: "nope" }), { status: 401 });
      return new Response(await fixture("tavily.json"), { status: 200 });
    }) as unknown as typeof fetch,
  );
  const first = await service.search("owner", "thread", "openmuse");
  assert.equal(first.backend, "tavily");
  assert.deepEqual(tried, ["tvly-dev-dead-1", "tvly-dev-dead-2", "tvly-dev-live-9"]);
  assert.equal(first.results[0]?.url, "https://github.com/CopilotKit/openmuse");
  // 第二次：好用的那把排到最前，不再撞死 key
  tried.length = 0;
  await service.search("owner", "thread", "openmuse again");
  assert.deepEqual(tried, ["tvly-dev-live-9"]);
});

test("a configured searxng instance is used and bad rows are dropped", async () => {
  const service = new SearchService(
    searchConfig({ searchUrl: "http://127.0.0.1:8888/" }),
    noWorker,
    () => 9_000,
    (async (url: string) => {
      assert.match(String(url), /^http:\/\/127\.0\.0\.1:8888\/search\?q=.*format=json$/);
      return new Response(await fixture("searxng.json"), { status: 200 });
    }) as unknown as typeof fetch,
  );
  const outcome = await service.search("owner", "thread", "openmuse");
  assert.equal(outcome.backend, "searxng");
  assert.deepEqual(
    outcome.results.map((item) => item.url),
    ["https://github.com/CopilotKit/openmuse", "https://example.org/docs"],
  );
});

test("decoys are rejected instead of answered, and the error explains why", async () => {
  const service = new SearchService(
    searchConfig(),
    noWorker,
    () => 1,
    (async () => new Response(bingHtml, { status: 200 })) as unknown as typeof fetch,
  );
  await assert.rejects(
    service.search("owner", "thread", "CopilotKit OpenMuse personal agent"),
    /无关|诱饵/,
  );
});

test("when every backend fails the error names the fix", async () => {
  const service = new SearchService(
    searchConfig(),
    noWorker,
    () => 1,
    (async () => new Response("blocked", { status: 403 })) as unknown as typeof fetch,
  );
  await assert.rejects(service.search("owner", "thread", "anything"), /搜索暂时不可用.*SEARCH_URL/);
});

test("反爬/验证页识别：拦下真实出现过的拦截页，不误伤正文", () => {
  // 线上实测抓到的拦截页
  assert.equal(looksBlocked("Security | Glassdoor", "Help Us Protect Glassdoor Glassdoor uses advanced security systems to keep our site safe and prevent misuse"), true);
  assert.equal(looksBlocked("Reddit - Prove your humanity", "Prove your humanity We're committed to safety and security. But not for bots."), true);
  assert.equal(looksBlocked("", "You've been blocked by network security. To continue, log in to your Reddit account"), true);
  assert.equal(looksBlocked("Just a moment...", "Enable JavaScript and cookies to continue"), true);
  assert.equal(looksBlocked("", "请稍候，正在验证您的浏览器"), true);

  // 正常正文不能被误伤
  assert.equal(
    looksBlocked(
      "Associated Press News: Breaking News, Latest Headlines and Videos | AP News",
      "WASHINGTON (AP) — The Senate passed a security funding package on Tuesday after weeks of negotiation between both parties.",
    ),
    false,
  );
  assert.equal(
    looksBlocked("Retrieval-augmented generation - Wikipedia", "RAG combines an information retrieval component with a text generator model to reduce hallucinations."),
    false,
  );
});
