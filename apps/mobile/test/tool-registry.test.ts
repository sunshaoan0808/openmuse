import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_TOOL_NAMES, CHAT_TOOL_RENDERERS } from "../src/tool-registry.ts";

test("注册表没有重复项，且每个条目都有名字与中文说明", () => {
  assert.equal(new Set(CHAT_TOOL_NAMES).size, CHAT_TOOL_RENDERERS.length);
  for (const tool of CHAT_TOOL_RENDERERS) {
    assert.ok(tool.name.trim().length > 0, "工具名不能为空");
    assert.ok(tool.description.trim().length > 0, `${tool.name} 缺中文说明`);
    assert.ok(["card", "detail"].includes(tool.kind), `${tool.name} 的 kind 不合法`);
  }
});

test("此前在聊天里隐身的 8 个工具必须登记在册（save_document 等）", () => {
  // 这是 P0-1 要修的差距：智能体写出的文件与 workspace/git 动作跑完后聊天里什么都不出现
  const required = [
    "save_document",
    "read_image",
    "git_commit",
    "git_push",
    "workspace_read_file",
    "workspace_write_file",
    "workspace_edit_file",
    "workspace_list_files",
  ];
  for (const name of required) assert.ok(CHAT_TOOL_NAMES.includes(name), `${name} 未注册`);
});

test("save_document 是卡片级渲染，其余工具默认收成一行细节", () => {
  const save = CHAT_TOOL_RENDERERS.find((tool) => tool.name === "save_document");
  assert.equal(save?.kind, "card");
  const detailKinds = CHAT_TOOL_RENDERERS.filter((tool) => tool.name !== "save_document");
  for (const tool of detailKinds) assert.equal(tool.kind, "detail", `${tool.name} 应为 detail`);
});
