/**
 * 顶栏/水豚「模拟真机」验收台
 * ------------------------------------------------------------------
 * 目的：在打包之前，用 Web 版把"真机上才会暴露"的三个现象量化复现/验证：
 *   A. 慢速滑动抖动 —— 模拟慢拖（每步 2px、共 ~1.5s），断言 scrollTop 序列**不出现反向跳动**。
 *      真机反馈"慢滑一直闪"的根因是：顶栏用 marginTop 改布局 → 内容区视口高度每帧变
 *      → chat.tsx 的 onLayout 里 scrollToOffset(lastOffset) 把列表拽回 → 反馈环。
 *      这个环在 Web 上同样成立（RN-Web 的 onLayout 走 ResizeObserver），所以能被量化。
 *   B. 顶栏位移的纯函数性 —— 同一 scroll offset 必须得到同一顶栏位置（不闪的结构性保证）。
 *   C. 水豚层级与"保留" —— 滚动到中段时，用 elementFromPoint 取水豚卡片中心，
 *      命中的必须是水豚自己（说明它在上层，没被正文盖住），且它的 top 与静止时一致（不随滚动隐藏/位移）。
 *   D. 布局稳定性 —— 滚动过程中内容区容器的 top/height 是否恒定（每帧变 = 反馈环的源头）。
 *
 * 用法：先起 Web 验收环境（scripts/web-harness.sh），再 node scripts/accept-topbar.mjs
 * 退出码：0 = 全过；1 = 有失败项（并打印是哪一项）
 */
import { chromium } from "patchright";

const URL = process.env.OM_WEB_URL || "http://localhost:8081";
const fails = [];
const pass = (n, d = "") => console.log(`  ✅ ${n}${d ? " — " + d : ""}`);
const fail = (n, d = "") => {
  fails.push(n);
  console.log(`  ❌ ${n}${d ? " — " + d : ""}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(15000); // 等 dev bundle 起来

const probe = () =>
  page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 等元素出现（最多 3s），避免时序问题把"没测到"误判成"被盖住"
    const waitFor = async (fn, ms = 3000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(80); }
      return null;
    };
    const byLabel = (pred) => Array.from(document.querySelectorAll("[aria-label]")).find((e) => pred(e.getAttribute("aria-label") || ""));
    const findScroller = () => Array.from(document.querySelectorAll("div")).find((n) => n.scrollHeight > n.clientHeight + 150);
    const sc = findScroller();
    // 顶栏那一行：带 marginTop 的动画行（有 ZCode 之外的容器里最靠上的那条）
    const bar = await waitFor(() => byLabel((l) => l.includes("会话") || l.includes("菜单")));
    const barRow = bar;
    // 水豚卡片：即"Open <名字> activity and approvals"那个可点元素
    const mascot = await waitFor(() => byLabel((l) => l.startsWith("Open ") && l.includes("activity")));
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
    };
    // 内容区容器（flex:1 那个）：取 scroller 的 offsetParent 作为近似
    const content = sc ? sc.parentElement : null;
    return {
      y: sc ? Math.round(sc.scrollTop) : null,
      bar: box(bar),
      barRow: box(barRow),
      mascot: box(mascot),
      content: content ? { top: Math.round(content.getBoundingClientRect().top), h: Math.round(content.getBoundingClientRect().height) } : null,
      labels: Array.from(document.querySelectorAll("[aria-label]")).slice(0, 14).map((e) => (e.getAttribute("aria-label") || "").slice(0, 26)),
    };
  });

const setY = (y) =>
  page.evaluate((t) => {
    const sc = Array.from(document.querySelectorAll("div")).find((n) => n.scrollHeight > n.clientHeight + 150);
    if (sc) sc.scrollTop = t;
  }, y);

const start = await probe();
if (!start.bar && !start.mascot) console.log("  （诊断：当前 aria-label 有 → " + JSON.stringify(start.labels) + "）");
if (start.y === null) {
  console.log("❌ 没找到可滚动容器（应用可能没起来）");
  await browser.close();
  process.exit(1);
}
if (start.y > 200) { await setY(0); await page.waitForTimeout(600); }

console.log("\n【A】慢速滑动（smoke test：模拟慢拖每步 2px）");
console.log("    注意：本项只能证明『程序化滑动不触发回退』。真机闪烁源于手指滚动与 JS scrollToOffset");
console.log("    的争夺，Web 无法复现 —— **硬判据是【D】布局恒定**（D 过则反馈环不成立）。");
const series = [];
let prevY = 0;
for (let step = 0; step < 120; step += 1) {
  const target = 2 * (step + 1);
  await setY(target);
  await page.waitForTimeout(24); // ~40fps，模拟慢拖的帧距
  const s = await probe();
  series.push(s.y ?? 0);
}
const reversals = series.filter((v, i) => i > 0 && v < series[i - 1]).length;
const maxBack = Math.max(0, ...series.map((v, i) => (i > 0 ? series[i - 1] - v : 0)));
console.log(`  scrollTop 序列样本: ${series.slice(0, 12).join(", ")} … 末值 ${series[series.length - 1]}`);
if (reversals === 0) pass("无反向跳动", `0 次回退（回退最大 ${maxBack}px）`);
else fail("出现反向跳动（反馈环）", `${reversals} 次回退，最大值 ${maxBack}px`);

console.log("\n【B】顶栏位移的纯函数性（同一 y 两次读数必须一致）");
let deterministic = true;
const marks = [0, 26, 52, 78, 104, 130];
for (const m of marks) {
  // 两次读数都记录**实际滚动位置**：用来区分"顶栏自身不确定"与"列表被复位到别处"
  await setY(m); await page.waitForTimeout(400);
  const r1 = await probe();
  await setY(m); await page.waitForTimeout(400);
  const r2 = await probe();
  const same = r1.bar && r2.bar && r1.bar.top === r2.bar.top;
  const scrollStable = r1.y === r2.y && r1.y === m;
  if (!same) {
    deterministic = false;
    if (!scrollStable) {
      console.log(`    y=${String(m).padStart(3)} → top ${r1.bar?.top} / ${r2.bar?.top} ✗  但实际滚动 ${r1.y} / ${r2.y} ≠ 目标 → **列表被复位**`);
      fails.push(`列表在设定 y=${m} 时被复位到 ${r2.y}（滚动位置不听话）`);
    } else {
      console.log(`    y=${String(m).padStart(3)} → top ${r1.bar?.top} / ${r2.bar?.top} ✗  滚动位置正常 → **顶栏自身不确定**`);
      fails.push(`同一 offset 顶栏位置不一致（y=${m}）`);
    }
  } else {
    console.log(`    y=${String(m).padStart(3)} → top ${r1.bar?.top} / ${r2.bar?.top}  滚动 ${r1.y}/${r2.y} ✓`);
  }
}
if (deterministic) pass("同一 offset 顶栏位置一致（且滚动位置听话）");

console.log("\n【C】水豚卡片：层级 + 是否随滚动隐藏");
await setY(0);
await page.waitForTimeout(500);
const at0 = (await probe()).mascot;
await setY(200);
await page.waitForTimeout(600);
const at200 = (await probe()).mascot;
const hit = await page.evaluate(() => {
  const m = document.querySelector('[aria-label^="Open "]');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const isMascot = !!(el && (el === m || m.contains(el) || el.contains(m)));
  return { isMascot, hitTag: el ? el.tagName : null, hitText: el ? (el.innerText || "").slice(0, 30) : "" };
});
console.log(`    静止 mascot top=${at0?.top} | 滚动 y=200 后 top=${at200?.top}`);
console.log(`    中心点命中: ${hit ? (hit.isMascot ? "水豚自己 ✓" : `别的元素 ✗ (${hit.hitTag}「${hit.hitText}」)`) : "取不到"}`);
if (hit?.isMascot) pass("滚动到中段水豚仍在最上层");
else fail("水豚被其它元素盖住（不是最前端）");
if (at0 && at200 && at0.top === at200.top) pass("水豚位置不随滚动变化（保留）");
else fail("水豚位置随滚动变化（会隐藏/位移）", `静止 ${at0?.top} → 滚动后 ${at200?.top}`);

console.log("\n【D】布局稳定性：内容区容器在滚动中是否恒定");
const c0 = await (async () => { await setY(0); await page.waitForTimeout(400); return (await probe()).content; })();
const c1 = await (async () => { await setY(200); await page.waitForTimeout(400); return (await probe()).content; })();
console.log(`    y=0   content top=${c0?.top} h=${c0?.h}`);
console.log(`    y=200 content top=${c1?.top} h=${c1?.h}`);
if (c0 && c1 && c0.top === c1.top && c0.h === c1.h) pass("内容区布局恒定（无每帧重排）");
else fail("内容区随滚动改变（反馈环源头）", `top ${c0?.top}→${c1?.top}，h ${c0?.h}→${c1?.h}`);

await page.screenshot({ path: "/tmp/accept-topbar.png" });
await browser.close();

console.log(`\n${"=".repeat(56)}`);
if (fails.length === 0) {
  console.log("✅ 四项全过 —— 可以打包");
  process.exit(0);
}
console.log(`❌ ${fails.length} 项未过：\n   - ${fails.join("\n   - ")}`);
console.log("（未过就不要打包 ✓）");
process.exit(1);
