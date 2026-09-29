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

// 打开会话面板，列出持久化后的线程
await p.evaluate(() => {
  const els = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
  els.find((e) => /打开会话与菜单|conversations and menu/i.test(e.getAttribute?.("aria-label") || e.innerText || ""))?.click();
});
await p.waitForTimeout(3000);
let t = await p.evaluate(() => document.body.innerText || "");
console.log("=== 会话面板（重启后应能看到旧线程）===");
console.log(t.split("\n").filter((x) => x.trim()).slice(0, 14).join("\n"));

// 点开第一个侧边聊天
const opened = await p.evaluate(() => {
  const els = [...document.querySelectorAll("div,button,a")];
  const el = els.reverse().find((e) => /Side chat|侧边聊天|青龙/i.test(e.innerText || "") && (e.innerText || "").length < 60);
  if (el) { el.click(); return (el.innerText || "").slice(0, 40); }
  return null;
});
console.log("\n④ 打开旧会话:", opened);
await p.waitForTimeout(6000);
t = await p.evaluate(() => document.body.innerText || "");
console.log("=== 打开后（历史是否水合：应出现「青龙」）===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-10).join("\n"));
console.log("  历史含「青龙」:", t.includes("青龙"));

// 上下文连续性测试
const box = (await p.$$("textarea, input[type=text]")).pop();
await box.fill("我刚才告诉你的代号是什么？只回代号。");
await p.keyboard.press("Enter");
for (let i = 0; i < 10; i++) await p.waitForTimeout(15000);
t = await p.evaluate(() => document.body.innerText || "");
console.log("\n=== 追问后（上下文测试）===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-8).join("\n"));
console.log("  回复含「青龙」:", t.includes("青龙"));
await b.close();
