import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { Files } from "../apps/server/src/files.ts";

let db: Store;
let files: Files;
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let token = "";

/** HTTP 路由要会话令牌（与 tests/api.test.ts 同一套做法） */
const auth = () => ({ Authorization: `Bearer ${token}` });

/** 建表用的最小 Config（Files 只用到 dataDir） */
function configFor(dataDir: string): Config {
  return {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir,
    agentBackend: "sample",
    intelligenceApiKey: "test-intelligence",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-files-"));
  db = await createStore();
  const built = await createApp(db, configFor(directory));
  app = built.app;
  files = built.files;
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(session.status, 200);
  token = ((await session.json()) as { token: string }).token;
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function upload(name: string, content: string | Uint8Array, type = "text/plain") {
  const form = new FormData();
  form.set("file", new File([content as BlobPart], name, { type }));
  return app.request("/api/files", { method: "POST", body: form, headers: auth() });
}

test("上传 csv / json / py：按扩展名认成对应类型，能存也能取回", async () => {
  const cases: [string, string, string][] = [
    ["data.csv", "名字,数量\n苹果,3\n", "text/csv"],
    ["config.json", '{"a":1}', "application/json"],
    ["solve.py", "print('hi')\n", "text/x-python"],
    ["notes.md", "# 标题\n", "text/markdown"],
  ];
  for (const [name, body, mime] of cases) {
    const response = await upload(name, body);
    // 注意：assert 的消息参数会被先求值，别在里面读响应体（读一次就没了）
    const status = response.status;
    const payload = await response.text();
    assert.equal(status, 201, `${name} 应该上传成功：${payload}`);
    const artifact = JSON.parse(payload) as { id: string; name: string; mimeType: string };
    assert.equal(artifact.mimeType, mime, `${name} 的类型应该是 ${mime}`);
    assert.equal(artifact.name, name);
    // 取回内容：文本没被损坏
    const content = await app.request(`/api/files/${artifact.id}/content`, { headers: auth() });
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("content-type"), mime);
    assert.equal(await content.text(), body, `${name} 内容应原样取回`);
  }
});

test("扩展名不符或内容可疑的一律拒绝（防伪装成 .py 的二进制）", async () => {
  // 二进制改名成 .py：含 NUL + 大量不可打印字符 ⇒ 拒
  const binary = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01, 0x02, 0x03, 0x00, 0xff, 0xfe,
  ]);
  const disguised = await upload("payload.py", binary);
  assert.equal(disguised.status, 422, "伪装成 .py 的二进制应该被拒");

  // 不认识的扩展名：也拒（不是文本类型，又不是 PDF/图片）
  const weird = await upload("archive.xyz", "hello");
  assert.equal(weird.status, 422, "不认识的扩展名应该被拒");

  // 空 body 的 .csv 是合法的（空表）—— 不应该因为"看起来不像文本"误拒
  const empty = await upload("empty.csv", "");
  assert.equal(empty.status, 201, "空 csv 应该能存");
});

test("智能体写文件时尊重扩展名（save_document 交 .csv 就存成 text/csv）", async () => {
  const csv = await files.importText(
    "local-user",
    "成绩.csv",
    "科目,分数\n数学,95\n",
    "Written by your agent",
  );
  assert.equal(csv.mimeType, "text/csv");
  assert.equal(csv.name, "成绩.csv");

  const code = await files.importText(
    "local-user",
    "run.py",
    "print(1)\n",
    "Written by your agent",
  );
  assert.equal(code.mimeType, "text/x-python");

  // 没写扩展名的仍然默认 markdown（原行为不变）
  const plain = await files.importText("local-user", "报告", "正文", "Written by your agent");
  assert.equal(plain.mimeType, "text/markdown");
  assert.equal(plain.name, "报告.md");

  // 明确 .txt 的仍是纯文本
  const text = await files.importText("local-user", "备忘.txt", "正文", "Written by your agent");
  assert.equal(text.mimeType, "text/plain");
});
