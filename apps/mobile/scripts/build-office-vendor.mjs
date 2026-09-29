// 生成 WebView 离线渲染 Office 文档所需的内联脚本模块。
//
// RN 的 WebView 里不能 require npm 模块，所以把浏览器版的 UMD 构建读成字符串，
// 生成 src/office-vendor/*.ts（`export default "<源码>"`），由 HtmlView 直接内联进 HTML。
// 这样不依赖任何 CDN，也不需要联网。
//
// 用法：pnpm --dir apps/mobile exec node scripts/build-office-vendor.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const outDir = join(appRoot, "src", "office-vendor");
mkdirSync(outDir, { recursive: true });

const targets = [
  {
    out: "mammoth-source.ts",
    pkg: "mammoth",
    files: ["node_modules/mammoth/mammoth.browser.min.js"],
    header: "mammoth（docx → HTML，浏览器版 UMD 构建，内联给 WebView 离线渲染用）",
  },
  {
    out: "xlsx-source.ts",
    pkg: "xlsx",
    files: ["node_modules/xlsx/dist/xlsx.full.min.js"],
    header: "SheetJS（xlsx → HTML 表格，浏览器版 UMD 构建，内联给 WebView 离线渲染用）",
  },
];

for (const target of targets) {
  const source = target.files.map((file) => join(appRoot, file)).find((file) => existsSync(file));
  if (!source) throw new Error(`${target.pkg} 的浏览器版构建不存在，请先 pnpm install`);
  const code = readFileSync(source, "utf8");
  // JSON.stringify 生成合法的 JS 字符串字面量；先确认没有会破坏 <script> 内联的片段。
  for (const risky of ["</script", "<script", "<!--"]) {
    const hits = code.split(risky).length - 1;
    if (hits > 0)
      console.warn(`警告：${target.out} 含有 ${hits} 处 "${risky}"，内联时需要额外转义。`);
  }
  const banner = [
    "// 本文件由 scripts/build-office-vendor.mjs 自动生成，请勿手工修改。",
    `// 来源：${target.pkg}（${source.slice(appRoot.length + 1)}）。`,
    `// 用途：${target.header}`,
    "",
  ].join("\n");
  writeFileSync(join(outDir, target.out), `${banner}export default ${JSON.stringify(code)};\n`);
  console.log(`已生成 ${target.out}（${code.length} 字符）`);
}
