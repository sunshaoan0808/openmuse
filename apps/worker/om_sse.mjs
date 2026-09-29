import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
let runBody = null;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("response", async (r) => {
  if (r.url().includes("/api/copilotkit/agent/") && r.url().includes("/run")) {
    try { runBody = await r.text(); } catch (e) { runBody = "读取失败: " + String(e).slice(0, 80); }
    console.log("=== run 响应 SSE 正文（前 2500 字）===");
    console.log(String(runBody).slice(0, 2500));
  }
});

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
await p.waitForTimeout(2500);
await p.evaluate(() => {
  const els = [...document.querySelectorAll("div,button,a")];
  els.reverse().find((e) => /新建侧边聊天|New side chat/i.test(e.innerText || ""))?.click();
});
await p.waitForTimeout(3000);
const box = (await p.$$("textarea, input[type=text]")).pop();
await box.fill("再试一次：1+1 等于几？");
await p.keyboard.press("Enter");
await p.waitForTimeout(60000);

const t = await p.evaluate(() => document.body.innerText || "");
console.log("\n=== 界面末尾 ===");
console.log(t.split("\n").filter((x) => x.trim()).slice(-8).join("\n"));
if (!runBody) console.log("\n（没有捕获到 run 响应）");
console.log("\nrunBody 长度:", runBody ? String(runBody).length : 0);
await b.close();
