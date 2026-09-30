import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import { fillPdf, inspectPdf } from "../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/** 按魔数识别文件类型：只放行 PDF 与常见图片（与 agent 的图片理解能力对齐）。 */
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
  return undefined;
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
    default:
      return "pdf";
  }
}

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
    const kind = sniff(bytes);
    if (!kind) throw new AppError("只支持 PDF 与图片（png / jpg / webp / gif）", 422);
    // 图片不做 PDF 解析；PDF 仍走原有的页数/表单字段检查
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
