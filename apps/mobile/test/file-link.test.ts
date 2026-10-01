import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileIdFromUrl } from "../src/assistant-markdown";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * 用户报过："聊天界面输出的文件点开会跳转浏览器打开，这个时候实际打不开"。
 * 原因是助手正文里的文件链接走 Linking.openURL —— 那是内网地址、浏览器又没有令牌。
 * 这组测试钉住：识别出自家文件链接，并且两个调用点都把它交回应用内。
 */
test("识别自家文件的链接：带签名/不带签名/绝对与相对都认，别的链接不认", () => {
  const id = "88dc4d93-cc4c-4b48-9a83-737568f658bd";
  assert.equal(
    fileIdFromUrl(
      `https://openmuse.claw.ssan.me/api/files/${id}/content?owner=local-user&expires=1790840700000&signature=abc`,
    ),
    id,
    "带签名 query 的绝对地址",
  );
  assert.equal(fileIdFromUrl(`http://10.7.0.6:8787/api/files/${id}/content`), id);
  assert.equal(fileIdFromUrl(`/api/files/${id}`), id, "没有 /content 后缀也要认");
  assert.equal(fileIdFromUrl("https://example.com/doc"), undefined, "外部链接不该被拦下");
  assert.equal(fileIdFromUrl("/api/files/ab"), undefined, "太短的片段不像文件 id");
});

test("聊天与文件面板都必须把文件链接交回应用内（否则又跳浏览器）", () => {
  for (const file of ["src/chat.tsx", "src/details.tsx"]) {
    const code = strip(read(file));
    assert.match(code, /onOpenFile=/, `${file} 应该给 AssistantResponse 传 onOpenFile`);
    assert.match(code, /open\(\{ type: "file", file \}\)/, `${file} 应该用应用内的文件面板打开`);
  }
  // 兜底路径仍在：非自家链接照旧交给系统/浏览器
  const response = strip(read("src/assistant-response.tsx"));
  assert.match(response, /Linking\.openURL\(url\)/, "非文件链接仍走系统打开");
  assert.match(response, /fileIdFromUrl\(url\)/, "先判断是不是自己的文件链接");
});
