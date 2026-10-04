/**
 * 链接预览的**纯逻辑**（对标 Muse 的 `HatchLinkPreviewKt$findPreviewableUrlRanges`
 * 与 `HatchMessageLinkPreviewKt`）：找出可预览的 URL、从 HTML 抽标题/描述、拦内网地址。
 *
 * 服务端与客户端共用同一份 —— 免得"客户端认得的链接服务端不认"。
 */

/** 尾部的标点不算链接的一部分（中文句读尤其常见："看这个 https://x.com/a。"）。 */
const TRAILING_PUNCTUATION = /[.,;:!?、。，；：！？）)】」』"'”’]+$/;

/** 从一段文本里找**第一条**可预览的 http(s) 链接。找不到返回 undefined。 */
export function previewableUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s<>()"'，。；！？【】（）]+/i.exec(text ?? "");
  if (!match) return undefined;
  return match[0].replace(TRAILING_PUNCTUATION, "") || undefined;
}

/** 卡片上显示的主机名（去掉 www.）。 */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 内网 / 本机地址一律不许抓。
 *
 * 这个能力会替用户去访问**任意** URL：不拦就等于把自己的服务端白送成一个 SSRF 跳板
 * （打云元数据、打内网面板）。宁可少预览几个站点。
 */
export function isPrivateHost(host: string): boolean {
  const name = (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!name) return true;
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  if (name === "::1" || name.startsWith("fe80:") || name.startsWith("fc") || name.startsWith("fd"))
    return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function tidy(value?: string): string | undefined {
  const text = decodeEntities((value ?? "").replace(/\s+/g, " ").trim());
  return text ? text.slice(0, 300) : undefined;
}

/**
 * 从 HTML 里抽标题与描述（og: 优先，其次 <title> / name=description）。
 * 只做正则抽取：不引 HTML 解析依赖，也**不执行**页面里的任何脚本。
 */
export function metaFromHtml(html: string): { title?: string; description?: string } {
  const source = (html ?? "").slice(0, 200_000);
  const metaOf = (key: string) =>
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i").exec(
      source,
    )?.[1];
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(source)?.[1];
  return {
    title: tidy(metaOf("og:title") ?? titleTag),
    description: tidy(metaOf("og:description") ?? metaOf("description")),
  };
}
