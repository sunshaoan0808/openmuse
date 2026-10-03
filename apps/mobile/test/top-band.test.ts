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

test("顶栏是绝对定位覆盖层（Muse 模型，a7f77ec 定案）：位移只动 transform 不动布局", () => {
  const code = strip(read("App.tsx"));
  // a7f77ec 实测定案：绝对定位覆盖层是唯一能同时满足三件事的做法——视口高度恒定
  // （"每帧钉回"的反馈环消失，慢滑不闪）、正文从 y=0 铺满、位移用 translateY 只动像素。
  // 正文不被顶栏推下去，靠**列表内部的 paddingTop** 让静止时第一条消息落在顶栏下沿。
  assert.match(
    code,
    /position: "absolute",\s*top: 0,\s*left: 0,\s*right: 0,\s*height: chromeTop,/,
    "顶栏应是绝对定位覆盖层（高度与 chrome 一致）",
  );
  assert.match(
    code,
    /transform:\s*\[\{\s*translateY:\s*headerTranslateY\(chromeTop\)\s*\}\]/,
    "收起位移必须走 translateY（只动像素、不触发布局）",
  );
  // 旧的"负 marginTop 布局行"方案已废除，防止回退
  assert.ok(!/marginTop:\s*headerMarginTop\(/.test(code), "不该再回到负外边距占位方案");
  // 滚动内容只留呼吸；工具页（mail/calendar…）在覆盖层模型下用 chromeTop 清开顶栏
  assert.match(code, /paddingTop:\s*10,/, "聊天流只留呼吸内边距");
  assert.match(
    code,
    /paddingTop:\s*chromeTop \+ 10/,
    "工具页要用 chromeTop 清开覆盖层顶栏（正文从顶栏底下穿过只发生在聊天页）",
  );
});

test("顶栏底色：半透明覆盖层底 + 整条不套玻璃（正文会从底下穿过，玻璃只给小控件）", () => {
  const code = strip(read("App.tsx"));
  // 第一轮翻车点：整条顶栏套玻璃，Android 模糊不可用时退化成白色实底
  assert.ok(!/<GlassLayer radius=\{0\}/.test(code), "整条顶栏不能套玻璃");
  // a7f77ec：覆盖层之下正文会穿过，底必须是**半透明**（0.72：可读但不刺眼），
  // 不透明的画布色在这里反而等于"白条压正文"；玻璃采样色由控件自带的 GlassLayer 负责。
  assert.match(
    code,
    /backgroundColor:\s*"rgba\(252,\s*252,\s*252,\s*0\.72\)"/,
    "覆盖层底应是 0.72 半透明画布色",
  );
  assert.ok(!/\[FILL, \{ backgroundColor: colors\.canvas \}\]/.test(code), "不该再回不透明实底");
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
