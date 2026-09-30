import { z } from "zod";

/** search_web 的返回形状（服务端 apps/server/src/search.ts 的 SearchOutcome）。 */
export const searchOutcomeSchema = z.object({
  query: z.string().optional(),
  backend: z.string().optional(),
  error: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});

/** read_pages 的返回形状（PageRead[]）。 */
export const pageReadSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  text: z.string().optional(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
});

export interface SearchResultView {
  title: string;
  url: string;
  snippet: string;
}
export interface PageReadView {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  error?: string;
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** 工具结果 → 卡片要用的结果列表（兼容 search_web 与 read_pages 两种形状）。 */
export function readSearchOutcome(result: unknown): {
  query: string;
  failure: string;
  results: SearchResultView[];
  pages: PageReadView[];
} {
  const value = parse(result);
  const outcome = searchOutcomeSchema.safeParse(value);
  const asArray = z.array(pageReadSchema).safeParse(value);
  const nested = z.object({ pages: z.array(pageReadSchema).optional() }).safeParse(value);
  const rawPages = asArray.success ? asArray.data : (nested.data?.pages ?? []);
  const pages: PageReadView[] = rawPages.map((page) => ({
    url: page.url,
    title: page.title ?? "",
    text: page.text ?? "",
    truncated: page.truncated ?? false,
    ...(page.error ? { error: page.error } : {}),
  }));
  const results: SearchResultView[] = (outcome.success ? (outcome.data.results ?? []) : []).map(
    (item) => ({ title: item.title, url: item.url, snippet: item.snippet ?? "" }),
  );
  return {
    query: outcome.success ? (outcome.data.query ?? "") : "",
    failure: outcome.success ? (outcome.data.error ?? "") : "",
    results,
    pages,
  };
}

/** 只保留真读到正文的页面（错误或空文本的不当成"已读"）。 */
export function readPages(pages: PageReadView[]): PageReadView[] {
  return pages.filter((page) => !page.error && page.text.trim().length > 0);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
