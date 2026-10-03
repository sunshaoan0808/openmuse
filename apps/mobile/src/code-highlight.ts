/**
 * 轻量代码高亮（纯函数，可单测）——对标 Muse 的 HatchCodeBlockKt。
 *
 * 为什么不引语法高亮库：移动端只要"关键字/字符串/注释/数字"四色 + 语言标签就够读，
 * 引 prism/shiki 换来几 MB 依赖与构建复杂度不值当。规则刻意保守：识别不了的
 * 一律 plain，宁可不上色也不能把代码改坏——token 拼回原样必须等于输入（round-trip）。
 *
 * 注释前缀按语言家族判定：# 只在 py/sh/yaml 等家族当注释（CSS 的 #fff 不是注释），
 * JSON 干脆没有注释。未标注语言时宽松处理（// /* # 都算）——贴进来的多是脚本。
 */

export type CodeTokenKind = "plain" | "keyword" | "string" | "comment" | "number";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

const KEYWORDS = new Set([
  // js / ts
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "break", "continue", "new", "class", "extends", "super", "this", "import", "export",
  "from", "default", "try", "catch", "finally", "throw", "typeof", "instanceof", "async",
  "await", "yield", "delete", "void", "in", "of", "null", "undefined", "true", "false",
  "static", "get", "set", "interface", "type", "enum", "implements", "public", "private",
  "protected", "readonly", "namespace", "declare", "as", "satisfies",
  // python
  "def", "lambda", "self", "None", "True", "False", "and", "or", "not", "with", "pass",
  "elif", "raise", "except", "print", "global", "nonlocal", "del", "is",
  // go
  "func", "package", "chan", "go", "defer", "select", "map", "struct", "range", "nil",
  // rust
  "fn", "mut", "pub", "use", "mod", "impl", "trait", "match", "loop", "crate", "where", "dyn",
  // java / kotlin
  "fun", "val", "object", "companion", "data", "sealed", "when", "final", "abstract",
  // c / c++
  "int", "float", "double", "char", "bool", "struct", "union", "typedef", "sizeof",
  "include", "using", "template", "typename",
  // sql（大小写折叠后比对）
  "select", "insert", "into", "update", "delete", "join", "left", "right", "inner", "outer",
  "group", "order", "limit", "values", "where", "table",
]);

/** 语言 → 行注释前缀（块注释一律按「斜杠星号」识别）。 */
function commentStarts(lang: string): string[] {
  const l = lang.toLowerCase();
  if (/(py|python|sh|bash|zsh|yaml|yml|toml|ini|conf|env|rb|ruby|dockerfile|makefile)/.test(l))
    return ["#"];
  if (/css|scss|less/.test(l)) return [];
  if (/sql/.test(l)) return ["--"];
  if (/json|jsonl/.test(l)) return [];
  return ["//", "#"];
}

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*/;
const NUMBER = /^\d[\d._a-fxA-FX]*/;

/** 把代码切成带颜色的 token；token 拼回原样恒等于输入。 */
export function highlightCode(code: string, lang = ""): CodeToken[] {
  const lineComments = commentStarts(lang);
  const tokens: CodeToken[] = [];
  let plain = "";
  const flush = () => {
    if (plain) {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };
  let i = 0;
  const n = code.length;
  while (i < n) {
    const rest = code.slice(i);
    // 块注释 /* … */
    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      flush();
      tokens.push({ text: code.slice(i, stop), kind: "comment" });
      i = stop;
      continue;
    }
    // 行注释
    const line = lineComments.find((prefix) => rest.startsWith(prefix));
    if (line) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      flush();
      tokens.push({ text: code.slice(i, stop), kind: "comment" });
      i = stop;
      continue;
    }
    const ch = code[i];
    // 字符串：'…' "…" `…`（带转义；行内引号未闭合就到行尾为止，反引号可跨行）
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === ch) {
          j += 1;
          break;
        }
        if (code[j] === "\n" && ch !== "`") break;
        j += 1;
      }
      flush();
      tokens.push({ text: code.slice(i, j), kind: "string" });
      i = j;
      continue;
    }
    // 数字（前面不是标识符字符，避免吃掉变量名里的片段）
    if (/[0-9]/.test(ch) && !IDENTIFIER_START.test(code[i - 1] ?? "")) {
      const matched = NUMBER.exec(rest);
      if (matched) {
        flush();
        tokens.push({ text: matched[0], kind: "number" });
        i += matched[0].length;
        continue;
      }
    }
    // 标识符 / 关键字
    if (IDENTIFIER_START.test(ch)) {
      const matched = IDENTIFIER.exec(rest)!;
      const word = matched[0];
      if (KEYWORDS.has(word) || KEYWORDS.has(word.toLowerCase())) {
        flush();
        tokens.push({ text: word, kind: "keyword" });
      } else {
        plain += word;
      }
      i += word.length;
      continue;
    }
    plain += ch;
    i += 1;
  }
  flush();
  return tokens;
}

/** fence 信息串里的语言名（"ts title=x" → "ts"；空 → 不显示标签）。 */
export function codeLanguageOf(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}
