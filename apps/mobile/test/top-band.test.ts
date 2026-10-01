import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

/** 断言前先剥注释：文件里到处是"曾经这么写导致白带"的说明，注释里的旧值会误报 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * 顶部白带的根因（第 5 轮才定位到）：外壳 SafeAreaView 带 edges=["top"]，
 * 于是**每个**界面顶部都留出 insets.top 的空白，露出的是外壳底色（#FCFCFC 近白），
 * 而各页面内容偏灰 —— 于是每个页面顶上一条白带；对话页因为自己做了负 margin 抵消，
 * 所以只有它"更窄"。这组测试把三条不变量钉死。
 */
test("外壳不再给顶部留内边距：SafeAreaView 的 edges 里不能有 top", () => {
  const code = strip(read("App.tsx"));
  const groups = code.match(/edges=\{\[[^\]]*\]\}/g) ?? [];
  assert.ok(groups.length > 0, "应该能在 App.tsx 里找到 SafeAreaView 的 edges");
  for (const group of groups) {
    assert.equal(
      /"top"/.test(group),
      false,
      `外壳不能再给顶部留内边距（那正是白带的来源）：${group}`,
    );
  }
});

test("内容区顶部内边距必须很小：留成接近顶栏高度就会露出一条底色", () => {
  const code = strip(read("App.tsx"));
  const match = code.match(/minHeight:\s*0,\s*paddingTop:\s*desktop\s*\?\s*(\d+)\s*:\s*(\d+)/);
  assert.ok(match, "应该能找到内容区的 paddingTop");
  const desktop = Number(match[1]);
  const mobile = Number(match[2]);
  assert.ok(mobile <= 16, `手机端内容顶部内边距必须很小，当前 ${mobile}`);
  assert.ok(desktop <= 24, `桌面端内容顶部内边距必须很小，当前 ${desktop}`);
});

test("顶栏底色不能用 BlurView：Android 模糊不可用时它退化成白色实底（第一轮的翻车点）", () => {
  const code = strip(read("App.tsx"));
  // 三个小控件（radius 18/19）用玻璃是对的；**整条顶栏**（radius 0，铺满全宽）不能套 BlurView
  assert.equal(
    /<GlassLayer radius=\{0\}/.test(code),
    false,
    "整条顶栏不能再套 GlassLayer：真机上模糊不可用时它退化成白色实底，又变成一条白带",
  );
  assert.match(code, /rgba\(252,\s*252,\s*252,\s*0\.\d+\)/, "顶栏应该用一层画布色半透明遮罩");
});

test("对话页不再用 -insets.top 抵消（外壳不再留内边距，抵消反而会把内容推出屏幕）", () => {
  const code = strip(read("src/chat.tsx"));
  assert.equal(/-insets\.top/.test(code), false, "chat.tsx 里不该再有 -insets.top");
});
