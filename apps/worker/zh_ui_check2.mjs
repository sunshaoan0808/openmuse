import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
await p.goto("http://127.0.0.1:8081", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForTimeout(28000);

const inputs = await p.$$("input, textarea");
console.log(`输入框: ${inputs.length}`);
if (inputs.length >= 2 && KEY) {
  await inputs[0].fill("https://openmuse.claw.ssan.me");
  await inputs[1].fill(KEY);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll("div,button,a")];
    els.reverse().find((e) => /打开工作区|Open workspace/i.test(e.innerText || ""))?.click();
  });
  await p.waitForTimeout(22000);
}

const text = await p.evaluate(() => document.body.innerText || "");
console.log("\n===== 界面文本 =====");
console.log(text.replace(/\n{2,}/g, "\n").slice(0, 700));
const zh = (text.match(/[\u4e00-\u9fff]/g) || []).length;
// 页面上仍是英文的界面词（排除品牌/工具名）
const EN_OK = /^(OpenMuse|Gmail|Google|OpenBot|PDF|Rich Threads|America|Computer|Model|CPU|Terminal|API|URL|ID|JSON)$/i;
const words = [...new Set((text.match(/\b[A-Z][a-z]{2,}\b/g) || []))].filter((w) => !EN_OK.test(w));
console.log(`\n汉字 ${zh} ｜ 未汉化的英文词（去重，排品牌/专名）: ${JSON.stringify(words.slice(0, 40))}`);
console.log(`控制台错误: ${errs.length}`);
errs.slice(0, 4).forEach((e) => console.log("  - " + e));
await p.screenshot({ path: "/tmp/zh-ui.png" });
console.log("截图: /tmp/zh-ui.png");
await b.close();
