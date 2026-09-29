import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const MARK = "白虎";
const connectIds = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("request", (r) => {
  if (r.url().includes("/connect")) {
    try { connectIds.push(JSON.parse(r.postData() || "{}").threadId || "?"); } catch { connectIds.push("?"); }
  }
});

await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(25000);
const ins = await p.$$("input, textarea");
if (ins.length >= 2) {
  await ins[0].fill("https://openmuse.claw.ssan.me");
  await ins[1].fill(KEY);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""))?.click();
  });
  await p.waitForTimeout(20000);
}

for (let i = 0; i < 3; i++) {
  // 打开面板
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
    els.find((e) => /打开会话与菜单|conversations and menu/i.test(e.getAttribute?.("aria-label") || e.innerText || ""))?.click();
  });
  await p.waitForTimeout(2500);
  const clicked = await p.evaluate((idx) => {
    const entries = [];
    for (const e of document.querySelectorAll("div,button,a,[role=button]")) {
      const t = (e.innerText || "").trim().replace(/\s+/g, " ");
      if (/^未命名会话$|^Side chat \d+$/.test(t)) entries.push(e);
    }
    if (entries[idx]) { entries[idx].click(); return entries[idx].innerText.trim(); }
    return null;
  }, i);
  if (!clicked) { console.log(`  [${i}] 无此条目`); break; }
  connectIds.length = 0;
  await p.waitForTimeout(12000);
  const txt = await p.evaluate(() => document.body.innerText || "");
  console.log(`  [${i}] 点击「${clicked}」→ connect threadId=${connectIds[0] || "?"}  历史含「${MARK}」: ${txt.includes(MARK)}`);
}

// 在最后打开的线程里追问
const box = (await p.$$("textarea, input[type=text]")).pop();
await box.fill("我刚才告诉你的代号是什么？只回代号。");
await p.keyboard.press("Enter");
for (let i = 0; i < 9; i++) await p.waitForTimeout(15000);
const t = await p.evaluate(() => document.body.innerText || "");
console.log("\n追问后尾部:");
console.log(t.split("\n").filter((x) => x.trim()).slice(-5).join("\n"));
console.log(`  回复含「${MARK}」:`, t.includes(MARK));
await b.close();
