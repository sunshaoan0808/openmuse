import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-media-"));
  db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-intelligence",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  ({ app } = await createApp(db, config));
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = ((await session.json()) as { token: string }).token;
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function upload(name: string, bytes: Uint8Array, type: string) {
  const form = new FormData();
  form.set("file", new File([bytes as BlobPart], name, { type }));
  const response = await app.request("/api/files", {
    method: "POST",
    body: form,
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.text() };
}

/** 造一个真的 44 字节 WAV 头（8kHz 单声道 8bit，数据段为空）——不只是魔数，是能播放的空音频 */
function tinyWav(): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(0, 40);
  return new Uint8Array(header);
}

test("音视频按魔数认类型：wav（真文件）、mp3（ID3）、mp4（ftyp）、webm（EBML）", async () => {
  const cases: [string, Uint8Array, string][] = [
    ["录音.wav", tinyWav(), "audio/wav"],
    // 其余用"魔数 + 填充"构造：服务端只看文件头，这几条验的是识别分支
    ["song.mp3", new Uint8Array([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]), "audio/mpeg"],
    [
      "clip.mp4",
      new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]),
      "video/mp4",
    ],
    [
      "voice.m4a",
      new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]),
      "audio/mp4",
    ],
    [
      "movie.webm",
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0, 0, 0, 0]),
      "video/webm",
    ],
  ];
  for (const [name, bytes, mime] of cases) {
    const result = await upload(name, bytes, "application/octet-stream");
    assert.equal(result.status, 201, `${name} 应该能上传：${result.body}`);
    assert.match(
      result.body,
      new RegExp(`"mimeType":"${mime.replace("+", "\\+")}"`),
      `${name} 类型应是 ${mime}`,
    );
  }
});

test("音频分享/取回时扩展名跟着类型走（不是一律 .pdf）", async () => {
  const result = await upload("录音.wav", tinyWav(), "audio/wav");
  assert.equal(result.status, 201);
  const artifact = JSON.parse(result.body) as { id: string; mimeType: string };
  const content = await app.request(`/api/files/${artifact.id}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(content.status, 200, "能取回");
  assert.equal(content.headers.get("content-type"), "audio/wav");
  // 取回的字节与上传的一致（wav 头在）
  const bytes = new Uint8Array(await content.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString("ascii"), "RIFF");
});
