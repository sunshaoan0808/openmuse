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

test("顶栏底色必须看得见：整条一个极低 alpha 就是用户看到的「没有白条」", () => {
  const code = strip(read("App.tsx"));
  // 顶栏底色是分段渐变（上实下虚）。整条只给一个 0.15 的白，叠在浅色页面上等于看不见 ——
  // 这是真机上用户直接反馈过的问题，所以在这里钉住：最上面那段要够实，最下面那段要够虚。
  const alphas = [
    ...code.matchAll(/backgroundColor:\s*"rgba\(252,\s*252,\s*252,\s*([0-9.]+)\)"/g),
  ].map((m) => Number(m[1]));
  assert.ok(alphas.length >= 3, `顶栏底色应该是分段渐变，当前只有 ${alphas.length} 层`);
  const strongest = Math.max(...alphas);
  const faintest = Math.min(...alphas);
  assert.ok(strongest >= 0.5, `最上面那段必须够实才读得出是一条栏，当前最实 ${strongest}`);
  assert.ok(faintest <= 0.2, `最下面那段要接近透明，下沿才不会切出硬边，当前最虚 ${faintest}`);
  // 上实下虚：靠上的分段必须比靠下的实（取前两个出现顺序即可）
  assert.ok(alphas[0] > alphas[alphas.length - 1], "渐变方向反了：应该是上实下虚");
});
