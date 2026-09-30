import * as FileSystem from "expo-file-system/legacy";
import mammothSource from "./office-vendor/mammoth-source";
import xlsxSource from "./office-vendor/xlsx-source";

/**
 * Office 文档预览：把 docx / xlsx 的解析脚本内联进 WebView 的 HTML，完全离线渲染，
 * 不依赖 CDN（应用在 Android 上可能连不上外网）。渲染脚本由
 * scripts/build-office-vendor.mjs 从 npm 包（mammoth / xlsx）的浏览器版构建生成。
 *
 * pptx 目前没有可靠的离线渲染方案（pptx-preview 的浏览器构建会向 WebView 里
 * 不存在的 Node 内置模块（stream/buffer/util）要依赖），所以只提示用户下载后用
 * 外部应用打开，见 OfficeReader。
 */
export type OfficeKind = "docx" | "xlsx" | "pptx";

export const officeKindLabels: Record<OfficeKind, string> = {
  docx: "Word 文档",
  xlsx: "Excel 表格",
  pptx: "PowerPoint 演示文稿",
};

/** 能离线渲染的类型（pptx 只能降级为“用外部应用打开”）。 */
export function isRenderable(kind: OfficeKind) {
  return kind === "docx" || kind === "xlsx";
}

/** 按文件名后缀判断预览类型；不在名单里的返回 undefined（例如 pdf 或老式 .doc）。 */
export function officeKindOf(name: string): OfficeKind | undefined {
  const match = /\.([a-z0-9]+)$/.exec(name.trim().toLowerCase());
  const extension = match?.[1] ?? "";
  if (extension === "docx" || extension === "docm") return "docx";
  if (extension === "xlsx" || extension === "xlsm" || extension === "xls") return "xlsx";
  if (extension === "pptx" || extension === "pptm") return "pptx";
  return undefined;
}

/** 文件名后缀，用于下载到本地时给外部应用识别格式。 */
export function officeExtension(name: string) {
  return name.trim().toLowerCase().replace(/^.*\./, "").slice(0, 8) || "bin";
}

/**
 * 内联脚本时必须掐掉 `</script`，否则 HTML 解析会提前结束 script 元素。
 * 两个渲染脚本里没有 `<script`（生成脚本会检查），所以不必额外处理 `<!--`。
 */
function inlineScript(code: string) {
  return code.replace(/<\/(script)/gi, "<\\/$1");
}

const styles = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 16px 16px 32px;
    background: #FFFFFF;
    color: #11191C;
    font-family: -apple-system, "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 16px;
    line-height: 1.7;
    -webkit-text-size-adjust: 100%;
  }
  h1, h2, h3, h4 { line-height: 1.35; margin: 18px 0 8px; }
  p { margin: 10px 0; }
  img { max-width: 100%; height: auto; }
  a { color: #1473C8; }
  table { border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #E5E7EB; padding: 6px 10px; font-size: 14px; vertical-align: top; }
  .status { color: #697176; font-size: 14px; }
  .error { color: #AA4A45; font-size: 14px; }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: #FFFFFF;
    padding: 6px 0 10px;
    border-bottom: 1px solid #EEEEF0;
  }
  .tab {
    border: 1px solid #EEF0F2;
    background: #F6F7F8;
    border-radius: 999px;
    padding: 5px 13px;
    font-size: 13px;
    color: #11191C;
  }
  .tab.on { background: #C8E7FF; border-color: #C8E7FF; font-weight: 600; }
`;

const prelude = `
  var app = document.getElementById("app");
  function post(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  function fail(message) {
    app.innerHTML = '<div class="error">' + message + "</div>";
    post({ type: "error", message: message });
  }
  function fileBytes() {
    var binary = atob(window.__OPENMUSE_FILE__ || "");
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
`;

// docx：mammoth 把 OOXML 转成 HTML，图片会以 data URI 内联，同样不联网。
const docxBootstrap = `
  try {
    mammoth.convertToHtml({ arrayBuffer: fileBytes().buffer }).then(function (result) {
      app.innerHTML = result.value || '<div class="status">这个文档没有可显示的正文。</div>';
      post({ type: "done" });
    }).catch(function (error) {
      fail("无法解析这个 Word 文档：" + (error && error.message ? error.message : error));
    });
  } catch (error) {
    fail("无法读取这个文档：" + error);
  }
`;

// xlsx：SheetJS 每个工作表转一张 HTML 表格，多表时给一排切换标签。
const xlsxBootstrap = `
  try {
    var workbook = XLSX.read(window.__OPENMUSE_FILE__, { type: "base64" });
    renderSheet(0);
    post({ type: "done" });
    function renderSheet(index) {
      var names = workbook.SheetNames || [];
      app.innerHTML = "";
      if (names.length > 1) {
        var bar = document.createElement("div");
        bar.className = "tabs";
        names.forEach(function (name, position) {
          var tab = document.createElement("span");
          tab.className = "tab" + (position === index ? " on" : "");
          tab.textContent = name;
          tab.onclick = function () { renderSheet(position); };
          bar.appendChild(tab);
        });
        app.appendChild(bar);
      }
      var holder = document.createElement("div");
      holder.innerHTML = XLSX.utils.sheet_to_html(workbook.Sheets[names[index] || ""], {
        id: "openmuse-sheet-" + index,
      });
      app.appendChild(holder);
    }
  } catch (error) {
    fail("无法解析这个 Excel 文件：" + error);
  }
`;

/** 拼出交给 WebView 的完整 HTML（含内联的渲染脚本与 base64 文件内容）。 */
export function officeHtml({
  kind,
  base64,
  name,
}: {
  kind: OfficeKind;
  base64: string;
  name: string;
}) {
  const vendor = kind === "docx" ? mammothSource : xlsxSource;
  const bootstrap = kind === "docx" ? docxBootstrap : xlsxBootstrap;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
<title>${escapeHtml(name)}</title>
<style>${styles}</style>
</head>
<body>
<div id="app"><div class="status">正在解析…</div></div>
<script>window.__OPENMUSE_FILE__ = ${JSON.stringify(base64)};</script>
<script>${inlineScript(vendor)}</script>
<script>${prelude}${bootstrap}</script>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    return "&quot;";
  });
}

/** 下载文件内容并读成 base64（WebView 里用 atob 还原）。 */
export async function downloadAsBase64({
  url,
  token,
  extension,
}: {
  url: string;
  token: string;
  extension: string;
}) {
  const cached = recall(url);
  if (cached !== undefined) return cached;
  const directory = `${FileSystem.cacheDirectory}openmuse-office/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => {});
  const target = `${directory}${Date.now()}-${extension}`;
  const download = await FileSystem.downloadAsync(url, target, {
    headers: { Authorization: `Bearer ${token}` },
  });
  try {
    if (download.status < 200 || download.status >= 300)
      throw new Error(`下载失败（HTTP ${download.status}）。`);
    const info = await FileSystem.getInfoAsync(download.uri);
    if (info.exists && info.size > MAX_INLINE_BYTES)
      throw new Error(
        `文件有 ${Math.round(info.size / 1024 / 1024)} MB，超过应用内预览上限 ${MAX_INLINE_BYTES / 1024 / 1024} MB。请下载后用外部应用打开。`,
      );
    const base64 = await FileSystem.readAsStringAsync(download.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    remember(url, base64);
    return base64;
  } finally {
    void FileSystem.deleteAsync(download.uri, { idempotent: true }).catch(() => {});
  }
}

/** 内联进 WebView 的上限：base64 之后约 1.34 倍，再大页面会明显卡顿甚至内存不足。 */
export const MAX_INLINE_BYTES = 12 * 1024 * 1024;

/**
 * 已经下载过的文件内容（签名的内容 URL → base64），最多留 6 份。
 * 同一个文件反复打开、或在几个文件之间来回切换时不再重新下载。
 */
const CACHE_LIMIT = 6;
const downloaded = new Map<string, string>();

function recall(url: string) {
  const hit = downloaded.get(url);
  if (hit === undefined) return undefined;
  // 命中后挪到队尾，保证淘汰的是最久没用的
  downloaded.delete(url);
  downloaded.set(url, hit);
  return hit;
}

function remember(url: string, base64: string) {
  downloaded.set(url, base64);
  while (downloaded.size > CACHE_LIMIT) {
    const oldest = downloaded.keys().next().value;
    if (oldest === undefined) break;
    downloaded.delete(oldest);
  }
}

/** 测试/手动清理用。 */
export function clearPreviewCache() {
  downloaded.clear();
}

/** 文件名去掉路径与非法字符，下载到缓存目录时用。 */
export function safeLocalName(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\p{Cc}/gu, "_")
      .slice(0, 120) || "document"
  );
}
