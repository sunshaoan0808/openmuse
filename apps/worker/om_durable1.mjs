import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
let threadId = "";
const out = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("request", (r) => {
  if (r.url().includes("/api/copilotkit/agent/") && r.url().includes("/run")) {
    try { threadId = JSON.parse(r.postData() || "{}").threadId || threadId; } catch {}
  }
});
p.on("response", (r) => { if (r.url().includes("/run")) out.push(`${r.status()} ${r.url().slice(-40)}`); });

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
// 新建侧边聊天（拿到一个全新 threadId）
await p.evaluate(() => {
  const els = [...document.querySelectorAll("[aria-label],[role=button],div,button,a")];
  els.find((e) => /打开会话与菜单|conversations and menu/i.test(e.getAttribute?.("aria-label") || e.innerText || ""))?.click();
});
await p.waitForTimeout(2500);
await p.evaluate(() => {
  const els = [...document.querySelectorAll("div,button,a")];
  els.reverse().find((e) => /新建侧边聊天|New side chat/i.test(e.innerText || ""))?.click();
});
await p.waitForTimeout(3000);

const box = (await p.$$("textarea, input[type=text]")).pop();
await box.fill("请记住：我的代号是「白虎」。另外 9 减 2 等于几？");
await p.keyboard.press("Enter");
for (let i = 0; i < 10; i++) await p.waitForTimeout(15000);

const t = await p.evaluate(() => document.body.innerText || "");
console.log("=== 第一轮结果 ===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-8).join("\n"));
console.log("\nthreadId:", threadId || "(未捕获)");
fs.writeFileSync("/tmp/durable-thread-id.txt", threadId);
await b.close();
