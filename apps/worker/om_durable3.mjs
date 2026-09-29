import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(25000);
const inputs = await p.$$("input, textarea");
if (inputs.length >= 2) {
  await inputs[0].fill("https://openmuse.claw.ssan.me");
  await inputs[1].fill(KEY);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""))?.click();
  });
  await p.waitForTimeout(20000);
}
await p.evaluate(() => {
  const els = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
  els.find((e) => /打开会话与菜单|conversations and menu/i.test(e.getAttribute?.("aria-label") || e.innerText || ""))?.click();
});
await p.waitForTimeout(3500);

const cands = await p.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll("div,button,a,[role=button]")) {
    const txt = (e.innerText || "").trim().replace(/\s+/g, " ");
    if (!txt || txt.length > 60) continue;
    if (!/Side chat|侧边|新建|Untitled|未命名/.test(txt)) continue;
    out.push({ tag: e.tagName, txt, label: e.getAttribute("aria-label") || "" });
  }
  return out.slice(0, 12);
});
console.log("=== 面板候选元素 ===");
cands.forEach((c, i) => console.log(`  [${i}] <${c.tag}> "${c.txt}" aria=${c.label}`));

const clicked = await p.evaluate(() => {
  const want = /^Side chat \d+$|^侧边聊天 \d+$|^未命名|^Untitled/;
  for (const e of [...document.querySelectorAll("div,button,a,[role=button]")].reverse()) {
    const txt = (e.innerText || "").trim().replace(/\s+/g, " ");
    if (want.test(txt) && txt.length < 30) { e.click(); return txt; }
  }
  return null;
});
console.log("\n④ 点击:", clicked);
await p.waitForTimeout(8000);

let t = await p.evaluate(() => document.body.innerText || "");
console.log("=== 打开后（历史水合检查）===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-12).join("\n"));
console.log("  历史含「青龙」:", t.includes("青龙"));

const box = (await p.$$("textarea, input[type=text]")).pop();
await box.fill("我刚才告诉你的代号是什么？只回代号两个字。");
await p.keyboard.press("Enter");
for (let i = 0; i < 10; i++) await p.waitForTimeout(15000);
t = await p.evaluate(() => document.body.innerText || "");
console.log("\n=== 追问后 ===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-6).join("\n"));
console.log("  回复含「青龙」:", t.includes("青龙"));
await b.close();
