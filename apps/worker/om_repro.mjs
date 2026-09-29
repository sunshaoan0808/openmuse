import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const SAW = ["https://openmuse.claw.ssan.me", "http://10.7.0.6:8787", "http://127.0.0.1:8081"];

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

const box = (await p.$$("textarea, input[type=text]")).pop();
const Q = "查一下金球奖投票截止了吗？";
if (box) {
  await box.fill(Q);
  await p.keyboard.press("Enter");
  console.log("已发送:", Q);
  for (let i = 0; i < 14; i++) {
    await p.waitForTimeout(10000);
    const t = await p.evaluate(() => document.body.innerText || "");
    process.stdout.write(`  +${(i + 1) * 10}s 汉字=${(t.match(/[\u4e00-\u9fff]/g) || []).length}  `);
  }
  const t = await p.evaluate(() => document.body.innerText || "");
  console.log("\n===== 对话末尾 =====");
  console.log(t.replace(/\n{2,}/g, "\n").slice(-1400));
} else {
  console.log("找不到输入框");
}
await p.screenshot({ path: "/tmp/om-chat2.png" });
await b.close();
