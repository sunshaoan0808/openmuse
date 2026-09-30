import type { BrowserService } from "./browser.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

/**
 * 网页搜索与正文阅读。
 *
 * 为什么不是"让模型自己打开搜索引擎"：实测（同一台机器）
 * `html.duckduckgo.com/html` 与 `lite.duckduckgo.com` 都是 HTTP 403，
 * `bing.com/search` 能出内容但链接被包成 `bing.com/ck/a?...u=a1<base64>`，
 * 用 innerText 拿到的 URL 是残缺的——所以要把 SERP 解析成结构化结果，
 * 再把正文抓下来。检索走浏览器（真实出口），正文走纯 HTTP（快且可并发）。
 */
export type SearchEngine = "bing" | "brave" | "duckduckgo";

export interface SerpResult {
  title: string;
  url: string;
  snippet: string;
}
export interface PageRead {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  error?: string;
}
export interface SearchOutcome {
  query: string;
  backend: string;
  results: SerpResult[];
  pages: PageRead[];
}
export interface SearchOptions {
  count?: number;
  read?: number;
  signal?: AbortSignal;
}

const ENGINE_URLS: Record<SearchEngine, (query: string) => string> = {
  bing: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
};
/**
 * 实测（机房 IP，同一小时内的多次采样）：
 * - duckduckgo：桌面 UA + 纯 HTTP 可用（10 条、相关度 1.00）；无头浏览器反而 403。
 * - brave：真浏览器可用，但频繁 429（探测密度高时直接人机验证）。
 * - bing：结构总能解析，但常返回"诱饵 SERP"（问 OpenMuse 给枕头商品/Google Drive 登录页）。
 * 顺序按实测可用性排，且每个引擎都会过相关性护栏。
 */
const DEFAULT_ENGINES: SearchEngine[] = ["duckduckgo", "brave", "bing"];
const SERP_TTL = 10 * 60 * 1000;
const PAGE_TTL = 30 * 60 * 1000;
const PAGE_LIMIT = 8_000;
const MAX_PAGE_BYTES = 3_000_000;
const CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, name: string) => {
    if (ENTITIES[name]) return ENTITIES[name];
    if (/^#x/i.test(name)) return String.fromCodePoint(Number.parseInt(name.slice(2), 16) || 32);
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10) || 32);
    return match;
  });
}

/** HTML → 纯文本：脚本样式先删，标签变空格，实体还原，空白压缩。 */
export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function base64Url(value: string): string {
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** 把跳转链接还原成目标 URL（Bing 的 ck/a、DDG 的 l/?uddg=）。 */
export function decodeRedirect(href: string): string {
  const bing = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(href);
  if (bing) {
    const target = base64Url(bing[1]);
    if (/^https?:\/\//.test(target)) return target;
  }
  const ddg = /[?&]uddg=([^&]+)/.exec(href);
  if (ddg) {
    try {
      const target = decodeURIComponent(ddg[1]);
      if (/^https?:\/\//.test(target)) return target;
    } catch {
      // 保留原链接
    }
  }
  if (href.startsWith("//")) return `https:${href}`;
  return href;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isResultUrl(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  const host = hostOf(url);
  if (!host || /^(www\.)?(bing|brave|duckduckgo|google|microsoft|w3|schema)\./.test(host))
    return false;
  return !/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?)$/i.test(new URL(url).pathname);
}

function dedupe(results: SerpResult[], limit: number): SerpResult[] {
  const seen = new Set<string>();
  const out: SerpResult[] = [];
  for (const item of results) {
    const key = item.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function parseBing(html: string, limit: number): SerpResult[] {
  const out: SerpResult[] = [];
  for (const block of html.split(/class="b_algo"/).slice(1)) {
    const heading = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!heading) continue;
    const url = decodeRedirect(decodeEntities(heading[1]));
    const title = stripTags(heading[2]);
    if (!title || !isResultUrl(url)) continue;
    const snippet = stripTags(block.slice(heading.index + heading[0].length)).slice(0, 400);
    out.push({ title: title.slice(0, 200), url, snippet });
  }
  return dedupe(out, limit);
}

function parseBrave(html: string, limit: number): SerpResult[] {
  const out: SerpResult[] = [];
  // 真的结果块：<div class="snippet ..." data-pos="0" data-type="web"> 里
  // 第一个 <a href> 是结果链接，标题在 <div class="title ...">，摘要在 generic-snippet。
  for (const block of html.split(/<div class="snippet[\s"]/).slice(1)) {
    if (!/data-type="web"/.test(block.slice(0, 400)) && !/<div class="title/.test(block)) continue;
    const anchor = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/.exec(block);
    if (!anchor) continue;
    const url = decodeRedirect(decodeEntities(anchor[1]));
    if (!isResultUrl(url)) continue;
    const heading = /<div class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const title = stripTags(heading?.[1] ?? "").slice(0, 200);
    if (title.length < 4) continue;
    const rest = block.slice(anchor.index + anchor[0].length);
    const description = /<div class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(rest);
    const snippet = stripTags(description?.[1] ?? rest).slice(0, 400);
    out.push({ title, url, snippet });
  }
  return dedupe(out, limit);
}

function parseDuckDuckGo(html: string, limit: number): SerpResult[] {
  const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g)];
  const out: SerpResult[] = [];
  links.forEach((link, index) => {
    const url = decodeRedirect(decodeEntities(link[1]));
    const title = stripTags(link[2]);
    if (!title || !isResultUrl(url)) return;
    out.push({
      title: title.slice(0, 200),
      url,
      snippet: snippets[index] ? stripTags(snippets[index][1]).slice(0, 400) : "",
    });
  });
  return dedupe(out, limit);
}

/** 通用兜底：抓页面上正文长度像标题的站外链接（引擎改版时不至于全瞎）。 */
export function genericResults(html: string, limit: number): SerpResult[] {
  const out: SerpResult[] = [];
  for (const match of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = decodeRedirect(decodeEntities(match[1]));
    const title = stripTags(match[2]);
    if (title.length < 12 || title.length > 200 || !isResultUrl(url)) continue;
    out.push({ title: title.slice(0, 200), url, snippet: "" });
  }
  return dedupe(out, limit);
}

function queryTokens(query: string): string[] {
  const latin = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const cjk = query.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...new Set([...latin, ...cjk])];
}

/** 结果与查询的相关度 0..1：反爬诱饵（例如 bing 喂无关 SERP）会被判低。 */
export function relevanceScore(query: string, results: SerpResult[]): number {
  const tokens = queryTokens(query);
  if (!tokens.length) return 1;
  const haystack = results
    .map((item) => `${item.title} ${item.snippet} ${item.url}`)
    .join(" ")
    .toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length;
}

/** 只留与查询有交集的条目；全都无关就返回空（宁可换后端也不给错答案）。 */
export function filterRelevant(query: string, results: SerpResult[]): SerpResult[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return results;
  return results.filter((item) => {
    const haystack = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

const RELEVANCE_FLOOR = 0.34;
/** 被封/超额 key 的冷却时长（30 分钟）。 */
const KEY_COOLDOWN = 30 * 60 * 1000;
/** 单次搜索最多试几把 key：几百把的池子不能一次全撞一遍。 */
const MAX_KEY_ATTEMPTS = 6;

/** SERP HTML → 结构化结果（纯函数，固件驱动单测）。 */
export function parseSerp(html: string, engine: SearchEngine, limit = 10): SerpResult[] {
  const parsed =
    engine === "bing"
      ? parseBing(html, limit)
      : engine === "brave"
        ? parseBrave(html, limit)
        : parseDuckDuckGo(html, limit);
  return parsed.length >= 3 ? parsed : dedupe([...parsed, ...genericResults(html, limit)], limit);
}

/** 正文抽取：优先 article/main，太短再退回整页。 */
export function extractArticleText(
  html: string,
  limit = PAGE_LIMIT,
): { text: string; truncated: boolean } {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const pick = (tag: string) =>
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(cleaned)?.[1];
  // 有 article/main 就用它（哪怕短），没有才退回整页
  const scoped = pick("article") ?? pick("main");
  const text = stripTags(scoped ?? cleaned);
  const truncated = text.length > limit;
  return { text: text.slice(0, limit), truncated };
}

function titleOf(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? stripTags(match[1]).slice(0, 200) : "";
}

/**
 * 反爬/验证页识别。实测过的形态：Glassdoor「Help Us Protect Glassdoor / Security | Glassdoor」、
 * Reddit「Prove your humanity」「You've been blocked by network security」、Cloudflare「Just a moment」。
 * 这类页面有几千字符，光看长度会当成正文——必须显式拦掉，否则模型会拿安全提示页当文章引用。
 */
const BLOCK_PATTERNS: RegExp[] = [
  /just a moment|checking your browser|enable javascript and cookies/i,
  /attention required|cf-error|cloudflare ray id/i,
  /prove your (humanity|are human)|are you a robot|verify you are human|captcha/i,
  /you'?ve been blocked|blocked by network security|access denied|unusual traffic/i,
  /help us protect|security \| glassdoor|protect .{0,20}from misuse/i,
  /请稍候|正在验证|人机验证|访问被拒绝/i,
];
export function looksBlocked(title: string, text: string) {
  const sample = `${title}\n${text.slice(0, 600)}`;
  return BLOCK_PATTERNS.some((pattern) => pattern.test(sample));
}

function isThin(page: { text: string; error?: string }): boolean {
  return Boolean(page.error) || page.text.length < 400;
}

/** 上游报错时把状态码和一小段响应带出来（key 不进消息）。 */
async function providerError(response: Response): Promise<string> {
  const detail = await response.text().catch(() => "");
  const trimmed = detail.replace(/\s+/g, " ").slice(0, 160);
  return trimmed ? `HTTP ${response.status} ${trimmed}` : `HTTP ${response.status}`;
}

/** 是否含中日韩文字：用来判断"用户的语言"与"模型发出的查询语言"是否一致。 */
export function hasCjk(text: string) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

/**
 * 跨语言兜底：用户用中文提问、模型却把查询翻成英文时，同一次调用里再用**用户原话**搜一遍并合并结果。
 *
 * 为什么必须做在管道里而不是只写进提示词：翻译本身就等于替用户"选定了一种解读"——
 * 「金球奖」译成 Golden Globe Awards 就只剩影视那一支了，足球那一支在英文结果里根本不出现。
 * 按 URL 去重，保留模型查询的结果顺序在前，原话结果补在后面。
 */
export function mergeSearchResults(primary: SerpResult[], secondary: SerpResult[], limit: number) {
  const seen = new Set<string>();
  const key = (url: string) =>
    url
      .replace(/[#?].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  const take = (items: SerpResult[], max: number) => {
    const picked: SerpResult[] = [];
    for (const item of items) {
      if (picked.length >= max) break;
      const id = key(item.url);
      if (seen.has(id)) continue;
      seen.add(id);
      picked.push(item);
    }
    return picked;
  };
  // 给"另一支解读"预留位置：不预留的话，主查询结果先占满名额，第二种含义照样一条都进不了模型视野。
  const half = Math.max(1, Math.ceil(limit / 2));
  const first = take(primary, half);
  const second = take(secondary, limit - first.length);
  const fill = take(primary, limit - first.length - second.length);
  return [...first, ...fill, ...second].slice(0, limit);
}

export class SearchService {
  private readonly serpCache = new Map<
    string,
    { at: number; backend: string; results: SerpResult[] }
  >();
  private readonly pageCache = new Map<string, { at: number; page: PageRead }>();
  /** 成功过的 key 排前面（几百把的池子里，先撞已知好用的）。 */
  private keyOrder: string[] = [];
  /** 被封/超额/限流的 key 进冷却，别让每次搜索都把它们再撞一遍（10 把全废时尤其重要）。 */
  private readonly keyCooldown = new Map<string, number>();

  constructor(
    private readonly config: Config,
    private readonly browser: BrowserService,
    private readonly now: () => number = () => Date.now(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(
    owner: string,
    threadId: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchOutcome> {
    const clean = query.trim();
    if (!clean) throw new AppError("请输入要搜索的内容", 400);
    const { results, backend } = await this.serp(owner, threadId, clean, options.signal);
    const count = Math.min(Math.max(options.count ?? 6, 1), 10);
    const read = Math.min(Math.max(options.read ?? 0, 0), 4);
    const trimmed = results.slice(0, count);
    const pages = read
      ? await this.readPages(
          trimmed.slice(0, read).map((item) => item.url),
          { owner, threadId, signal: options.signal },
        )
      : [];
    return { query: clean, backend, results: trimmed, pages };
  }

  /** 先查缓存，再按"配置的 key/自建服务 → 浏览器抓 SERP → 纯 HTTP 抓 SERP"依次试。 */
  private async serp(owner: string, threadId: string, query: string, signal?: AbortSignal) {
    const cached = this.serpCache.get(query);
    if (cached && this.now() - cached.at < SERP_TTL)
      return { results: cached.results, backend: `${cached.backend}(缓存)` };
    const failures: string[] = [];
    for (const backend of this.backends()) {
      try {
        const results = await backend.run(owner, threadId, query, signal);
        if (!results.length) continue;
        this.remember(this.serpCache, query, { at: this.now(), backend: backend.name, results });
        return { results, backend: backend.name };
      } catch (error) {
        failures.push(`${backend.name}: ${error instanceof Error ? error.message : "失败"}`);
      }
    }
    throw new AppError(
      `搜索暂时不可用（${failures.join("；")}）。配置 SEARCH_URL 或 SEARCH_API_KEY 会更稳。`,
      503,
    );
  }

  private backends() {
    const list: {
      name: string;
      run: (
        owner: string,
        threadId: string,
        query: string,
        signal?: AbortSignal,
      ) => Promise<SerpResult[]>;
    }[] = [];
    if (this.config.searchUrl)
      list.push({
        name: "searxng",
        run: (_owner, _threadId, query, signal) => this.searxng(query, signal),
      });
    if (this.config.searchApiKeys?.length)
      list.push({
        name: this.config.searchProvider ?? "api",
        run: (_owner, _threadId, query, signal) => this.keyed(query, signal),
      });
    // 纯 HTTP 更便宜（实测 DDG 桌面 UA 就好用），先试；被护栏拦下再用浏览器补
    list.push({
      name: "http-serp",
      run: (_owner, _threadId, query, signal) => this.httpSerp(query, signal),
    });
    list.push({
      name: "browser-serp",
      run: (owner, threadId, query, signal) => this.browserSerp(owner, threadId, query, signal),
    });
    return list;
  }

  /**
   * 逐个引擎试：抓 HTML → 解析 → 相关性护栏。
   * 护栏是关键：机房 IP 上 bing 会返回一份"诱饵 SERP"（问 OpenMuse 给出一堆枕头商品），
   * 结构完全正常但内容无关——不加护栏就会自信地答错。
   */
  private async tryEngines(
    query: string,
    getHtml: (engine: SearchEngine, signal?: AbortSignal) => Promise<string>,
    signal?: AbortSignal,
  ): Promise<SerpResult[]> {
    const errors: string[] = [];
    for (const engine of DEFAULT_ENGINES) {
      try {
        const html = await getHtml(engine, signal);
        const parsed = parseSerp(html, engine);
        if (!parsed.length) {
          errors.push(`${engine} 无结果`);
          continue;
        }
        const score = relevanceScore(query, parsed);
        const relevant = filterRelevant(query, parsed);
        if (!relevant.length || score < RELEVANCE_FLOOR) {
          errors.push(`${engine} 返回与查询无关的结果（疑似反爬诱饵，相关度 ${score.toFixed(2)}）`);
          continue;
        }
        return relevant;
      } catch (error) {
        errors.push(`${engine}: ${error instanceof Error ? error.message : "失败"}`);
      }
    }
    throw new Error(errors.join("；"));
  }

  private async browserSerp(
    owner: string,
    threadId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<SerpResult[]> {
    if (!this.config.workerUrl || !this.config.workerToken) throw new Error("浏览器工作进程未配置");
    return this.tryEngines(
      query,
      async (engine, inner) =>
        (await this.browser.htmlForThread(owner, threadId, ENGINE_URLS[engine](query), inner)).html,
      signal,
    );
  }

  private async httpSerp(query: string, signal?: AbortSignal): Promise<SerpResult[]> {
    return this.tryEngines(
      query,
      (engine, inner) => this.fetchText(ENGINE_URLS[engine](query), inner, 800_000),
      signal,
    );
  }

  private async searxng(query: string, signal?: AbortSignal): Promise<SerpResult[]> {
    const base = (this.config.searchUrl ?? "").replace(/\/$/, "");
    const raw = await this.fetchText(
      `${base}/search?q=${encodeURIComponent(query)}&format=json`,
      signal,
      400_000,
    );
    const data = JSON.parse(raw) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return dedupe(
      (data.results ?? [])
        .filter((item) => typeof item.url === "string" && isResultUrl(item.url))
        .map((item) => ({
          title: (item.title ?? "").slice(0, 200),
          url: item.url as string,
          snippet: (item.content ?? "").replace(/\s+/g, " ").slice(0, 400),
        })),
      20,
    );
  }

  /**
   * 官方 API：多 key 轮换（key 被封/超额/限流时自动换下一个）。
   * 错误信息里只留后 6 位，不把整把 key 写进日志或回给前端。
   */
  private async keyed(query: string, signal?: AbortSignal): Promise<SerpResult[]> {
    const keys = this.config.searchApiKeys ?? [];
    if (!keys.length) throw new Error("搜索 API key 未配置");
    const provider = this.config.searchProvider ?? "brave";
    const errors: string[] = [];
    // 已知好用的排前面，冷却中的先跳过：几百把 key 的池子也能秒开
    const ordered = [
      ...this.keyOrder.filter((key) => keys.includes(key)),
      ...keys.filter((key) => !this.keyOrder.includes(key)),
    ];
    const pool = ordered.filter((key) => (this.keyCooldown.get(key) ?? 0) <= this.now());
    if (!pool.length)
      throw new Error(`${provider}: ${keys.length} 把 key 都在冷却中（被封或超额），已跳过`);
    for (const key of pool.slice(0, MAX_KEY_ATTEMPTS)) {
      try {
        const results = await this.callProvider(provider, key, query, signal);
        if (results.length) {
          this.keyOrder = [key, ...this.keyOrder.filter((item) => item !== key)];
          return results;
        }
        errors.push(`${provider} …${key.slice(-6)} 返回空结果`);
      } catch (error) {
        // 认证/配额类失败把 key 关进小黑屋；网络类失败不惩罚，下次还能用
        if (
          /HTTP (401|402|403|429)|banned|quota/i.test(error instanceof Error ? error.message : "")
        )
          this.keyCooldown.set(key, this.now() + KEY_COOLDOWN);
        errors.push(
          `${provider} …${key.slice(-6)}: ${error instanceof Error ? error.message : "失败"}`,
        );
      }
    }
    throw new Error(errors.join("；"));
  }

  private async callProvider(
    provider: "brave" | "tavily" | "serper" | "firecrawl",
    key: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<SerpResult[]> {
    const timeout = signal ?? AbortSignal.timeout(20_000);
    if (provider === "firecrawl") {
      const response = await this.fetchImpl("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 10 }),
        signal: timeout,
      });
      if (!response.ok) throw new Error(await providerError(response));
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: unknown;
      };
      if (payload.success === false) throw new Error(payload.error ?? "firecrawl 返回失败");
      // 新版本是 { data: { web: [...] } }，旧版本是 { data: [...] }，两种都接
      const nested = payload.data as { web?: unknown[] } | undefined;
      const rows = (Array.isArray(payload.data) ? payload.data : (nested?.web ?? [])) as Record<
        string,
        unknown
      >[];
      return dedupe(
        rows
          .map((row) => ({
            title: stripTags(String(row.title ?? "")).slice(0, 200),
            url: String(row.url ?? ""),
            snippet: stripTags(String(row.description ?? row.markdown ?? "")).slice(0, 400),
          }))
          .filter((item) => item.title.length > 2 && isResultUrl(item.url)),
        20,
      );
    }
    if (provider === "brave") {
      const response = await this.fetchImpl(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
        {
          headers: { Accept: "application/json", "X-Subscription-Token": key },
          signal: timeout,
        },
      );
      if (!response.ok) throw new Error(await providerError(response));
      const payload = (await response.json()) as {
        web?: { results?: { title?: string; url?: string; description?: string }[] };
      };
      return dedupe(
        (payload.web?.results ?? [])
          .map((item) => ({
            title: stripTags(item.title ?? "").slice(0, 200),
            url: String(item.url ?? ""),
            snippet: stripTags(item.description ?? "").slice(0, 400),
          }))
          .filter((item) => isResultUrl(item.url)),
        20,
      );
    }
    const endpoint =
      provider === "serper" ? "https://google.serper.dev/search" : "https://api.tavily.com/search";
    const body =
      provider === "serper"
        ? JSON.stringify({ q: query, num: 10 })
        : JSON.stringify({ api_key: key, query, max_results: 10 });
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
      body,
      signal: timeout,
    });
    if (!response.ok) throw new Error(await providerError(response));
    const payload = (await response.json()) as {
      organic?: Record<string, unknown>[];
      results?: Record<string, unknown>[];
    };
    const rows = (payload.organic ?? payload.results ?? []) as Record<string, unknown>[];
    return dedupe(
      rows
        .map((item) => ({
          title: stripTags(String(item.title ?? "")).slice(0, 200),
          url: String(item.link ?? item.url ?? ""),
          snippet: stripTags(String(item.snippet ?? item.content ?? "")).slice(0, 400),
        }))
        .filter((item) => isResultUrl(item.url)),
      20,
    );
  }

  /** 并发抓正文（纯 HTTP 快路径 + 浏览器兜底），单个失败不影响其它。 */
  async readPages(
    urls: string[],
    context: { owner?: string; threadId?: string; signal?: AbortSignal } = {},
  ): Promise<PageRead[]> {
    const unique = [...new Set(urls.map((url) => url.trim()))].filter(Boolean).slice(0, 6);
    const queue = [...unique];
    const collected = new Map<string, PageRead>();
    const worker = async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        collected.set(url, await this.readOne(url, context));
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(CONCURRENCY, unique.length)) }, () => worker()),
    );
    return unique.map(
      (url) =>
        collected.get(url) ?? { url, title: "", text: "", truncated: false, error: "未读取" },
    );
  }

  private async readOne(
    url: string,
    context: { owner?: string; threadId?: string; signal?: AbortSignal },
  ): Promise<PageRead> {
    const cached = this.pageCache.get(url);
    if (cached && this.now() - cached.at < PAGE_TTL) return cached.page;
    let page: PageRead;
    try {
      const html = await this.fetchText(url, context.signal, MAX_PAGE_BYTES);
      const { text, truncated } = extractArticleText(html);
      page = { url, title: titleOf(html), text, truncated };
    } catch (error) {
      page = {
        url,
        title: "",
        text: "",
        truncated: false,
        error: error instanceof Error ? error.message : "读取失败",
      };
    }
    if (
      isThin(page) &&
      this.config.workerUrl &&
      this.config.workerToken &&
      context.owner &&
      context.threadId
    ) {
      try {
        const captured = await this.browser.htmlForThread(
          context.owner,
          context.threadId,
          url,
          context.signal,
        );
        const { text, truncated } = extractArticleText(captured.html);
        if (text.length >= 200)
          page = {
            url: captured.url,
            title: captured.title || titleOf(captured.html),
            text,
            truncated,
          };
      } catch {
        // 纯 HTTP 已给出结果或错误，浏览器兜底失败就保持原样
      }
    }
    // 拦截页有正文长度，但内容不是文章：明确报错而不是把安全提示页喂给模型
    if (!page.error && page.text && looksBlocked(page.title, page.text))
      page = {
        url: page.url,
        title: page.title,
        text: "",
        truncated: false,
        error: `页面被反爬/验证页拦截（标题：${page.title.slice(0, 60) || "无"}），没有拿到正文`,
      };
    if (!page.error) this.remember(this.pageCache, url, { at: this.now(), page });
    return page;
  }

  private async fetchText(
    url: string,
    signal: AbortSignal | undefined,
    limit: number,
  ): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return text.slice(0, limit);
  }

  private remember<T>(
    cache: Map<string, { at: number } & T>,
    key: string,
    value: { at: number } & T,
  ) {
    cache.set(key, value);
    if (cache.size > 120) {
      const oldest = [...cache.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, cache.size - 120);
      for (const [stale] of oldest) cache.delete(stale);
    }
  }
}
