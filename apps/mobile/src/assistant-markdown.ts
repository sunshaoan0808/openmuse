import MarkdownIt from "markdown-it";

export const assistantMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

export function isSafeAssistantUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

/**
 * 渲染前的文本清洗（只动显示，不改模型输出、不进存档）。
 *
 * 实测小模型会抖出这些形态：书名号里多一个星号（`《The Brutalist*）`）、同一个片名括号里再写一遍
 * （`《X》（《X》）`）、书名号只开不闭（`《The Pitt`）。这类是抄写抖动，不该让你在看回复时被干扰。
 * 规则刻意收窄：只在《》/「」/引号内部动手，且只在能明确判断是抖动时改，宁可不改也不猜。
 */
export function tidyAssistantText(text: string): string {
  if (!text) return text;

  // 1. 先修配对：只开不闭的就在它该结束的地方补上闭合（右括号/顿号/句号之前，而不是整行末尾），
  //    只闭不开的直接丢掉。必须放在"去符号"之前：`《The Brutalist*）` 这种只开不闭的片段，
  //    配对修好后才能被下面的规则处理。
  let out = text
    .split("\n")
    .map((line) => {
      let depth = 0;
      let fixed = "";
      for (const ch of line) {
        if (ch === "》") {
          if (depth === 0) continue; // 没有对应的开括号 → 多余，丢掉
          depth -= 1;
          fixed += ch;
          continue;
        }
        // 结束符号要先补闭合、再写这个字符，否则会变成 `）》` 而不是 `》）`
        if (depth > 0 && /[）)，。、；：！？!?]/.test(ch)) {
          fixed += "》".repeat(depth);
          depth = 0;
        }
        if (ch === "《") depth += 1;
        fixed += ch;
      }
      if (depth > 0) fixed += "》".repeat(depth);
      return fixed;
    })
    .join("\n");

  // 2. 标题符号内部的强调符号一律去掉（书名号/直角引号里出现 * _ ~ ` 没有正当含义）
  out = out.replace(/《[^》\n]{0,120}》/g, (span) => span.replace(/[*_~`]/g, ""));
  out = out.replace(/「[^」\n]{0,120}」/g, (span) => span.replace(/[*_~`]/g, ""));

  // 3. 紧挨着的重复片名折叠成一个： 《X》（《X》） / 《X》《X》
  out = out.replace(/《([^》\n]{1,80})》\s*[（(]?\s*《\1》\s*[）)]?/g, "《$1》");

  return out;
}

/**
 * 助手正文里指向"我们自己的文件"的链接（/api/files/<id>…，可能带签名 query）。
 * 这类链接**不能在外部浏览器打开**：那是本机/内网地址，浏览器里也没有会话令牌，
 * 用户看到的就是"点了跳到浏览器，但打不开"。识别出来交回应用内的文件面板。
 */
export function fileIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/api\/files\/([0-9a-zA-Z_-]{6,80})(?:[/?#]|$)/);
  return match?.[1];
}
