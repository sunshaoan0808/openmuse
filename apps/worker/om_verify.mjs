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

const send = async (q) => {
  const box = (await p.$$("textarea, input[type=text]")).pop();
  if (!box) { console.log("找不到输入框"); return; }
  await box.fill(q);
  await p.keyboard.press("Enter");
  console.log(`\n>>> 发送: ${q}`);
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(15000);
    const t = await p.evaluate(() => document.body.innerText || "");
    process.stdout.write(`  +${(i + 1) * 15}s(${(t.match(/[\u4e00-\u9fff]/g) || []).length})`);
  }
  console.log();
};

await send("今天是几号？只回答日期。");
await send("查一下金球奖投票截止了吗？");

const t = await p.evaluate(() => document.body.innerText || "");
console.log("\n===== 对话末尾（最近 12 行）=====");
console.log(t.split("\n").filter((x) => x.trim()).slice(-14).join("\n"));
await p.screenshot({ path: "/tmp/om-verify.png" });
await b.close();
