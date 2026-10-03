import assert from "node:assert/strict";
import { test } from "node:test";
import type { Artifact } from "../../../packages/domain/src";
import {
  availableFileActions,
  imageExtensionFor,
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isMediaFile,
  isPdfFile,
  isTextFile,
  mediaExtensionFor,
  shareExtensionFor,
  shareMimeTypeFor,
  shareUtiFor,
} from "../src/file-actions.ts";

const file = (over: Partial<Artifact>): Artifact => ({
  id: "f1",
  name: "file",
  mimeType: "application/octet-stream",
  size: 1,
  pageCount: 0,
  fields: [],
  url: "",
  createdAt: "2026-10-03T00:00:00Z",
  source: "test",
  ...over,
});

test("类型判定：markdown/html/源码/媒体/图片/PDF 各归各类", () => {
  assert.ok(isMarkdownFile(file({ name: "攻略.md", mimeType: "text/markdown" })));
  assert.ok(isHtmlFile(file({ name: "page.htm", mimeType: "text/html" })));
  // html 同时是 text/*——判定为文本成立，但 html 判定必须排在前面（与详情页分支同序）
  assert.ok(isTextFile(file({ name: "page.html", mimeType: "text/html" })));
  assert.ok(isTextFile(file({ name: "main.py", mimeType: "text/x-python" })));
  assert.ok(isMediaFile(file({ name: "audio", mimeType: "audio/mpeg" })));
  assert.ok(isMediaFile(file({ name: "clip.mov", mimeType: "video/quicktime" })));
  assert.ok(isImageFile(file({ name: "photo", mimeType: "image/png" })));
  assert.ok(isPdfFile(file({ name: "a.PDF", mimeType: "application/pdf" })));
  assert.ok(!isTextFile(file({ name: "app", mimeType: "application/octet-stream" })));
});

test("分享扩展名跟随类型：html→html、txt→txt、md→md、图片/媒体按类型、其余→pdf", () => {
  assert.equal(shareExtensionFor(file({ name: "a.html", mimeType: "text/html" })), "html");
  assert.equal(shareExtensionFor(file({ name: "notes.txt", mimeType: "text/plain" })), "txt");
  assert.equal(shareExtensionFor(file({ name: "notes.md", mimeType: "text/markdown" })), "md");
  assert.equal(shareExtensionFor(file({ name: "p", mimeType: "image/jpeg" })), "jpg");
  assert.equal(shareExtensionFor(file({ name: "a", mimeType: "audio/mpeg" })), "mp3");
  assert.equal(shareExtensionFor(file({ name: "v", mimeType: "video/quicktime" })), "mov");
  assert.equal(shareExtensionFor(file({ name: "b", mimeType: "application/pdf" })), "pdf");
  // 兜底链：mime 不认识时看文件名，再兜底
  assert.equal(
    imageExtensionFor(file({ name: "x.heic", mimeType: "application/octet-stream" })),
    "heic",
  );
  assert.equal(
    imageExtensionFor(file({ name: "unknown", mimeType: "application/octet-stream" })),
    "png",
  );
  assert.equal(
    mediaExtensionFor(file({ name: "unknown", mimeType: "application/octet-stream" })),
    "mp4",
  );
});

test("分享 MIME 与 UTI 跟随类型（与详情页原有映射一字不差）", () => {
  const md = file({ name: "a.md", mimeType: "text/markdown" });
  assert.equal(shareMimeTypeFor(md, "md"), "text/markdown");
  assert.equal(shareUtiFor(md, "md"), "net.daringfireball.markdown");
  const txt = file({ name: "a.txt", mimeType: "text/plain" });
  assert.equal(shareMimeTypeFor(txt, "txt"), "text/plain");
  const html = file({ name: "a.html", mimeType: "text/html" });
  assert.equal(shareMimeTypeFor(html, "html"), "text/html");
  const img = file({ name: "p", mimeType: "image/png" });
  assert.equal(shareMimeTypeFor(img, "png"), "image/png");
  assert.equal(shareUtiFor(img, "png"), "public.image");
  const video = file({ name: "v", mimeType: "video/mp4" });
  assert.equal(shareMimeTypeFor(video, "mp4"), "video/mp4");
  assert.equal(shareUtiFor(video, "mp4"), "public.movie");
  const audio = file({ name: "a", mimeType: "audio/wav" });
  assert.equal(shareUtiFor(audio, "wav"), "public.audio");
  const pdf = file({ name: "a", mimeType: "application/pdf" });
  assert.equal(shareMimeTypeFor(pdf, "pdf"), "application/pdf");
  assert.equal(shareUtiFor(pdf, "pdf"), "com.adobe.pdf");
});

test("动作可用性与详情页按钮条件一致：文本/网页可导出 PDF，仅文本可导出 HTML", () => {
  assert.deepEqual(availableFileActions(file({ name: "a.md", mimeType: "text/markdown" })), {
    exportPdf: true,
    exportHtml: true,
  });
  assert.deepEqual(availableFileActions(file({ name: "a.html", mimeType: "text/html" })), {
    exportPdf: true,
    exportHtml: false,
  });
  assert.deepEqual(availableFileActions(file({ name: "a", mimeType: "application/pdf" })), {
    exportPdf: false,
    exportHtml: false,
  });
});
