import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const TARGET = "http://10.7.0.6:8788"; // Mastra 引擎实例

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });

await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(25000);
const ins = await p.$$("input, textarea");
if (ins.length >= 2) {
  await ins[0].fill(TARGET);
  await ins[1].fill(KEY);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""))?.click();
  });
  await p.waitForTimeout(20000);
}
const dump = await p.evaluate(() => (document.body.innerText || "").slice(0, 320));
console.log("界面现状:", JSON.stringify(dump));
const all = await p.$$("input, textarea, [contenteditable=true]");
console.log("可见输入元素:", all.length);
for (let i = 0; i < all.length; i++) {
  console.log(`  [${i}]`, JSON.stringify(await all[i].getAttribute("placeholder")), await all[i].evaluate((e) => e.tagName));
}
const box = all.length ? all[all.length - 1] : undefined;
if (!box) { console.log("找不到聊天输入框，退出"); await b.close(); process.exit(0); }
await box.fill("用一句话中文说明你是谁，另外 6 乘 7 等于几？");
await p.keyboard.press("Enter");
console.log("已向 Mastra 实例发送");
for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(15000);
  const t = await p.evaluate(() => document.body.innerText || "");
  process.stdout.write(`  +${(i + 1) * 15}s(${(t.match(/[\u4e00-\u9fff]/g) || []).length})`);
}
const t = await p.evaluate(() => document.body.innerText || "");
console.log("\n=== 界面尾部 ===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-8).join("\n"));
console.log("\n控制台错误:", errs.length);
errs.slice(0, 4).forEach((e) => console.log("  - " + e));
await b.close();
