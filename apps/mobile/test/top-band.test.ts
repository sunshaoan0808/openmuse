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

test("顶栏必须占位：不能是绝对定位的覆盖层（否则正文从它底下穿过去 = 白条压住正文）", () => {
  const code = strip(read("App.tsx"));
  // 用户实测过两次：① 留极小的静态顶距 → 正文被白条压住；② 把留白放进滚动内容 → 一滚动就被滚走，照样被压。
  // 正确做法是顶栏作为**布局里的一行**占位，收起时用负 marginTop 真的让出位置（正文自动顶上来）。
  assert.match(
    code,
    /marginTop:\s*headerMarginTop\(chromeTop\)/,
    "顶栏要用负外边距收起（真的让出位置）",
  );
  const headerAt = code.indexOf("marginTop: headerMarginTop(");
  const headerBlock = code.slice(headerAt, headerAt + 300);
  assert.ok(!/position:\s*"absolute"/.test(headerBlock), "顶栏不能是绝对定位的覆盖层");
  assert.ok(
    !/transform:\s*\[\{ translateY/.test(headerBlock),
    "收起不能用 transform（它只动画面、不动排版）",
  );
  // 滚动内容只留呼吸，不再靠"按顶栏高度留白"绕开遮挡
  assert.match(code, /paddingTop:\s*10,/, "滚动内容只留呼吸内边距");
  assert.ok(!/paddingTop:\s*chromeTop/.test(code), "不该再用 chromeTop 做滚动内边距");
});

test("顶栏底色：不透明实色 + 不用 BlurView（半透明只在它浮在内容上时才需要，现在已经占位）", () => {
  const code = strip(read("App.tsx"));
  // 第一轮翻车点：整条顶栏套玻璃，Android 模糊不可用时退化成白色实底
  assert.ok(!/<GlassLayer radius=\{0\}/.test(code), "整条顶栏不能套玻璃");
  // 底色必须是不透明实色：顶栏占位之后，半透明只会让下沿那行被裁掉的字透出来，
  // 看着就像"正文被白条盖住"（用户实测反馈）。
  assert.match(
    code,
    /\[FILL, \{ backgroundColor: colors\.canvas \}\]/,
    "顶栏底色应是不透明的画布色",
  );
  assert.ok(!/rgba\(252,\s*252,\s*252/.test(code), "不该再用半透明白做顶栏底色");
  // 下沿一条发丝线
  assert.match(
    code,
    /bottom: 0,\s*height: 1,\s*backgroundColor: "rgba\(19,\s*38,\s*49,\s*0\.07\)"/,
    "下沿应有发丝线划清边界",
  );
});

test("对话页不再用 -insets.top 抵消（外壳不再留内边距，抵消反而会把内容推出屏幕）", () => {
  const code = strip(read("src/chat.tsx"));
  assert.equal(/-insets\.top/.test(code), false, "chat.tsx 里不该再有 -insets.top");
});
