/**
 * 文件动作的**纯逻辑**——对话里的文件卡（P0-1 的 chip）与文件详情页两处共用：
 * 一个文件"是什么"（判定）与"分享出去该叫什么"（扩展名 / MIME / UTI）。
 * 零依赖、node 直接单测；异步动作（系统分享/发布/导出）在 file-share.ts。
 */
import type { Artifact } from "../../../packages/domain/src";

// ---- 纯判定：一个文件"是什么"（与文件详情页原有判定一致，抽出来共用） ----

export function isPdfFile(file: Artifact) {
  return file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name.trim());
}
export function isTextFile(file: Artifact) {
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (/^application\/(json|.*\+json|yaml|.*\+yaml|toml|x-ndjson|xml)$/.test(mime)) return true;
  return /\.(md|mdown|markdown|txt|log|csv|tsv|json|jsonl|ya?ml|toml|ini|conf|env|html?|xml|py|ts|tsx|jsx?|mjs|cjs|kt|java|go|rs|c|h|cpp|hpp|cc|sql|sh|bash|zsh|scss|css|plist)$/i.test(
    file.name.trim(),
  );
}
export function isHtmlFile(file: Artifact) {
  return file.mimeType.toLowerCase() === "text/html" || /\.html?$/i.test(file.name.trim());
}
export function isMediaFile(file: Artifact) {
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return true;
  return /\.(mp3|m4a|wav|ogg|aac|flac|mp4|mov|webm|mkv|avi)$/i.test(file.name.trim());
}
export function isMarkdownFile(file: Artifact) {
  return (
    file.mimeType.toLowerCase() === "text/markdown" ||
    /\.(md|mdown|markdown)$/i.test(file.name.trim())
  );
}
export function isImageFile(file: Artifact) {
  return (
    file.mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(file.name.trim())
  );
}

/** 分享/落盘用的扩展名：以 mimeType 为准，兜底看文件名，再兜底 png / mp4 / pdf。 */
export function imageExtensionFor(file: Artifact): string {
  const fromMime = file.mimeType.split("/")[1]?.toLowerCase();
  if (fromMime && /^(png|jpeg|jpg|webp|gif|bmp|heic)$/.test(fromMime))
    return fromMime === "jpeg" ? "jpg" : fromMime;
  const fromName = file.name
    .trim()
    .match(/\.([A-Za-z0-9]+)$/)?.[1]
    ?.toLowerCase();
  return fromName && /^(png|jpe?g|webp|gif|bmp|heic)$/.test(fromName)
    ? fromName.replace("jpeg", "jpg")
    : "png";
}
export function mediaExtensionFor(file: Artifact): string {
  const fromMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-msvideo": "avi",
  };
  const known = fromMime[file.mimeType.toLowerCase()];
  if (known) return known;
  const fromName = file.name
    .trim()
    .match(/\.([A-Za-z0-9]+)$/)?.[1]
    ?.toLowerCase();
  return fromName ?? "mp4";
}

/**
 * 分享时文件该叫什么扩展名：网页→html，文本→txt/md，图片/音视频跟着类型走，
 * 其余（PDF 等）→pdf。与文件详情页原有逻辑一字不差，抽出来是为了两处共用 + 可测。
 */
export function shareExtensionFor(file: Artifact): string {
  if (isHtmlFile(file)) return "html";
  if (isTextFile(file)) return /\.txt$/i.test(file.name) ? "txt" : "md";
  if (isImageFile(file)) return imageExtensionFor(file);
  if (isMediaFile(file)) return mediaExtensionFor(file);
  return "pdf";
}

export function shareMimeTypeFor(file: Artifact, extension: string): string {
  if (isHtmlFile(file)) return "text/html";
  if (isTextFile(file)) return extension === "txt" ? "text/plain" : "text/markdown";
  if (isImageFile(file)) return file.mimeType || `image/${extension}`;
  if (isMediaFile(file)) return file.mimeType || "video/mp4";
  return "application/pdf";
}

export function shareUtiFor(file: Artifact, extension: string): string {
  if (isMediaFile(file))
    return file.mimeType.startsWith("video/") ? "public.movie" : "public.audio";
  if (isImageFile(file)) return "public.image";
  if (extension === "pdf") return "com.adobe.pdf";
  return "net.daringfireball.markdown";
}

/** 对话文件卡上哪些动作有意义（与详情页按钮的出现条件一致）。 */
export function availableFileActions(file: Artifact): {
  exportPdf: boolean;
  exportHtml: boolean;
} {
  const text = isTextFile(file);
  const html = isHtmlFile(file);
  return { exportPdf: text || html, exportHtml: text && !html };
}
