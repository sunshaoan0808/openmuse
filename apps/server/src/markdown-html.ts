/**
 * 极简 Markdown → HTML，只为"导出 PDF / 在浏览器里渲染"服务。
 *
 * 为什么不装依赖：`markdown-it` 只在移动端（apps/mobile）里，pnpm 严格模式下服务端 import 不到；
 * 而这个用途只需要常见语法（标题、列表、粗斜体、行内代码、围栏代码、引用、链接、图片、表格的基础形），
 * 所以自己写一个小转换器，零依赖、可单测。
 *
 * 明确不做：脚注、数学公式、HTML 内联直通、复杂的嵌套语义 —— 导出用途够用，别越做越大。
 */

/** 先把 HTML 特殊字符转义：内容来自模型/用户，导出前必须当成纯文本处理 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 行内元素：代码 → 粗体 → 斜体 → 链接 → 图片（先转义，再按顺序替换） */
function inline(source: string): string {
  let out = escapeHtml(source);
  // 行内代码先抠出来占位，免得里面的 * _ 被当成强调符号
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" />');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(
    /\u0000(\d+)\u0000/g,
    (_match, index: string) => `<code>${codes[Number(index)]}</code>`,
  );
  return out;
}

/** 把 Markdown 转成 HTML 片段 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length) {
      html.push(`<p>${inline(buffer.join(" "))}</p>`);
      buffer.length = 0;
    }
  };
  const paragraph: string[] = [];

  while (index < lines.length) {
    const line = lines[index] ?? "";

    // 围栏代码块
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushParagraph(paragraph);
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // 跳过收尾的 ```
      const language = fence[1] ? ` class="language-${fence[1]}"` : "";
      html.push(`<pre><code${language}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph);
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    // 水平线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(paragraph);
      html.push("<hr />");
      index += 1;
      continue;
    }

    // 引用（连续多行合成一块）
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(paragraph);
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`);
      continue;
    }

    // 列表（有序/无序；支持一层缩进续行）
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushParagraph(paragraph);
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // 表格（| a | b | + 分隔行）
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? "")) {
      flushParagraph(paragraph);
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const head = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] ?? "")) {
        rows.push(cells(lines[index] ?? ""));
        index += 1;
      }
      html.push(
        `<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
      );
      continue;
    }

    // 空行：段落结束
    if (/^\s*$/.test(line)) {
      flushParagraph(paragraph);
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph(paragraph);
  return html.join("\n");
}

/**
 * 包成一个完整、手机可读的 HTML 文档（与 App 内的 HtmlReader 用同一套阅读样式）。
 * description 只用于分享预览（og:description），传纯文本即可，内部会转义。
 */
export function wrapHtmlDocument(
  title: string,
  body: string,
  description?: string,
  image?: string,
): string {
  const meta = [
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}" />` : "",
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${meta}
<style>
  html,body{margin:0;padding:18px;background:#ffffff;color:#132631;
            font:16px/1.7 -apple-system,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
            overflow-wrap:anywhere}
  h1{font-size:24px} h2{font-size:20px} h3{font-size:17px}
  h1,h2,h3{line-height:1.35;margin:22px 0 10px}
  p{margin:10px 0}
  ul,ol{padding-left:22px}
  li{margin:4px 0}
  img,video{max-width:100%}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th,td{border:1px solid #E3E6E8;padding:6px 8px;text-align:left}
  th{background:#F4F5F6}
  pre{overflow-x:auto;background:#F4F5F6;padding:12px;border-radius:8px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
  blockquote{margin:12px 0;padding:2px 0 2px 12px;border-left:3px solid #D7DBDE;color:#4B565C}
  a{color:#1473C8}
  img.cover{display:block;width:100%;max-height:320px;object-fit:cover;border-radius:12px;margin:0 0 18px}
  hr{border:0;border-top:1px solid #E3E6E8;margin:20px 0}
</style></head>
<body>${body}</body></html>`;
}
