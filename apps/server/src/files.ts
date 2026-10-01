import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import { fillPdf, inspectPdf } from "../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/** 按魔数识别文件类型：放行 PDF 与常见图片（与 agent 的图片理解能力对齐）。 */
function sniff(bytes: Uint8Array): { mimeType: string; extension: string } | undefined {
  const b = bytes;
  const startsWith = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return { mimeType: "application/pdf", extension: "pdf" };
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return { mimeType: "image/png", extension: "png" };
  if (startsWith(0xff, 0xd8, 0xff)) return { mimeType: "image/jpeg", extension: "jpg" };
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return { mimeType: "image/webp", extension: "webp" };
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return { mimeType: "image/gif", extension: "gif" };
  // 媒体：对照 Muse 的 Extensions（mp3 m4a wav ogg mp4 mov mkv avi aac）——它也把音视频当一等文件。
  // 魔数只能认到这一层；mkv 与 webm 同为 EBML（0x1A45DFA3），这里按 webm 记，播放器通常都认。
  if (startsWith(0x49, 0x44, 0x33)) return { mimeType: "audio/mpeg", extension: "mp3" }; // ID3 标签
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { mimeType: "audio/mpeg", extension: "mp3" }; // MPEG 帧同步
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return { mimeType: "video/webm", extension: "webm" }; // EBML
  if (startsWith(0x4f, 0x67, 0x67, 0x53)) return { mimeType: "audio/ogg", extension: "ogg" }; // OggS
  if (startsWith(0x66, 0x4c, 0x61, 0x43)) return { mimeType: "audio/flac", extension: "flac" }; // fLaC
  if (b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9))
    return { mimeType: "audio/aac", extension: "aac" };
  if (startsWith(0x52, 0x49, 0x46, 0x46)) {
    const riff = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (riff === "WAVE") return { mimeType: "audio/wav", extension: "wav" };
    if (riff === "AVI ") return { mimeType: "video/x-msvideo", extension: "avi" };
  }
  // ISO BMFF（mp4 / mov / m4a）：第 4-8 字节是 "ftyp"，类别看紧随其后的 brand
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (brand === "M4A " || brand === "M4B ") return { mimeType: "audio/mp4", extension: "m4a" };
    if (brand === "qt  ") return { mimeType: "video/quicktime", extension: "mov" };
    return { mimeType: "video/mp4", extension: "mp4" };
  }
  return undefined;
}

/**
 * 文本类文件：按扩展名认（文本没有可靠的字节魔数），再用一段内容校验兜底。
 * 对照 Muse 的 `HatchMimeResolver$Extensions`：文档、源码、配置都是一等文件，不该只能存 PDF 和图片。
 */
const TEXT_TYPES: Record<string, string> = {
  md: "text/markdown",
  mdown: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  ini: "text/plain",
  conf: "text/plain",
  env: "text/plain",
  html: "text/html",
  htm: "text/html",
  xml: "text/xml",
  svg: "image/svg+xml",
  py: "text/x-python",
  ts: "text/x-typescript",
  tsx: "text/x-typescript",
  js: "text/javascript",
  jsx: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  kt: "text/x-kotlin",
  java: "text/x-java",
  go: "text/x-go",
  rs: "text/x-rust",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  hpp: "text/x-c++",
  cc: "text/x-c++",
  sql: "text/x-sql",
  sh: "text/x-sh",
  bash: "text/x-sh",
  zsh: "text/x-sh",
  scss: "text/x-scss",
  css: "text/css",
  plist: "text/x-plist",
};

/** 取文件名里的扩展名（小写，不含点） */
function extensionOf(name: string): string | undefined {
  return name
    .split(/[\\/]/)
    .at(-1)
    ?.match(/\.([A-Za-z0-9]+)$/)?.[1]
    ?.toLowerCase();
}

/**
 * 文本兜底识别：扩展名必须认识，且内容得真的像文本
 * —— 出现 NUL 字节、或不可打印字符超过 5%，就当成二进制拒绝（防止有人把 zip 改名成 .py）。
 */
function sniffText(
  name: string,
  bytes: Uint8Array,
): { mimeType: string; extension: string } | undefined {
  const extension = extensionOf(name);
  const mimeType = extension ? TEXT_TYPES[extension] : undefined;
  if (!extension || !mimeType) return undefined;
  const head = bytes.subarray(0, 4096);
  if (head.includes(0)) return undefined;
  let weird = 0;
  for (const byte of head) if (byte < 9 || (byte > 13 && byte < 32)) weird += 1;
  if (head.length > 0 && weird > head.length / 20) return undefined;
  return { mimeType, extension };
}

/** 文件在磁盘上的扩展名：以存下来的 mimeType 为准，老数据回退到 pdf。 */
function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    case "video/x-msvideo":
      return "avi";
    case "text/markdown":
      return "md";
    case "text/plain":
      return "txt";
    default:
      break;
  }
  // 文本类反查（csv / json / 源码…）：表里第一个匹配的扩展名就是落盘用的
  const found = Object.entries(TEXT_TYPES).find(([, mime]) => mime === mimeType);
  return found ? found[0] : "pdf";
}

/** 给用户看的类型名（错误提示里用得上） */
const SUPPORTED =
  "PDF、图片（png / jpg / webp / gif）、音视频（mp3 / m4a / wav / ogg / mp4 / mov / webm / avi / aac）与文本文件（md / txt / csv / json / 源码等）";

export class Files {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    source: string,
    parentId?: string,
  ): Promise<Artifact> {
    if (bytes.length > 10 * 1024 * 1024) throw new AppError("文件需在 10 MB 以内", 413);
    const kind = sniff(bytes) ?? sniffText(name, bytes);
    if (!kind) throw new AppError(`只支持 ${SUPPORTED}`, 422);
    // 图片与文本不做 PDF 解析；PDF 仍走原有的页数/表单字段检查
    const metadata =
      kind.mimeType === "application/pdf"
        ? await inspectPdf(bytes)
        : { pageCount: 0, fields: [] as NonNullable<Artifact["fields"]> };
    if (metadata.pageCount > 500) throw new AppError("PDF 不能超过 500 页", 422);
    const id = randomUUID();
    const safeName = Array.from(name.split(/[\\/]/).at(-1) ?? "document.pdf")
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 180);
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType: kind.mimeType,
      size: bytes.length,
      pageCount: metadata.pageCount,
      fields: metadata.fields,
      url: "",
      createdAt: new Date().toISOString(),
      source,
      parentId,
    };
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${id}.${kind.extension}`), bytes, { mode: 0o600, flag: "wx" });
    await this.db.put(owner, "files", artifact);
    return this.signed(owner, artifact);
  }
  /**
   * 存一份"由智能体写出来的文本文件"。
   * 之前的 import() 只放行 PDF 与图片（靠字节魔数嗅探），所以用户要一份 .md 时
   * 智能体即使写出了内容也无处可存，只能把全文打在聊天里。
   * 现在：名字带已知文本扩展名就按那个类型存（csv / json / py… 都能交出去），
   * 否则默认 markdown，只有明确 .txt 才存纯文本。
   */
  async importText(
    owner: string,
    name: string,
    text: string,
    source: string,
    idempotencyKey?: string,
  ): Promise<Artifact> {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 10 * 1024 * 1024) throw new AppError("文件需在 10 MB 以内", 413);
    const named = extensionOf(name);
    const namedType = named ? TEXT_TYPES[named] : undefined;
    const markdown = !namedType && !/\.txt$/i.test(name);
    const mimeType = namedType ?? (markdown ? "text/markdown" : "text/plain");
    const extension = namedType ? (named as string) : markdown ? "md" : "txt";
    const clean = Array.from((name.split(/[\\/]/).at(-1) || "document").replace(/\s+$/, ""))
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 160);
    const safeName = namedType || /\.(md|txt)$/i.test(clean) ? clean : `${clean}.${extension}`;
    const id = idempotencyKey
      ? createHash("sha256").update(`file:${idempotencyKey}`).digest("hex")
      : randomUUID();
    const existing = await this.db.get<Artifact>(owner, "files", id);
    if (existing) return this.signed(owner, existing);
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType,
      size: bytes.length,
      pageCount: 0,
      fields: [],
      url: "",
      createdAt: new Date().toISOString(),
      source,
    };
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${id}.${extension}`), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    await this.db.put(owner, "files", artifact);
    return this.signed(owner, artifact);
  }
  signed(owner: string, file: Artifact): Artifact {
    return { ...file, url: this.auth.sign(owner, `/api/files/${file.id}/content`) };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "files")).map((file) => this.signed(owner, file));
  }
  async get(owner: string, id: string) {
    const file = await this.db.get<Artifact>(owner, "files", id);
    if (!file) throw new AppError("找不到这个文件", 404);
    return file;
  }
  async bytes(owner: string, id: string) {
    const file = await this.get(owner, id);
    return readFile(join(this.config.dataDir, "files", `${id}.${extensionFor(file.mimeType)}`));
  }
  async fill(owner: string, id: string, values: Record<string, string | boolean>) {
    const file = await this.get(owner, id);
    const bytes = await this.bytes(owner, id);
    const output = await fillPdf(bytes, values);
    return this.import(
      owner,
      `${file.name.replace(/\.pdf$/i, "")} — filled.pdf`,
      output,
      `Filled from ${file.name}`,
      id,
    );
  }
}
