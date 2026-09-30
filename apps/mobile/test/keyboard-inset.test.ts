import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

/**
 * edge-to-edge 下 Android 不执行 adjustResize，KeyboardAvoidingView 是 no-op，
 * 所以键盘补偿只能自己加。而且必须在**两层**各加一次：
 *  - 根组件：覆盖所有在根树里的输入框（聊天输入区、登录、各屏幕表单）
 *  - Sheet：面板是 RN Modal，渲染在另一棵树里，根组件那层够不到（任务/邮件/重命名等 10 个面板）
 * 少一层就会出现"某些输入框被输入法盖住"。
 */
test("根组件用键盘高度补底部内边距（覆盖根树里的输入框）", () => {
  const app = read("App.tsx");
  assert.match(app, /paddingBottom:\s*keyboardInset/, "根组件应补 keyboardInset");
});

test("Sheet 面板自己避让键盘（Modal 不在根树里，根组件那层够不到）", () => {
  const ui = read("src/ui.tsx");
  assert.match(ui, /useAndroidKeyboardInset/, "Sheet 应订阅键盘高度");
  assert.match(ui, /paddingBottom:[^\n]*keyboard/, "面板底部应加键盘高度");
  assert.match(ui, /windowHeight - keyboard/, "键盘弹出时应限制面板高度，避免顶出屏幕");
});

test("键盘补偿不能重复叠加（根树与 Modal 互不影响，各加一次即可）", () => {
  const chat = read("src/chat.tsx");
  assert.ok(!/paddingBottom:\s*keyboardInset/.test(chat), "聊天页不应再单独补一次（会双重偏移）");
});
