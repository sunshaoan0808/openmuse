import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAX_ATTACHMENTS,
  MAX_MESSAGE_CHARS,
  MAX_UPLOAD_MB,
  messageCounterLabel,
  tooLargeMessage,
} from "../src/limits";

const read = (name: string) => readFileSync(join(import.meta.dirname, "..", "src", name), "utf8");

/**
 * 对标 Muse：那边的上限是**显式、可远端配置**的（`DEFAULT_MAX_UPLOAD_SIZE_MB = 25`、
 * `AttachmentTooLargeException`、`文件过大。上限是%1$s MB`）。我们的老问题是限制藏在服务端、
 * 且只在**传完之后**才发作。这组测试钉住"客户端先判 + 与服务端数字不漂移"。
 */

test("客户端上传上限与服务端 bodyLimit 是同一个数", () => {
  const server = readFileSync(
    join(import.meta.dirname, "..", "..", "server", "src", "app.ts"),
    "utf8",
  );
  const m = /maxSize:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(server);
  assert.ok(m, "服务端应该仍有 bodyLimit({ maxSize: N * 1024 * 1024 })");
  assert.equal(
    MAX_UPLOAD_MB,
    Number(m[1]),
    "客户端比服务端松 → 用户传完才失败；比服务端紧 → 能收的文件被本地拦掉。改一边必须改另一边",
  );
});

test("超限先把话说清楚（带具体 MB），没超就放行", () => {
  const limit = MAX_UPLOAD_MB * 1024 * 1024;
  assert.equal(tooLargeMessage("小.png", limit - 1), undefined, "在限内必须放行");
  assert.equal(
    tooLargeMessage("未知大小.bin", undefined),
    undefined,
    "拿不到体积就不拦——本地判据宁可漏，不可误伤",
  );
  const message = tooLargeMessage("大片.mp4", 40 * 1024 * 1024) ?? "";
  assert.match(message, new RegExp(`文件过大。上限是 ${MAX_UPLOAD_MB} MB`));
  assert.match(message, /40 MB/, "要报出实际大小，否则用户不知道差多少");
});

test("输入计数只在临界时出现（平时不打扰）", () => {
  assert.equal(messageCounterLabel(10), undefined);
  assert.match(messageCounterLabel(MAX_MESSAGE_CHARS - 20) ?? "", /还可输入 20 个字符/);
  assert.match(
    messageCounterLabel(MAX_MESSAGE_CHARS) ?? "",
    new RegExp(`已达到 ${MAX_MESSAGE_CHARS} 个字符的上限`),
  );
});

test("常量都接上了：选完先判体积、输入框限长、附件有上限", () => {
  const chat = read("chat.tsx");
  assert.match(chat, /tooLargeMessage\(/, "图片与文档两条路都要在本地先判");
  assert.match(chat, /maxLength=\{MAX_MESSAGE_CHARS\}/, "输入框要真的限长");
  assert.match(chat, /最多可附加 \$\{MAX_ATTACHMENTS\} 项内容/, "附件超量要说话，不能静默丢弃");
  assert.ok(MAX_ATTACHMENTS > 0);
});

test("复制有回执、撤回如实提示边界、发送键有上传态（都是 Muse 的原话）", () => {
  const chat = read("chat.tsx");
  assert.match(chat, /已复制到剪贴板/, "静默复制 = 用户反复长按");
  assert.match(chat, /可能仍留在智能体的记忆里/, "撤回涉及隐私预期，要说清楚");
  assert.match(chat, /正在上传附件/, "上传中发送键要有第三态");
  assert.match(chat, /正在发送…/, "排队中的每条要有自己的状态");
  assert.match(chat, /已发送/, "发出去要有回执，否则分不清「发了」还是「丢了」");
});
