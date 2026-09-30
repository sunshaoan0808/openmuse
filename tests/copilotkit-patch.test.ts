import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * @copilotkit/react-native 的 streaming fetch 有个顺序 bug：
 *   if (readyState === 4 && !settled && !resp) fail(...)      ← 安全网写在前面
 *   if (readyState >= 2 && !resp && xhrStatus !== 0) 组装响应  ← 正确分支永远走不到
 * RN 的 XHR 在整个响应体一次到达时会跳过中间态直接到 readyState 4，
 * 于是服务端明明 200，客户端却报 "completed with status 200 but no response was produced"
 * （真机上表现为"一打开就报错"）。上游 1.75.2 仍未修，所以我们用 pnpm patch 把安全网挪到后面。
 *
 * 这条测试守两件事：补丁还在、且依然登记在 workspace（升版本时最容易静默丢掉）。
 */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("pnpm 补丁文件存在，且把安全网挪到了组装响应之后", () => {
  const patch = read("patches/@copilotkit__react-native@1.70.1.patch");
  assert.ok(patch.includes("streaming-fetch.ts"), "补丁应针对 streaming-fetch.ts");
  // 摘掉安全网（- 行）与重新插入（+ 行）都要在补丁里
  assert.ok(
    patch.includes("no response was produced"),
    "补丁应移动那条安全网（它包含这句报错文案）",
  );
  assert.ok(
    patch.includes("RN 的 XHR 在整个响应体一次到达时会跳过中间态"),
    "补丁应带上说明为什么这么挪",
  );
});

test("补丁仍登记在 pnpm-workspace.yaml（否则 CI 安装时不会应用）", () => {
  const workspace = read("pnpm-workspace.yaml");
  assert.match(workspace, /patchedDependencies:/, "必须有 patchedDependencies 段");
  assert.match(workspace, /@copilotkit\/react-native@1\.70\.1/, "必须登记该包与版本");
});
