import { chromium } from "playwright";
import fs from "node:fs";

const env = fs.readFileSync("/home/ubuntu/openmuse/.env", "utf8");
const KEY = (env.match(/^OPENMUSE_ACCESS_KEY=(.+)$/m) || [])[1]?.trim() || "";
const log = [];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
p.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/copilotkit/")) {
    log.push({ dir: "→", m: r.method(), u: u.replace(/^https?:\/\/[^/]+/, ""), body: (r.postData() || "").slice(0, 400) });
  }
});
p.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/copilotkit/")) log.push({ dir: "←", m: String(r.status()), u: u.replace(/^https?:\/\/[^/]+/, ""), body: "" });
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
log.length = 0; // 只看"新建会话后"的流量
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
await box.fill("新会话探测：1+1 等于几？用一句话回答。");
await p.keyboard.press("Enter");
await p.waitForTimeout(45000);

console.log("=== 新建会话后的 /api/copilotkit 流量 ===");
for (const e of log) {
  console.log(`${e.dir} ${e.m} ${e.u}`);
  if (e.body) console.log(`     body: ${e.body.replace(/\s+/g, " ")}`);
}
await b.close();
